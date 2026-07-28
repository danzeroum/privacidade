import { useState } from 'react';
import { CampoPII, Cabecalho, Cartao, Nota, Permitido, Pill, Tabela } from '../ui/primitivos';
import { useSessao } from '../store/sessao';
import { hashCpf, curto } from '../lib/sha256';
import { pode } from '../mock/permissoes';

const DIA = 86_400_000;

const ROTULO_DIREITO: Record<string, string> = {
  confirmacao: 'Confirmação (I)', acesso: 'Acesso (II)', correcao: 'Correção (III)',
  anonimizacao: 'Anonimização (IV)', bloqueio: 'Bloqueio (IV)', eliminacao: 'Eliminação (VI)',
  portabilidade: 'Portabilidade (V)', compartilhamentos: 'Compartilhamentos (VII)',
  revogacao: 'Revogação (VIII)', revisao_decisao: 'Revisão de decisão (Art. 20)',
};

export default function T4() {
  const banco = useSessao((s) => s.banco);
  const chamar = useSessao((s) => s.chamar);
  const papel = useSessao((s) => s.papel);
  useSessao((s) => s.versao);

  const [aba, setAba] = useState<'dados' | 'compart' | 'revisao' | 'mensagens'>('dados');
  const [cpf, setCpf] = useState('');
  const [identificado, setIdentificado] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState('');

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

  const solicitacoes = banco.cenario.solicitacoes;
  const foco = solicitacoes[0];
  const titular = banco.cenario.titulares.find((t) => t.id === (identificado ?? foco.titularId));
  const concluidas = solicitacoes.filter((s) => s.status === 'concluida');
  const noSla = concluidas.filter((s) => s.prazoLimiteMs > Date.now() - 30 * DIA).length;

  const identificar = () => {
    const res = chamar<{ id: string }>({
      metodo: 'POST', caminho: '/v1/titulares/buscar', body: { cpfHash: hashCpf(cpf) },
    });
    if (res.status === 200) setIdentificado(res.body.id);
  };

  const enviarMensagem = () => {
    const res = chamar({ metodo: 'POST', caminho: `/v1/requests/${foco.id}/mensagens`, body: { corpo: rascunho } });
    if (res.status === 200) setRascunho('');
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
          <span className="kpi-val">{concluidas.length ? Math.round((noSla / concluidas.length) * 100) : 100}<small>%</small></span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">A menos de 24 h do prazo</span>
          <span className="kpi-val" style={{ color: 'var(--warn)' }}>
            {solicitacoes.filter((s) => s.status !== 'concluida' && s.prazoLimiteMs - Date.now() < DIA).length}
          </span>
          <span className="kpi-foot">DPO notificado automaticamente</span>
        </div>
      </div>

      <div className="sec-title">Fila de atendimento</div>
      <Cartao>
        <Tabela cabecalho={['Protocolo', 'Direito', 'Titular', 'Sistemas', 'SLA', 'Status']}>
          {solicitacoes.map((s) => {
            const restante = s.prazoLimiteMs - Date.now();
            const urgente = restante < DIA && s.status !== 'concluida';
            return (
              <tr key={s.id}>
                <td className="mono">{s.protocolo}</td>
                <td>{ROTULO_DIREITO[s.direito]}</td>
                <td className="mono" style={{ fontSize: 11.5 }}>{s.titularPseudonimo}</td>
                <td className="hint">{s.sistemas.length} sistema{s.sistemas.length === 1 ? '' : 's'}</td>
                <td style={{ minWidth: 170 }}>
                  {s.status === 'concluida'
                    ? <span style={{ color: 'var(--ok)', fontSize: 12 }}>concluída</span>
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
                  <Pill tom={s.status === 'concluida' ? 'ok' : s.status === 'em_analise' ? 'warn' : 'neutral'}>
                    {s.status.replace('_', ' ')}
                  </Pill>
                  {s.nivelVerificacao === 3 && <div><Pill tom="crit">verificação elevada</Pill></div>}
                </td>
              </tr>
            );
          })}
        </Tabela>
      </Cartao>

      <div className="sec-title">Protocolo {foco.protocolo} · {ROTULO_DIREITO[foco.direito].toLowerCase()}</div>
      <div className="grid g-2-1">
        <Cartao>
          <div className="tabs" role="tablist">
            {([['dados', 'Dados do titular'], ['compart', 'Compartilhamentos'], ['revisao', 'Revisão de decisão'], ['mensagens', 'Mensagens']] as const)
              .map(([id, rotulo]) => (
                <button key={id} className="tab" role="tab" aria-selected={aba === id} onClick={() => setAba(id)}>{rotulo}</button>
              ))}
          </div>

          {aba === 'dados' && titular && (
            <>
              <Nota tom="warn">
                Nenhum valor abaixo foi carregado ainda — o servidor só envia o campo que você abrir,
                com finalidade declarada, e o registro é gravado antes da resposta.
              </Nota>
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
                    <Permitido acao="escrever" alternativa={<Pill tom="neutral">somente leitura</Pill>}>
                      <button className="btn">JSON</button>
                      <button className="btn">CSV</button>
                      <button className="btn">PDF declaratório</button>
                    </Permitido>
                  </div>
                </div>
              </div>
            </>
          )}

          {aba === 'compart' && titular && (
            <>
              <Nota>Resposta construída a partir da tabela de linhagem, que é append-only. Não é lista mantida à mão.</Nota>
              <Tabela cabecalho={['Destino', 'Finalidade', 'Base legal', 'Transferência', 'Última remessa']}>
                {titular.compartilhamentos.map((c) => (
                  <tr key={c.destino}>
                    <td>{c.destino}</td>
                    <td>{c.finalidade}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{c.baseLegal}</td>
                    <td>{c.internacional
                      ? <Pill tom="warn">🌎 {c.mecanismo === 'clausulas_padrao_anpd' ? 'SCC ANPD' : c.mecanismo}</Pill>
                      : <Pill tom="neutral">nacional</Pill>}</td>
                    <td className="num">{c.ultimaRemessa}</td>
                  </tr>
                ))}
              </Tabela>
            </>
          )}

          {aba === 'revisao' && (
            titular?.decisao ? (
              <>
                <div className="banner crit" style={{ marginBottom: 14 }}>
                  <span className="mark">⚖</span>
                  <div>
                    <h4>Decisão automatizada contestada</h4>
                    <p>
                      Resultado {titular.decisao.aprovado ? 'aprovado' : 'reprovado'} pelo modelo
                      {' '}<span className="mono">{titular.decisao.modelo}</span>. O analista abaixo pode reverter de fato,
                      não apenas homologar.
                    </p>
                  </div>
                </div>
                <h4 style={{ fontSize: 14, marginBottom: 8 }}>Fatores que pesaram</h4>
                <div className="stack" style={{ gap: 8 }}>
                  {titular.decisao.shap.map((f) => (
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
                <Permitido acao="revelar_pii" alternativa={<Nota tom="warn">Reverter decisão é ação do DPO.</Nota>}>
                  <div className="field" style={{ marginTop: 12 }}>
                    <label htmlFor="rev-dec">Decisão do analista</label>
                    <select id="rev-dec">
                      <option>Manter o resultado</option>
                      <option>Reverter</option>
                      <option>Aprovar com limite reduzido</option>
                    </select>
                  </div>
                </Permitido>
              </>
            ) : <Nota>Este titular não tem decisão automatizada registrada.</Nota>
          )}

          {aba === 'mensagens' && (
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
          )}
        </Cartao>

        <div className="stack">
          <Cartao titulo="Buscar titular">
            <div className="field">
              <label htmlFor="t4-cpf">CPF</label>
              <input id="t4-cpf" type="text" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="•••.•••.•••-••" />
            </div>
            {cpf.replace(/\D/g, '').length >= 11 && (
              <p className="hash" style={{ marginTop: 8 }}>hash enviado: {curto(hashCpf(cpf), 20)}</p>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={identificar}
                disabled={cpf.replace(/\D/g, '').length < 11}
              >
                Identificar com autenticação forte
              </button>
            </div>
            {identificado && <p className="mono" style={{ marginTop: 8 }}>titular {identificado} carregado</p>}
            <Nota>
              A busca envia apenas o <b>hash</b> do CPF. O documento digitado nunca entra na URL, no histórico
              do navegador nem no log do gateway.
            </Nota>
          </Cartao>

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
  );
}

function formatarRestante(ms: number): string {
  if (ms <= 0) return 'prazo estourado';
  const dias = Math.floor(ms / DIA);
  const horas = Math.floor((ms % DIA) / 3_600_000);
  return dias > 0 ? `${dias} d ${String(horas).padStart(2, '0')} h restantes` : `${horas} h restantes`;
}
