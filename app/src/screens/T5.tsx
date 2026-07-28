import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cabecalho, Cartao, Nota, Permitido, Pill, Recusa, Tabela } from '../ui/primitivos';
import { ModalReclassificar, CORES_DANO } from '../ui/reclassificar';
import { useSessao } from '../store/sessao';
import {
  aplicar as aplicarTabela, nivelDoRisco, reproduzir, tomDoRisco, ultimaDecisao, vigenteDe,
} from '../mock/decisoes';
import type { DecisaoRegistrada, Risco } from '../mock/types';

const NIVEIS = [1, 2, 3, 4, 5];

export default function T5() {
  const banco = useSessao((s) => s.banco);
  useSessao((s) => s.versao);

  const riscos = banco.cenario.riscos;
  // T1-01 — a T1 encaminha para cá com o risco já escolhido: o mapa de esforço
  // informa, a matriz P × I é onde se reclassifica.
  const vindoDaT1 = useSessao((s) => s.riscoSelecionado);
  const [sel, setSel] = useState(vindoDaT1 ?? riscos[0]?.codigo ?? '');
  /**
   * T5-01 — o ajuste por teclado é **rascunho**, não aplicação.
   *
   * As setas mexem em `ajuste` e mais nada: nenhuma chamada de API sai daqui.
   * Aplicar continua passando pelo `ModalReclassificar`, que exige
   * justificativa de 20 caracteres e registra. Acessibilidade que criasse um
   * caminho de escrita sem registro seria pior do que a inacessibilidade que
   * este item corrige — o atalho novo não pode ser a porta lateral.
   */
  const [ajuste, setAjuste] = useState<{ codigo: string; p: number; i: number } | null>(null);
  const [arrasto, setArrasto] = useState<{ risco: Risco; p: number; i: number } | null>(null);
  const [pendente, setPendente] = useState<{ risco: Risco; p: number; i: number } | null>(null);

  const selecionado = riscos.find((r) => r.codigo === sel) ?? riscos[0];
  const emAjuste = ajuste?.codigo === selecionado?.codigo ? ajuste : null;

  const abrirAjuste = (r: Risco) =>
    setAjuste({ codigo: r.codigo, p: r.probabilidade, i: r.impacto });

  const mover = (dp: number, di: number) => {
    if (!selecionado) return;
    const base = emAjuste ?? { p: selecionado.probabilidade, i: selecionado.impacto };
    setAjuste({
      codigo: selecionado.codigo,
      p: Math.min(5, Math.max(1, base.p + dp)),
      i: Math.min(5, Math.max(1, base.i + di)),
    });
  };

  const teclaNaGrade = (e: React.KeyboardEvent, r: Risco) => {
    const passo: Record<string, [number, number]> = {
      ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
    };
    if (passo[e.key]) {
      e.preventDefault();
      setSel(r.codigo);
      if (ajuste?.codigo !== r.codigo) abrirAjuste(r);
      mover(...passo[e.key]);
    }
  };

  const aplicar = () => {
    if (!selecionado || !emAjuste) return;
    setPendente({ risco: selecionado, p: emAjuste.p, i: emAjuste.i });
  };

  const dominios = riscos.reduce<Record<string, { total: number; soma: number; criticos: number }>>((acc, r) => {
    const d = acc[r.dominio] ?? { total: 0, soma: 0, criticos: 0 };
    d.total += 1; d.soma += r.probabilidade * r.impacto;
    // Também aqui o corte é a D2: dois lugares contando "crítico" com
    // limiares próprios é o segundo modelo de risco entrando pela porta dos fundos.
    if (nivelDoRisco(r.probabilidade, r.impacto) === 'critico') d.criticos += 1;
    acc[r.dominio] = d;
    return acc;
  }, {});
  const maior = Math.max(...Object.values(dominios).map((d) => d.soma), 1);

  // Impacto 5 em cima, como na leitura convencional de matriz de risco.
  const linhas = [...NIVEIS].reverse();

  return (
    <>
      <Cabecalho
        fontes={['docs/risk-matrix.csv', 'RACI']}
        titulo="Riscos e RACI"
        resumo="Dez riscos, um dono cada, prazo e data de reavaliação. Reclassificar muda a prioridade do programa — por isso exige justificativa registrada, e agora pode ser feito por teclado."
        nota={{
          engenharia: 'Risco com dono de engenharia vira tarefa. Score alto com esforço baixo é o que entra na sprint primeiro.',
          dpo: 'Reclassificar exige justificativa e fica no histórico. É assim que você defende a priorização meses depois.',
          produto: 'O RACI mostra quem decide o quê. Se um processo trava, a pessoa accountable está nesta tabela.',
          seguranca: 'Os riscos com score ≥ 15 são a fila de trabalho da sua revisão trimestral.',
          auditor: 'A matriz é leitura. O histórico de reclassificações fica no audit trail (T6).',
        }}
      />

      <div className="grid g-2-1">
        <Cartao
          titulo="Matriz probabilidade × impacto"
          hint="cada risco é um botão: Tab navega, Enter seleciona, setas ajustam P e I"
        >
          {/* T5-01 — grade HTML no lugar do SVG. O arrasto continua como atalho,
              mas deixou de ser o único caminho: a bolha não era focável, não
              respondia a teclado e o gesto disputava com a rolagem no telefone. */}
          <div className="matriz" role="grid" aria-label="Matriz de risco: probabilidade por impacto">
            {linhas.map((i) => (
              <div className="matriz-linha" role="row" key={i}>
                {NIVEIS.map((p) => {
                  const aqui = riscos.filter((r) => {
                    const a = ajuste?.codigo === r.codigo ? ajuste : null;
                    const arr = arrasto?.risco.codigo === r.codigo ? arrasto : null;
                    const rp = arr?.p ?? a?.p ?? r.probabilidade;
                    const ri = arr?.i ?? a?.i ?? r.impacto;
                    return rp === p && ri === i;
                  });
                  return (
                    <div
                      key={p}
                      role="gridcell"
                      // PR 8 — a faixa é a D2, não um limiar escrito aqui. Mudar
                      // o corte na tabela muda a cor da grade sem tocar nesta tela;
                      // era esse o segundo modelo de risco que o MAPA proíbe.
                      className={`matriz-celula ${tomDoRisco(p, i)}`}
                      aria-label={`Probabilidade ${p}, impacto ${i}, score ${p * i} · ${nivelDoRisco(p, i)}`}
                      onPointerUp={() => {
                        if (!arrasto) return;
                        const a = { ...arrasto, p, i };
                        setArrasto(null);
                        if (p !== a.risco.probabilidade || i !== a.risco.impacto) setPendente(a);
                      }}
                      onPointerEnter={() => { if (arrasto) setArrasto({ ...arrasto, p, i }); }}
                    >
                      {aqui.map((r) => {
                        const rascunho = ajuste?.codigo === r.codigo;
                        return (
                          <button
                            key={r.codigo}
                            type="button"
                            className={`risco-pill ${r.status === 'mitigado' ? 'mitigado' : ''} ${sel === r.codigo ? 'sel' : ''} ${rascunho ? 'rascunho' : ''}`}
                            style={{ background: CORES_DANO[r.dano] }}
                            aria-pressed={sel === r.codigo}
                            // C-12 — o que estava só no `title` do SVG passa a ser
                            // nome acessível. Leitor de tela e mouse recebem a
                            // mesma informação.
                            aria-label={`${r.codigo}: ${r.descricao} · P ${r.probabilidade} × I ${r.impacto} · score ${r.probabilidade * r.impacto} · ${r.status.replace('_', ' ')}`}
                            onClick={() => { setSel(r.codigo); if (ajuste?.codigo !== r.codigo) setAjuste(null); }}
                            onKeyDown={(e) => teclaNaGrade(e, r)}
                            onPointerDown={() => { setSel(r.codigo); setArrasto({ risco: r, p: r.probabilidade, i: r.impacto }); }}
                          >
                            {r.codigo}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="matriz-eixos">
            <span>probabilidade 1 → 5</span>
            <span>impacto 5 (topo) → 1</span>
          </div>
          <div className="legend">
            <span><i className="dot" style={{ background: 'var(--crit)' }} /> Material</span>
            <span><i className="dot" style={{ background: 'var(--warn)' }} /> Moral / perda de controle</span>
            <span><i className="dot" style={{ background: 'var(--sens)' }} /> Discriminação</span>
          </div>
        </Cartao>

        <div className="stack">
          <Cartao titulo={`${selecionado.codigo} · ${selecionado.descricao}`}>
            <dl className="kv">
              <dt>Score</dt>
              <dd><b className="mono">{selecionado.probabilidade * selecionado.impacto}</b>{' '}
                <span className="hint">(P {selecionado.probabilidade} × I {selecionado.impacto})</span></dd>
              <dt>Dano ao titular</dt><dd>{selecionado.danoTexto}</dd>
              <dt>Tratamento</dt><dd>{selecionado.tratamento}</dd>
              <dt>Tipo</dt><dd>{selecionado.tipo}</dd>
              <dt>Dono</dt><dd className="mono">{selecionado.dono} · {selecionado.dominio}</dd>
              <dt>Prazo</dt><dd>{selecionado.prazo} · reavaliar em {selecionado.reavaliacao}</dd>
              <dt>Status</dt>
              <dd>
                <Pill tom={selecionado.status === 'mitigado' ? 'ok' : selecionado.status === 'identificado' ? 'crit' : 'warn'}>
                  {selecionado.status.replace('_', ' ')}
                </Pill>
              </dd>
            </dl>
            <NivelD2 risco={selecionado} />
            <div className="row" style={{ marginTop: 12 }}>
              <Permitido
                acao="gerenciar_risco"
                alternativa={<Nota>Reclassificar risco é ato do DPO. A matriz continua legível para o seu papel.</Nota>}
              >
                <button className="btn primary" onClick={() => abrirAjuste(selecionado)}>Reclassificar P × I</button>
              </Permitido>
              {selecionado.ripdCodigo && <Link className="btn" to="/t3">Ver {selecionado.ripdCodigo} →</Link>}
            </div>
          </Cartao>

          {emAjuste && (
            <Permitido acao="gerenciar_risco">
              <Cartao titulo="Nova classificação">
                <p className="mono" style={{ margin: 0, fontSize: 12.5, color: 'var(--text-2)' }}>
                  P {selecionado.probabilidade} → {emAjuste.p} · I {selecionado.impacto} → {emAjuste.i} ·
                  {' '}score {selecionado.probabilidade * selecionado.impacto} → {emAjuste.p * emAjuste.i}
                </p>
                <div className="row" style={{ marginTop: 12, gap: 18 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>Probabilidade</span>
                    <button className="stepper-num" aria-label="Diminuir probabilidade" onClick={() => mover(-1, 0)}>−</button>
                    <span className="mono" aria-live="polite">{emAjuste.p}</span>
                    <button className="stepper-num" aria-label="Aumentar probabilidade" onClick={() => mover(1, 0)}>+</button>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>Impacto</span>
                    <button className="stepper-num" aria-label="Diminuir impacto" onClick={() => mover(0, -1)}>−</button>
                    <span className="mono" aria-live="polite">{emAjuste.i}</span>
                    <button className="stepper-num" aria-label="Aumentar impacto" onClick={() => mover(0, 1)}>+</button>
                  </div>
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <button
                    className="btn primary"
                    disabled={emAjuste.p === selecionado.probabilidade && emAjuste.i === selecionado.impacto}
                    onClick={aplicar}
                  >
                    Registrar reclassificação
                  </button>
                  <button className="btn" onClick={() => setAjuste(null)}>Descartar</button>
                </div>
                <Nota>
                  O ajuste acima é rascunho: nada foi gravado. Registrar abre a justificativa obrigatória —
                  ajustar por teclado não cria caminho de escrita sem registro.
                </Nota>
              </Cartao>
            </Permitido>
          )}

          <Cartao titulo="Risco por domínio" hint="onde a dívida está concentrada">
            {Object.entries(dominios).sort((a, b) => b[1].soma - a[1].soma).map(([nome, d]) => (
              <div key={nome} style={{ marginBottom: 9 }}>
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span>{nome} {d.criticos > 0 && <Pill tom="crit">{d.criticos} crítico{d.criticos > 1 ? 's' : ''}</Pill>}</span>
                  <span className="mono">{d.soma}</span>
                </div>
                <div className="meter"><i className={d.criticos ? 'crit' : ''} style={{ width: `${(d.soma / maior) * 100}%` }} /></div>
              </div>
            ))}
          </Cartao>

          <Cartao titulo="Reclassificações registradas" hint="imutáveis">
            {banco.reclassificacoes.length === 0
              ? <Nota>Nenhuma neste cenário. Selecione um risco e use "Reclassificar P × I" — o registro fica aqui com a justificativa anexada.</Nota>
              : banco.reclassificacoes.map((r, i) => (
                <div key={i} style={{ paddingBottom: 8, borderBottom: '1px solid var(--line)', marginBottom: 8 }}>
                  <div className="mono" style={{ fontSize: 12.5 }}>
                    {r.codigo}: P{r.de.p}→{r.para.p} · I{r.de.i}→{r.para.i} · {r.ator}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{r.justificativa}</div>
                </div>
              ))}
            {/* T5-02 — o card dizia "imutáveis" e a troca de cenário apagava tudo. */}
            <Nota>
              Cada cenário guarda o próprio banco e o próprio histórico: trocar de cenário e voltar
              reencontra estes registros. Nada aqui é descartável, nem com confirmação.
            </Nota>
          </Cartao>
        </div>
      </div>

      <div className="sec-title">Quem responde por quê</div>
      <MatrizRaci />

      {pendente && (
        <ModalReclassificar
          risco={pendente.risco}
          p={pendente.p}
          i={pendente.i}
          aoFechar={(aplicado) => {
            setPendente(null);
            if (aplicado) setAjuste(null);
          }}
        />
      )}
    </>
  );
}

/**
 * PR 8 — o nível do risco, decidido pela D2 e gravado com a versão aplicada.
 *
 * Duas maneiras de a decisão gravada ficar para trás, e as duas aparecem em vez
 * de serem corrigidas em silêncio: a tabela ganhou versão nova, ou o risco foi
 * reclassificado depois. Recalcular calado seria mais bonito e resolveria o
 * problema errado — quem defende a priorização meses depois precisa do que foi
 * decidido, não do que a conta daria hoje.
 */
function NivelD2({ risco }: { risco: Risco }) {
  const chamar = useSessao((s) => s.chamar);
  const avisar = useSessao((s) => s.avisar);
  const reg = ultimaDecisao(risco.decisoes, 'd2');
  const vigente = vigenteDe('d2').versao;

  const aplicarD2 = () => {
    const res = chamar<DecisaoRegistrada>(
      { metodo: 'POST', caminho: '/v1/dmn/d2/aplicar', body: { id: risco.codigo } }, 'dmn-d2',
    );
    if (res.status === 200) {
      avisar('ok', `D2@${res.body.versao} aplicada a ${risco.codigo} e registrada.`);
      useSessao.setState((s) => ({ versao: s.versao + 1 }));
    }
  };

  const botao = (rotulo: string) => (
    <Permitido acao="escrever" alternativa={null}>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn" onClick={aplicarD2}>{rotulo}</button>
      </div>
    </Permitido>
  );

  if (!reg) {
    return (
      <>
        <Nota>Nenhuma decisão da D2 gravada para {risco.codigo}. A cor da célula na matriz já sai da tabela;
          o que falta é o registro de qual versão decidiu este risco.</Nota>
        {botao(`Aplicar D2 (d2@${vigente})`)}
        <Recusa ancora="dmn-d2" />
      </>
    );
  }

  const desatualizada = reg.versao !== vigente;
  const mudouOArtefato = reg.entradas.probabilidade !== risco.probabilidade
    || reg.entradas.impacto !== risco.impacto;
  const conferencia = reproduzir(reg);
  const hoje = desatualizada ? aplicarTabela('d2', reg.entradas) : null;

  return (
    <>
      <p style={{ margin: '10px 0 0', fontSize: 12.5 }}>{reg.frase}</p>
      <div className="row" style={{ marginTop: 6, gap: 8 }}>
        <span className="hash">d2@{reg.versao}</span>
        <span className="hint">
          {conferencia.confere ? 'reproduz a mesma saída' : `não reproduz: ${conferencia.motivo}`}
        </span>
      </div>
      {mudouOArtefato && (
        <Nota tom="warn">
          Decidida com P {String(reg.entradas.probabilidade)} × I {String(reg.entradas.impacto)}; o risco hoje
          está em P {risco.probabilidade} × I {risco.impacto}. A decisão não acompanha a reclassificação —
          aplicar de novo grava uma decisão nova, com as entradas de agora.
          {botao('Aplicar D2 com o P × I atual')}
        </Nota>
      )}
      {hoje && (
        <Nota tom="warn">
          A versão vigente é <span className="mono">d2@{vigente}</span>: para as mesmas entradas ela
          responderia <b>{hoje.frase}</b>. Prévia, não decisão.
          {botao(`Reaplicar com d2@${vigente}`)}
        </Nota>
      )}
      <Recusa ancora="dmn-d2" />
    </>
  );
}

/**
 * T5-03 — só é botão a célula que a ação alcança.
 *
 * Antes, **toda** letra da matriz era um `<button>` que existia para negar:
 * clicar em qualquer uma disparava recusa, e quem já era accountable não fazia
 * nada. Um controle cuja única função é dizer não ensina a não clicar, e de
 * quebra polui a navegação por teclado com 60 paradas inúteis.
 *
 * Agora a matriz é texto — com o papel escrito por extenso, não só a letra
 * (C-12) — e a demonstração da recusa vira um controle honesto por linha,
 * atrás das mesmas duas condições do bloco de ataque da T6.
 */
function MatrizRaci() {
  const banco = useSessao((s) => s.banco);
  const avisar = useSessao((s) => s.avisar);
  const DOMINIOS = ['DPO', 'Jurídico', 'Segurança', 'Engenharia', 'Produto', 'Dados'];
  const PORTEXTENSO: Record<string, string> = {
    R: 'responsável pela execução', A: 'accountable pela decisão',
    C: 'consultado', I: 'informado', '—': 'não participa',
  };

  return (
    <Cartao titulo="Matriz RACI" hint="um único accountable por processo — a plataforma recusa o segundo">
      <Tabela cabecalho={['Processo', ...DOMINIOS, banco.modoDemo ? 'Demonstração' : '']}>
        {banco.cenario.raci.map((linha) => {
          const accountable = Object.entries(linha.letras).find(([, v]) => v === 'A')?.[0];
          return (
            <tr key={linha.processo} className="raci">
              <td>{linha.processo}</td>
              {DOMINIOS.map((dom) => (
                <td key={dom} style={{ textAlign: 'center' }}>
                  <span className={`letter ${linha.letras[dom]}`} title={`${dom}: ${PORTEXTENSO[linha.letras[dom]] ?? linha.letras[dom]}`}>
                    {linha.letras[dom]}
                  </span>
                  <span className="visually-hidden">{PORTEXTENSO[linha.letras[dom]] ?? linha.letras[dom]}</span>
                </td>
              ))}
              {banco.modoDemo && (
                <td>
                  <Permitido acao="escrever">
                    <button
                      className="reveal"
                      onClick={() => avisar('negado',
                        `${linha.processo} já tem accountable: ${accountable}.`,
                        'Índice único parcial no banco garante um único "A" por processo — não é disciplina do preenchedor.')}
                    >
                      Tentar um segundo accountable
                    </button>
                  </Permitido>
                </td>
              )}
            </tr>
          );
        })}
      </Tabela>
      <Nota>
        Engenharia é o único domínio que <b>executa</b> controle técnico. Jurídico escreve o contrato e o DPO
        documenta a base legal, mas RLS, redação de log e pseudonimização só existem se alguém escrever o código.
      </Nota>
    </Cartao>
  );
}
