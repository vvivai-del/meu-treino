import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { todayLocal } from '../../engine';
import type { Exercise, ExerciseKind, ID, Session } from '../../domain/types';
import { loadDismissedPairs, saveDismissedPairs } from './dismissed';
import {
  KIND_LABELS, findDuplicatePairs, latestByExercise, matchesQuery, sortByName, suggestKeeper, summarizeLast,
  type DuplicatePair,
} from './logic';
import { mergeExercises } from './merge';
import { MergeConfirm } from './MergeDialogs';
import './catalogo.css';

const KINDS = Object.keys(KIND_LABELS) as ExerciseKind[];
const PAIRS_COLLAPSED = 3;

interface CatalogData {
  exercises: Exercise[];
  latest: ReturnType<typeof latestByExercise>;
}

async function loadCatalog(): Promise<CatalogData> {
  // Uma consulta para a tela toda: todas as séries concluídas e as sessões, agrupadas em memória.
  const [all, logs, sessionRows] = await Promise.all([
    db.exercises.toArray(),
    db.setLogs.filter((l) => l.done && !l.deletedAt).toArray(),
    db.sessions.filter((s) => !s.deletedAt).toArray(),
  ]);
  const sessions = new Map<ID, Session>(sessionRows.map((s) => [s.id, s]));
  return { exercises: all.filter((e) => !e.deletedAt), latest: latestByExercise(logs, sessions) };
}

export function CatalogScreen() {
  const data = useLiveQuery(loadCatalog, []);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ExerciseKind | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissedPairs);
  const [showAllPairs, setShowAllPairs] = useState(false);
  const [merging, setMerging] = useState<{ keep: Exercise; drop: Exercise } | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string>();

  const exercises = data?.exercises;
  const today = todayLocal();

  const pairs = useMemo(() => (exercises ? findDuplicatePairs(exercises, dismissed) : []), [exercises, dismissed]);
  const visible = useMemo(
    () => (exercises ? sortByName(exercises).filter((e) => (!kind || e.kind === kind) && matchesQuery(e, query)) : []),
    [exercises, kind, query],
  );

  function dismiss(pair: DuplicatePair) {
    const next = new Set(dismissed).add(pair.key);
    setDismissed(next);
    saveDismissedPairs(next);
  }

  async function confirmMerge() {
    if (!merging) return;
    setMergeBusy(true);
    setMergeError(undefined);
    try {
      await mergeExercises(merging.drop.id, merging.keep.id);
      setMerging(null);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Não foi possível fundir.');
    } finally {
      setMergeBusy(false);
    }
  }

  if (!data || !exercises) return <div className="screen" />;

  const shownPairs = showAllPairs ? pairs : pairs.slice(0, PAIRS_COLLAPSED);

  return (
    <div className="screen catalog">
      <header className="header">
        <h1>Catálogo</h1>
        <p className="text-secondary">
          {exercises.length} {exercises.length === 1 ? 'exercício' : 'exercícios'}
        </p>
      </header>

      {exercises.length === 0 ? (
        <div className="card cat-empty">
          <div className="cat-empty-icon" aria-hidden="true">📚</div>
          <h2>Nenhum exercício ainda</h2>
          <p className="text-secondary">
            Os exercícios aparecem aqui quando você importa um treino do personal. Cada um fica uma única vez, com
            vídeo e histórico de cargas.
          </p>
          <a className="btn btn-primary cat-empty-btn" href="#/importar">Importar treino</a>
        </div>
      ) : (
        <>
          {pairs.length > 0 && (
            <section className="alert alert-warning dup-strip" aria-label="Possíveis duplicados">
              <strong>Possíveis duplicados ({pairs.length})</strong>
              {shownPairs.map((p) => (
                <div className="dup-pair" key={p.key}>
                  <div className="dup-names">
                    <a href={`#/catalogo/${p.a.id}`}>{p.a.name}</a>
                    <span className="dup-eq" aria-hidden="true">=</span>
                    <a href={`#/catalogo/${p.b.id}`}>{p.b.name}</a>
                  </div>
                  <div className="dup-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setMergeError(undefined);
                        setMerging(suggestKeeper(p.a, p.b));
                      }}
                    >
                      Fundir
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => dismiss(p)}>São diferentes</button>
                  </div>
                </div>
              ))}
              {pairs.length > PAIRS_COLLAPSED && (
                <button className="dup-more" onClick={() => setShowAllPairs((v) => !v)}>
                  {showAllPairs ? 'Mostrar menos' : `Mostrar mais (${pairs.length - PAIRS_COLLAPSED})`}
                </button>
              )}
            </section>
          )}

          <input
            className="input"
            type="search"
            placeholder="Buscar exercício"
            aria-label="Buscar exercício"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="chips" role="group" aria-label="Filtrar por tipo">
            <button className={`chip ${kind === null ? 'on' : ''}`} onClick={() => setKind(null)}>Todos</button>
            {KINDS.map((k) => (
              <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(kind === k ? null : k)}>
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="text-secondary cat-none">Nenhum exercício encontrado.</p>
          ) : (
            <ul className="cat-list">
              {visible.map((e) => {
                const last = data.latest.get(e.id);
                return (
                  <li key={e.id}>
                    <a className="cat-row" href={`#/catalogo/${e.id}`}>
                      <div className="cat-row-main">
                        <span className="cat-row-name">{e.name}</span>
                        <span className="cat-row-sub text-secondary">
                          {[e.muscleGroup, last ? summarizeLast(last, today) : 'sem registros'].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      {e.clip ? (
                        <span className="cat-video" title="Tem vídeo">🎬 vídeo</span>
                      ) : null}
                      <span className="cat-chevron" aria-hidden="true">›</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {merging && (
        <MergeConfirm
          keep={merging.keep}
          drop={merging.drop}
          busy={mergeBusy}
          error={mergeError}
          onSwap={() => setMerging({ keep: merging.drop, drop: merging.keep })}
          onConfirm={() => void confirmMerge()}
          onCancel={() => setMerging(null)}
        />
      )}
    </div>
  );
}
