// Dados de exemplo para desenvolvimento. No console do navegador (npm run dev):
//   await __seed()   → cria catálogo, um treino de hoje com bi-set e uma sessão passada
//   await __wipe()   → apaga o banco local
import { db, stamp } from '../db/db';
import { normalizeName, parsePrescription, todayLocal } from '../engine';
import type { Exercise, ExerciseKind, LoadType, Session, SetLog, Workout, WorkoutItem } from '../domain/types';

function exercise(name: string, kind: ExerciseKind, loadType: LoadType, muscleGroup: string): Exercise {
  return { ...stamp(), name, nameKey: normalizeName(name), aliases: [], aliasKeys: [], kind, loadType, muscleGroup };
}

async function seed(): Promise<string> {
  const ex = [
    exercise('Agachamento livre', 'forca', 'peso', 'Quadríceps'),
    exercise('Leg press 45°', 'forca', 'peso', 'Quadríceps'),
    exercise('Cadeira extensora', 'forca', 'peso', 'Quadríceps'),
    exercise('Mesa flexora', 'forca', 'peso', 'Posterior de coxa'),
    exercise('Prancha frontal', 'forca', 'tempo', 'Core'),
    exercise('Mobilidade de quadril 90/90', 'mobilidade', 'peso_corporal', 'Quadril'),
  ];
  const workout: Workout = {
    ...stamp(),
    title: 'Lower Body + Core (exemplo)',
    date: todayLocal(),
    sourceText: 'A1. Agachamento livre 4x8-10\nB1. Leg press 3x12\nC1. Cadeira extensora 3x12\nC2. Mesa flexora 3x12\nD1. Prancha 3x30s\nE1. Mobilidade 90/90 2x8 cada lado',
    origin: 'personal',
    videoStatus: 'sem_video',
  };
  const plan: Array<[number, string, string, string, string]> = [
    [0, 'A', 'A1', '4x8-10', 'Descer até paralelo, joelhos alinhados'],
    [1, 'B', 'B1', '3x12', ''],
    [2, 'C', 'C1', '3x12', 'Bi-set com a mesa flexora'],
    [3, 'C', 'C2', '3x12', ''],
    [4, 'D', 'D1', '3x30s', ''],
    [5, 'E', 'E1', '2x8 cada lado', ''],
  ];
  const items: WorkoutItem[] = plan.map(([i, block, label, raw, obs]) => ({
    ...stamp(),
    workoutId: workout.id,
    order: i,
    blockId: block,
    label,
    exerciseId: ex[i]!.id,
    rawName: ex[i]!.name,
    prescription: i === 4 ? { sets: 3, durationSec: 30, raw } : { ...parsePrescription(raw), perSide: i === 5 || undefined },
    observations: obs || undefined,
    match: 'alta',
  }));

  // Uma sessão concluída 7 dias atrás com os três primeiros exercícios.
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const past: Session = { ...stamp(), workoutId: workout.id, date: todayLocal(new Date(weekAgo)), startedAt: weekAgo, finishedAt: weekAgo + 3600_000 };
  const logs: SetLog[] = [];
  const pastLoads: Array<[number, number, number, number]> = [[0, 4, 60, 10], [1, 3, 120, 12], [2, 3, 35, 11]];
  for (const [i, sets, kg, reps] of pastLoads) {
    for (let s = 0; s < sets; s++) {
      logs.push({ ...stamp(), sessionId: past.id, workoutItemId: items[i]!.id, exerciseId: ex[i]!.id, setIndex: s, weightKg: kg, reps, done: true, doneAt: weekAgo + s * 120_000 });
    }
  }

  await db.transaction('rw', [db.exercises, db.workouts, db.workoutItems, db.sessions, db.setLogs], async () => {
    await db.exercises.bulkPut(ex);
    await db.workouts.put(workout);
    await db.workoutItems.bulkPut(items);
    await db.sessions.put(past);
    await db.setLogs.bulkPut(logs);
  });
  return workout.id;
}

async function wipe(): Promise<void> {
  await db.delete();
  location.reload();
}

Object.assign(window, { __seed: seed, __wipe: wipe, __db: db });
