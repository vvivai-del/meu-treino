import { beforeEach, describe, expect, it } from 'vitest';
import { canImport, clearDraft, DRAFT_KEY, errorMessage, formatBytes, loadDraft, saveDraft, tomorrowLocal } from './importLogic';

describe('formatBytes', () => {
  it('formata unidades', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(700 * 1024 * 1024)).toBe('700 MB');
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2,5 GB');
  });
});

describe('tomorrowLocal', () => {
  it('vira o mês e o ano', () => {
    expect(tomorrowLocal(new Date(2026, 0, 31, 23, 30))).toBe('2026-02-01');
    expect(tomorrowLocal(new Date(2026, 11, 31, 0, 5))).toBe('2027-01-01');
  });
});

describe('canImport', () => {
  it('exige texto, data válida e não estar ocupado', () => {
    expect(canImport('A1. Agachamento', '2026-03-23', false)).toBe(true);
    expect(canImport('   \n', '2026-03-23', false)).toBe(false);
    expect(canImport('x', '', false)).toBe(false);
    expect(canImport('x', '2026-03-23', true)).toBe(false);
  });
});

describe('errorMessage', () => {
  it('extrai mensagem', () => {
    expect(errorMessage(new Error('falhou'))).toBe('falhou');
    expect(errorMessage(undefined)).toMatch(/Não foi possível/);
  });
});

describe('rascunho', () => {
  beforeEach(() => localStorage.clear());
  it('salva, recarrega e limpa', () => {
    expect(loadDraft()).toBe('');
    saveDraft('3x12 leg press');
    expect(loadDraft()).toBe('3x12 leg press');
    clearDraft();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
  it('texto vazio remove o rascunho', () => {
    saveDraft('abc');
    saveDraft('');
    expect(loadDraft()).toBe('');
  });
  it('tolera armazenamento que lança', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(loadDraft(bad)).toBe('');
    expect(() => saveDraft('a', bad)).not.toThrow();
    expect(() => clearDraft(bad)).not.toThrow();
  });
});
