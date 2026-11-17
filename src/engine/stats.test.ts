import { describe, expect, it } from 'vitest';
import type { Exercise, Session, SetLog } from '../domain/types';
import { exerciseProgress, summarizeSets, weekStartOf, weeklyVolumeByMuscle } from './stats';

const base = { createdAt: 0, updatedAt: 0 };
const sess = (id: string, date: string, extra: Partial<Session> = {}): Session => ({
  ...base, id, workoutId: 'w', date, startedAt: Date.parse(`${date}T12:00:00`), ...extra,
});
let n = 0;
const log = (sessionId: string, setIndex: number, weightKg: number | undefined, reps: number | undefined, extra: Partial<SetLog> = {}): SetLog => ({
  ...base, id: `l${n++}`, sessionId, workoutItemId: 'i', exerciseId: 'e1', setIndex, weightKg, reps, done: true, doneAt: 1, ...extra,
});
const ex = (id: string, muscleGroup?: string): Exercise => ({
  ...base, id, name: id, nameKey: id, aliases: [], aliasKeys: [], kind: 'forca', loadType: 'peso', muscleGroup,
});

describe('exerciseProgress', () => {
  it('um ponto por sessão, em ordem cronológica', () => {
    const sessions = [sess('b', '2026-03-10'), sess('a', '2026-03-03')];
    const logs = [
      log('b', 0, 50, 10), log('b', 1, 50, 8), log('b', 2, 40, 12, { done: false }),
      log('a', 0, 40, 10), log('a', 1, 45, 10),
    ];
    const r = exerciseProgress(logs, sessions);
    expect(r.map((p) => p.sessionId)).toEqual(['a', 'b']);
    expect(r[0]!).toEqual({
      date: '2026-03-03', sessionId: 'a', topWeightKg: 45, bestE1RM: 60, volumeKg: 850, totalReps: 20, sets: 2,
    });
    expect(r[1]!).toMatchObject({ topWeightKg: 50, volumeKg: 900, totalReps: 18, sets: 2, bestE1RM: 66.7 });
  });
  it('peso corporal: sem top nem e1RM', () => {
    const r = exerciseProgress([log('a', 0, undefined, 12), log('a', 1, undefined, 10)], [sess('a', '2026-03-03')]);
    expect(r[0]!).toMatchObject({ topWeightKg: undefined, bestE1RM: undefined, volumeKg: 0, totalReps: 22, sets: 2 });
  });
  it('ignora excluídas, sessões inexistentes e vazio', () => {
    expect(exerciseProgress([], [])).toEqual([]);
    expect(exerciseProgress([log('x', 0, 40, 10)], [])).toEqual([]);
    expect(exerciseProgress([log('a', 0, 40, 10, { deletedAt: 1 })], [sess('a', '2026-03-03')])).toEqual([]);
  });
});

describe('weekStartOf', () => {
  it('semana começa na segunda', () => {
    expect(weekStartOf('2026-03-23')).toBe('2026-03-23'); // segunda
    expect(weekStartOf('2026-03-29')).toBe('2026-03-23'); // domingo
    expect(weekStartOf('2026-03-01')).toBe('2026-02-23'); // domingo, virada de mês
    expect(weekStartOf('2026-01-01')).toBe('2025-12-29'); // virada de ano
  });
});

describe('weeklyVolumeByMuscle', () => {
  it('agrupa por semana e grupo muscular', () => {
    const sessions = [sess('a', '2026-03-23'), sess('b', '2026-03-29'), sess('c', '2026-03-30')];
    const exercises = [ex('e1', 'Peito'), ex('e2', 'Costas'), ex('e3')];
    const logs = [
      log('a', 0, 40, 10), log('a', 1, 40, 10),
      log('b', 0, 50, 10),
      log('c', 0, 50, 10),
      log('a', 0, 30, 10, { exerciseId: 'e2' }),
      log('a', 0, 20, 10, { exerciseId: 'e3' }),
      log('a', 0, 20, 10, { done: false }),
    ];
    expect(weeklyVolumeByMuscle(logs, sessions, exercises)).toEqual([
      { weekStart: '2026-03-23', muscleGroup: 'Costas', sets: 1, volumeKg: 300 },
      { weekStart: '2026-03-23', muscleGroup: 'Outros', sets: 1, volumeKg: 200 },
      { weekStart: '2026-03-23', muscleGroup: 'Peito', sets: 3, volumeKg: 1300 },
      { weekStart: '2026-03-30', muscleGroup: 'Peito', sets: 1, volumeKg: 500 },
    ]);
  });
  it('vazio', () => {
    expect(weeklyVolumeByMuscle([], [], [])).toEqual([]);
  });
});

describe('summarizeSets', () => {
  const mk = (w: Array<number | undefined>, r: Array<number | undefined>) => w.map((x, i) => log('s', i, x, r[i]));
  it('formatos', () => {
    expect(summarizeSets(mk([40, 40, 40], [12, 12, 12]))).toBe('3×12 · 40 kg');
    expect(summarizeSets(mk([40, 40, 40], [12, 10, 8]))).toBe('12/10/8 · 40 kg');
    expect(summarizeSets(mk([40, 45, 50], [10, 10, 10]))).toBe('40/45/50 kg × 10');
    expect(summarizeSets(mk([40, 45], [10, 8]))).toBe('40×10, 45×8 kg');
    expect(summarizeSets(mk([12.5, 12.5], [10, 10]))).toBe('2×10 · 12,5 kg');
    expect(summarizeSets(mk([undefined, undefined, undefined], [12, 10, 8]))).toBe('12/10/8');
    expect(summarizeSets(mk([undefined, undefined], [15, 15]))).toBe('2×15');
  });
  it('tempo', () => {
    const t = [0, 1, 2].map((i) => log('s', i, undefined, undefined, { durationSec: 30 }));
    expect(summarizeSets(t)).toBe('3×30s');
    t[1]!.durationSec = 40;
    expect(summarizeSets(t)).toBe('30/40/30s');
  });
  it('ordena por série e ignora não feitas', () => {
    const sets = [log('s', 1, 40, 10), log('s', 0, 40, 12), log('s', 2, 40, 8, { done: false })];
    expect(summarizeSets(sets)).toBe('12/10 · 40 kg');
    expect(summarizeSets([])).toBe('');
  });
});
