# Visual Lab — 3D-мир с ИИ-проводником

PWA-приложение: вы попадаете в пустой 3D-мир от первого лица, рядом всегда идёт
проводник — человечек из квадратиков, аватар встроенной в браузер модели
**Gemini Nano**. Вы просите его показать что-нибудь, он собирает 3D-модель из
примитивов, ставит её перед вами и сохраняет в **SQLite**-базу — в файл на вашем
компьютере, который вы выбираете сами.

Стек: **TypeScript + Vite**, **three.js**, **@sqlite.org/sqlite-wasm**,
**vite-plugin-pwa**, File System Access API. Без UI-фреймворков.

## Возможности

- **Первое лицо**: Pointer Lock + WASD/стрелки, Shift — бег, лёгкое покачивание головы.
- **Проводник**: собран из боксов (голова, глаза-визоры, антенна, корпус, руки, ноги).
  Догоняет игрока, разворачивается лицом, анимирует ходьбу, меняет цвет антенны в
  зависимости от состояния («думает», «рисует», «говорит»).
- **Gemini Nano**: проверка `LanguageModel.availability()`; если модели нет, проводник
  предлагает скачать её (прогресс загрузки в диалоге). Поддержаны и новый
  (`LanguageModel`), и старый (`ai.languageModel`) Prompt API.
- **Структурированный ответ модели**: две фазы — короткий «план» (ответ + нужно ли
  рисовать) и генерация JSON-спеки визуализации через `responseConstraint`
  (JSON Schema). Спека валидируется и нормализуется, поэтому «странные» числа и
  цвета от модели не ломают сцену.
- **Визуализации из примитивов**: box, sphere, cylinder, cone, torus, capsule, plane,
  octahedron, text (спрайт-подпись), line (ломаная). Авто-масштаб в габарит ~2.4 м,
  подставка, светящееся кольцо, подпись и медленное вращение.
- **SQLite (WASM)**: официальный `@sqlite.org/sqlite-wasm`, файл `.wasm` идёт как
  обычный ассет сборки (`?url`-импорт), поэтому работает и в dev, и в production, и
  кэшируется service worker'ом.
- **SQLite**: при старте проводник просит выбрать базу — создать новый файл через
  `showSaveFilePicker` или открыть существующий через `showOpenFilePicker`.
  Байты читаются в WASM-базу (`sqlite3_deserialize`), после каждого изменения файл
  перезаписывается (`sqlite3_js_db_export`, дебаунс 350 мс). Выбранный файл
  запоминается в IndexedDB, при следующем запуске предлагается «Продолжить».
  Fallback без File System Access API — хранение базы в IndexedDB.
- **Галерея**: список сохранённых моделей (дата, число частей, исходный запрос),
  «Показать» (модель появляется перед игроком) и «Удалить». При запуске
  сохранённые модели раскладываются по кольцу площадки.
- **Демо-режим**: если Prompt API недоступен (Firefox, Safari, часть сборок Chrome),
  проводник работает на локальном шаблоне-планировщике — весь остальной путь
  (3D, SQLite, галерея) остаётся рабочим.
- **PWA**: манифест, иконки (генерируются скриптом), service worker с precache
  (включая `sqlite3.wasm`), работа офлайн после первой загрузки.

## Требования

- **Chrome/Edge 138+ на десктопе** для Gemini Nano (модель ~2–4 ГБ, скачивается
  один раз). В остальных браузерах доступен демо-режим.
- File System Access API (Chrome/Edge) для файла базы; иначе — IndexedDB.
- Node.js 20.19+ (сборка проверена на Node 22).

## Команды

```bash
npm install      # зависимости
npm run dev      # http://localhost:5173
npm run build    # typecheck + production-сборка в dist/
npm run preview  # http://localhost:4173 — собранное приложение
npm run typecheck
npm run icons    # перегенерировать PWA-иконки (public/icons/*.png)
```

Сквозной смоук-тест (headless Chrome + CDP) проверяет мир, базу, сохранение и
чтение модели после перезагрузки:

```bash
npm run build && npm run preview &
google-chrome --headless=new --remote-debugging-port=9223 \\
  --user-data-dir=/tmp/vl-chrome --enable-unsafe-swiftshader --use-angle=swiftshader about:blank &
node scripts/smoke.mjs http://127.0.0.1:4173/ 9223

# тот же тест, но с подменой Prompt API — проверяет «настоящий» путь Gemini Nano
FAKE_NANO=1 node scripts/smoke.mjs http://127.0.0.1:4173/ 9223
```

## Управление

| Действие | Клавиша |
| --- | --- |
| Идти / бежать | `WASD`/стрелки, `Shift` |
| Смотреть | мышь (клик по миру — захват) |
| Чат с проводником | `T` |
| Галерея | `G` |
| Справка | `H` |
| Освободить курсор / закрыть окно | `Esc` |

## Структура

```
src/
  main.ts               сборка приложения: мир ↔ ИИ ↔ SQLite ↔ UI
  types.ts              типы: спека визуализации, сообщения, «мозг» проводника
  pwa.ts                регистрация service worker (только в production)
  ai/
    gemini-nano.ts      детект Prompt API, создание сессии, прогресс загрузки модели
    nano-brain.ts       проводник на Gemini Nano: план → JSON-спека, восстановление сессии
    demo-brain.ts       офлайн-планировщик на шаблонах (демо-режим)
    prompts.ts          системный промпт, JSON-схемы, нормализация спеки, цвета
  db/
    database.ts         VizDatabase: open/insert/remove/list/saveNow поверх sqlite-wasm
    storage.ts          DbStorage: файл на диске (FSA) или IndexedDB
    idb.ts              key-value IndexedDB (хэндл файла, fallback-база)
    fs-access.d.ts      типы File System Access API, отсутствующие в lib.dom
  world/
    world.ts            сцена, свет, пол/сетка/звёзды, управление, витрина
    conductor.ts        аватар проводника и его поведение
    viz-builder.ts      спека → three.js-геометрия с авто-масштабом
    text-sprite.ts      текстовые спрайты (подписи в мире)
  ui/
    setup-dialog.ts     стартовый диалог: модель + выбор файла базы
    chat.ts             чат с проводником
    gallery.ts          галерея сохранённых визуализаций
    hud.ts              статусы, кнопки, подсказки, тосты
    dom.ts              утилиты DOM
scripts/
  generate-icons.mjs    генератор PNG-иконок без зависимостей
  smoke.mjs             e2e-проверка через Chrome DevTools Protocol
```

## Схема базы

```sql
CREATE TABLE visualizations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',     -- исходный запрос пользователя
  spec TEXT NOT NULL,                  -- JSON: { title, description, parts[] }
  source TEXT NOT NULL DEFAULT 'nano', -- 'nano' | 'demo'
  created_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,                  -- 'user' | 'conductor'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

База — обычный `.sqlite`-файл: его можно открыть `sqlite3` или DB Browser и посмотреть
`SELECT * FROM visualizations`.

## Как это работает

1. Старт: создаётся three.js-сцена (пустая площадка + проводник), проверяется
   `LanguageModel.availability()`, читается запомненный хэндл файла базы.
2. Диалог: скачать модель (по кнопке — Chrome требует жест пользователя) или демо-режим;
   создать/открыть файл базы. Кнопка «Войти в мир» активна, когда база открыта.
3. Запрос: пользователь пишет задачу → `NanoBrain.chat()` делает первый запрос
   (план), при `action = "visualize"` — второй запрос со JSON-схемой модели.
4. Результат: спека нормализуется → `buildModel()` собирает геометрию → модель
   появляется перед игроком → `db.insert()` + запись файла.
5. Повторный запуск: база читается из файла, модели раскладываются по кольцу.

## Ограничения

- Gemini Nano работает только в десктопном Chrome/Edge с включённым Prompt API;
  скачивание модели требует сети и места на диске.
- Скачивание модели и выбор файла требуют пользовательского жеста — оба действия
  вызываются только по нажатию кнопок.
- Пока файл базы открыт, приложение переписывает его целиком (несколько КБ на
  модель); одновременное редактирование файла в другой программе не поддерживается.
- Мобильные браузеры не поддерживают Gemini Nano: там доступен демо-режим (и
  управление мышью/клавиатурой ограничено).

## Если в консоли что-то пишется

Все сообщения, которые приложение может оставить в DevTools, и что они значат:

| Сообщение | Причина |
| --- | --- |
| `The model was available but there was not an execution config available for the feature` | Сообщение самого Chrome: модель ещё не готова к запуску на этом профиле (нет загруженной модели/фиче-конфига). Приложение в этом случае показывает «недоступна» и инструкцию по включению. |
| `No output language was specified in a LanguageModel API request` | Было в старых сборках без языковой конфигурации. Сейчас приложение всегда передаёт `expectedInputs`/`expectedOutputs` с `languages` (Chrome требует только поддерживаемые: `de/en/es/fr/ja`, поэтому русский браузер автоматически конфигурируется как `en`, а ответы всё равно просим на языке пользователя). |
| `Unsupported LanguageModel API languages were specified` | Так писал предыдущий вариант кода, который пробовал `['ru','en']` одним списком. Chrome прерывает такой запрос, теперь языки пробуются по одному. |
| `THREE.WebGLShadowMap: PCFSoftShadowMap has been removed` | Исправлено: three 0.187 удалил этот режим, используется `PCFShadowMap`. |
| `Unable to use Pointer Lock API` / `WrongDocumentError` | Захват мыши невозможен (headless-браузер, iframe без разрешения). В обычном окне Chrome работает; приложение показывает подсказку. |
| Кнопки «Скачать модель» нет, бейдж «недоступна» | Chrome вернул `availability() === "unavailable"`, то есть скачивать нечего: модель не разрешена на этом устройстве/профиле. Кнопка показывается только при `downloadable`/`downloading`. |
| `Не удалось запустить модель: Chrome не может запустить встроенную модель…` | `LanguageModel.create()` бросил `NotSupportedError`: не включены флаги Prompt API или модель не скачана. Шаги — ниже. |

Если модель не включается:

1. `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**.
2. `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**.
3. Перезапустить Chrome.
4. `chrome://components` → «Optimization Guide On Device Model» → **Check for update**.
5. В приложении нажать «Проверить снова».
