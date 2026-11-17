import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, setSetting } from '../db/db';
import { AIError } from './index';
import { TEXT_MODELS, VIDEO_MODELS, locateSegments, parseTimestamp, parseWorkoutText, timing, uploadVideo } from './gemini';

const catalog = [
  { id: 'ex-1', name: 'Agachamento livre', aliases: [] },
  { id: 'ex-2', name: 'Supino reto', aliases: ['Supino'] },
];

function geminiBody(obj: unknown, extra: Record<string, unknown> = {}) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] }, ...extra }] };
}
const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const errRes = (status: number, message: string) => jsonRes({ error: { message } }, status);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await db.settings.clear();
  await setSetting('geminiApiKey', 'KEY-123');
  timing.retryDelayMs = 0;
  timing.pollFirstMs = 0;
  timing.pollMaxStepMs = 0;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const modelOf = (call: unknown[] | undefined) => String(call?.[0]).match(/models\/([^:]+):/)?.[1];

describe('parseWorkoutText', () => {
  const good = {
    title: 'Lower',
    items: [
      { key: 'a', rawName: 'Agachamento', label: 'A1', block: 'A', prescriptionRaw: '4x12', sets: 4, repsMin: 12, repsMax: 12, kind: 'forca', loadType: 'peso', catalogId: 'ex-1', confidence: 'alta', observations: null },
      { key: 'a', rawName: 'Prancha', label: 'A2', block: 'A', prescriptionRaw: '3x30s', sets: '3', durationSec: 30, kind: 'xyz', loadType: 'tempo', catalogId: 'inexistente', confidence: 'alta' },
      { rawName: 'Rosca', prescriptionRaw: '3x10', sets: 3, kind: 'forca', loadType: 'peso', confidence: 'alta' },
    ],
  };

  it('caminho feliz: chave no cabeçalho, JSON estruturado e normalização', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(geminiBody(good)));
    const out = await parseWorkoutText('texto', catalog);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain('KEY-123');
    expect(String(url)).toContain(`models/${TEXT_MODELS[0]}:generateContent`);
    expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'KEY-123' });
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.generationConfig.responseMimeType).toBe('application/json');
    expect(sent.generationConfig.responseSchema).toBeTruthy();
    expect(sent.generationConfig.temperature).toBeLessThanOrEqual(0.3);
    expect(sent.contents[0].parts[0].text).toContain('ex-1');

    expect(out.title).toBe('Lower');
    expect(out.items.map((i) => i.rawName)).toEqual(['Agachamento', 'Prancha', 'Rosca']);
    expect(out.items[0]!).toMatchObject({ key: 'a', catalogId: 'ex-1', confidence: 'alta', label: 'A1', block: 'A' });
    // key duplicada vira sequencial; catalogId inexistente é descartado; kind inválido vira 'forca'; sets textual vira número
    expect(out.items[1]!.key).toBe('2');
    expect(out.items[1]!.catalogId).toBeUndefined();
    expect(out.items[1]!).toMatchObject({ kind: 'forca', sets: 3, durationSec: 30, loadType: 'tempo' });
    // sem key e sem bloco: key sequencial e bloco próprio
    expect(out.items[2]!.key).toBe('3');
    expect(out.items[2]!.block).not.toBe('A');
  });

  it('sem chave → sem_chave, sem chamar a rede', async () => {
    await db.settings.clear();
    await expect(parseWorkoutText('x', [])).rejects.toMatchObject({ code: 'sem_chave' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404/429/503 caem para o próximo modelo', async () => {
    fetchMock
      .mockResolvedValueOnce(errRes(404, 'model not found'))
      .mockResolvedValueOnce(errRes(429, 'quota'))
      .mockResolvedValueOnce(errRes(503, 'overloaded')) // 1ª tentativa do 3º modelo
      .mockResolvedValueOnce(errRes(503, 'overloaded')) // 2ª tentativa
      .mockResolvedValueOnce(jsonRes(geminiBody(good)));
    const out = await parseWorkoutText('x', catalog);
    expect(out.items).toHaveLength(3);
    expect(fetchMock.mock.calls.map(modelOf)).toEqual([
      TEXT_MODELS[0],
      TEXT_MODELS[1],
      TEXT_MODELS[2],
      TEXT_MODELS[2],
      TEXT_MODELS[3],
    ]);
  });

  it('erro transitório é repetido no mesmo modelo', async () => {
    fetchMock.mockResolvedValueOnce(errRes(503, 'busy')).mockResolvedValueOnce(jsonRes(geminiBody(good)));
    await parseWorkoutText('x', catalog);
    expect(fetchMock.mock.calls.map(modelOf)).toEqual([TEXT_MODELS[0], TEXT_MODELS[0]]);
  });

  it('todos os modelos com 429 → cota', async () => {
    fetchMock.mockImplementation(async () => errRes(429, 'quota'));
    await expect(parseWorkoutText('x', [])).rejects.toMatchObject({ code: 'cota' });
    expect(fetchMock).toHaveBeenCalledTimes(TEXT_MODELS.length);
  });

  it('falha de fetch → rede', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(parseWorkoutText('x', [])).rejects.toMatchObject({ code: 'rede' });
  });

  it('chave recusada → outro com mensagem clara, sem tentar outros modelos', async () => {
    fetchMock.mockResolvedValue(errRes(400, 'API key not valid. Please pass a valid API key.'));
    const err = await parseWorkoutText('x', []).catch((e) => e);
    expect(err).toBeInstanceOf(AIError);
    expect(err.code).toBe('outro');
    expect(err.message).toContain('chave');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resposta malformada → resposta_invalida (tenta os outros modelos antes)', async () => {
    fetchMock.mockImplementation(async () => jsonRes(geminiBody('isto não é json')));
    await expect(parseWorkoutText('x', [])).rejects.toMatchObject({ code: 'resposta_invalida' });
    expect(fetchMock).toHaveBeenCalledTimes(TEXT_MODELS.length);
  });

  it.each([
    ['sem items', { title: 'x' }],
    ['items vazio', { title: 'x', items: [] }],
    ['item sem nome', { title: 'x', items: [{ prescriptionRaw: '3x10' }] }],
    ['raiz é array de strings', ['a']],
  ])('formato inválido: %s', async (_n, body) => {
    fetchMock.mockImplementation(async () => jsonRes(geminiBody(body)));
    await expect(parseWorkoutText('x', [])).rejects.toMatchObject({ code: 'resposta_invalida' });
  });

  it('aceita JSON em cerca de código e ignora partes de "thought"', async () => {
    const body = {
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: 'pensando...', thought: true }, { text: '```json\n' + JSON.stringify(good) + '\n```' }] },
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(jsonRes(body));
    expect((await parseWorkoutText('x', catalog)).items).toHaveLength(3);
  });

  it('resposta cortada (MAX_TOKENS) é inválida', async () => {
    fetchMock.mockImplementation(async () => jsonRes(geminiBody('{"title":"x","items":[', { finishReason: 'MAX_TOKENS' })));
    await expect(parseWorkoutText('x', [])).rejects.toMatchObject({ code: 'resposta_invalida' });
  });

  it('400 por causa do schema reenvia sem responseSchema', async () => {
    fetchMock
      .mockResolvedValueOnce(errRes(400, 'Invalid JSON payload received. Unknown name "nullable" at response_schema'))
      .mockResolvedValueOnce(jsonRes(geminiBody(good)));
    await parseWorkoutText('x', catalog);
    const second = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(second.generationConfig.responseSchema).toBeUndefined();
    expect(second.generationConfig.responseMimeType).toBe('application/json');
    expect(modelOf(fetchMock.mock.calls[1])).toBe(TEXT_MODELS[0]);
  });
});

describe('parseTimestamp', () => {
  it.each([
    ['01:15', 75],
    ['1:02:03', 3723],
    ['75', 75],
    ['75s', 75],
    ['12.5', 12.5],
    [30, 30],
    ['00:07,5', 7.5],
  ])('%s → %s', (input, expected) => expect(parseTimestamp(input)).toBe(expected));
  it.each([['abc'], [''], [null], [-3], ['1:xx'], ['1:2:3:4']])('%s inválido', (input) =>
    expect(parseTimestamp(input)).toBeUndefined(),
  );
});

describe('locateSegments', () => {
  const video = { fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', mimeType: 'video/quicktime' };
  const items = [
    { key: '1', name: 'Agachamento' },
    { key: '2', name: 'Prancha' },
    { key: '3', name: 'Remada' },
  ];

  it('converte timestamps, descarta inválidos e mantém as dicas', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes(
        geminiBody({
          segments: [
            { key: '1', start: '00:10', end: '01:05', cues: 'Joelho alinhado' },
            { key: '2', start: '01:05', end: '01:05' }, // fim <= início
            { key: '9', start: '02:00', end: '02:30' }, // chave desconhecida
            { key: '3', start: 'xx', end: '03:00' }, // timestamp ilegível
            { key: '1', start: '05:00', end: '06:00' }, // duplicada
            { key: '3', start: '1:01:00', end: '1:02:00.5' },
          ],
        }),
      ),
    );
    const out = await locateSegments(video, items);
    expect(out).toEqual([
      { key: '1', startSec: 10, endSec: 65, cues: 'Joelho alinhado' },
      { key: '3', startSec: 3660, endSec: 3720.5 },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(VIDEO_MODELS[0]);
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.contents[0].parts[0].fileData).toEqual({ mimeType: 'video/quicktime', fileUri: video.fileUri });
    expect(sent.contents[0].parts[1].text).toContain('Prancha');
  });

  it('usa o próximo modelo quando o primeiro falha', async () => {
    fetchMock
      .mockResolvedValueOnce(errRes(404, 'model not found'))
      .mockResolvedValueOnce(jsonRes(geminiBody({ segments: [] })));
    expect(await locateSegments(video, items)).toEqual([]);
    expect(modelOf(fetchMock.mock.calls[1])).toBe(VIDEO_MODELS[1]);
  });

  it('resposta sem lista de trechos é inválida', async () => {
    fetchMock.mockImplementation(async () => jsonRes(geminiBody({ foo: 1 })));
    await expect(locateSegments(video, items)).rejects.toMatchObject({ code: 'resposta_invalida' });
  });

  it('arquivo inexistente/expirado → video', async () => {
    fetchMock.mockResolvedValue(errRes(403, 'Permission denied on resource (or it may not exist): File abc'));
    await expect(locateSegments(video, items)).rejects.toMatchObject({ code: 'video' });
  });
});

describe('uploadVideo', () => {
  class FakeXHR {
    static instances: FakeXHR[] = [];
    static response = { status: 200, body: '{"file":{"name":"files/abc","uri":"https://x/files/abc","state":"PROCESSING"}}' };
    static fail = false;
    headers: Record<string, string> = {};
    method = '';
    url = '';
    status = 0;
    responseText = '';
    upload: { onprogress?: (e: unknown) => void } = {};
    onload?: () => void;
    onerror?: () => void;
    ontimeout?: () => void;
    onabort?: () => void;
    sent?: unknown;
    constructor() {
      FakeXHR.instances.push(this);
    }
    open(m: string, u: string) {
      this.method = m;
      this.url = u;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    send(body: unknown) {
      this.sent = body;
      queueMicrotask(() => {
        if (FakeXHR.fail) return this.onerror?.();
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
        this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
        this.status = FakeXHR.response.status;
        this.responseText = FakeXHR.response.body;
        this.onload?.();
      });
    }
  }

  const startOk = () => new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example/u1' } });
  const file = new File([new Uint8Array(100)], 'treino.mov', { type: 'video/quicktime' });

  beforeEach(() => {
    FakeXHR.instances = [];
    FakeXHR.fail = false;
    FakeXHR.response = { status: 200, body: '{"file":{"name":"files/abc","uri":"https://x/files/abc","state":"PROCESSING"}}' };
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
  });

  it('caminho feliz: tipo real do arquivo, progresso e espera até ACTIVE', async () => {
    fetchMock
      .mockResolvedValueOnce(startOk())
      .mockResolvedValueOnce(jsonRes({ name: 'files/abc', uri: 'https://x/files/abc', state: 'PROCESSING' }))
      .mockResolvedValueOnce(jsonRes({ name: 'files/abc', uri: 'https://x/files/abc', state: 'ACTIVE' }));
    const progress: number[] = [];
    const out = await uploadVideo(file, (f) => progress.push(f));

    expect(out).toEqual({ fileUri: 'https://x/files/abc', mimeType: 'video/quicktime' });
    expect(progress).toEqual([0.5, 1, 1]);

    const [startUrl, startInit] = fetchMock.mock.calls[0]!;
    expect(String(startUrl)).toBe('https://generativelanguage.googleapis.com/upload/v1beta/files');
    expect((startInit as RequestInit).headers).toMatchObject({
      'x-goog-api-key': 'KEY-123',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Type': 'video/quicktime',
      'X-Goog-Upload-Header-Content-Length': '100',
    });
    const xhr = FakeXHR.instances[0]!;
    expect(xhr.url).toBe('https://upload.example/u1');
    expect(xhr.headers['X-Goog-Upload-Command']).toBe('upload, finalize');
    expect(xhr.headers['Content-Type']).toBe('video/quicktime');
    expect(xhr.sent).toBe(file);
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://generativelanguage.googleapis.com/v1beta/files/abc');
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'KEY-123' });
  });

  it('usa video/mp4 quando o arquivo não informa o tipo', async () => {
    fetchMock.mockResolvedValueOnce(startOk()).mockResolvedValueOnce(jsonRes({ state: 'ACTIVE', uri: 'https://x/files/abc' }));
    const out = await uploadVideo(new Blob([new Uint8Array(10)]));
    expect(out.mimeType).toBe('video/mp4');
  });

  it('estado FAILED → video', async () => {
    fetchMock.mockResolvedValueOnce(startOk()).mockResolvedValueOnce(jsonRes({ name: 'files/abc', state: 'FAILED' }));
    await expect(uploadVideo(file)).rejects.toMatchObject({ code: 'video' });
  });

  it('tempo esgotado esperando ACTIVE → video', async () => {
    timing.pollTimeoutMs = 20;
    timing.pollFirstMs = 5;
    timing.pollMaxStepMs = 5;
    fetchMock.mockResolvedValueOnce(startOk());
    fetchMock.mockImplementation(async () => jsonRes({ name: 'files/abc', uri: 'https://x/files/abc', state: 'PROCESSING' }));
    try {
      await expect(uploadVideo(file)).rejects.toMatchObject({ code: 'video' });
    } finally {
      timing.pollTimeoutMs = 5 * 60_000;
    }
  });

  it('falha de rede no início → rede; cota → cota', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('x'));
    await expect(uploadVideo(file)).rejects.toMatchObject({ code: 'rede' });
    fetchMock.mockResolvedValueOnce(errRes(429, 'quota'));
    await expect(uploadVideo(file)).rejects.toMatchObject({ code: 'cota' });
  });

  it('conexão cai durante os bytes → rede', async () => {
    FakeXHR.fail = true;
    fetchMock.mockResolvedValueOnce(startOk());
    await expect(uploadVideo(file)).rejects.toMatchObject({ code: 'rede' });
  });

  it('erro HTTP nos bytes → video', async () => {
    FakeXHR.response = { status: 500, body: '' };
    fetchMock.mockResolvedValueOnce(startOk());
    await expect(uploadVideo(file)).rejects.toMatchObject({ code: 'video' });
  });

  it('sem URL de envio → video', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(uploadVideo(file)).rejects.toMatchObject({ code: 'video' });
  });
});
