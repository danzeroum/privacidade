import { useMemo, useState } from 'react';
import { Cabecalho, Cartao, Nota, Permitido, Pill, Tabela } from '../ui/primitivos';
import { useSessao } from '../store/sessao';
import { hashCpf, curto } from '../lib/sha256';
import type { Campo, Categoria, TipoArmazenado } from '../mock/types';

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
      metodo: 'POST', caminho: '/v1/titulares/buscar', body: { cpfHash: h },
    });
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

          <Cartao titulo="Buscar titular por CPF">
            <div className="field">
              <label htmlFor="cat-cpf">CPF</label>
              <input id="cat-cpf" type="text" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="•••.•••.•••-••" />
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={buscar} disabled={cpf.replace(/\D/g, '').length < 11}>
                Calcular hash e buscar
              </button>
            </div>
            {cpf.replace(/\D/g, '').length >= 11 && (
              <p className="hash" style={{ marginTop: 10 }}>
                sai do navegador: <b>{curto(hashCpf(cpf), 24)}</b>
              </p>
            )}
            {buscaResultado && <p className="mono" style={{ marginTop: 6 }}>{buscaResultado}</p>}
            <Nota>
              O CPF digitado nunca entra na requisição. O navegador calcula o SHA-256 e envia só o hash —
              sem PII na URL, no histórico ou no log do gateway.
            </Nota>
          </Cartao>

          <Cartao titulo="Novo inventário">
            <div className="drop">
              Arraste o <span className="mono">data-inventory.yaml</span>
              <div className="hint">valida contra o schema e mostra o diff</div>
            </div>
            <ValidadorInventario />
          </Cartao>
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
  const [saida, setSaida] = useState<string | null>(null);

  const validar = () => {
    const res = chamar<{ erro?: string; valido?: boolean }>({
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: { nome: 'campo_novo', tipoArmazenado: tipo, categoria, sensivel, baseLegal, internacional, mecanismo },
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
        <button className="btn primary" onClick={validar}>Validar</button>
      </div>
      {saida && <p className="note" style={{ marginTop: 10 }}>{saida}</p>}
      <Nota>
        Os toggles nascem desligados. Tente <span className="mono">hash + anonimizado</span> ou
        {' '}<span className="mono">sensível + legítimo interesse</span>: o inventário é recusado inteiro.
      </Nota>
    </Permitido>
  );
}
