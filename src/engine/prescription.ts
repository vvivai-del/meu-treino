// PROVISÓRIO: implementação mínima para as telas rodarem. Substituir pela versão completa com testes.
import type { Prescription } from '../domain/types';

export function parsePrescription(raw: string): Prescription {
  const m = raw.match(/(\d+)\s*[x×]\s*(\d+)(?:\s*[-a]\s*(\d+))?/i);
  if (!m) return { sets: 1, raw };
  const min = Number(m[2]);
  return { sets: Number(m[1]), repsMin: min, repsMax: m[3] ? Number(m[3]) : min, raw };
}
