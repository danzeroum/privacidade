import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cabecalho, Cartao, Didatico, Modal, Nota, Permitido, Pill, Tabela } from '../ui/primitivos';
import { Estados, useRecurso } from '../ui/estados';
import { useSessao } from '../store/sessao';
import {
  CAPACIDADE_DIAS_MES, MESES, RESERVA_DEMANDA, TRILHAS, diasAte, mesDe,
} from '../mock/calendario';
import { pode } from '../mock/permissoes';
import type { CargaDoMes, Obrigacao, Trilha } from '../mock/calendario';

interface Resposta {
  obrigacoes: Obrigacao[];
  carga: CargaDoMes[];
  naAntecedencia: string[];
}

const tomDaTrilha = (t: Trilha) => TRILHAS.find((x) => x.id === t)?.tom ?? 'var(--text-3)';
const rotuloDaTrilha = (t: Trilha) => TRILHAS.find((x) => x.id === t)?.rotulo ?? t;

/**
 * T10 · Calendário do ano.
 *
 * Não é um calendário comum, e a diferença está em três coisas que esta tela faz
 * e um Outlook não faz:
 *
 * 1. A barra do mês é **carga provisionada**, somada das obrigações mais a
 *    reserva de demanda. Ela não mede progresso: mede quanto do mês já está
 *    comprometido antes de qualquer incidente acontecer.
 * 2. O que chega por demanda não aparece como data, e sim como capacidade
 *    reservada — porque disputa as mesmas pessoas.
 * 3. Cada obrigação carrega **o que acontece se passar**, e é esse texto que a
 *    fila e o convite do calendário levam.
 */
export default function T10() {
  const papel = useSessao((s) => s.papel);
  const [trilha, setTrilha] = useState<Trilha | 'todas'>('todas');
  const [soMeus, setSoMeus] = useState(false);
  const [prorrogando, setProrrogando] = useState<Obrigacao | null>(null);

  const cal = useRecurso<Resposta>(
    { metodo: 'GET', caminho: '/v1/calendario' },
    { vazioSe: (r) => r.obrigacoes.length === 0 },
  );

  const todas = cal.dados?.obrigacoes ?? [];
  const naFila = new Set(cal.dados?.naAntecedencia ?? []);
  const visiveis = todas.filter((o) => (
    (trilha === 'todas' || o.trilha === trilha) && (!soMeus || pode(papel, o.acao))
  ));

  const meus = todas.filter((o) => pode(papel, o.acao)).length;
  const prazos = todas.filter((o) => o.tipo === 'prazo').length;

  return (
    <>
      <Cabecalho
        fontes={['mock/calendario.ts', 'ICS · feed assinado por papel']}
        titulo="Calendário do ano"
        resumo="Tudo que o programa já sabe que vai acontecer, provisionado no início do ano. O que chega por demanda — incidente, pedido de titular, achado — não entra aqui como data: entra como capacidade reservada, porque disputa as mesmas pessoas."
        nota={{
          engenharia: 'Rotação de chave, revisão de RIPD e expurgo anual têm data. Entram na sua fila quando falta a antecedência declarada.',
          dpo: 'O ciclo do programa inteiro está aqui. Prorrogar uma data exige justificativa e fica no trail — como reclassificar risco.',
          produto: 'A barra de cada mês diz quanto do mês já está comprometido antes de qualquer incidente. É a leitura que ajuda a escolher a data de um lançamento.',
          seguranca: 'Tabletop e rotação de chave são compromissos com data. O resto do seu trabalho chega por demanda e está na reserva.',
          auditor: 'O ano provisionado é leitura para o seu papel, e as prorrogações estão no trail com a data antiga, a nova e a justificativa.',
        }}
      />

      <Estados
        recurso={cal}
        rotulo="o calendário do ano"
        vazio={<b>Este cenário não tem obrigações provisionadas.</b>}
      >
        {(dados) => (
          <>
            <div className="grid g4" style={{ marginBottom: 18 }}>
              <Contador rotulo="Provisionado no ano" valor={todas.length}
                rodape="obrigações conhecidas em 1º de janeiro" />
              <Contador rotulo="Prazos com consequência" valor={prazos} tom="crit"
                rodape="passar da data bloqueia repositório, gate ou base legal" />
              <Contador rotulo="Sob sua responsabilidade" valor={meus}
                rodape="o resto tem dono nomeado em outra área" />
              <Contador rotulo="Reserva para demanda" valor={`${Math.round(RESERVA_DEMANDA * 100)}%`} tom="warn"
                rodape={`${Math.round(CAPACIDADE_DIAS_MES * RESERVA_DEMANDA)} dias-pessoa por mês, fora de qualquer data`} />
            </div>

            <div className="row" style={{ marginBottom: 14 }}>
              <button
                className={`chip ${trilha === 'todas' ? 'sel' : ''}`}
                onClick={() => setTrilha('todas')}
                aria-pressed={trilha === 'todas'}
              >
                Todas as trilhas
              </button>
              {TRILHAS.map((t) => (
                <button
                  key={t.id}
                  className={`chip ${trilha === t.id ? 'sel' : ''}`}
                  onClick={() => setTrilha(t.id)}
                  aria-pressed={trilha === t.id}
                >
                  <i className="dot" style={{ background: t.tom }} /> {t.rotulo}
                </button>
              ))}
              <span className="spacer" />
              <button className="chip" aria-pressed={soMeus} onClick={() => setSoMeus((v) => !v)}>
                {soMeus ? 'Mostrando só as minhas' : 'Mostrar só as minhas'}
              </button>
            </div>

            <div className="ano" role="list" aria-label="Os doze meses do ano">
              {dados.carga.map((c) => {
                const doMes = visiveis.filter((o) => mesDe(o) === c.mes);
                return (
                  <div className="mes" role="listitem" key={c.mes}>
                    <div className="mes-topo">
                      <span className="mes-rot">{MESES[c.mes]}</span>
                      <span className="hint">{c.percentual}%</span>
                    </div>
                    {/* A barra é somada das obrigações do mês mais a reserva.
                        Não existe número digitado por trás dela. */}
                    <div
                      className="mes-barra"
                      role="meter"
                      aria-valuenow={c.percentual}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${MESES[c.mes]}: ${c.percentual}% da capacidade provisionada — ${c.provisionado} dias-pessoa em obrigações e ${c.reservado} de reserva`}
                    >
                      <i style={{ width: `${c.percentual}%` }} className={c.percentual >= 80 ? 'crit' : c.percentual >= 60 ? 'warn' : ''} />
                    </div>
                    <div className="mes-itens">
                      {doMes.map((o) => (
                        <span
                          key={o.codigo}
                          className={`mes-item ${naFila.has(o.codigo) ? 'na-fila' : ''} ${o.cumpridaEm ? 'cumprida' : ''}`}
                          style={{ borderLeftColor: tomDaTrilha(o.trilha) }}
                          title={`${o.titulo} · ${rotuloDaTrilha(o.trilha)}`}
                        >
                          {o.curto}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <Nota>
              A barra de cada mês é <b>carga provisionada</b>, não progresso: ela soma os dias-pessoa das
              obrigações do mês e a reserva de {Math.round(RESERVA_DEMANDA * 100)}% para o que chega por
              demanda, sobre {CAPACIDADE_DIAS_MES} dias-pessoa de capacidade. É por isso que incidente em
              mês cheio custa mais caro que em mês vazio — leitura que um calendário comum não dá.
            </Nota>

            <div className="sec-title">Provisionado — e o que acontece se passar</div>
            <Cartao titulo="Obrigações do ano" hint={`${visiveis.length} de ${todas.length} com o recorte atual`}>
              <Tabela cabecalho={['Mês', 'Obrigação', 'Tipo', 'Preparar', 'Se passar', 'Situação', '']}>
                {visiveis.map((o) => (
                  <tr key={o.codigo}>
                    <td className="mono" style={{ textTransform: 'uppercase' }}>{MESES[mesDe(o)]}</td>
                    <td>
                      <span className="row" style={{ gap: 7 }}>
                        <i className="dot" style={{ background: tomDaTrilha(o.trilha) }} />
                        {o.titulo}
                      </span>
                      <div className="hint">
                        <span className="mono">{o.codigo}</span> · {rotuloDaTrilha(o.trilha)} · {o.cargaDias} dias-pessoa
                      </div>
                    </td>
                    <td><Pill tom={o.tipo === 'prazo' ? 'crit' : 'neutral'}>{o.tipo}</Pill></td>
                    <td>{o.preparar}<div className="hint">antecedência de {o.antecedenciaDias} dias</div></td>
                    <td>{o.seFalhar}</td>
                    <td>
                      {o.cumpridaEm
                        ? <Pill tom="ok">cumprida</Pill>
                        : naFila.has(o.codigo)
                          ? <Link to="/t0"><Pill tom="warn">na sua fila</Pill></Link>
                          : <span className="hint">em {diasAte(o, Date.now())} dias</span>}
                      {(o.prorrogacoes ?? []).length > 0 && (
                        <div className="hint">prorrogada {(o.prorrogacoes ?? []).length}×</div>
                      )}
                    </td>
                    <td>
                      {/* Direção única: prorrogar é ato registrado, e só de quem
                          responde pela obrigação. Para os demais, ausência. */}
                      {!o.cumpridaEm && pode(papel, o.acao) && (
                        <button className="reveal" onClick={() => setProrrogando(o)}>Prorrogar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </Tabela>
            </Cartao>

            <div className="grid g2" style={{ marginTop: 18, alignItems: 'start' }}>
              <Cartao titulo="Por demanda — não tem data, tem reserva">
                <p className="hint" style={{ marginTop: 0 }}>
                  Estas quatro naturezas não são agendáveis. Provisioná-las como capacidade é o que evita
                  que o ciclo do programa seja atropelado por elas todo mês.
                </p>
                <dl className="kv">
                  <dt>Incidente</dt><dd>consome de 3 a 10 dias-pessoa cada, com prazo regulatório correndo</dd>
                  <dt>Direito do titular</dt><dd>prazo legal de 15 dias, 5 para revisão de decisão</dd>
                  <dt>Achado de auditoria</dt><dd>chega em bloco, na janela de auditoria</dd>
                  <dt>Parecer e PR bloqueado</dt><dd>fluxo contínuo, 10 a 15 dias úteis por parecer conforme a complexidade</dd>
                </dl>
              </Cartao>

              <FeedIcs />
            </div>

            <Didatico>
              <Nota>
                As obrigações não são instâncias de processo: são compromissos agendados que <b>geram</b>{' '}
                item na fila quando entra a antecedência. Modelar cada uma como processo em execução é o
                que faz painel de governança encher de coisa que ninguém trata.
              </Nota>
            </Didatico>
          </>
        )}
      </Estados>

      {prorrogando && (
        <ModalProrrogar obrigacao={prorrogando} aoFechar={() => setProrrogando(null)} />
      )}
    </>
  );
}

function Contador({ rotulo, valor, rodape, tom }: {
  rotulo: string; valor: number | string; rodape: string; tom?: 'crit' | 'warn';
}) {
  return (
    <div className="card kpi-fila">
      <span className="kpi-rot">{rotulo}</span>
      <span className={`kpi-num ${tom === 'crit' ? 'vencido' : tom === 'warn' ? 'agora' : ''}`}>{valor}</span>
      <span className="hint">{rodape}</span>
    </div>
  );
}

/**
 * O feed, somente leitura e assinado por papel.
 *
 * A URL mostrada é a do papel da sessão e de mais nenhum: a assinatura sai da
 * rota, e mintar a de outro papel exigiria o segredo. É o começo que o MAPA §4
 * recomenda — pega quase todo o valor sem pedir permissão de escrita no
 * calendário de ninguém.
 */
function FeedIcs() {
  const chamar = useSessao((s) => s.chamar);
  const papel = useSessao((s) => s.papel);
  const [ics, setIcs] = useState<string | null>(null);
  const assinatura = useRecurso<{ papel: string; caminho: string }>(
    { metodo: 'GET', caminho: '/v1/calendario/assinatura' },
  );
  const caminho = assinatura.dados?.caminho ?? '';

  const ver = () => {
    const res = chamar<string>({ metodo: 'GET', caminho });
    if (res.status === 200) setIcs(res.body);
  };

  return (
    <Cartao titulo="Sincronização com Teams e Google" hint="feed ICS somente leitura">
      <ol className="regras-sync">
        <li><b>Compromisso e prazo viram evento de dia inteiro.</b> O prazo vai marcado como prazo, e o convite carrega o que acontece se passar.</li>
        <li><b>Nada por demanda sai, e nenhum evento carrega dado pessoal.</b> Incidente, pedido de titular e achado ficam dentro da plataforma. O evento leva código, tipo, consequência e link de volta — nunca titular, protocolo com dado, escopo de incidente ou anexo.</li>
        <li><b>Direção única.</b> Este calendário é a fonte: mover a data no Teams não muda o prazo aqui. Prorrogar exige justificativa registrada, como a reclassificação de risco.</li>
      </ol>
      <div className="row" style={{ marginTop: 12 }}>
        <span className="hash" style={{ flex: 1, minWidth: 200, overflowX: 'auto' }}>{caminho}</span>
        <button className="btn" onClick={ver} disabled={!caminho}>Ver o feed de {papel}</button>
      </div>
      <Nota>
        A URL é a credencial, como em qualquer ICS — por isso é assinada por papel. Ela abre a sua e
        somente a sua: a de outro papel exige um segredo que não sai da plataforma.
      </Nota>
      {ics && <pre className="doc" style={{ marginTop: 12 }}>{ics}</pre>}
    </Cartao>
  );
}

function ModalProrrogar({ obrigacao, aoFechar }: { obrigacao: Obrigacao; aoFechar: () => void }) {
  const chamar = useSessao((s) => s.chamar);
  const avisar = useSessao((s) => s.avisar);
  const [para, setPara] = useState(obrigacao.vence);
  const [justificativa, setJustificativa] = useState('');

  const aplicar = () => {
    const res = chamar<{ de: string; para: string }>(
      { metodo: 'POST', caminho: `/v1/calendario/${obrigacao.codigo}/prorrogar`, body: { para, justificativa } },
      'prorrogar',
    );
    if (res.status === 200) {
      avisar('ok', `${obrigacao.codigo} prorrogada de ${res.body.de} para ${res.body.para}.`,
        'A data antiga, a nova e a justificativa ficaram no trail — a prorrogação é registro, não ajuste.');
      useSessao.setState((s) => ({ versao: s.versao + 1 }));
      aoFechar();
    }
  };

  return (
    <Modal
      titulo={`Prorrogar ${obrigacao.codigo}`}
      aoFechar={aoFechar}
      rodape={(
        <Permitido acao="escrever">
          <button className="btn primary" onClick={aplicar}>Registrar prorrogação</button>
        </Permitido>
      )}
    >
      <p style={{ marginTop: 0 }}>{obrigacao.titulo}</p>
      <Nota tom="warn">Se passar: {obrigacao.seFalhar}.</Nota>
      <div className="field">
        <label htmlFor="prorrogar-data">Nova data (hoje: {obrigacao.vence})</label>
        <input id="prorrogar-data" type="date" value={para} onChange={(e) => setPara(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="prorrogar-just">Justificativa (mínimo 20 caracteres)</label>
        <textarea
          id="prorrogar-just"
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          placeholder="Por que a data muda, e o que absorve a consequência declarada."
        />
      </div>
      <Recusa />
    </Modal>
  );
}

/** A recusa fica ancorada no controle que falhou (C-10), dentro do próprio modal. */
function Recusa() {
  const recusa = useSessao((s) => s.recusas.prorrogar);
  if (!recusa) return null;
  return (
    <p className="note crit" role="alert" style={{ marginTop: 10 }}>
      <b>{recusa.texto}</b> {recusa.regra}
    </p>
  );
}
