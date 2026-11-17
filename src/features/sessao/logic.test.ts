import { describe, expect, it } from 'vitest';
import type { SetLog, WorkoutItem } from '../../domain/types';
import { blockKind, groupBlocks } from './blocks';
import {
  endsRound,
  firstPendingBlock,
  formatDuration,
  indexLogs,
  isTimed,
  logKey,
  nextPendingTurn,
  parseDecimal,
  planMissingRows,
  propagationTargets,
  remainingSec,
  stepValue,
  summarizeSession,
  turnOrder,
} from './logic';

function item(id: string, blockId: string, order: number, sets = 3): WorkoutItem {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    workoutId: 'w',
    order,
    blockId,
    exerciseId: `ex-${id}`,
    rawName: id,
    prescription: { sets, raw: `${sets}x10` },
    match: 'alta',
  };
}

function log(over: Partial<SetLog> & { workoutItemId: string; setIndex: number }): SetLog {
  return {
    id: `${over.workoutItemId}-${over.setIndex}-${over.sessionId ?? 's'}`,
    createdAt: 0,
    updatedAt: 0,
    sessionId: 's',
    exerciseId: `ex-${over.workoutItemId}`,
    done: false,
    ...over,
  };
}

describe('blocos', () => {
  const items = [item('a', 'A', 0), item('c1', 'C', 2), item('b', 'B', 1), item('c2', 'C', 3)];

  it('agrupa por blockId, na ordem do personal', () => {
    const blocks = groupBlocks(items);
    expect(blocks.map((b) => b.id)).toEqual(['A', 'B', 'C']);
    expect(blocks[2]!.items.map((i) => i.id)).toEqual(['c1', 'c2']);
  });

  it('classifica bi-set e circuito', () => {
    const blocks = groupBlocks([...items, item('c3', 'C', 4)]);
    expect(blockKind(blocks[0]!)).toBeNull();
    expect(blockKind(blocks[2]!)).toBe('circuito');
    expect(blockKind(groupBlocks(items)[2]!)).toBe('bi-set');
  });
});

describe('ordem de execução', () => {
  it('exercício único: séries em sequência', () => {
    expect(turnOrder([3]).map((t) => t.setIndex)).toEqual([0, 1, 2]);
  });

  it('bi-set alterna A1 s1, A2 s1, A1 s2…', () => {
    const t = turnOrder([2, 2]);
    expect(t.map((x) => `${x.itemIndex}:${x.setIndex}`)).toEqual(['0:0', '1:0', '0:1', '1:1']);
  });

  it('itens com menos séries saem das rodadas finais', () => {
    const t = turnOrder([3, 1]);
    expect(t.map((x) => `${x.itemIndex}:${x.setIndex}`)).toEqual(['0:0', '1:0', '0:1', '0:2']);
  });

  it('o descanso só vem depois do último item da rodada', () => {
    const block = groupBlocks([item('c1', 'C', 0, 2), item('c2', 'C', 1, 2)])[0]!;
    expect(endsRound(block, { itemIndex: 0, setIndex: 0 })).toBe(false);
    expect(endsRound(block, { itemIndex: 1, setIndex: 0 })).toBe(true);
    expect(endsRound(block, { itemIndex: 0, setIndex: 1 })).toBe(false);
    expect(endsRound(block, { itemIndex: 1, setIndex: 1 })).toBe(true);
  });

  it('exercício único descansa depois de toda série', () => {
    const block = groupBlocks([item('a', 'A', 0, 3)])[0]!;
    expect(endsRound(block, { itemIndex: 0, setIndex: 0 })).toBe(true);
  });
});

describe('próxima série pendente', () => {
  const block = groupBlocks([item('c1', 'C', 0, 2), item('c2', 'C', 1, 2)])[0]!;

  it('sem nada feito, começa em A1 série 1', () => {
    expect(nextPendingTurn(block, indexLogs([]))).toMatchObject({ itemIndex: 0, setIndex: 0 });
  });

  it('depois de A1 série 1, a vez é de A2 série 1', () => {
    const logs = indexLogs([log({ workoutItemId: 'c1', setIndex: 0, done: true })]);
    expect(nextPendingTurn(block, logs)).toMatchObject({ itemIndex: 1, setIndex: 0 });
  });

  it('desfazer uma série anterior volta a vez para ela', () => {
    const logs = indexLogs([
      log({ workoutItemId: 'c1', setIndex: 0, done: false }),
      log({ workoutItemId: 'c2', setIndex: 0, done: true }),
    ]);
    expect(nextPendingTurn(block, logs)).toMatchObject({ itemIndex: 0, setIndex: 0 });
  });

  it('bloco completo não tem vez', () => {
    const all = [0, 1].flatMap((s) => ['c1', 'c2'].map((id) => log({ workoutItemId: id, setIndex: s, done: true })));
    expect(nextPendingTurn(block, indexLogs(all))).toBeNull();
  });

  it('ignora séries excluídas', () => {
    const logs = indexLogs([log({ workoutItemId: 'c1', setIndex: 0, done: true, deletedAt: 1 })]);
    expect(logs.has(logKey('c1', 0))).toBe(false);
  });
});

describe('primeiro bloco pendente', () => {
  const blocks = groupBlocks([item('a', 'A', 0, 1), item('b', 'B', 1, 2), item('c', 'C', 2, 1)]);

  it('pula blocos concluídos', () => {
    const logs = indexLogs([
      log({ workoutItemId: 'a', setIndex: 0, done: true }),
      log({ workoutItemId: 'b', setIndex: 0, done: true }),
    ]);
    expect(firstPendingBlock(blocks, logs)).toBe(1);
  });

  it('bloco nunca aberto conta como pendente', () => {
    expect(firstPendingBlock(blocks, indexLogs([]))).toBe(0);
  });

  it('tudo feito: fica no último', () => {
    const logs = indexLogs([
      log({ workoutItemId: 'a', setIndex: 0, done: true }),
      log({ workoutItemId: 'b', setIndex: 0, done: true }),
      log({ workoutItemId: 'b', setIndex: 1, done: true }),
      log({ workoutItemId: 'c', setIndex: 0, done: true }),
    ]);
    expect(firstPendingBlock(blocks, logs)).toBe(2);
  });
});

describe('séries planejadas', () => {
  const block = groupBlocks([item('a', 'A', 0, 3)])[0]!;
  const sug = [
    { weightKg: 40, reps: 10, basis: 'historico' as const, reason: 'x' },
    { weightKg: 42, reps: 10, basis: 'historico' as const, reason: 'x' },
    { weightKg: 42, reps: 8, basis: 'historico' as const, reason: 'x' },
  ];

  it('cria uma linha por série com os valores sugeridos', () => {
    const rows = planMissingRows(block, [sug], new Map());
    expect(rows.map((r) => [r.setIndex, r.weightKg, r.reps])).toEqual([
      [0, 40, 10],
      [1, 42, 10],
      [2, 42, 8],
    ]);
  });

  it('não duplica as que já existem', () => {
    const existing = indexLogs([log({ workoutItemId: 'a', setIndex: 1 })]);
    expect(planMissingRows(block, [sug], existing).map((r) => r.setIndex)).toEqual([0, 2]);
  });

  it('sem sugestão, cria linhas vazias', () => {
    const rows = planMissingRows(block, [[]], new Map());
    expect(rows).toHaveLength(3);
    expect(rows[0]!.weightKg).toBeUndefined();
  });
});

describe('números', () => {
  it('aceita vírgula e ponto', () => {
    expect(parseDecimal('42,5')).toBe(42.5);
    expect(parseDecimal(' 42.5 ')).toBe(42.5);
    expect(parseDecimal('')).toBeUndefined();
    expect(parseDecimal('abc')).toBeUndefined();
    expect(parseDecimal('-3')).toBeUndefined();
  });

  it('passo sem lixo de ponto flutuante e sem negativo', () => {
    expect(stepValue(0.1, 0.2, 1)).toBe(0.3);
    expect(stepValue(2, 5, -1)).toBe(0);
    expect(stepValue(undefined, 2.5, 1)).toBe(2.5);
  });

  it('descanso é calculado pelo horário de término', () => {
    expect(remainingSec(10_000, 4_100)).toBe(6);
    expect(remainingSec(10_000, 10_000)).toBe(0);
    expect(remainingSec(10_000, 99_000)).toBe(0);
  });

  it('formata duração', () => {
    expect(formatDuration(30)).toBe('<1 min');
    expect(formatDuration(42 * 60)).toBe('42 min');
    expect(formatDuration(65 * 60)).toBe('1h 05');
  });

  it('detecta exercício por tempo', () => {
    expect(isTimed({ loadType: 'tempo' }, 30, undefined)).toBe(true);
    expect(isTimed({ loadType: 'peso' }, undefined, 12)).toBe(false);
    expect(isTimed({ loadType: 'peso_corporal' }, 30, undefined)).toBe(true);
    expect(isTimed({ loadType: 'peso' }, 30, undefined)).toBe(false);
  });
});

describe('propagação de peso', () => {
  it('só atinge séries seguintes ainda não concluídas', () => {
    const logs = [
      log({ workoutItemId: 'a', setIndex: 0 }),
      log({ workoutItemId: 'a', setIndex: 1, done: true }),
      log({ workoutItemId: 'a', setIndex: 2 }),
      log({ workoutItemId: 'a', setIndex: 3 }),
    ];
    expect(propagationTargets(logs, 0).map((l) => l.setIndex)).toEqual([2, 3]);
    expect(propagationTargets(logs, 2).map((l) => l.setIndex)).toEqual([3]);
  });
});

describe('resumo', () => {
  const done = (sessionId: string, ex: string, setIndex: number, kg: number, reps: number, doneAt: number) =>
    log({ sessionId, workoutItemId: `i-${ex}`, exerciseId: ex, setIndex, weightKg: kg, reps, done: true, doneAt });

  it('soma duração, séries, volume e detecta carga que subiu', () => {
    const logs = [
      done('s', 'agacho', 0, 62, 10, 3), // máximo 62 > 60 da sessão anterior
      done('s', 'agacho', 1, 62, 10, 4),
      done('s', 'leg', 0, 120, 12, 5), // igual à anterior: não subiu
      log({ sessionId: 's', workoutItemId: 'i-x', exerciseId: 'x', setIndex: 0, done: false }),
    ];
    const history = [
      done('antiga', 'agacho', 0, 60, 10, 1),
      done('antiga', 'leg', 0, 120, 12, 1),
      done('muito-antiga', 'agacho', 0, 40, 10, 0),
    ];
    const s = summarizeSession({ startedAt: 0, finishedAt: 45 * 60_000, logs, history });
    expect(s.durationSec).toBe(45 * 60);
    expect(s.setCount).toBe(3);
    expect(s.exerciseCount).toBe(2);
    expect(s.volumeKg).toBe(62 * 10 * 2 + 120 * 12);
    expect(s.progressed).toEqual([{ exerciseId: 'agacho', fromKg: 60, toKg: 62 }]);
  });

  it('exercício sem histórico não conta como progresso', () => {
    const s = summarizeSession({ startedAt: 0, finishedAt: 1000, logs: [done('s', 'novo', 0, 20, 10, 1)], history: [] });
    expect(s.progressed).toEqual([]);
  });
});
