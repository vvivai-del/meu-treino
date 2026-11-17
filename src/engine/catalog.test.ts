import { describe, expect, it } from 'vitest';
import type { Exercise } from '../domain/types';
import { matchExercise, normalizeName } from './catalog';

function ex(name: string, aliases: string[] = [], extra: Partial<Exercise> = {}): Exercise {
  return {
    id: name,
    createdAt: 0,
    updatedAt: 0,
    name,
    nameKey: normalizeName(name),
    aliases,
    aliasKeys: aliases.map(normalizeName),
    kind: 'forca',
    loadType: 'peso',
    ...extra,
  };
}

const score = (a: string, b: string) => matchExercise(a, [ex(b)])[0]?.score ?? 0;

describe('normalizeName', () => {
  it('remove acentos, caixa e pontuação', () => {
    expect(normalizeName('  Agachamento   Búlgaro! ')).toBe('agachamento bulgaro');
  });
  it('remove rótulos do personal', () => {
    expect(normalizeName('A1. Cadeira extensora')).toBe('cadeira extensora');
    expect(normalizeName('B2 - Supino reto')).toBe('supino reto');
    expect(normalizeName('1) Remada baixa')).toBe('remada baixa');
    expect(normalizeName('3 - Rosca direta')).toBe('rosca direta');
  });
  it('não come números que fazem parte do nome', () => {
    expect(normalizeName('Leg press 45')).toBe('leg press 45');
    expect(normalizeName('Leg press 45°')).toBe('leg press 45');
    expect(normalizeName('Leg press 45 graus')).toBe('leg press 45');
  });
  it('c/ vira com e plurais de equipamento são normalizados', () => {
    expect(normalizeName('Supino c/ halteres')).toBe('supino com halter');
    expect(normalizeName('Abdução com elásticos')).toBe('abducao com elastico');
  });
  it('preserva palavras que distinguem exercícios', () => {
    for (const w of ['búlgaro', 'unilateral', 'inclinado', 'sumô', 'frontal']) {
      expect(normalizeName(`Agachamento ${w}`)).toContain(normalizeName(w));
    }
  });
});

describe('matchExercise', () => {
  it('Agachamento × Agachamento búlgaro não passa de 0.8', () => {
    expect(score('Agachamento', 'Agachamento búlgaro')).toBeLessThan(0.8);
    expect(score('Agachamento búlgaro', 'Agachamento')).toBeLessThan(0.8);
  });
  it('Leg press 45 × Leg press 45° = 1', () => {
    expect(score('Leg press 45', 'Leg press 45°')).toBe(1);
  });
  it('halteres × halter ≥ 0.9', () => {
    expect(score('Supino reto com halteres', 'Supino reto halter')).toBeGreaterThanOrEqual(0.9);
  });
  it('Remada curvada × Remada alta < 0.8', () => {
    expect(score('Remada curvada', 'Remada alta')).toBeLessThan(0.8);
  });
  it('rótulo é ignorado', () => {
    expect(score('A1. Cadeira extensora', 'Cadeira Extensora')).toBe(1);
  });
  it('alias vale 1', () => {
    const e = ex('Puxada frontal', ['Pulley frente']);
    expect(matchExercise('Pulley Frente', [e])[0]).toMatchObject({ score: 1 });
  });
  it('ordena por score e ignora abaixo de 0.5', () => {
    const catalog = [ex('Agachamento búlgaro'), ex('Agachamento'), ex('Rosca direta')];
    const r = matchExercise('Agachamento', catalog);
    expect(r.map((c) => c.exercise.name)).toEqual(['Agachamento', 'Agachamento búlgaro']);
    expect(r[0]!.score).toBe(1);
  });
  it('ignora excluídos', () => {
    expect(matchExercise('Agachamento', [ex('Agachamento', [], { deletedAt: 5 })])).toEqual([]);
  });
  it('unilateral/inclinado/sumô distinguem', () => {
    expect(score('Supino inclinado', 'Supino reto')).toBeLessThan(0.8);
    expect(score('Agachamento sumô', 'Agachamento')).toBeLessThan(0.8);
    expect(score('Leg press 45', 'Leg press 90')).toBeLessThan(0.8);
    expect(score('Rosca unilateral', 'Rosca')).toBeLessThan(0.8);
  });
  it('catálogo vazio ou nome vazio', () => {
    expect(matchExercise('Supino', [])).toEqual([]);
    expect(matchExercise('  ', [ex('Supino')])).toEqual([]);
  });
});
