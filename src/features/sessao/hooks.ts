import { useEffect, useState } from 'react';

/**
 * Relógio que só anda enquanto `active`. Os cálculos de contagem regressiva usam o horário de término,
 * então voltar do segundo plano (visibilitychange) corrige na hora o que o iOS pausou.
 */
export function useNow(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [active, intervalMs]);
  return now;
}

/** Mantém a tela acesa enquanto `active`, reobtendo o bloqueio ao voltar para o app. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await navigator.wakeLock.request('screen');
        if (cancelled) void s.release().catch(() => {});
        else sentinel = s;
      } catch {
        /* sem permissão ou economia de energia: segue sem o bloqueio */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}

export interface RestState {
  endsAt: number;
  totalSec: number;
}

const restKey = (sessionId: string) => `treino:descanso:${sessionId}`;

/** O descanso sobrevive a recarregar a página (guardado só neste aparelho). */
export function readRest(sessionId: string): RestState | null {
  try {
    const raw = localStorage.getItem(restKey(sessionId));
    if (!raw) return null;
    const v = JSON.parse(raw) as RestState;
    return v.endsAt > Date.now() ? v : null;
  } catch {
    return null;
  }
}

export function writeRest(sessionId: string, rest: RestState | null): void {
  try {
    if (rest) localStorage.setItem(restKey(sessionId), JSON.stringify(rest));
    else localStorage.removeItem(restKey(sessionId));
  } catch {
    /* armazenamento indisponível: o descanso só não sobrevive ao recarregamento */
  }
}
