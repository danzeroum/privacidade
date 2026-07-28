import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSessao } from '../store/sessao';
import { pode, type Acao } from '../mock/permissoes';
import { redigir, resumoDaRedacao } from '../lib/redator';
import type { Finalidade } from '../mock/types';

export function Cartao({ titulo, hint, acao, children, className = '' }: {
  titulo?: string; hint?: ReactNode; acao?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(titulo || hint || acao) && (
        <div className="card-head">
          {titulo && <h3>{titulo}</h3>}
          {acao ?? (hint && <span className="hint">{hint}</span>)}
        </div>
      )}
      {children}
    </section>
  );
}

export const Pill = ({ tom = 'neutral', children }: { tom?: 'ok' | 'warn' | 'crit' | 'neutral' | 'sens'; children: ReactNode }) =>
  <span className={`pill ${tom}`}>{children}</span>;

export const Nota = ({ tom, children }: { tom?: 'crit' | 'warn'; children: ReactNode }) =>
  <p className={`note ${tom ?? ''}`} style={{ margin: 0 }}>{children}</p>;

export function Kpi({ rotulo, valor, sufixo, rodape, barra, serie }: {
  rotulo: string; valor: string; sufixo?: string; rodape?: ReactNode;
  barra?: { pct: number; tom?: 'ok' | 'warn' | 'crit' }; serie?: number[];
}) {
  return (
    <div className="card kpi">
      <span className="kpi-label">{rotulo}</span>
      <span className="kpi-val">{valor}{sufixo && <small>{sufixo}</small>}</span>
      {serie && (
        <div className="spark" aria-hidden="true">
          {serie.map((v, i) => {
            const max = Math.max(...serie, 1);
            return <i key={i} style={{ height: `${Math.max(6, (v / max) * 100)}%` }} />;
          })}
        </div>
      )}
      {barra && <div className="meter"><i className={barra.tom} style={{ width: `${Math.min(100, barra.pct)}%` }} /></div>}
      {rodape && <span className="kpi-foot">{rodape}</span>}
    </div>
  );
}

/**
 * Portão de renderização por papel.
 *
 * Devolve `null` — o componente não entra no DOM. Não usamos `display:none`
 * nem `disabled` porque as duas coisas deixam o controle presente na página e
 * não sobrevivem a uma auditoria de código.
 */
export function Permitido({ acao, children, alternativa }: { acao: Acao; children: ReactNode; alternativa?: ReactNode }) {
  const papel = useSessao((s) => s.papel);
  if (!pode(papel, acao)) return <>{alternativa ?? null}</>;
  return <>{children}</>;
}

export function Modal({ titulo, children, rodape, aoFechar }: {
  titulo: string; children: ReactNode; rodape: ReactNode; aoFechar: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aoFechar]);

  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <h3>{titulo}</h3>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{rodape}</div>
      </div>
    </div>
  );
}

/** Descrição de cada finalidade, para o rótulo da opção. A lista vem do catálogo. */
const GLOSSA_FINALIDADE: Record<Finalidade, string> = {
  atendimento: 'responder solicitação do titular',
  cobranca: 'negociação de dívida',
  auditoria: 'verificação de conformidade',
  seguranca: 'investigação de incidente',
};

/**
 * Campo com dado pessoal. O estado padrão é mascarado, para todo mundo.
 *
 * Sensível não tem botão: não existe caminho na interface que revele dado do
 * Art. 11. Para os demais, revelar exige finalidade **catalogada** (C-03),
 * justificativa e protocolo selecionado (T4-01), dura 60 segundos contados por
 * relógio (C-05) e volta a mascarar sozinho.
 */
export function CampoPII({ titularId, chave, rotulo, mascara, sensivel }: {
  titularId: string; chave: string; rotulo: string; mascara: string; sensivel: boolean;
}) {
  const chamar = useSessao((s) => s.chamar);
  const banco = useSessao((s) => s.banco);
  const protocolo = useSessao((s) => s.protocoloSelecionado);
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState<string | null>(null);
  const [expiraEm, setExpiraEm] = useState(0);
  const [restante, setRestante] = useState(0);
  const [finalidade, setFinalidade] = useState<Finalidade | ''>('');
  const [justificativa, setJustificativa] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * C-05 — a janela é um instante no futuro, não um contador que só anda
   * enquanto a aba está viva. `setInterval` em aba inativa é estrangulado pelo
   * navegador, e o valor ficava visível muito além dos 60 segundos anunciados.
   * Aqui o tick só desenha; quem decide é o relógio.
   */
  useEffect(() => {
    if (!expiraEm) return;
    const tick = () => {
      const falta = Math.max(0, Math.ceil((expiraEm - Date.now()) / 1000));
      setRestante(falta);
      if (falta === 0) {
        setValor(null);
        setExpiraEm(0);
        if (timer.current) clearInterval(timer.current);
      }
    };
    tick();
    timer.current = setInterval(tick, 250);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [expiraEm]);

  if (sensivel) {
    return (
      <span className="masked sensivel" title="Dado sensível — o Art. 11 não admite revelação nesta interface">
        🔒 <span>não revelável</span>
      </span>
    );
  }

  /**
   * C-03 — as finalidades ofertadas são as do catálogo, não uma lista fixa da
   * tela. Campo fora do ROPA (C-17) ou sem finalidade registrada não recebe
   * botão: o formulário deixa de oferecer o que a API vai recusar.
   */
  const meta = banco.cenario.titulares.find((t) => t.id === titularId)?.campos.find((c) => c.chave === chave);
  const catalogado = meta?.campoCatalogoId
    ? banco.cenario.campos.find((c) => c.id === meta.campoCatalogoId)
    : undefined;
  const finalidadesOfertadas = catalogado?.finalidadesCompativeis ?? [];
  /**
   * C-08 — a revogação propaga até o botão. A rota já recusa com 422, mas
   * deixar o controle na tela ofereceria um caminho que a API não aceita: a
   * pessoa clica, preenche justificativa e só então descobre que o titular
   * revogou. Mesma disciplina do C-03.
   */
  const consentimentoVivo = catalogado?.baseLegal !== 'consentimento'
    || banco.cenario.consentimentos.some((c) => c.campoId === catalogado?.id && c.estado === 'ativo');
  const revelavel = finalidadesOfertadas.length > 0 && consentimentoVivo;

  const previa = redigir(justificativa);

  const confirmar = () => {
    const res = chamar<{ valor: string; expiraEmSegundos: number }>({
      metodo: 'POST',
      caminho: '/v1/pseudonyms/resolve',
      purpose: finalidade || undefined,
      body: { titularId, campo: chave, justificativa, protocolo },
    });
    if (res.status !== 200) return;

    setValor(res.body.valor);
    setExpiraEm(Date.now() + res.body.expiraEmSegundos * 1000);
    setAberto(false);
    setJustificativa('');
    setFinalidade('');
  };

  return (
    <>
      <span className={`masked ${valor ? 'aberto' : ''}`}>
        <span className="dots">{valor ?? mascara}</span>
        {valor
          ? <span className="countdown">{restante}s</span>
          : revelavel ? (
            <Permitido acao="revelar_pii">
              <button className="reveal" onClick={() => setAberto(true)}>revelar</button>
            </Permitido>
          ) : !consentimentoVivo && (
            // A ausência precisa dizer por quê: some o botão, fica a razão.
            <span className="hint">consentimento revogado</span>
          )}
      </span>

      {aberto && (
        <Modal
          titulo={`Revelar ${rotulo}`}
          aoFechar={() => setAberto(false)}
          rodape={<>
            <button className="btn" onClick={() => setAberto(false)}>Cancelar</button>
            <button
              className="btn primary"
              disabled={!finalidade || justificativa.trim().length < 20 || !protocolo}
              onClick={confirmar}
            >
              Revelar e registrar
            </button>
          </>}
        >
          <Nota tom="warn">
            A tentativa é gravada no audit trail <b>antes</b> da resposta, com o seu nome, a finalidade,
            o protocolo e os campos efetivamente exibidos. O valor volta a ficar mascarado em 60 segundos.
          </Nota>
          {protocolo
            ? <p className="hint" style={{ marginTop: 8 }}>Sob o protocolo <span className="mono">{protocolo}</span>.</p>
            : <Nota tom="crit">Nenhuma solicitação selecionada. Escolha o protocolo na fila antes de revelar — é ele que amarra o acesso ao atendimento.</Nota>}
          <div className="field">
            <label htmlFor="rev-finalidade">Finalidade do acesso</label>
            <select id="rev-finalidade" value={finalidade} onChange={(e) => setFinalidade(e.target.value as Finalidade)}>
              <option value="">Selecione…</option>
              {finalidadesOfertadas.map((f) => (
                <option key={f} value={f}>{f} — {GLOSSA_FINALIDADE[f]}</option>
              ))}
            </select>
            <span className="hint">
              Finalidades registradas no catálogo para <span className="mono">{catalogado?.nome}</span>.
              A rota recusa qualquer outra.
            </span>
          </div>
          <div className="field">
            <label htmlFor="rev-justificativa">Justificativa (mínimo 20 caracteres)</label>
            <textarea
              id="rev-justificativa"
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Ex.: confirmação de identidade para o protocolo 2026-0731"
            />
            <span className="hint">{justificativa.trim().length}/20</span>
          </div>
          {/* C-04 — o texto gravado é mostrado antes de gravar. O trail é imutável:
              descobrir depois que o CPF foi para lá não adianta nada. */}
          {previa.houveRemocao && (
            <Nota tom="warn">
              A justificativa contém {resumoDaRedacao(previa.achados)} — será gravada assim:
              {' '}<span className="mono">{previa.texto}</span>
            </Nota>
          )}
        </Modal>
      )}
    </>
  );
}

export function Cabecalho({ fontes, titulo, resumo, nota }: {
  fontes: string[]; titulo: string; resumo: string; nota: Partial<Record<string, string>>;
}) {
  const papel = useSessao((s) => s.papel);
  const rotulos: Record<string, string> = {
    engenharia: 'Engenharia', dpo: 'DPO', produto: 'Produto', seguranca: 'Segurança', auditor: 'Auditor externo',
  };
  return (
    <header className="head">
      <div className="eyebrow">{fontes.map((f) => <span className="src" key={f}>{f}</span>)}</div>
      <h1>{titulo}</h1>
      <p>{resumo}</p>
      {nota[papel] && <div className="role-note"><b>{rotulos[papel]}</b> · {nota[papel]}</div>}
    </header>
  );
}

export const Tabela = ({ cabecalho, children, dense }: { cabecalho: string[]; children: ReactNode; dense?: boolean }) => (
  <div className="tw">
    <table className={dense ? 'dense' : undefined}>
      <thead><tr>{cabecalho.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
