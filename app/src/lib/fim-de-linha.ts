/**
 * Fim de linha na árvore de trabalho, medido em vez de declarado.
 *
 * O `.gitattributes` fixa LF, e o leitor de cada formato normaliza CRLF sozinho.
 * Duas camadas — e nenhuma das duas se prova a si mesma. Num runner Windows,
 * `core.autocrlf` é configuração do ambiente, não do repositório: `actions/checkout`
 * pode deixá-lo em `true`, e uma versão futura dele pode mudar isso sem avisar
 * ninguém.
 *
 * Este módulo existe para que a etapa do CI **imprima o que encontrou**, em vez
 * de o repositório afirmar de memória o que ela encontraria. É medição, não
 * catraca: reprovar aqui exigiria decidir que CRLF na árvore é defeito, e não é
 * — a primeira camada existe justamente para tolerá-lo em quem clonou antes.
 * O que seria defeito é ninguém saber qual dos dois casos está rodando.
 */

export type Medida = {
  /** Quantas quebras `\r\n`. */
  crlf: number;
  /** Quantas quebras `\n` sem `\r` antes. */
  lf: number;
  /** `\r` solto, sem `\n` depois — nem um nem outro, e o caso que mais confunde. */
  crSozinho: number;
};

/**
 * Conta as três formas de quebra num texto.
 *
 * Sobre bytes e não sobre linhas: `split` já perderia a informação que se quer
 * medir, porque `split(/\r?\n/)` normaliza — que é exatamente o que a primeira
 * camada faz, e o que este módulo precisa **não** fazer para poder observá-la.
 */
export const medirFimDeLinha = (conteudo: string): Medida => {
  let crlf = 0;
  let lf = 0;
  let crSozinho = 0;
  for (let i = 0; i < conteudo.length; i += 1) {
    const c = conteudo[i];
    if (c === '\r') {
      if (conteudo[i + 1] === '\n') { crlf += 1; i += 1; } else { crSozinho += 1; }
    } else if (c === '\n') {
      lf += 1;
    }
  }
  return { crlf, lf, crSozinho };
};

/** Uma linha de relatório por arquivo, na mesma forma nas duas plataformas. */
export const linhaDaMedida = (caminho: string, m: Medida): string =>
  `  ${caminho.padEnd(48)} LF=${String(m.lf).padStart(5)}  CRLF=${String(m.crlf).padStart(5)}`
  + `  CR=${String(m.crSozinho).padStart(3)}`;
