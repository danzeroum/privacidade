/**
 * A finalidade declarada, conferida por uma função só (Risco-011).
 *
 * O `openapi.yaml:20` promete, desde a primeira versão, que *"`X-Purpose` é
 * obrigatório em qualquer rota do console que toque dado de titular. Ausência
 * devolve 403 e grava `ACESSO_SEM_FINALIDADE` no audit trail"*. Quando o PR 5
 * mediu: **três** das 68 operações declaravam o cabeçalho no contrato e **duas**
 * o exigiam no código. A ação `ACESSO_SEM_FINALIDADE` não existia em lugar
 * nenhum do repositório — o contrato prometia um registro que nenhuma linha
 * escrevia.
 *
 * A conferência de compatibilidade morava **dentro** de `POST /pseudonyms/resolve`
 * (`api.ts:195`). Regra dentro de rota é regra que a próxima rota não herda: a
 * segunda implementação diverge, e a que vale acaba sendo a que ninguém está
 * olhando. Aqui ela é uma função, aplicada pela guarda do dispatcher a toda rota
 * que a política declara `exigida`.
 */

import type { BancoMock } from './db';
import type { Campo, Finalidade } from './types';

/**
 * A ação que o contrato prometia e ninguém escrevia.
 *
 * Fica fora de `ACOES_PII` de propósito: a tentativa foi **negada**, e o append
 * de uma negativa não pode exigir a finalidade que acabou de faltar — seria uma
 * regra que impede o registro do próprio descumprimento dela.
 */
export const ACESSO_SEM_FINALIDADE = 'ACESSO_SEM_FINALIDADE';

/**
 * O campo do catálogo que este pedido alcança, se houver.
 *
 * Nem toda rota que exige finalidade nomeia um campo — `GET /audit` lê o trail
 * inteiro, `GET /requests` lê a fila. Quando o pedido nomeia um, a
 * compatibilidade é conferível, e conferir é obrigatório; quando não nomeia,
 * exigir a declaração é tudo o que se pode fazer, e é o que se faz.
 */
export function campoAlcancado(
  banco: BancoMock, body: Record<string, unknown>, partes: string[],
): Campo | null {
  const porId = String(body.campoId ?? '');
  if (porId) return banco.cenario.campos.find((c) => c.id === porId) ?? null;

  const chave = String(body.campo ?? '');
  if (!chave) return null;

  // A chave vem do registro do titular (`cpf`, `renda`), e o elo com o catálogo
  // é `campoCatalogoId`. Sem titular no pedido, procura pela chave direta — é o
  // caso das rotas que operam sobre o catálogo em vez de sobre uma pessoa.
  const titularId = String(body.titularId ?? partes[1] ?? '');
  const titular = banco.cenario.titulares.find((t) => t.id === titularId);
  const meta = titular?.campos.find((c) => c.chave === chave);
  if (meta?.campoCatalogoId) {
    return banco.cenario.campos.find((c) => c.id === meta.campoCatalogoId) ?? null;
  }
  return banco.cenario.campos.find((c) => c.nome === chave) ?? null;
}

export interface RecusaDeFinalidade {
  status: 403 | 422;
  mensagem: string;
  regra: string;
  /** Como a negativa entra no trail. */
  motivoNoTrail: string;
}

/**
 * A finalidade declarada sustenta este acesso?
 *
 * Duas recusas diferentes, e a diferença importa para quem recebe: **403** é
 * "você não declarou"; **422** é "você declarou uma que o catálogo não registra
 * para este campo". A primeira se resolve mandando o cabeçalho, a segunda
 * exigindo uma conversa sobre o inventário — e um erro genérico mandaria a
 * pessoa para a conversa errada.
 *
 * Lista vazia de finalidades compatíveis significa **não acessável**, jamais
 * "qualquer uma" (C-03): campo que nasce sem política não ganha política por
 * omissão.
 */
export function recusaDeFinalidade(
  purpose: Finalidade | undefined, campo: Campo | null,
): RecusaDeFinalidade | null {
  if (!purpose) {
    return {
      status: 403,
      mensagem: 'Finalidade não declarada no cabeçalho X-Purpose.',
      regra: 'Art. 37: acesso a dado pessoal exige finalidade registrada no momento do acesso.',
      motivoNoTrail: 'sem X-Purpose',
    };
  }
  if (!campo) return null;
  /**
   * Campo sensível sai daqui intocado, e a recusa dele é da rota (Art. 11).
   *
   * Um campo sensível não tem finalidade compatível nenhuma — a lista é vazia
   * por desenho. Se esta função respondesse primeiro, a pessoa receberia "a
   * finalidade não consta no catálogo", que sugere um caminho: registrar a
   * finalidade e voltar. Não há caminho. Dado sensível não é revelável em tela
   * alguma, e é essa frase que precisa chegar.
   */
  if (campo.sensivel) return null;
  if (campo.finalidadesCompativeis.includes(purpose)) return null;

  const registradas = campo.finalidadesCompativeis.length > 0
    ? `As registradas para ele são: ${campo.finalidadesCompativeis.join(', ')}.`
    : 'Ele não tem nenhuma finalidade de acesso registrada.';
  return {
    status: 422,
    mensagem: `A finalidade "${purpose}" não consta no catálogo para ${campo.nome}. ${registradas}`,
    regra: 'Art. 6º, I: a finalidade do acesso precisa ser uma das declaradas no inventário para aquele campo.',
    motivoNoTrail: `finalidade ${purpose} incompatível`,
  };
}
