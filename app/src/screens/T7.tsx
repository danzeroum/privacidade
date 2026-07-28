import { Cabecalho, Cartao, Didatico, Nota, Permitido, Pill, Recusa, Tabela } from '../ui/primitivos';
import { useSessao } from '../store/sessao';

export default function T7() {
  const banco = useSessao((s) => s.banco);
  const chamar = useSessao((s) => s.chamar);
  useSessao((s) => s.versao);
  const { chaves, rotacao, acessosKms, campos } = banco.cenario;

  /**
   * T7-01 — a tela informava muito bem e não deixava fazer nada: quatro cartões
   * de leitura sobre um ciclo que alguém precisa operar. As duas ações que o
   * desenho pede passam pela API, com registro no trail — e a promoção do canary
   * é recusada enquanto a recriptografia não termina, porque promover no meio
   * deixa registro ilegível com a chave nova.
   */
  const agendar = (alias: string) =>
    chamar({ metodo: 'POST', caminho: `/v1/kms/${encodeURIComponent(alias)}/agendar-rotacao` }, 'kms-acao');
  const promover = (alias: string) =>
    chamar({ metodo: 'POST', caminho: `/v1/kms/${encodeURIComponent(alias)}/promover-canary` }, 'kms-acao');

  const semShredding = chaves.filter((c) => !c.criptoShredding && c.status !== 'revogada');
  const urgentes = chaves.filter((c) => c.rotacaoEmDias !== null && c.rotacaoEmDias <= 10 && c.status === 'ativa');

  return (
    <>
      <Cabecalho
        fontes={['kms-rotation.yml', 'pseudonymizer.ts']}
        titulo="Chaves e criptografia"
        resumo="Chave sem rotação é senha eterna. Esta tela mostra o ciclo em curso, quem depende de cada chave e onde destruir a chave equivale a destruir o dado."
        nota={{
          engenharia: 'A etapa de recriptografia é a que pode travar deploy: enquanto ela roda, os dois aliases precisam continuar válidos.',
          dpo: 'Cripto-shredding é o que permite cumprir eliminação em base imutável. Onde está "não suportado", só resta hard delete.',
          produto: 'Rotação não muda funcionalidade, mas a janela de canary pede atenção em lançamentos na mesma semana.',
          seguranca: 'O log de acesso é o espelho do CloudTrail. Toda negativa aqui merece revisão de escopo do principal.',
          auditor: 'A tabela de cripto-shredding mostra onde a eliminação é comprovável e onde depende de hard delete.',
        }}
      />

      <Permitido
        acao="ver_pipeline_rotacao"
        alternativa={
          <Nota>
            O pipeline de rotação de chaves não é renderizado para o seu papel — é operação de engenharia
            e segurança. O que interessa ao seu trabalho está nos quadros abaixo.
          </Nota>
        }
      >
        <Cartao
          titulo={`Rotação em curso — ${rotacao.chaveAntiga} → ${rotacao.chaveNova}`}
          acao={
            <span className="row">
              <button className="btn primary" onClick={() => agendar(rotacao.chaveNova)}>Agendar rotação</button>
              <button className="btn" onClick={() => promover(rotacao.chaveNova)}>Promover canary</button>
            </span>
          }
        >
          <Recusa ancora="kms-acao" />
          <div className="pipe">
            {rotacao.etapas.map((e, i) => (
              <div key={e.etapa} className={`pipe-step ${e.status}`}>
                <h5>{i + 1} · {e.rotulo}</h5>
                <p>{e.detalhe || '—'}</p>
                {e.status === 'executando' && (
                  <div className="meter" style={{ marginTop: 7 }}><i style={{ width: `${e.progresso}%` }} /></div>
                )}
                <div style={{ marginTop: 7 }}>
                  <Pill tom={e.status === 'concluida' ? 'ok' : e.status === 'executando' ? 'warn' : 'neutral'}>
                    {e.status === 'executando' ? `${e.progresso.toFixed(1)}%` : e.status}
                  </Pill>
                </div>
              </div>
            ))}
          </div>
        </Cartao>
      </Permitido>

      <div className="grid g-2-1" style={{ marginTop: 14 }}>
        <div className="stack">
          <Cartao titulo="Chaves" hint="uma única ativa por finalidade">
            <Tabela dense cabecalho={['Alias', 'Finalidade', 'Status', 'Criada', 'Rotação prevista', 'Cripto-shredding']}>
              {chaves.map((c) => (
                <tr key={c.alias} style={{ opacity: c.status === 'revogada' ? 0.6 : 1 }}>
                  <td className="mono">{c.alias}</td>
                  <td>{c.finalidade}</td>
                  <td>
                    <Pill tom={c.status === 'ativa' ? 'ok' : c.status === 'canary' ? 'warn' : 'neutral'}>{c.status}</Pill>
                  </td>
                  <td className="num">{c.criadaHaDias} d</td>
                  <td className="num" style={{ color: c.rotacaoEmDias !== null && c.rotacaoEmDias <= 10 ? 'var(--crit)' : undefined }}>
                    {c.rotacaoEmDias === null ? '—' : `em ${c.rotacaoEmDias} dias`}
                  </td>
                  <td><Pill tom={c.criptoShredding ? 'ok' : 'crit'}>{c.criptoShredding ? 'sim' : 'não'}</Pill></td>
                </tr>
              ))}
            </Tabela>
            {urgentes.length > 0 && (
              <Nota tom="warn">
                {urgentes.length} chave{urgentes.length > 1 ? 's' : ''} com rotação em 10 dias ou menos.
                Chave vencida não quebra o sistema — ela apenas para de proteger, em silêncio.
              </Nota>
            )}
          </Cartao>

          <Permitido
            acao="ver_log_kms"
            alternativa={<Nota>O log de acesso às chaves é restrito a engenharia e segurança.</Nota>}
          >
            <Cartao titulo="Log de acesso às chaves" hint="espelho do CloudTrail">
              <Tabela dense cabecalho={['Quando', 'Principal', 'Operação', 'Finalidade', 'Origem', '']}>
                {acessosKms.map((a, i) => (
                  <tr key={i} style={{ background: a.autorizado ? undefined : 'var(--crit-soft)' }}>
                    <td className="mono">{a.quando}</td>
                    <td className="mono" style={{ fontSize: 12.5 }}>{a.principal}</td>
                    <td>{a.operacao}</td>
                    <td>{a.finalidade}</td>
                    <td className="mono">{a.origemIp}</td>
                    <td><Pill tom={a.autorizado ? 'ok' : 'crit'}>{a.autorizado ? 'autorizado' : 'negado'}</Pill></td>
                  </tr>
                ))}
              </Tabela>
              {acessosKms.filter((a) => !a.autorizado).map((a, i) => (
                <p className="note crit" style={{ marginTop: 12 }} key={i}>
                  <b>Negativa registrada.</b> {a.principal} tentou <span className="mono">{a.operacao}</span> em
                  {' '}<span className="mono">{a.finalidade}</span>: {a.motivo}. O alerta já foi para o time de segurança.
                </p>
              ))}
            </Cartao>
          </Permitido>
        </div>

        <div className="stack">
          <Cartao titulo="Quem depende de cada chave">
            <svg className="chart" viewBox="0 0 330 250" role="img" aria-label="Árvore de dependências das chaves">
              {chaves.filter((c) => c.dependencias.length > 0).slice(0, 3).map((c, ci) => {
                const y = 20 + ci * 78;
                return (
                  <g key={c.alias}>
                    <rect x={8} y={y} width={150} height={34} rx={4} fill="var(--accent-soft)" stroke="var(--accent)" />
                    <text x={16} y={y + 15} fontSize={11} fontWeight={600} fill="var(--text)">{c.alias}</text>
                    <text x={16} y={y + 27} fontSize={11}>{c.status}</text>
                    {c.dependencias.map((d, di) => {
                      const dy = y + di * 40;
                      return (
                        <g key={d}>
                          <path d={`M158 ${y + 17} C174 ${y + 17} 184 ${dy + 17} 200 ${dy + 17}`} fill="none" stroke="var(--line-strong)" strokeWidth={1.3} />
                          <rect x={200} y={dy} width={118} height={34} rx={4} fill="var(--surface-2)" stroke="var(--line)" />
                          <text x={208} y={dy + 15} fontSize={11} fontWeight={600} fill="var(--text)">{d}</text>
                          <text x={208} y={dy + 27} fontSize={11}>dataset</text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
            <Didatico>
              <Nota>Destruir a chave torna o dataset ilegível — é a eliminação em base imutável.</Nota>
            </Didatico>
          </Cartao>

          {/* T7-02 — a lista misturava campos do catálogo e chaves do KMS na
              mesma `<dl>`, com o mesmo formato: `dataset.campo` ao lado de
              "Backup de banco de dados", como se fossem a mesma coisa. São dois
              inventários diferentes e duas perguntas diferentes. */}
          <Cartao titulo="Campos com cripto-shredding suportado" hint="destruir a chave = destruir o dado">
            <dl className="kv">
              {campos.filter((c) => c.tipoArmazenado === 'criptografado' || c.tipoArmazenado === 'hmac').map((c) => (
                <div key={c.id} style={{ display: 'contents' }}>
                  <dt className="mono">{c.dataset}.{c.nome}</dt>
                  <dd><Pill tom="ok">suportado</Pill> {c.tipoArmazenado === 'hmac' ? 'HMAC com chave no KMS' : 'DEK por registro'} · eliminação comprovável</dd>
                </div>
              ))}
            </dl>
          </Cartao>

          <Cartao titulo="Chaves sem suporte a shredding" hint="onde só resta hard delete">
            {semShredding.length === 0
              ? <Nota>Todas as chaves ativas suportam cripto-shredding neste cenário.</Nota>
              : (
                <>
                  <dl className="kv">
                    {semShredding.map((c) => (
                      <div key={c.alias} style={{ display: 'contents' }}>
                        <dt className="mono">{c.alias}</dt>
                        <dd><Pill tom="crit">não suportado</Pill> {c.finalidade} · exige hard delete</dd>
                      </div>
                    ))}
                  </dl>
                  <Nota tom="crit">
                    Enquanto {semShredding[0].alias} não suportar cripto-shredding, uma restauração devolve dados
                    já eliminados. É exatamente o risco R10 da matriz.
                  </Nota>
                </>
              )}
          </Cartao>
        </div>
      </div>
    </>
  );
}
