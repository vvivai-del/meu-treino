// PROVISÓRIO: substituir pela versão completa com testes.
import type { Exercise, Session, SetLog, Workout, WorkoutItem } from '../domain/types';
import type { LegacyWorkout } from './index';

export function migrateLegacy(_legacy: LegacyWorkout[]): {
  exercises: Exercise[];
  workouts: Workout[];
  items: WorkoutItem[];
  sessions: Session[];
  setLogs: SetLog[];
} {
  return { exercises: [], workouts: [], items: [], sessions: [], setLogs: [] };
}
