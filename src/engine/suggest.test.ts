import { describe, expect, it } from 'vitest';
import type { Exercise, SetLog } from '../domain/types';
import { parsePrescription } from './prescription';
import { estimate1RM, suggestSets } from './suggest';

function exercise(extra: Partial<Exercise> = {}): Exercise {
  return {
    id: 'e1', createdAt: 0, updatedAt: 0, name: 'Supino', nameKey: 'supino', aliases: [], aliasKeys: [],
    kind: 'forca', loadType: 'peso', ...extra,
  };
}

let n = 0;
function log(sessionId: string, setIndex: number, weightKg: number | undefined, reps: number | undefined, doneAt: number, extra: Partial<SetLog> = {}): SetLog {
  n++;
  return {
    id: `l${n}`, createdAt: 0, updatedAt: 0, sessionId, workoutItemId: 'i1', exerciseId: 'e1', setIndex,
    weightKg, reps, done: true, doneAt, ...extra,
  };
}
const session = (id: string, at: number, weights: Array<number | undefined>, reps: Array<number | undefined>, extra: Partial<SetLog> = {}) =>
  weights.map((w, i) => log(id, i, w, reps[i], at, extra));

const run = (raw: string, history: SetLog[], ex: Partial<Exercise> = {}) =>
  suggestSets({ prescription: parsePrescription(raw), exercise: exercise(ex), history });

describe('estimate1RM', () => {
  it('Epley', () => {
    expect(estimate1RM(100, 10)).toBeCloseTo(133.33, 1);
    expect(estimate1RM(100, 1)).toBe(100);
    expect(estimate1RM(100, 0)).toBe(100);
  });
});

describe('suggestSets: sem histórico', () => {
  it('peso indefinido, reps = repsMax', () => {
    const r = run('4x8-12', []);
    expect(r).toHaveLength(4);
    expect(r[0]!).toMatchObject({ reps: 12, basis: 'sem_historico' });
    expect(r[0]!.weightKg).toBeUndefined();
    expect(r[0]!.reason).toMatch(/Primeira vez/);
  });
  it('ignora séries não feitas e excluídas', () => {
    const h = [log('s1', 0, 40, 12, 1, { done: false }), log('s1', 1, 40, 12, 1, { deletedAt: 5 })];
    expect(run('3x12', h)[0]!.basis).toBe('sem_historico');
  });
  it('prescrição sem reps (3x máx) → reps indefinido', () => {
    expect(run('3x máx', [])[0]!.reps).toBeUndefined();
  });
});

describe('suggestSets: progressão dupla', () => {
  it('todas no topo → sobe um passo e volta a repsMin', () => {
    const h = session('s1', 100, [40, 40, 40], [12, 12, 12]);
    const r = run('3x8-12', h);
    expect(r).toHaveLength(3);
    expect(r[0]!).toMatchObject({ weightKg: 41, reps: 8, basis: 'historico' });
    expect(r[0]!.reason).toBe('Última vez: 3×12 com 40 kg → subir para 41 kg');
  });
  it('usa weightStepKg e ~2,5% arredondado ao passo (mínimo um passo)', () => {
    const h = session('s1', 100, [100, 100], [10, 10]);
    expect(run('2x8-10', h, { weightStepKg: 2.5 })[0]!.weightKg).toBe(102.5);
    expect(run('2x8-10', session('s1', 100, [20, 20], [10, 10]), { weightStepKg: 2.5 })[0]!.weightKg).toBe(22.5);
  });
  it('dentro da faixa mas abaixo do topo → mesma carga, alvo repsMax', () => {
    const r = run('3x8-12', session('s1', 100, [40, 40, 40], [12, 10, 9]));
    expect(r[0]!).toMatchObject({ weightKg: 40, reps: 12 });
    expect(r[0]!.reason).toContain('mesma carga');
    expect(r[0]!.reason).toContain('12/10/9');
  });
  it('alguma série abaixo de repsMin → mesma carga, alvo repsMin, nunca reduz', () => {
    const r = run('3x10-12', session('s1', 100, [40, 40, 40], [10, 9, 8]));
    expect(r.every((s) => s.weightKg === 40 && s.reps === 10)).toBe(true);
  });
  it('usa a sessão mais recente por doneAt, em qualquer ordem', () => {
    const h = [...session('novo', 200, [50, 50], [8, 8]), ...session('velho', 100, [40, 40], [12, 12])];
    expect(run('2x8-12', h)[0]!.weightKg).toBe(50);
    expect(run('2x8-12', [...h].reverse())[0]!.weightKg).toBe(50);
  });
  it('vírgula decimal na reason', () => {
    const r = run('2x8-12', session('s1', 100, [12.5, 12.5], [12, 12]), { weightStepKg: 2.5 });
    expect(r[0]!.weightKg).toBe(15);
    expect(r[0]!.reason).toContain('12,5 kg');
  });
  it('mais séries hoje que na última vez repete a última', () => {
    const r = run('4x8-12', session('s1', 100, [40, 40], [10, 10]));
    expect(r).toHaveLength(4);
    expect(r.every((s) => s.weightKg === 40)).toBe(true);
  });
  it('menos séries hoje', () => {
    expect(run('2x8-12', session('s1', 100, [40, 40, 40], [10, 10, 10]))).toHaveLength(2);
  });
});

describe('suggestSets: pirâmide', () => {
  it('preserva o padrão por índice (e sobe todas ao bater o topo)', () => {
    const h = session('s1', 100, [40, 45, 50], [10, 10, 10]);
    const same = run('3x8-12', h);
    expect(same.map((s) => s.weightKg)).toEqual([40, 45, 50]);
    const top = run('3x8-10', h);
    expect(top.map((s) => s.weightKg)).toEqual([41, 46, 51]);
    expect(run('5x8-12', h).map((s) => s.weightKg)).toEqual([40, 45, 50, 50, 50]);
  });
});

describe('suggestSets: faixa diferente', () => {
  it('12 reps → hoje 6–8 converte por 1RM, arredondando para baixo', () => {
    const r = run('3x6-8', session('s1', 100, [40, 40, 40], [12, 12, 12]));
    // e1RM = 56; 56 / (1 + 8/30) = 44,21 → 44
    expect(r[0]!).toMatchObject({ weightKg: 44, reps: 8, basis: 'historico' });
    expect(r[0]!.reason).toContain('44 kg');
  });
  it('respeita o passo ao arredondar', () => {
    const r = run('3x6-8', session('s1', 100, [40, 40], [12, 12]), { weightStepKg: 2.5 });
    expect(r[0]!.weightKg).toBe(42.5);
  });
  it('de força para hipertrofia reduz a carga', () => {
    const r = run('3x12', session('s1', 100, [100, 100], [5, 5]));
    expect(r[0]!.weightKg).toBeLessThan(100);
  });
});

describe('suggestSets: outros tipos', () => {
  it('peso corporal: sem peso; reps da última vez + 1 limitado a repsMax', () => {
    const h = session('s1', 100, [undefined, undefined, undefined], [8, 10, 12]);
    const r = run('3x8-12', h, { loadType: 'peso_corporal' });
    expect(r.map((s) => s.reps)).toEqual([9, 11, 12]);
    expect(r.every((s) => s.weightKg === undefined)).toBe(true);
  });
  it('peso corporal sem histórico: repsMax', () => {
    const r = run('3x8-12', [], { loadType: 'peso_corporal' });
    expect(r[0]!).toMatchObject({ reps: 12, basis: 'sem_historico' });
    expect(r[0]!.weightKg).toBeUndefined();
  });
  it('tempo: durationSec da prescrição', () => {
    const r = run('3x30s', [], { loadType: 'tempo' });
    expect(r).toHaveLength(3);
    expect(r[0]!).toMatchObject({ durationSec: 30, basis: 'sem_historico' });
    const h = run('3x45s', session('s1', 100, [undefined], [undefined]).map((l) => ({ ...l, durationSec: 30 })), { loadType: 'tempo' });
    expect(h[0]!).toMatchObject({ durationSec: 45, basis: 'historico' });
  });
});

describe('suggestSets: legado', () => {
  it('reason avisa que é estimativa do app antigo', () => {
    const r = run('3x8-12', session('s1', 100, [40, 40, 40], [10, 10, 10], { legacy: true }));
    expect(r[0]!.basis).toBe('historico');
    expect(r[0]!.reason).toMatch(/^Estimativa do app antigo/);
  });
});

describe('suggestSets: sem faixa de reps', () => {
  it('3x máx mantém carga e reps da última vez', () => {
    const r = run('3x máx', session('s1', 100, [30, 30, 30], [15, 12, 10]));
    expect(r.map((s) => [s.weightKg, s.reps])).toEqual([[30, 15], [30, 12], [30, 10]]);
  });
});
