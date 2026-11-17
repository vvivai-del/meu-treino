import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  Base,
  Exercise,
  ID,
  Insight,
  Session,
  SetLog,
  SettingRow,
  Settings,
  Video,
  VideoBlob,
  Workout,
  WorkoutItem,
} from '../domain/types';

// Banco local (IndexedDB). É a fonte da verdade da interface: toda tela lê e
// grava aqui, e o app funciona 100% offline. A nuvem só replica estas tabelas.
export class TreinoDB extends Dexie {
  exercises!: EntityTable<Exercise, 'id'>;
  workouts!: EntityTable<Workout, 'id'>;
  workoutItems!: EntityTable<WorkoutItem, 'id'>;
  sessions!: EntityTable<Session, 'id'>;
  setLogs!: EntityTable<SetLog, 'id'>;
  videos!: EntityTable<Video, 'id'>;
  videoBlobs!: Table<VideoBlob, ID>;
  insights!: EntityTable<Insight, 'id'>;
  settings!: Table<SettingRow, string>;

  constructor(name = 'meu-treino') {
    super(name);
    this.version(1).stores({
      exercises: 'id, nameKey, *aliasKeys, kind, updatedAt',
      workouts: 'id, date, origin, updatedAt',
      workoutItems: 'id, workoutId, exerciseId, [workoutId+order], updatedAt',
      sessions: 'id, workoutId, date, startedAt, finishedAt, updatedAt',
      setLogs: 'id, sessionId, exerciseId, workoutItemId, [sessionId+workoutItemId+setIndex], [exerciseId+doneAt], updatedAt',
      videos: 'id, kind, updatedAt',
      videoBlobs: 'videoId',
      insights: 'id, status, updatedAt',
      settings: 'key',
    });
  }
}

export const db = new TreinoDB();

export function newId(): ID {
  return crypto.randomUUID();
}

/** Campos `Base` para uma linha nova. */
export function stamp(): Base {
  const now = Date.now();
  return { id: newId(), createdAt: now, updatedAt: now };
}

/** Use em toda atualização: `db.x.update(id, { ...mudanças, ...touch() })`. */
export function touch(): Pick<Base, 'updatedAt'> {
  return { updatedAt: Date.now() };
}

export const DEFAULT_SETTINGS: Settings = {
  profile: '',
  defaultRestSec: 60,
};

export async function getSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as Settings;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await db.settings.put({ key, value });
}
