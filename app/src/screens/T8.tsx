import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cabecalho, Cartao, Didatico, Nota, Permitido, Pill, Recusa, Tabela } from '../ui/primitivos';
import { useSessao } from '../store/sessao';
import { vereditoBalanceamento } from '../mock/api';
import { sha256, curto } from '../lib/sha256';

export default function T8() {
  const banco = useSessao((s) => s.banco);
  const chamar = useSessao((s) => s.chamar);
  useSessao((s) => s.versao);

  const lia = banco.cenario.lias[0];
  const [beneficio, setBeneficio] = useState(lia?.beneficio ?? 2);
  const [dano, setDano] = useState(lia?.danoTitular ?? 2);
  const [doc, setDoc] = useState<string | null>(null);
  /**
   * T8-03 — a tela pré-selecionava justamente o campo que ela mesma ia recusar.
   * A demonstração da regra do Art. 11 continua disponível, mas escolhida por
   * quem opera; o padrão é o primeiro campo elegível.
   */
  const [campoParaVincular, setCampoParaVincular] = useState(
    banco.cenario.campos.find((c) => !c.sensivel)?.id ?? banco.cenario.campos[0]?.id ?? '',
  );
  // T8-01 — o Passo 1 tinha `defaultValue` sem `onChange`: parecia editor e era
  // vitrine. Agora edita de verdade para quem assina, e é leitura para os demais.
  const [categoria, setCategoria] = useState(lia?.categoria ?? '');
  const [expectativa, setExpectativa] = useState(lia?.expectativa ?? 'media');
  const [finalidadeTexto, setFinalidadeTexto] = useState(lia?.finalidade ?? '');
  // T8-02 — o veredito saía de dois números e nada mais. O raciocínio de cada
  // eixo passa a ser escrito e guardado junto.
  const [razaoBeneficio, setRazaoBeneficio] = useState('');
  const [razaoDano, setRazaoDano] = useState('');
  const [anexos, setAnexos] = useState<{ arquivo: string; hash: string }[]>([]);

  if (!lia) return <Nota>Este cenário não tem LIA cadastrada.</Nota>;

  const veredito = vereditoBalanceamento(beneficio, dano);
  const vinculados = lia.camposIds
    .map((id) => banco.cenario.campos.find((c) => c.id === id))
    .filter(Boolean);

  const vincular = () => {
    chamar({ metodo: 'POST', caminho: `/v1/lias/${lia.id}/campos`, body: { campoId: campoParaVincular } }, 'lia-vincular');
  };

  const campoAlvo = banco.cenario.campos.find((c) => c.id === campoParaVincular);
  // O veredito não flutua: ele se apoia nas mitigações ativas do threat model.
  const mitigacoesQueSustentam = (banco.cenario.ripds[0]?.linddun ?? [])
    .filter((l) => l.ativo).map((l) => l.rotulo);
  const balanceamentoFundamentado = razaoBeneficio.trim().length >= 20 && razaoDano.trim().length >= 20;

  const assinar = () => {
    const res = chamar<{ markdown: string }>({ metodo: 'POST', caminho: `/v1/lias/${lia.id}/assinar` }, 'lia-assinar');
    if (res.status === 200) setDoc(res.body.markdown);
  };

  const anexar = (nomes: string[]) => {
    setAnexos((a) => [...a, ...nomes.map((n) => ({ arquivo: n, hash: sha256(`${n}:${a.length}`).slice(0, 16) }))]);
  };

  return (
    <>
      <Cabecalho
        fontes={['LIA.md', 'Art. 7º, IX']}
        titulo="Editor de LIA"
        resumo="Legítimo interesse não se afirma, se demonstra. Três passos, evidência anexada e assinatura do DPO — sem isso o catálogo recusa a base legal."
        nota={{
          engenharia: 'Sem LIA vigente o campo de legítimo interesse é recusado na gravação do catálogo — não é aviso, é erro.',
          dpo: 'Os três passos são a prova que a ANPD pede. O documento sai com hash e a sua assinatura.',
          produto: 'Se o balanceamento não sustenta, a saída não é insistir: é reduzir escopo ou trocar a base legal.',
          seguranca: 'As evidências anexadas têm hash — é o que liga a política declarada à configuração real.',
          auditor: 'Somente leitura. O documento assinado e o hash ficam no rodapé.',
        }}
      />

      <div className="grid g-2-1">
        <Cartao
          titulo={lia.codigo}
          acao={
            <Pill tom={lia.status === 'vigente' ? 'ok' : lia.status === 'vencida' ? 'crit' : 'neutral'}>
              {lia.status === 'vencida'
                ? `vencida há ${Math.abs(lia.diasParaVencer)} dias`
                : `${lia.status} até ${lia.vigenciaFim}`}
            </Pill>
          }
        >
          {lia.status === 'vencida' && (
            <div className="banner crit" style={{ marginBottom: 16 }}>
              <span className="mark">⏰</span>
              <div>
                <h4>LIA vencida — os campos vinculados perderam base legal</h4>
                <p>
                  O gate de CI passa a bloquear qualquer PR que toque esses campos. Renovar não é burocracia:
                  é o que devolve a base legal ao tratamento que já está em produção.
                </p>
              </div>
            </div>
          )}

          <div className="stepper">
            <Passo n={1} titulo="Finalidade legítima" desc="O interesse precisa ser real, presente e específico — não uma conveniência futura." feito={finalidadeTexto.trim().length > 0}>
              <Permitido
                acao="assinar_lia"
                alternativa={
                  <>
                    <dl className="kv">
                      <dt>Categoria</dt><dd>{categoria}</dd>
                      <dt>Expectativa</dt><dd>{expectativa}</dd>
                      <dt>Descrição</dt><dd>{finalidadeTexto}</dd>
                    </dl>
                    <span className="hint">somente leitura para o seu papel — quem assina a LIA é quem a edita</span>
                  </>
                }
              >
                <div className="grid g2" style={{ gap: 11 }}>
                  <div className="field">
                    <label htmlFor="lia-cat">Categoria</label>
                    <select id="lia-cat" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                      {['Análise de crédito', 'Prevenção de fraude', 'Segurança da informação', 'Melhoria de produto', 'Marketing direto']
                        .map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="lia-exp">Expectativa do titular</label>
                    <select id="lia-exp" value={expectativa} onChange={(e) => setExpectativa(e.target.value as typeof expectativa)}>
                      <option value="alta">alta — decorre diretamente do serviço</option>
                      <option value="media">média — declarada no aviso de privacidade</option>
                      <option value="baixa">baixa — exigiria comunicação ativa</option>
                    </select>
                  </div>
                </div>
                <div className="field" style={{ marginTop: 11 }}>
                  <label htmlFor="lia-fin">Descrição</label>
                  <textarea id="lia-fin" value={finalidadeTexto} onChange={(e) => setFinalidadeTexto(e.target.value)} />
                </div>
                {expectativa === 'baixa' && (
                  <p className="note warn" role="status" style={{ marginTop: 10 }}>
                    Expectativa baixa não invalida a LIA, mas exige comunicação ativa ao titular — e é o
                    ponto que a ANPD examina primeiro no balanceamento.
                  </p>
                )}
              </Permitido>
            </Passo>

            <Passo n={2} titulo="Necessidade" desc='Cada alternativa menos invasiva precisa ser respondida. "Não aplicável" também exige justificativa.' feito>
              {lia.alternativas.map((a) => (
                <div className="ck" key={a.alternativa}>
                  <span>
                    <span className="ck-name">{a.alternativa}</span>
                    <span className="ck-just">{a.justificativa}</span>
                  </span>
                  <Pill tom={a.situacao === 'atendido' ? 'ok' : a.situacao === 'rejeitado' ? 'crit' : 'neutral'}>
                    {a.situacao === 'nao_aplicavel' ? 'não aplicável' : a.situacao}
                  </Pill>
                </div>
              ))}
            </Passo>

            <Passo n={3} titulo="Balanceamento" desc="Benefício para o controlador × dano ao titular. O veredito é escrito, não um número." feito={balanceamentoFundamentado}>
              <div className="grid g2" style={{ gap: 18 }}>
                <div>
                  <div className="bal">
                    {[3, 2, 1].flatMap((b) => [1, 2, 3].map((d) => {
                      const dif = b - d;
                      const ativo = b === beneficio && d === dano;
                      return (
                        <button
                          key={`${b}-${d}`}
                          className={`bal-cell bal-${dif >= 2 ? 1 : dif >= 0 ? 2 : 3} ${ativo ? 'on' : ''}`}
                          style={{ cursor: 'pointer', font: 'inherit' }}
                          title={`benefício ${b} × dano ${d}`}
                          onClick={() => { setBeneficio(b as 1 | 2 | 3); setDano(d as 1 | 2 | 3); }}
                        >
                          {ativo ? 'aqui' : ''}
                        </button>
                      );
                    }))}
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 6, fontSize: 12.5, color: 'var(--text-3)' }}>
                    <span>← menor dano</span><span>maior dano →</span>
                  </div>
                </div>
                <div>
                  <div className="field">
                    <label htmlFor="lia-slider">Posição do risco</label>
                    <input
                      id="lia-slider" type="range" min={1} max={9} style={{ width: '100%' }}
                      value={(3 - beneficio) * 3 + dano}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        const linha = Math.ceil(v / 3);
                        setBeneficio((4 - linha) as 1 | 2 | 3);
                        setDano((((v - 1) % 3) + 1) as 1 | 2 | 3);
                      }}
                    />
                  </div>
                  <p className={`note ${veredito.chave === 'sustenta' ? '' : veredito.chave === 'mitigacao' ? 'warn' : 'crit'}`}
                     style={{ marginTop: 10 }} role="status">
                    <b>{veredito.titulo}.</b> {veredito.texto}
                  </p>
                </div>
              </div>

              {/* T8-02 — o veredito saía de dois números e nada mais. Um
                  balanceamento é a razão de cada lado; sem ela, o quadrado
                  clicado é opinião com aparência de método. */}
              <Permitido acao="assinar_lia" alternativa={
                <dl className="kv" style={{ marginTop: 12 }}>
                  <dt>Razão do benefício</dt><dd>{razaoBeneficio || '— não preenchida'}</dd>
                  <dt>Razão do dano</dt><dd>{razaoDano || '— não preenchida'}</dd>
                </dl>
              }>
                <div className="grid g2" style={{ gap: 11, marginTop: 12 }}>
                  <div className="field">
                    <label htmlFor="lia-rb">Por que o benefício é {beneficio === 3 ? 'alto' : beneficio === 2 ? 'médio' : 'baixo'} (mín. 20)</label>
                    <textarea id="lia-rb" value={razaoBeneficio} onChange={(e) => setRazaoBeneficio(e.target.value)}
                      placeholder="Ex.: reduz inadimplência em 18% na safra medida, com efeito direto no preço ao cliente adimplente." />
                    <span className="hint">{razaoBeneficio.trim().length}/20</span>
                  </div>
                  <div className="field">
                    <label htmlFor="lia-rd">Por que o dano é {dano === 3 ? 'alto' : dano === 2 ? 'médio' : 'baixo'} (mín. 20)</label>
                    <textarea id="lia-rd" value={razaoDano} onChange={(e) => setRazaoDano(e.target.value)}
                      placeholder="Ex.: dado pseudonimizado, retenção de 180 dias e oposição em um clique no aviso de privacidade." />
                    <span className="hint">{razaoDano.trim().length}/20</span>
                  </div>
                </div>
                {!balanceamentoFundamentado && (
                  <p className="note warn" role="status" style={{ marginTop: 8 }}>
                    O passo 3 não fecha só com o quadrado escolhido: as duas razões são o que a ANPD lê.
                  </p>
                )}
                {mitigacoesQueSustentam.length > 0 && (
                  <p className="note" style={{ marginTop: 8 }}>
                    <b>O veredito se apoia em:</b> {mitigacoesQueSustentam.join(' · ')}. Remover uma delas na T3
                    muda o dano, e o balanceamento precisa ser refeito.
                  </p>
                )}
              </Permitido>
            </Passo>

            <Passo n={4} titulo="Transparência e oposição" desc="Onde o titular vê isso e como ele se opõe — em um clique, não em um formulário." feito>
              <dl className="kv">
                <dt>Onde aparece</dt><dd>Aviso de privacidade e tela de resultado do tratamento.</dd>
                {/*
                  Lido do registro da LIA, e não escrito aqui.
                  Era texto fixo nesta linha: a tela anunciava um canal que o
                  artefato assinado não carregava, e ninguém podia notar a
                  diferença olhando a LIA. Agora divergir exige mudar o dado.
                */}
                <dt>Canal de oposição</dt><dd className="mono" style={{ fontSize: 12.5 }}>{lia.canalOposicao}</dd>
                <dt>Oposições no mês</dt><dd>4 · todas atendidas em até 48 h</dd>
              </dl>
            </Passo>

            <Passo n={5} titulo="Evidências" desc="O que sustenta as respostas acima — o hash de cada arquivo é gravado junto." feito={anexos.length > 0}>
              <Permitido acao="escrever" alternativa={<Nota>Anexar evidência é ação de escrita.</Nota>}>
                <div
                  className="drop"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    anexar([...e.dataTransfer.files].map((f) => f.name));
                  }}
                  onClick={() => anexar([`evidencia-${anexos.length + 1}.png`])}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') anexar([`evidencia-${anexos.length + 1}.png`]); }}
                >
                  Arraste arquivos ou <span style={{ color: 'var(--accent)', fontWeight: 600 }}>clique para simular</span>
                  <div className="hint">o hash de cada arquivo é calculado no navegador e gravado junto</div>
                </div>
              </Permitido>
              <Tabela dense cabecalho={['Arquivo', 'Tipo', 'Hash']}>
                {[...lia.evidencias, ...anexos.map((a) => ({ ...a, tipo: 'anexo da sessão' }))].map((e) => (
                  <tr key={e.arquivo}>
                    <td className="mono">{e.arquivo}</td>
                    <td>{'tipo' in e ? e.tipo : '—'}</td>
                    <td className="hash">{curto(e.hash, 12)}</td>
                  </tr>
                ))}
              </Tabela>
            </Passo>
          </div>

          <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <Permitido acao="assinar_lia" alternativa={<Nota>Assinar a LIA é ação exclusiva do DPO.</Nota>}>
              <button className="btn primary" onClick={assinar}>Gerar LIA.md assinado</button>
            </Permitido>
            <Recusa ancora="lia-assinar" />
            <span className="hash">
              {lia.assinaturaDpo
                ? `documento: sha256 ${curto(lia.documentoHash ?? '', 16)} · ${lia.assinaturaDpo}`
                : 'ainda sem assinatura — o status não chega a vigente'}
            </span>
          </div>

          {doc && <pre className="doc" style={{ marginTop: 14 }}>{doc}</pre>}
        </Cartao>

        <div className="stack">
          <Cartao titulo="Conclusão">
            <div className={`banner ${veredito.chave === 'nao' ? 'crit' : 'ok'}`} style={{ padding: '12px 14px' }}>
              <span className="mark">{veredito.chave === 'nao' ? '✕' : '✓'}</span>
              <div>
                <h4 style={{ fontSize: 14 }}>{veredito.titulo}</h4>
                <p style={{ fontSize: 12.5 }}>{veredito.texto}</p>
              </div>
            </div>
            <Didatico>
              <Nota tom="crit">
                Legítimo interesse não sustenta dado sensível (Art. 11). Na lista abaixo, campo sensível
                aparece inelegível com o motivo — e a rota recusa a gravação mesmo se a tela deixasse passar.
              </Nota>
            </Didatico>
          </Cartao>

          <Cartao titulo="Datasets vinculados" hint="quem depende desta LIA">
            <dl className="kv">
              {vinculados.map((c) => c && (
                <div key={c.id} style={{ display: 'contents' }}>
                  <dt className="mono">{c.sistema}</dt>
                  <dd>{c.dataset}.{c.nome}</dd>
                </div>
              ))}
              <dt>Se vencer</dt>
              <dd><Pill tom="crit">o campo perde base legal</Pill> e o gate de CI bloqueia o repositório</dd>
            </dl>

            {/* T8-03 — a lista oferecia o campo sensível como se fosse escolha
                válida, e a tela pré-selecionava justamente ele. A opção continua
                visível, porque saber que existe e por que é recusada faz parte
                do que a tela ensina — mas inelegível e não selecionável. */}
            <Permitido acao="escrever">
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="lia-campo">Vincular outro campo</label>
                <select id="lia-campo" value={campoParaVincular} onChange={(e) => setCampoParaVincular(e.target.value)}>
                  {banco.cenario.campos.map((c) => (
                    <option key={c.id} value={c.id} disabled={c.sensivel}>
                      {c.nome}{c.sensivel ? ' — inelegível: dado sensível (Art. 11)' : ''}
                    </option>
                  ))}
                </select>
                <span className="hint">
                  Legítimo interesse não consta do rol fechado do Art. 11: campo sensível aparece na lista
                  com o motivo, e não pode ser escolhido.
                </span>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn" onClick={vincular} disabled={Boolean(campoAlvo?.sensivel)}>
                  Vincular à LIA
                </button>
              </div>
              <Recusa ancora="lia-vincular" />
            </Permitido>

            <div className="row" style={{ marginTop: 12 }}>
              <Link className="btn ghost" to="/t2">Ver no catálogo →</Link>
            </div>
          </Cartao>

          <Cartao titulo="Ciclo de revisão">
            <dl className="kv">
              <dt>Assinada</dt><dd>{lia.assinaturaDpo ? 'sim' : 'pendente'}</dd>
              <dt>Vence em</dt>
              <dd>
                {lia.vigenciaFim} ·{' '}
                <Pill tom={lia.diasParaVencer < 0 ? 'crit' : lia.diasParaVencer < 60 ? 'warn' : 'neutral'}>
                  {lia.diasParaVencer < 0 ? `vencida há ${Math.abs(lia.diasParaVencer)} dias` : `faltam ${lia.diasParaVencer} dias`}
                </Pill>
              </dd>
              <dt>Aviso</dt><dd>60 dias antes, para DPO e dono do dataset</dd>
            </dl>
          </Cartao>
        </div>
      </div>
    </>
  );
}

function Passo({ n, titulo, desc, feito, children }: {
  n: number; titulo: string; desc: string; feito: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`step ${feito ? 'done' : ''}`}>
      <div className="step-n">{n}</div>
      <div>
        <h4>{titulo}</h4>
        <div className="step-desc">{desc}</div>
        {children}
      </div>
    </div>
  );
}
