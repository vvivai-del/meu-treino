import { db, stamp, touch } from '../../db/db';
import type { Exercise, ID, ISODate, Session } from '../../domain/types';
import { normalizeName, todayLocal } from '../../engine';
import { inferLoadType } from './logic';

// Escritas da visão geral do treino.

/** "É o mesmo exercício": confirma o casamento e guarda o nome escrito como alias. */
export async function confirmMatch(itemId: ID): Promise<void> {
  await db.transaction('rw', db.workoutItems, db.exercises, async () => {
    const item = await db.workoutItems.get(itemId);
    if (!item) return;
    const exercise = await db.exercises.get(item.exerciseId);
    if (exercise) {
      const key = normalizeName(item.rawName);
      if (key && key !== exercise.nameKey && !exercise.aliasKeys.includes(key)) {
        await db.exercises.update(exercise.id, {
          aliases: [...exercise.aliases, item.rawName],
          aliasKeys: [...exercise.aliasKeys, key],
          ...touch(),
        });
      }
    }
    await db.workoutItems.update(itemId, { match: 'alta', ...touch() });
  });
}

/** "Não, é outro": cria (ou reaproveita, se o nome já existe) um exercício a partir do nome escrito. */
export async function rejectMatch(itemId: ID): Promise<void> {
  await db.transaction('rw', db.workoutItems, db.exercises, async () => {
    const item = await db.workoutItems.get(itemId);
    if (!item) return;
    const key = normalizeName(item.rawName);
    const sameName = (await db.exercises.where('nameKey').equals(key).toArray()).find(
      (e) => !e.deletedAt && e.id !== item.exerciseId,
    );
    if (sameName) {
      await db.workoutItems.update(itemId, { exerciseId: sameName.id, match: 'alta', ...touch() });
      return;
    }
    const created: Exercise = {
      ...stamp(),
      name: item.rawName,
      nameKey: key,
      aliases: [],
      aliasKeys: [],
      kind: 'forca',
      loadType: inferLoadType(item.prescription),
    };
    await db.exercises.add(created);
    await db.workoutItems.update(itemId, { exerciseId: created.id, match: 'novo', ...touch() });
  });
}

/** Inicia o treino, ou devolve a sessão em andamento. Nunca cria uma segunda sessão aberta. */
export async function startOrResumeSession(workoutId: ID): Promise<ID> {
  return db.transaction('rw', db.sessions, async () => {
    const open = await db.sessions
      .where('workoutId')
      .equals(workoutId)
      .filter((s) => !s.finishedAt && !s.deletedAt)
      .first();
    if (open) return open.id;
    const session: Session = { ...stamp(), workoutId, date: todayLocal(), startedAt: Date.now() };
    await db.sessions.add(session);
    return session.id;
  });
}

export async function changeDate(workoutId: ID, date: ISODate): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  await db.workouts.update(workoutId, { date, ...touch() });
}

/** Exclusão lógica do treino e da sessão em andamento (as sessões concluídas continuam no histórico). */
export async function deleteWorkout(workoutId: ID): Promise<void> {
  await db.transaction('rw', db.workouts, db.sessions, async () => {
    const now = Date.now();
    await db.workouts.update(workoutId, { deletedAt: now, updatedAt: now });
    const open = await db.sessions
      .where('workoutId')
      .equals(workoutId)
      .filter((s) => !s.finishedAt && !s.deletedAt)
      .toArray();
    for (const s of open) await db.sessions.update(s.id, { deletedAt: now, updatedAt: now });
  });
}
