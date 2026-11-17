import type { Exercise, Prescription, SetLog } from '../domain/types';
import type { SuggestedSet } from './index';
import { fmtNum } from './numfmt';

/** Epley. Com 1 repetição (ou menos) a estimativa é o próprio peso. */
export function estimate1RM(weightKg: number, reps: number): number {
  return reps <= 1 ? weightKg : weightKg * (1 + reps / 30);
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const roundToStep = (n: number, step: number) => round4(Math.round(n / step) * step);
const floorToStep = (n: number, step: number) => round4(Math.floor(n / step + 1e-9) * step);

/** Séries da sessão mais recente (maior `doneAt`), em ordem de série. */
function lastSession(history: SetLog[]): SetLog[] {
  const bySession = new Map<string, SetLog[]>();
  for (const s of history) {
    if (!s.done || s.deletedAt) continue;
    const list = bySession.get(s.sessionId);
    if (list) list.push(s);
    else bySession.set(s.sessionId, [s]);
  }
  let best: SetLog[] | undefined;
  let bestAt = -Infinity;
  for (const list of bySession.values()) {
    const at = Math.max(...list.map((s) => s.doneAt ?? 0));
    if (at > bestAt) {
      bestAt = at;
      best = list;
    }
  }
  return (best ?? []).slice().sort((a, b) => a.setIndex - b.setIndex);
}

/** "3×12", ou "12/10/8" quando as repetições variam. */
function describeReps(sets: SetLog[]): string {
  const reps = sets.map((s) => s.reps);
  if (reps.every((r) => r === undefined)) return `${sets.length} séries`;
  if (reps.every((r) => r === reps[0])) return `${sets.length}×${reps[0] ?? '?'}`;
  return reps.map((r) => r ?? '?').join('/');
}

function describeKg(weights: number[]): string {
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  return min === max ? `${fmtNum(min)} kg` : `${fmtNum(min)}–${fmtNum(max)} kg`;
}

function lastPrefix(sets: SetLog[]): string {
  return sets.some((s) => s.legacy) ? 'Estimativa do app antigo' : 'Última vez';
}

function repsOf(p: Prescription): { min?: number; max?: number } {
  const min = p.repsMin ?? p.repsMax;
  const max = p.repsMax ?? p.repsMin;
  return { min, max };
}

export function suggestSets(input: {
  prescription: Prescription;
  exercise: Exercise;
  history: SetLog[];
}): SuggestedSet[] {
  const { prescription, exercise } = input;
  const n = Math.max(0, prescription.sets);
  const last = lastSession(input.history);
  const { min: repsMin, max: repsMax } = repsOf(prescription);
  const fill = (make: (i: number) => Omit<SuggestedSet, 'basis' | 'reason'>, basis: SuggestedSet['basis'], reason: string) =>
    Array.from({ length: n }, (_, i) => ({ ...make(i), basis, reason }));

  // ----- por tempo -----
  if (exercise.loadType === 'tempo') {
    const lastDur = last.find((s) => s.durationSec)?.durationSec;
    const dur = prescription.durationSec ?? lastDur;
    if (!last.length) {
      return fill(() => ({ durationSec: dur }), 'sem_historico', 'Primeira vez — registre o tempo que fizer');
    }
    const reason = `${lastPrefix(last)}: ${last.length}×${lastDur ?? '?'}s → ${dur ?? '?'}s por série`;
    return fill(() => ({ durationSec: dur }), 'historico', reason);
  }

  // ----- peso corporal -----
  if (exercise.loadType === 'peso_corporal') {
    if (!last.length) {
      return fill(() => ({ reps: repsMax, durationSec: prescription.durationSec }), 'sem_historico', 'Primeira vez — registre as repetições que fizer');
    }
    const lastReps = last.map((s) => s.reps);
    const targets = Array.from({ length: n }, (_, i) => {
      const prev = lastReps[Math.min(i, lastReps.length - 1)];
      if (prev === undefined) return repsMax;
      const next = prev + 1;
      return repsMax !== undefined ? Math.min(next, repsMax) : next;
    });
    const shown = [...new Set(targets)].join('/');
    const reason = `${lastPrefix(last)}: ${describeReps(last)} → buscar ${shown} reps`;
    return Array.from({ length: n }, (_, i) => ({ reps: targets[i], basis: 'historico' as const, reason }));
  }

  // ----- peso (carga externa) -----
  const withWeight = last.filter((s) => s.weightKg !== undefined && s.weightKg > 0);
  if (!withWeight.length) {
    return fill(
      () => ({ reps: repsMax, durationSec: prescription.durationSec }),
      'sem_historico',
      'Primeira vez — registre a carga que usar',
    );
  }

  const step = exercise.weightStepKg && exercise.weightStepKg > 0 ? exercise.weightStepKg : 1;
  const prefix = lastPrefix(last);

  // Cargas por série (preenche lacunas com a série conhecida mais próxima anterior).
  let carry = withWeight[0]?.weightKg ?? 0;
  const lastWeights = last.map((s) => {
    if (s.weightKg !== undefined && s.weightKg > 0) carry = s.weightKg;
    return carry;
  });
  const lastReps = last.map((s) => s.reps);
  const weightAt = (i: number): number => lastWeights[Math.min(i, lastWeights.length - 1)] ?? carry;
  const lastRepsAt = (i: number) => lastReps[Math.min(i, lastReps.length - 1)];
  const lastDesc = `${describeReps(last)} com ${describeKg(lastWeights)}`;

  // Sem faixa de repetições na prescrição (ex.: "3x máx"): mantém a carga e as repetições anteriores.
  if (repsMin === undefined || repsMax === undefined) {
    const reason = `${prefix}: ${lastDesc} → mesma carga`;
    return Array.from({ length: n }, (_, i) => ({
      weightKg: weightAt(i),
      reps: lastRepsAt(i),
      durationSec: prescription.durationSec,
      basis: 'historico' as const,
      reason,
    }));
  }

  const doneReps = last.map((s) => s.reps).filter((r): r is number => r !== undefined);
  const bestReps = doneReps.length ? Math.max(...doneReps) : undefined;
  const sameRange = bestReps !== undefined && bestReps >= repsMin - 2 && bestReps <= repsMax + 2;

  // Faixa diferente da última vez: converte pelo 1RM estimado da melhor série.
  if (!sameRange && bestReps !== undefined) {
    let best1RM = 0;
    last.forEach((s, i) => {
      if (s.reps !== undefined) best1RM = Math.max(best1RM, estimate1RM(weightAt(i), s.reps));
    });
    const converted = Math.max(step, floorToStep(best1RM / (1 + repsMax / 30), step));
    const reason = `${prefix}: ${lastDesc} → ${fmtNum(converted)} kg para ${repsMax} reps (estimado pela melhor série)`;
    return fill(() => ({ weightKg: converted, reps: repsMax }), 'historico', reason);
  }

  const allAtTop = doneReps.length === last.length && doneReps.every((r) => r >= repsMax);
  const anyBelow = doneReps.some((r) => r < repsMin);

  if (allAtTop) {
    const weights = Array.from({ length: n }, (_, i) => {
      const w = weightAt(i);
      return round4(w + Math.max(step, roundToStep(w * 0.025, step)));
    });
    const reason = `${prefix}: ${lastDesc} → subir para ${describeKg(weights)}`;
    return weights.map((w) => ({ weightKg: w, reps: repsMin, basis: 'historico' as const, reason }));
  }

  const target = anyBelow ? repsMin : repsMax;
  const reason = `${prefix}: ${lastDesc} → mesma carga, buscar ${target} reps`;
  return Array.from({ length: n }, (_, i) => ({
    weightKg: weightAt(i),
    reps: target,
    basis: 'historico' as const,
    reason,
  }));
}
