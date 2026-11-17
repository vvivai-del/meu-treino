export const REST_STEP_SEC = 5;
const REST_MIN = 10;
const REST_MAX = 600;

/** Limita o descanso a 10 s–10 min, em múltiplos inteiros. */
export function clampRest(sec: number): number {
  if (!Number.isFinite(sec)) return REST_MIN;
  return Math.min(REST_MAX, Math.max(REST_MIN, Math.round(sec)));
}

/** O app roda instalado (tela de início do iOS ou PWA)? */
export function isStandalone(): boolean {
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
}
