import type { ISODate, Session, VideoStatus, Workout } from '../../domain/types';

export interface HomeListEntry {
  workout: Workout;
  /** Existe sessão finalizada deste treino. */
  done: boolean;
}

export interface HomeView {
  /** Sessão em andamento (a mais recente, se houver mais de uma). */
  active?: Session;
  /** Treinos planejados para hoje ainda sem sessão finalizada. */
  todayWorkouts: Workout[];
  /** Demais treinos não legados, do mais recente para o mais antigo. */
  others: HomeListEntry[];
  /** Existe pelo menos um treino não legado (qualquer data). */
  hasAnyWorkout: boolean;
}

/** Decide o que aparece na tela inicial. Função pura: recebe linhas já carregadas. */
export function selectHome(input: { workouts: Workout[]; sessions: Session[]; today: ISODate; limit?: number }): HomeView {
  const { today, limit = 20 } = input;
  const workouts = input.workouts.filter((w) => !w.deletedAt && w.origin !== 'legado');
  const sessions = input.sessions.filter((s) => !s.deletedAt);

  const active = sessions
    .filter((s) => s.finishedAt === undefined)
    .sort((a, b) => b.startedAt - a.startedAt)[0];

  const finishedIds = new Set(sessions.filter((s) => s.finishedAt !== undefined).map((s) => s.workoutId));
  const activeWorkoutId = active?.workoutId;

  const todayWorkouts = workouts
    .filter((w) => w.date === today && !finishedIds.has(w.id) && w.id !== activeWorkoutId)
    .sort((a, b) => a.createdAt - b.createdAt);
  const todayIds = new Set(todayWorkouts.map((w) => w.id));

  const others = workouts
    .filter((w) => !todayIds.has(w.id) && w.id !== activeWorkoutId)
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
    .slice(0, limit)
    .map((w) => ({ workout: w, done: finishedIds.has(w.id) }));

  return { active, todayWorkouts, others, hasAnyWorkout: workouts.length > 0 };
}

export interface VideoStatusInfo {
  tone: 'progress' | 'error' | 'ok';
  text: string;
}

/** Texto do indicador de vídeo; `null` quando não há nada a mostrar. */
export function videoStatusInfo(status: VideoStatus): VideoStatusInfo | null {
  switch (status) {
    case 'pendente':
      return { tone: 'progress', text: 'Vídeo na fila…' };
    case 'enviando':
      return { tone: 'progress', text: 'Enviando vídeo…' };
    case 'analisando':
      return { tone: 'progress', text: 'Analisando vídeo…' };
    case 'erro':
      return { tone: 'error', text: 'Falha ao processar o vídeo' };
    case 'pronto':
      return { tone: 'ok', text: 'Vídeo pronto' };
    default:
      return null;
  }
}
