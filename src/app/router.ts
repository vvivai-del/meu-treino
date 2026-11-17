import { useSyncExternalStore } from 'react';

// Roteador por hash (#/caminho): funciona no GitHub Pages sem configuração de servidor.

function currentPath(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/';
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const url = `#${path}`;
  if (opts.replace) {
    window.location.replace(url);
  } else {
    window.location.hash = path;
  }
}

/** Caminho atual, ex.: '/treino/abc'. Re-renderiza quando muda. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath);
}

/**
 * Casa `path` com um padrão tipo '/treino/:id'.
 * Retorna os parâmetros, ou null se não casar.
 */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean);
  const ap = path.split('?')[0]!.split('/').filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const p = pp[i]!;
    const a = ap[i]!;
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(a);
    else if (p !== a) return null;
  }
  return params;
}
