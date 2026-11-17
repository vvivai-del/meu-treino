// PROVISÓRIO: implementação mínima para as telas rodarem. Substituir pela versão completa com testes.
import type { Exercise, Prescription, SetLog } from '../domain/types';
import type { SuggestedSet } from './index';

export function estimate1RM(weightKg: number, reps: number): number {
  return reps <= 1 ? weightKg : weightKg * (1 + reps / 30);
}

export function suggestSets(input: {
  prescription: Prescription;
  exercise: Exercise;
  history: SetLog[];
}): SuggestedSet[] {
  const { prescription, history } = input;
  const last = [...history].filter((s) => s.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))[0];
  return Array.from({ length: prescription.sets }, () => ({
    weightKg: last?.weightKg,
    reps: prescription.repsMax,
    durationSec: prescription.durationSec,
    basis: last ? ('historico' as const) : ('sem_historico' as const),
    reason: last ? 'Mesma carga da última vez' : 'Sem histórico ainda',
  }));
}
