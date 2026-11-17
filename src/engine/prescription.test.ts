import { describe, expect, it } from 'vitest';
import { parsePrescription as p } from './prescription';

describe('parsePrescription', () => {
  it.each([
    ['4x12', { sets: 4, repsMin: 12, repsMax: 12 }],
    ['4 x 12', { sets: 4, repsMin: 12, repsMax: 12 }],
    ['3×8-10', { sets: 3, repsMin: 8, repsMax: 10 }],
    ['3x8 a 10', { sets: 3, repsMin: 8, repsMax: 10 }],
    ['3x8 à 10', { sets: 3, repsMin: 8, repsMax: 10 }],
    ['3 séries de 12', { sets: 3, repsMin: 12, repsMax: 12 }],
    ['3 séries de 10 a 12', { sets: 3, repsMin: 10, repsMax: 12 }],
    ['12 reps', { sets: 1, repsMin: 12, repsMax: 12 }],
    ['3x30s', { sets: 3, durationSec: 30 }],
    ['3x30 seg', { sets: 3, durationSec: 30 }],
    ['3x1min', { sets: 3, durationSec: 60 }],
    ['3 x 2 min', { sets: 3, durationSec: 120 }],
    ['2x8 cada lado', { sets: 2, repsMin: 8, repsMax: 8, perSide: true }],
    ['3x12 por perna', { sets: 3, repsMin: 12, repsMax: 12, perSide: true }],
    ['4x12 (60s descanso)', { sets: 4, repsMin: 12, repsMax: 12, restSec: 60 }],
    ['3x10 desc 45s', { sets: 3, repsMin: 10, repsMax: 10, restSec: 45 }],
    ['3x10 descanso de 1min', { sets: 3, repsMin: 10, repsMax: 10, restSec: 60 }],
    ['3x30s descanso 60s', { sets: 3, durationSec: 30, restSec: 60 }],
    ['3x máx', { sets: 3 }],
    ['3x até a falha', { sets: 3 }],
    ['3x8-10 cada lado (90s descanso)', { sets: 3, repsMin: 8, repsMax: 10, perSide: true, restSec: 90 }],
  ])('%s', (raw, expected) => {
    expect(p(raw)).toEqual({ ...expected, raw });
  });

  it('preserva raw exatamente como veio', () => {
    expect(p('  4X12  ').raw).toBe('  4X12  ');
  });
  it('3x máx não tem reps', () => {
    const r = p('3x máx');
    expect(r.repsMin).toBeUndefined();
    expect(r.repsMax).toBeUndefined();
  });
  it('texto não reconhecido', () => {
    expect(p('até cansar')).toEqual({ sets: 1, raw: 'até cansar' });
    expect(p('')).toEqual({ sets: 1, raw: '' });
  });
  it('faixa invertida é ordenada', () => {
    expect(p('3x12-10')).toMatchObject({ repsMin: 10, repsMax: 12 });
  });
});
