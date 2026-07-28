import { useMemo, useState } from 'react';
import { Cabecalho, Cartao, Nota, Permitido, Pill, Tabela } from '../ui/primitivos';
import { useSessao } from '../store/sessao';
import { hashCpf } from '../lib/sha256';
import { redigir, resumoDaRedacao } from '../lib/redator';
import type { Campo, Categoria, Finalidade, TipoArmazenado } from '../mock/types';

const ICONE: Record<TipoArmazenado, string> = {
  hash: '🔒', hmac: '🎭', bruto: '📷', criptografado: '🔐', agregado: '📊',
};
const EXPLICA: Record<TipoArmazenado, string> = {
  hash: 'Hash irreversível com sal. Não é anonimização: o espaço de CPFs reverte por força bruta.',
  hmac: 'Pseudônimo reversível pelo serviço autorizado, com chave no KMS. Continua sendo dado pessoal.',
  bruto: 'Valor em texto claro. Só com finalidade declarada e mascaramento na exibição.',
  criptografado: 'Envelope encryption com DEK por registro. Destruir a chave elimina o dado.',
  agregado: 'Agregação com k-anonimato. É o único caminho que tira o dado do escopo da LGPD.',
};

/** Um campo só está pronto para auditoria quando responde às três perguntas. */
function conformidade(c: Campo): { tom: 'ok' | 'warn' | 'crit'; texto: string } {
  if (!c.baseLegal) return { tom: 'crit', texto: 'sem base legal' };
  if (c.baseLegal === 'legitimo_interesse' && !c.liaCodigo) return { tom: 'crit', texto: 'legítimo interesse sem LIA' };
  if (c.retencaoDias === null) return { tom: 'warn', texto: 'retenção condicional' };
  const semMecanismo = c.compartilhamentos.some((s) => s.internacional && s.mecanismo === 'nao_aplicavel');
  if (semMecanismo) return { tom: 'crit', texto: 'transferência sem mecanismo' };
  return { tom: 'ok', texto: 'completo' };
}

export default function T2() {
  const banco = useSessao((s) => s.banco);
  const chamar = useSessao((s) => s.chamar);


  const [fBase, setFBase] = useState('Todas');
  const [fSens, setFSens] = useState('Todos');
  const [fIntl, setFIntl] = useState('Todas');
  const [fRet, setFRet] = useState('Qualquer');
  const [selecionado, setSelecionado] = useState<Campo | null>(null);
  const [cpf, setCpf] = useState('');
  const [finalidade, setFinalidade] = useState<Finalidade | ''>('');
  const [ultimoHash, setUltimoHash] = useState<string | null>(null);
  const [buscaResultado, setBuscaResultado] = useState<string | null>(null);

  const papel = useSessao((s) => s.papel);
  const versao = useSessao((s) => s.versao);
  const resposta = useMemo(
    () => chamar<{ data: Campo[]; totalItems?: number }>({ metodo: 'GET', caminho: '/v1/catalog/fields' }),
    [chamar, papel, versao, banco],
  );
  const campos = resposta.body.data ?? [];
  const total = resposta.body.totalItems;

  const filtrados = useMemo(() => campos.filter((c) => (
    (fBase === 'Todas' || c.baseLegal === fBase)
    && (fSens === 'Todos' || (fSens === 'Somente sensíveis' ? c.sensivel : !c.sensivel))
    && (fIntl === 'Todas' || (fIntl === 'Somente internacional'
      ? c.compartilhamentos.some((s) => s.internacional)
      : !c.compartilhamentos.some((s) => s.internacional)))
    && (fRet === 'Qualquer'
      || (fRet === 'Até 90 dias' && c.retencaoDias !== null && c.retencaoDias <= 90)
      || (fRet === 'Até 1 ano' && c.retencaoDias !== null && c.retencaoDias <= 365)
      || (fRet === 'Acima de 1 ano' && c.retencaoDias !== null && c.retencaoDias > 365)
      || (fRet === 'Indeterminada' && c.retencaoDias === null))
  )), [campos, fBase, fSens, fIntl, fRet]);

  const buscar = () => {
    const h = hashCpf(cpf);
    const res = chamar<{ id: string; pseudonimo: string }>({
      metodo: 'POST', caminho: '/v1/titulares/buscar', purpose: finalidade || undefined, body: { cpfHash: h },
    });
    // T2-01 — o documento sai da sessão assim que o hash é calculado. Guardar o
    // CPF digitado em estado depois da busca é manter PII em memória sem razão.
    setCpf('');
    setUltimoHash(h.slice(0, 8));
    setBuscaResultado(res.status === 200 ? `${res.body.pseudonimo} · titular ${res.body.id}` : 'Não encontrado.');
  };

  return (
    <>
      <Cabecalho
        fontes={['.privacy/data-inventory.*.yaml', 'linhagem']}
        titulo="Catálogo de dados"
        resumo="O ROPA é lido dos repositórios, não digitado. Cada campo carrega quem é o dono, para que serve, sob qual base legal e por quanto tempo fica."
        nota={{
          engenharia: 'O catálogo é lido do seu YAML. Se um campo aparece aqui sem base legal, o gate barra o próximo PR do repositório.',
          dpo: 'Este é o ROPA que você entrega em fiscalização. Filtre por transferência internacional para revisar os mecanismos do Art. 33.',
          produto: 'Antes de pedir um campo novo, procure se ele já existe: campo repetido é risco duplicado sem valor novo.',
          seguranca: 'Os ícones dizem onde há chave envolvida. Campo criptografado sem cripto-shredding vira dívida na T7.',
          auditor: 'A coluna de conformidade resume o que falta em cada campo. A contagem total não é exibida para este papel.',
        }}
      />

      <div className="grid g-1-2">
        <div className="stack">
          <Cartao titulo="Sistemas" hint={`${banco.cenario.sistemas.length} repositórios`}>
            {banco.cenario.sistemas.map((s) => {
              const n = campos.filter((c) => c.sistema === s.slug).length;
              return (
                <div key={s.slug} style={{ padding: '7px 4px', borderBottom: '1px solid var(--line)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>📁 {s.slug}</span>
                    <span className="hint">{n} campo{n === 1 ? '' : 's'}</span>
                  </div>
                  <div className="hash">{s.repositorio} · {s.timeDono}</div>
                  {!s.temInventario && <Pill tom="crit">⚠ sem inventário</Pill>}
                </div>
              );
            })}
          </Cartao>

          {/* C-01 — localizar um titular pelo documento é ato de atendimento.
              Quem não atende não recebe o cartão: ele não é renderizado. */}
          <Permitido
            acao="buscar_titular"
            alternativa={
              <Cartao titulo="Buscar titular por CPF">
                <Nota>
                  Localizar um titular pelo documento é ato de atendimento e pertence ao DPO.
                  O seu papel não recebe este campo — e a rota recusa a busca mesmo fora da tela.
                </Nota>
              </Cartao>
            }
          >
            <Cartao titulo="Buscar titular por CPF">
              <div className="field">
                <label htmlFor="cat-cpf">CPF</label>
                <input
                  id="cat-cpf"
                  type="text"
                  value={cpf}
                  onChange={(e) => setCpf(e.target.value)}
                  placeholder="•••.•••.•••-••"
                  autoComplete="off"
                  inputMode="numeric"
                />
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label htmlFor="cat-finalidade">Finalidade da busca</label>
                <select id="cat-finalidade" value={finalidade} onChange={(e) => setFinalidade(e.target.value as Finalidade | '')}>
                  <option value="">Selecione…</option>
                  <option value="atendimento">atendimento — localizar solicitação do titular</option>
                  <option value="cobranca">cobranca — negociação de dívida</option>
                  <option value="auditoria">auditoria — verificação de conformidade</option>
                </select>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn primary"
                  onClick={buscar}
                  disabled={cpf.replace(/\D/g, '').length < 11 || !finalidade}
                >
                  Calcular hash e buscar
                </button>
              </div>
              {ultimoHash && (
                <p className="hash" style={{ marginTop: 10 }}>
                  hash consultado: <b>{ultimoHash}…</b> · o documento saiu da sessão
                </p>
              )}
              {buscaResultado && <p className="mono" style={{ marginTop: 6 }}>{buscaResultado}</p>}
              <Nota>
                O CPF digitado nunca entra na requisição: o navegador calcula o SHA-256 e envia só o hash.
                O campo é limpo assim que a busca parte, e a consulta entra no audit trail com a
                finalidade declarada antes de qualquer resposta.
              </Nota>
            </Cartao>
          </Permitido>

          <Cartao titulo="Novo inventário">
            <div className="drop">
              Arraste o <span className="mono">data-inventory.yaml</span>
              <div className="hint">valida contra o schema e mostra o diff</div>
            </div>
            <ValidadorInventario />
          </Cartao>

          <RegistrosDeConsentimento />
        </div>

        <div className="stack">
          <Cartao titulo="Filtros" hint="espelham os campos do YAML">
            <div className="grid g4" style={{ gap: 11 }}>
              <div className="field">
                <label htmlFor="f-base">Base legal</label>
                <select id="f-base" value={fBase} onChange={(e) => setFBase(e.target.value)}>
                  {['Todas', ...new Set(campos.map((c) => c.baseLegal))].map((v) => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-sens">Sensível</label>
                <select id="f-sens" value={fSens} onChange={(e) => setFSens(e.target.value)}>
                  <option>Todos</option><option>Somente sensíveis</option><option>Excluir sensíveis</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-intl">Transferência</label>
                <select id="f-intl" value={fIntl} onChange={(e) => setFIntl(e.target.value)}>
                  <option>Todas</option><option>Somente internacional</option><option>Somente nacional</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-ret">Retenção</label>
                <select id="f-ret" value={fRet} onChange={(e) => setFRet(e.target.value)}>
                  <option>Qualquer</option><option>Até 90 dias</option><option>Até 1 ano</option>
                  <option>Acima de 1 ano</option><option>Indeterminada</option>
                </select>
              </div>
            </div>
          </Cartao>

          <Cartao
            titulo="Campos catalogados"
            hint={total !== undefined
              ? `${filtrados.length} de ${total} campos`
              : `${filtrados.length} campos nesta página · total não exibido para o seu papel`}
          >
            <Tabela dense cabecalho={['Campo', 'Guarda', 'Finalidade', 'Base legal', 'Retenção', 'Destino', 'Estado']}>
              {filtrados.map((c) => {
                const conf = conformidade(c);
                const intl = c.compartilhamentos.find((s) => s.internacional);
                return (
                  <tr key={c.id} onClick={() => setSelecionado(c)} style={{ cursor: 'pointer' }}>
                    <td>
                      <span className="mono">{c.nome}</span>{' '}
                      {c.sensivel && <Pill tom="sens">🔒 sensível</Pill>}
                      <div className="hash">{c.sistema} · {c.dataset} · {c.categoria}</div>
                    </td>
                    <td title={EXPLICA[c.tipoArmazenado]} style={{ whiteSpace: 'nowrap' }}>
                      {ICONE[c.tipoArmazenado]} {c.tipoArmazenado}
                    </td>
                    <td>{c.finalidade}</td>
                    <td>
                      <span className="mono" style={{ fontSize: 11 }}>{c.baseLegal}</span>
                      {c.liaCodigo && <div><Pill tom="ok">{c.liaCodigo}</Pill></div>}
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{c.retencao}</td>
                    <td>
                      {c.compartilhamentos.length === 0
                        ? <span style={{ color: 'var(--text-3)' }}>—</span>
                        : intl
                          ? <span title={`Mecanismo: ${intl.mecanismo} — Art. 33 · evidência ${intl.evidencia ?? 'ausente'}`}>
                              <Pill tom="warn">🌎 {intl.destino}</Pill>
                            </span>
                          : <Pill tom="neutral">{c.compartilhamentos[0].destino}</Pill>}
                    </td>
                    <td><Pill tom={conf.tom}>{conf.texto}</Pill></td>
                  </tr>
                );
              })}
            </Tabela>
            <Nota>
              🔒 hash irreversível · 🎭 pseudônimo reversível pelo serviço autorizado · 📊 agregado com k-anonimato ·
              <b> nenhum valor de titular é exibido nesta tela</b> — o catálogo descreve campos, não conteúdo.
            </Nota>
          </Cartao>

          {selecionado && <Linhagem campo={selecionado} aoFechar={() => setSelecionado(null)} />}
        </div>
      </div>
    </>
  );
}

function Linhagem({ campo, aoFechar }: { campo: Campo; aoFechar: () => void }) {
  const largura = 900;
  const passo = largura / campo.linhagem.length;
  return (
    <Cartao
      titulo={`Linhagem — ${campo.sistema}.${campo.nome}`}
      acao={<button className="btn ghost" onClick={aoFechar}>fechar</button>}
    >
      <svg className="chart" viewBox={`0 0 ${largura} 110`} role="img" aria-label={`Fluxo do campo ${campo.nome}`}>
        {campo.linhagem.map((e, i) => {
          const x = i * passo + 8;
          const w = passo - 30;
          return (
            <g key={e.etapa}>
              <rect x={x} y={26} width={w} height={54} rx={5}
                fill={e.externo ? 'var(--warn-soft)' : 'var(--surface-2)'}
                stroke={e.externo ? 'var(--warn)' : 'var(--line)'} />
              <text x={x + w / 2} y={48} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="var(--text)">{e.etapa}</text>
              <text x={x + w / 2} y={64} textAnchor="middle" fontSize={10}>{e.detalhe}</text>
              {i < campo.linhagem.length - 1 && (
                <path d={`M${x + w + 3} 53 L${x + passo + 2} 53`} stroke="var(--line-strong)" strokeWidth={1.5} />
              )}
            </g>
          );
        })}
      </svg>
      <Nota>
        A resposta ao Art. 18, VII sai desta cadeia, que é append-only. Não é uma lista mantida à mão.
      </Nota>
    </Cartao>
  );
}

/** Formulário que exercita a validação do inventário: as regras 2, 8 e o Art. 11. */
function ValidadorInventario() {
  const chamar = useSessao((s) => s.chamar);
  const [tipo, setTipo] = useState<TipoArmazenado>('hash');
  const [categoria, setCategoria] = useState<Categoria>('anonimizado');
  const [sensivel, setSensivel] = useState(false);
  const [baseLegal, setBaseLegal] = useState('legitimo_interesse');
  const [internacional, setInternacional] = useState(false);
  const [mecanismo, setMecanismo] = useState('nao_aplicavel');
  /**
   * Nasce desligado de propósito. Campo novo sem finalidades declaradas é
   * recusado pela API (C-03) — é a única forma de a lista existir em todo campo
   * do catálogo, e é o que a revelação depende para não cair no "qualquer uma".
   */
  const [declaraFinalidades, setDeclaraFinalidades] = useState(false);
  const [finalidades, setFinalidades] = useState<Finalidade[]>([]);
  const [saida, setSaida] = useState<string | null>(null);

  const alternar = (f: Finalidade) =>
    setFinalidades((atual) => (atual.includes(f) ? atual.filter((x) => x !== f) : [...atual, f]));

  const validar = () => {
    const res = chamar<{ erro?: string; valido?: boolean }>({
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: {
        nome: 'campo_novo', tipoArmazenado: tipo, categoria, sensivel, baseLegal, internacional, mecanismo,
        ...(declaraFinalidades ? { finalidadesCompativeis: finalidades } : {}),
      },
    });
    setSaida(res.status === 200 ? '✅ Inventário aceito.' : `❌ ${(res.body as { erro: string }).erro}`);
  };

  return (
    <Permitido acao="escrever" alternativa={<Nota>Validação de inventário é ação de escrita — indisponível para o seu papel.</Nota>}>
      <div className="grid g2" style={{ gap: 10, marginTop: 12 }}>
        <div className="field">
          <label htmlFor="v-tipo">tipo_armazenado</label>
          <select id="v-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoArmazenado)}>
            {(['hash', 'hmac', 'criptografado', 'agregado', 'bruto'] as TipoArmazenado[]).map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="v-cat">categoria</label>
          <select id="v-cat" value={categoria} onChange={(e) => setCategoria(e.target.value as Categoria)}>
            {(['anonimizado', 'pseudonimizado', 'pessoal', 'sensivel'] as Categoria[]).map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="v-base">base_legal</label>
          <select id="v-base" value={baseLegal} onChange={(e) => setBaseLegal(e.target.value)}>
            {['legitimo_interesse', 'consentimento', 'execucao_contrato', 'obrigacao_legal', 'tutela_saude', 'protecao_credito'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="v-mec">mecanismo</label>
          <select id="v-mec" value={mecanismo} onChange={(e) => setMecanismo(e.target.value)}>
            {['nao_aplicavel', 'clausulas_padrao_anpd', 'pais_adequado', 'normas_corporativas'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="toggle">
          <input type="checkbox" checked={sensivel} onChange={(e) => setSensivel(e.target.checked)} />
          <span className="track" /> sensível
        </label>
        <label className="toggle">
          <input type="checkbox" checked={internacional} onChange={(e) => setInternacional(e.target.checked)} />
          <span className="track" /> transferência internacional
        </label>
        <label className="toggle">
          <input type="checkbox" checked={declaraFinalidades}
            onChange={(e) => setDeclaraFinalidades(e.target.checked)} />
          <span className="track" /> declarar finalidades de acesso
        </label>
        <button className="btn primary" onClick={validar}>Validar</button>
      </div>
      {declaraFinalidades && (
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          {(['atendimento', 'cobranca', 'auditoria', 'seguranca'] as Finalidade[]).map((f) => (
            <label key={f} className="toggle">
              <input type="checkbox" checked={finalidades.includes(f)} onChange={() => alternar(f)} />
              <span className="track" /> {f}
            </label>
          ))}
          {finalidades.length === 0 && (
            <span className="note">Lista vazia é declaração válida: o campo entra no ROPA como não revelável.</span>
          )}
        </div>
      )}
      {saida && <p className="note" style={{ marginTop: 10 }}>{saida}</p>}
      <Nota>
        Os toggles nascem desligados. Tente <span className="mono">hash + anonimizado</span>,
        {' '}<span className="mono">sensível + legítimo interesse</span> ou simplesmente validar sem
        declarar finalidades: o inventário é recusado inteiro.
      </Nota>
    </Permitido>
  );
}

/**
 * C-08 — o registro de consentimento é a prova que sustenta a base legal.
 *
 * A base "consentimento" só é aceita no inventário com um registro vivo aqui, e
 * revogar não muda um rótulo: o campo perde a base legal, sai dos caminhos de
 * revelação e o gate do repositório volta a bloquear — como a LIA vencida.
 */
function RegistrosDeConsentimento() {
  const banco = useSessao((s) => s.banco);
  const chamar = useSessao((s) => s.chamar);
  useSessao((s) => s.versao);

  const [alvo, setAlvo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const previa = redigir(motivo);

  const registros = banco.cenario.consentimentos;
  if (registros.length === 0) {
    return (
      <Cartao titulo="Registro de consentimento">
        <Nota>Nenhum campo deste cenário usa consentimento como base legal.</Nota>
      </Cartao>
    );
  }

  const revogar = (campoId: string) => {
    const res = chamar({ metodo: 'POST', caminho: `/v1/consentimentos/${campoId}/revogar`, body: { motivo } });
    if (res.status === 200) { setAlvo(null); setMotivo(''); }
  };

  return (
    <Cartao titulo="Registro de consentimento" hint="a prova que sustenta a base legal">
      <Nota>
        A base “consentimento” só é aceita no inventário com um registro vivo aqui. Revogar bloqueia o
        tratamento e aciona o gate, como a LIA vencida.
      </Nota>
      {registros.map((c) => {
        const campo = banco.cenario.campos.find((x) => x.id === c.campoId);
        const ativo = c.estado === 'ativo';
        return (
          <div key={c.campoId} style={{ paddingTop: 12, borderTop: '1px solid var(--line)', marginTop: 12 }}>
            <dl className="kv">
              <dt>Campo</dt><dd className="mono">{campo?.nome ?? c.campoId}</dd>
              <dt>Texto {c.versao}</dt><dd>“{c.texto}”</dd>
              <dt>Coletado</dt>
              <dd>{c.coletadoEm} · {c.canal} · hash <span className="hash">{c.hash.slice(0, 8)}…</span></dd>
              <dt>Estado</dt>
              <dd>
                <Pill tom={ativo ? 'ok' : 'crit'}>
                  {ativo ? `ativo · ${c.titulares.toLocaleString('pt-BR')} titulares` : `revogado`}
                </Pill>
                {!ativo && <div className="hint">o campo perdeu a base legal e não é mais revelável</div>}
              </dd>
            </dl>
            {ativo && (
              <Permitido
                acao="revogar_consentimento"
                alternativa={<span className="hint">a revogação é operada pelo balcão do DPO (Art. 18, VIII)</span>}
              >
                {alvo === c.campoId ? (
                  <>
                    <div className="field" style={{ marginTop: 8 }}>
                      <label htmlFor={`rev-${c.campoId}`}>Motivo da revogação</label>
                      <textarea
                        id={`rev-${c.campoId}`}
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Ex.: titular pediu a revogação pelo canal do programa."
                      />
                    </div>
                    {previa.houveRemocao && (
                      <Nota tom="warn">
                        O motivo contém {resumoDaRedacao(previa.achados)} — será gravado assim:
                        {' '}<span className="mono">{previa.texto}</span>
                      </Nota>
                    )}
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="btn danger" onClick={() => revogar(c.campoId)}>Confirmar revogação</button>
                      <button className="btn" onClick={() => setAlvo(null)}>Cancelar</button>
                    </div>
                  </>
                ) : (
                  <button className="reveal" onClick={() => { setAlvo(c.campoId); setMotivo(''); }}>
                    Revogar consentimento
                  </button>
                )}
              </Permitido>
            )}
          </div>
        );
      })}
    </Cartao>
  );
}
