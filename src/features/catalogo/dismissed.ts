// Pares de exercícios que o usuário marcou como "São diferentes", lembrados neste aparelho.
const KEY = 'meu-treino:catalogo:pares-diferentes';

export function loadDismissedPairs(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveDismissedPairs(pairs: ReadonlySet<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...pairs]));
  } catch {
    // armazenamento indisponível: o par volta a aparecer na próxima visita
  }
}
