import { useEffect, useMemo, useRef, useState } from 'react';
import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings } from '../../db/db';
import type { ClipRef, Exercise, ID, Session, SetLog, Settings, Workout, WorkoutItem } from '../../domain/types';
import { suggestSets } from '../../engine';
import { formatClock } from '../../app/format';
import { navigate } from '../../app/router';
import { ClipPlayer } from '../../media/ClipPlayer';
import { useVideoUrl } from '../../media/useVideoUrl';
import { ensureSetRows, finishSession, setDone, setDuration } from './actions';
import { BlockSheet } from './BlockSheet';
import { blockKind, groupBlocks } from './blocks';
import { ConfirmDialog } from './ConfirmDialog';
import { ExerciseSection } from './ExerciseSection';
import { readRest, useNow, useWakeLock, writeRest, type RestState } from './hooks';
import {
  blockProgress,
  endsRound,
  firstPendingBlock,
  indexLogs,
  isBlockComplete,
  nextPendingTurn,
  remainingSec,
  summarizeSession,
} from './logic';
import { Summary } from './Summary';
import './sessao.css';

interface Core {
  session: Session;
  workout: Workout;
  items: WorkoutItem[];
  exercises: Map<ID, Exercise>;
  /** Séries concluídas de sessões anteriores dos exercícios deste treino. */
  history: SetLog[];
  settings: Settings;
}

async function loadCore(sessionId: ID): Promise<Core | null> {
  const session = await db.sessions.get(sessionId);
  if (!session || session.deletedAt) return null;
  const workout = await db.workouts.get(session.workoutId);
  if (!workout || workout.deletedAt) return null;
  const items = (await db.workoutItems.where('workoutId').equals(workout.id).filter((i) => !i.deletedAt).toArray()).sort(
    (a, b) => a.order - b.order,
  );
  const ids = [...new Set(items.map((i) => i.exerciseId))];
  const exercises = new Map<ID, Exercise>();
  for (const e of await db.exercises.bulkGet(ids)) if (e) exercises.set(e.id, e);
  // Só o que veio antes desta sessão: o índice [exerciseId+doneAt] não é tocado pelas séries de hoje.
  const perExercise = await Promise.all(
    ids.map((id) =>
      db.setLogs
        .where('[exerciseId+doneAt]')
        .between([id, Dexie.minKey], [id, session.startedAt], true, false)
        .filter((l) => l.done && !l.deletedAt && l.sessionId !== session.id)
        .toArray(),
    ),
  );
  return { session, workout, items, exercises, history: perExercise.flat(), settings: await getSettings() };
}

export function SessionScreen({ sessionId }: { sessionId: string }) {
  const core = useLiveQuery(() => loadCore(sessionId), [sessionId]);
  const logs = useLiveQuery(
    () =>
      db.setLogs
        .where('sessionId')
        .equals(sessionId)
        .filter((l) => !l.deletedAt)
        .toArray(),
    [sessionId],
  );

  if (core === undefined || logs === undefined) return <div className="screen ss-loading" aria-busy="true" />;
  if (core === null) {
    return (
      <div className="screen center">
        <h2>Sessão não encontrada</h2>
        <a href="#/" className="btn btn-primary" style={{ maxWidth: 260 }}>
          Voltar ao início
        </a>
      </div>
    );
  }
  return <Player key={sessionId} core={core} logs={logs} />;
}

function VideoNotice({ text }: { text: string }) {
  return <div className="ss-novideo">{text}</div>;
}

function Player({ core, logs: logList }: { core: Core; logs: SetLog[] }) {
  const { session, workout, items, exercises, history, settings } = core;
  const sessionId = session.id;
  const finished = session.finishedAt !== undefined;

  const blocks = useMemo(() => groupBlocks(items), [items]);
  const logs = useMemo(() => indexLogs(logList), [logList]);

  const [active, setActive] = useState(() => firstPendingBlock(blocks, logs));
  const [focusItem, setFocusItem] = useState<ID | null>(null);
  const [rest, setRest] = useState<RestState | null>(() => readRest(sessionId));
  const [timer, setTimer] = useState<{ logId: ID; endsAt: number } | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);

  const now = useNow(rest !== null || timer !== null);
  useWakeLock(!finished);

  const index = Math.min(active, Math.max(0, blocks.length - 1));
  const block = blocks[index];
  const turn = block ? nextPendingTurn(block, logs) : null;
  const blockDone = block ? isBlockComplete(block, logs) : false;

  // Cria as séries planejadas do bloco na primeira vez que ele é aberto.
  const latest = useRef({ exercises, history });
  latest.current = { exercises, history };
  useEffect(() => {
    if (!block || finished) return;
    void ensureSetRows(sessionId, block, latest.current.exercises, latest.current.history);
    // `block` é identificado pelo id: reexecutar a cada renderização só repetiria uma transação sem efeito.
  }, [sessionId, block?.id, finished]);

  // Persiste o descanso para sobreviver a um recarregamento.
  useEffect(() => writeRest(sessionId, rest), [sessionId, rest]);

  // Fim do descanso: avisa (onde há vibração) e some pouco depois.
  const buzzed = useRef<number | null>(null);
  useEffect(() => {
    if (!rest) return;
    if (now >= rest.endsAt && buzzed.current !== rest.endsAt) {
      buzzed.current = rest.endsAt;
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        /* sem vibração neste aparelho */
      }
    }
    if (now >= rest.endsAt + 8000) setRest(null);
  }, [now, rest]);

  // Fim da contagem de uma série por tempo: conclui sozinha.
  useEffect(() => {
    if (!timer || now < timer.endsAt) return;
    const log = logList.find((l) => l.id === timer.logId);
    setTimer(null);
    if (log && !log.done) void completeSet(log);
  }, [now, timer]);

  const suggestions = useMemo(() => {
    const out = new Map<ID, string>();
    for (const item of items) {
      const exercise = exercises.get(item.exerciseId);
      if (!exercise) continue;
      const sets = suggestSets({
        prescription: item.prescription,
        exercise,
        history: history.filter((h) => h.exerciseId === item.exerciseId),
      });
      if (sets[0]) out.set(item.id, sets[0].reason);
    }
    return out;
  }, [items, exercises, history]);

  // Vídeo: acompanha o item da vez; o <video> fica montado mesmo quando um exercício não tem trecho.
  const videoItem = block?.items.find((i) => i.id === focusItem) ?? (block ? block.items[turn?.itemIndex ?? 0] : undefined);
  const videoExercise = videoItem ? exercises.get(videoItem.exerciseId) : undefined;
  const clip: ClipRef | undefined = videoItem?.clip ?? videoExercise?.clip;
  const lastClip = useRef<ClipRef | undefined>(undefined);
  if (clip) lastClip.current = clip;
  const shownClip = clip ?? lastClip.current;
  const clipUrl = useVideoUrl(clip?.videoId);
  const hasVideo = Boolean(clip) && clipUrl !== null;
  const noVideoText = clip
    ? 'Vídeo não está neste aparelho'
    : ['pendente', 'enviando', 'analisando'].includes(workout.videoStatus)
      ? 'Vídeo em análise…'
      : 'Sem vídeo';

  // ---------- ações ----------

  function goTo(i: number) {
    setActive(Math.max(0, Math.min(blocks.length - 1, i)));
    setFocusItem(null);
    setTimer(null);
    setSheetOpen(false);
  }

  function startRest(sec: number) {
    setRest({ endsAt: Date.now() + sec * 1000, totalSec: sec });
  }

  async function completeSet(log: SetLog) {
    await setDone(log.id, true);
    const b = blocks.find((x) => x.items.some((i) => i.id === log.workoutItemId));
    const item = b?.items.find((i) => i.id === log.workoutItemId);
    if (!b || !item) return;
    const p = blockProgress(b, logs);
    const lastOfWorkout = blocks[blocks.length - 1] === b && p.done + 1 >= p.total;
    if (lastOfWorkout) return;
    if (endsRound(b, { itemIndex: b.items.indexOf(item), setIndex: log.setIndex })) {
      startRest(item.prescription.restSec ?? settings.defaultRestSec);
    }
  }

  function toggleDone(log: SetLog) {
    if (timer?.logId === log.id) setTimer(null);
    if (log.done) void setDone(log.id, false);
    else void completeSet(log);
  }

  function toggleTimer(log: SetLog) {
    if (timer?.logId === log.id) {
      setTimer(null);
      return;
    }
    const sec = log.durationSec ?? 30;
    if (log.durationSec === undefined) void setDuration(log.id, sec);
    setTimer({ logId: log.id, endsAt: Date.now() + sec * 1000 });
  }

  const pendingSets = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const b of blocks) {
      const p = blockProgress(b, logs);
      total += p.total;
      done += p.done;
    }
    return total - done;
  }, [blocks, logs]);

  async function finish() {
    setConfirmFinish(false);
    setRest(null);
    await finishSession(sessionId);
  }

  // ---------- renderização ----------

  if (finished) {
    const summary = summarizeSession({
      startedAt: session.startedAt,
      finishedAt: session.finishedAt!,
      logs: logList,
      history,
    });
    return <Summary title={workout.title} summary={summary} exercises={exercises} />;
  }

  if (!block) {
    return (
      <div className="screen center">
        <h2>Este treino não tem exercícios</h2>
        <a href="#/" className="btn btn-primary" style={{ maxWidth: 260 }}>
          Voltar ao início
        </a>
      </div>
    );
  }

  const isLast = index === blocks.length - 1;
  const kind = blockKind(block);
  const restLeft = rest ? remainingSec(rest.endsAt, now) : 0;

  return (
    <div className="session">
      <header className="ss-top">
        <div className="ss-top-row">
          <button type="button" className="ss-exit" onClick={() => navigate('/')} aria-label="Sair do treino (fica salvo)">
            ‹ Sair
          </button>
          <div className="ss-title">{workout.title}</div>
          <button type="button" className="ss-count" onClick={() => setSheetOpen(true)} aria-label="Ver todos os exercícios">
            {index + 1} / {blocks.length} <span aria-hidden="true">☰</span>
          </button>
        </div>
        <div className="ss-progress" aria-hidden="true">
          {blocks.map((b, i) => (
            <span key={b.id} className={`ss-seg ${i === index ? 'active' : ''} ${isBlockComplete(b, logs) ? 'done' : ''}`} />
          ))}
        </div>
      </header>

      <div className={`ss-video ${hasVideo ? '' : 'collapsed'}`}>
        <div
          className="ss-video-tap"
          onClick={() => hasVideo && setSoundOn((s) => !s)}
          role="button"
          aria-label={soundOn ? 'Desligar som do vídeo' : 'Ligar som do vídeo'}
        >
          <ClipPlayer
            clip={shownClip}
            className="ss-video-el"
            controls={false}
            muted={!soundOn}
            paused={!hasVideo}
            replayKey={replayKey}
          />
        </div>
        {hasVideo && (
          <>
            <span className="ss-video-chip left" aria-hidden="true">
              {soundOn ? '🔊 Som ligado' : '🔇 Toque p/ som'}
            </span>
            <button type="button" className="ss-video-chip right" onClick={() => setReplayKey((k) => k + 1)}>
              ↻ Repetir
            </button>
          </>
        )}
      </div>
      {!hasVideo && <VideoNotice text={noVideoText} />}

      <main className="ss-scroll">
        {kind && <div className="ss-kind">{kind} · alterne os exercícios, descanse só depois da rodada</div>}
        {block.items.map((item, i) => (
          <ExerciseSection
            key={item.id}
            item={item}
            exercise={exercises.get(item.exerciseId)}
            logs={logs}
            reason={suggestions.get(item.id)}
            currentSet={turn && turn.itemIndex === i ? turn.setIndex : null}
            videoHere={videoItem?.id === item.id}
            multi={block.items.length > 1}
            timer={timer}
            now={now}
            onFocus={() => setFocusItem(item.id)}
            onToggleDone={toggleDone}
            onToggleTimer={toggleTimer}
          />
        ))}
      </main>

      {rest && (
        <div className={`ss-rest ${restLeft === 0 ? 'over' : ''}`} role="timer" aria-live="off">
          <div className="ss-rest-bar" style={{ width: `${Math.min(100, (restLeft / rest.totalSec) * 100)}%` }} />
          <span className="ss-rest-label">{restLeft === 0 ? 'Descanso acabou' : 'Descanso'}</span>
          <span className="ss-rest-time">{formatClock(restLeft)}</span>
          <button
            type="button"
            className="ss-rest-btn"
            onClick={() => setRest({ endsAt: Math.max(rest.endsAt, Date.now()) + 15_000, totalSec: rest.totalSec + 15 })}
          >
            +15s
          </button>
          <button type="button" className="ss-rest-btn" onClick={() => setRest(null)}>
            Pular
          </button>
        </div>
      )}

      <nav className="ss-nav">
        <button type="button" className="btn btn-ghost" disabled={index === 0} onClick={() => goTo(index - 1)}>
          ‹ Anterior
        </button>
        {isLast ? (
          <button
            type="button"
            className={`btn ${blockDone ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => (pendingSets > 0 ? setConfirmFinish(true) : void finish())}
          >
            Finalizar treino
          </button>
        ) : (
          <button type="button" className={`btn ${blockDone ? 'btn-primary pulse' : 'btn-ghost'}`} onClick={() => goTo(index + 1)}>
            Próximo ›
          </button>
        )}
      </nav>

      {sheetOpen && (
        <BlockSheet blocks={blocks} active={index} logs={logs} exercises={exercises} onPick={goTo} onClose={() => setSheetOpen(false)} />
      )}
      {confirmFinish && (
        <ConfirmDialog
          title="Finalizar o treino?"
          message={`Ainda há ${pendingSets} ${pendingSets === 1 ? 'série pendente' : 'séries pendentes'}. Elas não serão registradas.`}
          confirmLabel="Finalizar"
          cancelLabel="Continuar treinando"
          onCancel={() => setConfirmFinish(false)}
          onConfirm={() => void finish()}
        />
      )}
    </div>
  );
}
