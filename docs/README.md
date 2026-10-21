# Документация Hockey Analyzer

Здесь описан каждый файл проекта. Структура `docs/` повторяет структуру репозитория: документ для `src/main/index.ts` лежит в `docs/src/main/index.ts.md`. Как запускать и что умеет приложение — в [README проекта](../README.md).

## Архитектура

```
┌──────────────────────── renderer (Chromium, sandbox) ────────────────────────────┐
│ App.tsx ── useReducer(projectReducer) ── проект + история (undo/redo, dirty)       │
│   ├─ useVideoClock ── requestVideoFrameCallback ── локальное время/пауза           │
│   ├─ время проекта = локальное + offset активного видео (videos.ts)                │
│   ├─ usePlaylist ── decidePlaylistStep ── «проиграть все» через несколько видео    │
│   ├─ useDrawingStops(drawingTimes активного видео) ── пауза на рисунках           │
│   ├─ useSettings ── window.api ── settings.json (шаг, остановки, quickTags)        │
│   ├─ useHotkeys ── клавиши по e.code                                              │
│   ├─ черновик ── 3 с после правки ── window.api.writeRecovery                      │
│   ├─ exportRequest ── shapeRender (Konva offscreen → PNG) ── window.api.exportClips│
│   └─ VideoBar, VideoStage(<video src="media://…"> + DrawingLayer + DrawMenu),      │
│      Timeline, Transport, MomentsPanel(QuickTagsBar), диалоги через Modal          │
└───────────────┬───────────────────────────────────────────────▲──────────────────┘
                │ window.api (preload, contextBridge)            │ media://
┌───────────────▼─────────────────────── main (Node) ────────────┴──────────────────┐
│ index.ts ── IPC, диалоги, allowedMedia / trustedProjectPaths / revealablePaths     │
│   ├─ media.ts ── протокол media:// с Range                                        │
│   ├─ ffmpeg.ts ── ffprobe (fps, кодеки), ffmpeg (→ H.264, -g 10, CFR), FFMPEG      │
│   ├─ exportIpc.ts ── export:clips, диалог файла/папки                             │
│   │    └─ export.ts ── PNG → temp → ffmpeg по клипу → concat -c copy (подборка)    │
│   │         └─ exportPlan.ts ── планирование кусков и фильтр-граф (чистый)         │
│   ├─ recovery.ts ── profile/recovery.json (атомарно, по очереди)                  │
│   ├─ settings.ts ── ~/.config/ftg/hockey-analyzer/settings.json                   │
│   └─ shared/project.ts ── проверка JSON проекта (v1 и v2)                         │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Поток данных.** Пользователь открывает видео. Main проверяет файл через ffprobe, разрешает его в `allowedMedia` и возвращает `VideoInfo` с адресом `media://`. Рендерер показывает видео. Моменты и рисунки живут во **времени проекта**: локальное время видео — это время проекта минус `offset` видео. Так в одном проекте могут быть периоды подряд и несколько камер. Все правки идут через `projectReducer`, который хранит историю (до 200 шагов). Через 3 с после правки черновик уходит в main и пишется в `recovery.json`. При сохранении main проверяет JSON (`parseProject`) и пишет атомарно, а черновик удаляет.

**Экспорт.** Рендерер рисует PNG рисунков, подписей и схем тем же кодом Konva, что и на экране, и присылает их в main. Main запускает ffmpeg: каждый клип превращается в временный mp4 (стоп-кадры рисунков, схема, подпись), а подборка склеивается concat-демультиплексором без перекодирования. Прогресс и отмена идут по IPC.

## Оглавление

### Main-процесс

- [src/main/index.ts](src/main/index.ts.md) — окно, IPC, безопасность путей, проекты и черновики
- [src/main/media.ts](src/main/media.ts.md) — протокол `media://`, Range
- [src/main/ffmpeg.ts](src/main/ffmpeg.ts.md) — запуск ffprobe/ffmpeg, путь `FFMPEG` для экспорта
- [src/main/probe.ts](src/main/probe.ts.md) — разбор ffprobe, нужна ли конвертация, аргументы ffmpeg
- [src/main/probe.test.ts](src/main/probe.test.ts.md)
- [src/main/settings.ts](src/main/settings.ts.md) — профиль `ftg/hockey-analyzer` и `settings.json` ([тесты](src/main/settings.test.ts.md))
- [src/main/recovery.ts](src/main/recovery.ts.md) — черновик для восстановления после сбоя
- [src/main/exportIpc.ts](src/main/exportIpc.ts.md) — IPC экспорта и диалоги файла или папки
- [src/main/export.ts](src/main/export.ts.md) — рендер клипов через ffmpeg, отмена, проверка запроса
- [src/main/exportPlan.ts](src/main/exportPlan.ts.md) — куски клипа, фильтр-граф, имена файлов ([тесты](src/main/exportPlan.test.ts.md))

### Preload

- [src/preload/index.ts](src/preload/index.ts.md) — `window.api`
- [src/preload/index.d.ts](src/preload/index.d.ts.md)

### Общее

- [src/shared/types.ts](src/shared/types.ts.md) — модель проекта (v2), фигуры, экспорт, контракт IPC
- [src/shared/project.ts](src/shared/project.ts.md) — проверка и сериализация JSON, миграция v1 → v2 ([тесты](src/shared/project.test.ts.md))
- [src/shared/settings.ts](src/shared/settings.ts.md) — тип настроек, умолчания, кнопки быстрой разметки, цвета ([тесты](src/shared/settings.test.ts.md))

### Renderer

- [src/renderer/index.html](src/renderer/index.html.md) — оболочка и CSP
- [src/renderer/src/main.tsx](src/renderer/src/main.tsx.md)
- [src/renderer/src/App.tsx](src/renderer/src/App.tsx.md) — корневой компонент, сценарии, горячие клавиши
- [src/renderer/src/styles.css](src/renderer/src/styles.css.md)
- Логика (`lib/`):
  - [time.ts](src/renderer/src/lib/time.ts.md) — кадры, шаги, формат времени ([тесты](src/renderer/src/lib/time.test.ts.md))
  - [projectState.ts](src/renderer/src/lib/projectState.ts.md) — редьюсер проекта с историей ([тесты](src/renderer/src/lib/projectState.test.ts.md))
  - [playlist.ts](src/renderer/src/lib/playlist.ts.md) — решение для «проиграть все» ([тесты](src/renderer/src/lib/playlist.test.ts.md))
  - [drawingStops.ts](src/renderer/src/lib/drawingStops.ts.md) — где останавливаться на рисунках ([тесты](src/renderer/src/lib/drawingStops.test.ts.md))
  - [geometry.ts](src/renderer/src/lib/geometry.ts.md) — вписывание кадра и зум ([тесты](src/renderer/src/lib/geometry.test.ts.md))
  - [shapeRender.ts](src/renderer/src/lib/shapeRender.ts.md) — отрисовка фигур на экране и в PNG для экспорта
  - [rink.ts](src/renderer/src/lib/rink.ts.md) — разметка хоккейной площадки
  - [videos.ts](src/renderer/src/lib/videos.ts.md) — несколько видео, время проекта и синхронизация ([тесты](src/renderer/src/lib/videos.test.ts.md))
  - [exportRequest.ts](src/renderer/src/lib/exportRequest.ts.md) — сборка запроса экспорта из моментов
  - [exportRequest.ts](src/renderer/src/lib/exportRequest.ts.md) — сборка запроса экспорта из моментов ([тесты](src/renderer/src/lib/exportRequest.test.ts.md))
  - [stats.ts](src/renderer/src/lib/stats.ts.md) — статистика по тегам и периодам, CSV ([тесты](src/renderer/src/lib/stats.test.ts.md))
  - [ids.ts](src/renderer/src/lib/ids.ts.md)
  - [paths.ts](src/renderer/src/lib/paths.ts.md) — имя файла из пути
- Хуки (`hooks/`):
  - [useVideoClock.ts](src/renderer/src/hooks/useVideoClock.ts.md)
  - [usePlaylist.ts](src/renderer/src/hooks/usePlaylist.ts.md) — «проиграть все» через видео проекта
  - [useDrawingStops.ts](src/renderer/src/hooks/useDrawingStops.ts.md) — остановка на кадрах с рисунками
  - [useSettings.ts](src/renderer/src/hooks/useSettings.ts.md)
  - [useFullscreen.ts](src/renderer/src/hooks/useFullscreen.ts.md)
  - [useIdle.ts](src/renderer/src/hooks/useIdle.ts.md)
  - [useHotkeys.ts](src/renderer/src/hooks/useHotkeys.ts.md)
- Компоненты (`components/`):
  - [VideoStage](src/renderer/src/components/VideoStage.tsx.md) — видео, зум, перетаскивание кадра
  - [VideoBar](src/renderer/src/components/VideoBar.tsx.md) — вкладки видео проекта
  - [VideosDialog](src/renderer/src/components/VideosDialog.tsx.md) — названия, сдвиги и синхронизация видео
  - [DrawingLayer](src/renderer/src/components/DrawingLayer.tsx.md) — рисование: стрелки, пасы, зоны, текст, подсветка
  - [DrawMenu](src/renderer/src/components/DrawMenu.tsx.md) — плавающее меню рисования, любой RGB-цвет
  - [BoardDialog](src/renderer/src/components/BoardDialog.tsx.md) — схема площадки момента
  - [HoldOverlay](src/renderer/src/components/HoldOverlay.tsx.md)
  - [SettingsDialog](src/renderer/src/components/SettingsDialog.tsx.md)
  - [QuickTagsBar](src/renderer/src/components/QuickTagsBar.tsx.md) — кнопки быстрой разметки
  - [ExportDialog](src/renderer/src/components/ExportDialog.tsx.md) — экспорт клипов
  - [StatsDialog](src/renderer/src/components/StatsDialog.tsx.md) — статистика и периоды
  - [Modal](src/renderer/src/components/Modal.tsx.md) — общее модальное окно
  - [Timeline](src/renderer/src/components/Timeline.tsx.md)
  - [Transport](src/renderer/src/components/Transport.tsx.md)
  - [MomentsPanel](src/renderer/src/components/MomentsPanel.tsx.md) — список моментов, заметки, схема
  - [Btn](src/renderer/src/components/Btn.tsx.md)
  - [CommitField](src/renderer/src/components/CommitField.tsx.md) — поле, которое применяет значение по Enter или потере фокуса
- Стили (`styles/`):
  - [stats.css](src/renderer/src/styles/stats.css.md) — окно статистики

### Тесты

- [tests/e2e/smoke.mjs](tests/e2e/smoke.mjs.md) — сквозной прогон приложения (сценарии 1–20)

### Конфигурация и сборка

- [package.json](config/package.json.md) — скрипты и зависимости
- [electron.vite.config.ts](config/electron.vite.config.ts.md)
- [tsconfig*.json](config/tsconfig.md)
- [vitest.config.ts](config/vitest.config.ts.md)
- [electron-builder.yml](config/electron-builder.yml.md) — упаковка, asarUnpack, фьюзы
- [.github/workflows/build.yml](config/github-workflows-build.yml.md) — CI для трёх ОС
- [.gitignore](config/gitignore.md)

## Идеи на будущее

- [docs/ideas/](ideas/README.md) — мобильный пульт и нейросеть для авторазбора (обсуждено, не реализовано)

## Как добавить…

- **…новую настройку:** поле и умолчание в `Settings` и `sanitizeSettings` ([shared/settings.ts](src/shared/settings.ts.md)), элемент в [SettingsDialog](src/renderer/src/components/SettingsDialog.tsx.md). Старые сохранённые настройки получат значение по умолчанию автоматически.
- **…новую горячую клавишу:** `switch (e.code)` в `useHotkeys(...)` внутри [App](src/renderer/src/App.tsx.md); строка в справочнике `KEYS` в [SettingsDialog](src/renderer/src/components/SettingsDialog.tsx.md) и в README проекта.
- **…новый IPC-вызов:** обработчик в [main/index.ts](src/main/index.ts.md) (или в [exportIpc.ts](src/main/exportIpc.ts.md) для экспорта), метод в `HockeyApi` ([types.ts](src/shared/types.ts.md)), проброс в [preload](src/preload/index.ts.md). Путь от рендерера проверяйте по `allowedMedia` / `trustedProjectPaths` / `revealablePaths`.
- **…новую фигуру:** тип в `Shape` ([types.ts](src/shared/types.ts.md)), разбор в `parseShape` ([project.ts](src/shared/project.ts.md)), отрисовка в `createShapeNode` ([shapeRender.ts](src/renderer/src/lib/shapeRender.ts.md)), рисование в [DrawingLayer](src/renderer/src/components/DrawingLayer.tsx.md), кнопка в `TOOLS` ([DrawMenu](src/renderer/src/components/DrawMenu.tsx.md)). Экспорт использует ту же отрисовку и отдельного кода не требует.
- **…поле в момент:** тип `Moment`, `parseMoment`, при необходимости действие в [projectState](src/renderer/src/lib/projectState.ts.md) и поле в `MomentRow` ([MomentsPanel](src/renderer/src/components/MomentsPanel.tsx.md)).
- **…новое видео или период:** модель `ProjectVideo` ([types.ts](src/shared/types.ts.md)), правила времени в [videos.ts](src/renderer/src/lib/videos.ts.md).
- **…новый диалог:** компонент на базе [Modal](src/renderer/src/components/Modal.tsx.md), вариант в типе `Dialog` и в `dialogs` в [App](src/renderer/src/App.tsx.md).
