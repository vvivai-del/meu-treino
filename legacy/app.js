// ==============================================
// MEU TREINO — App de Acompanhamento Personalizado
// ==============================================

const DEFAULT_PROFILE = `PERFIL: Tenista master (40+ anos), foco em hipertrofia e longevidade esportiva.

RESTRIÇÕES E ATENÇÕES:
- Atleta acima de 40 anos: recuperação mais lenta, priorizar volume moderado
- Fortalecer manguito rotador: cuidado com rotação externa excessiva que crie pontos de gatilho no redondo maior e infraespinhal
- Estabilidade do quadril: trabalhar rotadores externos e glúteo médio
- Core profundo: transverso do abdômen, diafragma, oblíquos
- Evitar exercícios de alto impacto sem aquecimento adequado

OBJETIVOS:
- Hipertrofia (fibras tipo II) para combater sarcopenia
- Potência explosiva para melhora no tênis (leg drive, cadeia cinética)
- Prevenção de lesões no ombro e joelhos
- Melhorar eficiência mitocondrial

REFERÊNCIAS TÉCNICAS:
- Exercícios balísticos e pliometria importantes (squat jumps, saltos com carga)
- Priorizar cadeia cinética: membros inferiores → core → tronco
- Upper/Lower split ideal para respeitar dias de tênis
- Proteína: 1.6-2.0g/kg por dia, 35-40g por refeição`;

// --- STATE ---
const APP = {
  screen: 'loading',
  apiKey: localStorage.getItem('apiKey') || '',
  profile: localStorage.getItem('profile') || DEFAULT_PROFILE,
  history: JSON.parse(localStorage.getItem('workoutHistory') || '[]'),
  currentWorkout: null,
  currentExerciseIndex: 0,
  videoFile: null,
  videoUrl: null,
};

// --- STORAGE ---
function save(key, value) {
  localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
}

// --- UTILS ---
function tsToSeconds(ts) {
  if (!ts) return 0;
  const parts = String(ts).split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch { return dateStr; }
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function getExerciseHistory(name) {
  const n = name.toLowerCase();
  const records = [];
  for (const w of APP.history) {
    for (const ex of (w.exercises || [])) {
      const exName = (ex.nome || '').toLowerCase();
      if (exName.includes(n) || n.includes(exName)) {
        if (ex.carga_executada) {
          records.push({ date: w.date, carga: ex.carga_executada });
        }
      }
    }
  }
  return records.slice(-4);
}

// --- GEMINI API ---
async function uploadVideo(file) {
  showProgress('Enviando vídeo...', 15);

  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${APP.apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': file.size,
        'X-Goog-Upload-Header-Content-Type': 'video/mp4',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: file.name } }),
    }
  );

  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erro ao iniciar upload (${startRes.status})`);
  }

  const uploadUrl = startRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('URL de upload não retornada pelo servidor.');

  showProgress('Enviando vídeo...', 35);

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Type': 'video/mp4',
    },
    body: file,
  });

  if (!uploadRes.ok) throw new Error('Falha ao fazer upload do vídeo.');

  const fileData = await uploadRes.json();
  const fileUri = fileData.file?.uri || fileData.uri;
  if (!fileUri) throw new Error('URI do arquivo não retornada.');

  // Poll until ACTIVE
  showProgress('Processando vídeo...', 50);
  const fileName = fileUri.split('/').pop();
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 4000));
    const checkRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/files/${fileName}?key=${APP.apiKey}`
    );
    const checkData = await checkRes.json();
    const state = checkData.file?.state || checkData.state;
    if (state === 'ACTIVE') return fileUri;
    if (state === 'FAILED') throw new Error('O servidor falhou ao processar o vídeo.');
    showProgress(`Processando vídeo... (${(i + 1) * 4}s)`, Math.min(50 + i * 1.5, 72));
  }
  throw new Error('Timeout: o vídeo demorou demais para processar.');
}

async function analyzeWithGemini(fileUri, workoutText) {
  showProgress('IA analisando exercícios...', 78);

  const historyText = APP.history.slice(-8).map(w =>
    `${w.date}:\n` +
    (w.exercises || []).map(e =>
      `- ${e.nome}: ${e.carga_executada || 'sem registro'} (${e.series_reps || '-'})`
    ).join('\n')
  ).join('\n\n') || 'Sem histórico ainda.';

  const prompt = `Você é um assistente de treino personalizado para um tenista master (40+ anos).

## PERFIL E RESTRIÇÕES DO ATLETA
${APP.profile}

## HISTÓRICO RECENTE DE CARGAS
${historyText}

## TREINO ENVIADO PELO PERSONAL HOJE
${workoutText}

## SUA TAREFA
Analise o vídeo de treino e execute:
1. Identifique TODOS os exercícios no vídeo com timestamps precisos — use o áudio (o personal narra cada exercício)
2. Adapte o treino ao perfil do atleta (respeite as restrições, especialmente ombro e recuperação)
3. Organize na melhor ordem de execução (ex: grandes grupos antes de pequenos, composto antes de isolado)
4. Para cada exercício, sugira uma carga progressiva baseada no histórico. Se não houver histórico, sugira um peso inicial conservador adequado para atleta 40+
5. Inclua dicas técnicas importantes mencionadas pelo personal

Retorne APENAS um JSON válido, sem texto antes ou depois:
{
  "treino_do_dia": "descrição curta do treino (ex: Lower Body + Core)",
  "notas_adaptacao": "resumo das adaptações feitas para o perfil do atleta (1-2 frases)",
  "exercicios": [
    {
      "nome": "Nome exato do exercício",
      "grupo_muscular": "Músculo principal",
      "series_reps": "4x12",
      "inicio": "MM:SS",
      "fim": "MM:SS",
      "carga_sugerida": "40kg",
      "observacoes": "Dica técnica do personal ou atenção especial"
    }
  ]
}`;

  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-lite'];
  let res, lastError;
  for (const model of MODELS) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${APP.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { fileData: { mimeType: 'video/mp4', fileUri } },
            { text: prompt }
          ]}],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        }),
      }
    );
    if (res.ok) break;
    const errBody = await res.json().catch(() => ({}));
    lastError = errBody.error?.message || `Erro ${res.status}`;
  }

  if (!res.ok) throw new Error(lastError || 'Nenhum modelo disponível.');

  const data = await res.json();
  let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) text = match[1].trim();

  return JSON.parse(text);
}

// --- VIDEO PLAYBACK ---
function playExercise(ex) {
  const video = document.getElementById('exercise-video');
  if (!video || !APP.videoUrl) return;

  const start = tsToSeconds(ex.inicio);
  const end = tsToSeconds(ex.fim);

  video.src = APP.videoUrl;
  video.currentTime = start;

  const onTime = () => {
    if (end > start && video.currentTime >= end) {
      video.pause();
      video.removeEventListener('timeupdate', onTime);
    }
  };
  video.addEventListener('timeupdate', onTime);
  video.play().catch(() => {}); // autoplay may be blocked on iOS
}

function replayExercise() {
  const ex = APP.currentWorkout?.exercicios?.[APP.currentExerciseIndex];
  const video = document.getElementById('exercise-video');
  if (!ex || !video) return;
  video.currentTime = tsToSeconds(ex.inicio);
  video.play().catch(() => {});
}

// --- RENDER ---
function render() {
  const app = document.getElementById('app');
  switch (APP.screen) {
    case 'loading':   app.innerHTML = renderLoading(); break;
    case 'setup':     app.innerHTML = renderSetup(); bindSetup(); break;
    case 'home':      app.innerHTML = renderHome(); bindHome(); break;
    case 'processing':app.innerHTML = renderProcessing(); break;
    case 'workout':   app.innerHTML = renderWorkout(); bindWorkout(); setTimeout(() => playExercise(APP.currentWorkout.exercicios[APP.currentExerciseIndex]), 300); break;
    case 'done':      app.innerHTML = renderDone(); bindDone(); break;
    case 'history':   app.innerHTML = renderHistory(); bindHistory(); break;
  }
}

function renderLoading() {
  return `<div class="screen center"><div class="spinner large"></div><p class="text-secondary">Carregando...</p></div>`;
}

function renderSetup() {
  return `
    <div class="screen">
      <div class="header">
        <h1>⚙️ Configuração</h1>
        <p class="text-secondary">Faça isso uma vez. Não precisará repetir.</p>
      </div>

      <div class="card">
        <label class="label">Chave da API Gemini</label>
        <p class="hint">Obtenha gratuitamente em <strong>aistudio.google.com/app/apikey</strong></p>
        <input type="password" id="apiKeyInput" class="input"
          placeholder="AIza..." value="${APP.apiKey}" autocomplete="off">
      </div>

      <div class="card">
        <label class="label">Seu Perfil de Treino</label>
        <p class="hint">Restrições, objetivos e histórico. Já pré-carregado com seu perfil do NotebookLM — edite se precisar.</p>
        <textarea id="profileInput" class="input textarea">${APP.profile}</textarea>
      </div>

      <button id="saveSetupBtn" class="btn btn-primary">Salvar e Começar →</button>
    </div>`;
}

function renderHome() {
  const ok = !!(APP.apiKey);
  const count = APP.history.length;

  return `
    <div class="screen">
      <div class="header">
        <div class="header-top">
          <div>
            <h1>🏋️ Meu Treino</h1>
            <p class="text-secondary">${count > 0 ? `${count} treino${count > 1 ? 's' : ''} registrado${count > 1 ? 's' : ''}` : 'Nenhum treino ainda'}</p>
          </div>
          <div style="display:flex;gap:8px">
            <button id="historyBtn" class="icon-btn" title="Histórico">📋</button>
            <button id="setupBtn" class="icon-btn" title="Configurações">⚙️</button>
          </div>
        </div>
      </div>

      ${!ok ? `
        <div class="alert alert-warning">
          ⚠️ Configure sua chave API para continuar.
          <button id="goSetupBtn" class="btn btn-sm btn-primary">Configurar</button>
        </div>` : ''}

      <div class="card upload-card ${!ok ? 'disabled' : ''}" id="videoUploadArea">
        <div class="upload-icon">🎬</div>
        <p class="upload-text">Vídeo do Personal</p>
        <p class="text-secondary" style="margin-top:4px">Toque para selecionar o arquivo</p>
        <input type="file" id="videoInput" accept="video/*,video/mp4" class="file-input">
        <div id="videoStatus"></div>
      </div>

      <div class="card ${!ok ? 'disabled' : ''}">
        <label class="label">Treino de Hoje (texto)</label>
        <p class="hint">Cole o treino que o personal mandou por escrito</p>
        <textarea id="workoutTextInput" class="input textarea"
          placeholder="Ex: A1. Agachamento 4x12&#10;A2. Leg press 3x15&#10;B1. Cadeira extensora 3x12..."
          ${!ok ? 'disabled' : ''}></textarea>
      </div>

      <button id="processBtn" class="btn btn-primary" ${!ok ? 'disabled' : ''}>
        ✨ Montar Meu Treino
      </button>
    </div>`;
}

function renderProcessing() {
  return `
    <div class="screen center">
      <div class="processing-container">
        <div class="spinner large"></div>
        <h2 id="processingTitle">Processando...</h2>
        <p id="processingMsg" class="text-secondary">Aguarde, isso leva 1-3 minutos</p>
        <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
        <p id="progressPct" class="text-secondary" style="font-size:13px">0%</p>
      </div>
    </div>`;
}

function renderWorkout() {
  const workout = APP.currentWorkout;
  const idx = APP.currentExerciseIndex;
  const ex = workout.exercicios[idx];
  const total = workout.exercicios.length;
  const hist = getExerciseHistory(ex.nome);

  return `
    <div class="screen workout-screen">
      <div class="workout-header">
        <div class="workout-meta">
          <span class="text-secondary" style="font-size:13px">${workout.treino_do_dia || ''}</span>
          <span class="exercise-counter">${idx + 1} / ${total}</span>
        </div>
        <div class="progress-dots">
          ${workout.exercicios.map((_, i) =>
            `<div class="dot ${i < idx ? 'done' : i === idx ? 'active' : ''}"></div>`
          ).join('')}
        </div>
      </div>

      <div class="video-container">
        <video id="exercise-video" controls playsinline preload="metadata" class="video-player"></video>
        <button class="replay-btn" id="replayBtn">↺ Repetir trecho</button>
      </div>

      <div class="exercise-info">
        <div class="exercise-name-row">
          <div>
            <h2 class="exercise-name">${ex.nome}</h2>
            <span class="muscle-tag">${ex.grupo_muscular || ''}</span>
          </div>
          <div class="series-badge">${ex.series_reps || '—'}</div>
        </div>

        ${ex.observacoes ? `<div class="tip-box">💡 ${ex.observacoes}</div>` : ''}

        <div class="load-section">
          <div class="load-suggested">
            <span class="label" style="margin-bottom:0">Carga sugerida</span>
            <span class="load-value">${ex.carga_sugerida || 'Sem histórico'}</span>
          </div>
          ${hist.length > 0 ? `
            <div class="history-mini">
              ${hist.map(h => `<span class="history-chip">${h.date.slice(5)}: ${h.carga}</span>`).join('')}
            </div>` : ''}
        </div>

        <div class="load-input-section">
          <label class="label">Carga executada</label>
          <input type="text" id="loadInput" class="input load-input"
            placeholder="Ex: 40kg" inputmode="decimal"
            value="${ex.carga_executada || ''}">
          <label class="label" style="margin-top:10px">Observações</label>
          <input type="text" id="notesInput" class="input"
            placeholder="Ex: senti bem, aumentar na próxima"
            value="${ex.notas || ''}">
        </div>
      </div>

      <div class="workout-nav">
        ${idx > 0
          ? `<button class="btn btn-ghost" id="prevBtn">← Anterior</button>`
          : `<div></div>`}
        ${idx < total - 1
          ? `<button class="btn btn-primary" id="nextBtn">Próximo →</button>`
          : `<button class="btn btn-success" id="finishBtn">✓ Finalizar</button>`}
      </div>
    </div>`;
}

function renderDone() {
  const workout = APP.currentWorkout;
  const total = workout.exercicios.length;
  const logged = workout.exercicios.filter(e => e.carga_executada).length;

  return `
    <div class="screen finish-screen">
      <div class="finish-icon">💪</div>
      <h2>Treino Concluído!</h2>
      <p class="text-secondary">${workout.treino_do_dia || ''}</p>
      <div class="finish-stats">
        <div class="stat-chip">
          <div class="stat-value">${total}</div>
          <div class="stat-label">Exercícios</div>
        </div>
        <div class="stat-chip">
          <div class="stat-value">${logged}</div>
          <div class="stat-label">Cargas salvas</div>
        </div>
      </div>
      ${workout.notas_adaptacao ? `
        <div class="adaptation-box" style="text-align:left;width:100%">
          🤖 ${workout.notas_adaptacao}
        </div>` : ''}
      <button id="backHomeBtn" class="btn btn-primary" style="margin-top:8px">Voltar ao início</button>
    </div>`;
}

function renderHistory() {
  const history = [...APP.history].reverse();
  return `
    <div class="screen">
      <div class="header">
        <div class="header-top">
          <h1>📋 Histórico</h1>
          <button id="backBtn" class="icon-btn">✕</button>
        </div>
      </div>
      ${history.length === 0 ? `
        <div class="empty-state">
          <p style="font-size:40px">📭</p>
          <p>Nenhum treino registrado ainda.</p>
          <p class="text-secondary">Complete seu primeiro treino para ver o histórico aqui.</p>
        </div>` :
        history.map(w => `
          <div class="card workout-history-card">
            <div class="history-date">${formatDate(w.date)}</div>
            <p class="text-secondary">${w.treino_do_dia || ''}</p>
            <div class="exercise-list">
              ${(w.exercises || []).map(ex => `
                <div class="exercise-row">
                  <span class="exercise-row-name">${ex.nome}</span>
                  <span class="exercise-row-load">${ex.carga_executada || '—'}</span>
                </div>`).join('')}
            </div>
          </div>`).join('')}
    </div>`;
}

// --- BIND EVENTS ---
function bindSetup() {
  document.getElementById('saveSetupBtn')?.addEventListener('click', () => {
    const key = document.getElementById('apiKeyInput').value.trim();
    const profile = document.getElementById('profileInput').value.trim();
    if (!key) { alert('Insira a chave da API Gemini.'); return; }
    APP.apiKey = key;
    APP.profile = profile || DEFAULT_PROFILE;
    save('apiKey', key);
    save('profile', APP.profile);
    APP.screen = 'home';
    render();
  });
}

function bindHome() {
  const videoInput = document.getElementById('videoInput');
  const videoArea = document.getElementById('videoUploadArea');

  videoArea?.addEventListener('click', (e) => {
    if (e.target !== videoInput) videoInput?.click();
  });

  videoInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    APP.videoFile = file;
    if (APP.videoUrl) URL.revokeObjectURL(APP.videoUrl);
    APP.videoUrl = URL.createObjectURL(file);
    videoArea?.classList.add('has-file');
    const status = document.getElementById('videoStatus');
    if (status) status.innerHTML = `<p class="upload-success">✓ ${file.name}</p>`;
  });

  document.getElementById('processBtn')?.addEventListener('click', startProcessing);
  document.getElementById('setupBtn')?.addEventListener('click', () => { APP.screen = 'setup'; render(); });
  document.getElementById('historyBtn')?.addEventListener('click', () => { APP.screen = 'history'; render(); });
  document.getElementById('goSetupBtn')?.addEventListener('click', () => { APP.screen = 'setup'; render(); });
}

async function startProcessing() {
  const workoutText = document.getElementById('workoutTextInput')?.value?.trim();
  if (!APP.videoFile) { alert('Selecione o vídeo do treino.'); return; }
  if (!workoutText) { alert('Cole o treino escrito pelo personal.'); return; }

  APP.screen = 'processing';
  render();

  try {
    const fileUri = await uploadVideo(APP.videoFile);
    showProgress('IA analisando treino...', 78);
    const workoutData = await analyzeWithGemini(fileUri, workoutText);
    showProgress('Montando seu treino...', 95);

    APP.currentWorkout = {
      ...workoutData,
      date: today(),
      exercicios: (workoutData.exercicios || []).map(ex => ({
        ...ex,
        carga_executada: '',
        notas: '',
      })),
    };
    APP.currentExerciseIndex = 0;
    APP.screen = 'workout';
    render();
  } catch (err) {
    APP.screen = 'home';
    render();
    alert(`Erro: ${err.message}`);
  }
}

function bindWorkout() {
  document.getElementById('replayBtn')?.addEventListener('click', replayExercise);

  document.getElementById('loadInput')?.addEventListener('input', (e) => {
    APP.currentWorkout.exercicios[APP.currentExerciseIndex].carga_executada = e.target.value;
  });
  document.getElementById('notesInput')?.addEventListener('input', (e) => {
    APP.currentWorkout.exercicios[APP.currentExerciseIndex].notas = e.target.value;
  });

  document.getElementById('prevBtn')?.addEventListener('click', () => {
    if (APP.currentExerciseIndex > 0) { APP.currentExerciseIndex--; APP.screen = 'workout'; render(); }
  });
  document.getElementById('nextBtn')?.addEventListener('click', () => {
    const total = APP.currentWorkout.exercicios.length;
    if (APP.currentExerciseIndex < total - 1) { APP.currentExerciseIndex++; APP.screen = 'workout'; render(); }
  });
  document.getElementById('finishBtn')?.addEventListener('click', finishWorkout);
}

function finishWorkout() {
  const workout = APP.currentWorkout;
  const record = {
    date: workout.date,
    treino_do_dia: workout.treino_do_dia,
    notas_adaptacao: workout.notas_adaptacao,
    exercises: workout.exercicios.map(ex => ({
      nome: ex.nome,
      grupo_muscular: ex.grupo_muscular,
      series_reps: ex.series_reps,
      carga_sugerida: ex.carga_sugerida,
      carga_executada: ex.carga_executada,
      notas: ex.notas,
    })),
  };
  APP.history.push(record);
  save('workoutHistory', APP.history);

  APP.screen = 'done';
  render();
}

function bindDone() {
  document.getElementById('backHomeBtn')?.addEventListener('click', () => {
    APP.currentWorkout = null;
    APP.currentExerciseIndex = 0;
    if (APP.videoUrl) { URL.revokeObjectURL(APP.videoUrl); APP.videoUrl = null; }
    APP.videoFile = null;
    APP.screen = 'home';
    render();
  });
}

function bindHistory() {
  document.getElementById('backBtn')?.addEventListener('click', () => { APP.screen = 'home'; render(); });
}

function showProgress(title, pct) {
  const t = document.getElementById('processingTitle');
  const f = document.getElementById('progressFill');
  const p = document.getElementById('progressPct');
  if (t) t.textContent = title;
  if (f) f.style.width = `${pct}%`;
  if (p) p.textContent = `${Math.round(pct)}%`;
}

// --- INIT ---
function init() {
  APP.screen = APP.apiKey ? 'home' : 'setup';
  render();
}

document.addEventListener('DOMContentLoaded', init);
