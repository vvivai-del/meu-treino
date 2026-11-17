import type { TreinoDB } from '../../db/db';

export const BACKUP_APP = 'meu-treino';
export const BACKUP_VERSION = 1;

/** Tabelas incluídas no backup (os blobs de vídeo ficam de fora: são grandes e re-baixáveis). */
export const BACKUP_TABLES = ['exercises', 'workouts', 'workoutItems', 'sessions', 'setLogs', 'videos', 'insights', 'settings'] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

/** A chave da IA nunca entra no backup nem é apagada por uma restauração. */
const SECRET_SETTINGS = ['geminiApiKey'];

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  tables: Record<BackupTable, Array<Record<string, unknown>>>;
}

export type BackupValidation = { ok: true; backup: Backup } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function buildBackup(db: TreinoDB, now: Date = new Date()): Promise<Backup> {
  const tables = {} as Backup['tables'];
  for (const name of BACKUP_TABLES) {
    const rows = (await db.table(name).toArray()) as Array<Record<string, unknown>>;
    tables[name] = name === 'settings' ? rows.filter((r) => !SECRET_SETTINGS.includes(String(r.key))) : rows;
  }
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), tables };
}

/** Valida o formato de um JSON de backup já lido. Não toca no banco. */
export function validateBackup(data: unknown): BackupValidation {
  if (!isRecord(data) || data.app !== BACKUP_APP) return { ok: false, error: 'Este arquivo não é um backup do Meu Treino.' };
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
    return { ok: false, error: 'O backup não informa a versão.' };
  }
  if (data.version > BACKUP_VERSION) {
    return { ok: false, error: 'Este backup é de uma versão mais nova do app. Atualize o app e tente de novo.' };
  }
  if (typeof data.exportedAt !== 'string' || Number.isNaN(Date.parse(data.exportedAt))) {
    return { ok: false, error: 'O backup não tem uma data válida.' };
  }
  if (!isRecord(data.tables)) return { ok: false, error: 'O backup não contém tabelas.' };

  const tables = {} as Backup['tables'];
  for (const name of BACKUP_TABLES) {
    const rows = data.tables[name];
    if (!Array.isArray(rows)) return { ok: false, error: `Falta a tabela "${name}" no backup.` };
    const keyField = name === 'settings' ? 'key' : 'id';
    for (let i = 0; i < rows.length; i++) {
      const r: unknown = rows[i];
      if (!isRecord(r) || typeof r[keyField] !== 'string' || r[keyField] === '') {
        return { ok: false, error: `Linha ${i + 1} da tabela "${name}" está inválida.` };
      }
    }
    tables[name] = (name === 'settings' ? rows.filter((r) => !SECRET_SETTINGS.includes(String((r as Record<string, unknown>).key))) : rows) as Array<Record<string, unknown>>;
  }
  return { ok: true, backup: { app: BACKUP_APP, version: data.version, exportedAt: data.exportedAt, tables } };
}

/** Lê o texto de um arquivo de backup: JSON + validação. */
export function parseBackup(text: string): BackupValidation {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'O arquivo não é um JSON válido.' };
  }
  return validateBackup(data);
}

export interface BackupSummary {
  workouts: number;
  exercises: number;
  sessions: number;
}

/** Contagens (sem linhas excluídas) para mostrar ao usuário antes de restaurar. */
export function summarizeBackup(b: Backup): BackupSummary {
  const live = (rows: Array<Record<string, unknown>>) => rows.filter((r) => !r.deletedAt).length;
  return { workouts: live(b.tables.workouts), exercises: live(b.tables.exercises), sessions: live(b.tables.sessions) };
}

/**
 * Substitui os dados locais pelo conteúdo do backup, numa única transação.
 * Preserva a chave da IA e os blobs de vídeo já guardados no aparelho.
 */
export async function restoreBackup(db: TreinoDB, backup: Backup): Promise<void> {
  await db.transaction('rw', [...BACKUP_TABLES.map((t) => db.table(t)), db.videoBlobs], async () => {
    for (const name of BACKUP_TABLES) {
      const table = db.table(name);
      if (name === 'settings') {
        await table.where('key').noneOf(SECRET_SETTINGS).delete();
      } else {
        await table.clear();
      }
      let rows = backup.tables[name];
      if (name === 'videos') {
        // O blob não vem no backup: só vale se o aparelho ainda o tem.
        const have = new Set((await db.videoBlobs.toCollection().primaryKeys()) as string[]);
        rows = rows.map((r) => ({ ...r, hasLocalBlob: have.has(String(r.id)) }));
      }
      await table.bulkPut(rows);
    }
  });
}

export function backupFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `meu-treino-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}
