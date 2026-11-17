import { describe, expect, it } from 'vitest';
import { migrateLegacy } from './legacy';
import type { LegacyWorkout } from './index';

const data: LegacyWorkout[] = [
  {
    date: '2026-03-02',
    treino_do_dia: 'Peito e tríceps',
    exercises: [
      { nome: 'A1. Supino reto com halteres', grupo_muscular: 'Peito', series_reps: '3x8-10', carga_executada: '20kg cada lado', notas: 'cotovelos fechados' },
      { nome: 'Flexão', grupo_muscular: 'Peito', series_reps: '3x12', carga_executada: '' },
      { nome: 'Rosca', series_reps: '4x12', carga_executada: '12,5 kg' },
    ],
  },
  {
    date: '2026-03-09',
    exercises: [
      { nome: 'Supino reto c/ halteres', series_reps: '3×10', carga_executada: '22' },
      { nome: 'flexão', series_reps: '3x12', carga_executada: '5kg' },
      { nome: 'Rosca', series_reps: '3x30s', carga_executada: 'sem carga' },
    ],
  },
];

describe('migrateLegacy', () => {
  const r = migrateLegacy(data);

  it('um exercício por nome normalizado, com aliases', () => {
    expect(r.exercises.map((e) => e.nameKey)).toEqual(['supino reto com halter', 'flexao', 'rosca']);
    const supino = r.exercises[0]!;
    expect(supino.name).toBe('Supino reto com halteres');
    expect(supino.aliases).toEqual(['Supino reto c/ halteres']);
    expect(supino.aliasKeys).toEqual(['supino reto com halter']);
    expect(supino.muscleGroup).toBe('Peito');
    expect(supino.kind).toBe('forca');
  });

  it('loadType: peso se alguma vez teve carga', () => {
    const byKey = Object.fromEntries(r.exercises.map((e) => [e.nameKey, e.loadType]));
    expect(byKey).toEqual({ 'supino reto com halter': 'peso', flexao: 'peso', rosca: 'peso' });
    const only = migrateLegacy([{ date: '2026-03-02', exercises: [{ nome: 'Prancha', series_reps: '3x30s' }] }]);
    expect(only.exercises[0]!.loadType).toBe('peso_corporal');
    expect(only.setLogs).toEqual([]);
  });

  it('workouts, sessões e itens', () => {
    expect(r.workouts).toHaveLength(2);
    expect(r.workouts[0]!).toMatchObject({ title: 'Peito e tríceps', date: '2026-03-02', origin: 'legado', videoStatus: 'sem_video' });
    expect(r.workouts[0]!.sourceText).toBe('Supino reto com halteres 3×8-10\nFlexão 3×12\nRosca 4×12');
    expect(r.workouts[1]!.title).toBe('Treino');
    expect(r.sessions).toHaveLength(2);
    expect(r.sessions[0]!).toMatchObject({ workoutId: r.workouts[0]!.id, date: '2026-03-02' });
    expect(r.sessions[0]!.startedAt).toBe(new Date(2026, 2, 2, 12).getTime());
    expect(r.sessions[0]!.finishedAt).toBe(r.sessions[0]!.startedAt);
    expect(r.items).toHaveLength(6);
    const first = r.items[0]!;
    expect(first).toMatchObject({ order: 0, label: 'A1', match: 'alta', rawName: 'A1. Supino reto com halteres', observations: 'cotovelos fechados' });
    expect(first.prescription).toMatchObject({ sets: 3, repsMin: 8, repsMax: 10 });
    expect(new Set(r.items.map((i) => i.blockId)).size).toBe(6);
  });

  it('séries: primeiro número, sets × repsMax, legacy', () => {
    const supino = r.setLogs.filter((l) => l.exerciseId === r.exercises[0]!.id);
    expect(supino).toHaveLength(6);
    expect(supino.slice(0, 3).map((l) => [l.setIndex, l.weightKg, l.reps])).toEqual([[0, 20, 10], [1, 20, 10], [2, 20, 10]]);
    expect(supino[3]!.weightKg).toBe(22);
    const rosca = r.setLogs.filter((l) => l.exerciseId === r.exercises[2]!.id);
    expect(rosca).toHaveLength(4); // 12,5 kg na 1ª; "sem carga" na 2ª não gera séries
    expect(rosca[0]!.weightKg).toBe(12.5);
    expect(r.setLogs.every((l) => l.done && l.legacy && l.doneAt === r.sessions[l.sessionId === r.sessions[0]!.id ? 0 : 1]!.startedAt)).toBe(true);
    // flexão sem carga no dia 1 → nenhuma série; com 5kg no dia 2 → 3
    expect(r.setLogs.filter((l) => l.exerciseId === r.exercises[1]!.id)).toHaveLength(3);
  });

  it('ignora entradas malformadas sem lançar', () => {
    const bad = [
      null,
      {},
      { date: '', exercises: [{ nome: 'X', series_reps: '3x10', carga_executada: '10' }] },
      { date: '2026-13-45', exercises: [{ nome: 'X' }] },
      { date: '2026-03-02' },
      { date: '2026-03-02', exercises: [{ series_reps: '3x10' }, null, { nome: '   ' }] },
      { date: '2026-03-03', exercises: [{ nome: 'Agachamento', series_reps: '3x10', carga_executada: '40' }, { series_reps: '3x8' }] },
    ] as unknown as LegacyWorkout[];
    const out = migrateLegacy(bad);
    expect(out.workouts).toHaveLength(1);
    expect(out.items).toHaveLength(1);
    expect(out.exercises.map((e) => e.name)).toEqual(['Agachamento']);
    expect(migrateLegacy([])).toEqual({ exercises: [], workouts: [], items: [], sessions: [], setLogs: [] });
    expect(migrateLegacy(undefined as unknown as LegacyWorkout[]).workouts).toEqual([]);
  });
});
