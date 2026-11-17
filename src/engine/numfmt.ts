/** Número com vírgula decimal (pt-BR), no máximo 2 casas: 12.5 → '12,5'. Independente de ICU. */
export function fmtNum(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r).replace('.', ',');
}
