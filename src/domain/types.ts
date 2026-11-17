// Modelo de dados do Meu Treino. É o contrato entre todos os módulos:
// mudanças aqui afetam banco, importação, player e catálogo.

export type ID = string;
/** Data local no formato 'YYYY-MM-DD' (nunca UTC — ver engine/dates). */
export type ISODate = string;
/** Epoch em milissegundos. */
export type Timestamp = number;

/** Campos comuns a toda linha. `updatedAt`/`deletedAt` existem para a sincronização com a nuvem. */
export interface Base {
  id: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Exclusão lógica: linhas com `deletedAt` não aparecem na interface. */
  deletedAt?: Timestamp;
}

// ---------- Catálogo ----------

export type ExerciseKind = 'forca' | 'mobilidade' | 'potencia' | 'cardio' | 'outro';
/** Como o exercício é medido: carga externa em kg, só repetições, ou tempo. */
export type LoadType = 'peso' | 'peso_corporal' | 'tempo';

/** Trecho de um vídeo guardado (original do treino ou clipe recortado). */
export interface ClipRef {
  videoId: ID;
  startSec: number;
  endSec: number;
}

/** Um exercício único do catálogo. Vários nomes escritos pelo personal apontam para o mesmo item. */
export interface Exercise extends Base {
  /** Nome de exibição. */
  name: string;
  /** `normalizeName(name)` — indexado. */
  nameKey: string;
  /** Outros nomes já vistos para este exercício (como escritos). */
  aliases: string[];
  /** `aliases` normalizados — índice multiEntry. */
  aliasKeys: string[];
  kind: ExerciseKind;
  loadType: LoadType;
  muscleGroup?: string;
  /** Dicas técnicas do personal acumuladas. */
  cues?: string;
  /** Melhor vídeo conhecido deste exercício (do treino mais recente que o trouxe). */
  clip?: ClipRef;
  /** Menor incremento de carga disponível, em kg. Padrão: 1. */
  weightStepKg?: number;
}

// ---------- Vídeo ----------

export interface Video extends Base {
  kind: 'original' | 'clip';
  mimeType: string;
  sizeBytes: number;
  fileName?: string;
  durationSec?: number;
  /** Há um blob em `videoBlobs` neste aparelho. */
  hasLocalBlob: boolean;
  /** Caminho no storage da nuvem (fase de sincronização). */
  remotePath?: string;
}

export interface VideoBlob {
  videoId: ID;
  blob: Blob;
}

// ---------- Treino prescrito ----------

export interface Prescription {
  sets: number;
  /** '8-12' → 8 e 12; '12' → 12 e 12. Ausentes quando o exercício é por tempo. */
  repsMin?: number;
  repsMax?: number;
  /** '30s' → 30. */
  durationSec?: number;
  /** "cada lado" / "por perna". */
  perSide?: boolean;
  restSec?: number;
  /** Como o personal escreveu, ex.: '4x12'. Sempre exibido ao usuário. */
  raw: string;
}

export type VideoStatus = 'sem_video' | 'pendente' | 'enviando' | 'analisando' | 'pronto' | 'erro';

export interface Workout extends Base {
  title: string;
  /** Dia em que o treino está planejado. */
  date: ISODate;
  /** Texto original do personal, preservado sem alterações. */
  sourceText: string;
  origin: 'personal' | 'fusao' | 'legado';
  /** Para `origin: 'fusao'`: treinos que deram origem a este. */
  mergedFromIds?: ID[];
  /** Explicação da IA sobre a fusão (o que pareou, o que cortou e por quê). */
  mergeNotes?: string;
  videoId?: ID;
  videoStatus: VideoStatus;
  videoError?: string;
}

export interface WorkoutItem extends Base {
  workoutId: ID;
  /** Ordem de execução dentro do treino (0, 1, 2…). */
  order: number;
  /** Itens com o mesmo `blockId` são executados juntos, alternando (bi-set / circuito). */
  blockId: string;
  /** Rótulo do personal, ex.: 'A1'. */
  label?: string;
  exerciseId: ID;
  /** Nome como veio no texto do personal. */
  rawName: string;
  prescription: Prescription;
  observations?: string;
  /** Trecho do vídeo deste treino que mostra o exercício. */
  clip?: ClipRef;
  /** Em treinos fundidos: exercício encaixado no descanso de outro. */
  role?: 'principal' | 'pausa_ativa';
  /**
   * Resultado do casamento com o catálogo na importação.
   * 'baixa' = a IA não tem certeza; o usuário deve confirmar antes de treinar.
   */
  match: 'alta' | 'baixa' | 'novo';
}

// ---------- Execução ----------

export interface Session extends Base {
  workoutId: ID;
  date: ISODate;
  startedAt: Timestamp;
  /** Ausente enquanto o treino está em andamento. */
  finishedAt?: Timestamp;
  notes?: string;
}

/** Uma série executada (ou planejada, enquanto `done` é false). */
export interface SetLog extends Base {
  sessionId: ID;
  workoutItemId: ID;
  exerciseId: ID;
  /** 0, 1, 2… */
  setIndex: number;
  weightKg?: number;
  reps?: number;
  durationSec?: number;
  done: boolean;
  doneAt?: Timestamp;
  /** Série reconstruída do histórico do app antigo (valores aproximados). */
  legacy?: boolean;
}

// ---------- Sugestões da IA (sempre separadas do treino do personal) ----------

export interface Insight extends Base {
  kind: 'ponto_fraco' | 'exercicio' | 'volume' | 'recuperacao';
  title: string;
  body: string;
  /** Exercícios do catálogo citados. */
  exerciseIds: ID[];
  status: 'nova' | 'aceita' | 'dispensada';
}

// ---------- Configurações ----------

export interface Settings {
  /** Chave da API Gemini (até a fase de nuvem, fica só neste aparelho). */
  geminiApiKey?: string;
  /** Perfil do atleta: restrições, objetivos, referências. Usado só em sugestões e fusão. */
  profile: string;
  /** Descanso padrão entre séries quando o personal não especifica. */
  defaultRestSec: number;
  /** Histórico do app antigo já foi importado. */
  legacyMigrated?: boolean;
}

export interface SettingRow {
  key: keyof Settings;
  value: unknown;
}
