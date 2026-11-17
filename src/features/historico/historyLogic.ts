import type { Exercise, ID, Session, SetLog, Workout, WorkoutItem } from '../../domain/types';
import { formatKg } from '../../app/format';

export interface HistoryExercise {
  key: string;
  exerciseId: ID;
  name: string;
  summary: string;
  /** Alguma série veio do app antigo (valores aproximados). */
  estimated: boolean;
}

export interface HistoryEntry {
  session: Session;
  title: string;
  /** Duração em milissegundos, quando faz sentido. */
  durationMs?: number;
  exercises: HistoryExercise[];
  totalSets: number;
}

export interface HistoryMonth {
  /** 'YYYY-MM' */
  key: string;
  /** 'março de 2026' */
  label: string;
  entries: HistoryEntry[];
}

/**
 * Resume séries concluídas: "40 kg × 12, 12, 10 · 45 kg × 8".
 * Séries consecutivas com a mesma carga são agrupadas; sem carga vira "12, 12, 10 reps";
 * exercícios por tempo viram "30 s, 30 s".
 */
export function summarizeSets(sets: SetLog[]): string {
  const done = sets.filter((s) => s.done && !s.deletedAt).sort((a, b) => a.setIndex - b.setIndex);
  const groups: Array<{ weight: number | undefined; sets: SetLog[] }> = [];
  for (const s of done) {
    const last = groups[groups.length - 1];
    if (last && last.weight === s.weightKg) last.sets.push(s);
    else groups.push({ weight: s.weightKg, sets: [s] });
  }
  return groups
    .map((g) => {
      const values = g.sets.map((s) => (s.reps !== undefined ? String(s.reps) : s.durationSec !== undefined ? `${s.durationSec} s` : '—'));
      const list = values.join(', ');
      if (g.weight !== undefined) return `${formatKg(g.weight)} × ${list}`;
      return g.sets.some((s) => s.reps !== undefined) ? `${list} reps` : list;
    })
    .join(' · ');
}

/** 3_900_000 → '1 h 05 min'; 2_700_000 → '45 min'. Retorna undefined para durações inválidas. */
export function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 60_000) return undefined;
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export interface HistoryRows {
  sessions: Session[];
  workouts: Workout[];
  items: WorkoutItem[];
  logs: SetLog[];
  exercises: Exercise[];
}

/** Monta as entradas do histórico a partir de linhas já carregadas (consultas em lote). */
export function buildHistoryEntries(rows: HistoryRows): HistoryEntry[] {
  const workouts = new Map(rows.workouts.map((w) => [w.id, w]));
  const items = new Map(rows.items.map((i) => [i.id, i]));
  const exercises = new Map(rows.exercises.map((e) => [e.id, e]));
  const logsBySession = new Map<ID, SetLog[]>();
  for (const l of rows.logs) {
    if (l.deletedAt || !l.done) continue;
    const arr = logsBySession.get(l.sessionId);
    if (arr) arr.push(l);
    else logsBySession.set(l.sessionId, [l]);
  }

  const entries: HistoryEntry[] = [];
  for (const session of rows.sessions) {
    if (session.deletedAt || session.finishedAt === undefined) continue;
    const logs = logsBySession.get(session.id) ?? [];

    const byItem = new Map<ID, SetLog[]>();
    for (const l of logs) {
      const arr = byItem.get(l.workoutItemId);
      if (arr) arr.push(l);
      else byItem.set(l.workoutItemId, [l]);
    }
    const exs = [...byItem.entries()]
      .map(([itemId, sets]) => {
        const item = items.get(itemId);
        const exercise = exercises.get(sets[0]!.exerciseId);
        const order = item?.order ?? Number.MAX_SAFE_INTEGER;
        const firstAt = Math.min(...sets.map((s) => s.doneAt ?? s.createdAt));
        return {
          order,
          firstAt,
          ex: {
            key: itemId,
            exerciseId: sets[0]!.exerciseId,
            name: exercise?.name ?? item?.rawName ?? 'Exercício',
            summary: summarizeSets(sets),
            estimated: sets.some((s) => s.legacy),
          } satisfies HistoryExercise,
        };
      })
      .sort((a, b) => a.order - b.order || a.firstAt - b.firstAt)
      .map((x) => x.ex);

    entries.push({
      session,
      title: workouts.get(session.workoutId)?.title ?? 'Treino',
      durationMs: session.finishedAt - session.startedAt,
      exercises: exs,
      totalSets: logs.length,
    });
  }

  return entries.sort(
    (a, b) => (a.session.date === b.session.date ? b.session.finishedAt! - a.session.finishedAt! : a.session.date < b.session.date ? 1 : -1),
  );
}

/** 'YYYY-MM' → 'março de 2026' */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 15).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

/** Agrupa entradas (já ordenadas) por mês da data da sessão, mantendo a ordem. */
export function groupByMonth(entries: HistoryEntry[]): HistoryMonth[] {
  const out: HistoryMonth[] = [];
  for (const e of entries) {
    const key = e.session.date.slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.key === key) last.entries.push(e);
    else out.push({ key, label: monthLabel(key), entries: [e] });
  }
  return out;
}
