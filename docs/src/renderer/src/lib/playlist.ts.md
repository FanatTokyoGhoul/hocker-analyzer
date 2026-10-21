# `src/renderer/src/lib/playlist.ts` — решение для «проиграть все»

Чистая функция, которая на каждом показанном кадре решает, что делать дальше. [usePlaylist](../hooks/usePlaylist.ts.md) только исполняет решение.

## `decidePlaylistStep(items, index, mediaTime, fps)`

| Результат | Когда |
|---|---|
| `{ kind: 'next', index, seek }` | Показанный кадр дошёл до `end − полкадра` текущего момента, и есть следующий; `seek` — его `start` |
| `{ kind: 'finish' }` | Закончился последний момент или список пуст |
| `{ kind: 'continue' }` | Всё остальное |

Остановки на рисунках здесь больше не обрабатываются. Это общий механизм, он работает и вне плейлиста: см. [drawingStops](drawingStops.ts.md) и [useDrawingStops](../hooks/useDrawingStops.ts.md).

Тесты — [playlist.test.ts](playlist.test.ts.md).
