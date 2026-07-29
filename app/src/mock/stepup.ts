/**
 * Step-up de autenticação no console (Risco-011).
 *
 * A palavra estava em cinco lugares do repositório e em nenhuma linha
 * executável: `db/schema.sql:35` ("exibido sem máscara só com finalidade +
 * step-up"), `:740` ("a resolução é feita pelo serviço do produto, com
 * finalidade declarada e step-up"), `:766` ("eliminação exige verificação
 * elevada"), `docs/01-arquitetura.md:143` e `:158`. `grep -rn "step-up" app/src/`
 * voltava vazio. É o padrão sistêmico nº 2 do relatório em estado puro:
 * promessa sem instrumento.
 *
 * ## O que este módulo instrumenta — e o que ele não é
 *
 * **Não há MFA real aqui.** Um protótipo em memória não tem TOTP, não tem
 * WebAuthn e não tem canal para entregar código. Dizer o contrário seria repetir
 * o defeito que este PR fecha, uma camada abaixo.
 *
 * O que é instrumentado é tudo o que pode ser, e hoje não é:
 *
 * · a **derivação** — a janela vem da operação, lida de `politicas.ts` no
 *   servidor. Cliente que mandasse o próprio nível estaria alegando, não
 *   provando, e é a mesma regra do nível de verificação do portal, que vem do
 *   direito e não do pedido;
 * · a **janela** — conferida no instante do uso, com fronteira exata;
 * · a **recusa** — que diz o que falta e por quanto tempo a confirmação vale,
 *   em vez de um 403 seco que manda a pessoa adivinhar;
 * · o **registro** — confirmar e usar deixam rastro no trail.
 *
 * O fator em si é simulado, e está dito aqui em vez de insinuado por um nome de
 * variável.
 */

import { sha256 } from '../lib/sha256';

/** O que o desafio pede. Nomes reais, comportamento simulado — e isso está dito. */
export type FatorDeStepUp = 'totp' | 'webauthn';

export interface DesafioDeStepUp {
  id: string;
  ator: string;
  fator: FatorDeStepUp;
  /**
   * Nunca sai numa resposta: vai pelo canal, como no portal. Numa plataforma de
   * verdade nem existiria — o TOTP nasce no autenticador da pessoa.
   */
  codigo: string;
  criadoEmMs: number;
  expiraEmMs: number;
  tentativas: number;
}

export interface SessaoDeStepUp {
  ator: string;
  fator: FatorDeStepUp;
  confirmadoEmMs: number;
}

/** O desafio vence em 5 minutos. Não é a janela do step-up — são coisas diferentes. */
export const VALIDADE_DO_DESAFIO_MS = 5 * 60_000;

/** Três tentativas. Desafio que aceita tentativa infinita é código de seis dígitos sem senha. */
export const TENTATIVAS_MAXIMAS = 3;

/**
 * O código do desafio, derivado da sequência — mesma mecânica do portal.
 *
 * Determinístico de propósito: o demo precisa poder mostrá-lo, e o teste
 * precisa poder acertá-lo sem ler o objeto. O que sustenta a prova não é o
 * segredo do código, é a janela e a recusa.
 */
export const novoCodigoDeStepUp = (sequencia: number): string =>
  String(parseInt(sha256(`step-up|${sequencia}`).slice(0, 8), 16) % 1_000_000).padStart(6, '0');

/**
 * A confirmação ainda vale nesta hora?
 *
 * Vale **no último segundo** da janela: o limite cobre o instante do vencimento,
 * como o DPA cobre o último dia do contrato. Um milissegundo depois, não vale
 * mais — e a fronteira é testada nos dois lados, porque prazo que só é testado
 * no meio não é prazo, é intenção.
 */
export function stepUpVigente(
  sessao: SessaoDeStepUp | undefined, agoraMs: number, janelaMin: number,
): boolean {
  if (!sessao) return false;
  return agoraMs <= sessao.confirmadoEmMs + janelaMin * 60_000;
}

/** Quanto falta para a confirmação vencer, em segundos. Negativo quando já venceu. */
export const segundosRestantes = (
  sessao: SessaoDeStepUp, agoraMs: number, janelaMin: number,
): number => Math.round((sessao.confirmadoEmMs + janelaMin * 60_000 - agoraMs) / 1000);

/**
 * Por que a operação foi recusada, com o que falta e por quanto tempo vale.
 *
 * Uma recusa que só diz "403" transfere para a pessoa o trabalho de descobrir a
 * regra — e a pessoa descobre pedindo para alguém desligar a regra. Dizer "a sua
 * confirmação foi há 14 minutos e esta operação exige 10" é o que faz a
 * exigência parecer o que ela é: uma janela, não um capricho.
 */
export function motivoDaFaltaDeStepUp(
  sessao: SessaoDeStepUp | undefined, agoraMs: number, janelaMin: number,
): string | null {
  if (stepUpVigente(sessao, agoraMs, janelaMin)) return null;
  if (!sessao) {
    return 'Esta operação exige confirmação de identidade antes de ser executada. '
      + `Confirme em POST /v1/step-up e refaça o pedido: a confirmação vale ${janelaMin} minutos.`;
  }
  const minutos = Math.floor((agoraMs - sessao.confirmadoEmMs) / 60_000);
  return `A sua última confirmação de identidade foi há ${minutos} minuto(s), e esta operação exige `
    + `uma dos últimos ${janelaMin}. Confirme de novo em POST /v1/step-up e refaça o pedido.`;
}
