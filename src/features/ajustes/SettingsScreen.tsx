import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { db, getSettings, setSetting } from '../../db/db';
import type { Settings } from '../../domain/types';
import { formatBytes } from '../importar/importLogic';
import { backupFileName, buildBackup, parseBackup, restoreBackup, summarizeBackup, type Backup } from './backup';
import { DEFAULT_PROFILE } from './defaultProfile';
import { clampRest, isStandalone, REST_STEP_SEC } from './settingsLogic';
import './settings.css';

/** Mostra "Salvo" por um instante depois de cada gravação. */
function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    setSaved(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 1600);
  }, []);
  return [saved, flash];
}

function SavedMark({ show }: { show: boolean }) {
  return (
    <span className={`set-saved ${show ? 'is-on' : ''}`} role="status" aria-live="polite">
      {show ? '✓ Salvo' : ''}
    </span>
  );
}

/** Campo de texto que grava no banco com pequeno atraso e ao sair da tela. */
function useDebouncedSetting<K extends 'geminiApiKey' | 'profile'>(key: K, initial: string) {
  const [value, setValue] = useState(initial);
  const [saved, flash] = useSavedFlash();
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const commit = useCallback(async () => {
    clearTimeout(timer.current);
    const v = pending.current;
    if (v === null) return;
    pending.current = null;
    if (key === 'geminiApiKey') {
      // Chave vazia = sem chave: remove a linha em vez de gravar texto vazio.
      if (v.trim()) await setSetting(key, v.trim() as Settings[K]);
      else await db.settings.delete(key);
    } else {
      await setSetting(key, v as Settings[K]);
    }
    flash();
  }, [key, flash]);

  useEffect(() => () => void commit(), [commit]);

  const change = (v: string) => {
    setValue(v);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void commit(), 600);
  };
  return { value, change, saved, commit };
}

function ApiKeyField({ initial }: { initial: string }) {
  const f = useDebouncedSetting('geminiApiKey', initial);
  const [show, setShow] = useState(false);
  return (
    <section className="card set-card">
      <div className="set-title-row">
        <h2>Chave da IA (Gemini)</h2>
        <SavedMark show={f.saved} />
      </div>
      <div className="set-key-row">
        <input
          className="input set-key"
          type={show ? 'text' : 'password'}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Cole a chave aqui"
          aria-label="Chave da API Gemini"
          value={f.value}
          onChange={(e) => f.change(e.target.value)}
          onBlur={() => void f.commit()}
        />
        <button type="button" className="btn btn-ghost set-toggle" onClick={() => setShow((v) => !v)} aria-pressed={show}>
          {show ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      <p className="hint">
        Gere uma chave gratuita em <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">aistudio.google.com/app/apikey</a>.
        A chave fica só neste aparelho e não entra nos backups.
      </p>
    </section>
  );
}

function ProfileField({ initial }: { initial: string }) {
  const f = useDebouncedSetting('profile', initial);
  return (
    <section className="card set-card">
      <div className="set-title-row">
        <h2>Perfil do atleta</h2>
        <SavedMark show={f.saved} />
      </div>
      <textarea
        className="input textarea set-profile"
        aria-label="Perfil do atleta"
        placeholder="Objetivos, restrições, lesões, referências…"
        value={f.value}
        onChange={(e) => f.change(e.target.value)}
        onBlur={() => void f.commit()}
      />
      {f.value.trim() === '' && (
        <button type="button" className="btn btn-ghost set-default" onClick={() => f.change(DEFAULT_PROFILE)}>
          Usar perfil padrão
        </button>
      )}
      <p className="hint">
        O perfil é usado apenas nas sugestões da IA e na fusão de treinos. Ele nunca altera o treino do personal.
      </p>
    </section>
  );
}

function RestField({ initial }: { initial: number }) {
  const [rest, setRest] = useState(initial);
  const [saved, flash] = useSavedFlash();
  async function set(v: number) {
    const next = clampRest(v);
    setRest(next);
    await setSetting('defaultRestSec', next);
    flash();
  }
  return (
    <section className="card set-card">
      <div className="set-title-row">
        <h2>Descanso padrão</h2>
        <SavedMark show={saved} />
      </div>
      <div className="set-stepper">
        <button type="button" className="icon-btn set-step" aria-label="Diminuir descanso" onClick={() => void set(rest - REST_STEP_SEC)} disabled={rest <= clampRest(0)}>
          −
        </button>
        <span className="set-step-value">{rest} s</span>
        <button type="button" className="icon-btn set-step" aria-label="Aumentar descanso" onClick={() => void set(rest + REST_STEP_SEC)} disabled={rest >= clampRest(1e9)}>
          +
        </button>
      </div>
      <p className="hint">Usado entre séries quando o personal não indica o descanso.</p>
    </section>
  );
}

function DataSection({ onRestored }: { onRestored: () => void }) {
  const counts = useLiveQuery(async () => ({
    workouts: await db.workouts.filter((w) => !w.deletedAt).count(),
    exercises: await db.exercises.filter((e) => !e.deletedAt).count(),
    sessions: await db.sessions.filter((s) => !s.deletedAt).count(),
  }), []);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [pending, setPending] = useState<Backup | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshStorage = useCallback(async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      setStorage({ usage: est?.usage, quota: est?.quota, persisted });
    } catch {
      setStorage({});
    }
  }, []);
  useEffect(() => void refreshStorage(), [refreshStorage]);

  async function exportBackup() {
    setMessage(null);
    try {
      const backup = await buildBackup(db);
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage({ kind: 'ok', text: 'Backup gerado. Guarde o arquivo em local seguro.' });
    } catch (err) {
      setMessage({ kind: 'error', text: `Não foi possível gerar o backup: ${err instanceof Error ? err.message : err}` });
    }
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMessage(null);
    setPending(null);
    const parsed = parseBackup(await file.text());
    if (parsed.ok) setPending(parsed.backup);
    else setMessage({ kind: 'error', text: parsed.error });
  }

  async function confirmRestore() {
    if (!pending) return;
    setBusy(true);
    try {
      await restoreBackup(db, pending);
      setPending(null);
      setMessage({ kind: 'ok', text: 'Backup restaurado.' });
      onRestored();
      void refreshStorage();
    } catch (err) {
      setMessage({ kind: 'error', text: `Não foi possível restaurar: ${err instanceof Error ? err.message : err}` });
    } finally {
      setBusy(false);
    }
  }

  const summary = pending ? summarizeBackup(pending) : null;

  return (
    <section className="card set-card">
      <h2>Dados</h2>
      <dl className="set-stats">
        <div><dt>Espaço usado</dt><dd>{storage.usage !== undefined ? `${formatBytes(storage.usage)}${storage.quota ? ` de ${formatBytes(storage.quota)}` : ''}` : '—'}</dd></div>
        <div><dt>Armazenamento persistente</dt><dd>{storage.persisted === undefined ? '—' : storage.persisted ? 'Sim' : 'Não'}</dd></div>
        <div><dt>Treinos</dt><dd>{counts?.workouts ?? '—'}</dd></div>
        <div><dt>Exercícios</dt><dd>{counts?.exercises ?? '—'}</dd></div>
        <div><dt>Sessões</dt><dd>{counts?.sessions ?? '—'}</dd></div>
      </dl>

      <div className="set-btn-row">
        <button type="button" className="btn btn-ghost" onClick={() => void exportBackup()}>Exportar backup</button>
        <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>Restaurar backup</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onPick(e)} />
      </div>
      <p className="hint">O backup guarda treinos, exercícios, séries e ajustes. Vídeos e a chave da IA ficam de fora.</p>

      {summary && (
        <div className="set-confirm" role="alertdialog" aria-label="Confirmar restauração">
          <strong>Substituir todos os dados deste aparelho?</strong>
          <span>
            O backup tem {summary.workouts} treinos, {summary.exercises} exercícios e {summary.sessions} sessões
            (gerado em {new Date(pending!.exportedAt).toLocaleDateString('pt-BR')}). O que existe hoje será apagado.
          </span>
          <div className="set-btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => setPending(null)} disabled={busy}>Cancelar</button>
            <button type="button" className="btn set-danger" onClick={() => void confirmRestore()} disabled={busy}>
              {busy ? 'Restaurando…' : 'Substituir dados'}
            </button>
          </div>
        </div>
      )}
      {message && <p className={`set-msg ${message.kind === 'error' ? 'is-error' : ''}`} role="status">{message.text}</p>}
    </section>
  );
}

function InstallSection() {
  if (isStandalone()) return null;
  return (
    <section className="card set-card">
      <h2>Instalar no iPhone</h2>
      <ol className="set-install">
        <li>Abra este endereço no Safari.</li>
        <li>Toque em Compartilhar <span aria-hidden>⬆️</span>.</li>
        <li>Escolha &ldquo;Adicionar à Tela de Início&rdquo;.</li>
      </ol>
      <p className="hint">
        Instalado, o app abre em tela cheia e o iPhone protege seus treinos de serem apagados automaticamente quando falta espaço.
      </p>
    </section>
  );
}

export function SettingsScreen() {
  const settings = useLiveQuery(getSettings, []);
  // Muda após restaurar um backup, para os campos relerem o banco.
  const [generation, setGeneration] = useState(0);

  return (
    <div className="screen">
      <header className="header">
        <h1>Ajustes</h1>
      </header>
      {settings && (
        <>
          <ApiKeyField key={`k${generation}`} initial={settings.geminiApiKey ?? ''} />
          <ProfileField key={`p${generation}`} initial={settings.profile} />
          <RestField key={`r${generation}`} initial={settings.defaultRestSec} />
        </>
      )}
      <DataSection onRestored={() => setGeneration((g) => g + 1)} />
      <InstallSection />
    </div>
  );
}
