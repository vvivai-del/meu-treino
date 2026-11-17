// Pipeline de importação: texto (+ vídeo) → treino no banco local.
// O texto vira treino em segundos; o vídeo é enviado e analisado em segundo plano.
import { AIError, locateSegments, parseWorkoutText, uploadVideo } from '../ai';
import type { CatalogEntry, ParsedItem, ParsedWorkout, UploadedVideo } from '../ai';
import { db, stamp, touch } from '../db/db';
import type { ClipRef, Exercise, ID, Video, VideoStatus, Workout, WorkoutItem } from '../domain/types';
import { matchExercise, normalizeName, todayLocal } from '../engine';
import type { ImportInput } from './index';
import { parseWorkoutTextLocal } from './localParser';
import { readVideoDuration } from './videoDuration';

/** A IA apaga os arquivos após ~48h; consideramos 47h e exigimos folga ao reutilizar. */
const AI_FILE_TTL_MS = 47 * 3600 * 1000;
const AI_FILE_MARGIN_MS = 15 * 60 * 1000;
const ACTIVE_STATUSES: VideoStatus[] = ['pendente', 'enviando', 'analisando'];
/** Erros em que o interpretador local assume. */
const FALLBACK_CODES = ['sem_chave', 'rede', 'cota'];

// ---------- texto → treino ----------

async function interpret(text: string, catalog: Exercise[]): Promise<ParsedWorkout> {
  const entries: CatalogEntry[] = catalog.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases }));
  let parsed: ParsedWorkout;
  try {
    parsed = await parseWorkoutText(text, entries);
  } catch (e) {
    if (!(e instanceof AIError) || !FALLBACK_CODES.includes(e.code)) throw e;
    parsed = parseWorkoutTextLocal(text);
  }
  if (parsed.items.length === 0) {
    throw new Error('Não encontrei nenhum exercício no texto. Confira se ele tem séries e repetições, como "4x12".');
  }
  return parsed;
}

interface Resolved {
  exercise: Exercise;
  match: WorkoutItem['match'];
  created: boolean;
}

/** Escolhe (ou cria) o exercício do catálogo para um item. `known` inclui os criados nesta importação. */
function resolveExercise(item: ParsedItem, known: Exercise[]): Resolved {
  const writtenKey = normalizeName(item.rawName);

  const byId = item.catalogId ? known.find((e) => e.id === item.catalogId && !e.deletedAt) : undefined;
  if (byId) return { exercise: byId, match: item.confidence, created: false };

  const best = matchExercise(item.rawName, known).sort((a, b) => b.score - a.score)[0];
  if (best && best.score >= 1) return { exercise: best.exercise, match: 'alta', created: false };
  if (best && best.score >= 0.8) return { exercise: best.exercise, match: 'baixa', created: false };

  const exercise: Exercise = {
    ...stamp(),
    name: item.rawName,
    nameKey: writtenKey,
    aliases: [],
    aliasKeys: [],
    kind: item.kind,
    loadType: item.loadType,
    ...(item.muscleGroup ? { muscleGroup: item.muscleGroup } : {}),
  };
  return { exercise, match: 'novo', created: true };
}

/** Acrescenta o nome escrito como alias quando ele ainda não é conhecido. */
function addAliasIfNew(exercise: Exercise, rawName: string): boolean {
  const key = normalizeName(rawName);
  if (!key || key === exercise.nameKey || exercise.aliasKeys.includes(key)) return false;
  exercise.aliases = [...exercise.aliases, rawName];
  exercise.aliasKeys = [...exercise.aliasKeys, key];
  exercise.updatedAt = Date.now();
  return true;
}

export async function importWorkout(input: ImportInput): Promise<ID> {
  const { text, video: file } = input;

  // 1. O vídeo é guardado no aparelho antes de qualquer chamada de rede.
  let video: Video | undefined;
  if (file) {
    video = {
      ...stamp(),
      kind: 'original',
      mimeType: file.type || 'video/mp4',
      sizeBytes: file.size,
      fileName: file.name || undefined,
      hasLocalBlob: true,
    };
    const v = video;
    await db.transaction('rw', db.videos, db.videoBlobs, async () => {
      await db.videos.add(v);
      await db.videoBlobs.put({ videoId: v.id, blob: file });
    });
  }

  let workoutId: ID;
  try {
    // 2. Interpretação do texto (IA, com reserva local).
    const catalog = (await db.exercises.toArray()).filter((e) => !e.deletedAt);
    const parsed = await interpret(text, catalog);

    // 3. Treino + itens (e exercícios novos / aliases) numa única transação.
    const workout: Workout = {
      ...stamp(),
      title: parsed.title.trim() || 'Treino',
      date: input.date ?? todayLocal(),
      sourceText: text,
      origin: 'personal',
      ...(video ? { videoId: video.id } : {}),
      videoStatus: video ? 'pendente' : 'sem_video',
    };
    workoutId = workout.id;

    await db.transaction('rw', db.exercises, db.workouts, db.workoutItems, async () => {
      const known = catalog.map((e) => ({ ...e, aliases: [...e.aliases], aliasKeys: [...e.aliasKeys] }));
      const blockIds = new Map<string, string>();
      const items: WorkoutItem[] = [];
      const changed = new Map<ID, Exercise>();

      parsed.items.forEach((p, order) => {
        const r = resolveExercise(p, known);
        if (r.created) {
          known.push(r.exercise);
          changed.set(r.exercise.id, r.exercise);
        } else if (r.match === 'alta' && addAliasIfNew(r.exercise, p.rawName)) {
          changed.set(r.exercise.id, r.exercise);
        }
        if (!blockIds.has(p.block)) blockIds.set(p.block, `${workout.id}:${blockIds.size + 1}`);

        items.push({
          ...stamp(),
          workoutId: workout.id,
          order,
          blockId: blockIds.get(p.block)!,
          ...(p.label ? { label: p.label } : {}),
          exerciseId: r.exercise.id,
          rawName: p.rawName,
          prescription: {
            sets: p.sets,
            ...(p.repsMin !== undefined ? { repsMin: p.repsMin } : {}),
            ...(p.repsMax !== undefined ? { repsMax: p.repsMax } : {}),
            ...(p.durationSec !== undefined ? { durationSec: p.durationSec } : {}),
            ...(p.perSide ? { perSide: true } : {}),
            ...(p.restSec !== undefined ? { restSec: p.restSec } : {}),
            raw: p.prescriptionRaw,
          },
          ...(p.observations ? { observations: p.observations } : {}),
          match: r.match,
        });
      });

      if (changed.size) await db.exercises.bulkPut([...changed.values()]);
      await db.workouts.add(workout);
      await db.workoutItems.bulkAdd(items);
    });
  } catch (e) {
    // Importação falhou antes de existir treino: não deixa vídeo órfão no aparelho.
    if (video) {
      const v = video;
      await db.transaction('rw', db.videos, db.videoBlobs, async () => {
        await db.videoBlobs.delete(v.id);
        await db.videos.delete(v.id);
      });
    }
    throw e;
  }

  // 4. O vídeo segue em segundo plano.
  if (video) scheduleVideo(workoutId);
  return workoutId;
}

// ---------- vídeo em segundo plano ----------

const queued = new Set<ID>();
let chain: Promise<void> = Promise.resolve();

/** Processa um treino por vez (evita vários uploads grandes em paralelo e o mesmo treino duas vezes). */
function scheduleVideo(workoutId: ID): void {
  if (queued.has(workoutId)) return;
  queued.add(workoutId);
  chain = chain
    .then(() => processVideo(workoutId))
    .catch(() => undefined)
    .finally(() => queued.delete(workoutId));
}

/** Resolve quando não há mais vídeo na fila. Útil em testes e para telas que queiram aguardar. */
export function whenVideoQueueIdle(): Promise<void> {
  return chain.then(() => (queued.size ? whenVideoQueueIdle() : undefined));
}

function setStatus(workoutId: ID, videoStatus: VideoStatus, videoError?: string) {
  return db.workouts.update(workoutId, { videoStatus, videoError, ...touch() });
}

function errorText(e: unknown): string {
  if (e instanceof AIError) return e.message;
  return 'Não foi possível processar o vídeo. Tente de novo.';
}

async function ensureUploaded(video: Video, blob: Blob, forceNew: boolean): Promise<UploadedVideo> {
  const valid = !forceNew && video.aiFileUri && (video.aiFileExpiresAt ?? 0) > Date.now() + AI_FILE_MARGIN_MS;
  if (valid) return { fileUri: video.aiFileUri!, mimeType: video.mimeType };
  const up = await uploadVideo(blob);
  await db.videos.update(video.id, {
    aiFileUri: up.fileUri,
    aiFileExpiresAt: Date.now() + AI_FILE_TTL_MS,
    ...touch(),
  });
  return up;
}

async function processVideo(workoutId: ID): Promise<void> {
  const workout = await db.workouts.get(workoutId);
  if (!workout || workout.deletedAt || !workout.videoId) return;
  const video = await db.videos.get(workout.videoId);
  const blobRow = video ? await db.videoBlobs.get(video.id) : undefined;
  if (!video || !blobRow) {
    await setStatus(workoutId, 'erro', 'O vídeo não está mais neste aparelho. Importe o treino de novo com o vídeo.');
    return;
  }

  try {
    await setStatus(workoutId, 'enviando');

    if (video.durationSec === undefined) {
      const d = await readVideoDuration(blobRow.blob).catch(() => undefined);
      if (d) {
        video.durationSec = d;
        await db.videos.update(video.id, { durationSec: d, ...touch() });
      }
    }

    const items = (await db.workoutItems.where('workoutId').equals(workoutId).toArray())
      .filter((i) => !i.deletedAt)
      .sort((a, b) => a.order - b.order);
    const request = items.map((i, n) => ({ key: String(n + 1), name: i.rawName }));

    let uploaded = await ensureUploaded(video, blobRow.blob, false);
    await setStatus(workoutId, 'analisando');

    let segments;
    try {
      segments = await locateSegments(uploaded, request);
    } catch (e) {
      // O arquivo na IA pode ter sumido antes do prazo: envia de novo uma vez.
      if (!(e instanceof AIError) || e.code !== 'video' || !video.aiFileUri) throw e;
      await setStatus(workoutId, 'enviando');
      uploaded = await ensureUploaded({ ...video, aiFileUri: undefined }, blobRow.blob, true);
      await setStatus(workoutId, 'analisando');
      segments = await locateSegments(uploaded, request);
    }

    const duration = video.durationSec;
    const clips = new Map<string, { clip: ClipRef; cues?: string }>();
    for (const s of segments) {
      if (duration !== undefined && s.startSec >= duration) continue;
      const endSec = duration !== undefined ? Math.min(s.endSec, duration) : s.endSec;
      if (endSec <= s.startSec) continue;
      clips.set(s.key, { clip: { videoId: video.id, startSec: s.startSec, endSec }, cues: s.cues });
    }
    if (clips.size === 0) {
      throw new AIError('A IA não encontrou os exercícios no vídeo. Tente de novo.', 'resposta_invalida');
    }

    await db.transaction('rw', db.workoutItems, db.exercises, db.workouts, async () => {
      for (const [n, item] of items.entries()) {
        const found = clips.get(String(n + 1));
        if (!found) continue;
        const patch: Partial<WorkoutItem> = { clip: found.clip };
        if (found.cues && !item.observations?.trim()) patch.observations = found.cues;
        await db.workoutItems.update(item.id, { ...patch, ...touch() });

        const ex = await db.exercises.get(item.exerciseId);
        if (ex) {
          const exPatch: Partial<Exercise> = { clip: found.clip };
          if (found.cues && !ex.cues?.trim()) exPatch.cues = found.cues;
          await db.exercises.update(ex.id, { ...exPatch, ...touch() });
        }
      }
      await db.workouts.update(workoutId, { videoStatus: 'pronto', videoError: undefined, ...touch() });
    });
  } catch (e) {
    await setStatus(workoutId, 'erro', errorText(e));
  }
}

/** Boot do app: retoma treinos com vídeo que ficaram pela metade. Não espera o processamento terminar. */
export async function resumePendingImports(): Promise<void> {
  const workouts = (await db.workouts.toArray()).filter(
    (w) => !w.deletedAt && w.videoId && ACTIVE_STATUSES.includes(w.videoStatus),
  );
  for (const w of workouts) {
    const video = await db.videos.get(w.videoId!);
    if (video?.hasLocalBlob) scheduleVideo(w.id);
  }
}

/** Reprocessa o vídeo de um treino em 'erro'. */
export async function retryVideo(workoutId: ID): Promise<void> {
  const w = await db.workouts.get(workoutId);
  if (!w || w.deletedAt || w.videoStatus !== 'erro' || !w.videoId) return;
  await setStatus(workoutId, 'pendente');
  scheduleVideo(workoutId);
}
