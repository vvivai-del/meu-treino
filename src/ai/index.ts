// Cliente de IA (Gemini). Único lugar do app que fala com a API.
// As telas nunca chamam isto direto: quem orquestra é `src/import` (e depois fusão/evolução).
//
// CONTRATO — tipos e assinaturas usados pelo resto do app.

import type { ExerciseKind, ID, LoadType } from '../domain/types';

/** Resumo do catálogo enviado à IA para ela casar nomes com exercícios existentes. */
export interface CatalogEntry {
  id: ID;
  name: string;
  aliases: string[];
}

export interface ParsedItem {
  /** Chave estável dentro desta resposta ('1', '2'…), usada para casar com os trechos do vídeo. */
  key: string;
  /** Nome como o personal escreveu (sem o rótulo). */
  rawName: string;
  /** Rótulo do personal, ex.: 'A1'. */
  label?: string;
  /** Itens com o mesmo `block` são feitos juntos (bi-set/circuito). Ex.: 'A' para A1 e A2. */
  block: string;
  /** Séries × repetições como escrito, ex.: '4x12'. */
  prescriptionRaw: string;
  sets: number;
  repsMin?: number;
  repsMax?: number;
  durationSec?: number;
  restSec?: number;
  perSide?: boolean;
  observations?: string;
  kind: ExerciseKind;
  loadType: LoadType;
  muscleGroup?: string;
  /** Id do catálogo quando é um exercício que já existe. Ausente = exercício novo. */
  catalogId?: ID;
  /** Confiança do casamento com o catálogo. */
  confidence: 'alta' | 'baixa';
}

export interface ParsedWorkout {
  /** Título curto, ex.: 'Lower Body + Core'. */
  title: string;
  /** Na ordem exata em que o personal escreveu. A IA não reordena nem remove nada. */
  items: ParsedItem[];
}

export interface VideoSegment {
  /** `ParsedItem.key` */
  key: string;
  startSec: number;
  endSec: number;
  /** Dica técnica que o personal falou no vídeo. */
  cues?: string;
}

/** Referência a um vídeo já enviado à Files API. */
export interface UploadedVideo {
  fileUri: string;
  mimeType: string;
}

export class AIError extends Error {
  constructor(
    message: string,
    /** 'sem_chave' | 'rede' | 'cota' | 'resposta_invalida' | 'video' | 'outro' */
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AIError';
  }
}

export { parseWorkoutText, uploadVideo, locateSegments } from './gemini';

// Assinaturas de referência:
//
// parseWorkoutText(text: string, catalog: CatalogEntry[]): Promise<ParsedWorkout>
//   Só texto; deve responder em poucos segundos.
//
// uploadVideo(file: Blob, onProgress?: (fraction: number) => void): Promise<UploadedVideo>
//   Upload resumível + espera até o arquivo ficar ACTIVE.
//
// locateSegments(video: UploadedVideo, items: Array<{ key: string; name: string }>): Promise<VideoSegment[]>
//   Localiza no vídeo o trecho de cada exercício já conhecido pelo texto.
