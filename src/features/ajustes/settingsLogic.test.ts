import { describe, expect, it } from 'vitest';
import { clampRest, isStandalone } from './settingsLogic';

describe('clampRest', () => {
  it('limita e arredonda', () => {
    expect(clampRest(0)).toBe(10);
    expect(clampRest(1e9)).toBe(600);
    expect(clampRest(62.4)).toBe(62);
    expect(clampRest(NaN)).toBe(10);
  });
});

describe('isStandalone', () => {
  it('é falso no navegador comum', () => {
    expect(isStandalone()).toBe(false);
  });
});
