import type { Exercise } from '../domain/types';
import type { MatchCandidate } from './index';

/** Rótulo do personal no início: "A1.", "B2 -", "1)", "3 -". */
const LABEL_RE = /^\s*([a-z]\d{1,2}|\d{1,2})\s*[.)\-–—:]+\s*/i;

/** Plurais simples de equipamentos (já sem acento e minúsculos). */
const PLURALS: Record<string, string> = {
  halteres: 'halter',
  halters: 'halter',
  elasticos: 'elastico',
  elasticas: 'elastico',
  anilhas: 'anilha',
  caneleiras: 'caneleira',
  kettlebells: 'kettlebell',
  cabos: 'cabo',
  polias: 'polia',
  barras: 'barra',
  bandas: 'banda',
  cordas: 'corda',
  bolas: 'bola',
  steps: 'step',
  bancos: 'banco',
};

/** Palavras que não distinguem exercícios. */
const STOPWORDS = new Set([
  'de', 'do', 'da', 'dos', 'das', 'com', 'no', 'na', 'nos', 'nas', 'em', 'o', 'a', 'os', 'as',
  'para', 'pra', 'e', 'ao', 'um', 'uma',
]);

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Separa o rótulo do personal ("A1.") do nome de exibição. */
export function splitLabel(name: string): { label?: string; name: string } {
  const m = name.match(LABEL_RE);
  if (!m) return { name: name.trim() };
  return { label: (m[1] ?? '').toUpperCase(), name: name.slice(m[0].length).trim() };
}

export function normalizeName(name: string): string {
  let s = stripAccents(name).toLowerCase();
  s = s.replace(LABEL_RE, '');
  s = s.replace(/\bc\s*\/\s*/g, ' com ');
  s = s.replace(/[°º˚]/g, ' ');
  s = s.replace(/\bgraus?\b/g, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  return s
    .split(' ')
    .filter(Boolean)
    .map((t) => PLURALS[t] ?? t)
    .join(' ');
}

function contentTokens(key: string): string[] {
  const all = key.split(' ').filter(Boolean);
  const t = all.filter((w) => !STOPWORDS.has(w));
  return t.length ? t : all;
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** Tokens equivalentes: iguais, ou quase iguais (typo/gênero) quando longos o bastante. */
function sameToken(a: string, b: string): boolean {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  return a.length >= 6 && b.length >= 6 && editDistanceAtMost1(a, b);
}

/** Similaridade entre duas chaves normalizadas diferentes. */
function similarity(keyA: string, keyB: string): number {
  const a = contentTokens(keyA);
  const b = contentTokens(keyB);
  if (!a.length || !b.length) return 0;
  const usedB = new Set<number>();
  let common = 0;
  for (const ta of a) {
    const j = b.findIndex((tb, idx) => !usedB.has(idx) && sameToken(ta, tb));
    if (j >= 0) {
      usedB.add(j);
      common++;
    }
  }
  const unmatched = a.length - common + (b.length - common);
  const union = a.length + b.length - common;
  // Mesmos tokens (só ordem/palavras vazias/plural mudam): quase certo, mas só a chave idêntica vale 1.
  if (unmatched === 0) return 0.95;
  // Token distintivo sem par de um dos lados: no máximo "talvez" (nunca auto-aceito).
  return Math.min(common / union, 0.79);
}

export function matchExercise(name: string, catalog: Exercise[]): MatchCandidate[] {
  const key = normalizeName(name);
  if (!key) return [];
  const out: MatchCandidate[] = [];
  for (const exercise of catalog) {
    if (exercise.deletedAt) continue;
    let score = 0;
    for (const k of [exercise.nameKey, ...exercise.aliasKeys]) {
      if (!k) continue;
      score = Math.max(score, k === key ? 1 : similarity(key, k));
      if (score === 1) break;
    }
    if (score >= 0.5) out.push({ exercise, score });
  }
  return out.sort((x, y) => y.score - x.score);
}
