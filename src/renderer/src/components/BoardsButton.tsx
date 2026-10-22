type Props = {
  count: number
  onOpen(): void
}

/** Плавающая кнопка свободных схем площадки — под кнопками рисования и пульта. */
export function BoardsButton({ count, onOpen }: Props): React.JSX.Element {
  return (
    <div className="boards-button" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="fab"
        title={count ? `Тактические схемы (${count})` : 'Тактические схемы'}
        aria-label="Тактические схемы"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onOpen}
      >
        <span className="fab-icon">📋</span>
      </button>
    </div>
  )
}
