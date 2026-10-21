# `package.json`

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | electron-vite в режиме разработки: Vite-сервер с HMR для рендерера и перезапуск main при изменениях |
| `npm run build` | `typecheck`, затем сборка в `out/` (`main`, `preload`, `renderer`) |
| `npm run preview` | Запуск собранного `out/` без упаковки |
| `npm run typecheck` | `tsc --noEmit` отдельно для node-части и для web-части |
| `npm test` | Юнит-тесты vitest |
| `npm run test:e2e -- <h264.mp4> [hevc.mp4]` | Сборка и сквозной прогон приложения (см. [smoke.mjs](../tests/e2e/smoke.mjs.md)) |
| `npm run dist` / `dist:linux` / `dist:win` / `dist:mac` | Сборка и упаковка electron-builder в `dist/` |

## Зависимости

- **`dependencies`** — только `ffmpeg-static` и `ffprobe-static`. Это бинарники, которые запускаются во время работы, поэтому они должны попасть в пакет.
- **Всё остальное — `devDependencies`**, включая React и konva: Vite собирает их в бандл рендерера, а electron-builder не тащит лишнее в `node_modules` пакета.
- `typescript ~5.9` закреплён намеренно: TypeScript 7 (нативный) вышел недавно, а тулчейн рассчитан на 5.x.
- `playwright-core` — только для e2e: управляет Electron и не скачивает браузеры.

## Метаданные

- `main: ./out/main/index.js` — точка входа Electron.
- `author` с email и `homepage` нужны electron-builder для `.deb`. **`homepage` сейчас заглушка** — замените на настоящий адрес.
