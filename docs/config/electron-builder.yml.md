# `electron-builder.yml` — упаковка

| Платформа | Цель |
|---|---|
| Windows | NSIS-установщик `.exe` (можно выбрать папку установки) |
| macOS | `.dmg`, категория «Спорт» |
| Linux | `.AppImage` и `.deb`, категория Video |

## Важное

- **`files`** — в пакет попадают только `out/**` и `package.json`. Из `node_modules` вычищаются README, тесты и `.d.ts`.
- **`asarUnpack`** для `ffmpeg-static` и `ffprobe-static`: бинарники нельзя запускать изнутри `app.asar`, поэтому они распаковываются в `app.asar.unpacked` (подмена пути — в [ffmpeg.ts](../src/main/ffmpeg.ts.md)).
- **Платформенные `files`** исключают из пакета чужие бинарники ffprobe: `ffprobe-static` содержит их сразу для всех ОС.
- **`electronFuses`** — защитные флаги в самом бинарнике Electron:
  - `runAsNode: false` — приложение нельзя запустить как обычный node (`ELECTRON_RUN_AS_NODE`);
  - отключены `NODE_OPTIONS` и `--inspect` из командной строки;
  - проверка целостности asar и загрузка приложения только из asar.

  Следствие: e2e через Playwright к упакованной сборке не подключится, потому что ему нужен `--inspect`. Тестируйте `npm run test:e2e` на `out/`.
- Иконки нет (`resources/` пустая), используется стандартная иконка Electron. Чтобы задать свою, положите `resources/icon.png` (512×512) и, для mac/win, `icon.icns` / `icon.ico`.

**Собирать каждую платформу нужно на ней самой:** `ffmpeg-static` скачивает бинарник под ОС, на которой выполнялся `npm install`.
