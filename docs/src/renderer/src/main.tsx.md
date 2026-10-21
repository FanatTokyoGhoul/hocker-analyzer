# `src/renderer/src/main.tsx`

Точка входа рендерера: подключает `styles.css` и монтирует `<App />` в `#root` внутри `StrictMode`.

`StrictMode` в dev-режиме дважды запускает эффекты, и это помогает ловить незакрытые подписки. Поэтому у всех хуков (`useVideoClock`, `usePlaylist`, `useHotkeys`) есть корректный cleanup.
