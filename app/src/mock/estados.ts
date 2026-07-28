/**
 * Máquinas de estado dos artefatos.
 *
 * Este arquivo responde a **uma** pergunta: a transição é legal? Ele não sabe o
 * que é o Art. 48, não lê fundamento e não conhece papel. A separação é
 * deliberada:
 *
 * - **verificação** (aqui): o artefato pode ir de `de` para `para`?
 * - **validação** (em `api.ts`): este pedido satisfaz a lei — fundamento
 *   presente, redigido, ator autorizado, registro gravado?
 *
 * Misturar as duas produz o defeito clássico: uma transição passa porque a
 * justificativa estava boa, ou é recusada por 422 quando o problema era a
 * ordem dos passos. Os dois erros merecem códigos diferentes — 409 para
 * sequência, 422 para conteúdo — e é essa distinção que os testes cobram.
 *
 * O PR 7 do `MAPA-PROCESSOS.md` generaliza isto para parecer, ripd, lia,
 * risco, solicitação, achado e chave. Aqui entra só o incidente, que é o que o
 * PR 4 precisa — máquina declarada agora vale mais que máquina genérica depois.
 */

import type { EstadoIncidente } from './types';

/**
 * Art. 48 na ordem em que a fiscalização espera encontrar:
 *
 *   aberto → contido → decidido → { comunicado | nao_comunicado } → encerrado
 *
 * Conter antes de decidir não é burocracia. Decidir o que comunicar antes de
 * estancar o vazamento significa comunicar um escopo que ainda está crescendo,
 * e comunicação com número errado precisa ser refeita — na frente do titular.
 */
export const TRANSICOES_INCIDENTE: Record<EstadoIncidente, EstadoIncidente[]> = {
  aberto: ['contido'],
  contido: ['decidido'],
  decidido: ['comunicado', 'nao_comunicado'],
  comunicado: ['encerrado'],
  nao_comunicado: ['encerrado'],
  encerrado: [],
};

export const transicaoPermitida = (de: EstadoIncidente, para: EstadoIncidente): boolean =>
  TRANSICOES_INCIDENTE[de].includes(para);

/**
 * Por que a transição foi recusada, em linguagem de gente. Fica junto da tabela
 * para não haver dois lugares dizendo o que é legal — a mensagem é derivada da
 * mesma fonte que a decisão.
 */
export function motivoDaRecusa(de: EstadoIncidente, para: EstadoIncidente): string {
  if (de === 'encerrado') return 'O incidente está encerrado: reabrir é registro novo, não edição deste.';
  if (de === 'aberto' && para !== 'contido') {
    return 'A contenção vem antes: decidir com o vazamento em curso é comunicar um escopo que ainda está crescendo.';
  }
  if (de === 'contido' && (para === 'comunicado' || para === 'nao_comunicado')) {
    return 'A comunicação sai da decisão registrada, não direto da contenção — sem decisão não há fundamento para exibir.';
  }
  const permitidos = TRANSICOES_INCIDENTE[de];
  return permitidos.length
    ? `De "${de}" o incidente só avança para ${permitidos.map((e) => `"${e}"`).join(' ou ')}.`
    : `De "${de}" o incidente não avança.`;
}
