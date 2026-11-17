import { useEffect, useRef } from 'react';
import type { SetLog } from '../../domain/types';
import { setDuration, setReps, setWeight, stepDuration, stepReps, stepWeight } from './actions';
import { NumberField } from './NumberField';

interface Props {
  log: SetLog;
  number: number;
  mode: 'peso' | 'peso_corporal' | 'tempo';
  stepKg: number;
  /** É a série da vez no bloco. */
  current: boolean;
  /** Segundos restantes da contagem desta série (modo tempo), ou undefined se não está rodando. */
  timerLeft: number | undefined;
  onToggleDone: () => void;
  onToggleTimer: () => void;
}

const DURATION_STEP = 5;

export function SetRow({ log, number, mode, stepKg, current, timerLeft, onToggleDone, onToggleTimer }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // A série da vez fica visível sem o usuário precisar rolar.
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [current]);

  return (
    <div ref={ref} className={`ss-row ${mode} ${log.done ? 'done' : ''} ${current ? 'current' : ''}`}>
      <span className="ss-row-n" aria-label={`Série ${number}`}>
        {number}
      </span>

      {mode === 'tempo' ? (
        <>
          <NumberField
            value={log.durationSec}
            label="duração em segundos"
            inputMode="numeric"
            width={46}
            onCommit={(v) => void setDuration(log.id, v)}
            onStep={(dir) => void stepDuration(log.id, DURATION_STEP, dir)}
          />
          <button
            type="button"
            className={`ss-timer-btn ${timerLeft !== undefined ? 'running' : ''}`}
            disabled={log.done}
            onClick={onToggleTimer}
          >
            {timerLeft !== undefined ? `${timerLeft} s · parar` : '▶ Iniciar'}
          </button>
        </>
      ) : (
        <>
          {mode === 'peso' ? (
            <NumberField
              value={log.weightKg}
              label="peso em kg"
              inputMode="decimal"
              width={56}
              onCommit={(v) => void setWeight(log.id, v)}
              onStep={(dir) => void stepWeight(log.id, stepKg, dir)}
            />
          ) : (
            <span className="ss-bw">Peso corporal</span>
          )}
          <NumberField
            value={log.reps}
            label="repetições"
            inputMode="numeric"
            width={36}
            onCommit={(v) => void setReps(log.id, v)}
            onStep={(dir) => void stepReps(log.id, dir)}
          />
        </>
      )}

      <button
        type="button"
        className={`ss-check ${log.done ? 'on' : ''}`}
        aria-pressed={log.done}
        aria-label={log.done ? `Desfazer série ${number}` : `Concluir série ${number}`}
        onClick={onToggleDone}
      >
        ✓
      </button>
    </div>
  );
}
