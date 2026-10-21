# `src/renderer/src/hooks/useFullscreen.ts`

`const [active, toggle] = useFullscreen(element)` — полноэкранный режим для одного элемента через Fullscreen API Chromium.

- `toggle()`: если что-то уже в полном экране — выйти, иначе `element.requestFullscreen()`.
- `active` обновляется по событию `fullscreenchange`, поэтому учитывается и выход по `Esc`, который обрабатывает сам браузер.

В [App](../App.tsx.md) в полный экран уходит секция `.viewer`: видео, рисунки, меню рисования, таймлайн и транспорт. Панель моментов и тулбар остаются за кадром.
