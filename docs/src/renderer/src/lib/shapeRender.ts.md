# `src/renderer/src/lib/shapeRender.ts` — отрисовка фигур (экран и экспорт)

**Назначение:** один код рисования фигур и для экрана, и для экспорта. Что видно на экране, то попадает в видео. Отсюда же строятся PNG для [export.ts](../../../main/export.ts.md).

## Толщины и размеры

| Функция | Формула | Зачем |
|---|---|---|
| `strokeFor(h)` | `max(2, h / 180)` | Толщина линии зависит от высоты кадра. На экране и в 4K выглядит одинаково |
| `textSizeFor(h)` | `max(12, h / 24)` | Размер подписи |
| `SPOTLIGHT_DIM` | `rgba(0, 0, 0, 0.6)` | Затемнение вокруг подсветки игрока |

## Функции

| Функция | Описание |
|---|---|
| `createShapeNode(s, w, h, opts)` | Konva-узел одной фигуры (`Konva.Shape` или `Konva.Group` для подписи). `draft` у незамкнутой зоны — пунктир. Пунктир пасов — `dash`. Текст — `Konva.Label` |
| `buildSpotlightDim(spots, w, h)` | Полупрозрачный прямоугольник с «дырками» из эллипсов (`destination-out`) |
| `fillDim(dim, shapes, w, h)` | Перерисовывает слой затемнения: все подсветки из списка |
| `fillMain(main, shapes, w, h, draftId?)` | Перерисовывает слой фигур (без подсветок) |
| `fillLayers(dim, main, shapes, w, h)` | `fillDim` и `fillMain` вместе, для экспорта |
| `renderShapesPng(shapes, w, h, background?)` | PNG рисунка в заданном размере. По умолчанию фон прозрачный (поверх кадра). `'rink'` — непрозрачная разметка площадки |
| `renderBoardPng(shapes, w, h)` | PNG схемы площадки: площадка по центру с полями 8%, тёмный фон |
| `renderCaptionPng(title, subtitle, w, h)` | PNG подписи (название крупно, теги и заметка мельче) в левом нижнем углу, на тёмной плашке. Длинный текст обрезается многоточием до 70% ширины |
| `withAlpha(hex, a)` | `#rrggbb` → `rgba()`, для заливки зон (прозрачность 0.28) |

Offscreen-рисование: `Konva.Stage` создаётся в элементе вне DOM и уничтожается в `finally`. Подпись рисуется через `canvas` 2D.

Экран ([DrawingLayer](../components/DrawingLayer.tsx.md)) использует `fillDim` и `fillMain` по отдельности: так готовые фигуры не перерисовываются при движении курсора.

## Связи

- [rink.ts](rink.ts.md) — разметка площадки для `'rink'` и схемы.
- [geometry.ts](geometry.ts.md) — `fitContain` для схемы в кадре.
- Используется [DrawingLayer](../components/DrawingLayer.tsx.md), [exportRequest.ts](exportRequest.ts.md).
