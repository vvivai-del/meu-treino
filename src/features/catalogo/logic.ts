// Lógica pura do catálogo: resumo da última execução, pontos do gráfico e pares de duplicados.
import { estimate1RM, matchExercise, normalizeName, todayLocal } from '../../engine';
import { formatKg, formatRelativeDay } from '../../app/format';
import type { Exercise, ID, ISODate, LoadType, Session, SetLog } from '../../domain/types';

/** Séries concluídas de um exercício numa mesma sessão. */
export interface SessionGroup {
  sessionId: ID;
  date: ISODate;
  sortKey: number;
  sets: SetLog[];
}

/** Agrupa séries concluídas por sessão, da mais recente para a mais antiga. */
export function groupBySession(logs: SetLog[], sessions: Map<ID, Session>): SessionGroup[] {
  const map = new Map<ID, SessionGroup>();
  for (const log of logs) {
    if (!log.done || log.deletedAt) continue;
    let g = map.get(log.sessionId);
    if (!g) {
      const s = sessions.get(log.sessionId);
      g = {
        sessionId: log.sessionId,
        date: s?.date ?? todayLocal(new Date(log.doneAt ?? log.createdAt)),
        sortKey: s?.startedAt ?? log.doneAt ?? log.createdAt,
        sets: [],
      };
      map.set(log.sessionId, g);
    }
    g.sets.push(log);
  }
  const groups = [...map.values()];
  for (const g of groups) g.sets.sort((a, b) => a.setIndex - b.setIndex);
  return groups.sort((a, b) => (a.date === b.date ? b.sortKey - a.sortKey : a.date < b.date ? 1 : -1));
}

/** Sessão mais recente de cada exercício, numa única passada sobre as séries. */
export function latestByExercise(logs: SetLog[], sessions: Map<ID, Session>): Map<ID, SessionGroup> {
  const byExercise = new Map<ID, SetLog[]>();
  for (const l of logs) {
    const arr = byExercise.get(l.exerciseId);
    if (arr) arr.push(l);
    else byExercise.set(l.exerciseId, [l]);
  }
  const out = new Map<ID, SessionGroup>();
  for (const [id, arr] of byExercise) {
    const first = groupBySession(arr, sessions)[0];
    if (first) out.set(id, first);
  }
  return out;
}

const isTimed = (s: SetLog) => !s.reps && !!s.durationSec;
const hasWeight = (s: SetLog) => !!s.weightKg && s.weightKg > 0;

function setValue(s: SetLog): string {
  if (isTimed(s)) return `${s.durationSec}s`;
  return s.reps !== undefined ? String(s.reps) : '–';
}

/** "40 kg × 12, 12, 10 · 45 kg × 8"; sem carga: "12, 12, 10 reps"; por tempo: "30s, 30s". */
export function formatSets(sets: SetLog[]): string {
  const runs: Array<{ weight?: number; values: string[]; timed: boolean }> = [];
  for (const s of sets) {
    const weight = hasWeight(s) ? s.weightKg : undefined;
    const last = runs[runs.length - 1];
    if (last && last.weight === weight) last.values.push(setValue(s));
    else runs.push({ weight, values: [setValue(s)], timed: isTimed(s) });
  }
  return runs
    .map((r) => {
      const vals = r.values.join(', ');
      if (r.weight !== undefined) return `${formatKg(r.weight)} × ${vals}`;
      return r.timed ? vals : `${vals} reps`;
    })
    .join(' · ');
}

/** Melhor série da sessão: maior carga (desempate por repetições) ou mais repetições/tempo. */
function topSet(sets: SetLog[]): SetLog | undefined {
  let best: SetLog | undefined;
  const score = (s: SetLog) => (s.weightKg ?? 0) * 1000 + (s.reps ?? 0) + (s.durationSec ?? 0);
  for (const s of sets) if (!best || score(s) > score(best)) best = s;
  return best;
}

/** "40 kg × 12 · há 7 dias" */
export function summarizeLast(group: SessionGroup, today: ISODate): string {
  const s = topSet(group.sets);
  if (!s) return '';
  let what: string;
  if (hasWeight(s)) what = `${formatKg(s.weightKg)} × ${s.reps ?? '–'}`;
  else if (isTimed(s)) what = `${s.durationSec} s`;
  else what = `${s.reps ?? '–'} reps`;
  return `${what} · ${formatRelativeDay(group.date, today)}`;
}

// ---------- Gráfico de evolução ----------

export interface ChartPoint {
  sessionId: ID;
  date: ISODate;
  value: number;
}

export interface ChartData {
  points: ChartPoint[];
  /** Índice do recorde em `points` (primeira vez que o máximo foi atingido). */
  recordIndex: number;
  unit: 'kg' | 'reps' | 's';
  /** Texto do que o gráfico mede. */
  metric: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Melhor valor de cada sessão, em ordem cronológica. `groups` pode vir em qualquer ordem. */
export function buildChartData(groups: SessionGroup[], loadType: LoadType): ChartData {
  const unit = loadType === 'peso' ? 'kg' : loadType === 'tempo' ? 's' : 'reps';
  const metric = loadType === 'peso' ? '1RM estimado' : loadType === 'tempo' ? 'Maior tempo' : 'Mais repetições';
  const points: ChartPoint[] = [];
  const asc = [...groups].sort((a, b) => (a.date === b.date ? a.sortKey - b.sortKey : a.date < b.date ? -1 : 1));
  for (const g of asc) {
    let best = 0;
    for (const s of g.sets) {
      let v = 0;
      if (loadType === 'peso') v = hasWeight(s) && s.reps ? estimate1RM(s.weightKg!, s.reps) : 0;
      else if (loadType === 'tempo') v = s.durationSec ?? 0;
      else v = s.reps ?? 0;
      if (v > best) best = v;
    }
    if (best > 0) points.push({ sessionId: g.sessionId, date: g.date, value: round1(best) });
  }
  let recordIndex = -1;
  points.forEach((p, i) => {
    if (recordIndex < 0 || p.value > points[recordIndex]!.value) recordIndex = i;
  });
  return { points, recordIndex, unit, metric };
}

export interface ChartLayout {
  coords: Array<{ x: number; y: number }>;
  yMin: number;
  yMax: number;
}

/** Converte pontos em coordenadas SVG. O eixo x é proporcional ao tempo (ou uniforme se for um só dia). */
export function layoutChart(
  points: ChartPoint[],
  box: { width: number; height: number; padLeft: number; padRight: number; padTop: number; padBottom: number },
): ChartLayout {
  const values = points.map((p) => p.value);
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  if (yMax === yMin) {
    yMin -= 1;
    yMax += 1;
  } else {
    const pad = (yMax - yMin) * 0.12;
    yMin -= pad;
    yMax += pad;
  }
  const t = points.map((p) => new Date(`${p.date}T12:00:00`).getTime());
  const t0 = t[0] ?? 0;
  const span = (t[t.length - 1] ?? 0) - t0;
  const w = box.width - box.padLeft - box.padRight;
  const h = box.height - box.padTop - box.padBottom;
  const coords = points.map((_, i) => ({
    x: box.padLeft + (span > 0 ? ((t[i]! - t0) / span) * w : points.length > 1 ? (i / (points.length - 1)) * w : w / 2),
    y: box.padTop + (1 - (points[i]!.value - yMin) / (yMax - yMin)) * h,
  }));
  return { coords, yMin, yMax };
}

// ---------- Duplicados ----------

export const DUPLICATE_THRESHOLD = 0.8;

export interface DuplicatePair {
  a: Exercise;
  b: Exercise;
  score: number;
  key: string;
}

export function pairKey(idA: ID, idB: ID): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

/** Pares de exercícios ativos que o `matchExercise` considera o mesmo, sem os já dispensados. */
export function findDuplicatePairs(exercises: Exercise[], dismissed: ReadonlySet<string>): DuplicatePair[] {
  const active = exercises.filter((e) => !e.deletedAt);
  const out: DuplicatePair[] = [];
  const seen = new Set<string>();
  for (const a of active) {
    const rest = active.filter((e) => e.id !== a.id);
    for (const c of matchExercise(a.name, rest)) {
      if (c.score < DUPLICATE_THRESHOLD) continue;
      const key = pairKey(a.id, c.exercise.id);
      if (seen.has(key) || dismissed.has(key)) continue;
      seen.add(key);
      out.push({ a, b: c.exercise, score: c.score, key });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

/** Qual dos dois permanece numa fusão: o que tem vídeo; empate, o mais antigo. */
export function suggestKeeper(a: Exercise, b: Exercise): { keep: Exercise; drop: Exercise } {
  if (!!a.clip !== !!b.clip) return a.clip ? { keep: a, drop: b } : { keep: b, drop: a };
  return a.createdAt <= b.createdAt ? { keep: a, drop: b } : { keep: b, drop: a };
}

export function sortByName(list: Exercise[]): Exercise[] {
  return [...list].sort((x, y) => x.name.localeCompare(y.name, 'pt-BR', { sensitivity: 'base' }));
}

/** Candidatos a fusão: os que o `matchExercise` aponta primeiro, depois os demais em ordem alfabética. */
export function mergeCandidates(current: Exercise, all: Exercise[], query: string): Exercise[] {
  const others = all.filter((e) => !e.deletedAt && e.id !== current.id);
  const q = normalizeName(query);
  const matches = (e: Exercise) => !q || e.nameKey.includes(q) || e.aliasKeys.some((k) => k.includes(q));
  const similar = new Set(matchExercise(current.name, others).map((c) => c.exercise.id));
  const pool = others.filter(matches);
  return [...sortByName(pool.filter((e) => similar.has(e.id))), ...sortByName(pool.filter((e) => !similar.has(e.id)))];
}

/** Filtro da busca do catálogo: nome ou alias, sem acentos nem maiúsculas. */
export function matchesQuery(e: Exercise, query: string): boolean {
  const q = normalizeName(query);
  return !q || e.nameKey.includes(q) || e.aliasKeys.some((k) => k.includes(q));
}

export const KIND_LABELS: Record<Exercise['kind'], string> = {
  forca: 'Força',
  mobilidade: 'Mobilidade',
  potencia: 'Potência',
  cardio: 'Cardio',
  outro: 'Outro',
};

export const LOAD_TYPE_LABELS: Record<LoadType, string> = {
  peso: 'Peso (kg)',
  peso_corporal: 'Peso corporal',
  tempo: 'Tempo',
};
