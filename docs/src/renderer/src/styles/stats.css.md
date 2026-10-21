# `src/renderer/src/styles/stats.css` — окно статистики

Стили окна статистики. Импортируются в [StatsDialog](../components/StatsDialog.tsx.md), поэтому попадают в сборку вместе с ним. Общие стили окон (`.modal`, `.settings-section`) — в [styles.css](../styles.css.md).

| Селектор | Что оформляет |
|---|---|
| `.stats-modal` | Ширина окна: до 720 px с отступами по краям |
| `.stats-period` | Строка периода: подпись, поле времени, кнопки «= сейчас» и ✕ |
| `.stats-table` | Таблица по тегам: моноширинные цифры, выравнивание вправо, первая колонка — влево |
| `.stats-table .stats-total`, `.stats-table .stats-none` | Строки «Всего» и «без тега» |
| `.stats-actions` | Кнопки выгрузки в CSV |
