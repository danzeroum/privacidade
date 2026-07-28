import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cabecalho, Cartao, Nota, Pill, Tabela } from '../ui/primitivos';
import { ModalReclassificar, CORES_DANO } from '../ui/reclassificar';
import { useSessao } from '../store/sessao';
import type { Risco } from '../mock/types';

const M = { W: 560, H: 430, ml: 52, mb: 46, mt: 12, mr: 12 };
const cw = (M.W - M.ml - M.mr) / 5;
const ch = (M.H - M.mt - M.mb) / 5;
const mx = (p: number) => M.ml + (p - 0.5) * cw;
const my = (i: number) => M.H - M.mb - (i - 0.5) * ch;

export default function T5() {
  const banco = useSessao((s) => s.banco);
  const avisar = useSessao((s) => s.avisar);
  useSessao((s) => s.versao);

  const riscos = banco.cenario.riscos;
  const [sel, setSel] = useState(riscos[0]?.codigo ?? '');
  const [arrasto, setArrasto] = useState<{ risco: Risco; p: number; i: number } | null>(null);
  const [pendente, setPendente] = useState<{ risco: Risco; p: number; i: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const selecionado = riscos.find((r) => r.codigo === sel) ?? riscos[0];

  const paraGrade = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return null;
    const l = pt.matrixTransform(m.inverse());
    return {
      p: Math.min(5, Math.max(1, Math.ceil((l.x - M.ml) / cw))),
      i: Math.min(5, Math.max(1, Math.ceil((M.H - M.mb - l.y) / ch))),
    };
  };

  const dominios = riscos.reduce<Record<string, { total: number; soma: number; criticos: number }>>((acc, r) => {
    const d = acc[r.dominio] ?? { total: 0, soma: 0, criticos: 0 };
    d.total += 1; d.soma += r.probabilidade * r.impacto;
    if (r.probabilidade * r.impacto >= 15) d.criticos += 1;
    acc[r.dominio] = d;
    return acc;
  }, {});
  const maior = Math.max(...Object.values(dominios).map((d) => d.soma), 1);

  return (
    <>
      <Cabecalho
        fontes={['docs/risk-matrix.csv', 'RACI']}
        titulo="Riscos e RACI"
        resumo="Dez riscos, um dono cada, prazo e data de reavaliação. Arrastar uma bolha muda a prioridade do programa — por isso exige justificativa registrada."
        nota={{
          engenharia: 'Risco com dono de engenharia vira tarefa. Score alto com esforço baixo é o que entra na sprint primeiro.',
          dpo: 'Arrastar uma bolha exige justificativa e fica no histórico. É assim que você defende a priorização meses depois.',
          produto: 'O RACI mostra quem decide o quê. Se um processo trava, a pessoa accountable está nesta tabela.',
          seguranca: 'Os riscos com score ≥ 15 são a fila de trabalho da sua revisão trimestral.',
          auditor: 'A matriz é leitura. O histórico de reclassificações fica no audit trail (T6).',
        }}
      />

      <div className="grid g-2-1">
        <Cartao titulo="Matriz 5 × 5" hint="arraste para reclassificar · clique para ver o detalhe">
          <svg
            ref={svgRef}
            className="chart"
            viewBox={`0 0 ${M.W} ${M.H}`}
            role="img"
            aria-label="Matriz de risco: probabilidade por impacto"
            onPointerMove={(e) => {
              if (!arrasto) return;
              const g = paraGrade(e);
              if (g && (g.p !== arrasto.p || g.i !== arrasto.i)) setArrasto({ ...arrasto, ...g });
            }}
            onPointerUp={() => {
              if (!arrasto) return;
              const a = arrasto;
              setArrasto(null);
              if (a.p !== a.risco.probabilidade || a.i !== a.risco.impacto) setPendente(a);
            }}
          >
            {[1, 2, 3, 4, 5].flatMap((p) => [1, 2, 3, 4, 5].map((i) => {
              const s = p * i;
              return (
                <rect
                  key={`${p}-${i}`}
                  x={M.ml + (p - 1) * cw} y={M.H - M.mb - i * ch} width={cw} height={ch}
                  fill={s >= 15 ? 'var(--crit)' : s >= 8 ? 'var(--warn)' : 'var(--ok)'}
                  opacity={0.1} stroke="var(--line)"
                />
              );
            }))}
            {[1, 2, 3, 4, 5].map((n) => (
              <g key={n}>
                <text x={mx(n)} y={M.H - M.mb + 17} textAnchor="middle" fontSize={11}>{n}</text>
                <text x={M.ml - 12} y={my(n) + 4} textAnchor="end" fontSize={11}>{n}</text>
              </g>
            ))}
            <text x={(M.ml + M.W) / 2} y={M.H - 8} textAnchor="middle" fontSize={11}>probabilidade →</text>
            <text x={16} y={(M.H - M.mb + M.mt) / 2} fontSize={11} textAnchor="middle"
                  transform={`rotate(-90 16 ${(M.H - M.mb + M.mt) / 2})`}>impacto →</text>

            {riscos.map((r) => {
              const emArrasto = arrasto?.risco.codigo === r.codigo;
              const p = emArrasto ? arrasto.p : r.probabilidade;
              const i = emArrasto ? arrasto.i : r.impacto;
              const irmaos = riscos.filter((o) => o.probabilidade === p && o.impacto === i);
              const k = irmaos.findIndex((o) => o.codigo === r.codigo);
              const off = !emArrasto && irmaos.length > 1 ? (k - (irmaos.length - 1) / 2) * 34 : 0;
              return (
                <g
                  key={r.codigo}
                  className="bub"
                  data-risco={r.codigo}
                  onPointerDown={(e) => {
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    setSel(r.codigo);
                    setArrasto({ risco: r, p: r.probabilidade, i: r.impacto });
                  }}
                >
                  <title>{r.descricao}</title>
                  <circle
                    cx={mx(p) + off} cy={my(i)} r={15}
                    fill={CORES_DANO[r.dano]}
                    opacity={r.status === 'mitigado' ? 0.42 : 0.9}
                    stroke={sel === r.codigo ? 'var(--text)' : 'none'}
                    strokeWidth={2}
                  />
                  <text x={mx(p) + off} y={my(i) + 4} className="bub-label" textAnchor="middle">{r.codigo}</text>
                </g>
              );
            })}
          </svg>
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
                <Pill tom={selecionado.status === 'mitigado' ? 'ok' : selecionado.status === 'aberto' ? 'crit' : 'warn'}>
                  {selecionado.status.replace('_', ' ')}
                </Pill>
              </dd>
            </dl>
            {selecionado.ripdCodigo && (
              <div className="row" style={{ marginTop: 12 }}>
                <Link className="btn" to="/t3">Ver {selecionado.ripdCodigo} →</Link>
              </div>
            )}
          </Cartao>

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
              ? <Nota>Nenhuma ainda. Arraste uma bolha na matriz.</Nota>
              : banco.reclassificacoes.map((r, i) => (
                <div key={i} style={{ paddingBottom: 8, borderBottom: '1px solid var(--line)', marginBottom: 8 }}>
                  <div className="mono" style={{ fontSize: 11.5 }}>
                    {r.codigo}: P{r.de.p}→{r.para.p} · I{r.de.i}→{r.para.i} · {r.ator}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{r.justificativa}</div>
                </div>
              ))}
          </Cartao>
        </div>
      </div>

      <div className="sec-title">Quem responde por quê</div>
      <Cartao titulo="Matriz RACI" hint="um único accountable por processo — a plataforma recusa o segundo">
        <Tabela cabecalho={['Processo', 'DPO', 'Jurídico', 'Segurança', 'Engenharia', 'Produto', 'Dados']}>
          {banco.cenario.raci.map((linha) => (
            <tr key={linha.processo} className="raci">
              <td>{linha.processo}</td>
              {['DPO', 'Jurídico', 'Segurança', 'Engenharia', 'Produto', 'Dados'].map((dom) => (
                <td key={dom} style={{ textAlign: 'center' }}>
                  <button
                    className={`letter ${linha.letras[dom]}`}
                    style={{ border: 0, cursor: 'pointer' }}
                    title="Tentar promover a accountable"
                    onClick={() => {
                      if (linha.letras[dom] === 'A') return;
                      avisar('negado',
                        `${linha.processo} já tem accountable: ${Object.entries(linha.letras).find(([, v]) => v === 'A')?.[0]}.`,
                        'Índice único parcial no banco garante um único "A" por processo — não é disciplina do preenchedor.');
                    }}
                  >
                    {linha.letras[dom]}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </Tabela>
        <Nota>
          Engenharia é o único domínio que <b>executa</b> controle técnico. Jurídico escreve o contrato e o DPO
          documenta a base legal, mas RLS, redação de log e pseudonimização só existem se alguém escrever o código.
        </Nota>
      </Cartao>

      {pendente && (
        <ModalReclassificar
          risco={pendente.risco}
          p={pendente.p}
          i={pendente.i}
          aoFechar={() => setPendente(null)}
        />
      )}
    </>
  );
}
