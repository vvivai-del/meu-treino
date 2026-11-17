import type { ISODate } from '../domain/types';

/** 42.5 → '42,5 kg' */
export function formatKg(kg: number | undefined): string {
  if (kg === undefined || Number.isNaN(kg)) return '—';
  return `${kg.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`;
}

/** '2026-03-23' → 'segunda-feira, 23 de março' */
export function formatDate(date: ISODate): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** '2026-03-23' → '23/03' */
export function formatDateShort(date: ISODate): string {
  const [, m, d] = date.split('-');
  return d && m ? `${d}/${m}` : date;
}

/** 'hoje', 'ontem', 'há 5 dias', 'amanhã', 'em 3 dias' */
export function formatRelativeDay(date: ISODate, today: ISODate): string {
  const diff = Math.round((new Date(`${date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  if (diff === 0) return 'hoje';
  if (diff === -1) return 'ontem';
  if (diff === 1) return 'amanhã';
  return diff < 0 ? `há ${-diff} dias` : `em ${diff} dias`;
}

/** 95 → '1:35' */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
