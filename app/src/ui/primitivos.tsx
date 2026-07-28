import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSessao } from '../store/sessao';
import { pode, type Acao } from '../mock/permissoes';
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

const FINALIDADES: { valor: Finalidade; rotulo: string }[] = [
  { valor: 'atendimento', rotulo: 'atendimento — responder solicitação do titular' },
  { valor: 'cobranca', rotulo: 'cobranca — negociação de dívida' },
  { valor: 'auditoria', rotulo: 'auditoria — verificação de conformidade' },
];

/**
 * Campo com dado pessoal. O estado padrão é mascarado, para todo mundo.
 *
 * Sensível não tem botão: não existe caminho na interface que revele dado do
 * Art. 11. Para os demais, revelar exige finalidade e justificativa, dura 60
 * segundos e volta a mascarar sozinho.
 */
export function CampoPII({ titularId, chave, rotulo, mascara, sensivel }: {
  titularId: string; chave: string; rotulo: string; mascara: string; sensivel: boolean;
}) {
  const chamar = useSessao((s) => s.chamar);
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState<string | null>(null);
  const [restante, setRestante] = useState(0);
  const [finalidade, setFinalidade] = useState<Finalidade | ''>('');
  const [justificativa, setJustificativa] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  if (sensivel) {
    return (
      <span className="masked sensivel" title="Dado sensível — o Art. 11 não admite revelação nesta interface">
        🔒 <span>não revelável</span>
      </span>
    );
  }

  const confirmar = () => {
    const res = chamar<{ valor: string; expiraEmSegundos: number }>({
      metodo: 'POST',
      caminho: '/v1/pseudonyms/resolve',
      purpose: finalidade || undefined,
      body: { titularId, campo: chave, justificativa },
    });
    if (res.status !== 200) return;

    setValor(res.body.valor);
    setRestante(res.body.expiraEmSegundos);
    setAberto(false);
    setJustificativa('');
    setFinalidade('');
    timer.current = setInterval(() => {
      setRestante((r) => {
        if (r <= 1) {
          if (timer.current) clearInterval(timer.current);
          setValor(null);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  };

  return (
    <>
      <span className={`masked ${valor ? 'aberto' : ''}`}>
        <span className="dots">{valor ?? mascara}</span>
        {valor
          ? <span className="countdown">{restante}s</span>
          : (
            <Permitido acao="revelar_pii">
              <button className="reveal" onClick={() => setAberto(true)}>revelar</button>
            </Permitido>
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
              disabled={!finalidade || justificativa.trim().length < 20}
              onClick={confirmar}
            >
              Revelar e registrar
            </button>
          </>}
        >
          <Nota tom="warn">
            A tentativa é gravada no audit trail <b>antes</b> da resposta, com o seu nome, a finalidade
            e os campos efetivamente exibidos. O valor volta a ficar mascarado em 60 segundos.
          </Nota>
          <div className="field">
            <label htmlFor="rev-finalidade">Finalidade do acesso</label>
            <select id="rev-finalidade" value={finalidade} onChange={(e) => setFinalidade(e.target.value as Finalidade)}>
              <option value="">Selecione…</option>
              {FINALIDADES.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
            </select>
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
