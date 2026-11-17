import { useEffect, useState } from 'react';
import { db } from '../db/db';
import type { ID } from '../domain/types';

// Uma object URL por vídeo, compartilhada por todo o app e mantida viva enquanto houver uso.
const cache = new Map<ID, { url: string; refs: number }>();

/**
 * URL tocável do vídeo guardado neste aparelho.
 * `undefined` = carregando; `null` = não há blob local para este vídeo.
 */
export function useVideoUrl(videoId: ID | undefined): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(() => (videoId ? cache.get(videoId)?.url : null));

  useEffect(() => {
    if (!videoId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let acquired = false;
    const hit = cache.get(videoId);
    if (hit) {
      hit.refs++;
      acquired = true;
      setUrl(hit.url);
    } else {
      setUrl(undefined);
      void db.videoBlobs.get(videoId).then((row) => {
        if (cancelled) return;
        if (!row) {
          setUrl(null);
          return;
        }
        const entry = cache.get(videoId) ?? { url: URL.createObjectURL(row.blob), refs: 0 };
        entry.refs++;
        cache.set(videoId, entry);
        acquired = true;
        setUrl(entry.url);
      });
    }
    return () => {
      cancelled = true;
      if (!acquired) return;
      const entry = cache.get(videoId);
      if (entry && --entry.refs <= 0) {
        // Adia a liberação: trocar de exercício dentro do mesmo vídeo não deve recarregá-lo.
        setTimeout(() => {
          const e = cache.get(videoId);
          if (e && e.refs <= 0) {
            URL.revokeObjectURL(e.url);
            cache.delete(videoId);
          }
        }, 30_000);
      }
    };
  }, [videoId]);

  return url;
}
