import type { Exercise, ISODate, Session, SetLog, Workout, WorkoutItem } from '../domain/types';
import { stamp } from '../db/db';
import { normalizeName, splitLabel } from './catalog';
import { parsePrescription } from './prescription';
import type { LegacyWorkout } from './index';

/** Primeiro número de "40kg", "12,5 kg", "20kg cada lado"; undefined se não houver (ou for 0). */
function firstNumber(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = String(text).match(/\d+(?:[.,]\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Meio-dia local da data, em epoch ms; undefined se a data for inválida. */
function noonOf(date: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return undefined;
  return dt.getTime();
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** "nome séries×reps" para o texto-fonte reconstruído. */
function sourceLine(name: string, p: ReturnType<typeof parsePrescription>): string {
  if (p.repsMax !== undefined) {
    const reps = p.repsMin !== undefined && p.repsMin !== p.repsMax ? `${p.repsMin}-${p.repsMax}` : String(p.repsMax);
    return `${name} ${p.sets}×${reps}`;
  }
  if (p.durationSec !== undefined) return `${name} ${p.sets}×${p.durationSec}s`;
  return `${name} ${p.raw.trim()}`.trim();
}

export function migrateLegacy(legacy: LegacyWorkout[]): {
  exercises: Exercise[];
  workouts: Workout[];
  items: WorkoutItem[];
  sessions: Session[];
  setLogs: SetLog[];
} {
  const out = {
    exercises: [] as Exercise[],
    workouts: [] as Workout[],
    items: [] as WorkoutItem[],
    sessions: [] as Session[],
    setLogs: [] as SetLog[],
  };
  if (!Array.isArray(legacy)) return out;

  const byKey = new Map<string, Exercise>();

  for (const entry of legacy) {
    if (!entry || typeof entry !== 'object') continue;
    const date: ISODate = str(entry.date);
    const noon = noonOf(date);
    if (noon === undefined) continue;
    if (!Array.isArray(entry.exercises)) continue;

    const workout: Workout = {
      ...stamp(),
      title: str(entry.treino_do_dia) || 'Treino',
      date,
      sourceText: '',
      origin: 'legado',
      videoStatus: 'sem_video',
    };
    const session: Session = { ...stamp(), workoutId: workout.id, date, startedAt: noon, finishedAt: noon };
    const lines: string[] = [];
    const items: WorkoutItem[] = [];
    const logs: SetLog[] = [];

    for (const ex of entry.exercises) {
      if (!ex || typeof ex !== 'object') continue;
      const rawName = str(ex.nome);
      const { label, name } = splitLabel(rawName);
      const key = normalizeName(rawName);
      if (!name || !key) continue;

      const weight = firstNumber(ex.carga_executada);
      let exercise = byKey.get(key);
      if (!exercise) {
        exercise = {
          ...stamp(),
          name,
          nameKey: key,
          aliases: [],
          aliasKeys: [],
          kind: 'forca',
          loadType: 'peso_corporal',
        };
        byKey.set(key, exercise);
        out.exercises.push(exercise);
      } else if (name !== exercise.name && !exercise.aliases.includes(name)) {
        exercise.aliases.push(name);
        exercise.aliasKeys.push(key);
      }
      if (weight !== undefined) exercise.loadType = 'peso';
      const group = str(ex.grupo_muscular);
      if (group && !exercise.muscleGroup) exercise.muscleGroup = group;

      const prescription = parsePrescription(typeof ex.series_reps === 'string' ? ex.series_reps : '');
      const item: WorkoutItem = {
        ...stamp(),
        workoutId: workout.id,
        order: items.length,
        blockId: '',
        ...(label ? { label } : {}),
        exerciseId: exercise.id,
        rawName,
        prescription,
        ...(str(ex.notas) ? { observations: str(ex.notas) } : {}),
        match: 'alta',
      };
      item.blockId = item.id;
      items.push(item);
      lines.push(sourceLine(name, prescription));

      if (weight !== undefined) {
        for (let i = 0; i < prescription.sets; i++) {
          logs.push({
            ...stamp(),
            sessionId: session.id,
            workoutItemId: item.id,
            exerciseId: exercise.id,
            setIndex: i,
            weightKg: weight,
            reps: prescription.repsMax,
            ...(prescription.repsMax === undefined && prescription.durationSec !== undefined
              ? { durationSec: prescription.durationSec }
              : {}),
            done: true,
            doneAt: noon,
            legacy: true,
          });
        }
      }
    }

    if (!items.length) continue;
    workout.sourceText = lines.join('\n');
    out.workouts.push(workout);
    out.sessions.push(session);
    out.items.push(...items);
    out.setLogs.push(...logs);
  }
  return out;
}
