// Interpretador local de reserva: usado quando a IA não está disponível (sem chave, sem rede, sem cota).
// Uma linha por exercício; extrai rótulo, nome e prescrição. Não casa com o catálogo (isso é do pipeline).
import type { ParsedItem, ParsedWorkout } from '../ai';
import { parsePrescription } from '../engine';

/** "4x12", "3 x 8-10", "3x30s", "3 séries". */
const PRESCRIPTION = /\d+\s*[x×]\s*\d+(?:\s*[-–]\s*\d+)?\s*(?:segundos|seg|min|s)?\b|\d+\s*s[eé]ries?\b/i;
/** "A1", "B2" (letra + número) e "A)" ou "1)" sozinhos. */
const LABEL = /^(?:[-•*·]\s*)?(?:([A-Za-z]{1,2})\s?(\d{1,2})\s*[.):\-–]|([A-Za-z])\s*[.)]|(\d{1,2})\s*[.)])\s+/;
const BULLET = /^[-•*·]\s*/;

function extractLabel(line: string): { label?: string; rest: string } {
  const m = line.match(LABEL);
  if (!m) return { rest: line.replace(BULLET, '').trim() };
  const label = m[1] ? `${m[1].toUpperCase()}${m[2]}` : (m[3] ?? m[4] ?? '').toUpperCase();
  return { label, rest: line.slice(m[0].length).trim() };
}

function cleanName(s: string): string {
  return s.replace(/[\s\-–—:,;(]+$/, '').replace(/^[\s\-–—:,;)]+/, '').trim();
}

function toItem(line: string, index: number): ParsedItem {
  const { label, rest } = extractLabel(line);
  const m = rest.match(PRESCRIPTION);
  let rawName = rest;
  let prescriptionRaw = '';
  if (m && m.index !== undefined) {
    const before = cleanName(rest.slice(0, m.index));
    if (before) {
      rawName = before;
      prescriptionRaw = rest.slice(m.index).trim();
    } else {
      // prescrição escrita antes do nome: "4x12 Agachamento"
      rawName = cleanName(rest.slice(m.index + m[0].length));
      prescriptionRaw = m[0].trim();
    }
  }
  if (!rawName) rawName = rest;
  const p = parsePrescription(prescriptionRaw);
  const key = String(index + 1);
  const letters = label?.match(/^([A-Z]+)\d+$/)?.[1];

  const item: ParsedItem = {
    key,
    rawName,
    block: letters ?? (label && /^[A-Z]+$/.test(label) ? label : `item${key}`),
    prescriptionRaw,
    sets: Math.max(1, p.sets || 1),
    kind: 'forca',
    loadType: p.durationSec ? 'tempo' : 'peso',
    confidence: 'baixa',
  };
  if (label) item.label = label;
  if (p.repsMin !== undefined) item.repsMin = p.repsMin;
  if (p.repsMax !== undefined) item.repsMax = p.repsMax;
  if (p.durationSec !== undefined) item.durationSec = p.durationSec;
  if (p.restSec !== undefined) item.restSec = p.restSec;
  if (p.perSide) item.perSide = true;
  return item;
}

/**
 * Regras: linha com prescrição = exercício. Linha sem prescrição antes do primeiro exercício vira
 * título (a primeira) e, depois dele, observação do exercício anterior. Se nenhuma linha tiver
 * prescrição, cada linha não vazia vira um exercício.
 */
export function parseWorkoutTextLocal(text: string): ParsedWorkout {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const anyPrescription = lines.some((l) => PRESCRIPTION.test(l));

  let title: string | undefined;
  const items: ParsedItem[] = [];
  for (const line of lines) {
    if (!anyPrescription || PRESCRIPTION.test(line)) {
      items.push(toItem(line, items.length));
    } else if (items.length === 0) {
      title ??= line.replace(BULLET, '').replace(/[:\s]+$/, '');
    } else {
      const prev = items[items.length - 1];
      if (prev) prev.observations = prev.observations ? `${prev.observations}\n${line}` : line;
    }
  }
  return { title: title || 'Treino', items };
}
