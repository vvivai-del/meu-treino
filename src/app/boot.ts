import { db, getSettings, setSetting } from '../db/db';
import { migrateLegacy, type LegacyWorkout } from '../engine';
import { resumePendingImports } from '../import';

/** Tarefas de inicialização. Nenhuma bloqueia a primeira renderização. */
export async function boot(): Promise<void> {
  // Pede ao navegador para não apagar os dados locais sob pressão de espaço.
  void navigator.storage?.persist?.().catch(() => false);
  await migrateLegacyData().catch((err) => console.error('Falha ao migrar dados antigos', err));
  await resumePendingImports().catch((err) => console.error('Falha ao retomar importações', err));
  if (import.meta.env.DEV) await import('../dev/seed');
}

/**
 * Traz os dados do app antigo (localStorage: apiKey, profile, workoutHistory) para o banco novo.
 * Roda uma única vez e não apaga o localStorage (serve de backup).
 */
async function migrateLegacyData(): Promise<void> {
  const settings = await getSettings();
  if (settings.legacyMigrated) return;

  const apiKey = localStorage.getItem('apiKey');
  if (apiKey && !settings.geminiApiKey) await setSetting('geminiApiKey', apiKey);
  const profile = localStorage.getItem('profile');
  if (profile && !settings.profile) await setSetting('profile', profile);

  let legacy: LegacyWorkout[] = [];
  try {
    legacy = JSON.parse(localStorage.getItem('workoutHistory') || '[]') as LegacyWorkout[];
  } catch {
    legacy = [];
  }
  if (Array.isArray(legacy) && legacy.length > 0) {
    const rows = migrateLegacy(legacy);
    await db.transaction('rw', [db.exercises, db.workouts, db.workoutItems, db.sessions, db.setLogs], async () => {
      await db.exercises.bulkPut(rows.exercises);
      await db.workouts.bulkPut(rows.workouts);
      await db.workoutItems.bulkPut(rows.items);
      await db.sessions.bulkPut(rows.sessions);
      await db.setLogs.bulkPut(rows.setLogs);
    });
  }
  await setSetting('legacyMigrated', true);
}
