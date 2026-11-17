import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedItem, ParsedWorkout } from '../ai';
import { db, stamp } from '../db/db';
import type { Exercise, Video, Workout } from '../domain/types';
import { matchExercise, normalizeName, todayLocal } from '../engine';
import { importWorkout, resumePendingImports, retryVideo, whenVideoQueueIdle } from './pipeline';

vi.mock('../ai', async (orig) => {
  const real = await orig<typeof import('../ai')>();
  return { ...real, parseWorkoutText: vi.fn(), uploadVideo: vi.fn(), locateSegments: vi.fn() };
});
vi.mock('./videoDuration', () => ({ readVideoDuration: vi.fn(async () => undefined) }));
vi.mock('../engine', async (orig) => {
  const real = await orig<typeof import('../engine')>();
  return { ...real, matchExercise: vi.fn(real.matchExercise) };
});

const ai = await import('../ai');
const parseMock = vi.mocked(ai.parseWorkoutText);
const uploadMock = vi.mocked(ai.uploadVideo);
const locateMock = vi.mocked(ai.locateSegments);
const durationMock = vi.mocked((await import('./videoDuration')).readVideoDuration);
const matchMock = vi.mocked(matchExercise);
const { AIError } = ai;

const item = (n: number, over: Partial<ParsedItem> = {}): ParsedItem => ({
  key: String(n),
  rawName: `Exercício ${n}`,
  block: `b${n}`,
  prescriptionRaw: '3x10',
  sets: 3,
  repsMin: 10,
  repsMax: 10,
  kind: 'forca',
  loadType: 'peso',
  confidence: 'alta',
  ...over,
});
const parsed = (...items: ParsedItem[]): ParsedWorkout => ({ title: 'Treino do dia', items });

function makeExercise(name: string, over: Partial<Exercise> = {}): Exercise {
  return { ...stamp(), name, nameKey: normalizeName(name), aliases: [], aliasKeys: [], kind: 'forca', loadType: 'peso', ...over };
}
const movie = () => new File([new Uint8Array(64)], 'treino.mov', { type: 'video/quicktime' });
const status = async (id: string) => (await db.workouts.get(id))!;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.clearAllMocks();
  parseMock.mockReset();
  uploadMock.mockReset();
  locateMock.mockReset();
  durationMock.mockReset();
  durationMock.mockResolvedValue(undefined);
  matchMock.mockClear();
});

describe('importWorkout: texto', () => {
  it('sem vídeo: grava treino e itens em ordem, com o texto original intacto', async () => {
    const text = '  A1) Agachamento 4x12\n\nA2) Prancha 3x30s  ';
    parseMock.mockResolvedValue(
      parsed(
        item(1, { rawName: 'Agachamento', label: 'A1', block: 'A', prescriptionRaw: '4x12', sets: 4, repsMin: 12, repsMax: 12 }),
        item(2, { rawName: 'Prancha', label: 'A2', block: 'A', prescriptionRaw: '3x30s', durationSec: 30, loadType: 'tempo', observations: 'Abdômen firme' }),
        item(3, { rawName: 'Remada', block: 'item3', perSide: true, restSec: 45 }),
      ),
    );
    const id = await importWorkout({ text });
    const w = await status(id);
    expect(w).toMatchObject({ origin: 'personal', videoStatus: 'sem_video', sourceText: text, date: todayLocal(), title: 'Treino do dia' });
    expect(w.videoId).toBeUndefined();

    const items = (await db.workoutItems.where('workoutId').equals(id).toArray()).sort((a, b) => a.order - b.order);
    expect(items.map((i) => i.order)).toEqual([0, 1, 2]);
    expect(items.map((i) => i.rawName)).toEqual(['Agachamento', 'Prancha', 'Remada']);
    expect(items[0]!.blockId).toBe(items[1]!.blockId);
    expect(items[2]!.blockId).not.toBe(items[0]!.blockId);
    expect(items[0]).toMatchObject({ label: 'A1', match: 'novo', prescription: { sets: 4, repsMin: 12, repsMax: 12, raw: '4x12' } });
    expect(items[1]).toMatchObject({ observations: 'Abdômen firme', prescription: { durationSec: 30, raw: '3x30s' } });
    expect(items[2]!.prescription).toMatchObject({ perSide: true, restSec: 45 });
    expect(items[2]!.createdAt).toBeTypeOf('number');
    expect(await db.exercises.count()).toBe(3);
    expect(await db.videos.count()).toBe(0);
  });

  it('usa a data informada', async () => {
    parseMock.mockResolvedValue(parsed(item(1)));
    const id = await importWorkout({ text: 'x', date: '2030-01-02' });
    expect((await status(id)).date).toBe('2030-01-02');
  });

  it('passa à IA só o catálogo sem excluídos', async () => {
    await db.exercises.bulkAdd([makeExercise('Supino', { aliases: ['Supino reto'], aliasKeys: ['supino reto'] }), makeExercise('Velho', { deletedAt: 1 })]);
    parseMock.mockResolvedValue(parsed(item(1)));
    await importWorkout({ text: 'x' });
    const catalog = parseMock.mock.calls[0]![1];
    expect(catalog.map((c) => c.name)).toEqual(['Supino']);
    expect(catalog[0]!.aliases).toEqual(['Supino reto']);
  });

  it.each(['sem_chave', 'rede', 'cota'])('IA falha com %s → interpretador local', async (code) => {
    parseMock.mockRejectedValue(new AIError('falhou', code));
    const id = await importWorkout({ text: 'A1) Agachamento 4x12\nA2) Supino 3x10' });
    const items = (await db.workoutItems.where('workoutId').equals(id).sortBy('order'));
    expect(items.map((i) => i.rawName)).toEqual(['Agachamento', 'Supino']);
    expect(items[0]!.prescription).toMatchObject({ sets: 4, repsMin: 12, raw: '4x12' });
    expect(items[0]!.blockId).toBe(items[1]!.blockId);
    expect(items.every((i) => i.match === 'novo')).toBe(true);
  });

  it('outro erro da IA propaga e não deixa vídeo órfão', async () => {
    parseMock.mockRejectedValue(new AIError('lixo', 'resposta_invalida'));
    await expect(importWorkout({ text: 'x', video: movie() })).rejects.toMatchObject({ code: 'resposta_invalida' });
    expect(await db.videos.count()).toBe(0);
    expect(await db.videoBlobs.count()).toBe(0);
    expect(await db.workouts.count()).toBe(0);
  });

  it('texto sem exercícios (reserva local) → erro claro', async () => {
    parseMock.mockRejectedValue(new AIError('sem chave', 'sem_chave'));
    await expect(importWorkout({ text: '   ' })).rejects.toThrow(/nenhum exercício/);
  });
});

describe('importWorkout: casamento com o catálogo', () => {
  it('catalogId válido reutiliza o exercício; "alta" com nome novo cria alias', async () => {
    const sup = makeExercise('Supino reto');
    await db.exercises.add(sup);
    parseMock.mockResolvedValue(parsed(item(1, { rawName: 'Supino com barra', catalogId: sup.id, confidence: 'alta' })));
    const id = await importWorkout({ text: 'x' });
    const [it1] = await db.workoutItems.where('workoutId').equals(id).toArray();
    expect(it1).toMatchObject({ exerciseId: sup.id, match: 'alta' });
    const after = (await db.exercises.get(sup.id))!;
    expect(after.aliases).toEqual(['Supino com barra']);
    expect(after.aliasKeys).toEqual(['supino com barra']);
    expect(after.updatedAt).toBeGreaterThanOrEqual(sup.updatedAt);
    expect(await db.exercises.count()).toBe(1);
  });

  it('catalogId "baixa" não cria alias e marca o item como baixa', async () => {
    const sup = makeExercise('Supino reto');
    await db.exercises.add(sup);
    parseMock.mockResolvedValue(parsed(item(1, { rawName: 'Supino inclinado', catalogId: sup.id, confidence: 'baixa' })));
    const id = await importWorkout({ text: 'x' });
    const [it1] = await db.workoutItems.where('workoutId').equals(id).toArray();
    expect(it1!.match).toBe('baixa');
    expect((await db.exercises.get(sup.id))!.aliases).toEqual([]);
  });

  it('nome já conhecido não duplica alias', async () => {
    const sup = makeExercise('Supino reto', { aliases: ['Supino'], aliasKeys: ['supino'] });
    await db.exercises.add(sup);
    parseMock.mockResolvedValue(parsed(item(1, { rawName: 'supino', catalogId: sup.id })));
    await importWorkout({ text: 'x' });
    expect((await db.exercises.get(sup.id))!.aliases).toEqual(['Supino']);
  });

  it('sem catalogId: nome idêntico → alta; score ≥ 0.8 → baixa; resto → novo', async () => {
    const rem = makeExercise('Remada curvada');
    const stiff = makeExercise('Stiff');
    await db.exercises.bulkAdd([rem, stiff]);
    matchMock.mockImplementation((name, catalog) => {
      if (name === 'Stiff com barra') return [{ exercise: catalog.find((e) => e.id === stiff.id)!, score: 0.85 }];
      if (name === 'Rosca') return [{ exercise: catalog[0]!, score: 0.6 }];
      return catalog.filter((e) => normalizeName(name) === e.nameKey).map((exercise) => ({ exercise, score: 1 }));
    });
    parseMock.mockResolvedValue(
      parsed(
        item(1, { rawName: 'remada curvada' }),
        item(2, { rawName: 'Stiff com barra' }),
        item(3, { rawName: 'Rosca' }),
        item(4, { rawName: 'Rosca' }), // segunda ocorrência do exercício novo: reaproveita o criado
        item(5, { rawName: 'Catalogid fantasma', catalogId: 'nao-existe' }),
      ),
    );
    const id = await importWorkout({ text: 'x' });
    const items = await db.workoutItems.where('workoutId').equals(id).sortBy('order');
    expect(items.map((i) => i.match)).toEqual(['alta', 'baixa', 'novo', 'novo', 'novo']);
    expect(items[0]!.exerciseId).toBe(rem.id);
    expect(items[1]!.exerciseId).toBe(stiff.id);
    expect(items[2]!.exerciseId).not.toBe(items[3]!.exerciseId); // o mock acima devolve 0.6 para "Rosca": sempre novo
    expect(await db.exercises.count()).toBe(2 + 3);
    // reutilização com score 1 não mexe nos aliases
    expect((await db.exercises.get(rem.id))!.aliases).toEqual([]);
  });

  it('exercício novo repetido no mesmo treino é criado uma vez', async () => {
    parseMock.mockResolvedValue(parsed(item(1, { rawName: 'Burpee' }), item(2, { rawName: 'burpee' })));
    const id = await importWorkout({ text: 'x' });
    const items = await db.workoutItems.where('workoutId').equals(id).sortBy('order');
    expect(items[0]!.exerciseId).toBe(items[1]!.exerciseId);
    expect(items.map((i) => i.match)).toEqual(['novo', 'alta']);
    expect(await db.exercises.count()).toBe(1);
  });

  it('exercício novo recebe kind, loadType e grupo muscular da IA', async () => {
    parseMock.mockResolvedValue(parsed(item(1, { rawName: 'Prancha', kind: 'mobilidade', loadType: 'tempo', muscleGroup: 'Core' })));
    await importWorkout({ text: 'x' });
    const [ex] = await db.exercises.toArray();
    expect(ex).toMatchObject({ name: 'Prancha', nameKey: 'prancha', kind: 'mobilidade', loadType: 'tempo', muscleGroup: 'Core' });
  });
});

describe('vídeo em segundo plano', () => {
  const segs = [
    { key: '1', startSec: 5, endSec: 40, cues: 'Joelho para fora' },
    { key: '2', startSec: 40, endSec: 90 },
  ];

  it('grava o blob antes da rede, resolve sem esperar o vídeo e percorre as transições', async () => {
    const seen: string[] = [];
    let blobSavedBeforeParse = false;
    parseMock.mockImplementation(async () => {
      blobSavedBeforeParse = (await db.videoBlobs.count()) === 1;
      return parsed(item(1, { rawName: 'Agachamento' }), item(2, { rawName: 'Supino' }));
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    uploadMock.mockImplementation(async (file) => {
      seen.push((await db.workouts.toArray())[0]!.videoStatus);
      expect(file).toBeDefined();
      await gate;
      return { fileUri: 'https://ai/files/abc', mimeType: 'video/quicktime' };
    });
    locateMock.mockImplementation(async () => {
      seen.push((await db.workouts.toArray())[0]!.videoStatus);
      return segs;
    });
    durationMock.mockResolvedValue(120);

    const id = await importWorkout({ text: 'x', video: movie() });
    expect(blobSavedBeforeParse).toBe(true);
    expect((await status(id)).videoStatus).toMatch(/pendente|enviando/);
    const video = (await db.videos.toArray())[0]!;
    expect(video).toMatchObject({ kind: 'original', hasLocalBlob: true, sizeBytes: 64, mimeType: 'video/quicktime', fileName: 'treino.mov' });
    expect((await status(id)).videoId).toBe(video.id);

    release();
    await whenVideoQueueIdle();
    expect([seen, (await status(id)).videoError]).toEqual([['enviando', 'analisando'], undefined]);

    const w = await status(id);
    expect(w.videoStatus).toBe('pronto');
    expect(w.videoError).toBeUndefined();
    const v = (await db.videos.get(video.id))!;
    expect(v).toMatchObject({ aiFileUri: 'https://ai/files/abc', durationSec: 120 });
    expect(v.aiFileExpiresAt!).toBeGreaterThan(Date.now() + 40 * 3600 * 1000);

    const items = await db.workoutItems.where('workoutId').equals(id).sortBy('order');
    expect(items[0]!.clip).toEqual({ videoId: video.id, startSec: 5, endSec: 40 });
    expect(items[1]!.clip).toEqual({ videoId: video.id, startSec: 40, endSec: 90 });
    expect(items[0]!.observations).toBe('Joelho para fora');
    expect(items[1]!.observations).toBeUndefined();
    const ex = (await db.exercises.get(items[0]!.exerciseId))!;
    expect(ex.clip).toEqual(items[0]!.clip);
    expect(ex.cues).toBe('Joelho para fora');
    // a IA recebeu chaves sequenciais e nomes como escritos
    expect(locateMock.mock.calls[0]![1]).toEqual([
      { key: '1', name: 'Agachamento' },
      { key: '2', name: 'Supino' },
    ]);
  });

  it('não sobrescreve observações e dicas já existentes; o vídeo mais recente vira o do catálogo', async () => {
    const sup = makeExercise('Supino', { cues: 'Dica antiga', clip: { videoId: 'velho', startSec: 1, endSec: 2 } });
    await db.exercises.add(sup);
    parseMock.mockResolvedValue(parsed(item(1, { rawName: 'Supino', catalogId: sup.id, observations: 'Obs do texto' })));
    uploadMock.mockResolvedValue({ fileUri: 'u', mimeType: 'video/mp4' });
    locateMock.mockResolvedValue([{ key: '1', startSec: 3, endSec: 9, cues: 'Dica nova' }]);
    const id = await importWorkout({ text: 'x', video: movie() });
    await whenVideoQueueIdle();
    const [it1] = await db.workoutItems.where('workoutId').equals(id).toArray();
    expect(it1!.observations).toBe('Obs do texto');
    const ex = (await db.exercises.get(sup.id))!;
    expect(ex.cues).toBe('Dica antiga');
    expect(ex.clip).toMatchObject({ startSec: 3, endSec: 9 });
    expect(ex.clip!.videoId).not.toBe('velho');
  });

  it('limita os trechos à duração do vídeo', async () => {
    parseMock.mockResolvedValue(parsed(item(1), item(2), item(3)));
    uploadMock.mockResolvedValue({ fileUri: 'u', mimeType: 'video/mp4' });
    durationMock.mockResolvedValue(60);
    locateMock.mockResolvedValue([
      { key: '1', startSec: 10, endSec: 80 },
      { key: '2', startSec: 70, endSec: 90 },
      { key: '3', startSec: 20, endSec: 30 },
    ]);
    const id = await importWorkout({ text: 'x', video: movie() });
    await whenVideoQueueIdle();
    const items = await db.workoutItems.where('workoutId').equals(id).sortBy('order');
    expect(items[0]!.clip).toMatchObject({ startSec: 10, endSec: 60 });
    expect(items[1]!.clip).toBeUndefined();
    expect(items[2]!.clip).toMatchObject({ startSec: 20, endSec: 30 });
  });

  it('erro da IA → status erro com mensagem legível; retryVideo reprocessa', async () => {
    parseMock.mockResolvedValue(parsed(item(1)));
    uploadMock.mockRejectedValueOnce(new AIError('Sem conexão com a internet.', 'rede'));
    const id = await importWorkout({ text: 'x', video: movie() });
    await whenVideoQueueIdle();
    expect(await status(id)).toMatchObject({ videoStatus: 'erro', videoError: 'Sem conexão com a internet.' });
    expect((await db.workoutItems.toArray())[0]!.clip).toBeUndefined();

    uploadMock.mockResolvedValue({ fileUri: 'u', mimeType: 'video/mp4' });
    locateMock.mockResolvedValue([{ key: '1', startSec: 1, endSec: 5 }]);
    await retryVideo(id);
    expect((await status(id)).videoStatus).toBe('pendente');
    await whenVideoQueueIdle();
    expect(await status(id)).toMatchObject({ videoStatus: 'pronto' });
    expect((await status(id)).videoError).toBeUndefined();
  });

  it('erro inesperado (não-AIError) vira mensagem genérica', async () => {
    parseMock.mockResolvedValue(parsed(item(1)));
    uploadMock.mockRejectedValue(new Error('boom interno'));
    const id = await importWorkout({ text: 'x', video: movie() });
    await whenVideoQueueIdle();
    const w = await status(id);
    expect(w.videoStatus).toBe('erro');
    expect(w.videoError).toMatch(/Não foi possível processar o vídeo/);
  });

  it('nenhum trecho encontrado → erro (e o treino continua utilizável)', async () => {
    parseMock.mockResolvedValue(parsed(item(1)));
    uploadMock.mockResolvedValue({ fileUri: 'u', mimeType: 'video/mp4' });
    locateMock.mockResolvedValue([]);
    const id = await importWorkout({ text: 'x', video: movie() });
    await whenVideoQueueIdle();
    expect(await status(id)).toMatchObject({ videoStatus: 'erro' });
    expect(await db.workoutItems.where('workoutId').equals(id).count()).toBe(1);
  });

  it('retryVideo ignora treino que não está em erro', async () => {
    parseMock.mockResolvedValue(parsed(item(1)));
    const id = await importWorkout({ text: 'x' });
    await retryVideo(id);
    expect((await status(id)).videoStatus).toBe('sem_video');
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('arquivo expirado na IA: reenvia uma vez e conclui', async () => {
    parseMock.mockResolvedValue(parsed(item(1)));
    uploadMock.mockResolvedValue({ fileUri: 'novo', mimeType: 'video/mp4' });
    const { workout, video } = await seedPending('analisando', { aiFileUri: 'velho', aiFileExpiresAt: Date.now() + 36e5 * 30 });
    locateMock
      .mockRejectedValueOnce(new AIError('expirou', 'video'))
      .mockResolvedValueOnce([{ key: '1', startSec: 1, endSec: 4 }]);
    await resumePendingImports();
    await whenVideoQueueIdle();
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(locateMock.mock.calls.map((c) => c[0].fileUri)).toEqual(['velho', 'novo']);
    expect((await status(workout.id)).videoStatus).toBe('pronto');
    expect((await db.videos.get(video.id))!.aiFileUri).toBe('novo');
  });
});

async function seedPending(
  videoStatus: Workout['videoStatus'],
  videoOver: Partial<Video> = {},
  hasBlob = true,
): Promise<{ workout: Workout; video: Video }> {
  const video: Video = { ...stamp(), kind: 'original', mimeType: 'video/mp4', sizeBytes: 3, hasLocalBlob: hasBlob, ...videoOver };
  const workout: Workout = {
    ...stamp(),
    title: 'T',
    date: todayLocal(),
    sourceText: 'x',
    origin: 'personal',
    videoId: video.id,
    videoStatus,
  };
  await db.videos.add(video);
  if (hasBlob) await db.videoBlobs.put({ videoId: video.id, blob: new Blob(['abc']) });
  await db.workouts.add(workout);
  const ex = makeExercise(`Ex ${workout.id}`);
  await db.exercises.add(ex);
  await db.workoutItems.add({
    ...stamp(),
    workoutId: workout.id,
    order: 0,
    blockId: 'b',
    exerciseId: ex.id,
    rawName: 'Ex',
    prescription: { sets: 3, raw: '3x10' },
    match: 'novo',
  });
  return { workout, video };
}

describe('resumePendingImports', () => {
  it.each(['pendente', 'enviando', 'analisando'] as const)('retoma treino em %s', async (st) => {
    const { workout } = await seedPending(st);
    uploadMock.mockResolvedValue({ fileUri: 'u', mimeType: 'video/mp4' });
    locateMock.mockResolvedValue([{ key: '1', startSec: 2, endSec: 8 }]);
    await resumePendingImports();
    await whenVideoQueueIdle();
    expect((await status(workout.id)).videoStatus).toBe('pronto');
  });

  it('reutiliza aiFileUri ainda válido (sem novo upload) e reenvia se vencido', async () => {
    const fresh = await seedPending('analisando', { aiFileUri: 'valido', aiFileExpiresAt: Date.now() + 10 * 36e5 });
    const stale = await seedPending('analisando', { aiFileUri: 'vencido', aiFileExpiresAt: Date.now() + 60_000 });
    uploadMock.mockResolvedValue({ fileUri: 'reenviado', mimeType: 'video/mp4' });
    locateMock.mockResolvedValue([{ key: '1', startSec: 2, endSec: 8 }]);
    await resumePendingImports();
    await whenVideoQueueIdle();
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const uris = locateMock.mock.calls.map((c) => c[0].fileUri).sort();
    expect(uris).toEqual(['reenviado', 'valido']);
    expect((await db.videos.get(fresh.video.id))!.aiFileUri).toBe('valido');
    expect((await db.videos.get(stale.video.id))!.aiFileUri).toBe('reenviado');
  });

  it('ignora treinos prontos, sem vídeo, em erro e sem blob local; blob ausente no banco vira erro', async () => {
    const pronto = await seedPending('pronto');
    const erro = await seedPending('erro');
    const semBlobFlag = await seedPending('pendente', {}, false);
    const sumiu = await seedPending('pendente');
    await db.videoBlobs.delete(sumiu.video.id);
    uploadMock.mockResolvedValue({ fileUri: 'u', mimeType: 'video/mp4' });
    locateMock.mockResolvedValue([{ key: '1', startSec: 2, endSec: 8 }]);
    await resumePendingImports();
    await whenVideoQueueIdle();
    expect((await status(pronto.workout.id)).videoStatus).toBe('pronto');
    expect((await status(erro.workout.id)).videoStatus).toBe('erro');
    expect((await status(semBlobFlag.workout.id)).videoStatus).toBe('pendente');
    expect(await status(sumiu.workout.id)).toMatchObject({ videoStatus: 'erro' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('não processa o mesmo treino duas vezes em paralelo', async () => {
    await seedPending('pendente');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    uploadMock.mockImplementation(async () => {
      await gate;
      return { fileUri: 'u', mimeType: 'video/mp4' };
    });
    locateMock.mockResolvedValue([{ key: '1', startSec: 2, endSec: 8 }]);
    await resumePendingImports();
    await resumePendingImports();
    release();
    await whenVideoQueueIdle();
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(locateMock).toHaveBeenCalledTimes(1);
  });
});
