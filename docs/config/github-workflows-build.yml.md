# `.github/workflows/build.yml` — CI-сборка для трёх ОС

Запускается по тегу `v*` (например, `git tag v0.1.0 && git push --tags`) или вручную (workflow_dispatch).

Матрица `ubuntu-latest`, `windows-latest`, `macos-latest`. На каждой ОС: `npm ci` (ffmpeg скачивается под эту ОС), `npm test`, `npm run dist -- --publish never`, затем загрузка `.exe` / `.dmg` / `.AppImage` / `.deb` как артефактов запуска.

`CSC_IDENTITY_AUTO_DISCOVERY=false` отключает подпись кода: сертификатов пока нет. На macOS неподписанный `.dmg` придётся открывать через «Открыть» в контекстном меню, на Windows SmartScreen покажет предупреждение.
