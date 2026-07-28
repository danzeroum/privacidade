import { useState } from 'react';
import { Cabecalho, Cartao, Nota, Permitido, Pill, Tabela } from '../ui/primitivos';
import { useSessao } from '../store/sessao';
import { BASES_PARA_SENSIVEL } from '../mock/types';
import type { BaseLegal, Campo } from '../mock/types';

export default function T3() {
  const banco = useSessao((s) => s.banco);
  const chamar = useSessao((s) => s.chamar);
  const avisar = useSessao((s) => s.avisar);
  useSessao((s) => s.versao);

  const ripd = banco.cenario.ripds[0];
  const [mermaid, setMermaid] = useState(ripd?.fluxoMermaid ?? '');
  const [doc, setDoc] = useState<string | null>(null);
  const [baseTeste, setBaseTeste] = useState<BaseLegal>('legitimo_interesse');
  const [campoTeste, setCampoTeste] = useState(banco.cenario.campos.find((c) => c.sensivel)?.id ?? '');

  if (!ripd) return <Nota>Este cenário não tem RIPD em aberto.</Nota>;

  const gate = banco.cenario.gates.find((g) => g.ripdId === ripd.id);
  const bloqueado = Boolean(gate?.bloqueouMerge);
  const campos = ripd.camposIds
    .map((id) => banco.cenario.campos.find((c) => c.id === id))
    .filter((c): c is Campo => Boolean(c));

  const alternarLinddun = (chave: string) => {
    const item = ripd.linddun.find((l) => l.chave === chave);
    if (item) { item.ativo = !item.ativo; avisar('info', `${item.rotulo}: ${item.ativo ? 'mitigação gerada' : 'mitigação removida'}.`); }
    useSessao.setState((s) => ({ versao: s.versao + 1 }));
  };

  const gerar = () => {
    const res = chamar<{ markdown: string }>({ metodo: 'POST', caminho: `/v1/ripds/${ripd.id}/render` });
    if (res.status === 200) {
      setDoc(res.body.markdown);
      baixar(`${ripd.codigo}.md`, res.body.markdown);
    }
  };

  const aprovar = () => {
    const res = chamar({ metodo: 'POST', caminho: `/v1/ripds/${ripd.id}/aprovar` });
    if (res.status === 200) avisar('ok', `Status check do PR #${ripd.prNumero} voltou a verde. O merge está liberado.`);
  };

  const campoSelecionado = banco.cenario.campos.find((c) => c.id === campoTeste);
  const combinacaoInvalida = Boolean(campoSelecionado?.sensivel && !BASES_PARA_SENSIVEL.includes(baseTeste));

  return (
    <>
      <Cabecalho
        fontes={['ripd-triage.sh', 'threat-model.md', 'parecer-tecnico.md']}
        titulo="RIPD e LINDDUN"
        resumo="A triagem já rodou no PR. Aqui o parecer é preenchido com evidência técnica e vira o RIPD.md anexado ao próprio pull request."
        nota={{
          engenharia: 'A triagem já apontou o que travou. Preencha com evidência técnica e o RIPD.md volta como commit no seu PR.',
          dpo: 'Você aprova aqui e o status check no GitHub muda sozinho. A aprovação fica assinada com o hash do documento.',
          produto: 'O RIPD define o que a feature pode fazer. Ler as recomendações P0 evita descobrir o limite no dia do lançamento.',
          seguranca: 'As categorias LINDDUN ativas viram controles que você vai auditar depois.',
          auditor: 'O parecer é somente leitura para este papel. A trilha de aprovação está na T6.',
        }}
      />

      <div className={`banner ${bloqueado ? 'crit' : 'ok'}`} style={{ marginBottom: 20 }}>
        <span className="mark">{bloqueado ? '⛔' : '✅'}</span>
        <div style={{ flex: 1 }}>
          <h4>
            {bloqueado ? 'Merge bloqueado' : 'Merge liberado'} — PR #{ripd.prNumero} · {ripd.sistema}
          </h4>
          <p>
            {bloqueado
              ? 'Critérios críticos de RIPD foram acionados. O status check só volta a verde depois da aprovação do DPO.'
              : 'RIPD aprovado. A plataforma reposta o status check e o merge fica liberado.'}
          </p>
          <div className="row" style={{ marginTop: 9 }}>
            {ripd.triggers.map((t) => (
              <Pill key={t.codigo} tom={t.critico ? 'crit' : 'warn'}>{t.codigo} · {t.categoria}</Pill>
            ))}
            <span className="hash">{ripd.codigo} · {ripd.headSha}</span>
          </div>
        </div>
      </div>

      <div className="grid g-2-1">
        <Cartao titulo="Parecer técnico" hint="seções do template parecer-tecnico.md">
          <div className="stepper">
            <Secao n={1} titulo="Contexto e escopo" desc="O que entra, o que fica de fora e por quê." feito>
              <textarea readOnly value={`${ripd.contexto}\n\nFora de escopo: ${ripd.foraDeEscopo}`} />
            </Secao>

            <Secao n={2} titulo="Dados tratados" desc="Importados do catálogo — sem redigitação, sem divergência." feito>
              <Tabela cabecalho={['Campo', 'Categoria', 'Base legal', 'Retenção']}>
                {campos.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.nome}</td>
                    <td>{c.categoria}{c.sensivel && ' 🔒'}</td>
                    <td>{c.baseLegal}{c.liaCodigo && <> <Pill tom="ok">{c.liaCodigo}</Pill></>}</td>
                    <td className="num">{c.retencao}</td>
                  </tr>
                ))}
              </Tabela>
            </Secao>

            <Secao n={3} titulo="Fluxo de dados" desc="Editor mermaid com pré-visualização estrutural — o mesmo diagrama vai para o threat-model.md." feito>
              <Permitido acao="gerar_ripd" alternativa={<pre className="mermaid-src">{mermaid}</pre>}>
                <textarea value={mermaid} onChange={(e) => setMermaid(e.target.value)} style={{ minHeight: 92 }} />
              </Permitido>
              <PreviaMermaid fonte={mermaid} />
            </Secao>

            <Secao n={4} titulo="Base legal por operação" desc="Legítimo interesse só é aceito com LIA vigente vinculada." feito>
              <Tabela cabecalho={['Operação', 'Finalidade', 'Base legal', 'LIA']}>
                {ripd.operacoes.map((o) => (
                  <tr key={o.operacao}>
                    <td className="mono">{o.operacao}</td>
                    <td>{o.finalidade}</td>
                    <td>{o.baseLegal}</td>
                    <td>{o.liaCodigo ? <Pill tom="ok">{o.liaCodigo} · vigente</Pill> : '—'}</td>
                  </tr>
                ))}
              </Tabela>

              <div className="card" style={{ marginTop: 12, background: 'var(--surface-2)' }}>
                <div className="card-head"><h3 style={{ fontSize: 14 }}>Testar combinação</h3></div>
                <div className="row">
                  <div className="field" style={{ flex: 1, minWidth: 180 }}>
                    <label htmlFor="t3-campo">Campo</label>
                    <select id="t3-campo" value={campoTeste} onChange={(e) => setCampoTeste(e.target.value)}>
                      {banco.cenario.campos.map((c) => (
                        <option key={c.id} value={c.id}>{c.nome}{c.sensivel ? ' (sensível)' : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 180 }}>
                    <label htmlFor="t3-base">Base legal</label>
                    <select id="t3-base" value={baseTeste} onChange={(e) => setBaseTeste(e.target.value as BaseLegal)}>
                      {['legitimo_interesse', 'consentimento', 'execucao_contrato', 'tutela_saude', 'protecao_credito'].map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </div>
                </div>
                {combinacaoInvalida && (
                  <p className="note crit" style={{ marginTop: 10 }} role="alert">
                    <b>Combinação recusada.</b> {campoSelecionado?.nome} é dado sensível e o Art. 11 traz rol fechado de
                    bases legais — legítimo interesse, execução de contrato e proteção ao crédito não estão nele.
                  </p>
                )}
              </div>
            </Secao>

            <Secao n={5} titulo="Recomendações" desc="Cada item tem dono e prazo — sem isso o RIPD não fecha." feito={false}>
              <Tabela cabecalho={['', 'Recomendação', 'Dono', 'Prazo', 'Status']}>
                {ripd.recomendacoes.map((r) => (
                  <tr key={r.descricao}>
                    <td><Pill tom={r.prioridade === 'P0' ? 'crit' : 'warn'}>{r.prioridade}</Pill></td>
                    <td>{r.descricao}</td>
                    <td className="mono">{r.dono}</td>
                    <td className="num">{r.prazo}</td>
                    <td>
                      <Permitido
                        acao="gerar_ripd"
                        alternativa={<Pill tom={r.concluida ? 'ok' : 'neutral'}>{r.concluida ? 'feito' : 'aberto'}</Pill>}
                      >
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={r.concluida}
                            onChange={() => {
                              r.concluida = !r.concluida;
                              useSessao.setState((s) => ({ versao: s.versao + 1 }));
                            }}
                          />
                          <span className="track" />
                        </label>
                      </Permitido>
                    </td>
                  </tr>
                ))}
              </Tabela>
            </Secao>
          </div>

          <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <Permitido acao="gerar_ripd">
              <button className="btn primary" onClick={gerar}>Gerar RIPD.md e anexar ao PR</button>
            </Permitido>
            <Permitido acao="aprovar_ripd">
              <button className="btn" onClick={aprovar} disabled={ripd.status === 'aprovado'}>
                {ripd.status === 'aprovado' ? 'Aprovado' : 'Aprovar como DPO'}
              </button>
            </Permitido>
            <span className="hint">
              {ripd.recomendacoes.filter((r) => r.prioridade === 'P0' && !r.concluida).length} recomendação P0 em aberto
            </span>
          </div>

          {doc && <pre className="doc" style={{ marginTop: 14 }}>{doc}</pre>}
        </Cartao>

        <div className="stack">
          <Cartao titulo="Checklist LINDDUN" hint="ativar gera mitigação">
            {ripd.linddun.map((l) => (
              <label className="ck" key={l.chave} style={{ cursor: 'pointer' }}>
                <span>
                  <span className="ck-name">{l.rotulo}</span>
                  <span className="ck-just">≡ {l.canonico}</span>
                </span>
                <span className="toggle">
                  <input
                    type="checkbox"
                    checked={l.ativo}
                    aria-label={l.rotulo}
                    onChange={() => alternarLinddun(l.chave)}
                  />
                  <span className="track" />
                </span>
              </label>
            ))}
            <Nota>
              Os seis rótulos são os que este time usa no <span className="mono">threat-model.md</span>. A plataforma grava
              também o equivalente canônico, para que o modelo continue comparável fora de casa.
            </Nota>
          </Cartao>

          <Cartao titulo="Mitigações geradas">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.8 }}>
              {ripd.linddun.filter((l) => l.ativo).map((l) => (
                <li key={l.chave}><b>{l.rotulo}</b> — {l.mitigacao}</li>
              ))}
              {ripd.linddun.every((l) => !l.ativo) && (
                <li style={{ color: 'var(--text-3)' }}>
                  Nenhuma categoria ativa. Um threat model vazio não passa no gate de arquitetura.
                </li>
              )}
            </ul>
          </Cartao>
        </div>
      </div>
    </>
  );
}

function Secao({ n, titulo, desc, feito, children }: {
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

/**
 * Pré-visualização estrutural do mermaid. Não é o renderizador oficial — extrai
 * os nós na ordem em que aparecem e desenha a cadeia, que é o que importa para
 * conferir o fluxo antes de commitar o diagrama.
 */
function PreviaMermaid({ fonte }: { fonte: string }) {
  const nos = [...fonte.matchAll(/([A-Za-z_]\w*)\s*[[({]([^\])}]+)[\])}]/g)].map((m) => m[2]);
  const unicos = nos.filter((n, i) => nos.indexOf(n) === i);
  if (unicos.length === 0) return <Nota>Nenhum nó reconhecido no diagrama.</Nota>;
  const W = 760, passo = W / unicos.length;
  return (
    <svg className="chart" viewBox={`0 0 ${W} 74`} role="img" aria-label="Pré-visualização do fluxo" style={{ marginTop: 10 }}>
      {unicos.map((rotulo, i) => {
        const x = i * passo + 6;
        const w = passo - 26;
        return (
          <g key={`${rotulo}-${i}`}>
            <rect x={x} y={16} width={w} height={40} rx={5} fill="var(--surface-2)" stroke="var(--line)" />
            <text x={x + w / 2} y={41} textAnchor="middle" fontSize={11.5} fill="var(--text)">{rotulo}</text>
            {i < unicos.length - 1 && <path d={`M${x + w + 3} 36 L${x + passo + 1} 36`} stroke="var(--line-strong)" strokeWidth={1.5} />}
          </g>
        );
      })}
    </svg>
  );
}

function baixar(nome: string, conteudo: string) {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([conteudo], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}
