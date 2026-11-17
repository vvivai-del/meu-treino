import { db, touch } from '../../db/db';
import { normalizeName } from '../../engine';
import type { Exercise } from '../../domain/types';

/**
 * Funde `sourceId` em `targetId`: treinos e séries passam a apontar para o destino,
 * os nomes da origem viram aliases do destino e a origem é excluída (logicamente).
 * Tudo numa única transação; em caso de erro nada é alterado.
 */
export async function mergeExercises(sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) throw new Error('Não é possível fundir um exercício com ele mesmo.');
  await db.transaction('rw', [db.exercises, db.workoutItems, db.setLogs], async () => {
    const source = await db.exercises.get(sourceId);
    const target = await db.exercises.get(targetId);
    if (!source || source.deletedAt) throw new Error('Exercício de origem não encontrado.');
    if (!target || target.deletedAt) throw new Error('Exercício de destino não encontrado.');

    await db.workoutItems.where('exerciseId').equals(sourceId).modify((i) => {
      i.exerciseId = targetId;
      i.updatedAt = Date.now();
    });
    await db.setLogs.where('exerciseId').equals(sourceId).modify((s) => {
      s.exerciseId = targetId;
      s.updatedAt = Date.now();
    });

    const aliases = [...target.aliases];
    const keys = new Set([target.nameKey, ...target.aliasKeys]);
    for (const name of [source.name, ...source.aliases]) {
      const key = normalizeName(name);
      if (!key || keys.has(key)) continue;
      keys.add(key);
      aliases.push(name);
    }

    const patch: Partial<Exercise> = { aliases, aliasKeys: aliases.map(normalizeName), ...touch() };
    if (!target.clip && source.clip) patch.clip = source.clip;
    if (!target.cues?.trim() && source.cues?.trim()) patch.cues = source.cues;
    if (!target.muscleGroup?.trim() && source.muscleGroup?.trim()) patch.muscleGroup = source.muscleGroup;
    if (target.weightStepKg === undefined && source.weightStepKg !== undefined) patch.weightStepKg = source.weightStepKg;
    await db.exercises.update(targetId, patch);

    const now = Date.now();
    await db.exercises.update(sourceId, { deletedAt: now, updatedAt: now });
  });
}
