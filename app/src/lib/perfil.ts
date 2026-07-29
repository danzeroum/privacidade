/**
 * O perfil do build (Riscos 035, 037, 040).
 *
 * O RIPD §7.3 lista quatro coisas que **precisam deixar de ser verdade antes de
 * qualquer produção**: `modoDemo` ligado com a rota de forja viva, papel
 * escolhido por botão, sessão sem credencial e PII sintética embarcada no
 * cliente. Até aqui as quatro eram nota de rodapé — um documento avisando, o
 * que é a forma mais educada de não impedir nada.
 *
 * Este módulo é o que transforma as quatro em condição de build. `VITE_PERFIL`
 * decide, e o padrão é `demonstracao`: um protótipo que se comportasse como
 * produção por omissão simplesmente não funcionaria, e alguém desligaria a
 * checagem em vez de configurá-la.
 *
 * ## Por que constante, e não função
 *
 * `EH_DEMONSTRACAO` é avaliada em tempo de build. O Vite substitui
 * `import.meta.env.VITE_PERFIL` pelo literal, o esbuild dobra a comparação, e o
 * ramo morto **some do artefato**. É a diferença entre a rota de forja responder
 * 404 em produção e a rota de forja não existir em produção — a primeira é uma
 * checagem que alguém remove, a segunda é código que não foi publicado.
 *
 * Uma função `ehDemonstracao()` não dobraria nada, e a catraca do PR 6 passaria
 * a encontrar tudo o que ela existe para não encontrar.
 */

export type Perfil = 'demonstracao' | 'producao';

/**
 * Puro e testável: o build não é a única coisa que precisa provar isto.
 *
 * Qualquer valor que não seja exatamente `producao` cai em demonstração. O
 * contrário — cair em produção por engano de digitação — publicaria um artefato
 * mudo e daria a impressão de que a catraca aprovou alguma coisa.
 */
export const perfilDe = (env: { VITE_PERFIL?: string } | undefined): Perfil =>
  (env?.VITE_PERFIL === 'producao' ? 'producao' : 'demonstracao');

export const PERFIL: Perfil = perfilDe(import.meta.env as { VITE_PERFIL?: string });

export const EH_DEMONSTRACAO = PERFIL === 'demonstracao';

/**
 * Selos que viajam junto do que eles marcam.
 *
 * Cada um vive **dentro** do próprio código que a catraca procura: o selo da
 * demonstração está no invólucro que só o perfil de demonstração renderiza, o do
 * seletor está no controle de troca de papel. Achar o selo no artefato prova que
 * o código veio junto; não achar prova que ele ficou de fora.
 *
 * Não são bandeiras decorativas: um selo colado longe do que marca provaria
 * apenas que alguém escreveu uma string.
 */
export const SELO_DE_DEMONSTRACAO = 'lastro:perfil-demonstracao';
export const SELO_DO_SELETOR_DE_PAPEL = 'lastro:papel-por-botao';
