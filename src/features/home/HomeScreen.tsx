import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { db, getSettings } from '../../db/db';
import type { VideoStatus } from '../../domain/types';
import { todayLocal } from '../../engine';
import { formatDate, formatRelativeDay } from '../../app/format';
import { selectHome, videoStatusInfo } from './homeLogic';
import './home.css';

async function loadHome() {
  const today = todayLocal();
  const [workouts, sessions, settings] = await Promise.all([
    db.workouts.filter((w) => !w.deletedAt && w.origin !== 'legado').toArray(),
    db.sessions.filter((s) => !s.deletedAt).toArray(),
    getSettings(),
  ]);
  const view = selectHome({ workouts, sessions, today });

  // Consultas em lote: itens dos treinos de hoje e séries concluídas da sessão ativa.
  const todayIds = view.todayWorkouts.map((w) => w.id);
  const items = todayIds.length ? await db.workoutItems.where('workoutId').anyOf(todayIds).filter((i) => !i.deletedAt).toArray() : [];
  const itemCounts: Record<string, number> = {};
  for (const i of items) itemCounts[i.workoutId] = (itemCounts[i.workoutId] ?? 0) + 1;

  let active: { id: string; title: string; doneSets: number } | undefined;
  if (view.active) {
    const [wk, logs] = await Promise.all([
      db.workouts.get(view.active.workoutId),
      db.setLogs.where('sessionId').equals(view.active.id).filter((l) => l.done && !l.deletedAt).count(),
    ]);
    active = { id: view.active.id, title: wk?.title ?? 'Treino', doneSets: logs };
  }
  return { today, view, itemCounts, active, hasKey: !!settings.geminiApiKey };
}

function VideoBadge({ status }: { status: VideoStatus }) {
  const info = videoStatusInfo(status);
  if (!info) return null;
  return (
    <span className={`home-video home-video-${info.tone}`}>
      {info.tone === 'progress' && <span className="home-dot" aria-hidden />}
      {info.tone === 'ok' && <span aria-hidden>🎬</span>}
      {info.tone === 'error' && <span aria-hidden>⚠️</span>}
      {info.text}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="home-section">
      <h2 className="home-section-title">{title}</h2>
      {children}
    </section>
  );
}

export function HomeScreen() {
  const data = useLiveQuery(loadHome, []);

  if (!data) {
    return (
      <div className="screen">
        <header className="header">
          <h1>Hoje</h1>
        </header>
      </div>
    );
  }

  const { today, view, itemCounts, active, hasKey } = data;
  const hasPrimary = !!active || view.todayWorkouts.length > 0;

  return (
    <div className="screen">
      <header className="header">
        <h1>Hoje</h1>
        <p className="text-secondary home-date">{formatDate(today)}</p>
      </header>

      {active && (
        <a className="card home-hero" href={`#/sessao/${active.id}`}>
          <span className="home-hero-kicker">Em andamento</span>
          <span className="home-hero-title">{active.title}</span>
          <span className="home-hero-meta">
            {active.doneSets === 0
              ? 'Nenhuma série concluída ainda'
              : `${active.doneSets} ${active.doneSets === 1 ? 'série concluída' : 'séries concluídas'}`}
          </span>
          <span className="btn btn-primary">Continuar treino</span>
        </a>
      )}

      {view.todayWorkouts.map((w) => {
        const n = itemCounts[w.id] ?? 0;
        return (
          <div key={w.id} className="card home-today">
            <span className="home-hero-kicker">Treino de hoje</span>
            <span className="home-today-title">{w.title}</span>
            <span className="home-hero-meta">
              {n} {n === 1 ? 'exercício' : 'exercícios'}
            </span>
            <VideoBadge status={w.videoStatus} />
            <a className={`btn ${active ? 'btn-ghost' : 'btn-primary'}`} href={`#/treino/${w.id}`}>
              Abrir treino
            </a>
          </div>
        );
      })}

      {!view.hasAnyWorkout && (
        <div className="card home-welcome">
          <h2>Bem-vindo ao Meu Treino</h2>
          <p className="text-secondary">Prepare o treino em casa e treine na academia, mesmo sem internet.</p>
          <ol className="home-steps">
            <li>
              <span className="home-step-n">1</span>
              <span>Cole o texto do treino que o personal enviou.</span>
            </li>
            <li>
              <span className="home-step-n">2</span>
              <span>Escolha o vídeo dele (opcional). Ele é analisado em segundo plano.</span>
            </li>
            <li>
              <span className="home-step-n">3</span>
              <span>Na academia, abra o treino e registre cada série com um toque.</span>
            </li>
          </ol>
        </div>
      )}

      <a className={`btn ${hasPrimary ? 'btn-ghost' : 'btn-primary'}`} href="#/importar">
        Importar treino
      </a>

      {!hasKey && (
        <div className="alert alert-warning">
          <span>
            Sem a chave da IA, a importação usa só o interpretador simples e não processa o vídeo.
          </span>
          <a className="home-link" href="#/ajustes">
            Configurar em Ajustes →
          </a>
        </div>
      )}

      {view.others.length > 0 && (
        <Section title="Próximos e recentes">
          <ul className="home-list">
            {view.others.map(({ workout: w, done }) => (
              <li key={w.id}>
                <a className="card home-row" href={`#/treino/${w.id}`}>
                  <span className="home-row-main">
                    <span className="home-row-when">{formatRelativeDay(w.date, today)}</span>
                    <span className="home-row-title">{w.title}</span>
                    <VideoBadge status={w.videoStatus} />
                  </span>
                  <span className={`home-row-state ${done ? 'is-done' : ''}`}>{done ? '✓ Concluído' : 'Pendente'}</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
