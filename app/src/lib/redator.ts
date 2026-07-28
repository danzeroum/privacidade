/**
 * Redator de PII para texto livre (C-04).
 *
 * O audit trail é imutável: o que entra nele fica. Justificativa de revelação,
 * fundamento de reclassificação, motivo de revisão — tudo isso é campo aberto
 * onde alguém digita "confirmando o CPF 529.982.247-25 da titular" com a melhor
 * das intenções, e o documento passa a viver para sempre num registro que
 * ninguém pode editar. Redigir depois não é opção; a redação acontece **antes
 * do append**, não na exibição.
 *
 * Vive em `lib/` de propósito: é usado pela API antes de gravar e pela interface
 * para mostrar o texto que será gravado. Uma função só, um resultado só.
 */

export interface Achado {
  tipo: 'cpf' | 'cnpj' | 'email' | 'telefone' | 'cartao';
  original: string;
}

export interface Redacao {
  texto: string;
  achados: Achado[];
  get houveRemocao(): boolean;
}

const PADROES: { tipo: Achado['tipo']; re: RegExp; marca: string }[] = [
  { tipo: 'cpf', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, marca: '[CPF removido]' },
  { tipo: 'cnpj', re: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, marca: '[CNPJ removido]' },
  { tipo: 'cartao', re: /\b(?:\d{4}[ -]?){3}\d{4}\b/g, marca: '[cartão removido]' },
  { tipo: 'email', re: /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, marca: '[e-mail removido]' },
  { tipo: 'telefone', re: /\(?\b\d{2}\)?[ -]?9?\d{4}[ -]?\d{4}\b/g, marca: '[telefone removido]' },
];

/**
 * Devolve o texto redigido e o que foi removido.
 *
 * A ordem dos padrões importa: CNPJ e cartão antes de telefone, porque a
 * máscara de telefone casaria com pedaços dos outros dois e deixaria o resto
 * do número exposto. Redação parcial é pior que nenhuma — dá a impressão de
 * que o controle funcionou.
 */
export function redigir(texto: string): Redacao {
  const achados: Achado[] = [];
  let saida = texto;

  for (const { tipo, re, marca } of PADROES) {
    saida = saida.replace(new RegExp(re.source, re.flags), (encontrado) => {
      achados.push({ tipo, original: encontrado });
      return marca;
    });
  }

  return {
    texto: saida,
    achados,
    get houveRemocao() { return achados.length > 0; },
  };
}

/** Atalho para quem só quer o texto pronto para gravar. */
export const textoRedigido = (texto: string): string => redigir(texto).texto;

/** Rótulo legível do que foi removido, para a prévia na interface. */
export function resumoDaRedacao(achados: Achado[]): string {
  if (achados.length === 0) return '';
  const contagem = achados.reduce<Record<string, number>>((acc, a) => {
    acc[a.tipo] = (acc[a.tipo] ?? 0) + 1;
    return acc;
  }, {});
  const nomes: Record<string, string> = {
    cpf: 'CPF', cnpj: 'CNPJ', email: 'e-mail', telefone: 'telefone', cartao: 'cartão',
  };
  return Object.entries(contagem)
    .map(([t, n]) => (n > 1 ? `${n} ${nomes[t]}s` : `1 ${nomes[t]}`))
    .join(', ');
}
