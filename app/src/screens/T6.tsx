import { useState } from 'react';
import { Cabecalho, Cartao, Kpi, Nota, Permitido, Pill, Tabela } from '../ui/primitivos';
import { useSessao } from '../store/sessao';
import { curto } from '../lib/sha256';

export default function T6() {
  const banco = useSessao((s) => s.banco);
  const chamar = useSessao((s) => s.chamar);
  const avisar = useSessao((s) => s.avisar);
  useSessao((s) => s.versao);

  const [integridade, setIntegridade] = useState<{ blocos: number; integro: boolean; primeiraDivergencia: number | null } | null>(null);
  const [filtro, setFiltro] = useState('');
  const [exportado, setExportado] = useState<string | null>(null);

  const runs = banco.cenario.expurgos;
  const hoje = runs[0];
  const totalHoje = hoje.entradas.reduce((a, e) => a + e.registros, 0);
  const shredding = hoje.entradas.filter((e) => e.metodo === 'crypto_shredding').reduce((a, e) => a + e.registros, 0);
  const verificados = hoje.entradas.filter((e) => e.verificado).length;

  const logs = banco.auditoria.filter((l) =>
    !filtro || [l.ator, l.acao, l.recursoId, l.finalidade ?? ''].join(' ').toLowerCase().includes(filtro.toLowerCase()));
  const ultima = banco.ultimaVerificacao();

  /**
   * T6-03 — a marcação de divergência é aplicada sobre a lista **filtrada**.
   * Com um filtro ativo, a cadeia quebrada podia ficar fora do recorte e a tela
   * ficava verde por omissão: o oposto do que ela existe para fazer.
   */
  const divergenciaEscondida = Boolean(
    integridade && !integridade.integro && integridade.primeiraDivergencia !== null
    && !logs.some((l) => l.id >= (integridade.primeiraDivergencia as number)),
  );

  const verificar = () => {
    const res = chamar<{ blocos: number; integro: boolean; primeiraDivergencia: number | null }>({
      metodo: 'POST', caminho: '/v1/audit/verificar',
    });
    if (res.status !== 200) return;
    setIntegridade(res.body);
    avisar(res.body.integro ? 'ok' : 'negado',
      res.body.integro
        ? `${res.body.blocos} blocos recalculados: nenhum divergente.`
        : `Cadeia quebrada a partir do bloco ${res.body.primeiraDivergencia}.`,
      'A verificação recomputa o hash de cada linha a partir da anterior, e fica registrada no trail.');
  };

  // C-06 — o CSV agora vem da API, que já registrou a exportação antes de
  // montá-lo. O navegador só entrega o arquivo.
  const exportar = () => {
    const res = chamar<{ csv: string; linhas: number; hashArquivo: string }>({
      metodo: 'POST', caminho: '/v1/audit/exportar', body: { filtro },
    });
    if (res.status !== 200) return;
    setExportado(`${res.body.linhas} linhas · sha256 ${curto(res.body.hashArquivo)}`);
    baixarCsv(res.body.csv);
  };

  const forjar = () => {
    const alvo = banco.auditoria[1]?.id ?? 1;
    const res = chamar<{ integro: boolean; primeiraDivergencia: number | null; blocos: number }>({
      metodo: 'POST', caminho: '/v1/audit/forjar', body: { id: alvo },
    });
    setIntegridade(res.body);
    avisar('negado',
      `Conteúdo do bloco ${alvo} alterado direto na tabela, sem recalcular o hash.`,
      'É o cenário de DBA comprometido: mesmo com os gatilhos desligados, a recomputação acusa a linha e todas as seguintes.');
  };

  const tentarEditar = () => chamar({ metodo: 'PATCH', caminho: '/v1/audit/1', body: { acao: 'ADULTERADO' } });

  return (
    <>
      <Cabecalho
        fontes={['expurgo-permanente.py', 'audit_log · hash encadeado']}
        titulo="Expurgo e auditoria"
        resumo="Retenção é atributo do dado, não item de backlog. Aqui está a prova diária de que o prazo foi cumprido — e a cadeia que mostra se alguém mexeu no registro."
        nota={{
          engenharia: 'Se um lote falha, o registro traz a tabela e o hash. A reexecução é idempotente: o par pré/pós prova o que já foi eliminado.',
          dpo: 'É esta tela que responde "quem garante que foi apagado". O relatório sai com hash próprio para verificação futura.',
          produto: 'O volume de expurgo mostra o custo de guardar dado: cada linha aqui foi coletada um dia sem prazo definido.',
          seguranca: 'O botão de forjar demonstra o cenário de DBA comprometido — e por que o hash encadeado é a defesa.',
          auditor: 'Verificar a cadeia e exportar o trail são os seus atos, e os dois ficam registrados: cada verificação entra no log com o seu nome.',
        }}
      />

      <div className="grid g4">
        <Kpi rotulo="Eliminados hoje" valor={totalHoje.toLocaleString('pt-BR')} rodape={`${hoje.entradas.length} tabelas`} />
        <Kpi rotulo="Cripto-shredding" valor={shredding.toLocaleString('pt-BR')} rodape="registros em base imutável" />
        <Kpi
          rotulo="Verificados"
          valor={`${verificados}`}
          sufixo={`/${hoje.entradas.length}`}
          barra={{ pct: (verificados / hoje.entradas.length) * 100, tom: verificados === hoje.entradas.length ? 'ok' : 'warn' }}
        />
        {/* T6-01 — o card passa a dizer quem verificou e quando, lido do trail. */}
        <Kpi
          rotulo="Cadeia de auditoria"
          valor={integridade ? (integridade.integro ? 'íntegra' : 'quebrada') : 'não verificada'}
          rodape={ultima
            ? `${integridade ? `${integridade.blocos} blocos · ` : ''}última verificação ${new Date(ultima.ocorridoEm).toLocaleTimeString('pt-BR')} por ${ultima.ator} · registrada no trail`
            : 'nunca verificada nesta sessão'}
        />
      </div>

      <div className="grid g-1-2" style={{ marginTop: 14 }}>
        <div className="stack">
          <Cartao titulo="Execuções recentes" hint="volume diário">
            {runs.map((r) => (
              <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{r.data} · <span className="hint">{r.origem}</span></span>
                  <Pill tom={r.status === 'concluido' ? 'ok' : r.status === 'falhou' ? 'crit' : 'warn'}>{r.status}</Pill>
                </div>
                <div className="hash">
                  {r.entradas.reduce((a, e) => a + e.registros, 0).toLocaleString('pt-BR')} registros
                </div>
              </div>
            ))}
            <Nota>
              Um dia em vermelho não é ruído: é dado que deveria ter sido eliminado e continua vivo.
            </Nota>
          </Cartao>

          <Cartao titulo="Volume por lote">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 92 }}>
              {hoje.entradas.map((e) => {
                const max = Math.max(...hoje.entradas.map((x) => x.registros), 1);
                return (
                  <div key={e.tabela} title={`${e.tabela}: ${e.registros.toLocaleString('pt-BR')}`}
                    style={{ flex: 1, background: 'var(--accent)', borderRadius: '2px 2px 0 0', height: `${Math.max(4, (e.registros / max) * 100)}%` }} />
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 5, fontSize: 10, color: 'var(--text-3)' }}>
              {hoje.entradas.map((e) => <span key={e.tabela} style={{ flex: 1 }}>{e.tabela.split('.')[0]}</span>)}
            </div>
          </Cartao>
        </div>

        <div className="stack">
          {/* T6-01 — o botão saiu do `<Permitido acao="rodar_expurgo">` cujos dois
              ramos renderizavam o mesmo controle: não protegia nada e sugeria que
              protegia. Quem decide agora é a ação `verificar_integridade`, que
              todos os cinco papéis têm — o auditor externo inclusive. */}
          <Cartao
            titulo="Lotes de hoje"
            acao={
              <Permitido acao="verificar_integridade">
                <button className="btn" onClick={verificar}>Verificar integridade</button>
              </Permitido>
            }
          >
            <Tabela dense cabecalho={['Sistema · tabela', 'Método', 'Registros', 'Hash pré', 'Hash pós', 'Estado']}>
              {hoje.entradas.map((e) => (
                <tr key={e.tabela}>
                  <td className="mono">{e.sistema} · {e.tabela}</td>
                  <td>{e.metodo.replace('_', ' ')}</td>
                  <td className="num">{e.registros.toLocaleString('pt-BR')}</td>
                  <td className="hash">{curto(e.hashPre)}</td>
                  <td className="hash">{curto(e.hashPos)}</td>
                  <td><Pill tom={e.verificado ? 'ok' : 'neutral'}>{e.verificado ? 'verificado' : 'pendente'}</Pill></td>
                </tr>
              ))}
            </Tabela>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => avisar('info', 'Relatório gerado com hash próprio para verificação futura.')}>
                Gerar relatório de expurgo (PDF)
              </button>
              <span className="hash">o relatório carrega o próprio hash — a auditoria de 2029 confere o arquivo de 2026</span>
            </div>
          </Cartao>

          <Cartao
            titulo="Audit trail"
            hint="append-only · cada linha sela a anterior"
          >
            <div className="row" style={{ marginBottom: 12 }}>
              <input
                type="search"
                placeholder="Filtrar por ator, ação ou recurso…"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                style={{ flex: 1, minWidth: 200 }}
              />
              {/* C-06 — exportar o registro de acessos é, ele mesmo, um acesso. */}
              <Permitido
                acao="exportar_auditoria"
                alternativa={<span className="hint">exportação restrita a quem presta contas</span>}
              >
                <button className="btn" onClick={exportar}>Exportar CSV assinado</button>
              </Permitido>
            </div>
            {exportado && (
              <p className="hash" style={{ marginTop: -4, marginBottom: 10 }}>
                exportado: {exportado} · o arquivo carrega o próprio hash, e a exportação ficou no trail
              </p>
            )}
            {divergenciaEscondida && (
              <p className="note crit" role="alert" style={{ marginBottom: 10 }}>
                <b>O filtro está escondendo a divergência.</b> A cadeia está quebrada a partir do bloco
                {' '}{integridade?.primeiraDivergencia}, que não aparece neste recorte.{' '}
                <button className="reveal" onClick={() => setFiltro('')}>limpar filtro e mostrar</button>
              </p>
            )}
            <Tabela dense cabecalho={['#', 'Quando', 'Quem', 'Ação', 'Recurso', 'Finalidade', 'Hash']}>
              {logs.map((l) => {
                const quebrado = integridade && !integridade.integro
                  && integridade.primeiraDivergencia !== null && l.id >= integridade.primeiraDivergencia;
                return (
                  <tr key={l.id} style={{ background: quebrado ? 'var(--crit-soft)' : l.resultado === 'negado' ? 'var(--crit-soft)' : undefined }}>
                    <td className="mono">{l.id}</td>
                    <td className="mono">{new Date(l.ocorridoEm).toLocaleTimeString('pt-BR')}</td>
                    <td>{l.ator} <span className="hint">{l.atorPapel}</span></td>
                    <td>{l.acao}</td>
                    <td className="mono">{l.recursoTipo}/{l.recursoId}</td>
                    <td>{l.resultado === 'negado' ? <Pill tom="crit">negado</Pill> : (l.finalidade ?? '—')}</td>
                    <td className="hash">{curto(l.hash)}</td>
                  </tr>
                );
              })}
            </Tabela>
            {integridade && !integridade.integro && (
              // Um alerta por vez. Quando o filtro esconde a divergência, quem
              // anuncia é o aviso acionável acima; este continua como
              // explicação, e dois alertas simultâneos não disputam a leitura.
              <p className="note crit" style={{ marginTop: 12 }} role={divergenciaEscondida ? undefined : 'alert'}>
                <b>Cadeia quebrada.</b> A adulteração no bloco {integridade.primeiraDivergencia} invalida ele
                e todos os seguintes. É por isso que o hash é encadeado: mexer em uma linha exige refazer o resto,
                e o hash anterior guardado fora da tabela denuncia a refação.
              </p>
            )}
          </Cartao>

          {/* T6-02 — os dois controles escrevem (ou tentam). Ficam atrás de duas
              condições, não de uma: a ação `escrever` e o modo demonstração. */}
          {banco.modoDemo && (
            <Permitido acao="escrever">
              <section
                className="card"
                style={{ borderStyle: 'dashed', borderColor: 'var(--line-strong)' }}
                aria-labelledby="t6-ataque"
              >
                <div className="card-head">
                  <h3 id="t6-ataque">Demonstração de ataque</h3>
                  <span className="hint">só no modo demonstração, só para papéis que escrevem</span>
                </div>
                <div className="row">
                  <button className="btn danger" onClick={tentarEditar}>Tentar editar uma linha</button>
                  <button className="btn danger" onClick={forjar}>Forjar edição no banco</button>
                </div>
                <Nota>
                  <b>Tentar editar</b> passa pela API e recebe 409 — o log é append-only no banco, não
                  por convenção da aplicação. <b>Forjar</b> escreve direto na estrutura, como faria quem
                  tem acesso ao banco; é a verificação da cadeia que denuncia.
                </Nota>
              </section>
            </Permitido>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Só entrega o arquivo. Montar o CSV virou trabalho da API (C-06), porque é lá
 * que a exportação é registrada e que a anti-enumeração da Regra 6 se aplica —
 * montar no cliente deixava as duas coisas de fora.
 */
function baixarCsv(csv: string) {
  if (typeof URL.createObjectURL !== 'function') return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'audit-trail.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
