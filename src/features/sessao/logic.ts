import type { Exercise, ID, SetLog } from '../../domain/types';
import type { SuggestedSet } from '../../engine';
import type { Block } from './blocks';

// Lógica pura do player: nada aqui toca banco, relógio ou DOM.

/** Uma "vez" de execução: a série `setIndex` do exercício `itemIndex` do bloco. */
export interface Turn {
  itemIndex: number;
  setIndex: number;
  /** Rodada (0, 1, 2…): no bi-set, A1-s1 e A2-s1 são a rodada 0. */
  round: number;
}

/**
 * Ordem de execução de um bloco. Para um exercício: série 0, 1, 2…
 * Para bi-set/circuito alterna: A1 s0, A2 s0, A1 s1, A2 s1… Itens com menos séries saem das rodadas finais.
 */
export function turnOrder(setsPerItem: number[]): Turn[] {
  const turns: Turn[] = [];
  const rounds = Math.max(0, ...setsPerItem);
  for (let round = 0; round < rounds; round++) {
    setsPerItem.forEach((sets, itemIndex) => {
      if (round < sets) turns.push({ itemIndex, setIndex: round, round });
    });
  }
  return turns;
}

export function blockTurns(block: Block): Turn[] {
  return turnOrder(block.items.map((i) => i.prescription.sets));
}

export function logKey(workoutItemId: ID, setIndex: number): string {
  return `${workoutItemId}:${setIndex}`;
}

export function indexLogs(logs: SetLog[]): Map<string, SetLog> {
  const map = new Map<string, SetLog>();
  for (const l of logs) if (!l.deletedAt) map.set(logKey(l.workoutItemId, l.setIndex), l);
  return map;
}

/** Primeira série ainda não concluída, na ordem de execução. `null` se o bloco está completo. */
export function nextPendingTurn(block: Block, logs: Map<string, SetLog>): Turn | null {
  for (const t of blockTurns(block)) {
    const item = block.items[t.itemIndex]!;
    if (!logs.get(logKey(item.id, t.setIndex))?.done) return t;
  }
  return null;
}

/** A rodada terminou com esta série? (o descanso só começa depois do último item da rodada) */
export function endsRound(block: Block, turn: Pick<Turn, 'itemIndex' | 'setIndex'>): boolean {
  const turns = blockTurns(block);
  const i = turns.findIndex((t) => t.itemIndex === turn.itemIndex && t.setIndex === turn.setIndex);
  if (i < 0) return true;
  const next = turns[i + 1];
  return !next || next.round !== turns[i]!.round;
}

export interface BlockProgress {
  done: number;
  total: number;
}

export function blockProgress(block: Block, logs: Map<string, SetLog>): BlockProgress {
  let done = 0;
  let total = 0;
  for (const item of block.items) {
    for (let s = 0; s < item.prescription.sets; s++) {
      total++;
      if (logs.get(logKey(item.id, s))?.done) done++;
    }
  }
  return { done, total };
}

export function isBlockComplete(block: Block, logs: Map<string, SetLog>): boolean {
  const p = blockProgress(block, logs);
  return p.total > 0 && p.done === p.total;
}

/** Índice do primeiro bloco com séries pendentes; se tudo está feito, o último. */
export function firstPendingBlock(blocks: Block[], logs: Map<string, SetLog>): number {
  const i = blocks.findIndex((b) => !isBlockComplete(b, logs));
  return i >= 0 ? i : Math.max(0, blocks.length - 1);
}

export interface PlannedRow {
  workoutItemId: ID;
  exerciseId: ID;
  setIndex: number;
  weightKg?: number;
  reps?: number;
  durationSec?: number;
}

/**
 * Séries planejadas que ainda não existem como linha do banco.
 * `suggestions[i]` são as sugestões do `block.items[i]`.
 */
export function planMissingRows(block: Block, suggestions: SuggestedSet[][], existing: Map<string, SetLog>): PlannedRow[] {
  const rows: PlannedRow[] = [];
  block.items.forEach((item, i) => {
    const sugs = suggestions[i] ?? [];
    for (let s = 0; s < item.prescription.sets; s++) {
      if (existing.has(logKey(item.id, s))) continue;
      const sug = sugs[s] ?? sugs[sugs.length - 1];
      const row: PlannedRow = { workoutItemId: item.id, exerciseId: item.exerciseId, setIndex: s };
      if (sug?.weightKg !== undefined) row.weightKg = sug.weightKg;
      if (sug?.reps !== undefined) row.reps = sug.reps;
      if (sug?.durationSec !== undefined) row.durationSec = sug.durationSec;
      rows.push(row);
    }
  });
  return rows;
}

/** O exercício é medido por tempo (prancha, isometria)? */
export function isTimed(exercise: Pick<Exercise, 'loadType'> | undefined, durationSec: number | undefined, repsMax: number | undefined): boolean {
  if (exercise?.loadType === 'tempo') return true;
  return durationSec !== undefined && repsMax === undefined && exercise?.loadType !== 'peso';
}

// ---------- Números ----------

/** '42,5' / '42.5' → 42.5; vazio ou inválido → undefined. */
export function parseDecimal(text: string): number | undefined {
  const t = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}

/** Soma/subtrai `step` sem lixo de ponto flutuante e sem passar de zero. */
export function stepValue(current: number | undefined, step: number, dir: 1 | -1): number {
  const next = (current ?? 0) + step * dir;
  return Math.max(0, Math.round(next * 100) / 100);
}

/** 42.5 → '42,5' (sem unidade, para dentro do campo). */
export function formatNumber(n: number | undefined): string {
  if (n === undefined) return '';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/** 2520 → '42 min'; 3900 → '1h 05'; menos de um minuto → '<1 min'. */
export function formatDuration(totalSec: number): string {
  if (totalSec < 60) return '<1 min';
  const min = Math.round(totalSec / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}`;
}

// ---------- Descanso ----------

/** Segundos restantes, calculados pelo horário de término (o iOS pausa timers em segundo plano). */
export function remainingSec(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

// ---------- Propagação de peso ----------

/** Séries seguintes, do mesmo item e ainda não concluídas, que recebem o novo peso. */
export function propagationTargets(itemLogs: SetLog[], fromSetIndex: number): SetLog[] {
  return itemLogs.filter((l) => l.setIndex > fromSetIndex && !l.done && !l.deletedAt);
}

// ---------- Resumo ----------

export interface SessionSummary {
  durationSec: number;
  exerciseCount: number;
  setCount: number;
  volumeKg: number;
  progressed: Array<{ exerciseId: ID; fromKg: number; toKg: number }>;
}

function maxWeight(logs: SetLog[]): number | undefined {
  let m: number | undefined;
  for (const l of logs) if (l.weightKg !== undefined && (m === undefined || l.weightKg > m)) m = l.weightKg;
  return m;
}

/**
 * Resumo do treino. `logs` = séries desta sessão; `history` = séries concluídas de sessões anteriores.
 * "Carga subiu" = maior peso de hoje > maior peso da sessão anterior em que o exercício apareceu.
 */
export function summarizeSession(input: {
  startedAt: number;
  finishedAt: number;
  logs: SetLog[];
  history: SetLog[];
}): SessionSummary {
  const done = input.logs.filter((l) => l.done && !l.deletedAt);
  const byExercise = new Map<ID, SetLog[]>();
  let volumeKg = 0;
  for (const l of done) {
    const arr = byExercise.get(l.exerciseId) ?? [];
    arr.push(l);
    byExercise.set(l.exerciseId, arr);
    if (l.weightKg !== undefined && l.reps !== undefined) volumeKg += l.weightKg * l.reps;
  }

  const progressed: SessionSummary['progressed'] = [];
  for (const [exerciseId, logs] of byExercise) {
    const today = maxWeight(logs);
    if (today === undefined) continue;
    const sessionId = logs[0]!.sessionId;
    const past = input.history.filter((h) => h.exerciseId === exerciseId && h.done && !h.deletedAt && h.sessionId !== sessionId);
    if (past.length === 0) continue;
    const lastSessionId = [...past].sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))[0]!.sessionId;
    const prev = maxWeight(past.filter((h) => h.sessionId === lastSessionId));
    if (prev !== undefined && today > prev) progressed.push({ exerciseId, fromKg: prev, toKg: today });
  }

  return {
    durationSec: Math.max(0, Math.round((input.finishedAt - input.startedAt) / 1000)),
    exerciseCount: byExercise.size,
    setCount: done.length,
    volumeKg: Math.round(volumeKg * 100) / 100,
    progressed,
  };
}
