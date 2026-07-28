import { useState } from 'react';
import { Modal, Nota } from './primitivos';
import { useSessao } from '../store/sessao';
import { redigir, resumoDaRedacao } from '../lib/redator';
import type { Risco } from '../mock/types';

/**
 * Reclassificar um risco muda a prioridade do programa inteiro. Por isso a
 * justificativa é obrigatória e o histórico é imutável — quem defende a
 * priorização seis meses depois precisa do porquê, não só do número novo.
 */
export function ModalReclassificar({ risco, p, i, aoFechar }: {
  risco: Risco; p: number; i: number; aoFechar: (aplicado: boolean) => void;
}) {
  const chamar = useSessao((s) => s.chamar);
  const [justificativa, setJustificativa] = useState('');
  const [prob, setProb] = useState(p);
  const [imp, setImp] = useState(i);
  const previa = redigir(justificativa);

  const aplicar = () => {
    const res = chamar({
      metodo: 'PATCH',
      caminho: `/v1/risks/${risco.codigo}`,
      body: { probabilidade: prob, impacto: imp, justificativa },
    });
    aoFechar(res.status === 200);
  };

  return (
    <Modal
      titulo={`Reclassificar ${risco.codigo}`}
      aoFechar={() => aoFechar(false)}
      rodape={<>
        <button className="btn" onClick={() => aoFechar(false)}>Descartar mudança</button>
        <button className="btn primary" disabled={justificativa.trim().length < 20} onClick={aplicar}>
          Registrar reclassificação
        </button>
      </>}
    >
      <Nota>
        O histórico é imutável: a justificativa fica anexada para sempre e não pode ser editada nem removida.
      </Nota>
      <p className="mono" style={{ margin: 0 }}>
        P {risco.probabilidade} → {prob} · I {risco.impacto} → {imp} ·
        {' '}score {risco.probabilidade * risco.impacto} → {prob * imp}
      </p>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="rc-p">Probabilidade</label>
          <select id="rc-p" value={prob} onChange={(e) => setProb(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="rc-i">Impacto</label>
          <select id="rc-i" value={imp} onChange={(e) => setImp(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="rc-just">Justificativa da nova classificação (mínimo 20 caracteres)</label>
        <textarea
          id="rc-just"
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          placeholder="Ex.: pseudonimização HMAC em produção desde 04/08 reduz a probabilidade de exposição."
        />
        <span className="hint">{justificativa.trim().length}/20</span>
      </div>
      {/* C-04 — mesma prévia da revelação: o que vai para o histórico imutável
          é mostrado antes de ir, porque depois não sai mais. */}
      {previa.houveRemocao && (
        <Nota tom="warn">
          A justificativa contém {resumoDaRedacao(previa.achados)} — será registrada assim:
          {' '}<span className="mono">{previa.texto}</span>
        </Nota>
      )}
    </Modal>
  );
}

export const CORES_DANO: Record<string, string> = {
  material: 'var(--crit)',
  discriminacao: 'var(--sens)',
  moral: 'var(--warn)',
  perda_de_controle: 'var(--warn)',
};
