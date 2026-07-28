/** Vocabulário controlado — espelha os enums de db/schema.sql. */

/**
 * PR 7 — os estados são reexportados de `mock/estados.ts`, que é a autoridade
 * sobre sequência. Antes, cada artefato declarava o próprio conjunto aqui e a
 * máquina não existia: dois lugares dizendo o que é um estado válido.
 */
export type {
  EstadoParecer, EstadoRipd, EstadoLia, EstadoRisco,
  EstadoSolicitacao, EstadoAchado, EstadoIncidente, EstadoChave,
} from './estados';
import type {
  EstadoParecer, EstadoRipd, EstadoLia, EstadoRisco,
  EstadoSolicitacao, EstadoAchado, EstadoIncidente, EstadoChave,
} from './estados';

export type Papel = 'engenharia' | 'dpo' | 'produto' | 'seguranca' | 'auditor';

export type Finalidade = 'atendimento' | 'cobranca' | 'auditoria' | 'seguranca';

export type BaseLegal =
  | 'consentimento' | 'obrigacao_legal' | 'politica_publica' | 'pesquisa'
  | 'execucao_contrato' | 'exercicio_direitos' | 'protecao_vida' | 'tutela_saude'
  | 'legitimo_interesse' | 'protecao_credito';

/** Art. 11 — rol exaustivo para dado sensível. Legítimo interesse não está aqui. */
export const BASES_PARA_SENSIVEL: BaseLegal[] = [
  'consentimento', 'obrigacao_legal', 'protecao_vida', 'tutela_saude', 'politica_publica', 'pesquisa',
];

export type TipoArmazenado = 'bruto' | 'hash' | 'hmac' | 'criptografado' | 'agregado';
export type Categoria = 'anonimizado' | 'pseudonimizado' | 'pessoal' | 'sensivel';
export type Mecanismo = 'pais_adequado' | 'clausulas_padrao_anpd' | 'normas_corporativas'
  | 'consentimento_especifico' | 'nao_aplicavel';

export interface Compartilhamento {
  destino: string;
  finalidade: string;
  internacional: boolean;
  pais?: string;
  mecanismo: Mecanismo;
  evidencia?: string;
}

export interface Campo {
  id: string;
  sistema: string;
  dataset: string;
  nome: string;
  tipoArmazenado: TipoArmazenado;
  categoria: Categoria;
  sensivel: boolean;
  /** Descrição para gente. Continua sendo prosa: é o que o DPO lê. */
  finalidade: string;
  /**
   * Finalidades sob as quais este campo pode ser acessado (C-03). Declarada,
   * nunca derivada da prosa acima — ampliar é ato explícito, visível no diff do
   * inventário. Lista vazia significa **não revelável**, jamais "qualquer uma".
   */
  finalidadesCompativeis: Finalidade[];
  baseLegal: BaseLegal;
  liaCodigo?: string;
  retencao: string;
  retencaoDias: number | null;
  origem: string;
  compartilhamentos: Compartilhamento[];
  /** Etapas da linhagem, da origem ao descarte. */
  linhagem: { etapa: string; detalhe: string; externo?: boolean }[];
}

export interface Sistema {
  slug: string;
  nome: string;
  repositorio: string;
  timeDono: string;
  temInventario: boolean;
}

export type Severidade = 'baixa' | 'media' | 'alta' | 'critica';

export interface GateFinding {
  regra: string;
  arquivo?: string;
  linha?: number;
  severidade: Severidade;
  mensagemBruta: string;
  mensagemHumana: string;
  comoCorrigir: string;
}

export interface GateRun {
  id: string;
  workflow: 'privacy-ci-gate' | 'architecture-review';
  repositorio: string;
  prNumero: number;
  prTitulo: string;
  prAutor: string;
  headSha: string;
  conclusao: 'success' | 'failure' | 'neutral' | 'action_required';
  bloqueouMerge: boolean;
  runUrl: string;
  quando: string;
  findings: GateFinding[];
  ripdId?: string;
}

export interface RipdTrigger {
  codigo: string;
  categoria: string;
  critico: boolean;
  evidencias: string[];
}

export interface Recomendacao {
  prioridade: 'P0' | 'P1' | 'P2';
  descricao: string;
  dono: string;
  prazo: string;
  concluida: boolean;
}

export interface Ripd {
  id: string;
  codigo: string;
  titulo: string;
  sistema: string;
  prNumero: number;
  headSha: string;
  contexto: string;
  foraDeEscopo: string;
  fluxoMermaid: string;
  camposIds: string[];
  operacoes: { operacao: string; finalidade: string; baseLegal: BaseLegal; liaCodigo?: string }[];
  recomendacoes: Recomendacao[];
  triggers: RipdTrigger[];
  /** PR 7 — estados do `MAPA-PROCESSOS.md §2`. `vigente` é o antigo `aprovado`. */
  status: EstadoRipd;
  linddun: LinddunItem[];
}

export interface LinddunItem {
  chave: string;
  rotulo: string;
  canonico: string;
  ativo: boolean;
  mitigacao: string;
}

export type Dano = 'material' | 'moral' | 'discriminacao' | 'perda_de_controle';

export interface Risco {
  codigo: string;
  descricao: string;
  probabilidade: number;
  impacto: number;
  dano: Dano;
  danoTexto: string;
  tratamento: string;
  tipo: 'mitigar' | 'transferir' | 'evitar' | 'aceitar';
  esforcoSprints: number;
  dono: string;
  dominio: string;
  prazo: string;
  reavaliacao: string;
  status: EstadoRisco;
  /** Exigidos para aceitar o risco: sem dono e sem prazo, ele volta como surpresa. */
  donoDaAceitacao?: string;
  prazoDeReavaliacao?: string;
  gatilhoDeReabertura?: string;
  ripdCodigo?: string;
}

export interface Reclassificacao {
  codigo: string;
  de: { p: number; i: number };
  para: { p: number; i: number };
  justificativa: string;
  ator: string;
  quando: string;
}

export interface LiaAlternativa {
  alternativa: string;
  situacao: 'atendido' | 'nao_aplicavel' | 'rejeitado';
  justificativa: string;
}

export interface Lia {
  id: string;
  codigo: string;
  titulo: string;
  finalidade: string;
  categoria: string;
  beneficio: 1 | 2 | 3;
  danoTitular: 1 | 2 | 3;
  expectativa: 'alta' | 'media' | 'baixa';
  alternativas: LiaAlternativa[];
  evidencias: { arquivo: string; tipo: string; hash: string }[];
  camposIds: string[];
  status: EstadoLia;
  vigenciaFim: string;
  diasParaVencer: number;
  assinaturaDpo?: string;
  documentoHash?: string;
}

export type DesfechoSolicitacao = 'atendido' | 'atendido_parcialmente' | 'recusado_com_fundamento';

export type Direito =
  | 'confirmacao' | 'acesso' | 'correcao' | 'anonimizacao' | 'bloqueio'
  | 'eliminacao' | 'portabilidade' | 'compartilhamentos' | 'revogacao' | 'revisao_decisao';

export interface Titular {
  id: string;
  cpfHash: string;
  /** Só existe no mock do backend. Nunca é serializado para a UI sem passar por /pseudonyms/resolve. */
  segredos: Record<string, string>;
  /**
   * C-17 — todo campo exibível aponta para o catálogo. `chave` é rótulo de
   * exibição, `campoCatalogoId` é o vínculo técnico com o ROPA. Campo sem
   * vínculo não é revelável: se existe caminho de leitura fora do inventário,
   * o inventário deixa de ser a fonte da verdade.
   */
  campos: {
    chave: string;
    rotulo: string;
    grupo: string;
    sensivel: boolean;
    mascara: string;
    baseLegal: BaseLegal;
    campoCatalogoId?: string;
  }[];
  compartilhamentos: { destino: string; finalidade: string; baseLegal: BaseLegal; internacional: boolean; mecanismo: Mecanismo; ultimaRemessa: string }[];
  decisao?: {
    id: string; modelo: string; aprovado: boolean; shap: { feature: string; impacto: number }[];
    /** T4-03 — a revisão do Art. 20 só vale se deixar prova. Preenchida pela rota, nunca pela tela. */
    revisao?: RevisaoRegistrada;
  };
}

export type ResultadoRevisao = 'mantida' | 'revertida' | 'ajustada';

export interface RevisaoRegistrada {
  resultado: ResultadoRevisao;
  /** Já redigido (C-04): o que entra aqui entrou antes no audit trail. */
  fundamento: string;
  revisadaPor: string;
  quando: string;
}

export interface Solicitacao {
  id: string;
  protocolo: string;
  titularId: string;
  titularPseudonimo: string;
  direito: Direito;
  status: EstadoSolicitacao;
  nivelVerificacao: 1 | 2 | 3;
  sistemas: string[];
  recebidaEm: string;
  prazoLimiteMs: number;
  metaInternaMs: number;
  /** Exibição. O cálculo usa `concluidaEmMs`. */
  concluidaEm?: string;
  /** T4-05 — para comparar com `prazoLimiteMs`. Rótulo e cálculo dizem a mesma coisa. */
  concluidaEmMs?: number;
  desfecho?: DesfechoSolicitacao;
  fundamento?: string;
  mensagens: { remetente: 'titular' | 'dpo'; corpo: string; quando: string }[];
}

export interface ExpurgoEntrada {
  sistema: string;
  tabela: string;
  metodo: 'hard_delete' | 'crypto_shredding' | 'anonimizacao' | 'compactacao_log';
  registros: number;
  hashPre: string;
  hashPos: string;
  verificado: boolean;
}

export interface ExpurgoRun {
  id: string;
  data: string;
  origem: 'cron' | 'manual' | 'solicitacao_titular';
  status: 'concluido' | 'falhou' | 'parcial';
  entradas: ExpurgoEntrada[];
}

export interface ChaveKms {
  alias: string;
  finalidade: string;
  status: EstadoChave;
  criadaHaDias: number;
  rotacaoEmDias: number | null;
  criptoShredding: boolean;
  dependencias: string[];
}

export interface EtapaRotacao {
  etapa: string;
  rotulo: string;
  status: 'pendente' | 'executando' | 'concluida' | 'falhou';
  progresso: number;
  detalhe: string;
}

export interface AcessoKms {
  quando: string;
  principal: string;
  operacao: string;
  finalidade: string;
  origemIp: string;
  autorizado: boolean;
  motivo?: string;
}

export interface AuditLinha {
  id: number;
  ocorridoEm: string;
  ator: string;
  atorPapel: Papel | 'system';
  acao: string;
  recursoTipo: string;
  recursoId: string;
  finalidade?: Finalidade;
  justificativa?: string;
  /**
   * T4-01 — o protocolo sob o qual o acesso aconteceu. Campo próprio, e dentro
   * do payload do hash: campo fora do payload não é selado pela cadeia, e campo
   * não selado é campo adulterável sem quebrar a prova que a T6 vende.
   */
  protocolo?: string;
  campos: string[];
  resultado: 'sucesso' | 'negado' | 'erro';
  hashAnterior: string | null;
  hash: string;
}

export interface Metrica {
  chave: string;
  rotulo: string;
  valor: number;
  anterior: number;
  unidade: 'percentual' | 'horas' | 'contagem';
  meta: number;
  melhorQuandoSobe: boolean;
  serie: number[];
}

export interface Maturidade {
  dominio: string;
  score: number;
  anterior: number;
  evidencias: string[];
}

// ── PR 7 · artefatos que a máquina de estados move ──────────────────────────

/**
 * Parecer técnico e achado de auditoria não existiam como modelo: viviam como
 * texto dentro do RIPD e como linha da trilha. Para a máquina de estados deles
 * ser exercitável, precisam de identidade própria.
 */
export interface Parecer {
  id: string;
  codigo: string;
  ripdId?: string;
  status: EstadoParecer;
  autor: string;
  /** Máx. 2 devoluções; a terceira vai ao comitê (MAPA §2). */
  devolucoes: number;
}

export interface Achado {
  id: string;
  codigo: string;
  descricao: string;
  origem: string;
  status: EstadoAchado;
  criticidade: 'baixa' | 'media' | 'alta' | 'critica';
  /** Reaberto conta como reincidência e entra com criticidade elevada. */
  reincidencias: number;
  causaRaiz?: string;
  plano?: string;
  verificadoPor?: string;
}

// ── C-07 · incidente de segurança (Art. 48) ─────────────────────────────────

export type DecisaoIncidente = 'comunicar_anpd_e_titulares' | 'comunicar_anpd' | 'nao_comunicar';

export interface Incidente {
  id: string;
  estado: EstadoIncidente;
  /** ISO. O prazo corre à vista a partir daqui — o rótulo é derivado, nunca digitado ao lado. */
  detectadoEm: string;
  origem: string;
  /**
   * Escopo **lido do catálogo**: são ids de `Campo`, não texto digitado. Quem
   * responde ao Art. 48 precisa dizer que dado vazou, e a resposta tem de vir
   * do inventário — senão o incidente descreve um universo que o ROPA
   * desconhece, que é o problema do C-17 outra vez.
   */
  camposIds: string[];
  titularesEstimados: number;
  riscoCodigo?: string;
  ripdId?: string;
  decisao?: DecisaoIncidente;
  /** ≥ 20 caracteres, já redigido (C-04). */
  fundamento?: string;
  contidoPor?: string;
  decididoPor?: string;
}

// ── C-08 · registro de consentimento ────────────────────────────────────────

export interface Consentimento {
  campoId: string;
  versao: string;
  texto: string;
  coletadoEm: string;
  canal: string;
  hash: string;
  estado: 'ativo' | 'revogado' | 'expirado';
  revogadoEm?: string;
  titulares: number;
}

export interface Cenario {
  id: string;
  nome: string;
  setor: string;
  descricao: string;
  sistemas: Sistema[];
  campos: Campo[];
  pareceres: Parecer[];
  achados: Achado[];
  incidentes: Incidente[];
  consentimentos: Consentimento[];
  gates: GateRun[];
  ripds: Ripd[];
  riscos: Risco[];
  lias: Lia[];
  titulares: Titular[];
  solicitacoes: Solicitacao[];
  expurgos: ExpurgoRun[];
  chaves: ChaveKms[];
  rotacao: { chaveNova: string; chaveAntiga: string; etapas: EtapaRotacao[] };
  acessosKms: AcessoKms[];
  metricas: Metrica[];
  maturidade: Maturidade[];
  raci: { processo: string; letras: Record<string, 'R' | 'A' | 'C' | 'I'> }[];
}
