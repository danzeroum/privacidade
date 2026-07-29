/**
 * Consentimento como **entidade**, e não como contador (Risco-002).
 *
 * O modelo anterior era `{ campoId, versao, texto, estado, titulares: number }`
 * — um agregado por campo, com um número no lugar das pessoas. Ele não
 * conseguia responder às duas perguntas que o Art. 8º faz: *esta pessoa
 * consentiu?* e *com qual texto?*. E tornava a revogação individual do Art. 18,
 * VIII inexecutável: revogar mudava o registro do campo inteiro, cessando o
 * tratamento dos outros trinta mil titulares.
 *
 * São **três fatos distintos**, com donos distintos, e por isso três tipos:
 *
 * 1. `TextoDeConsentimento` — a versão publicada. Imutável e compartilhada:
 *    mil pessoas aceitam o mesmo texto, e o texto não é de nenhuma delas.
 * 2. `Consentimento` — o aceite de **uma** pessoa a **uma** versão. Append-only.
 * 3. `RevogacaoDeConsentimento` — o fato novo. **Nunca edita o aceite.**
 *
 * A terceira regra é a que mais custa e a que mais importa. Se revogar apagasse
 * ou alterasse o aceite, a organização perderia justamente a prova de que
 * houve consentimento enquanto houve tratamento — e o Art. 8º, §2º cobra
 * exatamente isso, inclusive depois da revogação. Estado é derivado; fato é
 * guardado.
 */

import { derivarRetencaoAte, diasDeAtraso } from './retencao';

export interface TextoDeConsentimento {
  id: string;
  campoId: string;
  versao: string;
  texto: string;
  /** Sela o texto: mudar o conteúdo sem publicar versão nova é detectável. */
  hash: string;
  publicadoEm: string;
  /**
   * Quanto tempo o aceite vale, no domínio `retencao` do schema.
   *
   * `indeterminado` é legítimo aqui — há consentimento sem prazo —, mas exige a
   * mesma justificativa que o ROPA exige, pelo mesmo motivo: prazo sem fim por
   * omissão é o que faz um aceite de 2019 sustentar um tratamento de hoje.
   */
  validade: string;
  validadeFonte?: string;
  vigente: boolean;
}

export interface Consentimento {
  id: string;
  titularId: string;
  textoId: string;
  canal: string;
  /** AAAA-MM-DD. É o marco de onde a validade conta. */
  coletadoEm: string;
  /** Prova do ato: o que foi apresentado, quando e por onde. */
  provaHash: string;
}

export interface RevogacaoDeConsentimento {
  id: string;
  consentimentoId: string;
  revogadoEmMs: number;
  canal: string;
}

export type EstadoDoConsentimento = 'ativo' | 'revogado' | 'expirado';

/**
 * Quando o aceite deixa de valer por si — sem ninguém revogar.
 *
 * Deriva pela mesma função do ciclo de vida (`gov.retencao_ate` no banco,
 * `derivarRetencaoAte` aqui): não há aritmética de prazo própria do
 * consentimento, e não deve haver. Duas implementações de "somar um período"
 * divergiriam no fim de mês, e a divergência apareceria como um dia a mais de
 * tratamento sem base legal.
 */
export const expiraEm = (texto: TextoDeConsentimento, c: Consentimento): string | null =>
  derivarRetencaoAte(texto.validade, 'coleta', { coleta: c.coletadoEm });

/**
 * O estado, derivado dos fatos. **Revogado precede expirado**: quem revogou no
 * dia seguinte de um aceite que também venceu tem direito a ver "você retirou",
 * não "venceu sozinho" — o ato dele não some porque o relógio também correu.
 */
export function estadoDe(
  texto: TextoDeConsentimento, c: Consentimento,
  revogacao: RevogacaoDeConsentimento | undefined, hojeIso: string,
): EstadoDoConsentimento {
  if (revogacao) return 'revogado';
  const ate = expiraEm(texto, c);
  // Expira **hoje** ainda vale: o prazo é o último dia, não a véspera dele.
  if (ate && diasDeAtraso(ate, hojeIso) > 0) return 'expirado';
  return 'ativo';
}

/**
 * Por que o tratamento parou, em linguagem de pessoa.
 *
 * Revogado e expirado produzem a **mesma** recusa — o tratamento cessa dos dois
 * jeitos —, e motivos diferentes. Um 422 que não distingue os dois manda o
 * titular reclamar de uma retirada que ele não fez, ou aceitar como escolha
 * dele um vencimento que foi da empresa.
 */
export function motivoDaCessacao(
  estado: EstadoDoConsentimento, nome: string, quando: string | null,
): string {
  if (estado === 'revogado') {
    return `Este titular retirou a autorização de ${nome}: o campo não é mais tratável para ele.`;
  }
  return `O consentimento de ${nome} deste titular expirou${quando ? ` em ${quando}` : ''}: `
    + 'sem aceite vigente não há base legal, e renovar é ato do titular, não da empresa.';
}

/**
 * A contagem de titulares, **derivada**.
 *
 * Era um campo (`titulares: number`) e virou uma soma. A diferença não é de
 * estilo: um contador diverge do que conta no primeiro caminho de escrita que
 * esquece de incrementá-lo, e "quantas pessoas consentiram" é o número que uma
 * fiscalização confere primeiro.
 */
export function titularesAtivos(
  textos: TextoDeConsentimento[], consentimentos: Consentimento[],
  revogacoes: RevogacaoDeConsentimento[], campoId: string, hojeIso: string,
): number {
  const doCampo = new Map(textos.filter((t) => t.campoId === campoId).map((t) => [t.id, t]));
  return consentimentos.filter((c) => {
    const texto = doCampo.get(c.textoId);
    if (!texto) return false;
    const rev = revogacoes.find((r) => r.consentimentoId === c.id);
    return estadoDe(texto, c, rev, hojeIso) === 'ativo';
  }).length;
}

/**
 * O campo tem prova versionada para sustentar `base_legal='consentimento'`?
 *
 * A pergunta é sobre o **texto publicado**, não sobre quantas pessoas
 * aceitaram: um campo cujo último titular revogou continua no ROPA — o
 * tratamento dos demais é que cessou. O que não pode existir é campo declarado
 * sob consentimento sem nenhuma versão de texto vigente, porque aí a base legal
 * é uma afirmação sobre a vontade de alguém que ninguém consultou.
 */
export const temProvaVersionada = (textos: TextoDeConsentimento[], campoId: string): boolean =>
  textos.some((t) => t.campoId === campoId && t.vigente);

/** `indeterminado` sem fonte é prazo sem fim por omissão — a mesma regra do ROPA. */
export const validadeJustificada = (t: TextoDeConsentimento): boolean =>
  t.validade !== 'indeterminado' || Boolean(t.validadeFonte && t.validadeFonte.trim());
