# `src/preload/index.ts` — мост между рендерером и main

**Назначение:** через `contextBridge` выставляет в окно объект `window.api` типа `HockeyApi` ([types.ts](../shared/types.ts.md)). Это единственный способ для рендерера обратиться к ОС.

Скрипт работает в sandbox: доступны только модули `electron` (`contextBridge`, `ipcRenderer`, `webUtils`), Node недоступен.

## Методы `window.api`

| Метод | IPC |
|---|---|
| `openVideoDialog()` / `addVideoDialog()` | `invoke video:open-dialog` / `video:add-dialog` |
| `probeVideo(path)` | `invoke video:probe` |
| `registerDroppedFile(file)` | Путь берётся через `webUtils.getPathForFile(file)` → `invoke video:register-dropped` |
| `convertVideo(path)` / `cancelConvert()` | `video:convert` / `video:cancel-convert` |
| `onConvertProgress(cb)` | Подписка на `video:convert-progress`. Возвращает функцию отписки |
| `openProjectDialog()` / `saveProject(path, project)` | `project:open-dialog` / `project:save` |
| `writeRecovery(recovery \| null)` | `send recovery:write` (без ответа) |
| `readRecovery()` | `invoke recovery:read` |
| `exportClips(request)` / `cancelExport()` | `export:clips` / `export:cancel` |
| `onExportProgress(cb)` | Подписка на `export:progress`, отписка как у конвертации |
| `saveTextFile(name, content, ext)` | `invoke file:save-text` — CSV |
| `revealFile(path)` | `invoke file:reveal` |
| `confirm(message, detail?)` | `dialog:confirm` |
| `setDirty(flag)` / `setTitle(title)` | `send window:set-dirty` / `window:set-title` (без ответа) |
| `loadSettings()` | `sendSync settings:load` — синхронно, один раз при запуске |
| `saveSettings(settings)` / `revealSettings()` | `send settings:save` / `invoke settings:reveal` |

Сам `ipcRenderer` наружу не выставляется: рендерер не может слать в произвольные каналы.

Сборка: electron-vite → `out/preload/index.js` (CommonJS). Путь задан в [index.ts](../main/index.ts.md).
