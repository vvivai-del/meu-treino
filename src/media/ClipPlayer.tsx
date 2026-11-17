import { useEffect, useRef } from 'react';
import type { ClipRef } from '../domain/types';
import { useVideoUrl } from './useVideoUrl';

interface Props {
  clip: ClipRef | undefined;
  className?: string;
  /** Mostrado quando não há vídeo local para o trecho. */
  fallback?: React.ReactNode;
  /** Controles nativos do navegador. Padrão: ligados (tela do catálogo). O player do treino desliga. */
  controls?: boolean;
  /** Sem som por padrão (exigência de autoplay no iOS). */
  muted?: boolean;
  /** Pausa a reprodução sem desmontar o <video> (para continuar montado entre exercícios). */
  paused?: boolean;
  /** Mudar este número recomeça o trecho do início. */
  replayKey?: number;
}

/**
 * Toca em loop o trecho [startSec, endSec] de um vídeo guardado no aparelho.
 * O elemento <video> é o mesmo entre trocas de trecho: só muda `src` quando muda o vídeo.
 */
export function ClipPlayer({ clip, className, fallback = null, controls = true, muted = true, paused = false, replayKey = 0 }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const url = useVideoUrl(clip?.videoId);
  const start = clip?.startSec ?? 0;
  const end = clip?.endSec ?? 0;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Posiciona no início do trecho e mantém o loop dentro dele.
  useEffect(() => {
    const v = ref.current;
    if (!v || !url) return;
    const seek = () => {
      v.currentTime = start;
      if (!pausedRef.current) void v.play().catch(() => {});
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener('loadedmetadata', seek, { once: true });

    // requestAnimationFrame em vez de `timeupdate` (4 Hz): o laço volta no ponto certo, sem passar do fim do trecho.
    let raf = 0;
    const tick = () => {
      if (end > start && !v.paused && (v.currentTime >= end || v.currentTime < start - 0.5)) v.currentTime = start;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onEnded = () => {
      v.currentTime = start;
      if (!pausedRef.current) void v.play().catch(() => {});
    };
    v.addEventListener('ended', onEnded);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('loadedmetadata', seek);
    };
  }, [url, start, end, replayKey]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (paused) v.pause();
    else if (v.readyState >= 1) void v.play().catch(() => {});
  }, [paused, url]);

  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted, url]);

  if (!clip || url === null) return <>{fallback}</>;
  return <video ref={ref} className={className} src={url ?? undefined} muted={muted} playsInline controls={controls} preload="auto" />;
}
