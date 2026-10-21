# `src/main/probe.ts` — разбор вывода ffprobe/ffmpeg и аргументы конвертации

**Назначение:** чистые функции без зависимостей от Electron и файловой системы, чтобы их можно было тестировать.

## Экспорт

| Имя | Описание |
|---|---|
| `ProbeStream`, `ProbeJson` | Подмножество JSON-ответа ffprobe, которое нам нужно |
| `ProbeSummary` | Итог: `fps`, `duration`, `width`, `height`, `videoCodec`, `audioCodec`, `needsConversion`, `conversionReason`, `variableFrameRate` |
| `parseFrameRate('30000/1001')` | → `29.97`. `null` для `0/0`, мусора и значений > 1000 |
| `summarizeProbe(json)` | Находит видео- и аудиопоток и решает, нужна ли конвертация. Без видеопотока бросает ошибку |
| `parseProgressTime(chunk)` | Достаёт последнее `out_time_us=` / `out_time_ms=` из блока `-progress` (оба поля у ffmpeg в микросекундах) → секунды |
| `INPUT_WHITELIST` | `-protocol_whitelist file -format_whitelist mov,mp4,…,mpegts` |
| `ffmpegConvertArgs(in, out, fps)` | Аргументы конвертации (см. ниже) |

## Когда нужна конвертация (`needsConversion`)

- Видеокодек не из `h264 / vp8 / vp9 / av1`, например HEVC.
- H.264 с профилем 10 bit / 4:2:2 / 4:4:4: Chromium их не декодирует.
- Аудиокодек вне списка `PLAYABLE_AUDIO` (например, AC-3).

## Переменная частота кадров (`variableFrameRate`)

Ставится, если `avg_frame_rate` отличается от `r_frame_rate` больше чем на 0.2%. Типичный пример — видео с телефона (29.926 против 30). У CFR-файлов эти значения совпадают точно. Порог подобран на реальном телефонном видео: 1% был слишком грубым.

## Параметры конвертации

`libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -fps_mode cfr -r <fps> -g 10 -keyint_min 10 -sc_threshold 0 -c:a aac -b:a 160k -movflags +faststart`

- `-g 10` (и отключённые «внеплановые» ключевые кадры) — ключевой кадр каждые 10 кадров. Перемотка и покадровый шаг становятся точными и быстрыми, как просили в брифе.
- `-fps_mode cfr -r` — постоянная частота кадров, чтобы шаг `1/fps` всегда был ровно одним кадром.
- `+faststart` — индекс в начале файла, видео открывается сразу.

## Тесты

[probe.test.ts](probe.test.ts.md).
