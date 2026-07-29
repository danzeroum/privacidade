/**
 * O motor do ciclo de vida do dado (Risco-006).
 *
 * A auditoria descreveu a retenção deste repositório como **declarativa, não
 * estrutural**: o domínio `retencao` existia só na tabela `campo`, como texto
 * ("P5Y", "indeterminado"), e não havia coluna de data, TTL, executor nem prazo
 * para o próprio `audit_log`. Prazo que não faz nada é rótulo, e rótulo não
 * cumpre o Art. 16.
 *
 * Este arquivo é a regra, e existe em **um** lugar. A mesma derivação está
 * escrita como função IMMUTABLE em `db/schema.sql`, e as duas são cobradas
 * contra a mesma tabela de casos (`db/retencao-casos.csv`): o teste em TypeScript
 * lê o CSV, o `db/tests.sql` lê o CSV, e uma divergência entre as duas
 * implementações reprova dos dois lados. Sem isso, "espelhada em SQL e TS" seria
 * uma frase.
 *
 * ## Por que o fato gerador precisou existir
 *
 * `retencao_ate` não é derivável de `retencao` sozinho: "P5Y" a partir de quê?
 * Ninguém declarava isso, e é por isso que a coluna nunca existiu. O fato
 * gerador é a metade que faltava — e ele é do **campo**, declarado no ROPA, não
 * escolhido no momento do expurgo.
 */

/** De que instante o prazo conta. Declarado no catálogo, por campo. */
export type FatoGerador =
  | 'coleta'
  | 'ultima_atualizacao'
  | 'fim_do_contrato'
  | 'revogacao_do_consentimento'
  | 'encerramento_da_solicitacao';

export const FATOS_GERADORES: FatoGerador[] = [
  'coleta', 'ultima_atualizacao', 'fim_do_contrato',
  'revogacao_do_consentimento', 'encerramento_da_solicitacao',
];

/**
 * O domínio `retencao` do schema, já interpretado.
 *
 * `obrigacao_legal` ganhou um prazo obrigatório na sintaxe
 * (`obrigacao_legal:<norma>:P5Y`). Antes era só o nome da norma — e norma sem
 * prazo não deriva data nenhuma, o que fazia a forma mais forte de retenção ser
 * a única sem vencimento calculável.
 */
export type Retencao =
  | { tipo: 'periodo'; anos: number; meses: number; dias: number }
  | { tipo: 'indeterminado' }
  | { tipo: 'consentimento_revogado' }
  | { tipo: 'obrigacao_legal'; norma: string; anos: number; meses: number; dias: number };

const PERIODO = /^P(\d+)([DMY])$/;

/** Espelha o CHECK do domínio. Devolve `null` para o que o banco recusaria. */
export function lerRetencao(texto: string): Retencao | null {
  if (texto === 'indeterminado') return { tipo: 'indeterminado' };
  if (texto === 'consentimento_revogado') return { tipo: 'consentimento_revogado' };

  const obrigacao = /^obrigacao_legal:([a-z0-9_.\- ]+):(P\d+[DMY])$/.exec(texto);
  if (obrigacao) {
    const p = periodo(obrigacao[2]);
    return p && { tipo: 'obrigacao_legal', norma: obrigacao[1], ...p };
  }
  const p = periodo(texto);
  return p && { tipo: 'periodo', ...p };
}

function periodo(texto: string): { anos: number; meses: number; dias: number } | null {
  const m = PERIODO.exec(texto);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'Y' ? { anos: n, meses: 0, dias: 0 }
    : m[2] === 'M' ? { anos: 0, meses: n, dias: 0 }
      : { anos: 0, meses: 0, dias: n };
}

/** Os instantes que o registro conhece. Ausente é ausente — não vira "hoje". */
export interface Marcos {
  coleta?: string | null;
  ultima_atualizacao?: string | null;
  fim_do_contrato?: string | null;
  revogacao_do_consentimento?: string | null;
  encerramento_da_solicitacao?: string | null;
}

/**
 * A derivação. **A única.**
 *
 * Devolve `AAAA-MM-DD` ou `null`. `null` não é "sem prazo": é *ainda não há
 * marco* — consentimento que não foi revogado, contrato que não terminou,
 * solicitação em aberto. A coluna do banco distingue os dois casos por CHECK, e
 * `indeterminado` é o único que exige justificativa no ROPA para poder ser nulo
 * para sempre.
 */
export function derivarRetencaoAte(
  retencaoTexto: string, fatoGerador: FatoGerador, marcos: Marcos,
): string | null {
  const r = lerRetencao(retencaoTexto);
  if (!r) return null;
  if (r.tipo === 'indeterminado') return null;

  /**
   * `consentimento_revogado` ignora o fato gerador declarado e conta da
   * revogação. Não é exceção escondida: é o que o token significa — o prazo
   * nasce quando o consentimento morre, e antes disso não existe.
   */
  const chave: FatoGerador = r.tipo === 'consentimento_revogado'
    ? 'revogacao_do_consentimento'
    : fatoGerador;

  const marco = marcos[chave];
  if (!marco) return null;

  // Carência de 30 dias após a revogação: o tempo de propagar a cascata antes
  // de eliminar. Zero dias faria a revogação e o expurgo disputarem o mesmo
  // instante, e a prova de execução chegaria depois do dado sumir.
  const p = r.tipo === 'consentimento_revogado'
    ? { anos: 0, meses: 0, dias: 30 }
    : { anos: r.anos, meses: r.meses, dias: r.dias };

  return somar(marco, p);
}

/**
 * Aritmética de calendário, **igual à do Postgres**.
 *
 * `date + interval '1 month'` no Postgres grampeia no fim do mês: 31/01 + 1 mês
 * é 28/02, não 03/03. O `setUTCMonth` do JavaScript transborda. Um mês somado
 * de dois jeitos diferentes é a divergência que passaria despercebida por anos
 * e apareceria como "um dia a mais de retenção" num relatório de auditoria — e
 * é por isso que o grampeamento está aqui e o caso está no CSV de paridade.
 */
function somar(marcoIso: string, p: { anos: number; meses: number; dias: number }): string {
  const base = new Date(`${marcoIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return marcoIso.slice(0, 10);

  const ano = base.getUTCFullYear() + p.anos;
  const mesBruto = base.getUTCMonth() + p.meses;
  const anoFinal = ano + Math.floor(mesBruto / 12);
  const mes = ((mesBruto % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(anoFinal, mes + 1, 0)).getUTCDate();
  const dia = Math.min(base.getUTCDate(), ultimoDia);

  const d = new Date(Date.UTC(anoFinal, mes, dia));
  d.setUTCDate(d.getUTCDate() + p.dias);
  return d.toISOString().slice(0, 10);
}

/** Um campo com `indeterminado` precisa dizer por quê — senão é prazo sem fim por omissão. */
export const indeterminadoJustificado = (retencao: string, fonte?: string | null): boolean =>
  retencao !== 'indeterminado' || Boolean(fonte && fonte.trim().length > 0);

/**
 * Obrigação legal prevalece sobre pedido de eliminação (Art. 16, I).
 *
 * Devolve a razão da recusa **com a norma e a data**, ou `null` quando não há o
 * que reter. Um 500 aqui seria o pior desfecho possível: o titular pediu
 * eliminação, o sistema quebrou, e ninguém sabe se apagou.
 */
export function retencaoQueImpedeEliminacao(
  retencaoTexto: string, retencaoAte: string | null,
): { norma: string; retencaoAte: string | null; motivo: string } | null {
  const r = lerRetencao(retencaoTexto);
  if (!r || r.tipo !== 'obrigacao_legal') return null;
  return {
    norma: r.norma,
    retencaoAte,
    motivo: `A eliminação não alcança este dado: ${r.norma} obriga a mantê-lo`
      + `${retencaoAte ? ` até ${retencaoAte}` : ''}. Vencido o prazo, ele é eliminado sem novo pedido.`,
  };
}

// ── vencimento e achado ─────────────────────────────────────────────────────

export const MS_DIA = 24 * 60 * 60 * 1000;

/** Dias de atraso de um vencimento. Negativo é futuro; zero é hoje, e hoje não atrasou. */
export function diasDeAtraso(retencaoAte: string | null, hojeIso: string): number {
  if (!retencaoAte) return 0;
  const venc = Date.parse(`${retencaoAte}T00:00:00Z`);
  const hoje = Date.parse(`${hojeIso.slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.floor((hoje - venc) / MS_DIA));
}

export type Criticidade = 'baixa' | 'media' | 'alta' | 'critica';

/**
 * A matriz volume × atraso, declarada e não espalhada em `if`.
 *
 * Volume importa porque mil registros vencidos e um milhão não são o mesmo
 * achado; atraso importa porque um dia é operação e um mês é processo. As duas
 * dimensões juntas, e a pior das duas manda: um milhão de registros vencidos
 * ontem já é crítico, e cem registros vencidos há um ano também.
 */
const POR_ATRASO: [number, Criticidade][] = [
  [90, 'critica'], [30, 'alta'], [7, 'media'], [1, 'baixa'],
];
const POR_VOLUME: [number, Criticidade][] = [
  [1_000_000, 'critica'], [100_000, 'alta'], [1_000, 'media'], [1, 'baixa'],
];
const ORDEM: Criticidade[] = ['baixa', 'media', 'alta', 'critica'];

const faixa = (tabela: [number, Criticidade][], valor: number): Criticidade | null => {
  for (const [piso, c] of tabela) if (valor >= piso) return c;
  return null;
};

export function criticidadeDoVencimento(atrasoDias: number, registros: number): Criticidade | null {
  // Zero dia de atraso não é achado: o prazo é hoje, e hoje ainda dá tempo.
  if (atrasoDias <= 0 || registros <= 0) return null;
  const a = faixa(POR_ATRASO, atrasoDias) ?? 'baixa';
  const v = faixa(POR_VOLUME, registros) ?? 'baixa';
  return ORDEM[Math.max(ORDEM.indexOf(a), ORDEM.indexOf(v))];
}

/**
 * O código do achado é **determinístico**.
 *
 * Uma varredura por dia sobre o mesmo campo vencido não pode abrir um achado
 * por dia: em uma semana o DPO teria sete cópias do mesmo problema e nenhuma
 * pista de qual tratar. O código é a chave natural, e a varredura atualiza o
 * que já existe em vez de inserir.
 */
export const codigoDoAchado = (tabela: string, campo: string): string =>
  `RET-${tabela.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}-${campo.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;

// ── executor ────────────────────────────────────────────────────────────────

export type MetodoExpurgo = 'hard_delete' | 'crypto_shredding' | 'anonimizacao' | 'compactacao_log';

/**
 * O limite de lote, e a razão de ele existir.
 *
 * `eventos` tem 1,2 milhão de linhas no cenário. Eliminar em uma transação só
 * segura os locks pelo tempo inteiro da operação e faz o WAL crescer sem teto;
 * eliminar linha a linha custa uma ida ao disco por linha. Cinco mil é o meio
 * termo que cabe numa transação curta.
 */
export const LIMITE_DO_LOTE = 5_000;

/**
 * A chave de idempotência de um lote.
 *
 * Deriva de coisas **imutáveis** — tabela, campo, data de referência e o índice
 * do lote dentro da execução daquele dia. Não deriva do estado, e isso é o
 * ponto: se dependesse da contagem restante, reexecutar depois de eliminar
 * mudaria a chave e o segundo passe reinseriria tudo, que é exatamente o
 * defeito que a idempotência existe para impedir.
 */
export const loteChave = (
  hash: (s: string) => string,
  tabela: string, campoId: string, dataReferencia: string, indice: number,
): string => hash(`lote|${tabela}|${campoId}|${dataReferencia}|${indice}`).slice(0, 32);

/**
 * Quantos lotes um campo vencido precisa. Teto, nunca piso: 5 001 registros são
 * dois lotes, e o segundo com um registro só.
 */
export const lotesNecessarios = (registros: number, limite = LIMITE_DO_LOTE): number =>
  Math.ceil(Math.max(0, registros) / limite);
