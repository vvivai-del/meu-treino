// Motor de regras: funções puras, sem rede, sem banco, sem IA.
// Tudo aqui precisa ser instantâneo e coberto por testes.
//
// CONTRATO — as assinaturas abaixo são usadas pelas telas e pela importação.
// As implementações vivem em arquivos próprios desta pasta e são reexportadas aqui.

import type { Exercise, ISODate, Prescription, SetLog } from '../domain/types';

/** Série sugerida para pré-preencher o player. */
export interface SuggestedSet {
  weightKg?: number;
  reps?: number;
  durationSec?: number;
  /** 'historico' quando veio de séries anteriores; 'sem_historico' quando é só a prescrição. */
  basis: 'historico' | 'sem_historico';
  /** Frase curta em pt-BR para a interface, ex.: "Última vez: 3×12 com 40 kg → subir para 42 kg". */
  reason: string;
}

export interface MatchCandidate {
  exercise: Exercise;
  /** 0 a 1. 1 = nome ou alias idêntico após normalização. */
  score: number;
}

/** Linhas do `localStorage.workoutHistory` do app antigo. */
export interface LegacyWorkout {
  date: string;
  treino_do_dia?: string;
  notas_adaptacao?: string;
  exercises?: Array<{
    nome?: string;
    grupo_muscular?: string;
    series_reps?: string;
    carga_sugerida?: string;
    carga_executada?: string;
    notas?: string;
  }>;
}

export { todayLocal } from './dates';
export { normalizeName, matchExercise } from './catalog';
export { parsePrescription } from './prescription';
export { suggestSets, estimate1RM } from './suggest';
export { migrateLegacy } from './legacy';

// Assinaturas de referência (a implementação deve respeitá-las):
//
// todayLocal(now?: Date): ISODate
//   Data LOCAL 'YYYY-MM-DD'. Nunca usar toISOString() (dá o dia errado à noite no Brasil).
//
// normalizeName(name: string): string
//   Minúsculas, sem acentos, sem pontuação, espaços colapsados, sem rótulos tipo "A1." no início.
//
// matchExercise(name: string, catalog: Exercise[]): MatchCandidate[]
//   Candidatos ordenados por score decrescente (só score >= 0.5). Compara com name e aliases.
//   "Agachamento" NÃO pode casar com score alto com "Agachamento búlgaro".
//
// parsePrescription(raw: string): Prescription
//   '4x12', '3 x 8-10', '3x30s', '3x12 cada lado', '4x12 (60s descanso)' …
//
// suggestSets(input: { prescription: Prescription; exercise: Exercise; history: SetLog[] }): SuggestedSet[]
//   Retorna exatamente `prescription.sets` séries. `history` = séries `done` deste exercício,
//   em qualquer ordem, de qualquer sessão.
//
// estimate1RM(weightKg: number, reps: number): number   (Epley)
//
// migrateLegacy(legacy: LegacyWorkout[]): {
//   exercises: Exercise[]; workouts: Workout[]; items: WorkoutItem[]; sessions: Session[]; setLogs: SetLog[];
// }

export type { Exercise, ISODate, Prescription, SetLog };
