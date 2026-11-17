import type { Exercise, SetLog, WorkoutItem } from '../../domain/types';
import { isTimed, logKey, remainingSec } from './logic';
import { SetRow } from './SetRow';

interface Props {
  item: WorkoutItem;
  exercise: Exercise | undefined;
  logs: Map<string, SetLog>;
  /** `reason` da sugestão (mostrada uma vez, acima das séries). */
  reason: string | undefined;
  /** Índice da série da vez neste exercício, ou null se a vez é de outro item (ou o bloco acabou). */
  currentSet: number | null;
  /** O vídeo está mostrando este exercício. */
  videoHere: boolean;
  multi: boolean;
  timer: { logId: string; endsAt: number } | null;
  now: number;
  onFocus: () => void;
  onToggleDone: (log: SetLog) => void;
  onToggleTimer: (log: SetLog) => void;
}

export function ExerciseSection({
  item,
  exercise,
  logs,
  reason,
  currentSet,
  videoHere,
  multi,
  timer,
  now,
  onFocus,
  onToggleDone,
  onToggleTimer,
}: Props) {
  const { prescription } = item;
  const timed = isTimed(exercise, prescription.durationSec, prescription.repsMax);
  const mode = timed ? 'tempo' : exercise?.loadType === 'peso_corporal' ? 'peso_corporal' : 'peso';
  const stepKg = exercise?.weightStepKg ?? 1;
  const notes = [item.observations, exercise?.cues].filter((t): t is string => Boolean(t && t.trim()));
  const rows = Array.from({ length: prescription.sets }, (_, s) => ({ s, log: logs.get(logKey(item.id, s)) }));

  return (
    <section className={`ss-ex ${multi ? 'multi' : ''} ${videoHere && multi ? 'video-here' : ''}`}>
      <header className="ss-ex-head" onClick={multi ? onFocus : undefined}>
        <div className="ss-ex-title">
          <h2 className="ss-ex-name">
            {multi && item.label && <span className="ss-ex-label">{item.label}</span>}
            {exercise?.name ?? item.rawName}
          </h2>
          {exercise?.muscleGroup && <span className="muscle-tag">{exercise.muscleGroup}</span>}
        </div>
        <div className="ss-presc" title="Prescrição do personal">
          {prescription.raw}
        </div>
      </header>

      {notes.map((n, i) => (
        <p key={i} className="ss-note">
          {n}
        </p>
      ))}

      {reason && <p className="ss-reason">{reason}</p>}

      <div className="ss-sets">
        <div className={`ss-sets-head ${mode}`} aria-hidden="true">
          <span>Série</span>
          <span>{mode === 'tempo' ? 'Tempo (s)' : mode === 'peso' ? 'Peso (kg)' : ''}</span>
          <span>{mode === 'tempo' ? '' : 'Reps'}</span>
          <span />
        </div>
        {rows.map(({ s, log }) =>
          log ? (
            <SetRow
              key={log.id}
              log={log}
              number={s + 1}
              mode={mode}
              stepKg={stepKg}
              current={currentSet === s}
              timerLeft={timer?.logId === log.id ? remainingSec(timer.endsAt, now) : undefined}
              onToggleDone={() => onToggleDone(log)}
              onToggleTimer={() => onToggleTimer(log)}
            />
          ) : (
            <div key={s} className="ss-row skeleton" aria-hidden="true" />
          ),
        )}
      </div>
    </section>
  );
}
