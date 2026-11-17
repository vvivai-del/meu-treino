import { formatKg } from '../../app/format';
import { navigate } from '../../app/router';
import type { Exercise, ID } from '../../domain/types';
import { formatDuration, type SessionSummary } from './logic';

interface Props {
  title: string;
  summary: SessionSummary;
  exercises: Map<ID, Exercise>;
}

export function Summary({ title, summary, exercises }: Props) {
  return (
    <div className="screen finish-screen ss-summary">
      <div className="finish-icon" aria-hidden="true">
        🏁
      </div>
      <h2>Treino concluído</h2>
      <p className="text-secondary">{title}</p>

      <div className="finish-stats">
        <Stat value={formatDuration(summary.durationSec)} label="Duração" />
        <Stat value={String(summary.exerciseCount)} label="Exercícios" />
        <Stat value={String(summary.setCount)} label="Séries" />
        <Stat value={formatKg(summary.volumeKg)} label="Volume total" />
      </div>

      {summary.progressed.length > 0 && (
        <div className="card ss-progressed">
          <span className="label">Carga subiu</span>
          <ul>
            {summary.progressed.map((p) => (
              <li key={p.exerciseId}>
                <span>{exercises.get(p.exerciseId)?.name ?? 'Exercício'}</span>
                <strong>
                  {formatKg(p.fromKg)} → {formatKg(p.toKg)}
                </strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" className="btn btn-primary ss-home" onClick={() => navigate('/')}>
        Voltar ao início
      </button>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat-chip">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
