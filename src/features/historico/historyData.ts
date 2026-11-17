import type { TreinoDB } from '../../db/db';
import { touch } from '../../db/db';
import type { ID } from '../../domain/types';
import { buildHistoryEntries, type HistoryEntry } from './historyLogic';

/** Carrega o histórico com consultas em lote (uma por tabela, não uma por linha). */
export async function loadHistory(db: TreinoDB): Promise<HistoryEntry[]> {
  const sessions = await db.sessions.filter((s) => !s.deletedAt && s.finishedAt !== undefined).toArray();
  if (sessions.length === 0) return [];
  const sessionIds = sessions.map((s) => s.id);
  const workoutIds = [...new Set(sessions.map((s) => s.workoutId))];

  const logs = await db.setLogs.where('sessionId').anyOf(sessionIds).filter((l) => l.done && !l.deletedAt).toArray();
  const itemIds = [...new Set(logs.map((l) => l.workoutItemId))];
  const exerciseIds = [...new Set(logs.map((l) => l.exerciseId))];

  const [workouts, items, exercises] = await Promise.all([
    db.workouts.bulkGet(workoutIds),
    db.workoutItems.bulkGet(itemIds),
    db.exercises.bulkGet(exerciseIds),
  ]);
  return buildHistoryEntries({
    sessions,
    logs,
    workouts: workouts.filter((x) => !!x),
    items: items.filter((x) => !!x),
    exercises: exercises.filter((x) => !!x),
  });
}

/** Exclusão lógica da sessão e de todas as suas séries. */
export async function deleteSession(db: TreinoDB, sessionId: ID): Promise<void> {
  await db.transaction('rw', [db.sessions, db.setLogs], async () => {
    const now = { deletedAt: Date.now(), ...touch() };
    await db.sessions.update(sessionId, now);
    await db.setLogs.where('sessionId').equals(sessionId).modify(now);
  });
}
