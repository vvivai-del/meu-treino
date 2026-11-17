import { useState, type ChangeEvent } from 'react';
import { navigate } from '../../app/router';
import { todayLocal } from '../../engine';
import { importWorkout } from '../../import';
import { canImport, clearDraft, errorMessage, formatBytes, loadDraft, saveDraft, tomorrowLocal } from './importLogic';
import './import.css';

export function ImportScreen() {
  const [text, setText] = useState(loadDraft);
  const [video, setVideo] = useState<File | undefined>();
  const [date, setDate] = useState(() => todayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayLocal();
  const tomorrow = tomorrowLocal();

  function onText(e: ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    saveDraft(e.target.value);
  }

  function onVideo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setVideo(f);
    e.target.value = '';
  }

  async function submit() {
    if (!canImport(text, date, busy)) return;
    setBusy(true);
    setError(null);
    try {
      const id = await importWorkout({ text, video, date });
      clearDraft();
      navigate(`/treino/${id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <header className="header">
        <h1>Importar treino</h1>
        <p className="text-secondary">Cole o que o personal enviou. O treino fica pronto em segundos.</p>
      </header>

      <div className="card imp-field">
        <label className="label" htmlFor="imp-text">Texto do treino</label>
        <textarea
          id="imp-text"
          className="input textarea imp-text"
          placeholder={'A1. Agachamento livre 4x8-10\nB1. Leg press 3x12\n…'}
          value={text}
          onChange={onText}
          disabled={busy}
        />
        <p className="hint imp-hint">O rascunho fica salvo neste aparelho até você importar.</p>
      </div>

      <div className="card imp-field">
        <span className="label">Vídeo do treino (opcional)</span>
        {video ? (
          <div className="imp-file">
            <span className="imp-file-icon" aria-hidden>🎬</span>
            <span className="imp-file-info">
              <span className="imp-file-name">{video.name}</span>
              <span className="text-secondary">{formatBytes(video.size)}</span>
            </span>
            <button type="button" className="btn btn-ghost btn-sm imp-remove" onClick={() => setVideo(undefined)} disabled={busy}>
              Remover
            </button>
          </div>
        ) : (
          <label className="imp-pick">
            <input className="imp-pick-input" type="file" accept="video/*" onChange={onVideo} disabled={busy} />
            <span className="imp-pick-icon" aria-hidden>📹</span>
            <span className="imp-pick-text">Escolher vídeo</span>
          </label>
        )}
        <p className="hint imp-hint">
          O vídeo continua sendo processado em segundo plano depois da importação. Deixe o app aberto até terminar.
        </p>
      </div>

      <div className="card imp-field">
        <label className="label" htmlFor="imp-date">Data do treino</label>
        <div className="imp-date-row">
          <input id="imp-date" className="input imp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
          <button type="button" className={`btn btn-sm imp-chip ${date === today ? 'is-on' : ''}`} onClick={() => setDate(today)} disabled={busy}>
            Hoje
          </button>
          <button type="button" className={`btn btn-sm imp-chip ${date === tomorrow ? 'is-on' : ''}`} onClick={() => setDate(tomorrow)} disabled={busy}>
            Amanhã
          </button>
        </div>
      </div>

      {error && (
        <div className="imp-error" role="alert">
          <strong>Não foi possível importar</strong>
          <span>{error}</span>
          <span className="imp-error-note">Seu texto e o vídeo escolhido continuam aqui. Tente novamente.</span>
        </div>
      )}

      <button type="button" className="btn btn-primary" onClick={submit} disabled={!canImport(text, date, busy)}>
        {busy ? (
          <>
            <span className="imp-spin" aria-hidden />
            Interpretando o treino…
          </>
        ) : (
          'Importar'
        )}
      </button>
    </div>
  );
}
