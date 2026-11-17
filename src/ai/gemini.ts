// Cliente Gemini (REST). Único arquivo do app que fala com a API.
// A chave vem de `getSettings().geminiApiKey` e viaja sempre no cabeçalho `x-goog-api-key`.
import { getSettings } from '../db/db';
import type { ExerciseKind, LoadType } from '../domain/types';
import {
  AIError,
  type CatalogEntry,
  type ParsedItem,
  type ParsedWorkout,
  type UploadedVideo,
  type VideoSegment,
} from './index';

const API_ROOT = 'https://generativelanguage.googleapis.com';

/** Modelos para interpretar texto: do preferido (rápido) ao reserva. */
export const TEXT_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite'];
/** Modelos para localizar exercícios no vídeo: do preferido (melhor em vídeo) ao reserva. */
export const VIDEO_MODELS = ['gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.6-flash'];

/** Tempos em ms. Mutável só para os testes não esperarem de verdade. */
export const timing = {
  retryDelayMs: 1500,
  textTimeoutMs: 60_000,
  videoTimeoutMs: 6 * 60_000,
  pollFirstMs: 2000,
  pollMaxStepMs: 10_000,
  pollTimeoutMs: 5 * 60_000,
};

const ATTEMPTS_PER_MODEL = 2;
const MAX_OUTPUT_TOKENS = 32768;

const KINDS: ExerciseKind[] = ['forca', 'mobilidade', 'potencia', 'cardio', 'outro'];
const LOAD_TYPES: LoadType[] = ['peso', 'peso_corporal', 'tempo'];

const MSG = {
  semChave: 'Cole sua chave da API Gemini em Ajustes para usar a IA.',
  rede: 'Sem conexão com a internet, ou o serviço de IA não respondeu. Tente de novo.',
  cota: 'O limite de uso da IA foi atingido. Aguarde alguns minutos ou confira o plano da sua chave Gemini.',
  invalida: 'A IA respondeu em um formato inesperado. Tente de novo.',
  chave: 'A chave da API Gemini foi recusada. Confira se ela está correta em Ajustes.',
  videoExpirado: 'A IA não encontrou o vídeo enviado (ele pode ter expirado). Ele será enviado de novo.',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function requireKey(): Promise<string> {
  const key = (await getSettings()).geminiApiKey?.trim();
  if (!key) throw new AIError(MSG.semChave, 'sem_chave');
  return key;
}

// ---------- chamada ao generateContent com fallback ----------

type FailKind = 'rede' | 'cota' | 'invalida' | 'outro';

interface GenerateOptions<T> {
  models: string[];
  parts: unknown[];
  schema: unknown;
  timeoutMs: number;
  hasVideo: boolean;
  validate: (raw: unknown) => T;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractText(data: unknown): string {
  const d = data as {
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    promptFeedback?: { blockReason?: string };
  };
  const cand = d?.candidates?.[0];
  if (!cand) {
    const why = d?.promptFeedback?.blockReason;
    throw new AIError(why ? `A IA recusou o conteúdo (${why}).` : MSG.invalida, 'resposta_invalida');
  }
  if (cand.finishReason === 'MAX_TOKENS') {
    throw new AIError('A resposta da IA foi cortada por ser longa demais.', 'resposta_invalida');
  }
  const text = (cand.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
  if (!text) throw new AIError(MSG.invalida, 'resposta_invalida');
  return text;
}

/** Converte o texto da resposta em JSON, tolerando cercas ``` e texto em volta. */
export function parseJsonText(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.search(/[{[]/);
    const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        /* cai no erro abaixo */
      }
    }
    throw new AIError(MSG.invalida, 'resposta_invalida');
  }
}

async function generateJson<T>(opts: GenerateOptions<T>): Promise<T> {
  const apiKey = await requireKey();
  let last: { kind: FailKind; detail: string } = { kind: 'outro', detail: 'nenhum modelo respondeu' };

  for (const model of opts.models) {
    let useSchema = true;
    let attempt = 0;
    while (attempt < ATTEMPTS_PER_MODEL) {
      const generationConfig: Record<string, unknown> = {
        temperature: 0.1,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: 'application/json',
      };
      if (useSchema) generationConfig.responseSchema = opts.schema;

      let res: Response;
      try {
        res = await fetchWithTimeout(
          `${API_ROOT}/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({ contents: [{ role: 'user', parts: opts.parts }], generationConfig }),
          },
          opts.timeoutMs,
        );
      } catch (e) {
        last = { kind: 'rede', detail: e instanceof Error ? e.message : String(e) };
        attempt++;
        if (attempt < ATTEMPTS_PER_MODEL) await sleep(timing.retryDelayMs * attempt);
        continue;
      }

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        const s = res.status;
        if (s === 401 || (s === 400 && /api key/i.test(msg)) || (s === 403 && !/file/i.test(msg))) {
          throw new AIError(`${MSG.chave} (${msg})`, 'outro');
        }
        if (opts.hasVideo && (s === 400 || s === 403 || s === 404) && /file/i.test(msg)) {
          throw new AIError(MSG.videoExpirado, 'video');
        }
        if (s === 400 && useSchema && /schema|unknown name|invalid json payload/i.test(msg)) {
          useSchema = false; // reenvia sem responseSchema (o formato vai descrito no prompt)
          continue;
        }
        if (s === 429) {
          last = { kind: 'cota', detail: msg };
          break;
        }
        if (s === 404) {
          last = { kind: 'outro', detail: msg };
          break;
        }
        if (s >= 500) {
          last = { kind: 'outro', detail: msg };
          attempt++;
          if (attempt < ATTEMPTS_PER_MODEL) await sleep(timing.retryDelayMs * attempt);
          continue;
        }
        throw new AIError(`A IA recusou o pedido: ${msg}`, 'outro');
      }

      try {
        const data: unknown = await res.json();
        return opts.validate(parseJsonText(extractText(data)));
      } catch (e) {
        if (e instanceof AIError && e.code === 'resposta_invalida') {
          last = { kind: 'invalida', detail: e.message };
          break; // tenta o próximo modelo
        }
        last = { kind: 'rede', detail: e instanceof Error ? e.message : String(e) };
        attempt++;
        if (attempt < ATTEMPTS_PER_MODEL) await sleep(timing.retryDelayMs * attempt);
      }
    }
  }

  switch (last.kind) {
    case 'rede':
      throw new AIError(MSG.rede, 'rede');
    case 'cota':
      throw new AIError(MSG.cota, 'cota');
    case 'invalida':
      throw new AIError(last.detail || MSG.invalida, 'resposta_invalida');
    default:
      throw new AIError(`O serviço de IA não está disponível agora (${last.detail}).`, 'outro');
  }
}

// ---------- validação à mão ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
}
const int = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n);
};
const bad = (why: string) => new AIError(`${MSG.invalida} (${why})`, 'resposta_invalida');

function validateParsed(raw: unknown, catalog: CatalogEntry[]): ParsedWorkout {
  if (!isObj(raw) || !Array.isArray(raw.items) || raw.items.length === 0) throw bad('sem exercícios');
  const catalogIds = new Set(catalog.map((c) => c.id));
  const usedKeys = new Set<string>();

  const items: ParsedItem[] = raw.items.map((r, i) => {
    if (!isObj(r)) throw bad(`item ${i + 1}`);
    const rawName = str(r.rawName);
    if (!rawName) throw bad(`item ${i + 1} sem nome`);

    let key = str(r.key) ?? String(i + 1);
    if (usedKeys.has(key)) key = String(i + 1);
    while (usedKeys.has(key)) key += '_';
    usedKeys.add(key);

    const label = str(r.label);
    const labelLetters = label?.match(/^([A-Za-z]+)\s*\d+$/)?.[1]?.toUpperCase();
    const block = str(r.block) ?? labelLetters ?? `item${key}`;

    const catalogId = str(r.catalogId);
    const validCatalogId = catalogId && catalogIds.has(catalogId) ? catalogId : undefined;
    const confidence: 'alta' | 'baixa' = r.confidence === 'alta' ? 'alta' : 'baixa';

    const item: ParsedItem = {
      key,
      rawName,
      block,
      prescriptionRaw: str(r.prescriptionRaw) ?? '',
      sets: Math.max(1, int(r.sets) ?? 1),
      kind: KINDS.includes(r.kind as ExerciseKind) ? (r.kind as ExerciseKind) : 'forca',
      loadType: LOAD_TYPES.includes(r.loadType as LoadType) ? (r.loadType as LoadType) : 'peso',
      confidence: validCatalogId ? confidence : 'alta',
    };
    if (label) item.label = label;
    const repsMin = int(r.repsMin);
    const repsMax = int(r.repsMax);
    if (repsMin !== undefined) item.repsMin = repsMin;
    if (repsMax !== undefined) item.repsMax = repsMax;
    const dur = int(r.durationSec);
    if (dur !== undefined) item.durationSec = dur;
    const rest = int(r.restSec);
    if (rest !== undefined) item.restSec = rest;
    if (typeof r.perSide === 'boolean') item.perSide = r.perSide;
    const obs = str(r.observations);
    if (obs) item.observations = obs;
    const mg = str(r.muscleGroup);
    if (mg) item.muscleGroup = mg;
    if (validCatalogId) item.catalogId = validCatalogId;
    return item;
  });

  return { title: str(raw.title) ?? 'Treino', items };
}

/** '01:15' → 75; '1:02:03', '75', '75s', 75 e '12.5' também valem. */
export function parseTimestamp(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase().replace(',', '.');
  const plain = t.match(/^(\d+(?:\.\d+)?)\s*s?$/);
  if (plain) return Number(plain[1]);
  const parts = t.split(':');
  if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return undefined;
  const nums = parts.map(Number);
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

function validateSegments(raw: unknown, items: Array<{ key: string }>): VideoSegment[] {
  const list = Array.isArray(raw) ? raw : isObj(raw) ? raw.segments : undefined;
  if (!Array.isArray(list)) throw bad('sem lista de trechos');
  const known = new Set(items.map((i) => i.key));
  const seen = new Set<string>();
  const out: VideoSegment[] = [];
  for (const r of list) {
    if (!isObj(r)) continue;
    const key = typeof r.key === 'number' ? String(r.key) : str(r.key);
    if (!key || !known.has(key) || seen.has(key)) continue;
    const startSec = parseTimestamp(r.start ?? r.startSec ?? r.inicio);
    const endSec = parseTimestamp(r.end ?? r.endSec ?? r.fim);
    if (startSec === undefined || endSec === undefined || endSec <= startSec) continue;
    seen.add(key);
    const seg: VideoSegment = { key, startSec: Math.round(startSec * 10) / 10, endSec: Math.round(endSec * 10) / 10 };
    const cues = str(r.cues);
    if (cues) seg.cues = cues;
    out.push(seg);
  }
  return out;
}

// ---------- texto ----------

const S = 'STRING';
const PARSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: S },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: S },
          label: { type: S, nullable: true },
          rawName: { type: S },
          block: { type: S },
          prescriptionRaw: { type: S },
          sets: { type: 'INTEGER' },
          repsMin: { type: 'INTEGER', nullable: true },
          repsMax: { type: 'INTEGER', nullable: true },
          durationSec: { type: 'INTEGER', nullable: true },
          restSec: { type: 'INTEGER', nullable: true },
          perSide: { type: 'BOOLEAN', nullable: true },
          observations: { type: S, nullable: true },
          kind: { type: S, enum: KINDS },
          loadType: { type: S, enum: LOAD_TYPES },
          muscleGroup: { type: S, nullable: true },
          catalogId: { type: S, nullable: true },
          confidence: { type: S, enum: ['alta', 'baixa'] },
        },
        required: ['key', 'rawName', 'block', 'prescriptionRaw', 'sets', 'kind', 'loadType', 'confidence'],
      },
    },
  },
  required: ['title', 'items'],
};

function parsePrompt(text: string, catalog: CatalogEntry[]): string {
  const cat = catalog.map((c) => JSON.stringify({ id: c.id, name: c.name, aliases: c.aliases })).join('\n');
  return `Você transcreve o treino escrito por um personal trainer para dados estruturados. Seja FIEL ao texto: não reordene, não remova, não adapte, não invente e não sugira cargas.

REGRAS
- Gere exatamente uma entrada em "items" por exercício, na ORDEM EXATA do texto. Não crie itens para títulos, aquecimento genérico sem exercício, avisos ou comentários soltos; comentários sobre um exercício vão em "observations".
- "label": o rótulo escrito pelo personal (ex.: "A1", "B2"), separado do nome. Sem rótulo, omita.
- "rawName": o nome do exercício como escrito, sem rótulo e sem prescrição.
- "block": exercícios feitos juntos têm o MESMO valor. "A1" e "A2" → bloco "A"; "bi-set", "conjugado", "super-set" e "circuito" → todos os exercícios do grupo no mesmo bloco. Exercício sem rótulo e fora de grupo recebe um bloco só dele (ex.: "item3").
- "prescriptionRaw": séries e repetições exatamente como escritas (ex.: "4x12", "3x30s", "3x8-10 cada lado"). Se não houver, string vazia.
- "sets", "repsMin", "repsMax" (para "8-12": 8 e 12; para "12": 12 e 12), "durationSec" (para exercícios por tempo), "restSec" (só se escrito), "perSide" (true para "cada lado"/"por perna").
- "kind": forca | mobilidade | potencia | cardio | outro. "loadType": peso (carga externa), peso_corporal (só o corpo, sem carga) ou tempo (medido em segundos). "muscleGroup": músculo principal, curto.
- "title": título curto do treino (ex.: "Lower Body + Core"); se o texto não tiver, resuma em poucas palavras.
- "key": "1", "2", "3"… na ordem.

CASAMENTO COM O CATÁLOGO
Preencha "catalogId" SOMENTE se o exercício for exatamente o mesmo movimento, com o mesmo equipamento e a mesma variação de um item do catálogo abaixo (nomes diferentes para o mesmo exercício valem). Agachamento livre NÃO é agachamento búlgaro; supino com barra NÃO é supino com halteres. Use apenas ids que aparecem no catálogo. Se for claramente um exercício novo, omita "catalogId" e use confidence "alta". Se houver dúvida entre candidatos, preencha o mais provável e use confidence "baixa". Quando "catalogId" está presente e você tem certeza, confidence "alta".

CATÁLOGO (um JSON por linha; vazio se não há exercícios ainda)
${cat || '(vazio)'}

TEXTO DO PERSONAL
"""
${text}
"""

Responda somente com JSON no formato {"title": string, "items": [...]}.`;
}

export async function parseWorkoutText(text: string, catalog: CatalogEntry[]): Promise<ParsedWorkout> {
  return generateJson({
    models: TEXT_MODELS,
    parts: [{ text: parsePrompt(text, catalog) }],
    schema: PARSE_SCHEMA,
    timeoutMs: timing.textTimeoutMs,
    hasVideo: false,
    validate: (raw) => validateParsed(raw, catalog),
  });
}

// ---------- vídeo: upload ----------

function fileNameOf(uri: string): string {
  const m = uri.match(/files\/[^/?]+/);
  return m ? m[0] : `files/${uri.split('/').pop()}`;
}

function sendBytes(
  url: string,
  file: Blob,
  mimeType: string,
  onProgress?: (fraction: number) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');
    xhr.setRequestHeader('X-Goog-Upload-Offset', '0');
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.upload.onprogress = (ev) => {
      if (onProgress && ev.lengthComputable && ev.total > 0) onProgress(Math.min(1, ev.loaded / ev.total));
    };
    xhr.onerror = () => reject(new AIError('A conexão caiu durante o envio do vídeo. Tente de novo.', 'rede'));
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = xhr.onerror;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new AIError('O envio terminou, mas a resposta do servidor veio ilegível.', 'video'));
        }
      } else if (xhr.status === 429) {
        reject(new AIError(MSG.cota, 'cota'));
      } else if (xhr.status === 401 || xhr.status === 403) {
        reject(new AIError(MSG.chave, 'outro'));
      } else {
        reject(new AIError(`Falha ao enviar o vídeo (erro ${xhr.status}).`, 'video'));
      }
    };
    xhr.send(file);
  });
}

function fileState(data: unknown): { state?: string; uri?: string; name?: string } {
  const d = data as { file?: Record<string, unknown> } & Record<string, unknown>;
  const f = (isObj(d?.file) ? d.file : d) as Record<string, unknown>;
  const rawState = f?.state;
  const state = typeof rawState === 'string' ? rawState : isObj(rawState) ? str(rawState.name) : undefined;
  return { state, uri: str(f?.uri), name: str(f?.name) };
}

export async function uploadVideo(file: Blob, onProgress?: (fraction: number) => void): Promise<UploadedVideo> {
  const apiKey = await requireKey();
  const mimeType = file.type || 'video/mp4';
  const displayName = (file as File).name || 'treino';

  let startRes: Response;
  try {
    startRes = await fetch(`${API_ROOT}/upload/v1beta/files`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(file.size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    });
  } catch {
    throw new AIError(MSG.rede, 'rede');
  }
  if (!startRes.ok) {
    const msg = await readErrorMessage(startRes);
    if (startRes.status === 429) throw new AIError(MSG.cota, 'cota');
    if (startRes.status === 401 || startRes.status === 403 || (startRes.status === 400 && /api key/i.test(msg))) {
      throw new AIError(`${MSG.chave} (${msg})`, 'outro');
    }
    throw new AIError(`Não foi possível iniciar o envio do vídeo (${msg}).`, 'video');
  }
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new AIError('O servidor não devolveu o endereço de envio do vídeo.', 'video');

  const uploaded = fileState(await sendBytes(uploadUrl, file, mimeType, onProgress));
  if (!uploaded.uri) throw new AIError('O servidor não devolveu o endereço do vídeo enviado.', 'video');
  onProgress?.(1);
  if (uploaded.state === 'ACTIVE') return { fileUri: uploaded.uri, mimeType };
  if (uploaded.state === 'FAILED') throw new AIError('O servidor falhou ao processar o vídeo.', 'video');

  // espera o arquivo ficar ACTIVE, com intervalo crescente
  const fileName = uploaded.name ?? fileNameOf(uploaded.uri);
  const started = Date.now();
  let step = timing.pollFirstMs;
  let failures = 0;
  while (Date.now() - started < timing.pollTimeoutMs) {
    await sleep(step);
    step = Math.min(Math.round(step * 1.5), timing.pollMaxStepMs);
    try {
      const res = await fetch(`${API_ROOT}/v1beta/${fileName}`, { headers: { 'x-goog-api-key': apiKey } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const st = fileState(await res.json());
      failures = 0;
      if (st.state === 'FAILED') throw new AIError('O servidor falhou ao processar o vídeo.', 'video');
      if (st.state === 'ACTIVE' || st.state === undefined) return { fileUri: uploaded.uri, mimeType };
    } catch (e) {
      if (e instanceof AIError) throw e;
      if (++failures >= 3) throw new AIError(MSG.rede, 'rede');
    }
  }
  throw new AIError('O vídeo está demorando demais para ficar pronto no servidor. Tente de novo mais tarde.', 'video');
}

// ---------- vídeo: trechos ----------

const SEGMENTS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    segments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: S },
          start: { type: S },
          end: { type: S },
          cues: { type: S, nullable: true },
        },
        required: ['key', 'start', 'end'],
      },
    },
  },
  required: ['segments'],
};

function segmentsPrompt(items: Array<{ key: string; name: string }>): string {
  const list = items.map((i) => JSON.stringify({ key: i.key, name: i.name })).join('\n');
  return `Neste vídeo, um personal trainer demonstra e narra, em sequência, os exercícios de um treino. Para CADA exercício da lista abaixo, localize no vídeo o trecho em que ele é demonstrado ou explicado.

REGRAS
- Use o áudio (o personal diz o nome de cada exercício) e a imagem. Os exercícios costumam aparecer na ordem da lista, mas confirme pelo conteúdo.
- "start": momento em que o personal começa a falar ou demonstrar aquele exercício. "end": momento em que ele termina e passa ao próximo. Formato "MM:SS" (ex.: "01:15"; use "H:MM:SS" se passar de uma hora). O fim deve ser maior que o início.
- Se um exercício não aparece no vídeo, OMITA-O da resposta. Não invente trechos.
- "cues": resuma em uma ou duas frases curtas, em português, a dica técnica que o personal falou sobre este exercício (postura, respiração, erros comuns). Omita se ele não disse nada.
- Use exatamente as "key" da lista.

EXERCÍCIOS
${list}

Responda somente com JSON no formato {"segments": [{"key": string, "start": "MM:SS", "end": "MM:SS", "cues": string}]}.`;
}

export async function locateSegments(
  video: UploadedVideo,
  items: Array<{ key: string; name: string }>,
): Promise<VideoSegment[]> {
  return generateJson({
    models: VIDEO_MODELS,
    parts: [{ fileData: { mimeType: video.mimeType, fileUri: video.fileUri } }, { text: segmentsPrompt(items) }],
    schema: SEGMENTS_SCHEMA,
    timeoutMs: timing.videoTimeoutMs,
    hasVideo: true,
    validate: (raw) => validateSegments(raw, items),
  });
}
