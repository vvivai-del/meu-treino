import { beforeEach, describe, expect, it } from 'vitest';
import { db, stamp } from '../../db/db';
import type { Exercise, Session, Workout, WorkoutItem } from '../../domain/types';
import { groupBlocks } from './blocks';
import { ensureSetRows, finishSession, setDone, setWeight, stepReps, stepWeight } from './actions';

const exercise: Exercise = {
  ...stamp(),
  name: 'Leg press',
  nameKey: 'leg press',
  aliases: [],
  aliasKeys: [],
  kind: 'forca',
  loadType: 'peso',
};
const workout: Workout = { ...stamp(), title: 'T', date: '2026-01-01', sourceText: '', origin: 'personal', videoStatus: 'sem_video' };
const item: WorkoutItem = {
  ...stamp(),
  workoutId: workout.id,
  order: 0,
  blockId: 'A',
  exerciseId: exercise.id,
  rawName: 'Leg press',
  prescription: { sets: 3, repsMin: 10, repsMax: 12, raw: '3x10-12' },
  match: 'alta',
};
const session: Session = { ...stamp(), workoutId: workout.id, date: '2026-01-01', startedAt: Date.now() };
const block = groupBlocks([item])[0]!;
const exercises = new Map([[exercise.id, exercise]]);

beforeEach(async () => {
  await Promise.all([db.setLogs.clear(), db.sessions.clear()]);
  await db.sessions.add(session);
});

describe('ensureSetRows', () => {
  it('cria uma linha por série e não duplica em chamadas concorrentes (StrictMode)', async () => {
    await Promise.all([ensureSetRows(session.id, block, exercises, []), ensureSetRows(session.id, block, exercises, [])]);
    await ensureSetRows(session.id, block, exercises, []);
    const rows = await db.setLogs.where('sessionId').equals(session.id).toArray();
    expect(rows.map((r) => r.setIndex).sort()).toEqual([0, 1, 2]);
    expect(rows.every((r) => !r.done)).toBe(true);
  });
});

describe('edição de séries', () => {
  async function rows() {
    await ensureSetRows(session.id, block, exercises, []);
    return (await db.setLogs.where('sessionId').equals(session.id).toArray()).sort((a, b) => a.setIndex - b.setIndex);
  }

  it('o peso propaga para as séries seguintes não concluídas', async () => {
    const [s0, s1, s2] = await rows();
    await setDone(s1!.id, true);
    await setWeight(s0!.id, 50);
    const after = (await rows()).map((r) => r.weightKg);
    expect(after).toEqual([50, undefined, 50]);
    expect(s2).toBeDefined();
  });

  it('toques rápidos em + não perdem passos', async () => {
    const [s0] = await rows();
    await Promise.all([stepWeight(s0!.id, 2.5, 1), stepWeight(s0!.id, 2.5, 1), stepReps(s0!.id, 1), stepReps(s0!.id, 1)]);
    const row = await db.setLogs.get(s0!.id);
    expect(row?.weightKg).toBe(5);
    expect(row?.reps).toBe(14); // sugestão inicial 12 + 2 toques
  });

  it('concluir grava doneAt; desfazer limpa', async () => {
    const [s0] = await rows();
    await setDone(s0!.id, true);
    const done = await db.setLogs.get(s0!.id);
    expect(done?.done).toBe(true);
    expect(done?.doneAt).toBeGreaterThan(0);
    await setDone(s0!.id, false);
    const undone = await db.setLogs.get(s0!.id);
    expect(undone?.done).toBe(false);
    expect(undone?.doneAt).toBeUndefined();
  });
});

describe('finishSession', () => {
  it('grava finishedAt e exclui as séries não concluídas', async () => {
    await ensureSetRows(session.id, block, exercises, []);
    const [s0] = (await db.setLogs.where('sessionId').equals(session.id).toArray()).sort((a, b) => a.setIndex - b.setIndex);
    await setDone(s0!.id, true);
    await finishSession(session.id);
    const s = await db.sessions.get(session.id);
    expect(s?.finishedAt).toBeGreaterThan(0);
    const rows = await db.setLogs.where('sessionId').equals(session.id).toArray();
    expect(rows.filter((r) => !r.deletedAt)).toHaveLength(1);
    expect(rows.filter((r) => r.deletedAt)).toHaveLength(2);
  });
});
