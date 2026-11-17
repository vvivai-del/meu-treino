import type { Exercise, ID, ISODate, Session, SetLog } from '../domain/types';
import { todayLocal } from './dates';
import { normalizeName } from './catalog';
import { fmtNum } from './numfmt';
import { estimate1RM } from './suggest';

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

const isDone = (l: SetLog) => l.done && !l.deletedAt;

export interface ExerciseProgressPoint {
  date: ISODate;
  sessionId: ID;
  topWeightKg?: number;
  bestE1RM?: number;
  volumeKg: number;
  totalReps: number;
  sets: number;
}

/** Um ponto por sessão (séries feitas), em ordem cronológica. */
export function exerciseProgress(logs: SetLog[], sessions: Session[]): ExerciseProgressPoint[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const groups = new Map<ID, SetLog[]>();
  for (const l of logs) {
    if (!isDone(l)) continue;
    const g = groups.get(l.sessionId);
    if (g) g.push(l);
    else groups.set(l.sessionId, [l]);
  }
  const points: Array<ExerciseProgressPoint & { startedAt: number }> = [];
  for (const [sessionId, group] of groups) {
    const session = sessionById.get(sessionId);
    if (!session || session.deletedAt) continue;
    let top: number | undefined;
    let e1rm: number | undefined;
    let volume = 0;
    let reps = 0;
    for (const l of group) {
      reps += l.reps ?? 0;
      if (l.weightKg !== undefined && l.weightKg > 0) {
        top = Math.max(top ?? 0, l.weightKg);
        if (l.reps !== undefined && l.reps > 0) {
          volume += l.weightKg * l.reps;
          e1rm = Math.max(e1rm ?? 0, estimate1RM(l.weightKg, l.reps));
        }
      }
    }
    points.push({
      date: session.date,
      sessionId,
      topWeightKg: top,
      bestE1RM: e1rm === undefined ? undefined : round1(e1rm),
      volumeKg: round2(volume),
      totalReps: reps,
      sets: group.length,
      startedAt: session.startedAt,
    });
  }
  points.sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt || a.sessionId.localeCompare(b.sessionId));
  return points.map(({ startedAt: _s, ...p }) => p);
}

/** Segunda-feira (data local) da semana que contém `date`. */
export function weekStartOf(date: ISODate): ISODate {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return todayLocal(dt);
}

export interface WeeklyMuscleVolume {
  weekStart: ISODate;
  muscleGroup: string;
  sets: number;
  volumeKg: number;
}

/** Séries e volume por semana (começando na segunda) e grupo muscular. Sem grupo → 'Outros'. */
export function weeklyVolumeByMuscle(logs: SetLog[], sessions: Session[], exercises: Exercise[]): WeeklyMuscleVolume[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const acc = new Map<string, WeeklyMuscleVolume>();
  for (const l of logs) {
    if (!isDone(l)) continue;
    const session = sessionById.get(l.sessionId);
    if (!session || session.deletedAt) continue;
    const label = exerciseById.get(l.exerciseId)?.muscleGroup?.trim() || 'Outros';
    const weekStart = weekStartOf(session.date);
    const key = `${weekStart}|${normalizeName(label)}`;
    let row = acc.get(key);
    if (!row) {
      row = { weekStart, muscleGroup: label, sets: 0, volumeKg: 0 };
      acc.set(key, row);
    }
    row.sets += 1;
    if (l.weightKg !== undefined && l.reps !== undefined) row.volumeKg += l.weightKg * l.reps;
  }
  return [...acc.values()]
    .map((r) => ({ ...r, volumeKg: round2(r.volumeKg) }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.muscleGroup.localeCompare(b.muscleGroup, 'pt-BR'));
}

const allEqual = <T>(xs: T[]) => xs.every((x) => x === xs[0]);

/**
 * Resumo compacto das séries feitas (em ordem de série) para listas:
 * "3×12 · 40 kg", "12/10/8 · 40 kg", "40/45/50 kg × 10", "3×30s".
 */
export function summarizeSets(logs: SetLog[]): string {
  const sets = logs.filter(isDone).sort((a, b) => a.setIndex - b.setIndex);
  if (!sets.length) return '';
  const n = sets.length;
  const weights = sets.map((s) => (s.weightKg !== undefined && s.weightKg > 0 ? s.weightKg : undefined));
  const reps = sets.map((s) => s.reps);
  const hasWeight = weights.some((w) => w !== undefined);
  const hasReps = reps.some((r) => r !== undefined);

  if (!hasWeight && !hasReps) {
    const durs = sets.map((s) => s.durationSec);
    if (durs.every((d) => d === undefined)) return `${n} ${n === 1 ? 'série' : 'séries'}`;
    return allEqual(durs) ? `${n}×${durs[0]}s` : `${durs.map((d) => d ?? '?').join('/')}s`;
  }

  const w = (x: number | undefined) => (x === undefined ? '?' : fmtNum(x));
  const r = (x: number | undefined) => (x === undefined ? '?' : String(x));

  if (!hasReps) return allEqual(weights) ? `${n}× ${w(weights[0])} kg` : `${weights.map(w).join('/')} kg`;

  const sameReps = allEqual(reps);
  const repsText = sameReps ? `${n}×${r(reps[0])}` : reps.map(r).join('/');
  if (!hasWeight) return repsText;

  if (allEqual(weights)) return `${repsText} · ${w(weights[0])} kg`;
  if (sameReps) return `${weights.map(w).join('/')} kg × ${r(reps[0])}`;
  return `${sets.map((_, i) => `${w(weights[i])}×${r(reps[i])}`).join(', ')} kg`;
}
