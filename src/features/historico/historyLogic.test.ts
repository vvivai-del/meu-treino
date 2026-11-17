import { describe, expect, it } from 'vitest';
import type { Exercise, Session, SetLog, Workout, WorkoutItem } from '../../domain/types';
import { buildHistoryEntries, formatDuration, groupByMonth, summarizeSets } from './historyLogic';
import { TreinoDB } from '../../db/db';
import { deleteSession } from './historyData';

let n = 0;
const base = () => ({ id: `id${++n}`, createdAt: n, updatedAt: n });
function log(over: Partial<SetLog>): SetLog {
  return { ...base(), sessionId: 's1', workoutItemId: 'i1', exerciseId: 'e1', setIndex: 0, done: true, ...over };
}

describe('summarizeSets', () => {
  it('agrupa por carga consecutiva', () => {
    const sets = [
      log({ setIndex: 0, weightKg: 40, reps: 12 }),
      log({ setIndex: 1, weightKg: 40, reps: 12 }),
      log({ setIndex: 2, weightKg: 40, reps: 10 }),
      log({ setIndex: 3, weightKg: 45, reps: 8 }),
    ];
    expect(summarizeSets(sets)).toBe('40 kg × 12, 12, 10 · 45 kg × 8');
  });
  it('ordena por setIndex e ignora não concluídas', () => {
    const sets = [log({ setIndex: 1, weightKg: 10, reps: 8 }), log({ setIndex: 0, weightKg: 10, reps: 10 }), log({ setIndex: 2, weightKg: 10, reps: 5, done: false })];
    expect(summarizeSets(sets)).toBe('10 kg × 10, 8');
  });
  it('peso corporal e tempo', () => {
    expect(summarizeSets([log({ reps: 15 }), log({ setIndex: 1, reps: 12 })])).toBe('15, 12 reps');
    expect(summarizeSets([log({ durationSec: 30 }), log({ setIndex: 1, durationSec: 30 })])).toBe('30 s, 30 s');
  });
  it('carga decimal em pt-BR', () => {
    expect(summarizeSets([log({ weightKg: 42.5, reps: 8 })])).toBe('42,5 kg × 8');
  });
});

describe('formatDuration', () => {
  it('formata e descarta inválidas', () => {
    expect(formatDuration(3_900_000)).toBe('1 h 05 min');
    expect(formatDuration(2_700_000)).toBe('45 min');
    expect(formatDuration(10_000)).toBeUndefined();
    expect(formatDuration(-5)).toBeUndefined();
  });
});

function session(over: Partial<Session>): Session {
  return { ...base(), workoutId: 'w1', date: '2026-03-10', startedAt: 1000, finishedAt: 2_000_000, ...over };
}

describe('buildHistoryEntries / groupByMonth', () => {
  const workout: Workout = { ...base(), id: 'w1', title: 'Lower', date: '2026-03-10', sourceText: '', origin: 'personal', videoStatus: 'sem_video' };
  const mkItem = (id: string, order: number): WorkoutItem => ({
    ...base(), id, workoutId: 'w1', order, blockId: 'A', exerciseId: id === 'i1' ? 'e1' : 'e2', rawName: `raw ${id}`,
    prescription: { sets: 3, raw: '3x10' }, match: 'alta',
  });
  const ex = (id: string, name: string): Exercise => ({ ...base(), id, name, nameKey: name, aliases: [], aliasKeys: [], kind: 'forca', loadType: 'peso' });

  it('ordena sessões, ignora abertas/excluídas e ordena exercícios pelo item', () => {
    const s1 = session({ id: 's1', date: '2026-03-10' });
    const s2 = session({ id: 's2', date: '2026-04-02' });
    const open = session({ id: 's3', finishedAt: undefined });
    const del = session({ id: 's4', deletedAt: 9 });
    const logs = [
      log({ sessionId: 's1', workoutItemId: 'i2', exerciseId: 'e2', weightKg: 20, reps: 10, doneAt: 1 }),
      log({ sessionId: 's1', workoutItemId: 'i1', exerciseId: 'e1', weightKg: 50, reps: 8, doneAt: 2, legacy: true }),
    ];
    const entries = buildHistoryEntries({
      sessions: [s1, s2, open, del], workouts: [workout], items: [mkItem('i1', 0), mkItem('i2', 1)], logs, exercises: [ex('e1', 'Agachamento'), ex('e2', 'Remada')],
    });
    expect(entries.map((e) => e.session.id)).toEqual(['s2', 's1']);
    const first = entries[1]!;
    expect(first.title).toBe('Lower');
    expect(first.exercises.map((e) => e.name)).toEqual(['Agachamento', 'Remada']);
    expect(first.exercises[0]).toMatchObject({ estimated: true, summary: '50 kg × 8' });
    expect(first.exercises[1]!.estimated).toBe(false);
    expect(first.totalSets).toBe(2);

    const months = groupByMonth(entries);
    expect(months.map((m) => m.key)).toEqual(['2026-04', '2026-03']);
    expect(months[0]!.label).toBe('abril de 2026');
  });
});

describe('deleteSession', () => {
  it('exclui sessão e séries logicamente', async () => {
    const db = new TreinoDB('test-historico');
    const s = session({ id: 'sx' });
    await db.sessions.put(s);
    await db.setLogs.bulkPut([log({ sessionId: 'sx' }), log({ sessionId: 'outra' })]);
    await deleteSession(db, 'sx');
    expect((await db.sessions.get('sx'))?.deletedAt).toBeTypeOf('number');
    const logs = await db.setLogs.toArray();
    expect(logs.filter((l) => l.deletedAt).map((l) => l.sessionId)).toEqual(['sx']);
    db.close();
  });
});
