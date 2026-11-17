import { describe, expect, it } from 'vitest';
import { parseWorkoutTextLocal } from './localParser';

describe('parseWorkoutTextLocal', () => {
  it('extrai rótulo, nome e prescrição, na ordem do texto', () => {
    const out = parseWorkoutTextLocal(`Lower Body
A1) Agachamento livre 4x12
A2. Prancha - 3x30s
B1 - Leg press 3x8-10 cada lado
Stiff com halteres 3x12`);
    expect(out.title).toBe('Lower Body');
    expect(out.items.map((i) => i.rawName)).toEqual(['Agachamento livre', 'Prancha', 'Leg press', 'Stiff com halteres']);
    expect(out.items.map((i) => i.label)).toEqual(['A1', 'A2', 'B1', undefined]);
    expect(out.items.map((i) => i.key)).toEqual(['1', '2', '3', '4']);
    expect(out.items[0]).toMatchObject({ prescriptionRaw: '4x12', sets: 4, repsMin: 12, repsMax: 12 });
    expect(out.items[2]).toMatchObject({ prescriptionRaw: '3x8-10 cada lado', sets: 3, repsMin: 8, repsMax: 10 });
    expect(out.items.every((i) => i.confidence === 'baixa' && !i.catalogId)).toBe(true);
  });

  it('A1/A2 compartilham bloco; os demais têm bloco próprio', () => {
    const out = parseWorkoutTextLocal('A1) Supino 4x10\nA2) Remada 4x10\nB1) Rosca 3x12\nCrucifixo 3x12');
    const [a1, a2, b1, free] = out.items;
    expect(a1!.block).toBe(a2!.block);
    expect(new Set([a1!.block, b1!.block, free!.block]).size).toBe(3);
  });

  it('linha sem prescrição depois de um exercício vira observação dele', () => {
    const out = parseWorkoutTextLocal('Agachamento 4x12\nDescer devagar\nSupino 3x10');
    expect(out.items).toHaveLength(2);
    expect(out.items[0]!.observations).toBe('Descer devagar');
  });

  it('prescrição antes do nome', () => {
    const out = parseWorkoutTextLocal('4x12 Agachamento');
    expect(out.items[0]).toMatchObject({ rawName: 'Agachamento', prescriptionRaw: '4x12', sets: 4 });
  });

  it('sem nenhuma prescrição, cada linha é um exercício', () => {
    const out = parseWorkoutTextLocal('Agachamento\n\n- Supino\r\nRemada');
    expect(out.items.map((i) => i.rawName)).toEqual(['Agachamento', 'Supino', 'Remada']);
    expect(out.items.every((i) => i.sets >= 1)).toBe(true);
    expect(out.title).toBe('Treino');
  });

  it('texto vazio não gera itens', () => {
    expect(parseWorkoutTextLocal('  \n \n').items).toEqual([]);
  });
});
