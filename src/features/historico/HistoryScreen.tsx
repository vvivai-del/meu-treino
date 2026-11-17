import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { formatDate } from '../../app/format';
import { db } from '../../db/db';
import { deleteSession, loadHistory } from './historyData';
import { formatDuration, groupByMonth, type HistoryEntry } from './historyLogic';
import './history.css';

function SessionCard({ entry }: { entry: HistoryEntry }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const duration = formatDuration(entry.durationMs);
  const meta = [duration, `${entry.totalSets} ${entry.totalSets === 1 ? 'série' : 'séries'}`].filter(Boolean).join(' · ');

  return (
    <li className="card hist-card">
      <button type="button" className="hist-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="hist-head-main">
          <span className="hist-date">{formatDate(entry.session.date)}</span>
          <span className="hist-title">{entry.title}</span>
          <span className="text-secondary">{meta}</span>
        </span>
        <span className={`hist-chevron ${open ? 'is-open' : ''}`} aria-hidden>▾</span>
      </button>

      {open && (
        <div className="hist-body">
          {entry.exercises.length === 0 && <p className="text-secondary">Nenhuma série registrada nesta sessão.</p>}
          <ul className="hist-ex-list">
            {entry.exercises.map((ex) => (
              <li key={ex.key} className="hist-ex">
                <a className="hist-ex-name" href={`#/catalogo/${ex.exerciseId}`}>{ex.name}</a>
                <span className="hist-ex-sets">
                  {ex.summary}
                  {ex.estimated && <span className="hist-tag">estimado</span>}
                </span>
              </li>
            ))}
          </ul>

          {confirming ? (
            <div className="hist-confirm">
              <p>Excluir este treino do histórico? As séries registradas também serão removidas.</p>
              <div className="hist-confirm-btns">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancelar</button>
                <button type="button" className="btn hist-danger" onClick={() => void deleteSession(db, entry.session.id)}>Excluir</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost hist-delete" onClick={() => setConfirming(true)}>
              Excluir sessão
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function HistoryScreen() {
  const entries = useLiveQuery(() => loadHistory(db), []);
  const months = useMemo(() => (entries ? groupByMonth(entries) : []), [entries]);

  return (
    <div className="screen">
      <header className="header">
        <h1>Histórico</h1>
      </header>

      {entries && entries.length === 0 && (
        <div className="empty-state">
          <p className="hist-empty-icon" aria-hidden>📈</p>
          <h2>Nenhum treino concluído ainda</h2>
          <p className="text-secondary">
            Quando você terminar um treino, ele aparece aqui com as cargas e repetições de cada exercício.
          </p>
          <a className="btn btn-primary hist-empty-btn" href="#/">Ir para Hoje</a>
        </div>
      )}

      {months.map((m) => (
        <section key={m.key} className="hist-month">
          <h2 className="hist-month-title">{m.label}</h2>
          <ul className="hist-list">
            {m.entries.map((e) => (
              <SessionCard key={e.session.id} entry={e} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
