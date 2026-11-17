import { beforeEach, describe, expect, it } from 'vitest';
import { db, stamp } from '../../db/db';
import { normalizeName } from '../../engine';
import type { Exercise, SetLog, WorkoutItem } from '../../domain/types';
import { mergeExercises } from './merge';

function ex(name: string, extra: Partial<Exercise> = {}): Exercise {
  return { ...stamp(), name, nameKey: normalizeName(name), aliases: [], aliasKeys: [], kind: 'forca', loadType: 'peso', ...extra };
}

function item(exerciseId: string): WorkoutItem {
  return {
    ...stamp(), workoutId: 'w1', order: 0, blockId: 'A', exerciseId, rawName: 'x',
    prescription: { sets: 3, raw: '3x10' }, match: 'alta',
  };
}

function log(exerciseId: string, setIndex: number): SetLog {
  return { ...stamp(), sessionId: 's1', workoutItemId: 'i1', exerciseId, setIndex, weightKg: 20, reps: 10, done: true, doneAt: 1 };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('mergeExercises', () => {
  it('move itens e séries, junta aliases, herda campos e exclui a origem', async () => {
    const clip = { videoId: 'v1', startSec: 1, endSec: 5 };
    const target = ex('Supino reto', { aliases: ['Bench'], aliasKeys: ['bench'] });
    const source = ex('Supino Reto Barra', { aliases: ['bench', 'Supino'], aliasKeys: ['bench', 'supino'], clip, cues: 'Escápulas juntas', muscleGroup: 'Peito', weightStepKg: 2.5 });
    await db.exercises.bulkPut([target, source]);
    await db.workoutItems.bulkPut([item(source.id), item(target.id)]);
    await db.setLogs.bulkPut([log(source.id, 0), log(source.id, 1), log(target.id, 0)]);
    const before = source.updatedAt;
    await new Promise((r) => setTimeout(r, 5));

    await mergeExercises(source.id, target.id);

    expect(await db.workoutItems.where('exerciseId').equals(source.id).count()).toBe(0);
    expect(await db.workoutItems.where('exerciseId').equals(target.id).count()).toBe(2);
    expect(await db.setLogs.where('exerciseId').equals(target.id).count()).toBe(3);
    const moved = await db.setLogs.where('exerciseId').equals(target.id).toArray();
    expect(moved.filter((l) => l.updatedAt > before).length).toBeGreaterThanOrEqual(2);

    const t = (await db.exercises.get(target.id))!;
    expect(t.aliases).toEqual(['Bench', 'Supino Reto Barra', 'Supino']);
    expect(t.aliasKeys).toEqual(['bench', 'supino reto barra', 'supino']);
    expect(t.clip).toEqual(clip);
    expect(t.cues).toBe('Escápulas juntas');
    expect(t.muscleGroup).toBe('Peito');
    expect(t.weightStepKg).toBe(2.5);
    expect(t.deletedAt).toBeUndefined();

    expect((await db.exercises.get(source.id))!.deletedAt).toBeTypeOf('number');
  });

  it('não sobrescreve campos que o destino já tem e não repete o próprio nome', async () => {
    const targetClip = { videoId: 'v2', startSec: 0, endSec: 3 };
    const target = ex('Remada curvada', { clip: targetClip, cues: 'Coluna neutra', muscleGroup: 'Costas', weightStepKg: 1 });
    const source = ex('remada  curvada!', { clip: { videoId: 'v9', startSec: 0, endSec: 1 }, cues: 'outro', muscleGroup: 'Dorso', weightStepKg: 5, aliases: ['Remada Curvada'], aliasKeys: ['remada curvada'] });
    await db.exercises.bulkPut([target, source]);

    await mergeExercises(source.id, target.id);

    const t = (await db.exercises.get(target.id))!;
    expect(t.aliases).toEqual([]);
    expect(t.aliasKeys).toEqual([]);
    expect(t.clip).toEqual(targetClip);
    expect(t.cues).toBe('Coluna neutra');
    expect(t.muscleGroup).toBe('Costas');
    expect(t.weightStepKg).toBe(1);
  });

  it('rejeita fusão consigo mesmo, id inexistente ou excluído, sem alterar nada', async () => {
    const a = ex('A');
    const b = ex('B', { deletedAt: 5 });
    await db.exercises.bulkPut([a, b]);
    await db.setLogs.put(log(a.id, 0));
    await db.setLogs.put(log(b.id, 0));

    await expect(mergeExercises(a.id, a.id)).rejects.toThrow();
    await expect(mergeExercises(a.id, 'nao-existe')).rejects.toThrow();
    await expect(mergeExercises('nao-existe', a.id)).rejects.toThrow();
    await expect(mergeExercises(a.id, b.id)).rejects.toThrow();
    await expect(mergeExercises(b.id, a.id)).rejects.toThrow();

    expect(await db.setLogs.where('exerciseId').equals(a.id).count()).toBe(1);
    expect(await db.setLogs.where('exerciseId').equals(b.id).count()).toBe(1);
    expect((await db.exercises.get(a.id))!.deletedAt).toBeUndefined();
    expect((await db.exercises.get(a.id))!.aliases).toEqual([]);
  });
});
