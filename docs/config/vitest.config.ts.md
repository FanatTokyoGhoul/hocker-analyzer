# `vitest.config.ts`

Юнит-тесты: файлы `src/**/*.test.ts`, окружение `node` (без DOM). Тестируются только чистые модули: `lib/*`, `main/probe.ts`, `main/media.ts` (`parseRange`), `shared/project.ts`. Поведение в окне проверяет e2e ([smoke.mjs](../tests/e2e/smoke.mjs.md)).
