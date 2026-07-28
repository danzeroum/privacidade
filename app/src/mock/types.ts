/** Vocabulário controlado — espelha os enums de db/schema.sql. */

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
  finalidade: string;
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
  status: 'rascunho' | 'em_revisao' | 'aprovado' | 'reprovado';
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
  status: 'aberto' | 'em_tratamento' | 'mitigado' | 'aceito';
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
  status: 'rascunho' | 'vigente' | 'vencida' | 'revogada';
  vigenciaFim: string;
  diasParaVencer: number;
  assinaturaDpo?: string;
  documentoHash?: string;
}

export type Direito =
  | 'confirmacao' | 'acesso' | 'correcao' | 'anonimizacao' | 'bloqueio'
  | 'eliminacao' | 'portabilidade' | 'compartilhamentos' | 'revogacao' | 'revisao_decisao';

export interface Titular {
  id: string;
  cpfHash: string;
  /** Só existe no mock do backend. Nunca é serializado para a UI sem passar por /pseudonyms/resolve. */
  segredos: Record<string, string>;
  campos: { chave: string; rotulo: string; grupo: string; sensivel: boolean; mascara: string; baseLegal: BaseLegal }[];
  compartilhamentos: { destino: string; finalidade: string; baseLegal: BaseLegal; internacional: boolean; mecanismo: Mecanismo; ultimaRemessa: string }[];
  decisao?: { id: string; modelo: string; aprovado: boolean; shap: { feature: string; impacto: number }[] };
}

export interface Solicitacao {
  id: string;
  protocolo: string;
  titularId: string;
  titularPseudonimo: string;
  direito: Direito;
  status: 'recebida' | 'em_analise' | 'aguardando_titular' | 'concluida' | 'recusada';
  nivelVerificacao: 1 | 2 | 3;
  sistemas: string[];
  recebidaEm: string;
  prazoLimiteMs: number;
  metaInternaMs: number;
  concluidaEm?: string;
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
  status: 'ativa' | 'canary' | 'revogada' | 'pendente';
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

export interface Cenario {
  id: string;
  nome: string;
  setor: string;
  descricao: string;
  sistemas: Sistema[];
  campos: Campo[];
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
