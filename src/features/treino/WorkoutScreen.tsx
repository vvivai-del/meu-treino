import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Exercise, ID, SetLog, Workout, WorkoutItem } from '../../domain/types';
import { suggestSets } from '../../engine';
import { retryVideo } from '../../import';
import { formatDate } from '../../app/format';
import { navigate } from '../../app/router';
import { blockKind, groupBlocks } from '../sessao/blocks';
import { ConfirmDialog } from '../sessao/ConfirmDialog';
import { changeDate, confirmMatch, deleteWorkout, rejectMatch, startOrResumeSession } from './actions';
import { formatSuggestion } from './logic';
import './treino.css';

interface Loaded {
  workout: Workout;
  items: WorkoutItem[];
  exercises: Map<ID, Exercise>;
  history: SetLog[];
  openSessionId: ID | undefined;
}

async function load(workoutId: ID): Promise<Loaded | null> {
  const workout = await db.workouts.get(workoutId);
  if (!workout || workout.deletedAt) return null;
  const items = (await db.workoutItems.where('workoutId').equals(workoutId).filter((i) => !i.deletedAt).toArray()).sort(
    (a, b) => a.order - b.order,
  );
  const ids = [...new Set(items.map((i) => i.exerciseId))];
  const exercises = new Map<ID, Exercise>();
  for (const e of await db.exercises.bulkGet(ids)) if (e) exercises.set(e.id, e);
  const open = await db.sessions
    .where('workoutId')
    .equals(workoutId)
    .filter((s) => !s.finishedAt && !s.deletedAt)
    .first();
  const history = await db.setLogs
    .where('exerciseId')
    .anyOf(ids)
    .filter((l) => l.done && !l.deletedAt && l.sessionId !== open?.id)
    .toArray();
  return { workout, items, exercises, history, openSessionId: open?.id };
}

const VIDEO_PENDING = ['pendente', 'enviando', 'analisando'];

export function WorkoutScreen({ workoutId }: { workoutId: string }) {
  const data = useLiveQuery(() => load(workoutId), [workoutId]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const suggestionText = useMemo(() => {
    const out = new Map<ID, string>();
    if (!data) return out;
    for (const item of data.items) {
      const exercise = data.exercises.get(item.exerciseId);
      if (!exercise) continue;
      const sets = suggestSets({
        prescription: item.prescription,
        exercise,
        history: data.history.filter((h) => h.exerciseId === item.exerciseId),
      });
      const text = formatSuggestion(sets[0], exercise.loadType);
      if (text) out.set(item.id, text);
    }
    return out;
  }, [data]);

  if (data === undefined) return <div className="screen" aria-busy="true" />;
  if (data === null) {
    return (
      <div className="screen center">
        <h2>Treino não encontrado</h2>
        <a href="#/" className="btn btn-primary" style={{ maxWidth: 260 }}>
          Voltar ao início
        </a>
      </div>
    );
  }

  const { workout, items, exercises, openSessionId } = data;
  const blocks = groupBlocks(items);

  async function start() {
    const id = await startOrResumeSession(workoutId);
    navigate(`/sessao/${id}`);
  }

  async function retry() {
    setRetrying(true);
    try {
      await retryVideo(workoutId);
    } catch {
      /* o próprio pipeline grava o erro em videoStatus/videoError */
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="screen tr-screen">
      <header className="tr-header">
        <h1>{workout.title}</h1>
        <p className="text-secondary tr-date">{formatDate(workout.date)}</p>
        <VideoStatusLine workout={workout} retrying={retrying} onRetry={retry} />
      </header>

      {workout.mergeNotes && (
        <details className="card tr-notes">
          <summary>Como este treino foi montado</summary>
          <p>{workout.mergeNotes}</p>
        </details>
      )}

      {items.length === 0 && <p className="text-secondary">Este treino não tem exercícios.</p>}

      <div className="tr-blocks">
        {blocks.map((block) => {
          const kind = blockKind(block);
          return (
            <section key={block.id} className={`tr-block ${kind ? 'grouped' : ''}`} aria-label={kind ?? undefined}>
              {kind && <div className="tr-block-tag">{kind}</div>}
              {block.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  exercise={exercises.get(item.exerciseId)}
                  suggestion={suggestionText.get(item.id)}
                />
              ))}
            </section>
          );
        })}
      </div>

      <div className="tr-secondary">
        <label className="btn btn-ghost tr-date-btn">
          Alterar data
          <input
            type="date"
            className="tr-date-input"
            value={workout.date}
            aria-label="Alterar data do treino"
            onChange={(e) => void changeDate(workoutId, e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-ghost tr-delete" onClick={() => setConfirmDelete(true)}>
          Excluir treino
        </button>
      </div>

      <div className="tr-footer">
        <button type="button" className="btn btn-primary tr-start" onClick={() => void start()} disabled={items.length === 0}>
          {openSessionId ? 'Continuar treino' : 'Iniciar treino'}
        </button>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Excluir este treino?"
          message="O treino sai da lista. As sessões já concluídas continuam no histórico."
          confirmLabel="Excluir"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void deleteWorkout(workoutId).then(() => navigate('/'));
          }}
        />
      )}
    </div>
  );
}

function VideoStatusLine({ workout, retrying, onRetry }: { workout: Workout; retrying: boolean; onRetry: () => void }) {
  if (VIDEO_PENDING.includes(workout.videoStatus)) {
    return (
      <p className="tr-video-status" role="status">
        <span className="tr-pulse" aria-hidden="true" /> Vídeo sendo analisado…
      </p>
    );
  }
  if (workout.videoStatus === 'erro') {
    return (
      <div className="alert alert-warning tr-video-error">
        <span>{workout.videoError || 'Não foi possível analisar o vídeo.'}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Tentando…' : 'Tentar de novo'}
        </button>
      </div>
    );
  }
  return null;
}

function ItemRow({ item, exercise, suggestion }: { item: WorkoutItem; exercise: Exercise | undefined; suggestion: string | undefined }) {
  const hasVideo = Boolean(item.clip ?? exercise?.clip);
  const pausa = item.role === 'pausa_ativa';
  return (
    <article className={`tr-item ${pausa ? 'pausa' : ''}`}>
      <div className="tr-item-label">{item.label ?? item.order + 1}</div>
      <div className="tr-item-main">
        <div className="tr-item-name">{exercise?.name ?? item.rawName}</div>
        <div className="tr-item-meta">
          <span className="tr-presc">{item.prescription.raw}</span>
          {suggestion && <span className="tr-sug">{suggestion}</span>}
        </div>
        <div className="tr-tags">
          {pausa && <span className="tr-tag tr-tag-pausa">pausa ativa</span>}
          {item.match === 'novo' && <span className="tr-tag">novo no catálogo</span>}
          {hasVideo && <span className="tr-tag tr-tag-video">com vídeo</span>}
        </div>
        {item.match === 'baixa' && exercise && (
          <div className="tr-confirm" role="group" aria-label="Confirmar exercício">
            <p>
              É o mesmo exercício que <strong>«{exercise.name}»</strong>?
              {item.rawName !== exercise.name && <span className="text-secondary"> No treino: «{item.rawName}»</span>}
            </p>
            <div className="tr-confirm-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void confirmMatch(item.id)}>
                Sim
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void rejectMatch(item.id)}>
                Não, é outro
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
