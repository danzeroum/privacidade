import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cabecalho, Cartao, Nota, Permitido, Pill, Tabela } from '../ui/primitivos';
import { useSessao } from '../store/sessao';
import { redigir, resumoDaRedacao } from '../lib/redator';
import { TRANSICOES_INCIDENTE } from '../mock/estados';
import type { DecisaoIncidente, EstadoIncidente, Incidente } from '../mock/types';

const PASSOS: { estado: EstadoIncidente; rotulo: string }[] = [
  { estado: 'aberto', rotulo: 'Aberto' },
  { estado: 'contido', rotulo: 'Contido' },
  { estado: 'decidido', rotulo: 'Decidido' },
  { estado: 'comunicado', rotulo: 'Comunicado' },
  { estado: 'encerrado', rotulo: 'Encerrado' },
];

const ROTULO_DECISAO: Record<DecisaoIncidente, string> = {
  comunicar_anpd_e_titulares: 'comunicar à ANPD e aos titulares',
  comunicar_anpd: 'comunicar somente à ANPD',
  nao_comunicar: 'não comunicar — risco não relevante',
};

const TOM_ESTADO: Record<EstadoIncidente, 'crit' | 'warn' | 'ok' | 'neutral'> = {
  aberto: 'crit', contido: 'warn', decidido: 'warn',
  comunicado: 'ok', nao_comunicado: 'ok', encerrado: 'neutral',
};

export default function T9() {
  const banco = useSessao((s) => s.banco);
  useSessao((s) => s.versao);

  const incidentes = banco.cenario.incidentes;
  const [selecionado, setSelecionado] = useState(incidentes[0]?.id ?? '');
  const inc = incidentes.find((i) => i.id === selecionado) ?? incidentes[0];

  if (!inc) {
    return (
      <>
        <Cabecalho fontes={['Art. 48']} titulo="Incidentes" resumo="" nota={{}} />
        <Nota>Nenhum incidente registrado neste cenário.</Nota>
      </>
    );
  }

  return (
    <>
      <Cabecalho
        fontes={['Art. 48', 'audit_log · hash encadeado']}
        titulo="Incidentes"
        resumo="O dia ruim também é processo: escopo vindo do catálogo, decisão de comunicar com fundamento registrado e prazo à vista."
        nota={{
          engenharia: 'Abrir e conter são seus. O escopo sai do catálogo — se o campo não está no ROPA, o incidente não aceita.',
          dpo: 'A decisão de comunicar é sua, e a de não comunicar também. As duas exigem fundamento, e é a segunda que a fiscalização examina primeiro.',
          produto: 'Você acompanha o estado e o prazo. Nenhum controle de decisão é montado para o seu papel.',
          seguranca: 'Conter é seu ato: estancar antes de decidir evita comunicar um escopo que ainda está crescendo.',
          auditor: 'Leitura da fila e da linha do tempo, que sai do próprio audit trail encadeado.',
        }}
      />

      <FaixaDoIncidente incidente={inc} />

      {incidentes.length > 1 && (
        <div className="row" style={{ marginTop: 12 }}>
          {incidentes.map((i) => (
            <button
              key={i.id}
              className="reveal mono"
              aria-pressed={i.id === inc.id}
              onClick={() => setSelecionado(i.id)}
            >
              {i.id === inc.id ? '● ' : ''}{i.id}
            </button>
          ))}
        </div>
      )}

      <div className="grid g2" style={{ marginTop: 14 }}>
        <EscopoDoCatalogo incidente={inc} />
        <PainelDeDecisao incidente={inc} />
      </div>

      <div className="sec-title">Linha do tempo</div>
      <Cartao hint="derivada do audit trail — não é uma lista mantida à parte">
        <Tabela cabecalho={['Quando', 'Quem', 'O que aconteceu', 'Hash']}>
          {banco.auditoria
            .filter((l) => l.recursoTipo === 'incidente' && l.recursoId === inc.id)
            .map((l) => (
              <tr key={l.id}>
                <td className="mono">{new Date(l.ocorridoEm).toLocaleTimeString('pt-BR')}</td>
                <td>{l.ator} <span className="hint">{l.atorPapel}</span></td>
                <td>
                  {l.acao}
                  {l.justificativa && <div className="hint">{l.justificativa}</div>}
                </td>
                <td className="hash">{l.hash.slice(0, 8)}…</td>
              </tr>
            ))}
        </Tabela>
        <Nota>
          Cada linha aqui é um bloco da cadeia encadeada da T6. Não existe evento do incidente fora do
          trail: se estivesse numa lista própria, seria mais um lugar para a história divergir.
        </Nota>
      </Cartao>
    </>
  );
}

/** Prazo à vista, estado do processo e a decisão pendente ou tomada. */
function FaixaDoIncidente({ incidente }: { incidente: Incidente }) {
  const desdeMs = Date.now() - new Date(incidente.detectadoEm).getTime();
  const horas = Math.floor(desdeMs / 3_600_000);
  const minutos = Math.floor((desdeMs % 3_600_000) / 60_000);
  const decidido = Boolean(incidente.decisao);

  return (
    <>
      <div className={`banner ${decidido ? '' : 'crit'}`} style={{ marginTop: 18 }}>
        <span className="mark">{decidido ? '📋' : '⚠'}</span>
        <div>
          <h4>
            <span className="mono">{incidente.id}</span> ·{' '}
            <Pill tom={TOM_ESTADO[incidente.estado]}>{incidente.estado.replace('_', ' ')}</Pill>
          </h4>
          <p>
            Detectado há <b>{horas} h {String(minutos).padStart(2, '0')} min</b> ·
            {' '}origem {incidente.origem} ·
            {' '}decisão de comunicar{' '}
            {decidido
              ? <b>{ROTULO_DECISAO[incidente.decisao as DecisaoIncidente]}</b>
              : <b style={{ color: 'var(--crit)' }}>pendente</b>}
          </p>
        </div>
      </div>

      {/* O estado do artefato como faixa de passos: a pessoa vê onde está no
          processo sem abrir diagrama nenhum. */}
      <div className="pipe" style={{ marginTop: 12 }}>
        {PASSOS.map((passo) => {
          const atual = incidente.estado === passo.estado
            || (passo.estado === 'comunicado' && incidente.estado === 'nao_comunicado');
          const indiceAtual = PASSOS.findIndex((x) => x.estado === incidente.estado
            || (x.estado === 'comunicado' && incidente.estado === 'nao_comunicado'));
          const feito = PASSOS.indexOf(passo) < indiceAtual;
          return (
            <div
              key={passo.estado}
              className="pipe-step"
              style={{ background: atual ? 'var(--accent-soft)' : feito ? 'var(--ok-soft)' : undefined }}
              aria-current={atual ? 'step' : undefined}
            >
              <b style={{ fontSize: 12.5 }}>
                {passo.estado === 'comunicado' && incidente.estado === 'nao_comunicado'
                  ? 'Não comunicado'
                  : passo.rotulo}
              </b>
              <p className="hint" style={{ margin: '4px 0 0' }}>
                {atual ? 'estado atual' : feito ? 'concluído' : 'pendente'}
              </p>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * O escopo é lido do catálogo. Nenhum campo é digitado aqui — o que a tela
 * mostra é o que o ROPA sabe, e é isso que sustenta a comunicação ao titular.
 */
function EscopoDoCatalogo({ incidente }: { incidente: Incidente }) {
  const banco = useSessao((s) => s.banco);
  const campos = incidente.camposIds
    .map((id) => banco.cenario.campos.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const sensiveis = campos.filter((c) => c.sensivel);
  const risco = banco.cenario.riscos.find((r) => r.codigo === incidente.riscoCodigo);
  const ripd = banco.cenario.ripds.find((r) => r.id === incidente.ripdId);

  return (
    <Cartao titulo="Escopo — lido do catálogo">
      <dl className="kv">
        <dt>Campos atingidos</dt>
        <dd>{campos.map((c) => <span key={c.id} className="mono" style={{ marginRight: 8 }}>{c.nome}</span>)}</dd>
        <dt>Categoria</dt>
        <dd>
          {sensiveis.length > 0
            ? <><Pill tom="sens">{sensiveis.length} campo sensível</Pill> — a comunicação ao titular é obrigatória na prática</>
            : 'pessoal · nenhum campo sensível na janela do incidente'}
        </dd>
        <dt>Titulares</dt>
        <dd>{incidente.titularesEstimados.toLocaleString('pt-BR')} estimados</dd>
        <dt>Risco previsto</dt>
        <dd>{risco
          ? <>{risco.codigo} · {risco.descricao} — score {risco.probabilidade * risco.impacto}, {risco.status.replace('_', ' ')}</>
          : '—'}</dd>
        <dt>RIPD relacionado</dt>
        <dd>{ripd ? <Link to="/t3">{ripd.codigo} →</Link> : '—'}</dd>
      </dl>
      <Nota>
        O escopo não é digitado: são ids do catálogo. Campo que o ROPA desconhece não abre incidente —
        a rota recusa com 422, pelo mesmo motivo que não o deixa ser revelado.
      </Nota>
    </Cartao>
  );
}

/**
 * Contenção, decisão e efetivação. Cada bloco só aparece quando é a vez dele:
 * a tela não oferece caminho que a rota vá recusar, e a ordem é a da máquina de
 * estados, não a da conveniência de quem desenhou.
 */
function PainelDeDecisao({ incidente }: { incidente: Incidente }) {
  const chamar = useSessao((s) => s.chamar);
  useSessao((s) => s.versao);
  const [decisao, setDecisao] = useState<DecisaoIncidente | ''>('');
  const [fundamento, setFundamento] = useState('');
  const [nota, setNota] = useState('');

  const previa = redigir(fundamento);
  const proximos = TRANSICOES_INCIDENTE[incidente.estado];

  const conter = () => {
    const res = chamar({ metodo: 'POST', caminho: `/v1/incidentes/${incidente.id}/conter`, body: { nota } });
    if (res.status === 200) setNota('');
  };

  const decidir = () => {
    const res = chamar({
      metodo: 'POST', caminho: `/v1/incidentes/${incidente.id}/decisao`,
      body: { decisao, fundamento },
    });
    if (res.status === 200) { setDecisao(''); setFundamento(''); }
  };

  const efetivar = () => chamar({
    metodo: 'POST',
    caminho: `/v1/incidentes/${incidente.id}/${incidente.decisao === 'nao_comunicar' ? 'registrar-nao-comunicacao' : 'comunicar'}`,
  });

  const encerrar = () => chamar({ metodo: 'POST', caminho: `/v1/incidentes/${incidente.id}/encerrar` });

  return (
    <Cartao titulo="Resposta ao incidente" hint={`próximo passo: ${proximos.join(' ou ') || 'nenhum'}`}>
      {incidente.estado === 'aberto' && (
        <Permitido
          acao="abrir_incidente"
          alternativa={<Nota>A contenção é de quem opera a resposta — engenharia e segurança. O seu papel acompanha.</Nota>}
        >
          <div className="field">
            <label htmlFor="inc-nota">O que foi feito para conter</label>
            <textarea
              id="inc-nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ex.: token revogado e escopo do principal reduzido."
            />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={conter}>Registrar contenção</button>
          </div>
          <Nota>
            Conter vem antes de decidir. Decidir com o vazamento em curso é comunicar um escopo que ainda
            está crescendo — e comunicação com número errado precisa ser refeita na frente do titular.
          </Nota>
        </Permitido>
      )}

      {incidente.estado === 'contido' && (
        <Permitido
          acao="comunicar_incidente"
          alternativa={<Nota>A decisão de comunicar é do DPO, que responde por ela perante a ANPD e o titular.</Nota>}
        >
          <div className="field">
            <label htmlFor="inc-decisao">Decisão</label>
            <select id="inc-decisao" value={decisao} onChange={(e) => setDecisao(e.target.value as DecisaoIncidente)}>
              <option value="">Selecione…</option>
              {(Object.keys(ROTULO_DECISAO) as DecisaoIncidente[]).map((d) => (
                <option key={d} value={d}>{ROTULO_DECISAO[d]}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="inc-fund">Fundamento (mínimo 20 caracteres) — fica anexado para sempre</label>
            <textarea
              id="inc-fund"
              value={fundamento}
              onChange={(e) => setFundamento(e.target.value)}
              placeholder="Ex.: exposição confirmada de CPF e nome de 4.118 titulares por token válido; risco de fraude por engenharia social."
            />
            <span className="hint">{fundamento.trim().length}/20</span>
          </div>
          {previa.houveRemocao && (
            <Nota tom="warn">
              O fundamento contém {resumoDaRedacao(previa.achados)} — será gravado assim:
              {' '}<span className="mono">{previa.texto}</span>
            </Nota>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={!decisao || fundamento.trim().length < 20} onClick={decidir}>
              Registrar decisão
            </button>
          </div>
          <Nota>
            Decidir <b>não</b> comunicar também exige fundamento — é a decisão que a fiscalização examina
            primeiro. Sem razão registrada, não comunicar é indistinguível de não ter percebido.
          </Nota>
        </Permitido>
      )}

      {incidente.estado === 'decidido' && (
        <Permitido acao="comunicar_incidente" alternativa={<Nota>Aguardando o DPO efetivar a decisão registrada.</Nota>}>
          <p style={{ fontSize: 13, marginTop: 0 }}>
            Decisão registrada: <b>{ROTULO_DECISAO[incidente.decisao as DecisaoIncidente]}</b>.
          </p>
          <p className="hint">Fundamento: {incidente.fundamento}</p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={efetivar}>
              {incidente.decisao === 'nao_comunicar' ? 'Registrar a não comunicação' : 'Registrar a comunicação'}
            </button>
          </div>
          <Nota>
            A efetivação executa o que foi decidido — a rota recusa o contrário, para o trail não desmentir a tela.
          </Nota>
        </Permitido>
      )}

      {(incidente.estado === 'comunicado' || incidente.estado === 'nao_comunicado') && (
        <Permitido acao="comunicar_incidente" alternativa={<Nota>Aguardando encerramento pelo DPO.</Nota>}>
          <p style={{ fontSize: 13, marginTop: 0 }}>
            {incidente.estado === 'comunicado' ? 'Comunicação registrada.' : 'Não comunicação registrada, com fundamento.'}
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={encerrar}>Encerrar incidente</button>
          </div>
        </Permitido>
      )}

      {incidente.estado === 'encerrado' && (
        <Nota>
          Incidente encerrado. Reabrir é registro novo, não edição deste — a rota devolve 409 para qualquer
          transição a partir daqui.
        </Nota>
      )}
    </Cartao>
  );
}
