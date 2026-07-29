import { useEffect, useRef, useState } from 'react';
import { CampoPII, Cabecalho, Cartao, Didatico, NaoImplementado, Nota, Permitido, Pill, Tabela } from '../ui/primitivos';
import { useSessao } from '../store/sessao';
import { hashCpf } from '../lib/sha256';
import { redigir, resumoDaRedacao } from '../lib/redator';
import { pode } from '../mock/permissoes';
import { BASES_LEGAIS } from '../mock/types';
import type { BaseLegal, DesfechoSolicitacao, Finalidade, ResultadoRevisao, Solicitacao } from '../mock/types';

/** Linha do editor de retidos. `retencaoAte` é string porque vem de um `<input type="date">`. */
interface RetidoEmEdicao { item: string; baseLegal: BaseLegal; artigo: string; retencaoAte: string }

/** Atualiza uma linha da lista sem mutar as outras. */
const atualizar = (
  set: React.Dispatch<React.SetStateAction<RetidoEmEdicao[]>>,
  indice: number,
  troca: Partial<RetidoEmEdicao>,
) => set((v) => v.map((r, i) => (i === indice ? { ...r, ...troca } : r)));

const DIA = 86_400_000;

const ROTULO_DIREITO: Record<string, string> = {
  confirmacao: 'Confirmação (I)', acesso: 'Acesso (II)', correcao: 'Correção (III)',
  anonimizacao: 'Anonimização (IV)', bloqueio: 'Bloqueio (IV)', eliminacao: 'Eliminação (VI)',
  portabilidade: 'Portabilidade (V)', compartilhamentos: 'Compartilhamentos (VII)',
  revogacao: 'Revogação (VIII)', revisao_decisao: 'Revisão de decisão (Art. 20)',
  oposicao: 'Oposição (§2º)',
};

const ROTULO_DESFECHO: Record<DesfechoSolicitacao, string> = {
  atendido: 'Atendido integralmente',
  atendido_parcialmente: 'Atendido parcialmente',
  recusado_com_fundamento: 'Recusado com fundamento',
};

const ABAS = [
  { id: 'dados', rotulo: 'Dados do titular' },
  { id: 'compart', rotulo: 'Compartilhamentos' },
  { id: 'revisao', rotulo: 'Revisão de decisão' },
  { id: 'mensagens', rotulo: 'Mensagens' },
] as const;
type AbaId = (typeof ABAS)[number]['id'];

const encerrada = (s: Solicitacao) => s.status === 'concluida' || s.status === 'recusada_com_fundamento';

export default function T4() {
  const banco = useSessao((s) => s.banco);
  const chamar = useSessao((s) => s.chamar);
  const papel = useSessao((s) => s.papel);
  const protocoloSelecionado = useSessao((s) => s.protocoloSelecionado);
  const setProtocolo = useSessao((s) => s.setProtocolo);
  const avisar = useSessao((s) => s.avisar);
  useSessao((s) => s.versao);

  const [aba, setAba] = useState<AbaId>('dados');
  const [cpf, setCpf] = useState('');
  const [finalidadeBusca, setFinalidadeBusca] = useState<Finalidade | ''>('');
  const [ultimoHash, setUltimoHash] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState('');
  const abasRef = useRef<(HTMLButtonElement | null)[]>([]);

  const solicitacoes = banco.cenario.solicitacoes;
  const abertas = solicitacoes.filter((s) => !encerrada(s));

  /**
   * T4-01 — a tela sempre trabalha sob um protocolo, e é ele que manda no
   * contexto. Antes, a fila era decorativa: o painel mostrava o titular da
   * primeira linha enquanto a busca trocava os dados por baixo, e o DPO podia
   * ler a ficha de uma pessoa acreditando estar atendendo outra.
   */
  useEffect(() => {
    if (protocoloSelecionado && solicitacoes.some((s) => s.protocolo === protocoloSelecionado)) return;
    const inicial = solicitacoes.find((s) => !encerrada(s)) ?? solicitacoes[0];
    setProtocolo(inicial?.protocolo ?? null);
  }, [protocoloSelecionado, solicitacoes, setProtocolo]);

  if (!pode(papel, 'ver_portal_titular')) {
    return (
      <div className="bloqueio">
        <Cabecalho fontes={['Art. 18']} titulo="Direitos do titular" resumo="" nota={{}} />
        <Nota tom="crit">
          O papel <b>Segurança</b> não opera o balcão de atendimento. Esta tela não é apenas escondida:
          o componente não é montado, e nenhuma requisição de titular parte desta sessão.
        </Nota>
      </div>
    );
  }

  const foco = solicitacoes.find((s) => s.protocolo === protocoloSelecionado) ?? solicitacoes[0];
  const titular = banco.cenario.titulares.find((t) => t.id === foco?.titularId);

  /**
   * T4-05 — "atendidas no SLA" compara conclusão com prazo-limite. A conta
   * anterior olhava só o prazo contra uma janela de 30 dias e devolvia
   * praticamente sempre 100%: media a idade da solicitação, não o cumprimento.
   */
  const encerradas = solicitacoes.filter((s) => encerrada(s) && s.concluidaEmMs !== undefined);
  const noPrazo = encerradas.filter((s) => (s.concluidaEmMs as number) <= s.prazoLimiteMs);

  const identificar = () => {
    const h = hashCpf(cpf);
    const res = chamar<{ id: string }>({
      metodo: 'POST', caminho: '/v1/titulares/buscar',
      purpose: finalidadeBusca || undefined,
      body: { cpfHash: h },
    });
    // T2-01 — o documento sai da sessão assim que o hash é calculado.
    setCpf('');
    setUltimoHash(h.slice(0, 8));
    if (res.status !== 200) return;
    // A busca não troca a ficha por baixo do contexto: ela seleciona a
    // solicitação daquele titular. Sem solicitação, não há sob o que atender.
    const doTitular = solicitacoes.find((s) => s.titularId === res.body.id && !encerrada(s))
      ?? solicitacoes.find((s) => s.titularId === res.body.id);
    if (doTitular) setProtocolo(doTitular.protocolo);
    else {
      avisar('info', 'Titular localizado, mas sem solicitação nesta fila.',
        'O contexto continua no protocolo atual: exibir a ficha de quem não tem pedido aberto seria acesso sem atendimento.');
    }
  };

  const enviarMensagem = () => {
    const res = chamar({ metodo: 'POST', caminho: `/v1/requests/${foco.id}/mensagens`, body: { corpo: rascunho } });
    if (res.status === 200) setRascunho('');
  };

  const navegarAbas = (e: React.KeyboardEvent, indice: number) => {
    const destino =
      e.key === 'ArrowRight' ? (indice + 1) % ABAS.length
        : e.key === 'ArrowLeft' ? (indice - 1 + ABAS.length) % ABAS.length
          : e.key === 'Home' ? 0
            : e.key === 'End' ? ABAS.length - 1
              : -1;
    if (destino < 0) return;
    e.preventDefault();
    setAba(ABAS[destino].id);
    abasRef.current[destino]?.focus();
  };

  const grupos = [...new Set(titular?.campos.map((c) => c.grupo) ?? [])];

  return (
    <>
      <Cabecalho
        fontes={['pseudonymizer.ts', 'privacy-redactor.ts', 'Art. 18 · Art. 20']}
        titulo="Direitos do titular"
        resumo="Cada direito do Art. 18 é um endpoint com prazo, nível de autenticação e evidência. Esta tela é o lado de dentro do balcão."
        nota={{
          engenharia: 'Cada aba corresponde a um endpoint com prazo e nível de autenticação. Direito sem rota aqui é direito que não existe.',
          dpo: 'O cronômetro é o seu radar: a menos de 24 h do prazo a plataforma avisa antes de o titular cobrar.',
          produto: 'Você acompanha volume e prazo, mas não recebe a opção de revelar dado de titular — o botão não fica escondido, ele não é renderizado.',
          auditor: 'Leitura sem reidentificação: nenhum botão de revelar é montado para este papel.',
        }}
      />

      <div className="grid g4">
        <div className="card kpi"><span className="kpi-label">Solicitações no mês</span><span className="kpi-val">{solicitacoes.length}</span></div>
        <div className="card kpi">
          <span className="kpi-label">Tempo médio de resposta</span>
          <span className="kpi-val">{banco.cenario.metricas.find((m) => m.chave === 'sla')?.valor ?? '—'}<small>h</small></span>
          <span className="kpi-foot">meta interna 5 dias · prazo legal 15</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Atendidas no SLA</span>
          <span className="kpi-val">
            {encerradas.length ? Math.round((noPrazo.length / encerradas.length) * 100) : 0}<small>%</small>
          </span>
          <span className="kpi-foot">
            {noPrazo.length} de {encerradas.length} encerradas com conclusão dentro do prazo legal
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">A menos de 24 h do prazo</span>
          <span className="kpi-val" style={{ color: 'var(--warn)' }}>
            {abertas.filter((s) => s.prazoLimiteMs - Date.now() < DIA).length}
          </span>
          <span className="kpi-foot">DPO notificado automaticamente</span>
        </div>
      </div>

      <div className="sec-title">Fila de atendimento</div>
      <Cartao hint="Selecione o protocolo: é ele que define o titular exibido abaixo e entra no registro de cada revelação.">
        <Tabela cabecalho={['Protocolo', 'Direito', 'Titular', 'Sistemas', 'SLA', 'Status']}>
          {solicitacoes.map((s) => {
            const restante = s.prazoLimiteMs - Date.now();
            const urgente = restante < DIA && !encerrada(s);
            const ativa = s.protocolo === foco?.protocolo;
            return (
              <tr key={s.id} className={ativa ? 'ativa' : undefined}>
                <td>
                  <button
                    className="reveal mono"
                    aria-pressed={ativa}
                    aria-label={`Atender protocolo ${s.protocolo}`}
                    onClick={() => setProtocolo(s.protocolo)}
                  >
                    {ativa ? '● ' : ''}{s.protocolo}
                  </button>
                </td>
                <td>{ROTULO_DIREITO[s.direito]}</td>
                <td className="mono" style={{ fontSize: 12.5 }}>{s.titularPseudonimo}</td>
                <td className="hint">{s.sistemas.length} sistema{s.sistemas.length === 1 ? '' : 's'}</td>
                <td style={{ minWidth: 170 }}>
                  {encerrada(s)
                    ? (
                      <>
                        <span style={{ color: (s.concluidaEmMs ?? 0) <= s.prazoLimiteMs ? 'var(--ok)' : 'var(--warn)', fontSize: 12.5 }}>
                          {s.status === 'recusada_com_fundamento' ? 'recusada' : 'concluída'} em {s.concluidaEm}
                          {' · '}{(s.concluidaEmMs ?? 0) <= s.prazoLimiteMs ? 'no prazo' : 'fora do prazo'}
                        </span>
                        {/* T4-05 — o prazo aparece ao lado da conclusão: duas datas
                            iguais podem ter veredictos diferentes, e sem o
                            limite isso parece defeito em vez de conta. */}
                        <div className="hint">prazo era {new Date(s.prazoLimiteMs).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</div>
                      </>
                    )
                    : (
                      <>
                        <div className="mono" style={{ color: urgente ? 'var(--warn)' : undefined }}>
                          {formatarRestante(restante)}
                        </div>
                        <div className="sla-bar">
                          <i style={{
                            width: `${Math.min(100, Math.max(4, 100 - (restante / (15 * DIA)) * 100))}%`,
                            background: urgente ? 'var(--warn)' : 'var(--ok)',
                          }} />
                        </div>
                        <div className="hint">
                          meta interna 5 dias · prazo legal {s.direito === 'revisao_decisao' ? '5' : '15'} dias úteis
                        </div>
                      </>
                    )}
                </td>
                <td>
                  <Pill tom={encerrada(s) ? 'ok' : s.status === 'em_analise' ? 'warn' : 'neutral'}>
                    {s.status.replace('_', ' ')}
                  </Pill>
                  {s.nivelVerificacao === 3 && <div><Pill tom="crit">verificação elevada</Pill></div>}
                </td>
              </tr>
            );
          })}
        </Tabela>
      </Cartao>

      {foco && (
        <>
          {/* T4-01 — a faixa de contexto acompanha todas as abas. Quem está
              atendendo nunca precisa rolar de volta para conferir sob qual
              protocolo — e sob qual pessoa — está trabalhando. */}
          <div className="banner" style={{ marginTop: 18, position: 'sticky', top: 0, zIndex: 5 }}>
            <span className="mark">📄</span>
            <div>
              <h4>
                Protocolo <span className="mono">{foco.protocolo}</span> ·
                {' '}{ROTULO_DIREITO[foco.direito].toLowerCase()}
              </h4>
              <p>
                Titular <span className="mono">{foco.titularPseudonimo}</span> ·
                {' '}recebida em {foco.recebidaEm} ·
                {' '}{encerrada(foco)
                  ? `${foco.status === 'recusada_com_fundamento' ? 'recusada' : 'concluída'} em ${foco.concluidaEm}`
                  : formatarRestante(foco.prazoLimiteMs - Date.now())}
                {' · '}verificação nível {foco.nivelVerificacao}
              </p>
            </div>
          </div>

          <div className="grid g-2-1">
            <Cartao>
              {/* T4-04 — as abas seguem o padrão ARIA de verdade: foco único no
                  conjunto, setas para navegar, painel ligado ao seu controle. */}
              <div className="tabs" role="tablist" aria-label="Atendimento do protocolo">
                {ABAS.map((t, i) => (
                  <button
                    key={t.id}
                    ref={(el) => { abasRef.current[i] = el; }}
                    className="tab"
                    role="tab"
                    id={`aba-${t.id}`}
                    aria-selected={aba === t.id}
                    aria-controls={`painel-${t.id}`}
                    tabIndex={aba === t.id ? 0 : -1}
                    onKeyDown={(e) => navegarAbas(e, i)}
                    onClick={() => setAba(t.id)}
                  >
                    {t.rotulo}
                  </button>
                ))}
              </div>

              {aba === 'dados' && (
                <div role="tabpanel" id="painel-dados" aria-labelledby="aba-dados" tabIndex={0}>
                  {titular ? (
                    <>
                      <Didatico>
                        <Nota tom="warn">
                          Nenhum valor abaixo foi carregado ainda — o servidor só envia o campo que você abrir,
                          com finalidade declarada e sob o protocolo {foco.protocolo}, e o registro é gravado
                          antes da resposta.
                        </Nota>
                      </Didatico>
                      <div className="grid g2" style={{ marginTop: 14 }}>
                        {grupos.map((grupo) => (
                          <div className="card" style={{ background: 'var(--surface-2)' }} key={grupo}>
                            <div className="card-head"><h3 style={{ fontSize: 14 }}>{grupo}</h3></div>
                            <dl className="kv">
                              {titular.campos.filter((c) => c.grupo === grupo).map((c) => (
                                <div key={c.chave} style={{ display: 'contents' }}>
                                  <dt>{c.rotulo}</dt>
                                  <dd>
                                    <CampoPII
                                      titularId={titular.id}
                                      chave={c.chave}
                                      rotulo={c.rotulo}
                                      mascara={c.mascara}
                                      sensivel={c.sensivel}
                                    />
                                    {c.sensivel && (
                                      <div className="hint" style={{ marginTop: 4 }}>
                                        base legal {c.baseLegal} · destruição por cripto-shredding
                                      </div>
                                    )}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        ))}
                        <div className="card" style={{ background: 'var(--surface-2)' }}>
                          <div className="card-head"><h3 style={{ fontSize: 14 }}>Portabilidade</h3></div>
                          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-2)' }}>
                            Gera pacote assinado com link expirável em 24 h, para um titular por vez.
                            Não existe exportação em massa nesta interface.
                          </p>
                          <div className="row">
                            {/* C-15 — os três formatos comunicam o desenho da
                                portabilidade, mas nenhum deles gera arquivo.
                                Ficam marcados: rótulo que promete o que o clique
                                não faz é o começo da desconfiança no resto. */}
                            <Permitido acao="escrever" alternativa={<Pill tom="neutral">somente leitura</Pill>}>
                              <NaoImplementado nota="O pacote de portabilidade não é gerado neste protótipo">
                                <button className="btn" disabled>JSON</button>
                                <button className="btn" disabled>CSV</button>
                                <button className="btn" disabled>PDF declaratório</button>
                              </NaoImplementado>
                            </Permitido>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : <Nota>Titular do protocolo não localizado neste cenário.</Nota>}
                </div>
              )}

              {aba === 'compart' && (
                <div role="tabpanel" id="painel-compart" aria-labelledby="aba-compart" tabIndex={0}>
                  <Nota>Resposta construída a partir da tabela de linhagem, que é append-only. Não é lista mantida à mão.</Nota>
                  <Tabela cabecalho={['Destino', 'Finalidade', 'Base legal', 'Transferência', 'Última remessa']}>
                    {(titular?.compartilhamentos ?? []).map((c) => (
                      <tr key={c.destino}>
                        <td>{c.destino}</td>
                        <td>{c.finalidade}</td>
                        <td className="mono" style={{ fontSize: 12.5 }}>{c.baseLegal}</td>
                        <td>{c.internacional
                          ? <Pill tom="warn">🌎 {c.mecanismo === 'clausulas_padrao_anpd' ? 'SCC ANPD' : c.mecanismo}</Pill>
                          : <Pill tom="neutral">nacional</Pill>}</td>
                        <td className="num">{c.ultimaRemessa}</td>
                      </tr>
                    ))}
                  </Tabela>
                </div>
              )}

              {aba === 'revisao' && (
                <div role="tabpanel" id="painel-revisao" aria-labelledby="aba-revisao" tabIndex={0}>
                  {titular?.decisao ? <PainelRevisao titularId={titular.id} /> : <Nota>Este titular não tem decisão automatizada registrada.</Nota>}
                </div>
              )}

              {aba === 'mensagens' && (
                <div role="tabpanel" id="painel-mensagens" aria-labelledby="aba-mensagens" tabIndex={0}>
                  <div className="stack" style={{ gap: 10 }}>
                    {foco.mensagens.map((m, i) => (
                      <div key={i} className={`msg ${m.remetente === 'dpo' ? 'us' : 'them'}`}>
                        <span className="who">{m.remetente} · {m.quando}</span>
                        {m.corpo}
                      </div>
                    ))}
                    <Permitido acao="escrever" alternativa={<Nota>Somente leitura para este papel.</Nota>}>
                      <div className="row">
                        <input
                          type="text"
                          style={{ flex: 1, minWidth: 220 }}
                          placeholder="Escrever ao titular…"
                          value={rascunho}
                          onChange={(e) => setRascunho(e.target.value)}
                        />
                        <button className="btn primary" onClick={enviarMensagem} disabled={!rascunho.trim()}>Enviar</button>
                      </div>
                    </Permitido>
                    <Nota>
                      A conversa fica dentro da plataforma. Tente enviar um CPF na mensagem: o canal recusa —
                      a mesma restrição existe no banco, não só no formulário.
                    </Nota>
                  </div>
                </div>
              )}
            </Cartao>

            <div className="stack">
              <PainelConclusao solicitacao={foco} />

              {/* C-01 — mesma porta da T2. Fechar uma e deixar a outra aberta seria
                  fechar a porta e esquecer a janela. */}
              <Permitido
                acao="buscar_titular"
                alternativa={
                  <Cartao titulo="Buscar titular">
                    <Nota>
                      Localizar um titular pelo documento pertence ao DPO. O seu papel acompanha a fila e os
                      prazos, mas não recebe este campo — e a rota recusa a busca mesmo fora da tela.
                    </Nota>
                  </Cartao>
                }
              >
                <Cartao titulo="Buscar titular">
                  <div className="field">
                    <label htmlFor="t4-cpf">CPF</label>
                    <input
                      id="t4-cpf"
                      type="text"
                      value={cpf}
                      onChange={(e) => setCpf(e.target.value)}
                      placeholder="•••.•••.•••-••"
                      autoComplete="off"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label htmlFor="t4-finalidade">Finalidade da busca</label>
                    <select id="t4-finalidade" value={finalidadeBusca} onChange={(e) => setFinalidadeBusca(e.target.value as Finalidade | '')}>
                      <option value="">Selecione…</option>
                      <option value="atendimento">atendimento — localizar solicitação do titular</option>
                      <option value="cobranca">cobranca — negociação de dívida</option>
                      <option value="auditoria">auditoria — verificação de conformidade</option>
                    </select>
                  </div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <button
                      className="btn primary"
                      style={{ width: '100%', justifyContent: 'center' }}
                      onClick={identificar}
                      disabled={cpf.replace(/\D/g, '').length < 11 || !finalidadeBusca}
                    >
                      Identificar com autenticação forte
                    </button>
                  </div>
                  {ultimoHash && (
                    <p className="hash" style={{ marginTop: 8 }}>
                      hash consultado: {ultimoHash}… · o documento saiu da sessão
                    </p>
                  )}
                  <Nota>
                    A busca envia apenas o <b>hash</b> do CPF, com a finalidade declarada e registro no audit
                    trail antes da resposta. O resultado <b>seleciona a solicitação</b> daquele titular — a
                    ficha nunca troca por baixo do protocolo em atendimento.
                  </Nota>
                </Cartao>
              </Permitido>

              <Cartao titulo="Distribuição do mês">
                {Object.entries(
                  solicitacoes.reduce<Record<string, number>>((acc, s) => {
                    acc[s.direito] = (acc[s.direito] ?? 0) + 1;
                    return acc;
                  }, {}),
                ).map(([direito, n]) => (
                  <div key={direito} style={{ marginBottom: 9 }}>
                    <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
                      <span>{ROTULO_DIREITO[direito]}</span>
                      <span className="mono">{n}</span>
                    </div>
                    <div className="meter"><i style={{ width: `${(n / solicitacoes.length) * 100}%` }} /></div>
                  </div>
                ))}
              </Cartao>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/**
 * T4-02 — o ato de encerrar o atendimento.
 *
 * Sem ele a fila só crescia: nenhuma solicitação saía de "em análise", o
 * cronômetro corria para sempre e o indicador de SLA media coisas que ninguém
 * podia terminar. Recusar exige fundamento, porque negar um direito sem dizer
 * por quê não dá ao titular o que contestar (Art. 18, §4º).
 */
function PainelConclusao({ solicitacao }: { solicitacao: Solicitacao }) {
  const chamar = useSessao((s) => s.chamar);
  useSessao((s) => s.versao);
  const [desfecho, setDesfecho] = useState<DesfechoSolicitacao>('atendido');
  const [evidencia, setEvidencia] = useState('');
  const [retidos, setRetidos] = useState<RetidoEmEdicao[]>([]);

  const encerrado = encerrada(solicitacao);
  const previa = redigir(evidencia);
  const exigeFundamento = desfecho === 'recusado_com_fundamento';
  /**
   * PR 16 — parcial e recusa passam a exigir a lista do que ficou.
   *
   * O painel não ganhou tela nova: ganhou as três colunas que faltavam para o
   * DPO conseguir responder o que a tela 07 do portal mostra ao titular. Sem
   * elas, o botão só saberia produzir um 422 — e a regra nova viraria um
   * obstáculo em vez de um caminho.
   */
  const exigeRetidos = desfecho !== 'atendido';
  const retidosValidos = retidos.length > 0
    && retidos.every((r) => r.item.trim() && r.baseLegal && /^\d{4}-\d{2}-\d{2}$/.test(r.retencaoAte));

  const concluir = () => {
    const res = chamar({
      metodo: 'POST', caminho: `/v1/requests/${solicitacao.id}/concluir`,
      body: {
        desfecho,
        evidencia,
        ...(exigeRetidos
          ? {
            retidos: retidos.map((r) => ({
              item: r.item, base_legal: r.baseLegal, artigo: r.artigo || undefined,
              retencao_ate: r.retencaoAte,
            })),
          }
          : {}),
      },
    });
    if (res.status === 200) { setEvidencia(''); setRetidos([]); }
  };

  if (encerrado) {
    const noPrazo = (solicitacao.concluidaEmMs ?? 0) <= solicitacao.prazoLimiteMs;
    return (
      <Cartao titulo="Atendimento encerrado">
        <p style={{ margin: 0, fontSize: 13 }}>
          {solicitacao.desfecho ? ROTULO_DESFECHO[solicitacao.desfecho] : solicitacao.status} em
          {' '}<span className="mono">{solicitacao.concluidaEm}</span>{' '}
          <Pill tom={noPrazo ? 'ok' : 'warn'}>{noPrazo ? 'dentro do prazo' : 'fora do prazo'}</Pill>
        </p>
        {solicitacao.fundamento && (
          <p className="hint" style={{ marginTop: 8 }}>Fundamento registrado: {solicitacao.fundamento}</p>
        )}
        <Nota>
          A conclusão é um evento no audit trail, não um campo editável. Reabrir é solicitação nova.
        </Nota>
      </Cartao>
    );
  }

  return (
    <Permitido
      acao="concluir_solicitacao"
      alternativa={
        <Cartao titulo="Concluir atendimento">
          <Nota>
            Encerrar a solicitação é ato do DPO — quem responde pelo prazo. O seu papel acompanha a fila,
            e nenhum controle de conclusão é montado nesta sessão.
          </Nota>
        </Cartao>
      }
    >
      <Cartao titulo="Concluir atendimento">
        <div className="field">
          <label htmlFor="cc-desfecho">Desfecho</label>
          <select id="cc-desfecho" value={desfecho} onChange={(e) => setDesfecho(e.target.value as DesfechoSolicitacao)}>
            {(Object.keys(ROTULO_DESFECHO) as DesfechoSolicitacao[]).map((d) => (
              <option key={d} value={d}>{ROTULO_DESFECHO[d]}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="cc-evid">
            {exigeFundamento ? 'Fundamento da recusa (mínimo 20 caracteres)' : 'Evidência do atendimento (opcional)'}
          </label>
          <textarea
            id="cc-evid"
            value={evidencia}
            onChange={(e) => setEvidencia(e.target.value)}
            placeholder={exigeFundamento
              ? 'Ex.: guarda obrigatória de 5 anos por obrigação legal fiscal impede a eliminação neste momento.'
              : 'Ex.: pacote de portabilidade gerado e retirado pelo titular.'}
          />
          {exigeFundamento && <span className="hint">{evidencia.trim().length}/20</span>}
        </div>
        {previa.houveRemocao && (
          <Nota tom="warn">
            O texto contém {resumoDaRedacao(previa.achados)} — será gravado assim:
            {' '}<span className="mono">{previa.texto}</span>
          </Nota>
        )}
        {exigeRetidos && (
          <div style={{ marginTop: 12 }}>
            <label>O que ficou retido</label>
            <p className="hint" style={{ marginTop: 2 }}>
              Um item por linha, com a lei que sustenta a retenção e a data em que ele é eliminado.
              É exatamente o que o titular vê — “parte foi retida por obrigação legal” não é resposta,
              é reticência.
            </p>
            {retidos.map((r, i) => (
              <div className="row" key={i} style={{ gap: 6, marginTop: 6, alignItems: 'flex-start' }}>
                <input
                  aria-label={`Item retido ${i + 1}`}
                  placeholder="Ex.: notas fiscais das suas compras"
                  value={r.item}
                  onChange={(e) => atualizar(setRetidos, i, { item: e.target.value })}
                  style={{ flex: 2 }}
                />
                <select
                  aria-label={`Base legal do item ${i + 1}`}
                  value={r.baseLegal}
                  onChange={(e) => atualizar(setRetidos, i, { baseLegal: e.target.value as BaseLegal })}
                  style={{ flex: 1 }}
                >
                  {BASES_LEGAIS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <input
                  aria-label={`Retenção até, item ${i + 1}`}
                  type="date"
                  value={r.retencaoAte}
                  onChange={(e) => atualizar(setRetidos, i, { retencaoAte: e.target.value })}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn"
                  aria-label={`Remover item ${i + 1}`}
                  onClick={() => setRetidos((v) => v.filter((_, j) => j !== i))}
                >
                  −
                </button>
              </div>
            ))}
            <button
              className="btn"
              style={{ marginTop: 6 }}
              onClick={() => setRetidos((v) => [...v, {
                item: '', baseLegal: 'obrigacao_legal', artigo: '', retencaoAte: '',
              }])}
            >
              + item retido
            </button>
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={(exigeFundamento && evidencia.trim().length < 20)
              || (exigeRetidos && !retidosValidos)}
            onClick={concluir}
          >
            Registrar conclusão
          </button>
        </div>
        <Nota>
          A conclusão para o cronômetro do SLA e entra no audit trail antes de a resposta voltar.
          O indicador acima passa a contar esta solicitação.
        </Nota>
      </Cartao>
    </Permitido>
  );
}

/**
 * T4-03 — revisão de decisão automatizada com prova (Art. 20).
 *
 * O seletor antigo não mandava nada a lugar nenhum: escolher "Reverter" mudava
 * o estado de um `<select>` e mais nada. Direito à revisão que não deixa rastro
 * é indistinguível de direito não atendido.
 */
function PainelRevisao({ titularId }: { titularId: string }) {
  const banco = useSessao((s) => s.banco);
  const chamar = useSessao((s) => s.chamar);
  useSessao((s) => s.versao);
  const [resultado, setResultado] = useState<ResultadoRevisao>('mantida');
  const [fundamento, setFundamento] = useState('');

  const decisao = banco.cenario.titulares.find((t) => t.id === titularId)?.decisao;
  if (!decisao) return <Nota>Este titular não tem decisão automatizada registrada.</Nota>;

  const previa = redigir(fundamento);

  const revisar = () => {
    const res = chamar({
      metodo: 'POST', caminho: `/v1/decisoes/${decisao.id}/revisar`,
      body: { resultado, fundamento },
    });
    if (res.status === 200) setFundamento('');
  };

  return (
    <>
      <div className="banner crit" style={{ marginBottom: 14 }}>
        <span className="mark">⚖</span>
        <div>
          <h4>Decisão automatizada contestada</h4>
          <p>
            Resultado {decisao.aprovado ? 'aprovado' : 'reprovado'} pelo modelo
            {' '}<span className="mono">{decisao.modelo}</span>. O analista abaixo pode reverter de fato,
            não apenas homologar.
          </p>
        </div>
      </div>
      <h4 style={{ fontSize: 14, marginBottom: 8 }}>Fatores que pesaram</h4>
      <div className="stack" style={{ gap: 8 }}>
        {decisao.shap.map((f) => (
          <div key={f.feature}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12.5 }}>{f.feature}</span>
              <span className="mono" style={{ color: f.impacto < 0 ? 'var(--crit)' : 'var(--ok)' }}>
                {f.impacto > 0 ? '+' : ''}{f.impacto.toFixed(2)}
              </span>
            </div>
            <div className="meter">
              <i className={f.impacto < 0 ? 'crit' : 'ok'} style={{ width: `${Math.abs(f.impacto) * 200}%` }} />
            </div>
          </div>
        ))}
      </div>
      <Nota>
        Nenhuma feature de CEP, nome ou canal de atendimento entra no modelo — foram removidas por serem
        proxy discriminatório.
      </Nota>

      {decisao.revisao ? (
        <Nota tom="warn">
          Revisão já registrada: decisão <b>{decisao.revisao.resultado}</b> por {decisao.revisao.revisadaPor}.
          {' '}Fundamento: {decisao.revisao.fundamento}. A devolutiva foi enviada ao titular no mesmo ato,
          e o registro está no audit trail — rever de novo é solicitação nova.
        </Nota>
      ) : (
        <Permitido acao="revisar_decisao" alternativa={<Nota tom="warn">Rever decisão automatizada é ato do DPO, que responde pelo resultado.</Nota>}>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="rev-dec">Decisão do analista</label>
            <select id="rev-dec" value={resultado} onChange={(e) => setResultado(e.target.value as ResultadoRevisao)}>
              <option value="mantida">Manter o resultado</option>
              <option value="revertida">Reverter</option>
              <option value="ajustada">Aprovar com limite reduzido</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="rev-fund">Fundamento da revisão (mínimo 20 caracteres)</label>
            <textarea
              id="rev-fund"
              value={fundamento}
              onChange={(e) => setFundamento(e.target.value)}
              placeholder="Ex.: comprovante de renda apresentado pelo titular não estava na base no momento da decisão."
            />
            <span className="hint">{fundamento.trim().length}/20</span>
          </div>
          {previa.houveRemocao && (
            <Nota tom="warn">
              O fundamento contém {resumoDaRedacao(previa.achados)} — será gravado assim:
              {' '}<span className="mono">{previa.texto}</span>
            </Nota>
          )}
          <div className="row">
            <button className="btn primary" disabled={fundamento.trim().length < 20} onClick={revisar}>
              Registrar revisão e responder ao titular
            </button>
          </div>
          <Nota>
            Manter o resultado também é decisão humana e também exige fundamento: sem razão registrada,
            a revisão é homologação com outro nome.
          </Nota>
        </Permitido>
      )}
    </>
  );
}

function formatarRestante(ms: number): string {
  if (ms <= 0) return 'prazo estourado';
  const dias = Math.floor(ms / DIA);
  const horas = Math.floor((ms % DIA) / 3_600_000);
  return dias > 0 ? `${dias} d ${String(horas).padStart(2, '0')} h restantes` : `${horas} h restantes`;
}
