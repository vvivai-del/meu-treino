import type { ISODate } from '../../domain/types';
import { todayLocal } from '../../engine';

export const DRAFT_KEY = 'meu-treino:rascunho-importacao';

/** 1536 → '1,5 KB'; 734003200 → '700 MB' */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const digits = u === 0 || v >= 100 ? 0 : 1;
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: digits })} ${units[u]}`;
}

/** Dia seguinte ao de `now`, em data local. */
export function tomorrowLocal(now: Date = new Date()): ISODate {
  return todayLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12));
}

export function canImport(text: string, date: string, busy: boolean): boolean {
  return !busy && text.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return typeof err === 'string' && err ? err : 'Não foi possível importar o treino.';
}

// O rascunho é conveniência: se o armazenamento falhar, a tela segue funcionando.
export function loadDraft(storage: Pick<Storage, 'getItem'> = localStorage): string {
  try {
    return storage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(text: string, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void {
  try {
    if (text) storage.setItem(DRAFT_KEY, text);
    else storage.removeItem(DRAFT_KEY);
  } catch {
    /* sem armazenamento: ignora */
  }
}

export function clearDraft(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(DRAFT_KEY);
  } catch {
    /* ignora */
  }
}
