# `src/main/settings.ts` — профиль приложения и `settings.json`

## Где лежат данные

`applyAuthorProfileDir()` (вызывается в [index.ts](index.ts.md) до `app.whenReady()`) переносит профиль приложения в папку с тегом автора `ftg`:

| ОС | Профиль | Настройки |
|---|---|---|
| Linux | `~/.config/ftg/hockey-analyzer/` | `…/settings.json` |
| Windows | `%APPDATA%\ftg\hockey-analyzer\` | `…\settings.json` |
| macOS | `~/Library/Application Support/ftg/hockey-analyzer/` | `…/settings.json` |

Папка одна для `npm run dev`, собранной и установленной версии. Если запуск идёт с ключом `--user-data-dir=…` (так делает e2e-тест), используется он.

В профиле лежат и служебные данные Chromium (кэш, GPU-кэш). Проекты там не хранятся, они сохраняются туда, куда укажет пользователь.

## Формат файла

```json
{
  "version": 1,
  "stepMs": 100,
  "holdMode": "timer",
  "holdSeconds": 3,
  "holdScope": "always",
  "color": "#ff3b30",
  "recentColors": [],
  "quickTags": [
    { "id": "q-goal", "label": "Гол", "tag": "гол", "before": 8, "after": 3 }
  ]
}
```

Поля описаны в [shared/settings.ts](../shared/settings.ts.md). Массив `quickTags` показан сокращённо: в файле все шесть стандартных кнопок или те, что задал пользователь. `version` нужен для будущих миграций формата. Файл можно править руками при закрытом приложении: неверные значения при чтении заменятся умолчаниями.

## API

| Функция | Описание |
|---|---|
| `applyAuthorProfileDir()` | Перенос профиля в `appData/ftg/hockey-analyzer` (если нет `--user-data-dir`) |
| `settingsPath()` | Полный путь к `settings.json` |
| `loadSettings()` | **Синхронное** чтение и `sanitizeSettings`; результат кэшируется. Если в файле не JSON, он переименовывается в `settings.json.bak`, и используются умолчания |
| `saveSettings(raw)` | Проверяет данные от рендерера (`sanitizeSettings`), обновляет кэш и пишет файл через 300 мс после последнего изменения: пипетка цвета шлёт изменения десятками в секунду. Записи идут строго по очереди, файл заменяется атомарно (`.tmp` + `rename`) |
| `flushSettings()` | Синхронно дописывает отложенное сохранение. Вызывается на `before-quit` и `window-all-closed`, чтобы последнее изменение не потерялось |

## IPC (в [index.ts](index.ts.md))

| Канал | Тип | Описание |
|---|---|---|
| `settings:load` | `sendSync` | `{ settings, path }`. Синхронно, потому что рендереру настройки нужны до первой отрисовки |
| `settings:save` | `send` | Новые настройки целиком |
| `settings:reveal` | `invoke` | Показать файл в файловом менеджере. Путь фиксированный, от рендерера не приходит |

Рендерер не может записать в файл ничего, кроме проверенных настроек: лишние поля и неверные значения отбрасываются в main.

Тесты — [settings.test.ts](settings.test.ts.md).
