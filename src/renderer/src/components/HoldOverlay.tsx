import { useEffect, useState } from 'react'
import type { Hold } from '../hooks/useDrawingStops'
import { Btn } from './Btn'

/** Плашка «остановка на рисунке»: обратный отсчёт или подсказка нажать клавишу. */
export function HoldOverlay({ hold, onContinue }: { hold: Hold; onContinue(): void }): React.JSX.Element {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (hold.until === null) return
    const t = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(t)
  }, [hold.until])

  const left = hold.until === null ? null : Math.max(0, (hold.until - now) / 1000)
  return (
    <div className="hold" role="status" aria-label="Пауза на рисунке" onPointerDown={(e) => e.stopPropagation()}>
      <span className="hold-icon" aria-hidden="true">✎</span>
      <span aria-hidden={left !== null}>
        {left === null ? 'Пауза на рисунке — нажмите любую клавишу, чтобы продолжить' : `Пауза на рисунке · продолжение через ${left.toFixed(1)} с`}
      </span>
      <Btn variant="primary" onClick={onContinue}>
        Продолжить
      </Btn>
      {left !== null && hold.total > 0 && <div className="hold-progress" style={{ width: `${(left * 1000 * 100) / hold.total}%` }} />}
    </div>
  )
}
