import { useState } from 'react';
import { Cabecalho, Cartao, Didatico, Nota, Permitido, Pill, Recusa, Tabela } from '../ui/primitivos';
import { useSessao, nomeDoPapel } from '../store/sessao';
import { BASES_PARA_SENSIVEL } from '../mock/types';
import {
  aplicar, gatilhoCritico, reproduzir, rotuloDoGatilho, ultimaDecisao, vigenteDe,
} from '../mock/decisoes';
import { sha256 } from '../lib/sha256';
import type { BaseLegal, Campo, DecisaoRegistrada, Ripd, TabelaId } from '../mock/types';

export default function T3() {
  const banco = useSessao((s) => s.banco);
  const chamar = useSessao((s) => s.chamar);
  const avisar = useSessao((s) => s.avisar);
  const papel = useSessao((s) => s.papel);
  useSessao((s) => s.versao);

  const ripd = banco.cenario.ripds[0];
  const [mermaid, setMermaid] = useState(ripd?.fluxoMermaid ?? '');
  const [doc, setDoc] = useState<string | null>(null);
  const [baseTeste, setBaseTeste] = useState<BaseLegal>('legitimo_interesse');
  const [anexo, setAnexo] = useState<{ commit: string; autor: string; quando: string } | null>(null);
  /**
   * Mesmo defeito do T8-03, aqui: a tela abria com o campo sensível escolhido e
   * disparava a recusa antes de alguém tocar em nada. Um alerta que já está lá
   * quando você chega não é resposta a uma ação — é decoração vermelha, e
   * ensina a ignorar o próximo.
   */
  const [campoTeste, setCampoTeste] = useState(
    banco.cenario.campos.find((c) => !c.sensivel)?.id ?? banco.cenario.campos[0]?.id ?? '',
  );

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

  /**
   * T3-02 — baixar e anexar eram o mesmo botão, e o rótulo dizia "anexar ao PR"
   * enquanto o clique só salvava um arquivo na pasta de downloads. São dois
   * atos com consequências diferentes: um leva o documento para a sua máquina,
   * o outro coloca um commit no pull request de outra pessoa.
   */
  const gerar = () => {
    const res = chamar<{ markdown: string }>({ metodo: 'POST', caminho: `/v1/ripds/${ripd.id}/render` }, 'ripd-gerar');
    if (res.status === 200) setDoc(res.body.markdown);
    return res;
  };

  const baixarDoc = () => {
    const res = gerar();
    if (res.status === 200) baixar(`${ripd.codigo}.md`, res.body.markdown);
  };

  const anexarAoPr = () => {
    const res = gerar();
    if (res.status !== 200) return;
    // O commit é derivado do conteúdo: anexo diferente, sha diferente.
    setAnexo({
      commit: sha256(`${ripd.codigo}:${res.body.markdown}`).slice(0, 7),
      autor: nomeDoPapel(papel),
      quando: new Date().toLocaleTimeString('pt-BR'),
    });
  };

  const aprovar = () => {
    const res = chamar({ metodo: 'POST', caminho: `/v1/ripds/${ripd.id}/aprovar` }, 'ripd-aprovar');
    if (res.status === 200) avisar('ok', `Status check do PR #${ripd.prNumero} voltou a verde. O merge está liberado.`);
  };

  const campoSelecionado = banco.cenario.campos.find((c) => c.id === campoTeste);
  const combinacaoInvalida = Boolean(campoSelecionado?.sensivel && !BASES_PARA_SENSIVEL.includes(baseTeste));

  /**
   * T3-01 — o stepper mostrava cinco seções "feitas" porque `feito` estava
   * escrito à mão no JSX. Progresso que ninguém calcula é decoração: dizia
   * 4/5 completo com o parecer vazio.
   *
   * Agora cada seção deriva do conteúdo, e o topo diz o que falta — não quanto
   * já foi. Requisito pendente é acionável; percentual não é.
   */
  const requisitos = [
    { n: 1, feito: ripd.contexto.trim().length > 0 && ripd.foraDeEscopo.trim().length > 0,
      falta: 'contexto e escopo do parecer' },
    { n: 2, feito: campos.length > 0, falta: 'campos importados do catálogo' },
    { n: 3, feito: /[A-Za-z_]\w*\s*[[({]/.test(mermaid), falta: 'fluxo de dados com ao menos um nó' },
    { n: 4, feito: ripd.operacoes.length > 0 && ripd.operacoes.every((o) => Boolean(o.baseLegal)),
      falta: 'base legal declarada em toda operação' },
    { n: 5, feito: ripd.recomendacoes.every((r) => r.prioridade !== 'P0' || r.concluida),
      falta: 'recomendações P0 concluídas' },
  ];
  const pendentes = requisitos.filter((r) => !r.feito);
  const feitoDe = (n: number) => requisitos.find((r) => r.n === n)?.feito ?? false;

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
            {/* PR 8 — rótulo e criticidade vêm do catálogo de gatilhos, que é a
                entrada da D3. O cenário só diz qual acionou e com que evidência. */}
            {ripd.triggers.map((t) => (
              <Pill key={t.codigo} tom={gatilhoCritico(t.codigo) ? 'crit' : 'warn'}>
                {t.codigo} · {rotuloDoGatilho(t.codigo)}
              </Pill>
            ))}
            <span className="hash">{ripd.codigo} · {ripd.headSha}</span>
          </div>
        </div>
      </div>

      <div className="grid g-2-1">
        <Cartao
          titulo="Parecer técnico"
          hint={pendentes.length === 0
            ? 'todos os requisitos atendidos'
            : `${pendentes.length} requisito${pendentes.length > 1 ? 's' : ''} pendente${pendentes.length > 1 ? 's' : ''}`}
        >
          {pendentes.length > 0 && (
            <Nota tom="warn">
              Falta: {pendentes.map((r) => r.falta).join(' · ')}. O passo só fica marcado quando o dado
              existe — o número no topo é contado, não escrito.
            </Nota>
          )}
          <div className="stepper">
            <Secao n={1} feitoDerivado={feitoDe(1)} titulo="Contexto e escopo" desc="O que entra, o que fica de fora e por quê.">
              <textarea readOnly value={`${ripd.contexto}\n\nFora de escopo: ${ripd.foraDeEscopo}`} />
            </Secao>

            <Secao n={2} feitoDerivado={feitoDe(2)} titulo="Dados tratados" desc="Importados do catálogo — sem redigitação, sem divergência.">
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

            <Secao n={3} feitoDerivado={feitoDe(3)} titulo="Fluxo de dados" desc="Editor mermaid com pré-visualização estrutural — o mesmo diagrama vai para o threat-model.md.">
              <Permitido acao="gerar_ripd" alternativa={<pre className="mermaid-src">{mermaid}</pre>}>
                <textarea value={mermaid} onChange={(e) => setMermaid(e.target.value)} style={{ minHeight: 92 }} />
              </Permitido>
              <PreviaMermaid fonte={mermaid} />
            </Secao>

            <Secao n={4} feitoDerivado={feitoDe(4)} titulo="Base legal por operação" desc="Legítimo interesse só é aceito com LIA vigente vinculada.">
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
                {/* T3-03 — o teste só falava quando recusava. Quem experimentava
                    uma combinação válida recebia silêncio, que é indistinguível
                    de "a ferramenta não funcionou". Um só `role="alert"` na
                    região: o válido confirma em `role="status"`. */}
                {combinacaoInvalida ? (
                  <p className="note crit" style={{ marginTop: 10 }} role="alert">
                    <b>Combinação recusada.</b> {campoSelecionado?.nome} é dado sensível e o Art. 11 traz rol fechado de
                    bases legais — legítimo interesse, execução de contrato e proteção ao crédito não estão nele.
                  </p>
                ) : (
                  <p className="note" style={{ marginTop: 10 }} role="status">
                    <b>Combinação aceita.</b> {campoSelecionado?.nome} sob <span className="mono">{baseTeste}</span>
                    {campoSelecionado?.sensivel
                      ? ` — base do rol fechado do Art. 11, que é o que dado sensível exige.`
                      : ` — campo não sensível, e a base consta do Art. 7º.`}
                    {baseTeste === 'legitimo_interesse' && ' Exige LIA vigente vinculada (Art. 7º, IX).'}
                  </p>
                )}
              </div>
            </Secao>

            <Secao n={5} feitoDerivado={feitoDe(5)} titulo="Recomendações" desc="Cada item tem dono e prazo — sem isso o RIPD não fecha.">
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

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <div className="row">
              <Permitido acao="gerar_ripd">
                <button className="btn" onClick={baixarDoc}>Baixar RIPD.md</button>
                <button className="btn primary" onClick={anexarAoPr}>Anexar ao PR #{ripd.prNumero}</button>
              </Permitido>
              <Permitido acao="aprovar_ripd">
                <button className="btn" onClick={aprovar} disabled={ripd.status === 'vigente'}>
                  {ripd.status === 'vigente' ? 'Aprovado' : 'Aprovar como DPO'}
                </button>
              </Permitido>
              <span className="hint">
                {ripd.recomendacoes.filter((r) => r.prioridade === 'P0' && !r.concluida).length} recomendação P0 em aberto
              </span>
            </div>
            {/* C-10 — a recusa da aprovação fica aqui, no cartão do botão que
                falhou, e não no canto da tela do outro lado. */}
            <Recusa ancora="ripd-aprovar" />
            <Recusa ancora="ripd-gerar" />
            {anexo && (
              <p className="note" role="status" style={{ marginTop: 10 }}>
                <b>Anexado ao PR #{ripd.prNumero}.</b> commit <span className="mono">{anexo.commit}</span> ·
                {' '}{anexo.autor} · {anexo.quando}. O documento vira um arquivo versionado no branch, não
                um download na máquina de quem clicou.
              </p>
            )}
          </div>

          {doc && <pre className="doc" style={{ marginTop: 14 }}>{doc}</pre>}
        </Cartao>

        <div className="stack">
          <Rito ripd={ripd} />

          <Dispensas />

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
            <Didatico>
              <Nota>
                Os seis rótulos são os que este time usa no <span className="mono">threat-model.md</span>. A plataforma grava
                também o equivalente canônico, para que o modelo continue comparável fora de casa.
              </Nota>
            </Didatico>
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

/**
 * PR 11 — a dispensa como decisão registrada, e o gatilho que a reabre.
 *
 * Dispensar não é deixar de fazer RIPD: é registrar por que não se faz e o que,
 * se acontecer, obriga a refazer. Por isso o gatilho é um **código do catálogo**
 * e não uma frase — a triagem do CI fala esse vocabulário, e é ela que dispara.
 *
 * O botão de disparo existe no modo demonstração porque, em produção, quem
 * chama a rota é o pipeline. Ele não é um atalho de escrita: passa pela mesma
 * rota, com a mesma exigência de evidência e o mesmo registro antes de aplicar.
 */
function Dispensas() {
  const banco = useSessao((s) => s.banco);
  const chamar = useSessao((s) => s.chamar);
  const avisar = useSessao((s) => s.avisar);
  useSessao((s) => s.versao);

  const dispensados = banco.cenario.ripds.filter((r) => r.status === 'dispensado');
  const reabertos = banco.cenario.ripds.filter(
    (r) => r.status !== 'dispensado' && (r.dispensas ?? []).some((d) => d.disparos.some((x) => x.reabriu)),
  );

  if (dispensados.length === 0 && reabertos.length === 0) return null;

  const disparar = (ripdId: string, codigo: string, condicao: string) => {
    const res = chamar<{ reabriu: boolean; motivo: string }>(
      { metodo: 'POST', caminho: `/v1/ripds/${ripdId}/gatilho`, body: { codigo, evidencia: condicao } },
      'gatilho',
    );
    if (res.status === 200) {
      avisar(res.body.reabriu ? 'negado' : 'info',
        res.body.reabriu
          ? `${codigo} disparou: o RIPD voltou para elaboração sem intervenção manual.`
          : `${codigo} ficou registrado como evidência.`,
        res.body.motivo);
      useSessao.setState((s) => ({ versao: s.versao + 1 }));
    }
  };

  return (
    <Cartao titulo="Dispensa e gatilho de reabertura" hint="dispensa é decisão registrada, não ausência de RIPD">
      {dispensados.map((r) => {
        const d = (r.dispensas ?? []).at(-1);
        if (!d) return null;
        return (
          <div key={r.codigo} style={{ paddingBottom: 10, borderBottom: '1px solid var(--line)', marginBottom: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{r.codigo}</span>
              <Pill tom="neutral">dispensado</Pill>
            </div>
            <p className="hint" style={{ margin: '6px 0' }}>{d.justificativa}</p>
            {d.gatilhos.map((g) => (
              <div className="row" key={g.codigo} style={{ gap: 8, marginTop: 6 }}>
                <span className="hash">{g.codigo} · {rotuloDoGatilho(g.codigo)}</span>
                <span className="hint" style={{ flex: 1, minWidth: 180 }}>{g.condicao}</span>
                {banco.modoDemo && (
                  <Permitido acao="gerar_ripd" alternativa={null}>
                    <button className="reveal" onClick={() => disparar(r.id, g.codigo, g.condicao)}>
                      Simular disparo
                    </button>
                  </Permitido>
                )}
              </div>
            ))}
            {d.disparos.length > 0 && (
              <Nota tom="warn">
                {d.disparos.length} disparo(s) registrado(s); o último ({d.disparos.at(-1)!.codigo}){' '}
                {d.disparos.at(-1)!.reabriu ? 'reabriu o RIPD' : 'não reabriu e ficou como evidência'}.
              </Nota>
            )}
          </div>
        );
      })}

      {reabertos.map((r) => (
        <Nota key={r.codigo} tom="crit">
          <b>{r.codigo} foi reaberto por gatilho.</b> Está em <span className="mono">{r.status}</span>, e
          a dispensa anterior continua no artefato dizendo o que se comprometeu a vigiar.
        </Nota>
      ))}

      <Recusa ancora="gatilho" />
      <Nota>
        O gatilho é um código do catálogo da triagem, não uma frase: é o que permite a esteira reabrir
        o RIPD sozinha. Gatilho crítico que a dispensa não previu também reabre — a omissão não protege
        a dispensa.
      </Nota>
    </Cartao>
  );
}

/**
 * PR 8 — o rito, explicado em uma frase por tabela.
 *
 * A frase é **derivada** da regra que casou, não escrita ao lado dela: se a
 * tabela mudar, o texto muda junto. Foi por isso que a explicação não virou um
 * campo `porque` em cada linha da tabela — campo de texto ao lado de uma regra
 * é a próxima divergência esperando acontecer, do mesmo jeito que o rótulo do
 * gatilho repetido em três cenários era.
 *
 * Três estados, e o terceiro é o que este PR existe para mostrar: decisão
 * gravada com uma versão que já não é a vigente. Ela não se atualiza sozinha, e
 * a tela não finge que sim — mostra o que a versão de hoje responderia às mesmas
 * entradas, marcado como prévia, e deixa reaplicar como ato registrado.
 */
function Rito({ ripd }: { ripd: Ripd }) {
  const chamar = useSessao((s) => s.chamar);
  const avisar = useSessao((s) => s.avisar);

  const aplicarNoRipd = (tabela: TabelaId) => {
    const res = chamar<DecisaoRegistrada>(
      { metodo: 'POST', caminho: `/v1/dmn/${tabela}/aplicar`, body: { id: ripd.id } },
      `dmn-${tabela}`,
    );
    if (res.status === 200) {
      avisar('ok', `${tabela.toUpperCase()}@${res.body.versao} aplicada e registrada.`,
        'A decisão anterior continua no artefato como foi tomada — reaplicar grava uma nova, não reescreve a antiga.');
      useSessao.setState((s) => ({ versao: s.versao + 1 }));
    }
  };

  return (
    <Cartao titulo="Rito aplicado" hint="D1 · complexidade e alçada — D3 · exige RIPD">
      <Decidido tabela="d1" registro={ultimaDecisao(ripd.decisoes, 'd1')} aoAplicar={() => aplicarNoRipd('d1')} />
      <Decidido tabela="d3" registro={ultimaDecisao(ripd.decisoes, 'd3')} aoAplicar={() => aplicarNoRipd('d3')} />
      <Recusa ancora="dmn-d1" />
      <Recusa ancora="dmn-d3" />
      <Nota>
        As entradas de cada decisão são lidas do artefato — categoria vem do catálogo, os gatilhos vêm da
        triagem —, nunca digitadas aqui. É o que faz a decisão ser reproduzível meses depois em vez de ser
        apenas declarada.
      </Nota>
    </Cartao>
  );
}

function Decidido({ tabela, registro, aoAplicar }: {
  tabela: TabelaId; registro: DecisaoRegistrada | null; aoAplicar: () => void;
}) {
  const rotulo = tabela.toUpperCase();
  const vigente = vigenteDe(tabela).versao;

  if (!registro) {
    return (
      <div style={{ paddingBottom: 10, borderBottom: '1px solid var(--line)', marginBottom: 10 }}>
        <Nota>Nenhuma decisão da {rotulo} gravada para este RIPD.</Nota>
        <Permitido acao="escrever" alternativa={null}>
          <button className="btn" style={{ marginTop: 8 }} onClick={aoAplicar}>
            Aplicar {rotulo} ({tabela}@{vigente})
          </button>
        </Permitido>
      </div>
    );
  }

  const conferencia = reproduzir(registro);
  const desatualizada = registro.versao !== vigente;
  // Mesmas entradas, versão de hoje: isola o efeito da troca de versão do
  // efeito de o artefato ter mudado desde então.
  const hoje = desatualizada ? aplicar(tabela, registro.entradas) : null;

  return (
    <div style={{ paddingBottom: 10, borderBottom: '1px solid var(--line)', marginBottom: 10 }}>
      <p style={{ margin: 0, fontSize: 12.5 }}>{registro.frase}</p>
      <div className="row" style={{ marginTop: 6, gap: 8 }}>
        <span className="hash">{tabela}@{registro.versao}</span>
        <span className="hint">
          gravada em {new Date(registro.quando).toLocaleDateString('pt-BR')} ·
          {' '}{conferencia.confere ? 'reproduz a mesma saída' : `não reproduz: ${conferencia.motivo}`}
        </span>
      </div>
      {hoje && (
        <Nota tom="warn">
          A versão vigente é <span className="mono">{tabela}@{vigente}</span> — {vigenteDe(tabela).nota} Para
          estas mesmas entradas ela responderia: <b>{hoje.frase}</b>. Isto é prévia, não decisão: a gravada
          acima continua valendo como foi tomada.
          <Permitido acao="escrever" alternativa={null}>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={aoAplicar}>Reaplicar com {tabela}@{vigente}</button>
            </div>
          </Permitido>
        </Nota>
      )}
    </div>
  );
}

function Secao({ n, titulo, desc, feitoDerivado, children }: {
  n: number; titulo: string; desc: string; feitoDerivado: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`step ${feitoDerivado ? 'done' : ''}`}>
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
