import { describe, expect, it } from 'vitest';
import { stamp } from '../../db/db';
import { normalizeName } from '../../engine';
import type { Exercise, Session, SetLog } from '../../domain/types';
import {
  buildChartData, findDuplicatePairs, formatSets, groupBySession, latestByExercise, layoutChart,
  matchesQuery, mergeCandidates, pairKey, suggestKeeper, summarizeLast,
} from './logic';

function ex(name: string, extra: Partial<Exercise> = {}): Exercise {
  return { ...stamp(), name, nameKey: normalizeName(name), aliases: [], aliasKeys: [], kind: 'forca', loadType: 'peso', ...extra };
}

function log(sessionId: string, setIndex: number, weightKg: number | undefined, reps: number | undefined, extra: Partial<SetLog> = {}): SetLog {
  return { ...stamp(), sessionId, workoutItemId: 'i', exerciseId: 'e1', setIndex, weightKg, reps, done: true, doneAt: 1000, ...extra };
}

function session(id: string, date: string, startedAt: number): Session {
  return { ...stamp(), id, workoutId: 'w', date, startedAt };
}

const sessions = new Map<string, Session>([
  ['s1', session('s1', '2026-03-01', 100)],
  ['s2', session('s2', '2026-03-08', 200)],
  ['s3', session('s3', '2026-03-15', 300)],
]);

describe('groupBySession', () => {
  it('ordena da mais recente para a mais antiga, ignora não concluídas e excluídas', () => {
    const logs = [
      log('s1', 0, 40, 10), log('s3', 1, 50, 8), log('s3', 0, 50, 8), log('s2', 0, 45, 10),
      log('s2', 1, 45, 10, { done: false }), log('s2', 2, 45, 10, { deletedAt: 1 }),
    ];
    const g = groupBySession(logs, sessions);
    expect(g.map((x) => x.sessionId)).toEqual(['s3', 's2', 's1']);
    expect(g[0]!.sets.map((s) => s.setIndex)).toEqual([0, 1]);
    expect(g[1]!.sets).toHaveLength(1);
  });

  it('usa a data local do doneAt quando a sessão não existe', () => {
    const g = groupBySession([log('x', 0, 10, 10, { doneAt: new Date(2026, 0, 5, 23, 30).getTime() })], new Map());
    expect(g[0]!.date).toBe('2026-01-05');
  });
});

describe('latestByExercise', () => {
  it('pega a sessão mais recente de cada exercício', () => {
    const logs = [log('s1', 0, 40, 10), log('s2', 0, 45, 10), log('s1', 0, 10, 5, { exerciseId: 'e2' })];
    const m = latestByExercise(logs, sessions);
    expect(m.get('e1')!.sessionId).toBe('s2');
    expect(m.get('e2')!.sessionId).toBe('s1');
  });
});

describe('formatSets / summarizeLast', () => {
  it('agrupa séries com a mesma carga', () => {
    expect(formatSets([log('s', 0, 40, 12), log('s', 1, 40, 12), log('s', 2, 40, 10)])).toBe('40 kg × 12, 12, 10');
    expect(formatSets([log('s', 0, 40, 12), log('s', 1, 45, 8)])).toBe('40 kg × 12 · 45 kg × 8');
    expect(formatSets([log('s', 0, 42.5, 8)])).toBe('42,5 kg × 8');
  });

  it('peso corporal e tempo', () => {
    expect(formatSets([log('s', 0, undefined, 12), log('s', 1, undefined, 10)])).toBe('12, 10 reps');
    expect(formatSets([log('s', 0, undefined, undefined, { durationSec: 30 }), log('s', 1, undefined, undefined, { durationSec: 40 })])).toBe('30s, 40s');
  });

  it('resume a melhor série com o dia relativo', () => {
    const [g] = groupBySession([log('s1', 0, 40, 12), log('s1', 1, 50, 8), log('s1', 2, 50, 6)], sessions);
    expect(summarizeLast(g!, '2026-03-08')).toBe('50 kg × 8 · há 7 dias');
    const [t] = groupBySession([log('s1', 0, undefined, undefined, { durationSec: 45 })], sessions);
    expect(summarizeLast(t!, '2026-03-01')).toBe('45 s · hoje');
    const [b] = groupBySession([log('s1', 0, undefined, 15)], sessions);
    expect(summarizeLast(b!, '2026-03-02')).toBe('15 reps · ontem');
  });
});

describe('buildChartData', () => {
  const groups = groupBySession(
    [log('s1', 0, 40, 10), log('s1', 1, 40, 12), log('s2', 0, 60, 5), log('s3', 0, 50, 6)],
    sessions,
  );

  it('usa o melhor 1RM estimado por sessão, em ordem cronológica, e marca o recorde', () => {
    const d = buildChartData(groups, 'peso');
    expect(d.points.map((p) => p.sessionId)).toEqual(['s1', 's2', 's3']);
    expect(d.points[0]!.value).toBe(56); // 40 × (1 + 12/30)
    expect(d.points[1]!.value).toBe(70);
    expect(d.recordIndex).toBe(1);
    expect(d.unit).toBe('kg');
  });

  it('peso corporal usa a maior repetição; sessões sem dado são ignoradas', () => {
    const g = groupBySession([log('s1', 0, undefined, 8), log('s1', 1, undefined, 12), log('s2', 0, undefined, undefined)], sessions);
    const d = buildChartData(g, 'peso_corporal');
    expect(d.points).toHaveLength(1);
    expect(d.points[0]!.value).toBe(12);
    expect(d.recordIndex).toBe(0);
  });

  it('sem pontos, recordIndex é -1', () => {
    expect(buildChartData([], 'peso')).toMatchObject({ points: [], recordIndex: -1 });
  });
});

describe('layoutChart', () => {
  const box = { width: 300, height: 100, padLeft: 10, padRight: 10, padTop: 10, padBottom: 10 };
  it('x proporcional ao tempo e y invertido', () => {
    const pts = [
      { sessionId: 'a', date: '2026-03-01', value: 10 },
      { sessionId: 'b', date: '2026-03-02', value: 20 },
      { sessionId: 'c', date: '2026-03-11', value: 30 },
    ];
    const l = layoutChart(pts, box);
    expect(l.coords[0]!.x).toBe(10);
    expect(l.coords[2]!.x).toBe(290);
    expect(l.coords[1]!.x).toBeCloseTo(10 + 0.1 * 280, 5);
    expect(l.coords[2]!.y).toBeLessThan(l.coords[0]!.y);
  });
  it('valores iguais não dividem por zero', () => {
    const l = layoutChart([{ sessionId: 'a', date: '2026-03-01', value: 5 }, { sessionId: 'b', date: '2026-03-01', value: 5 }], box);
    expect(l.coords.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y))).toBe(true);
  });
});

describe('duplicados', () => {
  it('encontra pares, ignora excluídos e dispensados', () => {
    const a = ex('Leg Press');
    const b = ex('leg press');
    const c = ex('Remada');
    const d = ex('Leg press', { deletedAt: 1 });
    const pairs = findDuplicatePairs([a, b, c, d], new Set());
    expect(pairs).toHaveLength(1);
    expect(pairKey(pairs[0]!.a.id, pairs[0]!.b.id)).toBe(pairKey(a.id, b.id));
    expect(findDuplicatePairs([a, b, c], new Set([pairKey(b.id, a.id)]))).toHaveLength(0);
  });

  it('casa por alias', () => {
    const a = ex('Puxada frontal', { aliases: ['Pulldown'], aliasKeys: ['pulldown'] });
    const b = ex('pulldown');
    expect(findDuplicatePairs([a, b], new Set())).toHaveLength(1);
  });

  it('suggestKeeper prefere vídeo e depois o mais antigo', () => {
    const old = ex('A', { createdAt: 1 });
    const recent = ex('B', { createdAt: 2 });
    const withClip = ex('C', { createdAt: 3, clip: { videoId: 'v', startSec: 0, endSec: 1 } });
    expect(suggestKeeper(recent, old).keep).toBe(old);
    expect(suggestKeeper(old, withClip).keep).toBe(withClip);
    expect(suggestKeeper(old, withClip).drop).toBe(old);
  });
});

describe('busca e candidatos de fusão', () => {
  const list = [ex('Agachamento livre'), ex('Cadeira extensora', { aliases: ['Extensão de joelho'], aliasKeys: ['extensao de joelho'] }), ex('cadeira extensora ')];

  it('ignora acentos e maiúsculas, em nome e alias', () => {
    expect(matchesQuery(list[1]!, 'EXTENSÃO')).toBe(true);
    expect(matchesQuery(list[0]!, 'agach')).toBe(true);
    expect(matchesQuery(list[0]!, 'xyz')).toBe(false);
    expect(matchesQuery(list[0]!, '  ')).toBe(true);
  });

  it('candidatos similares vêm primeiro e o próprio exercício não aparece', () => {
    const r = mergeCandidates(list[2]!, list, '');
    expect(r[0]).toBe(list[1]);
    expect(r).not.toContain(list[2]);
    expect(mergeCandidates(list[2]!, list, 'agach')).toEqual([list[0]]);
  });
});
