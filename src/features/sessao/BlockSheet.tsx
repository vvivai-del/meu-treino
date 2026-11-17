import type { Exercise, ID, SetLog } from '../../domain/types';
import { blockKind, type Block } from './blocks';
import { blockProgress } from './logic';

interface Props {
  blocks: Block[];
  active: number;
  logs: Map<string, SetLog>;
  exercises: Map<ID, Exercise>;
  onPick: (index: number) => void;
  onClose: () => void;
}

/** Painel deslizante com todos os blocos: pular para qualquer um e ver o que já foi feito. */
export function BlockSheet({ blocks, active, logs, exercises, onPick, onClose }: Props) {
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Exercícios do treino" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2>Exercícios</h2>
          <button type="button" className="sheet-close" onClick={onClose}>
            Fechar
          </button>
        </div>
        <ol className="sheet-list">
          {blocks.map((block, i) => {
            const p = blockProgress(block, logs);
            const complete = p.total > 0 && p.done === p.total;
            const kind = blockKind(block);
            return (
              <li key={block.id}>
                <button type="button" className={`sheet-item ${i === active ? 'active' : ''} ${complete ? 'complete' : ''}`} onClick={() => onPick(i)}>
                  <span className="sheet-mark" aria-hidden="true">
                    {complete ? '✓' : i + 1}
                  </span>
                  <span className="sheet-names">
                    {kind && <span className="sheet-kind">{kind}</span>}
                    {block.items.map((it) => (
                      <span key={it.id} className="sheet-name">
                        {it.label ? `${it.label} · ` : ''}
                        {exercises.get(it.exerciseId)?.name ?? it.rawName}
                      </span>
                    ))}
                  </span>
                  <span className="sheet-count">
                    {p.done}/{p.total}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
