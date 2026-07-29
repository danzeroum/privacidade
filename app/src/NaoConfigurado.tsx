/**
 * O que o perfil de produção renderiza (Risco-037).
 *
 * Este módulo é de propósito o **único** que o perfil de produção carrega, e é
 * de propósito que ele não importa nada: nem `App`, nem `mock/`, nem cenário.
 * É isso que faz o `scenarios.ts` — com seus nove titulares fictícios completos
 * — ficar fora do artefato publicado (Risco-040). A fronteira não é uma
 * convenção de revisão, é o grafo de dependências.
 *
 * E não é uma tela de erro: é a resposta correta. Sem provedor de identidade
 * real não existe sessão, e sem sessão não existe leitura de dado de titular.
 * O protótipo escolhia o papel num botão da barra superior; a alternativa
 * honesta em produção não é escolher outro jeito de fingir, é recusar e dizer
 * o que falta.
 */
export default function NaoConfigurado() {
  return (
    <main
      style={{
        minHeight: '100vh', display: 'grid', placeItems: 'center',
        padding: 32, fontFamily: 'system-ui, sans-serif', lineHeight: 1.6,
      }}
    >
      <div style={{ maxWidth: 620 }}>
        <h1 style={{ fontSize: 24, marginBottom: 12 }}>Autenticação não configurada</h1>
        <p>
          Este build foi gerado com o perfil <b>produção</b> e não embarca identidade, sessão nem
          dado de demonstração. Nenhuma tela responde até que um provedor de identidade real esteja
          conectado.
        </p>
        <p>
          É a condição de não-produção do <b>Risco-037</b>, no RIPD §7.3: papel escolhido por botão e
          sessão sem credencial não podem chegar a um ambiente com dado real. O protótipo navegável
          continua disponível no perfil de demonstração.
        </p>
      </div>
    </main>
  );
}
