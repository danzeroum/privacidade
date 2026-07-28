import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cabecalho, Cartao, Didatico, Kpi, Nota, Pill, Tabela, Permitido } from '../ui/primitivos';
import { Estados, useRecurso } from '../ui/estados';
import { CORES_DANO } from '../ui/reclassificar';
import { useSessao } from '../store/sessao';
import type { Risco } from '../mock/types';

export default function T1() {
  const banco = useSessao((s) => s.banco);
  useSessao((s) => s.versao); // redesenha quando a API escreve
  const avisar = useSessao((s) => s.avisar);
  const setRisco = useSessao((s) => s.setRisco);
  // T1-02 — a simulação é estado da sessão: navegar para outra tela e voltar
  // não pode apagar a marca de que o painel está exibindo cenário fabricado.
  const incidente = useSessao((s) => s.simulandoViolacao);
  const setSimulacao = useSessao((s) => s.setSimulacao);
  const [aberto, setAberto] = useState<string | null>(null);
  const [emFoco, setEmFoco] = useState<Risco | null>(null);

  const { metricas, maturidade, gates } = banco.cenario;
  // C-13 — o gráfico também passa pelos quatro estados. Um mapa de risco que
  // aparece do nada é indistinguível de um mapa que carregou vazio.
  const recursoRiscos = useRecurso<Risco[]>({ metodo: 'GET', caminho: '/v1/risks' });
  const riscos = recursoRiscos.dados ?? [];
  const bloqueados = gates.filter((g) => g.bloqueouMerge);
  const comAviso = gates.filter((g) => !g.bloqueouMerge && g.findings.length > 0);
  const limpos = gates.filter((g) => !g.bloqueouMerge && g.findings.length === 0);

  const riscosVisiveis: Risco[] = incidente
    ? [...riscos, {
        codigo: 'R11', descricao: 'Incidente simulado: exfiltração por API legítima',
        probabilidade: 5, impacto: 5, dano: 'material',
        danoTexto: 'Token válido extraiu a base inteira sem disparar alerta',
        tratamento: 'Rate limit por ator + paginação por cursor + alerta de volume',
        tipo: 'mitigar', esforcoSprints: 0.75, dono: '@seg-rita', dominio: 'Segurança',
        prazo: 'imediato', reavaliacao: '30 dias', status: 'identificado',
      }]
    : riscos;

  return (
    <>
      <Cabecalho
        fontes={['metrics-collector.py', 'privacy-ci-gate.yml', 'architecture-review.yml', 'risk-matrix.csv']}
        titulo="Painel de governança"
        resumo="O estado da privacidade em 30 segundos: maturidade, risco concentrado, o que a esteira barrou hoje e para onde as métricas do mês se moveram."
        nota={{
          engenharia: 'Comece pelos PRs bloqueados — cada linha traz o arquivo, a regra e a correção. As métricas do topo são consequência do que a esteira deixa passar.',
          dpo: 'O scorecard e o mapa de calor são o material do comitê. Cada número vem de um snapshot imutável: dá para reproduzir o que você apresentou mês passado.',
          produto: 'Use o mapa de calor para negociar prazo: bolhas à esquerda custam menos de uma sprint e derrubam risco alto.',
          seguranca: 'Os PRs bloqueados mostram onde o controle técnico ainda não existe. O mapa indica onde a superfície de ataque encontra dado pessoal.',
          auditor: 'Tudo aqui é leitura. Os números vêm de snapshots imutáveis e podem ser confrontados com o audit trail na T6.',
        }}
      />

      {/* T1-02 — a simulação injetava R11 no mesmo gráfico do comitê, com a
          mesma aparência dos riscos reais. Uma captura de tela sairia daqui
          contando uma violação que não aconteceu. A faixa é fixa enquanto a
          simulação estiver ativa, e a bolha fabricada é tracejada. */}
      {incidente && (
        <div className="banner crit" role="status" style={{ marginBottom: 16 }}>
          <span className="mark">🧪</span>
          <div style={{ flex: 1 }}>
            <h4>Simulação ativa — este painel não representa o cenário real</h4>
            <p>
              R11 é um risco fabricado para demonstração e aparece tracejado no mapa. Nenhum número desta
              tela serve de evidência enquanto esta faixa estiver aqui.
            </p>
          </div>
          <Permitido acao="escrever">
            <button className="btn" onClick={() => { setSimulacao(false); avisar('info', 'Simulação encerrada: o painel voltou ao cenário real.'); }}>
              Encerrar simulação
            </button>
          </Permitido>
        </div>
      )}

      <div className="grid g4">
        {metricas.map((m) => {
          const delta = m.valor - m.anterior;
          const melhorou = m.melhorQuandoSobe ? delta > 0 : delta < 0;
          const pct = m.unidade === 'percentual' ? m.valor : Math.min(100, (m.valor / m.meta) * 100);
          return (
            <Kpi
              key={m.chave}
              rotulo={m.rotulo}
              valor={m.unidade === 'contagem' ? String(m.valor) : m.valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
              sufixo={m.unidade === 'percentual' ? '%' : m.unidade === 'horas' ? 'h' : undefined}
              serie={m.serie}
              barra={{ pct, tom: pct >= m.meta ? 'ok' : pct >= m.meta * 0.9 ? 'warn' : 'crit' }}
              rodape={<>
                <span className={`trend ${melhorou ? 'bom' : delta === 0 ? 'igual' : 'ruim'}`}>
                  {delta === 0 ? '–' : delta > 0 ? '↑' : '↓'} {Math.abs(delta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                </span>
                <span>vs. mês anterior · meta {m.meta}{m.unidade === 'percentual' ? '%' : ''}</span>
              </>}
            />
          );
        })}
      </div>

      <div className="sec-title">Maturidade e concentração de risco</div>
      <div className="grid g-1-2">
        <Cartao titulo="Scorecard NIST Privacy Framework" hint="clique para ver a evidência">
          {maturidade.map((m) => (
            <div key={m.dominio}>
              <button
                className="row"
                style={{ width: '100%', border: 0, background: 'none', cursor: 'pointer', padding: '8px', justifyContent: 'space-between' }}
                aria-expanded={aberto === m.dominio}
                onClick={() => setAberto(aberto === m.dominio ? null : m.dominio)}
              >
                <span style={{ fontSize: 13 }}>{m.dominio}</span>
                <span className="row" style={{ gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <i key={n} style={{
                      width: 18, height: 8, borderRadius: 2, display: 'inline-block',
                      background: n <= m.score ? 'var(--accent)' : 'var(--surface-3)',
                    }} />
                  ))}
                  <span className="mono">{m.score.toFixed(1)}</span>
                  <span className={`trend ${m.score > m.anterior ? 'bom' : 'igual'}`}>
                    {m.score > m.anterior ? '↑' : '–'}
                  </span>
                </span>
              </button>
              {aberto === m.dominio && (
                <ul style={{ margin: '0 0 12px', paddingLeft: 26, fontSize: 12.5, color: 'var(--text-2)' }}>
                  {m.evidencias.map((e) => <li key={e}>{e}</li>)}
                </ul>
              )}
            </div>
          ))}
          <Didatico>
            <Nota>
              Nota sem lastro é slide. Cada domínio expande mostrando a evidência que sustenta o número.
            </Nota>
          </Didatico>
        </Cartao>

        <Cartao
          titulo="Mapa de calor de riscos"
          acao={
            <Permitido acao="escrever">
              <button className="btn" onClick={() => { setSimulacao(!incidente); avisar('info', incidente ? 'Simulação encerrada: o painel voltou ao cenário real.' : 'Simulação ativa: R11 é fabricado e está marcado como tal.'); }}>
                {incidente ? 'Encerrar simulação' : 'Simular violação'}
              </button>
            </Permitido>
          }
        >
          <Estados
            recurso={recursoRiscos}
            rotulo="o mapa de riscos"
            vazio={<><b>Nenhum risco catalogado neste cenário.</b>
              <p className="hint" style={{ margin: '6px 0 0' }}>
                O mapa sai do <span className="mono">risk-matrix.csv</span>; sem linhas lá, não há o que priorizar.
              </p></>}
          >
            {() => <Dispersao riscos={riscosVisiveis} simulando={incidente} aoSelecionar={(r) => setEmFoco(r)} />}
          </Estados>
          <div className="legend">
            <span><i className="dot" style={{ background: 'var(--crit)' }} /> Material</span>
            <span><i className="dot" style={{ background: 'var(--warn)' }} /> Moral / perda de controle</span>
            <span><i className="dot" style={{ background: 'var(--sens)' }} /> Discriminação</span>
            <span style={{ color: 'var(--text-3)' }}>Bolha maior = ainda não mitigado · clique para ver o risco</span>
          </div>

          {/* T1-01 — este mapa é esforço × score; a matriz da T5 é P × I. Abrir
              o mesmo diálogo de reclassificação a partir dos dois fazia a pessoa
              ajustar eixos que não são os que ela estava lendo. Aqui o clique
              informa e encaminha; quem reclassifica é a matriz certa. */}
          {emFoco && (
            <div className="card" style={{ marginTop: 12, background: 'var(--surface-2)' }} role="status">
              <div className="card-head">
                <h3 style={{ fontSize: 14 }}>{emFoco.codigo} · {emFoco.descricao}</h3>
                <button className="reveal" onClick={() => setEmFoco(null)}>fechar</button>
              </div>
              <dl className="kv">
                <dt>Score</dt><dd className="mono">{emFoco.probabilidade * emFoco.impacto} (P {emFoco.probabilidade} × I {emFoco.impacto})</dd>
                <dt>Esforço</dt><dd>{emFoco.esforcoSprints} sprint · dono {emFoco.dono}</dd>
                <dt>Tratamento</dt><dd>{emFoco.tratamento}</dd>
              </dl>
              {emFoco.codigo === 'R11' ? (
                <Nota tom="warn">Risco fabricado pela simulação: não existe na matriz e não é reclassificável.</Nota>
              ) : (
                <div className="row" style={{ marginTop: 10 }}>
                  <Link className="btn" to="/t5" onClick={() => setRisco(emFoco.codigo)}>
                    Reclassificar na matriz P × I →
                  </Link>
                  <span className="hint">
                    este mapa é esforço × score; reclassificar acontece na matriz de probabilidade e impacto
                  </span>
                </div>
              )}
            </div>
          )}
        </Cartao>
      </div>

      <div className="sec-title">Esteira de entrega — hoje</div>
      <div className="grid g3">
        <Kpi rotulo="PRs bloqueados" valor={String(bloqueados.length)} rodape="gate crítico acionado · exige RIPD aprovado" />
        <Kpi rotulo="Aprovados com aviso" valor={String(comAviso.length)} rodape="registrado no ROPA, merge liberado" />
        <Kpi rotulo="Aprovados limpos" valor={String(limpos.length)} rodape="nenhum gatilho de RIPD nas últimas 24 h" />
      </div>

      <Cartao
        titulo="O que a esteira barrou"
        hint="mensagem traduzida do workflow — o log cru fica um clique adiante"
        className="mt"
      >
        {gates.every((g) => g.findings.length === 0) && (
          <Nota>Nenhum achado em aberto neste cenário.</Nota>
        )}
        <Tabela cabecalho={['PR', 'Repositório', 'Regra', 'O que aconteceu', 'Como resolver', '']}>
          {gates.flatMap((g) => g.findings.map((f, i) => (
            <tr key={`${g.id}-${i}`}>
              <td className="mono">#{g.prNumero}</td>
              <td>{g.repositorio}</td>
              <td><Pill tom={f.severidade === 'critica' ? 'crit' : f.severidade === 'alta' ? 'crit' : 'warn'}>{f.regra}</Pill></td>
              <td style={{ maxWidth: 340 }}>{f.mensagemHumana}</td>
              <td style={{ maxWidth: 280 }}>
                {f.comoCorrigir}
                <Permitido acao="ver_gate_detalhe">
                  <details style={{ marginTop: 6 }}>
                    <summary className="hint" style={{ cursor: 'pointer' }}>log cru do workflow</summary>
                    <code className="hash">{f.mensagemBruta}</code>
                    {f.arquivo && <div className="hash">{f.arquivo}{f.linha ? `:${f.linha}` : ''}</div>}
                  </details>
                </Permitido>
              </td>
              <td><Link className="btn ghost" to="/t3">Abrir RIPD →</Link></td>
            </tr>
          )))}
        </Tabela>
      </Cartao>

    </>
  );
}

/** Dispersão esforço × score. Colisões são resolvidas no eixo do esforço, que é
 *  estimativa — nunca no eixo do score, que é o número usado para decidir. */
function Dispersao({ riscos, simulando, aoSelecionar }: {
  riscos: Risco[]; simulando: boolean; aoSelecionar: (r: Risco) => void;
}) {
  const W = 620, H = 300, ml = 46, mb = 36, mt = 14, mr = 14;
  const maxEsforco = Math.max(2.25, ...riscos.map((r) => r.esforcoSprints + 0.3));
  const x = (v: number) => ml + (v / maxEsforco) * (W - ml - mr);
  const y = (v: number) => H - mb - (v / 25) * (H - mb - mt);

  const pts = riscos.map((r) => ({
    r, cx: x(r.esforcoSprints), cy: y(r.probabilidade * r.impacto),
    raio: 10 + (r.status === 'identificado' || r.status === 'avaliado' ? 4 : r.status === 'em_tratamento' ? 2 : 0),
  }));
  for (let volta = 0; volta < 12; volta++) {
    let mexeu = false;
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const A = pts[a], B = pts[b];
        const dx = B.cx - A.cx, dy = B.cy - A.cy;
        const dist = Math.hypot(dx, dy), min = A.raio + B.raio + 3;
        if (dist < min) {
          const empurra = (min - dist) / 2 + 0.5;
          const sinal = dx === 0 ? (a % 2 ? 1 : -1) : Math.sign(dx);
          A.cx -= sinal * empurra; B.cx += sinal * empurra;
          mexeu = true;
        }
      }
    }
    if (!mexeu) break;
  }

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dispersão de riscos por esforço e score">
      <rect x={ml} y={y(25)} width={x(1.05) - ml} height={y(14) - y(25)} fill="var(--crit)" opacity={0.07} />
      <text x={ml + 8} y={y(24) + 4} fontSize={11} fill="var(--crit)">alto impacto, baixo esforço — resolver primeiro</text>
      {[0, 5, 10, 15, 20, 25].map((v) => (
        <g key={v}>
          <line x1={ml} x2={W - mr} y1={y(v)} y2={y(v)} stroke="var(--line)" />
          <text x={ml - 8} y={y(v) + 4} textAnchor="end" fontSize={11}>{v}</text>
        </g>
      ))}
      {[0.5, 1, 1.5, 2].map((v) => (
        <text key={v} x={x(v)} y={H - mb + 16} textAnchor="middle" fontSize={11}>{v} sp</text>
      ))}
      <text x={12} y={H / 2} fontSize={11} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>score (P × I)</text>
      <text x={(W + ml) / 2} y={H - 4} fontSize={11} textAnchor="middle">esforço estimado</text>

      {pts.map(({ r, cx, cy, raio }) => (
        /* T1-03 — a bolha era botão pela metade: `role="button"` sem Espaço,
           sem nome acessível além do `<title>` e sem foco visível. Agora é
           botão inteiro — Enter e Espaço, `aria-label` com o que o `<title>`
           dizia, e o `<title>` fica como redundância para o mouse (C-12). */
        <g
          key={r.codigo}
          className="bub"
          role="button"
          tabIndex={0}
          aria-label={`${r.codigo}: ${r.descricao}. Score ${r.probabilidade * r.impacto}, esforço ${r.esforcoSprints} sprint, ${r.status.replace('_', ' ')}${r.codigo === 'R11' && simulando ? '. Risco simulado' : ''}. Abre o detalhe.`}
          onClick={() => aoSelecionar(r)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
              e.preventDefault();
              aoSelecionar(r);
            }
          }}
        >
          <title>{`${r.codigo} · ${r.descricao} · score ${r.probabilidade * r.impacto} · ${r.status}${r.codigo === 'R11' && simulando ? ' · SIMULADO' : ''}`}</title>
          <circle
            cx={cx} cy={cy} r={raio}
            fill={r.codigo === 'R11' && simulando ? 'none' : CORES_DANO[r.dano]}
            stroke={r.codigo === 'R11' && simulando ? CORES_DANO[r.dano] : 'none'}
            strokeWidth={2.5}
            strokeDasharray={r.codigo === 'R11' && simulando ? '5 3' : undefined}
            opacity={r.status === 'mitigado' ? 0.38 : 0.88}
          />
          <text x={cx} y={cy + 3.5} className="bub-label" textAnchor="middle"
                fill={r.codigo === 'R11' && simulando ? CORES_DANO[r.dano] : undefined}>{r.codigo}</text>
        </g>
      ))}
    </svg>
  );
}
