import type { ReactNode } from 'react';
import { matchRoute, usePath } from './router';
import { HomeScreen } from '../features/home/HomeScreen';
import { ImportScreen } from '../features/importar/ImportScreen';
import { WorkoutScreen } from '../features/treino/WorkoutScreen';
import { SessionScreen } from '../features/sessao/SessionScreen';
import { CatalogScreen } from '../features/catalogo/CatalogScreen';
import { ExerciseScreen } from '../features/catalogo/ExerciseScreen';
import { HistoryScreen } from '../features/historico/HistoryScreen';
import { SettingsScreen } from '../features/ajustes/SettingsScreen';

// Rotas do app. Para adicionar uma tela: crie a pasta em src/features e registre aqui.
//   /                    Hoje: treino do dia, sessão em andamento, importar
//   /importar            Colar texto + escolher vídeo
//   /treino/:workoutId   Visão geral do treino antes de começar (revisar itens, iniciar)
//   /sessao/:sessionId   Player: execução do treino (sem barra de abas)
//   /catalogo            Exercícios deduplicados
//   /catalogo/:id        Detalhe do exercício: vídeo, histórico de cargas, aliases, fundir duplicados
//   /historico           Sessões concluídas
//   /ajustes             Chave da IA, perfil, backup
function route(path: string): { el: ReactNode; tabs: boolean } {
  let m: Record<string, string> | null;
  if ((m = matchRoute('/sessao/:sessionId', path))) return { el: <SessionScreen sessionId={m.sessionId!} />, tabs: false };
  if ((m = matchRoute('/treino/:workoutId', path))) return { el: <WorkoutScreen workoutId={m.workoutId!} />, tabs: true };
  if ((m = matchRoute('/catalogo/:exerciseId', path))) return { el: <ExerciseScreen exerciseId={m.exerciseId!} />, tabs: true };
  if (matchRoute('/importar', path)) return { el: <ImportScreen />, tabs: true };
  if (matchRoute('/catalogo', path)) return { el: <CatalogScreen />, tabs: true };
  if (matchRoute('/historico', path)) return { el: <HistoryScreen />, tabs: true };
  if (matchRoute('/ajustes', path)) return { el: <SettingsScreen />, tabs: true };
  return { el: <HomeScreen />, tabs: true };
}

const TABS = [
  { href: '#/', icon: '🏋️', label: 'Hoje', match: (p: string) => p === '/' || p.startsWith('/treino') || p.startsWith('/importar') },
  { href: '#/catalogo', icon: '📚', label: 'Catálogo', match: (p: string) => p.startsWith('/catalogo') },
  { href: '#/historico', icon: '📈', label: 'Histórico', match: (p: string) => p.startsWith('/historico') },
  { href: '#/ajustes', icon: '⚙️', label: 'Ajustes', match: (p: string) => p.startsWith('/ajustes') },
];

export function App() {
  const path = usePath();
  const { el, tabs } = route(path);
  return (
    <div className={`app-shell ${tabs ? 'with-tabs' : ''}`}>
      {el}
      {tabs && (
        <nav className="tabbar">
          {TABS.map((t) => (
            <a key={t.href} href={t.href} className={t.match(path) ? 'active' : ''}>
              <span className="tab-icon">{t.icon}</span>
              {t.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
