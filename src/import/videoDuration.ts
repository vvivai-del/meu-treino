/** Lê a duração (s) de um vídeo local pelo navegador. Devolve undefined se não der (ou demorar). */
export function readVideoDuration(blob: Blob, timeoutMs = 8000): Promise<number | undefined> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    let url: string | undefined;
    const el = document.createElement('video');
    const done = (d?: number) => {
      clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      if (url) URL.revokeObjectURL(url);
      resolve(d !== undefined && Number.isFinite(d) && d > 0 ? d : undefined);
    };
    const timer = setTimeout(() => done(), timeoutMs);
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done();
    try {
      url = URL.createObjectURL(blob);
      el.src = url;
    } catch {
      done();
    }
  });
}
