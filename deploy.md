# Деплой Visual Lab на GitHub Pages

Приложение — полностью статическое: `npm run build` кладёт в `dist/` HTML, JS, CSS,
WASM и ассеты. Сервер на Node нужен только для сборки, поэтому GitHub Pages
подходит без оговорок (кроме ограничений самого Pages, см. ниже).

| Что | Значение |
| --- | --- |
| Адрес после деплоя | <https://kosukhin.github.io/visual-lab/> |
| Ветка деплоя | `main` (каждый push) |
| Workflow | `.github/workflows/deploy.yml` |
| Артефакт | `dist/` (в git не попадает, `.gitignore`) |
| Префикс пути (`base`) | `/visual-lab/` |
| Node в CI | 22 (Vite 8 требует `^20.19` или `>=22.12`) |

---

## 1. Как это работает

```
push в main ──► GitHub Actions ──► npm ci ──► npm run build (typecheck + vite build)
                                    └──► dist/ ──► upload-pages-artifact ──► deploy-pages ──► Pages CDN
```

Workflow `.github/workflows/deploy.yml` состоит из двух job'ов:

1. **build** — ставит зависимости по `package-lock.json` (`npm ci`), собирает проект,
   упаковывает `dist/` в artifact Pages.
2. **deploy** — публикует artifact в environment `github-pages` и печатает URL
   (`steps.deployment.outputs.page_url`).

Права выдаются ровно те, что нужны Pages: `contents: read`, `pages: write`,
`id-token: write` (OIDC-токен для `actions/deploy-pages`). Параллельность
зафиксирована группой `pages`, поэтому два деплоя не перетирают друг друга.

## 2. Разовая настройка репозитория

Без этих шагов workflow упадёт на `deploy-pages` с ошибкой
`Get Pages site failed` / `Not Found`.

1. **Settings → Pages → Build and deployment → Source: `GitHub Actions`.**
   (Не «Deploy from a branch» — иначе источником станет ветка, а workflow будет
   складывать артефакт в пустоту.)
2. **Settings → Actions → General → Workflow permissions:** достаточно
   `Read repository contents` — `pages: write` и `id-token: write` выданы прямо в
   workflow-файле через блок `permissions`.
3. Репозиторий должен быть **публичным** (у приватных Pages доступны только на
   платных тарифах). `kosukhin/visual-lab` уже публичный.

Опционально, там же в **Settings → Pages → Custom domain** можно прикрутить свой
домен — тогда обязательно поменяйте префикс сборки (раздел 4).

## 3. Запуск деплоя

Автоматически:

```bash
git add .
git commit -m "feat: ..."
git push origin main        # workflow "Deploy to GitHub Pages" стартует сам
```

Вручную (передеплой без нового коммита): **Actions → Deploy to GitHub Pages →
Run workflow** — в workflow для этого есть `workflow_dispatch`.

Прогресс и логи — во вкладке **Actions**. Успешный деплой выглядит так: зелёный
job `Публикация` и ссылка на сайт в описании запуска.

## 4. Префикс пути (`base`) — самое важное

GitHub Pages для репозитория **отдаёт сайт из подкаталога** `/<repo>/`, поэтому
все ссылки в сборке должны начинаться с `/visual-lab/`. Если собрать с `base: '/'`,
сайт откроется, но останется с пустым экраном: браузер будет искать
`/assets/index-*.js` вместо `/visual-lab/assets/index-*.js`.

В `vite.config.ts` префикс задан одной константой и дальше используется везде:

```ts
const BASE_PATH = process.env.BASE_PATH ?? '/visual-lab/';

export default defineConfig(({ command, isPreview }) => {
  const base = command === 'build' || isPreview ? BASE_PATH : '/';
  return {
    base,                                  // ссылки в index.html и импорты ассетов
    plugins: [
      VitePWA({
        manifest: {
          start_url: base,                 // PWA стартует из /visual-lab/
          scope: base,                     // service worker управляет только своим подкаталогом
          icons: [{ src: `${base}icons/icon-192.png`, /* ... */ }],
        },
        workbox: {
          navigateFallback: 'index.html',  // относительный путь: SW сам достроит /visual-lab/
        },
      }),
    ],
  };
});
```

Правила, которые нельзя нарушать при смене префикса:

- `start_url` и `scope` манифеста обязаны совпадать с `base` — иначе Chrome не
  предложит установку PWA, а service worker получит второй, «пустой» scope.
- `navigateFallback` должен оставаться **относительным** (`index.html`).
  Абсолютный `/index.html` уводит офлайн-навигацию в корень домена → 404.
- Ассеты из `public/` (`favicon.svg`, `icons/*.png`) подключены в `index.html`
  абсолютными путями (`/favicon.svg`) — это нормально: Vite сам подставляет к ним
  `base`, в `dist/index.html` получается `/visual-lab/favicon.svg`.

### Другой вариант размещения

| Куда деплоим | Что сделать |
| --- | --- |
| Project page (текущий случай) | ничего, по умолчанию `BASE_PATH=/visual-lab/` |
| Свой домен (`visual-lab.example.com`) | `BASE_PATH=/` в CI: добавить `env: BASE_PATH: /` в шаг сборки workflow |
| User site (`kosukhin.github.io`) | `BASE_PATH=/`, репозиторий должен называться `kosukhin.github.io` |
| Форк с другим именем | `BASE_PATH=/my-fork/` |

`BASE_PATH` — переменная окружения процесса сборки, а не переменная Vite
(`.env`), поэтому значение не зависит от `mode`. Дефолт подходит основному
репозиторию, и в CI ничего передавать не нужно. Слэш на конце можно не писать:
значение нормализуется (`/visual-lab` → `/visual-lab/`).

## 5. Локальная проверка той же сборки

`npm run preview` поднимает собранный `dist/` **с тем же префиксом**, что и на
Pages, — локально видно ровно то, что уедет на хостинг:

```bash
npm run build
npm run preview          # http://localhost:4173/visual-lab/
```

Режим разработки остался на корне (`npm run dev` → <http://localhost:5173/>) —
так удобнее, и на прод это не влияет.

Сквозной смоук-тест (headless Chrome + CDP) по умолчанию ходит на
`http://127.0.0.1:4173/visual-lab/`:

```bash
npm run build && npm run preview &
google-chrome --headless=new --remote-debugging-port=9223 \
  --user-data-dir=/tmp/vl-chrome --enable-unsafe-swiftshader --use-angle=swiftshader about:blank &
node scripts/smoke.mjs
# свой адрес и порт CDP: node scripts/smoke.mjs http://127.0.0.1:4173/visual-lab/ 9223
```

Тест проверяет и работу из подкаталога: загрузку `sqlite3.wasm` по
`/visual-lab/assets/...`, создание базы, сохранение модели и чтение её после
перезагрузки.

## 6. Проверка после деплоя

```bash
# главная страница и ассеты должны отвечать 200, а не 404
curl -sI https://kosukhin.github.io/visual-lab/ | head -3
curl -s https://kosukhin.github.io/visual-lab/ | grep -o '/visual-lab/assets/[^"]*'

# манифест PWA должен содержать префикс: start_url и scope = /visual-lab/
curl -s https://kosukhin.github.io/visual-lab/manifest.webmanifest
```

Чек-лист в браузере:

- [ ] мир открывается, виден стартовый диалог выбора базы;
- [ ] DevTools → Console без ошибок загрузки ассетов;
- [ ] DevTools → Application → Manifest: иконки и `start_url` = `/visual-lab/`;
- [ ] Application → Service Workers: `sw.js` в статусе `activated`;
- [ ] Application → Cache Storage → `workbox-precache-…` содержит `sqlite3-*.wasm`;
- [ ] после перезагрузки ассеты отдаются «из» service worker'а.

## 7. Кэш и service worker: «задеплоил, а изменений нет»

`vite-plugin-pwa` настроен на `registerType: 'autoUpdate'` +
`cleanupOutdatedCaches`, поэтому новая версия активируется сама, но **после
перезагрузки страницы**: первый заход сразу после деплоя ещё может отдать старый
`index.html` из precache.

Как увидеть свежую сборку:

1. Обычная перезагрузка (F5), если не помогло — Ctrl+Shift+R.
2. DevTools → Application → Service Workers → **Unregister**, затем
   Application → **Clear storage** → Clear site data.
3. Приватное окно — самый быстрый способ получить версию прямо с сервера.

Если не помогло и это — проверьте, какой коммит собран: вкладка Actions, последний
запуск. Частая причина: push ушёл в другую ветку, а workflow слушает только `main`.

## 8. Ограничения GitHub Pages, которые касаются этого проекта

| Ограничение | Как отражается здесь |
| --- | --- |
| Файл до 100 МБ, сайт до 1 ГБ | Крупнейший файл сборки — `assets/wllama-*.wasm` (~8.8 МБ), весь `dist/` ~11 МБ. Запас большой. |
| ~10 сборок в час на репозиторий | Не проблема при обычном темпе пушей. |
| Только статика, своих HTTP-заголовков нет | Приложению достаточно HTTPS. COOP/COEP (нужны для `SharedArrayBuffer`) Pages выставить не может, но проект их не использует: `crossOriginIsolated` и многопоточный WASM не требуются. |
| HTTPS включён всегда | Обязателен для `showSaveFilePicker` (File System Access), Prompt API (Gemini Nano) и service worker'а — на `http://` они недоступны. |
| Нет серверных редиректов/rewrite | Приложение одноэкранное, роутера нет; навигацию после установки SW обслуживает `navigateFallback`, до установки — обычный `index.html` по адресу `/visual-lab/`. |
| `dist/` не коммитится | `dist` в `.gitignore` — на Pages попадает только артефакт из CI. |

Отдельно про «тяжёлые» данные: **модели не деплоятся**. Gemini Nano живёт внутри
Chrome (скачивается через `chrome://components`), локальная GGUF-модель качается
браузером с HuggingFace по требованию пользователя (`src/ai/local-model.ts`).
Pages отдаёт только код и WASM-рантаймы.

`public/.nojekyll` попадает в `dist/` — это страховка на случай публикации через
ветку `gh-pages` (Jekyll выбрасывает файлы и каталоги с `_` в имени). Для деплоя
через `actions/deploy-pages` файл не нужен, но и не мешает.

## 9. Альтернатива: публикация из ветки `gh-pages`

Если нужно обойтись без Actions (например, деплой с локальной машины):

```bash
# один раз: Settings → Pages → Source: Deploy from a branch → gh-pages / (root)
npm run build
npx gh-pages -d dist --nojekyll -m "deploy $(date -Iseconds)"
```

`dist/` руками уезжает в ветку `gh-pages`, Pages раздаёт её как статику. Минусы:
нет typecheck-гейта в CI, версия сборки не привязана к коммиту, история ветки
растёт. Рекомендуемый путь — workflow из раздела 1.

## 10. Диагностика

| Симптом | Причина и что делать |
| --- | --- |
| Пустой экран, в консоли `Failed to load module script` / 404 на `/assets/…` | Сборка сделана с неверным `base`. Проверьте `curl https://kosukhin.github.io/visual-lab/` — пути должны начинаться с `/visual-lab/`. |
| `deploy-pages` падает: `Get Pages site failed` / `Not Found` | Не включён source `GitHub Actions` (Settings → Pages) или у токена нет `pages: write`. |
| `Resource not accessible by integration` | В workflow потеряны `permissions: pages: write` / `id-token: write`. |
| `npm ci` падает: lockfile не совпадает с `package.json` | Локально `npm install` менял зависимости — закоммитьте обновлённый `package-lock.json`. |
| Сборка падает в `npm run typecheck` | `build` включает `tsc --noEmit`. Локально: `npm run typecheck`. |
| Сайт открывается, но PWA устанавливается с неверным адресом | `start_url`/`scope` манифеста не совпадают с `base` — см. раздел 4. |
| Chrome вообще не предлагает установку PWA | Манифест не отдаётся или иконки битые: `curl -sI https://kosukhin.github.io/visual-lab/manifest.webmanifest`, Application → Manifest. |
| Офлайн-режим ломается, навигация уходит на 404 | `workbox.navigateFallback` снова абсолютный — верните `'index.html'`. |
| «Не удалось запустить Visual Lab» после деплоя | Console: обычно 404 на `assets/*.wasm` (снова `base`) или заблокированный `showSaveFilePicker` вне HTTPS. |
| Gemini Nano недоступна на задеплоенном сайте | Ожидаемо для браузеров без Prompt API — приложение уходит в демо-режим. На деплой не влияет, инструкция по включению — в `README.md`. |

## 11. Что менять, если переименовали репозиторий

1. `BASE_PATH` в `vite.config.ts` (или `env: BASE_PATH` в workflow) — на `/новое-имя/`.
2. Адреса в этом файле и в `README.md`.
3. Settings → Pages: старый URL после переименования проекта перестаёт работать.

