/**
 * Máquinas de estado dos artefatos.
 *
 * Este arquivo responde a **uma** pergunta: a transição é legal? Ele não sabe o
 * que é o Art. 48, não lê fundamento, não conhece papel e não toca no banco. A
 * separação é deliberada:
 *
 * - **verificação** (aqui): o artefato pode ir de `de` para `para`?
 * - **validação** (em `api.ts`): este pedido satisfaz a lei — fundamento
 *   presente, dono declarado, prazo definido, ator autorizado, registro gravado?
 *
 * Misturar as duas produz o defeito clássico: uma transição passa porque a
 * justificativa estava boa, ou é recusada por 422 quando o problema era a ordem
 * dos passos. Os dois erros merecem códigos diferentes — **409 para sequência,
 * 422 para conteúdo** — e é essa distinção que os testes cobram.
 *
 * O PR 4 declarou a máquina do incidente. Este generaliza para os oito
 * artefatos do `MAPA-PROCESSOS.md §2`, com **um só caminho**: toda transição
 * passa por `transicaoPermitida`, e não existe atalho por artefato.
 */

export type Artefato =
  | 'parecer' | 'ripd' | 'lia' | 'risco'
  | 'solicitacao' | 'achado' | 'incidente' | 'chave' | 'fornecedor';

export type EstadoParecer = 'rascunho' | 'emitido' | 'homologado' | 'vigente' | 'devolvido';
export type EstadoRipd =
  | 'triagem' | 'dispensado' | 'elaboracao' | 'parecer_juridico' | 'deliberado' | 'vigente' | 'em_revisao';
export type EstadoLia = 'rascunho' | 'balanceamento' | 'assinada' | 'vigente' | 'em_revisao' | 'vencida';
export type EstadoRisco = 'identificado' | 'avaliado' | 'em_tratamento' | 'mitigado' | 'aceito';
export type EstadoSolicitacao = 'recebida' | 'em_analise' | 'concluida' | 'recusada_com_fundamento';
export type EstadoAchado =
  | 'aberto' | 'causa_raiz' | 'plano' | 'executado' | 'verificado' | 'encerrado' | 'reaberto';
export type EstadoIncidente =
  | 'aberto' | 'contido' | 'decidido' | 'comunicado' | 'nao_comunicado' | 'encerrado';
export type EstadoChave = 'nova' | 'recriptografando' | 'canary' | 'ativa' | 'revogada';
export type EstadoFornecedor = 'ativo' | 'desligando' | 'desligado';

export type EstadoDe<A extends Artefato> =
  A extends 'parecer' ? EstadoParecer
    : A extends 'ripd' ? EstadoRipd
      : A extends 'lia' ? EstadoLia
        : A extends 'risco' ? EstadoRisco
          : A extends 'solicitacao' ? EstadoSolicitacao
            : A extends 'achado' ? EstadoAchado
              : A extends 'incidente' ? EstadoIncidente
                : A extends 'chave' ? EstadoChave
                  : EstadoFornecedor;

type Maquina<E extends string> = Record<E, E[]>;

/**
 * As oito tabelas, transcritas do `MAPA-PROCESSOS.md §2` sem acréscimo.
 *
 * A prosa ao lado de cada tabela no documento — "dispensado exige
 * justificativa", "aceito exige dono e prazo" — **não mora aqui**: é validação
 * de conteúdo e vive em `api.ts`. Aqui só o que é legal seguir de onde.
 */

/** Devolvido volta a emitido: a devolução é ida e volta, não beco sem saída. */
const PARECER: Maquina<EstadoParecer> = {
  rascunho: ['emitido'],
  emitido: ['homologado'],
  homologado: ['vigente', 'devolvido'],
  devolvido: ['emitido'],
  vigente: [],
};

/**
 * A triagem bifurca: ou dispensa com registro, ou entra em elaboração. Vigente
 * volta a `em_revisao` no aniversário ou por gatilho antecipado — e de lá
 * retoma a elaboração, porque revisar é reabrir o trabalho, não recarimbar.
 */
const RIPD: Maquina<EstadoRipd> = {
  triagem: ['dispensado', 'elaboracao'],
  dispensado: ['elaboracao'],
  elaboracao: ['parecer_juridico'],
  parecer_juridico: ['deliberado'],
  deliberado: ['vigente'],
  vigente: ['em_revisao'],
  em_revisao: ['elaboracao'],
};

/**
 * Vencida nunca volta direto a vigente: renovar exige rebalanceamento.
 *
 * `em_revisao` entra no PR 7 e **não** é sinônimo de `balanceamento`. Os dois
 * significam trabalho aberto sobre a LIA, mas por caminhos opostos:
 * `balanceamento` é autoria — a LIA sendo escrita, ainda sem vigência —, e
 * `em_revisao` é vigência puxada de volta, o que só acontece com uma LIA que
 * estava valendo e cuja mitigação caiu. Colapsar os dois apagaria a diferença
 * entre "nunca sustentou nada" e "sustentava e parou de sustentar", que é
 * justamente a distinção que uma fiscalização quer ver.
 *
 * A saída é única, e é para `balanceamento`: pela mesma razão que `vencida` não
 * volta direto a `vigente`, uma LIA cuja mitigação estourou não se recarimba —
 * rebalancear é o único caminho de volta. O vocabulário passa a espelhar o
 * `CHECK` de `db/schema.sql:602`, que já tinha `em_revisao` desde o desenho de
 * produção; era o mock que estava com uma máquina própria.
 */
const LIA: Maquina<EstadoLia> = {
  rascunho: ['balanceamento'],
  balanceamento: ['assinada'],
  assinada: ['vigente'],
  vigente: ['em_revisao', 'vencida'],
  em_revisao: ['balanceamento'],
  vencida: ['balanceamento'],
};

/** Aceito e mitigado voltam a tratamento: risco reavaliado é risco vivo. */
const RISCO: Maquina<EstadoRisco> = {
  identificado: ['avaliado'],
  avaliado: ['em_tratamento'],
  em_tratamento: ['mitigado', 'aceito'],
  mitigado: ['em_tratamento'],
  aceito: ['em_tratamento'],
};

const SOLICITACAO: Maquina<EstadoSolicitacao> = {
  recebida: ['em_analise'],
  em_analise: ['concluida', 'recusada_com_fundamento'],
  concluida: [],
  recusada_com_fundamento: [],
};

/** Reaberto retoma pela causa raiz: reincidência não recomeça do plano antigo. */
const ACHADO: Maquina<EstadoAchado> = {
  aberto: ['causa_raiz'],
  causa_raiz: ['plano'],
  plano: ['executado'],
  executado: ['verificado'],
  verificado: ['encerrado', 'reaberto'],
  reaberto: ['causa_raiz'],
  encerrado: [],
};

const INCIDENTE: Maquina<EstadoIncidente> = {
  aberto: ['contido'],
  contido: ['decidido'],
  decidido: ['comunicado', 'nao_comunicado'],
  comunicado: ['encerrado'],
  nao_comunicado: ['encerrado'],
  encerrado: [],
};

const CHAVE: Maquina<EstadoChave> = {
  nova: ['recriptografando'],
  recriptografando: ['canary'],
  canary: ['ativa'],
  ativa: ['revogada'],
  revogada: [],
};

/**
 * Desligar parceiro é passar por uma janela, e a janela é obrigatória.
 *
 * `ativo → desligado` não existe **mesmo quando a janela é de zero dia**. Zero
 * declarado é uma decisão — "não há dado a devolver" —, e zero implícito é uma
 * etapa que ninguém percebeu que existia. Pular a janela é 409, e o 409 é do
 * mesmo guarda genérico que rege os outros oito artefatos: não há atalho por
 * fornecedor, e é isso que este arquivo existe para garantir.
 *
 * `desligado` é final. Retomar a relação é contrato novo, com DPA novo e chave
 * nova — não é reabrir o registro do encerramento anterior, que continua legível
 * exatamente por ser o período que uma auditoria examina.
 */
const FORNECEDOR: Maquina<EstadoFornecedor> = {
  ativo: ['desligando'],
  desligando: ['desligado'],
  desligado: [],
};

export const MAQUINAS: { [A in Artefato]: Maquina<EstadoDe<A>> } = {
  parecer: PARECER,
  ripd: RIPD,
  lia: LIA,
  risco: RISCO,
  solicitacao: SOLICITACAO,
  achado: ACHADO,
  incidente: INCIDENTE,
  chave: CHAVE,
  fornecedor: FORNECEDOR,
};

/** Mantido do PR 4: era o nome que a T9 e os testes do incidente já usavam. */
export const TRANSICOES_INCIDENTE = INCIDENTE;

/** A lista, para quem precisa validar o nome do artefato vindo de uma URL. */
export const ARTEFATOS: Artefato[] = [
  'parecer', 'ripd', 'lia', 'risco', 'solicitacao', 'achado', 'incidente', 'chave', 'fornecedor',
];

export const estadosDe = <A extends Artefato>(artefato: A): EstadoDe<A>[] =>
  Object.keys(MAQUINAS[artefato]) as EstadoDe<A>[];

export const proximosDe = <A extends Artefato>(artefato: A, de: EstadoDe<A>): EstadoDe<A>[] =>
  (MAQUINAS[artefato] as Maquina<EstadoDe<A>>)[de] ?? [];

/**
 * O único caminho. Não existe função por artefato, e nenhum chamador decide
 * sozinho se um passo é legal — quem decide é a tabela.
 */
export const transicaoPermitida = <A extends Artefato>(
  artefato: A, de: EstadoDe<A>, para: EstadoDe<A>,
): boolean => proximosDe(artefato, de).includes(para);

/**
 * Por que a transição foi recusada, em linguagem de gente.
 *
 * Fica junto da tabela para não haver dois lugares dizendo o que é legal: a
 * mensagem é **derivada** da mesma fonte que a decisão. Os motivos específicos
 * abaixo existem porque "de X só se vai para Y" não explica o que está em jogo
 * — e recusa que não ensina é recusa que a pessoa contorna.
 */
const MOTIVOS: Partial<Record<Artefato, Record<string, string>>> = {
  ripd: {
    'triagem→vigente': 'Pular parecer jurídico e deliberação é aprovar o risco, não o tratamento.',
    'vigente→vigente': 'RIPD vigente não se recarimba: a revisão passa por em_revisao e volta à elaboração.',
  },
  lia: {
    'vencida→vigente': 'Renovar exige rebalanceamento, não recarimbo: a LIA vencida volta para balanceamento.',
    'em_revisao→vigente': 'A mitigação que sustentava o balanceamento caiu — devolver a vigência sem '
      + 'rebalancear seria afirmar de novo o que deixou de ser verdade. A volta é por balanceamento.',
  },
  solicitacao: {
    'recebida→concluida': 'Conclusão sem análise não tem o que provar ao titular.',
  },
  achado: {
    'executado→encerrado': 'Falta a verificação independente de eficácia — executar não é comprovar que resolveu.',
  },
  incidente: {
    'aberto→comunicado': 'Comunicar antes de conter e apurar o escopo comunica o número errado, e a correção vai na frente do titular.',
    'contido→comunicado': 'A comunicação sai da decisão registrada, não direto da contenção — sem decisão não há fundamento para exibir.',
  },
  chave: {
    'recriptografando→ativa': 'Promover antes do canary deixa registro ilegível com a chave nova.',
  },
  fornecedor: {
    'ativo→desligado': 'Desligar sem janela destrói a chave antes de o parceiro devolver o que tem e antes de o '
      + 'dado em trânsito chegar. A janela é declarada — pode ser de zero dia, mas não pode ser omitida.',
    'desligado→ativo': 'Retomar a relação é contrato novo, com DPA novo e chave nova. O registro do encerramento '
      + 'anterior continua legível, e é justamente ele que uma auditoria examina.',
  },
};

export function motivoDaRecusa<A extends Artefato>(
  artefato: A, de: EstadoDe<A>, para: EstadoDe<A>,
): string {
  const especifico = MOTIVOS[artefato]?.[`${de}→${para}`];
  if (especifico) return especifico;

  const permitidos = proximosDe(artefato, de);
  if (permitidos.length === 0) {
    return `"${de}" é estado final deste ${artefato}: retomar é registro novo, não edição deste.`;
  }
  return `De "${de}" o ${artefato} só avança para ${permitidos.map((e) => `"${e}"`).join(' ou ')}.`;
}
