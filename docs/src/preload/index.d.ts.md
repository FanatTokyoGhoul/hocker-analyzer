# `src/preload/index.d.ts` — тип `window.api`

Объявляет глобально `interface Window { api: HockeyApi }`, чтобы в рендерере `window.api.…` было типизировано.

Подключается в `tsconfig.web.json` (`include: src/preload/*.d.ts`). Сам интерфейс `HockeyApi` описан в [types.ts](../shared/types.ts.md).
