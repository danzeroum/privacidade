/**
 * "Como funciona" — a página de referência do processo.
 *
 * Três restrições que a definem, e todas as três são deliberadas:
 *
 * 1. **Não importa runtime.** Nenhum `mock/*` entra aqui. Uma página de
 *    referência que lê o banco vira uma tela de operação com outro nome, e
 *    passa a poder mostrar dado de titular por acidente.
 *
 * 2. **Não renderiza BPMN.** O `MAPA-PROCESSOS.md §5` é explícito: ninguém opera
 *    um diagrama. Embutir um renderizador aqui custaria uma dependência grande
 *    para exibir o que o próprio `.bpmn` já diz melhor a quem precisa lê-lo.
 *
 * 3. **Não enumera estados nem regras de decisão.** Essa lista já existe em
 *    `docs/processos/*.bpmn` e `*.dmn`, e lá ela é **conferida por teste** contra
 *    o runtime. Repeti-la aqui criaria uma terceira cópia — a única sem catraca,
 *    e por isso a primeira a envelhecer. Esta página diz onde cada coisa mora e
 *    o que garante que ela não mente; a enumeração fica com quem tem prova.
 */
import { Link } from 'react-router-dom';
import { Cartao, Nota, Tabela } from '../ui/primitivos';

const PROCESSOS = [
  { bpmn: 'PR-01', nome: 'Parecer técnico', artefato: 'parecer', telas: 'T2, T3', arquivo: 'parecer.bpmn' },
  { bpmn: 'PR-02', nome: 'RIPD e análise algorítmica', artefato: 'ripd', telas: 'T3, gate de CI', arquivo: 'ripd.bpmn' },
  { bpmn: 'PR-03', nome: 'PbD no ciclo de desenvolvimento', artefato: 'chave, épico', telas: 'T1, T2, T7', arquivo: 'chave.bpmn' },
  { bpmn: 'PR-04', nome: 'Ciclo de governança', artefato: 'risco, lia', telas: 'T1, T5, T8, T10', arquivo: 'risco.bpmn · lia.bpmn' },
  { bpmn: 'PR-05', nome: 'Auditoria, planos e evidências', artefato: 'achado, incidente, solicitacao', telas: 'T4, T6, T9', arquivo: 'achado.bpmn · incidente.bpmn · solicitacao.bpmn' },
];

const FONTES = [
  { arquivo: 'docs/processos/*.bpmn', papel: 'Especificação do ciclo de vida de cada artefato',
    prova: 'teste de conformidade compara estados e transições com mock/estados.ts' },
  { arquivo: 'docs/processos/*.dmn', papel: 'Especificação das três tabelas de decisão, uma por versão publicada',
    prova: 'varredura de todas as combinações de entrada contra mock/decisoes.ts' },
  { arquivo: 'app/src/mock/estados.ts', papel: 'O que executa a sequência: a transição é legal?',
    prova: 'transição fora da tabela é 409, com teste para as nove ilegais do mapa' },
  { arquivo: 'app/src/mock/decisoes.ts', papel: 'O que executa as decisões, com a versão gravada em cada uma',
    prova: 'decisão gravada reproduz a saída da versão que a produziu' },
  { arquivo: 'app/src/mock/api.ts', papel: 'Onde a regra de privacidade mora — validação de conteúdo e registro',
    prova: 'as nove regras são teste, não comentário' },
  { arquivo: 'db/schema.sql', papel: 'As restrições no banco: RLS, append-only, TTL, cripto-shredding',
    prova: 'adulteração é detectada mesmo com os gatilhos desligados' },
  { arquivo: 'api/openapi.yaml', papel: 'O contrato das rotas',
    prova: 'rota sem política declarada é recusada por padrão' },
  { arquivo: '.privacy/', papel: 'O que este repositório declara sobre os dados que trata',
    prova: 'gate de privacidade reprova PII em log e campo fora do inventário' },
];

const SEPARACOES = [
  { titulo: 'Verificação e validação', o: 'A sequência é legal?', outro: 'Este pedido satisfaz a lei?',
    onde: 'estados.ts responde a primeira e devolve 409; api.ts responde a segunda e devolve 422.',
    porque: 'Trocar os dois códigos manda a pessoa reescrever um texto que já estava bom, quando o problema era a ordem dos passos.' },
  { titulo: 'Decisão e explicação', o: 'Qual a saída da tabela?', outro: 'Por que essa saída?',
    onde: 'A frase é derivada da regra que casou, não escrita ao lado dela.',
    porque: 'Texto ao lado de uma regra é a próxima divergência esperando acontecer.' },
  { titulo: 'Processo e compromisso', o: 'Artefato em estado que exige ação', outro: 'Obrigação agendada do ano',
    onde: 'A fila (T0) deriva dos estados; o calendário (T10) promove obrigação a item quando entra a antecedência.',
    porque: 'Modelar compromisso como processo em execução é o que enche painel de governança de coisa que ninguém trata.' },
  { titulo: 'Ausência e desabilitado', o: 'O papel não opera isto', outro: 'O controle está indisponível agora',
    onde: 'O que um papel não opera não é renderizado — nem escondido por CSS, nem desabilitado.',
    porque: 'Controle desabilitado continua no DOM e não sobrevive a uma auditoria de código.' },
];

export default function ComoFunciona() {
  return (
    <>
      <div className="ref-cabecalho">
        <span className="hash">referência · somente leitura</span>
        <h1>Como funciona</h1>
        <p>
          Esta página não opera nada. Ela responde a uma pergunta só: onde mora cada peça do
          programa, e o que garante que a descrição dela não envelhece. Nenhum controle aqui
          escreve, e nenhum dado de titular chega até aqui — a página não lê o banco.
        </p>
      </div>

      <Cartao titulo="Os cinco processos e onde eles vivem" hint="MAPA-PROCESSOS.md §1">
        <p className="hint" style={{ marginTop: 0 }}>
          Duas telas por processo seriam dez telas. O produto cobre os cinco fluxos com onze porque o
          recorte dele é por <b>artefato</b>, não por processo — e as duas telas de trabalho, a fila e o
          calendário, não são de processo nenhum.
        </p>
        <Tabela cabecalho={['BPMN', 'Processo', 'Artefato que ele move', 'Onde aparece', 'Especificação']}>
          {PROCESSOS.map((p) => (
            <tr key={p.bpmn}>
              <td className="mono">{p.bpmn}</td>
              <td>{p.nome}</td>
              <td className="mono">{p.artefato}</td>
              <td>{p.telas}</td>
              <td className="hash">{p.arquivo}</td>
            </tr>
          ))}
        </Tabela>
      </Cartao>

      <div className="sec-title">Onde mora cada coisa — e o que prova que ela não mente</div>
      <Cartao titulo="As fontes versionadas" hint="o .ts executa; o .bpmn e o .dmn são conferidos contra ele">
        <Tabela cabecalho={['Arquivo', 'O que ele é', 'O que impede de virar ficção']}>
          {FONTES.map((f) => (
            <tr key={f.arquivo}>
              <td className="hash">{f.arquivo}</td>
              <td>{f.papel}</td>
              <td>{f.prova}</td>
            </tr>
          ))}
        </Tabela>
        <Nota>
          A especificação e o código são dois arquivos, e um teste os prende um ao outro nas duas
          direções: aresta nova no runtime sem atualizar o <span className="mono">.bpmn</span> reprova, e
          aresta apagada do <span className="mono">.bpmn</span> sem tirar do runtime reprova também. É o
          que separa documentação versionada de documentação abandonada no mesmo repositório.
        </Nota>
      </Cartao>

      <div className="sec-title">Quatro separações que o sistema inteiro apoia</div>
      <div className="grid g2">
        {SEPARACOES.map((s) => (
          <Cartao key={s.titulo} titulo={s.titulo}>
            <div className="ref-par">
              <span>{s.o}</span>
              <span className="hint">contra</span>
              <span>{s.outro}</span>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 13.5 }}>{s.onde}</p>
            <p className="hint" style={{ margin: '6px 0 0' }}>{s.porque}</p>
          </Cartao>
        ))}
      </div>

      <Cartao titulo="O que este protótipo não é" className="mt">
        <ul className="ref-lista">
          <li>
            <b>Não é um renderizador de BPMN.</b> Ninguém opera um diagrama. Os arquivos de processo
            existem para serem lidos por quem especifica e conferidos por quem programa — não para
            serem desenhados numa tela de trabalho.
          </li>
          <li>
            <b>Não é um BPMS.</b> Se um dia entrar, a fronteira é: o BPMS orquestra pessoas entre áreas;
            esta plataforma é dona dos artefatos e dos gates. Integração por API e por estado, nunca por
            incorporação.
          </li>
          <li>
            <b>Não tem dado real.</b> Os três cenários são massa de demonstração, e cada um guarda o
            próprio banco e o próprio histórico.
          </li>
        </ul>
        <Nota>
          Para ver o programa em operação, comece pela <Link to="/t0">fila</Link>: ela mostra o que
          depende de você, derivado dos mesmos estados que os arquivos de processo especificam.
        </Nota>
      </Cartao>
    </>
  );
}
