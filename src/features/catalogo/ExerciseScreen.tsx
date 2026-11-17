import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, touch } from '../../db/db';
import { navigate } from '../../app/router';
import { formatDateShort, formatKg, formatRelativeDay } from '../../app/format';
import { normalizeName, todayLocal } from '../../engine';
import { ClipPlayer } from '../../media/ClipPlayer';
import type { Exercise, ExerciseKind, LoadType, Session, SetLog } from '../../domain/types';
import {
  KIND_LABELS, LOAD_TYPE_LABELS, buildChartData, formatSets, groupBySession, layoutChart,
  type ChartData, type SessionGroup,
} from './logic';
import { mergeExercises } from './merge';
import { MergeConfirm, MergePicker } from './MergeDialogs';
import './exercicio.css';

interface Loaded {
  exercise: Exercise | null;
  groups: SessionGroup[];
  /** Treinos e séries (de qualquer estado) que ainda apontam para o exercício. */
  references: number;
}

async function loadExercise(id: string): Promise<Loaded> {
  const exercise = (await db.exercises.get(id)) ?? null;
  if (!exercise || exercise.deletedAt) return { exercise: null, groups: [], references: 0 };
  const [logs, itemCount] = await Promise.all([
    db.setLogs.where('exerciseId').equals(id).filter((l) => !l.deletedAt).toArray(),
    db.workoutItems.where('exerciseId').equals(id).filter((i) => !i.deletedAt).count(),
  ]);
  const sessionIds = [...new Set(logs.map((l) => l.sessionId))];
  const rows = await db.sessions.bulkGet(sessionIds);
  const sessions = new Map<string, Session>();
  for (const s of rows) if (s && !s.deletedAt) sessions.set(s.id, s);
  return { exercise, groups: groupBySession(logs, sessions), references: itemCount + logs.length };
}

export function ExerciseScreen({ exerciseId }: { exerciseId: string }) {
  const data = useLiveQuery(() => loadExercise(exerciseId), [exerciseId]);
  const [picking, setPicking] = useState(false);
  const [pair, setPair] = useState<{ keep: Exercise; drop: Exercise } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [askDelete, setAskDelete] = useState(false);
  const all = useLiveQuery(() => (picking ? db.exercises.toArray() : Promise.resolve([] as Exercise[])), [picking]);

  if (!data) return <div className="screen" />;
  const { exercise, groups, references } = data;

  if (!exercise) {
    return (
      <div className="screen">
        <a className="back-link" href="#/catalogo">‹ Catálogo</a>
        <div className="card ex-missing">
          <h2>Exercício não encontrado</h2>
          <p className="text-secondary">Ele pode ter sido excluído ou fundido com outro.</p>
          <a className="btn btn-primary" href="#/catalogo">Ver o catálogo</a>
        </div>
      </div>
    );
  }

  const ex = exercise;
  const update = (patch: Partial<Exercise>) => db.exercises.update(ex.id, { ...patch, ...touch() });

  async function confirmMerge() {
    if (!pair) return;
    setBusy(true);
    setError(undefined);
    try {
      await mergeExercises(pair.drop.id, pair.keep.id);
      setPair(null);
      if (pair.keep.id !== ex.id) navigate(`/catalogo/${pair.keep.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível fundir.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    await update({ deletedAt: Date.now() });
    navigate('/catalogo', { replace: true });
  }

  const chart = buildChartData(groups, ex.loadType);

  return (
    <div className="screen exercise-screen">
      <div className="ex-top">
        <a className="back-link" href="#/catalogo">‹ Catálogo</a>
        <h1 className="ex-title">{ex.name}</h1>
      </div>

      <ClipPlayer
        clip={ex.clip}
        className="ex-video"
        fallback={<div className="ex-novideo text-secondary">🎬 Sem vídeo para este exercício. Ele chega ao importar um treino com vídeo.</div>}
      />

      <section className="card ex-form">
        <TextField label="Nome" value={ex.name} required onCommit={(name) => {
          const nameKey = normalizeName(name);
          const keep = ex.aliases.filter((a) => normalizeName(a) !== nameKey);
          return update({ name, nameKey, aliases: keep, aliasKeys: keep.map(normalizeName) });
        }} />
        <div className="ex-row">
          <label className="ex-field">
            <span className="label">Tipo</span>
            <select className="input" value={ex.kind} onChange={(e) => void update({ kind: e.target.value as ExerciseKind })}>
              {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="ex-field">
            <span className="label">Medido em</span>
            <select className="input" value={ex.loadType} onChange={(e) => void update({ loadType: e.target.value as LoadType })}>
              {Object.entries(LOAD_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        <div className="ex-row">
          <TextField label="Grupo muscular" value={ex.muscleGroup ?? ''} onCommit={(v) => update({ muscleGroup: v || undefined })} />
          {ex.loadType === 'peso' && (
            <TextField
              label="Incremento (kg)"
              value={ex.weightStepKg === undefined ? '' : String(ex.weightStepKg).replace('.', ',')}
              inputMode="decimal"
              parse={(v) => {
                if (!v) return { ok: true, value: undefined };
                const n = Number(v.replace(',', '.'));
                return n > 0 && Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
              }}
              onCommit={(_, n) => update({ weightStepKg: n as number | undefined })}
            />
          )}
        </div>
        <TextField label="Dicas" value={ex.cues ?? ''} multiline onCommit={(v) => update({ cues: v || undefined })} />
      </section>

      <AliasSection exercise={ex} onChange={(aliases) => update({ aliases, aliasKeys: aliases.map(normalizeName) })} />

      <section className="card">
        <span className="label">Evolução</span>
        <Evolution chart={chart} />
      </section>

      <section className="ex-history">
        <span className="label">Histórico</span>
        {groups.length === 0 ? (
          <p className="text-secondary">Nenhuma série concluída ainda.</p>
        ) : (
          groups.map((g) => <HistoryRow key={g.sessionId} group={g} />)
        )}
      </section>

      <section className="ex-actions">
        <button className="btn btn-ghost" onClick={() => setPicking(true)}>Fundir com outro exercício</button>
        {references > 0 ? (
          <p className="text-secondary">
            Para excluir, funda este exercício com outro: ele ainda aparece em treinos ou séries registradas.
          </p>
        ) : askDelete ? (
          <div className="alert alert-warning">
            <span>Excluir “{ex.name}”? Nenhum treino usa este exercício.</span>
            <div className="ex-row">
              <button className="btn btn-ghost" onClick={() => setAskDelete(false)}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => void remove()}>Excluir</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-ghost btn-danger-text" onClick={() => setAskDelete(true)}>Excluir exercício</button>
        )}
      </section>

      {picking && !pair && (
        <MergePicker
          current={ex}
          all={all ?? []}
          onCancel={() => setPicking(false)}
          onPick={(other) => {
            setError(undefined);
            setPair({ keep: ex, drop: other });
          }}
        />
      )}
      {pair && (
        <MergeConfirm
          keep={pair.keep}
          drop={pair.drop}
          busy={busy}
          error={error}
          onSwap={() => setPair({ keep: pair.drop, drop: pair.keep })}
          onConfirm={() => void confirmMerge()}
          onCancel={() => {
            setPair(null);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

// ---------- Campo de texto que grava ao sair do campo ----------

interface Parsed { ok: boolean; value?: unknown }

function TextField({ label, value, onCommit, multiline, required, inputMode, parse }: {
  label: string;
  value: string;
  onCommit: (text: string, parsed?: unknown) => void | Promise<unknown>;
  multiline?: boolean;
  required?: boolean;
  inputMode?: 'decimal';
  parse?: (text: string) => Parsed;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  function commit() {
    const text = draft.trim();
    if (text === value.trim()) return setDraft(value);
    if (required && !text) return setDraft(value);
    const parsed = parse?.(text);
    if (parsed && !parsed.ok) return setDraft(value);
    void onCommit(text, parsed?.value);
  }

  return (
    <label className="ex-field">
      <span className="label">{label}</span>
      {multiline ? (
        <textarea className="input textarea ex-cues" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      ) : (
        <input
          className="input"
          value={draft}
          inputMode={inputMode}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      )}
    </label>
  );
}

// ---------- Aliases ----------

function AliasSection({ exercise, onChange }: { exercise: Exercise; onChange: (aliases: string[]) => void }) {
  const [text, setText] = useState('');
  const key = normalizeName(text);
  const duplicate = !!key && (key === exercise.nameKey || exercise.aliasKeys.includes(key));

  function add() {
    if (!key || duplicate) return;
    onChange([...exercise.aliases, text.trim()]);
    setText('');
  }

  return (
    <section className="card">
      <span className="label">Outros nomes</span>
      {exercise.aliases.length === 0 && <p className="text-secondary ex-alias-empty">Nenhum outro nome ainda.</p>}
      <ul className="alias-list">
        {exercise.aliases.map((a) => (
          <li key={a} className="alias">
            <span>{a}</span>
            <button className="alias-x" aria-label={`Remover ${a}`} onClick={() => onChange(exercise.aliases.filter((x) => x !== a))}>×</button>
          </li>
        ))}
      </ul>
      <form className="alias-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" placeholder="Adicionar outro nome" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-primary" type="submit" disabled={!key || duplicate}>Adicionar</button>
      </form>
      {duplicate && <p className="text-secondary ex-alias-empty">Esse nome já existe neste exercício.</p>}
    </section>
  );
}

// ---------- Evolução (SVG inline) ----------

const BOX = { width: 320, height: 160, padLeft: 38, padRight: 14, padTop: 22, padBottom: 26 };

function fmtValue(v: number, unit: ChartData['unit']): string {
  if (unit === 'kg') return formatKg(v);
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unit === 's' ? 's' : 'reps'}`;
}

function Evolution({ chart }: { chart: ChartData }) {
  const { points, recordIndex, unit, metric } = chart;
  if (points.length === 0) return <p className="text-secondary">Sem dados de carga ainda.</p>;
  const record = points[recordIndex]!;
  const head = (
    <div className="evo-head">
      <div>
        <div className="evo-value">{fmtValue(record.value, unit)}</div>
        <div className="text-secondary">Recorde · {metric.toLowerCase()}</div>
      </div>
    </div>
  );
  if (points.length < 2) return head;

  const { coords, yMin, yMax } = layoutChart(points, BOX);
  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const ticks = [yMax, (yMax + yMin) / 2, yMin].map((v, i) => ({ v, y: BOX.padTop + (i / 2) * (BOX.height - BOX.padTop - BOX.padBottom) }));
  const rc = coords[recordIndex]!;
  const labelAnchor = rc.x > BOX.width - 60 ? 'end' : rc.x < BOX.padLeft + 30 ? 'start' : 'middle';
  const first = points[0]!;
  const last = points[points.length - 1]!;

  return (
    <>
      {head}
      <svg
        className="evo-chart"
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        role="img"
        aria-label={`Evolução de ${metric.toLowerCase()}: de ${fmtValue(first.value, unit)} a ${fmtValue(last.value, unit)}; recorde ${fmtValue(record.value, unit)}`}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={BOX.padLeft} x2={BOX.width - BOX.padRight} y1={t.y} y2={t.y} className="evo-grid" />
            <text x={BOX.padLeft - 6} y={t.y + 4} textAnchor="end" className="evo-axis">{Math.round(t.v)}</text>
          </g>
        ))}
        <path d={path} className="evo-line" />
        {coords.map((c, i) => (
          <circle key={points[i]!.sessionId} cx={c.x} cy={c.y} r={i === recordIndex ? 5.5 : 3.5} className={i === recordIndex ? 'evo-dot record' : 'evo-dot'} />
        ))}
        <text x={rc.x} y={rc.y - 11} textAnchor={labelAnchor} className="evo-record">{fmtValue(record.value, unit)}</text>
        <text x={BOX.padLeft} y={BOX.height - 6} textAnchor="start" className="evo-axis">{formatDateShort(first.date)}</text>
        <text x={BOX.width - BOX.padRight} y={BOX.height - 6} textAnchor="end" className="evo-axis">{formatDateShort(last.date)}</text>
      </svg>
    </>
  );
}

// ---------- Histórico ----------

function HistoryRow({ group }: { group: SessionGroup }) {
  const today = todayLocal();
  const normal = group.sets.filter((s) => !s.legacy);
  const legacy = group.sets.filter((s) => s.legacy);
  const line = (sets: SetLog[], isLegacy: boolean) =>
    sets.length > 0 && (
      <div className="hist-sets">
        {formatSets(sets)}
        {isLegacy && <span className="legacy-tag">estimado do app antigo</span>}
      </div>
    );
  return (
    <div className="hist-row">
      <div className="hist-date">
        {formatDateShort(group.date)} <span className="text-secondary">· {formatRelativeDay(group.date, today)}</span>
      </div>
      {line(normal, false)}
      {line(legacy, true)}
    </div>
  );
}
