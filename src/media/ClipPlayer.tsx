import { useEffect, useRef } from 'react';
import type { ClipRef } from '../domain/types';
import { useVideoUrl } from './useVideoUrl';

interface Props {
  clip: ClipRef | undefined;
  className?: string;
  /** Mostrado quando não há vídeo local para o trecho. */
  fallback?: React.ReactNode;
}

/**
 * Toca em loop o trecho [startSec, endSec] de um vídeo guardado no aparelho.
 * O elemento <video> é o mesmo entre trocas de trecho: só muda `src` quando muda o vídeo.
 */
export function ClipPlayer({ clip, className, fallback = null }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const url = useVideoUrl(clip?.videoId);
  const start = clip?.startSec ?? 0;
  const end = clip?.endSec ?? 0;

  useEffect(() => {
    const v = ref.current;
    if (!v || !url) return;
    const seek = () => {
      v.currentTime = start;
      void v.play().catch(() => {});
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener('loadedmetadata', seek, { once: true });
    const onTime = () => {
      if (end > start && (v.currentTime >= end || v.currentTime < start - 0.5)) v.currentTime = start;
    };
    v.addEventListener('timeupdate', onTime);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', seek);
    };
  }, [url, start, end]);

  if (!clip || url === null) return <>{fallback}</>;
  return <video ref={ref} className={className} src={url ?? undefined} muted playsInline controls preload="auto" />;
}
