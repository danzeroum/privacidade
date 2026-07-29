import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EH_DEMONSTRACAO } from './lib/perfil';
import NaoConfigurado from './NaoConfigurado';

/**
 * A fronteira entre os dois perfis, e ela é o grafo de dependências.
 *
 * O `import()` dinâmico dentro de um `if` sobre uma constante de build é o que
 * faz o console inteiro — com `mock/scenarios.ts` e os nove titulares fictícios
 * completos — **não entrar** no artefato de produção (Risco-040). Um `import`
 * estático no topo entraria de qualquer jeito, e a checagem viraria decoração:
 * o dado estaria publicado, só que atrás de um `if` que ninguém executa.
 *
 * É a diferença entre "a tela não abre" e "o dado não está lá". Só a segunda é
 * verificável no artefato, e é essa que a catraca do PR 6 cobra.
 */
const raiz = createRoot(document.getElementById('root')!);

if (EH_DEMONSTRACAO) {
  void import('./App').then(({ default: App }) => {
    raiz.render(<StrictMode><App /></StrictMode>);
  });
} else {
  raiz.render(<StrictMode><NaoConfigurado /></StrictMode>);
}
