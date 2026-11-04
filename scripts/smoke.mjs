#!/usr/bin/env node
/**
 * Сквозная проверка приложения в headless Chrome через CDP.
 *
 * Проверяет: загрузку 3D-мира, стартовый диалог, демо-проводника, создание базы
 * (IndexedDB-вариант), запрос визуализации, сохранение в SQLite, перезагрузку и
 * чтение сохранённой модели из базы.
 *
 * Требуется запущенный `vite preview` и Chrome с remote debugging.
 * Запуск: node scripts/smoke.mjs [url] [cdpPort]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const APP_URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const FAKE_NANO = process.env.FAKE_NANO === '1';
const CDP_PORT = Number(process.argv[3] ?? 9223);
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const failures = [];
const consoleErrors = [];

function ok(label) {
  console.log(`  ✓ ${label}`);
}

function fail(label, details) {
  failures.push(`${label}${details ? ` — ${details}` : ''}`);
  console.log(`  ✗ ${label}${details ? ` — ${details}` : ''}`);
}

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
      if (message.error) reject(new Error(`${message.error.message}`));
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
    storageTypes: 'indexeddb,local_storage,service_workers',
  });

  if (FAKE_NANO) {
    // Подменяем Prompt API: проверяем путь Gemini Nano без скачивания модели
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.LanguageModel = {
          availability: async () => 'available',
          create: async () => ({
            destroy() {},
            async prompt(input, options) {
              const schema = options && options.responseConstraint;
              if (schema && schema.properties && schema.properties.action) {
                return JSON.stringify({ reply: 'Готово, строю домик.', action: 'visualize', request: 'дом' });
              }
              if (schema) {
                return JSON.stringify({
                  title: 'Домик',
                  description: 'Простой дом из примитивов.',
                  parts: [
                    { shape: 'box', position: [0, 0.9, 0], scale: [2, 1.8, 2], color: '#8d7361' },
                    { shape: 'cone', position: [0, 2.2, 0], scale: [2.8, 1.2, 2.8], color: '#c1503f' },
                    { shape: 'text', position: [0, 3.2, 0], scale: [1, 1, 1], color: '#e2eeff', text: 'Дом' }
                  ]
                });
              }
              return 'Домик готов.';
            }
          })
        };
      `,
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

  const waitFor = async (expression, label, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        /* страница ещё грузится */
      }
      await sleep(200);
    }
    fail(label, 'таймаут');
    return false;
  };

  console.log(`\n→ ${APP_URL}`);
  await cdp.send('Page.navigate', { url: APP_URL });

  if (await waitFor("!!document.querySelector('.world-canvas')", '3D-канвас создан')) {
    ok('3D-канвас создан');
  }

  if (await waitFor("!!document.querySelector('.modal:not([hidden])')", 'стартовый диалог')) {
    ok('стартовый диалог показан');
  }

  const hasCanvasSize = await evaluate(
    "(() => { const c = document.querySelector('.world-canvas'); return !!c && c.width > 100 && c.height > 100; })()",
  );
  if (hasCanvasSize) ok('канвас отрисован в размере окна');
  else fail('канвас отрисован в размере окна');

  const chatReady = await evaluate(
    "document.querySelectorAll('.chat').length === 1 && !!document.querySelector('.chat__input')",
  );
  if (chatReady) ok('чат проводника на месте');
  else fail('чат проводника на месте');

  // Gemini Nano в headless нет → приложение должно включить демо-режим само
  // База в IndexedDB (без системных диалогов — работает в headless)
  await evaluate("document.querySelector('[data-action=\"idb-db\"]').click()");
  if (await waitFor("!document.querySelector('[data-action=\"enter\"]').disabled", 'база готова')) {
    ok('база SQLite создана и открыта');
  }

  const initialNote = await evaluate(
    "document.querySelector('.setup__note[data-bind=\"db-note\"]').textContent",
  );
  const initialCount = Number((String(initialNote).match(/Записей в базе: (\d+)/) ?? [])[1] ?? 0);
  const expectedCount = initialCount + 1;
  console.log(`  · моделей в базе до запроса: ${initialCount}`);

  await evaluate("document.querySelector('[data-action=\"enter\"]').click()");
  if (await waitFor("document.querySelector('.modal').hidden", 'вход в мир')) {
    ok('вход в мир');
  }

  const modeNeedle = FAKE_NANO ? 'Gemini Nano' : 'демо';
  const modeReady = await waitFor(
    `document.querySelector('.chat__mode').textContent.includes('${modeNeedle}')`,
    `режим проводника (${modeNeedle})`,
  );
  if (modeReady) {
    ok(FAKE_NANO ? 'подключён путь Gemini Nano (Prompt API)' : 'демо-режим включён автоматически');
  }

  const greetingCount = await evaluate("document.querySelectorAll('.chat__message').length");
  if (greetingCount >= 1) ok(`проводник поздоровался (${greetingCount} сообщение)`);
  else fail('приветствие проводника');

  // Запрос визуализации
  await evaluate(`(() => {
    const input = document.querySelector('.chat__input');
    input.focus();
    input.value = 'покажи солнечную систему';
    document.querySelector('.chat__form').requestSubmit();
    return true;
  })()`);

  if (await waitFor("document.querySelectorAll('.chat__viz').length === 1", 'модель создана', 25000)) {
    ok('проводник построил и сохранил модель');
  }

  const vizInfo = await evaluate(
    "(() => { const chip = document.querySelector('.chat__viz'); return chip ? chip.textContent.trim() : null; })()",
  );
  if (vizInfo) ok(`модель в чате: ${vizInfo}`);

  const dbStat = await evaluate(
    "document.querySelector('[data-stat=\\\"db\\\"] .hud__stat-value').textContent",
  );
  if (String(dbStat).includes('IndexedDB')) ok(`статус базы: ${dbStat}`);
  else fail('статус базы обновился', String(dbStat));

  // Галерея
  await evaluate("document.querySelector('[data-action=\"gallery\"]').click()");
  if (await waitFor("document.querySelectorAll('.gallery__item').length >= 1", 'галерея')) {
    ok('модель видна в галерее');
  }

  const badge = await evaluate(
    "(() => { const b = document.querySelector('.gallery__badge'); return b ? b.textContent.trim() : null; })()",
  );
  if (FAKE_NANO ? badge === 'Gemini Nano' : badge === 'демо') ok(`источник модели: ${badge}`);
  else fail('источник модели в галерее', String(badge));
  await evaluate("document.querySelector('.gallery [data-action=\"close\"]').click()");

  // Файл базы действительно является SQLite-файлом
  const dbFile = await evaluate(`(async () => {
    const open = await new Promise((resolve, reject) => {
      const request = indexedDB.open('visual-lab', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stored = await new Promise((resolve, reject) => {
      const tx = open.transaction('kv', 'readonly');
      const request = tx.objectStore('kv').get('sqlite-fallback-bytes');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!stored) return null;
    const bytes = stored instanceof Uint8Array ? stored : new Uint8Array(stored);
    return { header: String.fromCharCode(...bytes.slice(0, 16)), size: bytes.byteLength };
  })()`);

  if (dbFile && dbFile.header === 'SQLite format 3\u0000' && dbFile.size > 4096) {
    ok(`база — настоящий SQLite-файл (${dbFile.size} байт)`);
  } else {
    fail('база — настоящий SQLite-файл', JSON.stringify(dbFile));
  }

  // Скриншот мира
  await sleep(700);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync('tmp', { recursive: true });
  writeFileSync('tmp/smoke-world.png', Buffer.from(shot.data, 'base64'));
  ok('скриншот сохранён в tmp/smoke-world.png');

  // Перезагрузка: данные должны прийти из SQLite
  await cdp.send('Page.reload');
  await sleep(1600);
  await waitFor("!!document.querySelector('[data-action=\"idb-db\"]')", 'перезагрузка');
  await evaluate("document.querySelector('[data-action=\"idb-db\"]').click()");
  await waitFor("!document.querySelector('[data-action=\"enter\"]').disabled", 'повторное открытие базы');

  const dbNote = await evaluate(
    "document.querySelector('.setup__note[data-bind=\"db-note\"]').textContent",
  );
  if (new RegExp(`Записей в базе: ${expectedCount}`).test(String(dbNote))) {
    ok(`после перезагрузки из базы прочитано ${expectedCount} моделей`);
  } else {
    fail('модель сохранилась в базе', String(dbNote));
  }

  const pageErrors = consoleErrors.filter(
    (message) =>
      !/favicon|net::ERR|Failed to load resource|Pointer Lock API|WrongDocumentError/i.test(message),
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
    console.log('\nВсе проверки пройдены.');
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error('\nСмоук-тест упал:', error);
    process.exitCode = 2;
  });
