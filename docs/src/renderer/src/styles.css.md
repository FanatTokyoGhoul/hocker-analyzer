# `src/renderer/src/styles.css`

Все стили приложения, тёмная тема. Статистика вынесена в [styles/stats.css](styles/stats.css.md).

## Токены (`:root`)

| Группа | Переменные |
|---|---|
| Фоны | `--bg`, `--bg-2`, `--bg-3`, `--bg-4` |
| Линии | `--line`, `--line-2` |
| Текст | `--text`, `--muted` |
| Акцент | `--accent`, `--accent-2`, `--accent-soft` |
| Предупреждения | `--warn` (оранжевый: черновик, метки I/O, точки рисунков, остановка на рисунке, несохранённое), `--danger` |
| Прочее | `--glass` (полупрозрачная подложка плавающих элементов), `--radius`, шрифты `--font` и `--mono` |

## Блоки

- **Кнопки** `.btn` с модификаторами `-primary`, `-danger`, `-ghost`, `.is-active`, `.icon-btn`. `.segmented` — группа-переключатель (скорость, режимы в настройках, инструменты схемы).
- **Каркас:** `.toolbar` (бренд, файл, действия), `.workspace` = `.viewer` + `.panel` (340px), `.controls` под видео.
- **Видео:** `.stage`, `.stage-frame`, `.stage-zoom` (трансформация зума), `.zoom-badge`, `.drawing-layer` (ловит мышь только в режиме рисования), `.stage-hint`, `.stage-hint-top`, `.stage-hint-bottom`, `.banner`, `.banner-warn`.
- **Вкладки видео:** `.video-bar`, `.video-tabs` (обёртка с `role="tablist"`), `.video-tab` (`.is-active`, `.is-missing`), `.video-bar-actions`.
- **Меню рисования:** `.draw-menu`, `.fab`, `.draw-panel`, `.draw-tools`, `.tool-icon`, `.swatch`, `.picker`, `.hex-input`.
- **Остановка:** `.hold` — плашка-«таблетка» с полосой `.hold-progress`.
- **Текст на видео:** `.text-draft` — поле ввода подписи, размер и цвет задаются инлайново.
- **Подпись момента** при воспроизведении: `.moment-caption`.
- **Таймлайн:** `.timeline-lane` (блоки моментов) и `.timeline-scrub` (дорожка, сыгранная часть, указатель).
- **Полный экран:** `.viewer.is-fullscreen .controls` — поверх видео с градиентом; `.viewer.is-idle` скрывает панели, ✎-кнопку и курсор.
- **Моменты:** компактные `.moment` с `.moment-meta`, `.moment-notes`, `.chip`, `.badge`. Кнопки `.moment-actions` видны при наведении, `.moment-edit` — режим правки, `.moment-tags` и `.moment-notes-input` — поля правки (класс `.moment-notes-input` ставится полю заметки в [MomentsPanel](components/MomentsPanel.tsx.md)).
- **Быстрая разметка:** `.quick`, `.quick-grid`, `.quick-btn` (с `kbd` для `⇧N`), `.quick-edit` в настройках.
- **Модальные окна:** `.modal-backdrop`, `.modal`, `.modal-head`, `.modal-actions`. Размеры: `.videos-modal`, `.board-modal`, `.export-modal`, `.stats-modal` (в stats.css).
- **Видео проекта:** `.videos-list`, `.videos-row` (`.is-active`), `.sync-steps`.
- **Схема площадки:** `.board-toolbar`, `.board-canvas`, `.board-frame`, `.board-actions`.
- **Экспорт:** `.export-choices`, `.setting.checkbox`, `.export-run`, `.export-progress`, `.export-result`, `.export-error`.
- **Настройки:** `.settings-section`, `.setting`, `.setting-input`, `.keymap`, `.settings-path`.

Время набрано моноширинным шрифтом с `tabular-nums`, поэтому цифры не «прыгают». `user-select: none` везде, кроме полей ввода.
