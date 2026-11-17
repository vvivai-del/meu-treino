import { useMemo, useState } from 'react';
import type { Exercise } from '../../domain/types';
import { mergeCandidates } from './logic';
import './merge-dialogs.css';

interface ConfirmProps {
  keep: Exercise;
  drop: Exercise;
  busy?: boolean;
  error?: string;
  onSwap: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmação da fusão: deixa claro qual exercício permanece. */
export function MergeConfirm({ keep, drop, busy, error, onSwap, onConfirm, onCancel }: ConfirmProps) {
  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Confirmar fusão" onClick={(e) => e.stopPropagation()}>
        <h2>Fundir exercícios</h2>
        <div className="merge-flow">
          <div className="merge-box merge-drop">
            <span className="merge-tag">Some</span>
            <strong>{drop.name}</strong>
          </div>
          <div className="merge-arrow" aria-hidden="true">↓</div>
          <div className="merge-box merge-keep">
            <span className="merge-tag keep">Permanece</span>
            <strong>{keep.name}</strong>
          </div>
        </div>
        <p className="text-secondary">
          O histórico de cargas e os treinos de “{drop.name}” passam para “{keep.name}”, e o nome antigo vira um apelido
          (alias). Vídeo e dicas faltantes são herdados.
        </p>
        {error && <p className="sheet-error">{error}</p>}
        <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>
          {busy ? 'Fundindo…' : `Fundir em “${keep.name}”`}
        </button>
        <button className="btn btn-ghost" onClick={onSwap} disabled={busy}>
          ⇅ Manter “{drop.name}” no lugar
        </button>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

interface PickerProps {
  current: Exercise;
  all: Exercise[];
  onPick: (other: Exercise) => void;
  onCancel: () => void;
}

/** Seletor com busca; os candidatos mais parecidos aparecem primeiro. */
export function MergePicker({ current, all, onPick, onCancel }: PickerProps) {
  const [query, setQuery] = useState('');
  const list = useMemo(() => mergeCandidates(current, all, query), [current, all, query]);
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet sheet-tall" role="dialog" aria-modal="true" aria-label="Escolher exercício" onClick={(e) => e.stopPropagation()}>
        <h2>Fundir “{current.name}” com…</h2>
        <input
          className="input"
          type="search"
          placeholder="Buscar exercício"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <ul className="picker-list">
          {list.map((e) => (
            <li key={e.id}>
              <button className="picker-row" onClick={() => onPick(e)}>
                <span>{e.name}</span>
                {e.muscleGroup && <span className="text-secondary">{e.muscleGroup}</span>}
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="text-secondary picker-empty">Nenhum exercício encontrado.</li>}
        </ul>
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
