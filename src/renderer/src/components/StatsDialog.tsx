import { useMemo } from 'react'
import type { Moment, ProjectVideo } from '../../../shared/types'
import { formatTime, parseTime } from '../lib/time'
import { momentsCsv, normalizePeriods, statsCsv, tagStats } from '../lib/stats'
import { Btn } from './Btn'
import { CommitField } from './CommitField'
import { Modal } from './Modal'
import '../styles/stats.css'

type Props = {
  moments: Moment[]
  videos: ProjectVideo[]
  /** Текущие начала периодов (время проекта). */
  periods: number[]
  /** Текущее время проекта — для кнопок «= сейчас». */
  now: number
  onPeriodsChange(periods: number[]): void
  onSaveCsv(suggestedName: string, content: string): void
  onClose(): void
}

/** Начало периода: время больше нуля. */
const parsePeriod = (t: string): number | null => {
  const v = parseTime(t)
  return v !== null && v > 0 ? v : null
}

/** Статистика по тегам и периодам, выгрузка в CSV. */
export function StatsDialog({ moments, videos, periods, now, onPeriodsChange, onSaveCsv, onClose }: Props): React.JSX.Element {
  const rows = useMemo(() => tagStats(moments, periods), [moments, periods])
  const periodCount = normalizePeriods(periods).length + 1

  const setPeriod = (index: number, value: number): void =>
    onPeriodsChange(normalizePeriods(periods.map((p, i) => (i === index ? value : p))))
  const removePeriod = (index: number): void => onPeriodsChange(periods.filter((_, i) => i !== index))

  return (
    <Modal title="Статистика" onClose={onClose} className="stats-modal">
      <section className="settings-section">
        <h3>Периоды</h3>
        {periods.map((p, i) => (
          <div className="stats-period" key={i}>
            <span>Период {i + 2} начинается с</span>
            <CommitField
              className="time-input"
              value={p}
              format={formatTime}
              parse={parsePeriod}
              label={`Начало периода ${i + 2}`}
              onCommit={(v) => setPeriod(i, v)}
            />
            <Btn onClick={() => setPeriod(i, now)} disabled={!(now > 0)}>
              = сейчас
            </Btn>
            <Btn variant="ghost" onClick={() => removePeriod(i)} aria-label={`Удалить период ${i + 2}`}>
              ✕
            </Btn>
          </div>
        ))}
        <div>
          <Btn onClick={() => onPeriodsChange(normalizePeriods([...periods, now]))} disabled={!(now > 0) || periods.includes(now)}>
            + Период
          </Btn>
        </div>
        <p className="muted small">
          Периоды делят статистику по времени проекта: момент относится к периоду, в котором он начался. Новый период добавляется в текущее
          время — потом его можно поправить.
        </p>
      </section>

      <section className="settings-section">
        <h3>По тегам</h3>
        {moments.length === 0 ? (
          <p className="muted small">Моментов пока нет — отметьте их на видео, и здесь появится статистика.</p>
        ) : (
          <table className="stats-table">
            <thead>
              <tr>
                <th>Тег</th>
                <th>Всего</th>
                {Array.from({ length: periodCount }, (_, i) => (
                  <th key={i}>П{i + 1}</th>
                ))}
                <th>Время</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.kind}:${r.label}`}
                  className={r.kind === 'total' ? 'stats-total' : r.kind === 'none' ? 'stats-none' : undefined}
                >
                  <td>{r.label}</td>
                  <td>{r.count}</td>
                  {r.perPeriod.map((c, i) => (
                    <td key={i}>{c}</td>
                  ))}
                  <td>{formatTime(r.duration, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="settings-section">
        <h3>Выгрузка</h3>
        <div className="stats-actions">
          <Btn onClick={() => onSaveCsv('моменты.csv', momentsCsv(moments, videos, periods))} disabled={moments.length === 0}>
            Моменты в CSV
          </Btn>
          <Btn onClick={() => onSaveCsv('статистика.csv', statsCsv(rows, periodCount))} disabled={moments.length === 0}>
            Статистика в CSV
          </Btn>
        </div>
      </section>
    </Modal>
  )
}
