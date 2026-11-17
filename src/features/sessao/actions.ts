import { db, stamp, touch } from '../../db/db';
import type { Exercise, ID, SetLog } from '../../domain/types';
import { suggestSets, type SuggestedSet } from '../../engine';
import type { Block } from './blocks';
import { indexLogs, planMissingRows, propagationTargets, stepValue } from './logic';

// Escritas do player. Cada toque vira uma transação curta no banco local.

/**
 * Cria as linhas `SetLog` planejadas (done: false) do bloco que ainda não existem.
 * Idempotente: a transação serializa chamadas concorrentes (ex.: StrictMode), e a segunda enxerga as linhas da primeira.
 * Devolve as sugestões usadas, por item.
 */
export async function ensureSetRows(
  sessionId: ID,
  block: Block,
  exercises: Map<ID, Exercise>,
  history: SetLog[],
): Promise<SuggestedSet[][]> {
  const suggestions = block.items.map((item) => {
    const exercise = exercises.get(item.exerciseId);
    if (!exercise) return [];
    return suggestSets({
      prescription: item.prescription,
      exercise,
      history: history.filter((h) => h.exerciseId === item.exerciseId),
    });
  });

  await db.transaction('rw', db.setLogs, async () => {
    const existing = indexLogs(
      await db.setLogs
        .where('sessionId')
        .equals(sessionId)
        .filter((l) => block.items.some((i) => i.id === l.workoutItemId))
        .toArray(),
    );
    const rows = planMissingRows(block, suggestions, existing);
    if (rows.length === 0) return;
    await db.setLogs.bulkAdd(rows.map((r) => ({ ...stamp(), sessionId, done: false, ...r })));
  });
  return suggestions;
}

/** Leitura-modificação-gravação atômica de uma série (toques rápidos em +/− não perdem passos). */
async function patchSet(logId: ID, change: (row: SetLog) => Partial<SetLog>): Promise<void> {
  await db.transaction('rw', db.setLogs, async () => {
    const row = await db.setLogs.get(logId);
    if (!row) return;
    await db.setLogs.update(logId, { ...change(row), ...touch() });
  });
}

async function writeWeight(row: SetLog, weightKg: number | undefined): Promise<void> {
  await db.setLogs.update(row.id, { weightKg, ...touch() });
  const siblings = await db.setLogs
    .where('sessionId')
    .equals(row.sessionId)
    .filter((l) => l.workoutItemId === row.workoutItemId)
    .toArray();
  for (const t of propagationTargets(siblings, row.setIndex)) {
    await db.setLogs.update(t.id, { weightKg, ...touch() });
  }
}

/** Define o peso e o repassa às séries seguintes do mesmo exercício que ainda não foram concluídas. */
export function setWeight(logId: ID, weightKg: number | undefined): Promise<void> {
  return db.transaction('rw', db.setLogs, async () => {
    const row = await db.setLogs.get(logId);
    if (row) await writeWeight(row, weightKg);
  });
}

export function stepWeight(logId: ID, step: number, dir: 1 | -1): Promise<void> {
  return db.transaction('rw', db.setLogs, async () => {
    const row = await db.setLogs.get(logId);
    if (row) await writeWeight(row, stepValue(row.weightKg, step, dir));
  });
}

export function setReps(logId: ID, reps: number | undefined): Promise<void> {
  return patchSet(logId, () => ({ reps }));
}

export function stepReps(logId: ID, dir: 1 | -1): Promise<void> {
  return patchSet(logId, (r) => ({ reps: stepValue(r.reps, 1, dir) }));
}

export function setDuration(logId: ID, durationSec: number | undefined): Promise<void> {
  return patchSet(logId, () => ({ durationSec }));
}

export function stepDuration(logId: ID, stepSec: number, dir: 1 | -1): Promise<void> {
  return patchSet(logId, (r) => ({ durationSec: stepValue(r.durationSec, stepSec, dir) }));
}

/** Marca como concluída (ou desfaz). */
export async function setDone(logId: ID, done: boolean): Promise<void> {
  await patchSet(logId, () => (done ? { done: true, doneAt: Date.now() } : { done: false, doneAt: undefined }));
}

/** Encerra a sessão e descarta as séries planejadas que não foram concluídas. */
export async function finishSession(sessionId: ID): Promise<void> {
  await db.transaction('rw', db.sessions, db.setLogs, async () => {
    const now = Date.now();
    const session = await db.sessions.get(sessionId);
    if (!session || session.finishedAt) return;
    await db.sessions.update(sessionId, { finishedAt: now, updatedAt: now });
    const pending = await db.setLogs
      .where('sessionId')
      .equals(sessionId)
      .filter((l) => !l.done && !l.deletedAt)
      .toArray();
    for (const l of pending) await db.setLogs.update(l.id, { deletedAt: now, updatedAt: now });
  });
}
