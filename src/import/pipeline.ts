// PROVISÓRIO: substituir pela implementação real.
import type { ID } from '../domain/types';
import type { ImportInput } from './index';

export async function importWorkout(_input: ImportInput): Promise<ID> {
  throw new Error('Importação ainda não implementada');
}

export async function resumePendingImports(): Promise<void> {}

export async function retryVideo(_workoutId: ID): Promise<void> {}
