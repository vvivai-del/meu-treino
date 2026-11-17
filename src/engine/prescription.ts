import type { Prescription } from '../domain/types';

function toSeconds(value: number, unit: string | undefined): number {
  return unit && /^min/.test(unit) ? value * 60 : value;
}

const UNIT = String.raw`(min(?:uto)?s?|seg(?:undo)?s?|s|")`;

/** Extrai o descanso ("(60s descanso)", "desc 45s", "descanso de 1min") e devolve o texto restante. */
function extractRest(t: string): { rest?: number; text: string } {
  const patterns: RegExp[] = [
    new RegExp(String.raw`\(?\s*(?:descanso|desc|intervalo|pausa)\.?\s*(?:de\s*)?(\d+)\s*${UNIT}?\s*\)?`),
    new RegExp(String.raw`\(?\s*(\d+)\s*${UNIT}\s*(?:de\s*)?(?:descanso|desc|intervalo|pausa)\.?\s*\)?`),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      // Sem unidade, descanso é em segundos.
      return { rest: toSeconds(Number(m[1]), m[2]), text: t.replace(re, ' ') };
    }
  }
  return { text: t };
}

export function parsePrescription(raw: string): Prescription {
  let t = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[–—]/g, '-');

  const restInfo = extractRest(t);
  t = restInfo.text;

  let perSide: boolean | undefined;
  const sideRe = /\b(?:cada|por)\s+(?:lado|perna|braco)\b/;
  if (sideRe.test(t)) {
    perSide = true;
    t = t.replace(sideRe, ' ');
  }

  const result: Prescription = { sets: 1, raw };
  const finish = (p: Partial<Prescription>): Prescription => {
    const out: Prescription = { ...result, ...p };
    if (out.repsMin !== undefined && out.repsMax !== undefined && out.repsMin > out.repsMax) {
      [out.repsMin, out.repsMax] = [out.repsMax, out.repsMin];
    }
    if (perSide) out.perSide = true;
    if (restInfo.rest !== undefined) out.restSec = restInfo.rest;
    return out;
  };

  const RANGE_SEP = String.raw`(?:-|a|ate)`;
  const timeAfter = String.raw`\s*${UNIT}(?![a-z])`;

  // "3x30s", "3x30 seg", "3x1min", "3 series de 45s"
  let m = t.match(new RegExp(String.raw`(\d+)\s*(?:x|series?\s*(?:de|x)?)\s*(\d+)${timeAfter}`));
  if (m) return finish({ sets: Number(m[1]), durationSec: toSeconds(Number(m[2]), m[3]) });

  // "3x máx", "3x até a falha"
  m = t.match(/(\d+)\s*(?:x|series?\s*(?:de|x)?)\s*(?:max\w*|ate\s+a\s+falha|falha)/);
  if (m) return finish({ sets: Number(m[1]) });

  // "3x8-10", "3x8 a 10", "4x12", "3 series de 12"
  m = t.match(new RegExp(String.raw`(\d+)\s*(?:x|series?\s*(?:de|x)?)\s*(\d+)(?:\s*${RANGE_SEP}\s*(\d+))?`));
  if (m) {
    const lo = Number(m[2]);
    return finish({ sets: Number(m[1]), repsMin: lo, repsMax: m[3] ? Number(m[3]) : lo });
  }

  // "12 reps" / "12 repeticoes" (uma série)
  m = t.match(new RegExp(String.raw`(\d+)(?:\s*${RANGE_SEP}\s*(\d+))?\s*(?:reps?|repeticoes)\b`));
  if (m) {
    const lo = Number(m[1]);
    return finish({ sets: 1, repsMin: lo, repsMax: m[2] ? Number(m[2]) : lo });
  }

  // "45 seg", "1 min" sozinho
  m = t.match(new RegExp(String.raw`^\s*(\d+)${timeAfter}\s*$`));
  if (m) return finish({ sets: 1, durationSec: toSeconds(Number(m[1]), m[2]) });

  return { sets: 1, raw };
}
