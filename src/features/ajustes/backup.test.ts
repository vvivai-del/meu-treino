import { describe, expect, it } from 'vitest';
import { TreinoDB } from '../../db/db';
import { BACKUP_TABLES, backupFileName, buildBackup, parseBackup, restoreBackup, summarizeBackup, validateBackup } from './backup';

const row = (id: string, extra: object = {}) => ({ id, createdAt: 1, updatedAt: 1, ...extra });

async function populated(name: string) {
  const db = new TreinoDB(name);
  await db.workouts.put(row('w1', { title: 'A', date: '2026-03-10', sourceText: '', origin: 'personal', videoStatus: 'sem_video' }) as never);
  await db.workouts.put(row('w2', { title: 'B', date: '2026-03-11', sourceText: '', origin: 'personal', videoStatus: 'sem_video', deletedAt: 5 }) as never);
  await db.sessions.put(row('s1', { workoutId: 'w1', date: '2026-03-10', startedAt: 1, finishedAt: 2 }) as never);
  await db.videos.put(row('v1', { kind: 'original', mimeType: 'video/mp4', sizeBytes: 1, hasLocalBlob: true }) as never);
  await db.videoBlobs.put({ videoId: 'v1', blob: new Blob(['x']) });
  await db.settings.bulkPut([
    { key: 'geminiApiKey', value: 'SEGREDO' },
    { key: 'profile', value: 'perfil' },
    { key: 'defaultRestSec', value: 90 },
  ]);
  return db;
}

describe('buildBackup', () => {
  it('inclui todas as tabelas, exceto blobs, e omite a chave da IA', async () => {
    const db = await populated('bk-build');
    const b = await buildBackup(db, new Date('2026-03-23T10:00:00Z'));
    expect(b).toMatchObject({ app: 'meu-treino', version: 1, exportedAt: '2026-03-23T10:00:00.000Z' });
    expect(Object.keys(b.tables).sort()).toEqual([...BACKUP_TABLES].sort());
    expect(JSON.stringify(b)).not.toContain('SEGREDO');
    expect(b.tables.settings.map((r) => r.key).sort()).toEqual(['defaultRestSec', 'profile']);
    expect(summarizeBackup(b)).toEqual({ workouts: 1, exercises: 0, sessions: 1 });
    db.close();
  });
});

describe('validateBackup', () => {
  const good = () => ({ app: 'meu-treino', version: 1, exportedAt: '2026-03-23T10:00:00Z', tables: Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])) });
  it('aceita um backup válido', () => {
    expect(validateBackup(good()).ok).toBe(true);
  });
  it('rejeita formatos errados', () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup({ ...good(), app: 'outro' }).ok).toBe(false);
    expect(validateBackup({ ...good(), version: 99 })).toMatchObject({ ok: false, error: expect.stringContaining('mais nova') });
    expect(validateBackup({ ...good(), exportedAt: 'ontem' }).ok).toBe(false);
    expect(validateBackup({ ...good(), tables: 3 }).ok).toBe(false);
    const missing = good();
    delete (missing.tables as Record<string, unknown>).setLogs;
    expect(validateBackup(missing)).toMatchObject({ ok: false, error: expect.stringContaining('setLogs') });
    const badRow = good();
    (badRow.tables as Record<string, unknown>).workouts = [{ title: 'sem id' }];
    expect(validateBackup(badRow)).toMatchObject({ ok: false, error: expect.stringContaining('workouts') });
  });
  it('descarta a chave da IA se vier no arquivo', () => {
    const b = good();
    (b.tables as Record<string, unknown>).settings = [{ key: 'geminiApiKey', value: 'x' }, { key: 'profile', value: 'p' }];
    const r = validateBackup(b);
    expect(r.ok && r.backup.tables.settings).toEqual([{ key: 'profile', value: 'p' }]);
  });
  it('parseBackup trata JSON inválido', () => {
    expect(parseBackup('{oops')).toMatchObject({ ok: false });
  });
});

describe('restoreBackup', () => {
  it('substitui dados, preserva chave da IA e blobs, e ajusta hasLocalBlob', async () => {
    const src = await populated('bk-src');
    const backup = await buildBackup(src);
    const dest = new TreinoDB('bk-dest');
    await dest.workouts.put(row('velho', { title: 'Velho' }) as never);
    await dest.settings.bulkPut([{ key: 'geminiApiKey', value: 'MINHA' }, { key: 'profile', value: 'antigo' }]);
    await dest.videoBlobs.put({ videoId: 'outro', blob: new Blob(['y']) });

    await restoreBackup(dest, backup);

    expect((await dest.workouts.toArray()).map((w) => w.id).sort()).toEqual(['w1', 'w2']);
    expect((await dest.settings.get('geminiApiKey'))?.value).toBe('MINHA');
    expect((await dest.settings.get('profile'))?.value).toBe('perfil');
    expect(await dest.videoBlobs.count()).toBe(1);
    expect((await dest.videos.get('v1'))?.hasLocalBlob).toBe(false);
    src.close();
    dest.close();
  });
});

describe('backupFileName', () => {
  it('usa a data local', () => {
    expect(backupFileName(new Date(2026, 2, 5))).toBe('meu-treino-backup-2026-03-05.json');
  });
});
