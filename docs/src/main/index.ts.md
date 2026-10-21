# `src/main/index.ts` — главный процесс Electron

**Назначение:** точка входа приложения. Создаёт окно, регистрирует протокол `media://`, обрабатывает IPC-запросы рендерера и решает, какие файлы можно открывать.

## Что здесь происходит

0. **`applyAuthorProfileDir()`** — профиль приложения в папке `ftg/hockey-analyzer` (см. [settings.ts](settings.ts.md)).
1. **Регистрация схемы `media://`** (`protocol.registerSchemesAsPrivileged`) до `app.whenReady()`. Флаги `stream` и `supportFetchAPI` позволяют `<video>` читать файл частями.
2. **`createWindow()`**: окно 1440×900, `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
   - При закрытии с несохранёнными изменениями (`dirty`) показывается синхронный диалог «Выйти без сохранения / Отмена». Если пользователь выбрал «Выйти без сохранения», черновик удаляется (`clearRecoverySync`). Иначе окно не закрывается, черновик остаётся.
   - Навигация окна запрещена (`will-navigate`). Внешние `http(s)`-ссылки открываются в системном браузере.
   - В dev-режиме загружается `ELECTRON_RENDERER_URL`, в собранном приложении — `out/renderer/index.html`.
3. **`registerIpc()`** — все каналы, которые вызывает preload:

| Канал | Что делает |
|---|---|
| `video:open-dialog` | Диалог выбора видео «Открыть видео матча» → `describeVideo` |
| `video:add-dialog` | То же, но «Добавить видео в проект» — для периодов и ракурсов |
| `video:register-dropped` | Путь файла, перетащенного в окно. Принимается, только если `isSafeVideoPath` |
| `video:probe` | Повторный ffprobe уже разрешённого файла |
| `video:convert` / `video:cancel-convert` | Конвертация в H.264 с прогрессом в `video:convert-progress`; недописанный файл удаляется |
| `project:open-dialog` | Выбрать JSON → `parseProject`. Видео ищутся по пути и рядом с JSON (`locateVideos`); ненайденные id возвращаются в `missingVideos` |
| `project:save` | Атомарная запись `.tmp` + `rename`. Без диалога пишет только по доверенному пути. После успешной записи удаляет черновик |
| `recovery:write` | Записывает черновик (см. [recovery.ts](recovery.ts.md)). JSON длиннее 50 МБ отклоняется. Путь проекта сохраняется, только если доверенный |
| `recovery:read` | Читает черновик и ищет его видео |
| `export:clips` / `export:cancel` | Регистрируются через `registerExportIpc` ([exportIpc.ts](exportIpc.ts.md)) |
| `file:save-text` | Сохранить текст (CSV) через диалог, UTF-8. Возвращает путь и добавляет его в «показываемые» |
| `file:reveal` | Показать в папке файл, который приложение само записало (CSV, экспорт) |
| `dialog:confirm` | Нативный диалог подтверждения → `true`/`false` |
| `window:set-dirty`, `window:set-title` | Флаг несохранённых изменений и заголовок окна |
| `settings:load` / `settings:save` / `settings:reveal` | Настройки в `settings.json` (см. [settings.ts](settings.ts.md)) |

4. **`protocol.handle('media')`** превращает URL в путь, проверяет его по `allowedMedia` и отдаёт через `serveFile` (см. [media.ts](media.ts.md)).

## Модель безопасности

- **`allowedMedia`** — пути, которые разрешено отдавать через `media://`: файлы из системного диалога, проверенные drag&drop, видео из проекта (после `locateVideos`), результат конвертации и видео, добавленные через `video:add-dialog`.
- **`trustedProjectPaths`** — пути проектов из диалогов. Если рендерер передаст чужой путь в `project:save`, вместо записи откроется диалог.
- **`revealablePaths`** — файлы, которые приложение записало само (CSV, экспорт). Только их можно показать в папке через `file:reveal`.
- **`isSafeVideoPath`** пропускает только локальный обычный файл с видеорасширением. **`isNetworkPath`** отсекает пути вида `\\host\…` и `//host/…`: иначе чужой проект на Windows мог бы заставить ОС обратиться к SMB-шаре и отдать NTLM-хэш.
- **`locateVideos`** для путей из чужого JSON не трогает сетевые и «не видео» пути. Пользователь сам указывает файл через баннер «Указать видео».

## Связи

- Использует [settings.ts](settings.ts.md), [ffmpeg.ts](ffmpeg.ts.md), [media.ts](media.ts.md), [recovery.ts](recovery.ts.md), [exportIpc.ts](exportIpc.ts.md), [shared/project.ts](../shared/project.ts.md), [shared/types.ts](../shared/types.ts.md).
- Вызывается из [preload/index.ts](../preload/index.ts.md).

## На что обратить внимание

- Новый IPC-канал добавляется в трёх местах: здесь, в `HockeyApi` ([types.ts](../shared/types.ts.md)) и в preload.
- Путь, пришедший из рендерера, нельзя использовать без проверки по `allowedMedia`, `trustedProjectPaths` или `revealablePaths`.
- `window-all-closed` отменяет конвертацию и экспорт, сбрасывает отложенные настройки.
