import type { Moment, Shape } from '../../../shared/types'
import { BoardEditor } from './BoardEditor'
import { Btn } from './Btn'
import { Modal } from './Modal'

type Props = {
  moment: Moment
  color: string
  recentColors: string[]
  onColor(c: string): void
  onChange(shapes: Shape[]): void
  onClose(): void
}

/** Тактическая схема момента: попадает в экспорт перед клипом. */
export function BoardDialog({ moment, color, recentColors, onColor, onChange, onClose }: Props): React.JSX.Element {
  return (
    <Modal title={`Схема: ${moment.title}`} onClose={onClose} className="board-modal">
      <BoardEditor
        shapes={moment.board ?? []}
        color={color}
        recentColors={recentColors}
        onColor={onColor}
        onChange={onChange}
        note="Схема сохраняется в проекте и попадает в экспорт перед клипом. Ctrl+Z — отменить, Delete — удалить выделенную фигуру."
        actions={
          <Btn variant="primary" onClick={onClose}>
            Готово
          </Btn>
        }
      />
    </Modal>
  )
}
