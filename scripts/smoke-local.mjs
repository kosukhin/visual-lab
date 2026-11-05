#!/usr/bin/env node
/**
 * Сквозная проверка локальной WASM-модели (wllama) через CDP.
 *
 * Скачивает крошечную GGUF (19 МБ) вместо Qwen2.5-0.5B (409 МБ), чтобы тест
 * проходил быстро, и проверяет всю цепочку: скачивание → кэш → инференция →
 * повторный запуск из кэша → удаление.
 *
 * Запуск: node scripts/smoke-local.mjs [url] [cdpPort]
 */
import { setTimeout as sleep } from 'node:timers/promises';

const APP_URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const CDP_PORT = Number(process.argv[3] ?? 9224);
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const TINY_MODEL =
  'https://huggingface.co/ggml-org/models/resolve/main/tinyllamas/stories15M-q4_0.gguf';
/** REAL_MODEL=1 — тест с настоящей Qwen2.5-0.5B (409 МБ) вместо крошечной. */
const USE_REAL_MODEL = process.env.REAL_MODEL === '1';
const KEEP_MODEL_CACHE = process.env.KEEP_MODEL_CACHE === '1';

const failures = [];
const consoleErrors = [];

const ok = (label) => console.log(`  ✓ ${label}`);
const fail = (label, details) => {
  failures.push(`${label}${details ? ` — ${details}` : ''}`);
  console.log(`  ✗ ${label}${details ? ` — ${details}` : ''}`);
};

async function openTarget(url) {
  const response = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`CDP ${response.status}: ${await response.text()}`);
  return response.json();
}

function connect(client) {
  const ws = new WebSocket(client.webSocketDebuggerUrl);
  const pending = new Map();
  const listeners = new Map();
  let seq = 0;

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    const handler = listeners.get(message.method);
    if (handler) handler(message.params);
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  return {
    ready,
    on(method, handler) {
      listeners.set(method, handler);
    },
    send(method, params = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function main() {
  const target = await openTarget('about:blank');
  const cdp = connect(target);
  await cdp.ready;

  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
  });
  cdp.on('Runtime.exceptionThrown', (params) => {
    consoleErrors.push(params.exceptionDetails?.exception?.description ?? 'uncaught exception');
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Storage.clearDataForOrigin', {
    origin: new URL(APP_URL).origin,
    // KEEP_MODEL_CACHE=1 — не трогать кэш моделей (быстрый повтор прогона)
    storageTypes: KEEP_MODEL_CACHE
      ? 'indexeddb,local_storage,service_workers'
      : 'indexeddb,local_storage,service_workers,cache_storage',
  });

  if (!USE_REAL_MODEL) {
    // подменяем модель на крошечную, чтобы тест не тянул 409 МБ
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('visual-lab:local-model-url', ${JSON.stringify(TINY_MODEL)}); } catch {}`,
    });
  }

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'ошибка evaluate');
    }
    return result.result.value;
  };

  const waitFor = async (expression, label, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        /* страница ещё грузится */
      }
      await sleep(250);
    }
    fail(label, 'таймаут');
    return false;
  };

  console.log(`\n→ ${APP_URL} (локальная модель: ${USE_REAL_MODEL ? 'Qwen2.5-0.5B, 409 МБ' : 'tiny 19 МБ'})`);
  await cdp.send('Page.navigate', { url: APP_URL });

  if (await waitFor("!!document.querySelector('[data-bind=\"local-badge\"]')", 'секция локальной модели')) {
    ok('секция «Локальная модель» в диалоге');
    await waitFor(
      "document.querySelector('[data-bind=\"local-badge\"]').textContent !== 'проверяю…'",
      'состояние секции',
      20000,
    );
    const badge = await evaluate("document.querySelector('[data-bind=\"local-badge\"]').textContent");
    const downloadVisible = await evaluate(
      "!document.querySelector('[data-action=\"local-download\"]').hidden",
    );
    if (badge === 'не скачана' && downloadVisible) ok(`стартовое состояние: ${badge}`);
    else fail('стартовое состояние секции', `${badge} / download=${downloadVisible}`);
  }

  // скачивание
  await evaluate("document.querySelector('[data-action=\"local-download\"]').click()");
  if (await waitFor("document.querySelector('[data-bind=\"local-badge\"]').textContent === 'загрузка…'", 'старт загрузки', 15000)) {
    ok('скачивание началось');
  }

  const downloaded = await waitFor(
    "['готова','в кэше','работает сейчас'].includes(document.querySelector('[data-bind=\"local-badge\"]').textContent)",
    'модель скачана',
    USE_REAL_MODEL ? 900000 : 150000,
  );
  if (downloaded) ok('модель скачана и загружена в память');

  const mode = await evaluate("document.querySelector('.chat__mode').textContent");
  if (String(mode).includes('локально')) ok(`режим проводника: ${mode}`);
  else fail('чат переключился на локальную модель', String(mode));

  const brainStat = await evaluate(
    "document.querySelector('[data-stat=\"brain\"] .hud__stat-value').textContent",
  );
  if (/локальная|WASM|Qwen/i.test(String(brainStat))) ok(`статус ИИ в HUD: ${brainStat}`);
  else fail('статус ИИ обновился', String(brainStat));

  // база + вход в мир
  await evaluate("document.querySelector('[data-action=\"idb-db\"]').click()");
  await waitFor("!document.querySelector('[data-action=\"enter\"]').disabled", 'база готова');
  await evaluate("document.querySelector('[data-action=\"enter\"]').click()");
  await waitFor("document.querySelector('.modal').hidden", 'вход в мир');

  // запрос к локальной модели
  const before = await evaluate("document.querySelectorAll('.chat__message').length");
  await evaluate(`(() => {
    const input = document.querySelector('.chat__input');
    input.focus();
    input.value = 'покажи куб';
    document.querySelector('.chat__form').requestSubmit();
    return true;
  })()`);

  const answered = await waitFor(
    `document.querySelectorAll('.chat__message').length >= ${before + 2}`,
    'ответ локальной модели',
    USE_REAL_MODEL ? 600000 : 240000,
  );
  if (answered) {
    const last = await evaluate(`(() => {
      const nodes = document.querySelectorAll('.chat__message--conductor .chat__bubble');
      return nodes.length ? nodes[nodes.length - 1].textContent.slice(0, 120) : '';
    })()`);
    ok(`локальная модель ответила: ${String(last).replace(/\s+/g, ' ').trim()}`);
  }

  // перезагрузка: модель должна подняться из кэша
  await cdp.send('Page.reload');
  await sleep(2500);
  await waitFor("!!document.querySelector('[data-bind=\"local-badge\"]')", 'перезагрузка');
  await waitFor(
    "document.querySelector('.chat__mode').textContent.includes('локально')",
    'авто-подключение из кэша',
    60000,
  );
  const badgeAfterReload = await evaluate(
    "document.querySelector('[data-bind=\"local-badge\"]').textContent",
  );
  const modeAfterReload = await evaluate("document.querySelector('.chat__mode').textContent");
  if (
    ['в кэше', 'готова', 'работает сейчас'].includes(String(badgeAfterReload)) &&
    String(modeAfterReload).includes('локально')
  ) {
    ok(`после перезагрузки модель из кэша (${badgeAfterReload})`);
  } else {
    fail('модель восстановлена из кэша', `${badgeAfterReload} / ${modeAfterReload}`);
  }

  // удаление из кэша
  await evaluate("window.confirm = () => true");
  await evaluate("document.querySelector('[data-action=\"local-delete\"]').click()");
  if (await waitFor("document.querySelector('[data-bind=\"local-badge\"]').textContent === 'не скачана'", 'удаление из кэша', 30000)) {
    ok('модель удалена из кэша');
  }

  const pageErrors = consoleErrors.filter(
    (message) =>
      !/favicon|net::ERR|Failed to load resource|Pointer Lock API|WrongDocumentError|WebGL|Model returned an error/i.test(
        message,
      ),
  );
  if (pageErrors.length === 0) ok('ошибок в консоли нет');
  else fail('консоль чистая', pageErrors.slice(0, 3).join(' | '));

  cdp.close();
}

main()
  .then(() => {
    if (failures.length) {
      console.error(`\nПровалено проверок: ${failures.length}`);
      for (const item of failures) console.error(` - ${item}`);
      process.exitCode = 1;
      return;
    }
    console.log('\nВсе проверки локальной модели пройдены.');
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error('\nСмоук-тест локальной модели упал:', error);
    process.exitCode = 2;
  });
