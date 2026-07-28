import { Link } from 'react-router-dom';
import { Cabecalho, Didatico, Nota } from '../ui/primitivos';
import { Estados, useRecurso } from '../ui/estados';
import { ROTULO_URGENCIA } from '../mock/fila';
import type { ContadoresDaFila, ItemDaFila, Urgencia } from '../mock/fila';

interface Resposta {
  itens: ItemDaFila[];
  contadores: ContadoresDaFila;
}

/** Contador como pergunta, não como métrica (MAPA §4). */
const CONTADORES: { chave: keyof ContadoresDaFila; rotulo: string; rodape: string; tom?: Urgencia }[] = [
  { chave: 'vencido', rotulo: 'Prazo vencido', tom: 'vencido',
    rodape: 'alguém precisa decidir hoje, mesmo que a decisão seja aceitar' },
  { chave: 'agora', rotulo: 'Para hoje', tom: 'agora',
    rodape: 'prazo legal ou de comunicação correndo' },
  { chave: 'trintaDias', rotulo: 'Próximos 30 dias',
    rodape: 'cabe planejar; não cabe esquecer' },
  { chave: 'deOutrosPapeis', rotulo: 'De outros papéis',
    rodape: 'itens que existem no programa e não são seus' },
];

/**
 * T0 · Minha fila.
 *
 * A tela não decide nada: ela lê `GET /v1/fila`, que devolve o que a máquina de
 * estados já determinou. Não existe botão de criar item, e não existe filtro —
 * a fila é a do papel da sessão, e um recorte aqui seria o começo de consultar a
 * fila alheia por combinação.
 *
 * A ordem em que os itens chegam é a ordem em que são exibidos. Reordenar na
 * tela desfaria a única coisa que esta tela promete: ordem por consequência, não
 * por chegada.
 */
export default function T0() {
  const fila = useRecurso<Resposta>(
    { metodo: 'GET', caminho: '/v1/fila' },
    { vazioSe: (r) => r.itens.length === 0 },
  );
  const contadores = fila.dados?.contadores;

  return (
    <>
      <Cabecalho
        fontes={['mock/estados.ts', 'mock/decisoes.ts', 'mock/permissoes.ts']}
        titulo="Minha fila"
        resumo="Tudo que depende de você, na ordem da consequência — não na ordem de chegada. Cada item é um artefato parado num estado que exige ação: some da fila no instante em que o estado muda, porque nunca foi um registro próprio."
        nota={{
          engenharia: 'O que aparece aqui é o que trava merge, chave e evidência. Fechar na tela do artefato tira o item daqui sozinho.',
          dpo: 'Prazo legal correndo vem antes de vencimento de artefato — é a ordem da consequência, não a da sua caixa de entrada.',
          produto: 'A fila lista quem precisa agir. Você acompanha o programa pelo painel: o que é de outros papéis aparece como contagem, nunca como lista.',
          seguranca: 'Incidente e chave chegam aqui antes de virarem problema de calendário.',
          auditor: 'A fila é de quem opera. O que você audita é o registro do que foi feito, na T6.',
        }}
      />

      <div className="grid g4" style={{ marginBottom: 18 }}>
        {CONTADORES.map((c) => (
          <div className="card kpi-fila" key={c.chave}>
            <span className="kpi-rot">{c.rotulo}</span>
            <span className={`kpi-num ${c.tom ?? ''}`}>
              {contadores ? contadores[c.chave] : '—'}
            </span>
            <span className="hint">{c.rodape}</span>
          </div>
        ))}
      </div>

      <Estados
        recurso={fila}
        rotulo="a sua fila"
        vazio={(
          <>
            <b>Nada pendente para o seu papel.</b>
            <p className="hint" style={{ margin: '6px 0 0' }}>
              Os itens dos outros papéis continuam correndo — o contador acima diz quantos são, e o{' '}
              <Link to="/t1">painel de governança</Link> responde pelo estado do programa. A fila
              vazia é resposta, não falha: nenhum artefato está parado esperando uma ação sua.
            </p>
          </>
        )}
      >
        {(dados) => (
          <div className="fila">
            {dados.itens.map((item) => <ItemDaFilaCard key={`${item.artefato}:${item.id}`} item={item} />)}
          </div>
        )}
      </Estados>

      <Didatico>
        <Nota>
          A fila é derivada: não há tabela de itens no banco e não existe rota que crie um. Cada linha
          acima é a leitura de um artefato que a máquina de estados deixou parado — e é por isso que
          concluir a ação na tela do artefato faz o item sumir daqui sem ninguém marcar nada como feito.
        </Nota>
      </Didatico>
    </>
  );
}

/**
 * Quatro informações por item, sempre as mesmas (MAPA §4): o que está travado, o
 * prazo, a sua próxima ação e quem vem depois de você. Mais que isso vira
 * relatório — foi por isso que o título do artefato ficou de fora, e o cartão
 * abre com o código, que é a identidade e não uma quinta informação.
 *
 * O rito e a faixa de estados não são informação **sobre** o item: são a
 * explicação de por que ele existe e onde ele está no processo, e o MAPA pede os
 * dois à parte das quatro.
 */
function ItemDaFilaCard({ item }: { item: ItemDaFila }) {
  return (
    <article className="fila-item">
      <div className="fila-topo">
        <span className="mono fila-id">{item.id}</span>
        <span className="hint">{item.tipo}</span>
        <span className="spacer" />
        <span className={`urg ${item.prazo.urgencia}`}>
          {ROTULO_URGENCIA[item.prazo.urgencia]} · {item.prazo.texto}
        </span>
      </div>

      <div className="fila-quatro">
        <div>
          <span className="fila-rot">O que está travado</span>
          <p>{item.travado}</p>
        </div>
        <div>
          <span className="fila-rot">Sua próxima ação</span>
          <p className="fila-acao">{item.proximaAcao}</p>
          <p className="hint" style={{ margin: 0 }}>{item.proximo}</p>
        </div>
      </div>

      {/* A faixa vem de `estadosDe(artefato)`: a mesma tabela que decidiu que
          este item existe é a que desenha por onde ele passa. */}
      <ol className="fila-passos" aria-label={`Estado de ${item.id}`}>
        {item.estados.map((e, i) => (
          <li
            key={e}
            className={`fila-passo ${i === item.estadoAtual ? 'atual' : ''} ${i < item.estadoAtual ? 'feito' : ''}`}
            aria-current={i === item.estadoAtual ? 'step' : undefined}
          >
            {e.replace(/_/g, ' ')}
          </li>
        ))}
      </ol>

      <div className="fila-pe">
        <span className="hint" style={{ flex: 1, minWidth: 240 }}>
          {item.rito.texto} <span className="hash">{item.rito.fonte}</span>
        </span>
        <Link className="btn primary" to={item.tela}>Abrir {item.tela.toUpperCase().slice(1)}</Link>
      </div>
    </article>
  );
}

