import { beforeEach, describe, expect, it } from 'vitest';
import { db, stamp } from '../../db/db';
import type { Exercise, Workout, WorkoutItem } from '../../domain/types';
import { confirmMatch, deleteWorkout, rejectMatch, startOrResumeSession } from './actions';
import { formatSuggestion, inferLoadType } from './logic';

const base = { basis: 'sem_historico' as const, reason: '' };

describe('formatSuggestion', () => {
  it('peso e repetições', () => {
    expect(formatSuggestion({ ...base, weightKg: 42.5, reps: 12 }, 'peso')).toBe('42,5 kg × 12');
  });
  it('sem carga anterior mostra só as repetições', () => {
    expect(formatSuggestion({ ...base, reps: 12 }, 'peso')).toBe('12 reps');
  });
  it('tempo', () => {
    expect(formatSuggestion({ ...base, durationSec: 30 }, 'tempo')).toBe('30 s');
  });
  it('peso corporal', () => {
    expect(formatSuggestion({ ...base, reps: 8 }, 'peso_corporal')).toBe('8 reps');
  });
  it('nada a mostrar', () => {
    expect(formatSuggestion(undefined, 'peso')).toBeNull();
    expect(formatSuggestion({ ...base }, 'peso')).toBeNull();
  });
  it('deduz o tipo de medida de um exercício novo', () => {
    expect(inferLoadType({ sets: 3, durationSec: 30, raw: '3x30s' })).toBe('tempo');
    expect(inferLoadType({ sets: 3, repsMax: 12, raw: '3x12' })).toBe('peso');
  });
});

const catalogEx: Exercise = {
  ...stamp(),
  name: 'Agachamento livre',
  nameKey: 'agachamento livre',
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
  exerciseId: catalogEx.id,
  rawName: 'Agacho no smith',
  prescription: { sets: 3, repsMax: 10, raw: '3x10' },
  match: 'baixa',
};

beforeEach(async () => {
  await Promise.all([db.exercises.clear(), db.workouts.clear(), db.workoutItems.clear(), db.sessions.clear()]);
  await db.exercises.add(catalogEx);
  await db.workouts.add(workout);
  await db.workoutItems.add(item);
});

describe('confirmar casamento', () => {
  it('"Sim" vira alta e o nome escrito entra nos aliases', async () => {
    await confirmMatch(item.id);
    expect((await db.workoutItems.get(item.id))?.match).toBe('alta');
    const ex = await db.exercises.get(catalogEx.id);
    expect(ex?.aliases).toEqual(['Agacho no smith']);
    expect(ex?.aliasKeys).toEqual(['agacho no smith']);
  });

  it('confirmar duas vezes não duplica o alias', async () => {
    await confirmMatch(item.id);
    await confirmMatch(item.id);
    expect((await db.exercises.get(catalogEx.id))?.aliases).toHaveLength(1);
  });

  it('"Não, é outro" cria um exercício novo e aponta o item para ele', async () => {
    await rejectMatch(item.id);
    const updated = await db.workoutItems.get(item.id);
    expect(updated?.match).toBe('novo');
    expect(updated?.exerciseId).not.toBe(catalogEx.id);
    const created = await db.exercises.get(updated!.exerciseId);
    expect(created?.name).toBe('Agacho no smith');
    expect(await db.exercises.count()).toBe(2);
  });
});

describe('sessão', () => {
  it('nunca cria uma segunda sessão em andamento', async () => {
    const [a, b] = await Promise.all([startOrResumeSession(workout.id), startOrResumeSession(workout.id)]);
    expect(a).toBe(b);
    expect(await db.sessions.count()).toBe(1);
  });

  it('depois de concluída, uma nova sessão pode começar', async () => {
    const a = await startOrResumeSession(workout.id);
    await db.sessions.update(a, { finishedAt: Date.now() });
    const b = await startOrResumeSession(workout.id);
    expect(b).not.toBe(a);
  });

  it('excluir o treino é lógico e descarta a sessão em andamento', async () => {
    const s = await startOrResumeSession(workout.id);
    await deleteWorkout(workout.id);
    expect((await db.workouts.get(workout.id))?.deletedAt).toBeGreaterThan(0);
    expect((await db.sessions.get(s))?.deletedAt).toBeGreaterThan(0);
  });
});
