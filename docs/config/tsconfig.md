# `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`

Код разделён на две части с разными окружениями. Каждая проверяется своим конфигом (`npm run typecheck`).

| Файл | Что проверяет | Окружение |
|---|---|---|
| `tsconfig.json` | Ничего сам; ссылается на два других (для IDE) | — |
| `tsconfig.node.json` | `src/main`, `src/preload`, `src/shared`, конфиги Vite и vitest | `types: ["node"]`, без DOM |
| `tsconfig.web.json` | `src/renderer/src`, `src/shared`, `src/preload/*.d.ts` | DOM, `jsx: react-jsx`, алиас `@renderer/*` |

Общее: `strict`, `noUnusedLocals`, `noUnusedParameters`, `moduleResolution: Bundler`, `target: ES2022`.

Благодаря разделению случайный `import 'fs'` в рендерере или обращение к `document` в main ловятся на этапе проверки типов. `src/shared` входит в оба конфига, поэтому должен работать в обоих окружениях.
