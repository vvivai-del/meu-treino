import { formatKg } from '../../app/format';
import type { LoadType, Prescription } from '../../domain/types';
import type { SuggestedSet } from '../../engine';

/** Resumo curto da primeira série sugerida: '40 kg × 12', '12 reps', '30 s'. `null` se não há o que mostrar. */
export function formatSuggestion(set: SuggestedSet | undefined, loadType: LoadType): string | null {
  if (!set) return null;
  if (loadType === 'tempo') return set.durationSec !== undefined ? `${set.durationSec} s` : null;
  if (loadType === 'peso' && set.weightKg !== undefined) {
    return set.reps !== undefined ? `${formatKg(set.weightKg)} × ${set.reps}` : formatKg(set.weightKg);
  }
  if (set.reps !== undefined) return `${set.reps} reps`;
  if (set.durationSec !== undefined) return `${set.durationSec} s`;
  return null;
}

/** Tipo de medida de um exercício novo, deduzido da prescrição escrita pelo personal. */
export function inferLoadType(prescription: Prescription): LoadType {
  return prescription.durationSec !== undefined && prescription.repsMax === undefined ? 'tempo' : 'peso';
}
