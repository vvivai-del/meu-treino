import { describe, expect, it } from 'vitest';
import type { Session, Workout } from '../../domain/types';
import { selectHome, videoStatusInfo } from './homeLogic';

let n = 0;
function w(over: Partial<Workout>): Workout {
  n++;
  return { id: `w${n}`, createdAt: n, updatedAt: n, title: `T${n}`, date: '2026-03-23', sourceText: '', origin: 'personal', videoStatus: 'sem_video', ...over };
}
function s(over: Partial<Session>): Session {
  n++;
  return { id: `s${n}`, createdAt: n, updatedAt: n, workoutId: 'x', date: '2026-03-23', startedAt: n, ...over };
}
const today = '2026-03-23';

describe('selectHome', () => {
  it('separa treino de hoje e demais, ignorando legados', () => {
    const a = w({ date: today });
    const b = w({ date: '2026-03-20' });
    const c = w({ date: '2026-03-25' });
    const legacy = w({ date: today, origin: 'legado' });
    const view = selectHome({ workouts: [a, b, c, legacy], sessions: [], today });
    expect(view.todayWorkouts.map((x) => x.id)).toEqual([a.id]);
    expect(view.others.map((x) => x.workout.id)).toEqual([c.id, b.id]);
    expect(view.hasAnyWorkout).toBe(true);
    expect(view.active).toBeUndefined();
  });

  it('treino de hoje já concluído vai para a lista, marcado como concluído', () => {
    const a = w({ date: today });
    const view = selectHome({ workouts: [a], sessions: [s({ workoutId: a.id, finishedAt: 99 })], today });
    expect(view.todayWorkouts).toEqual([]);
    expect(view.others[0]).toMatchObject({ done: true });
  });

  it('sessão em andamento aparece uma vez só e ignora excluídas', () => {
    const a = w({ date: today });
    const old = s({ workoutId: a.id, startedAt: 1 });
    const recent = s({ workoutId: a.id, startedAt: 50 });
    const deleted = s({ workoutId: a.id, startedAt: 90, deletedAt: 91 });
    const view = selectHome({ workouts: [a], sessions: [old, recent, deleted], today });
    expect(view.active?.id).toBe(recent.id);
    expect(view.todayWorkouts).toEqual([]);
    expect(view.others).toEqual([]);
  });

  it('ignora treinos excluídos e informa quando não há nenhum', () => {
    const view = selectHome({ workouts: [w({ deletedAt: 5 }), w({ origin: 'legado' })], sessions: [], today });
    expect(view.hasAnyWorkout).toBe(false);
  });

  it('desempata pela criação e respeita o limite', () => {
    const list = Array.from({ length: 5 }, () => w({ date: '2026-03-01' }));
    const view = selectHome({ workouts: list, sessions: [], today, limit: 3 });
    expect(view.others).toHaveLength(3);
    expect(view.others[0]!.workout.id).toBe(list[4]!.id);
  });
});

describe('videoStatusInfo', () => {
  it('mapeia cada estado', () => {
    expect(videoStatusInfo('sem_video')).toBeNull();
    expect(videoStatusInfo('enviando')?.text).toBe('Enviando vídeo…');
    expect(videoStatusInfo('analisando')?.text).toBe('Analisando vídeo…');
    expect(videoStatusInfo('erro')?.tone).toBe('error');
    expect(videoStatusInfo('pronto')?.tone).toBe('ok');
  });
});
