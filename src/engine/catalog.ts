// PROVISÓRIO: implementação mínima para as telas rodarem. Substituir pela versão completa com testes.
import type { Exercise } from '../domain/types';
import type { MatchCandidate } from './index';

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function matchExercise(name: string, catalog: Exercise[]): MatchCandidate[] {
  const key = normalizeName(name);
  return catalog
    .filter((e) => e.nameKey === key || e.aliasKeys.includes(key))
    .map((exercise) => ({ exercise, score: 1 }));
}
