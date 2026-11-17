# Meu Treino

Web app pessoal (um único usuário, iPhone, instalado na tela de início) para treinar na academia:
recebe o treino do personal (texto + um vídeo longo), mostra cada exercício com o trecho certo do
vídeo e as séries já preenchidas com peso e repetições sugeridos, e registra o que foi executado.

Interface e textos em **português do Brasil**. Código (identificadores) em inglês; comentários em português.

## Princípios do produto

1. **Rápido e fluido na academia acima de tudo.** Nenhuma tela de treino espera rede ou IA.
   Tudo é lido e gravado no banco local na hora; nada se perde se o iOS matar a aba.
2. **Importar é separado de treinar.** A importação (IA, upload) acontece em casa, com antecedência.
   O treino fica utilizável assim que o texto é interpretado; o vídeo chega depois, em segundo plano.
3. **Fiel ao personal.** O treino aparece na ordem e com as séries que o personal escreveu.
   Opiniões da IA ficam em áreas separadas (sugestões, fusão), que o usuário aceita ou ignora.
4. **Carga sugerida por regra, não por IA** (`src/engine`): determinística, instantânea, testada.
5. **Catálogo deduplicado.** Cada exercício existe uma vez; nomes diferentes viram aliases.

## Arquitetura

- Vite + React + TypeScript, PWA (vite-plugin-pwa). Sem backend por enquanto; nuvem (Supabase) entra depois como réplica.
- `src/domain/types.ts` — modelo de dados. **Contrato central: não altere sem necessidade real.**
- `src/db/db.ts` — Dexie (IndexedDB). Fonte da verdade da interface. Telas leem com `useLiveQuery`
  (dexie-react-hooks) e gravam direto nas tabelas, sempre com `stamp()` / `touch()`.
- `src/engine/` — regras puras (normalização de nomes, prescrição, sugestão de carga, migração do app antigo).
- `src/ai/` — único módulo que chama a API Gemini.
- `src/import/` — pipeline texto + vídeo → treino no banco.
- `src/features/<tela>/` — uma pasta por tela; CSS da tela fica junto (`*.css` importado pelo componente).
- `src/app/` — shell, roteador por hash (`navigate`, `usePath`, `matchRoute`), boot.
- `src/styles/base.css` — tokens (`--bg`, `--card`, `--accent`…) e classes compartilhadas
  (`.screen`, `.card`, `.btn`, `.btn-primary`, `.btn-ghost`, `.input`, `.label`, `.text-secondary`…). Reaproveite-as.
- `legacy/` — app antigo, só para referência. Não editar.

## Regras de implementação

- Datas de treino são **locais** (`todayLocal()`), nunca `toISOString()`.
- Peso sempre em kg (número). Nunca texto livre.
- Exclusão é lógica (`deletedAt`); consultas filtram linhas excluídas.
- Vídeo: os blobs ficam em `db.videoBlobs`; toca-se um trecho (`ClipRef`) de um vídeo guardado.
  No iOS: `playsInline`, `muted` para autoplay, e nunca recriar o `<video>` ao trocar de exercício.
- Alvos de toque ≥ 44px; a tela de treino é usada com uma mão, entre séries.
- Sem dependências novas sem motivo forte. Sem bibliotecas de UI/CSS.

## Comandos

- `npm run dev` — servidor local (no console: `await __seed()` cria dados de exemplo, `await __wipe()` limpa)
- `npm run typecheck` · `npm test` (vitest + fake-indexeddb) · `npm run build`
- Verificação visual: Playwright com Chromium já instalado (`require('playwright')`), viewport de iPhone (390×844).

Publicação: push em `main` → GitHub Actions → GitHub Pages (`.github/workflows/deploy.yml`).
