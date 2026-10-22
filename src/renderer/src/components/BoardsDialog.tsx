import { useState } from 'react'
import type { Board } from '../../../shared/types'
import { MAX_BOARD_TITLE } from '../../../shared/project'
import { newId } from '../lib/ids'
import { BoardEditor } from './BoardEditor'
import { Btn } from './Btn'
import { CommitField, nonEmpty } from './CommitField'
import { Modal } from './Modal'

type Props = {
  boards: Board[]
  color: string
  recentColors: string[]
  onColor(c: string): void
  onAdd(board: Board): void
  onUpdate(id: string, patch: Partial<Omit<Board, 'id'>>): void
  onRemove(id: string): void
  onClose(): void
}

/** Следующее свободное «Схема N». */
export function nextBoardTitle(boards: Board[]): string {
  const used = boards.map((b) => /^Схема (\d+)$/.exec(b.title)).reduce((n, m) => (m ? Math.max(n, Number(m[1])) : n), 0)
  return `Схема ${Math.max(used, boards.length) + 1}`
}

/** Свободные схемы площадки — тактическая доска, не привязанная к моментам. Хранятся в проекте. */
export function BoardsDialog({ boards, color, recentColors, onColor, onAdd, onUpdate, onRemove, onClose }: Props): React.JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(boards[0]?.id ?? null)
  // выбранную схему удалили (или отменили её создание) — показываем первую
  const active = boards.find((b) => b.id === activeId) ?? boards[0] ?? null

  const create = (): void => {
    const board: Board = { id: newId('b'), title: nextBoardTitle(boards), shapes: [] }
    onAdd(board)
    setActiveId(board.id)
  }

  return (
    <Modal title="Тактические схемы" onClose={onClose} className="board-modal">
      <div className="boards-tabs">
        <div className="segmented" role="tablist" aria-label="Схемы">
          {boards.map((b) => (
            <Btn key={b.id} role="tab" aria-selected={b.id === active?.id} active={b.id === active?.id} onClick={() => setActiveId(b.id)}>
              {b.title}
            </Btn>
          ))}
        </div>
        <Btn onClick={create} title="Новая пустая схема">
          ＋ Схема
        </Btn>
      </div>
      {active ? (
        <>
          <div className="boards-head">
            <CommitField
              key={active.id}
              label="Название схемы"
              value={active.title}
              maxLength={MAX_BOARD_TITLE}
              parse={nonEmpty}
              onCommit={(title) => onUpdate(active.id, { title: title.trim() })}
            />
            <Btn variant="ghost" onClick={() => onRemove(active.id)} title="Удалить схему (Ctrl+Z вернёт)">
              Удалить схему
            </Btn>
          </div>
          <BoardEditor
            key={active.id}
            shapes={active.shapes}
            color={color}
            recentColors={recentColors}
            onColor={onColor}
            onChange={(shapes) => onUpdate(active.id, { shapes })}
            note="Схемы сохраняются в проекте. Ctrl+Z — отменить, Delete — удалить выделенную фигуру."
            actions={
              <Btn variant="primary" onClick={onClose}>
                Готово
              </Btn>
            }
          />
        </>
      ) : (
        <div className="boards-empty">
          <p className="muted">Тактическая доска: площадка, на которой можно рисовать схемы без привязки к моментам видео.</p>
          <Btn variant="primary" onClick={create}>
            Создать схему
          </Btn>
        </div>
      )}
    </Modal>
  )
}
