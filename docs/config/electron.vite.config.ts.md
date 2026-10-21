# `electron.vite.config.ts`

Конфиг electron-vite: три сборки в одном файле.

- **`main`, `preload`** — настройки по умолчанию. electron-vite сам выносит зависимости из `package.json` во внешние (`require` во время работы), поэтому `ffmpeg-static` вычисляет свой путь от реального расположения в `node_modules`. Результат — CommonJS в `out/main` и `out/preload`.
- **`renderer`** — плагин `@vitejs/plugin-react` и алиас `@renderer` → `src/renderer/src`. Корень — `src/renderer` (`index.html`), результат — `out/renderer`.
