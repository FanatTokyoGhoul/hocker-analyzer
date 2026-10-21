# `src/main/ffmpeg.ts` — запуск ffprobe и ffmpeg

**Назначение:** обёртка над бинарниками из пакетов `ffmpeg-static` и `ffprobe-static`. Аргументы командной строки и разбор вывода вынесены в чистый модуль [probe.ts](probe.ts.md).

## Экспорт

| Константа | Описание |
|---|---|
| `FFMPEG` | Путь к ffmpeg с учётом распаковки из asar. Его использует [export.ts](export.ts.md) для рендера клипов |


| Функция | Описание |
|---|---|
| `probe(path)` | `ffprobe -show_streams -show_format` в JSON → `summarizeProbe`. Возвращает fps, длительность, размер, кодеки, флаги `needsConversion` и `variableFrameRate` |
| `convertedPathFor(input)` | `match.mov` → `match.h264.mp4` рядом с исходником. Если такой файл уже есть — `match.h264-2.mp4`, `-3`… Существующие файлы никогда не перезаписываются |
| `convert(input, output, duration, fps, onProgress)` | Запускает ffmpeg с `ffmpegConvertArgs`, читает `-progress pipe:1` и вызывает `onProgress(ratio, outTime)`. Одновременно идёт только одна конвертация |
| `cancelConvert()` | `SIGKILL` текущему процессу. Удаление недописанного файла — в [index.ts](index.ts.md) |

## Пути к бинарникам в собранном приложении

`ffmpeg-static` и `ffprobe-static` вычисляют путь от своего `__dirname`, а он внутри `app.asar`. Запускать файлы изнутри asar нельзя, поэтому `electron-builder.yml` распаковывает их (`asarUnpack`), а функция `unpacked()` заменяет `app.asar/` на `app.asar.unpacked/` (оба вида слэшей).

## Безопасность

- `execFile` и `spawn` запускаются без shell, поэтому имя файла не может стать командой.
- Перед `-i` передаётся `INPUT_WHITELIST`: только протокол `file` и обычные контейнеры. Так подсунутый «плейлист под видом mp4» (HLS/concat) не подтянет содержимое других файлов.

## На что обратить внимание

`ffmpeg-static` при `npm install` скачивает бинарник под текущую ОС. Поэтому `.exe` нужно собирать на Windows, `.dmg` на macOS (см. [ci-build.md](../../config/github-workflows-build.yml.md)).
