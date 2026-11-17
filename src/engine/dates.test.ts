import { describe, expect, it } from 'vitest';
import { todayLocal } from './dates';

describe('todayLocal', () => {
  it('usa componentes locais, com zero à esquerda', () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(todayLocal(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });
  it('sem argumento devolve uma data no formato YYYY-MM-DD', () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
