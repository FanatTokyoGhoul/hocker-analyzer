import { useState } from 'react'
import type { Remote } from '../hooks/useRemote'
import { Btn } from './Btn'

type Props = {
  remote: Remote
  open: boolean
  onOpenChange(open: boolean): void
}

const svgUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/** Плавающая кнопка пульта рядом с кнопкой рисования: QR-код для телефона и адрес. */
export function RemoteMenu({ remote, open, onOpenChange }: Props): React.JSX.Element {
  const { info, busy, error } = remote
  const [ip, setIp] = useState<string | null>(null)
  const addresses = info?.addresses ?? []
  const address = addresses.find((a) => a.ip === ip) ?? addresses[0]
  const running = !!info?.running

  return (
    <div className="remote-menu" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`fab${open ? ' is-open' : ''}${running ? ' is-active' : ''}`}
        title="Пульт с телефона (QR-код)"
        aria-label="Пульт с телефона"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onOpenChange(!open)}
      >
        <span className="fab-icon">📱</span>
        {running && <span className={`fab-dot ${info!.clients ? 'is-ok' : 'is-wait'}`} />}
      </button>

      {open && (
        <div className="draw-panel remote-panel" role="group" aria-label="Пульт с телефона">
          <div className="remote-head">
            <strong>Пульт с телефона</strong>
            {running ? (
              <Btn onClick={remote.stop} disabled={busy}>
                Выключить
              </Btn>
            ) : (
              <Btn variant="primary" onClick={remote.start} disabled={busy}>
                Включить
              </Btn>
            )}
          </div>
          {!running && (
            <p className="muted small">
              Телефон станет пультом: пауза, кадры, моменты и рисование на кадре. Нужна общая Wi-Fi сеть (или точка доступа с ноутбука);
              интернет не нужен.
            </p>
          )}
          {running && !address && <p className="small warn-text">Нет подключения к сети — подключите компьютер к Wi-Fi.</p>}
          {running && address && (
            <>
              <img className="remote-qr" src={svgUrl(address.qrSvg)} alt={`QR-код: ${address.url}`} />
              <p className="small">Отсканируйте камерой телефона</p>
              <code className="remote-url" title={address.url}>
                {address.url}
              </code>
              {addresses.length > 1 && (
                <label className="small remote-ip">
                  Сеть:
                  <select value={address.ip} onChange={(e) => setIp(e.target.value)} aria-label="Сетевой адрес">
                    {addresses.map((a) => (
                      <option key={a.ip} value={a.ip}>
                        {a.ip}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="small">
                {info!.device
                  ? `${info!.clients ? 'Подключён' : 'Привязан'} телефон ${info!.device}`
                  : 'Телефон ещё не подключён'}
              </p>
              {info!.device && (
                <Btn onClick={remote.renew} disabled={busy} title="Отвязать телефон и показать новый QR-код">
                  Новый код
                </Btn>
              )}
              {!address.ip.match(/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/) && (
                <p className="small warn-text">Это не домашняя/локальная сеть — пульт будет недоступен.</p>
              )}
              <p className="muted small">
                Пульт привязывается к первому телефону, открывшему ссылку. Выключается сам через 30 минут без подключений.
              </p>
            </>
          )}
          {error && <p className="small warn-text">{error}</p>}
        </div>
      )}
    </div>
  )
}
