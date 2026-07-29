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

/**
 * PR 8 — pelo mesmo motivo dos estados: `mock/decisoes.ts` é a autoridade sobre
 * o que uma decisão registrada carrega. Aqui só se reexporta.
 */
export type {
  TabelaId, Decisao, DecisaoRegistrada, Complexidade, Alcada, NivelRisco, ExigenciaRipd,
} from './decisoes';
import type { DecisaoRegistrada } from './decisoes';

/** PR 11 — os sete princípios moram em `mock/pbd.ts`, lidos pela tela e pelo gate. */
export type { PrincipioPbd, MarcacaoPbd, SituacaoPbd, AvaliacaoPbd, VereditoPbd } from './pbd';
import type { MarcacaoPbd } from './pbd';

/** PR 10 — as obrigações do ano moram em `mock/calendario.ts`. */
export type { Obrigacao, Prorrogacao, Trilha, TipoObrigacao } from './calendario';
import type { Obrigacao } from './calendario';

export type Papel = 'engenharia' | 'dpo' | 'produto' | 'seguranca' | 'auditor';

export type Finalidade = 'atendimento' | 'cobranca' | 'auditoria' | 'seguranca';

export type BaseLegal =
  | 'consentimento' | 'obrigacao_legal' | 'politica_publica' | 'pesquisa'
  | 'execucao_contrato' | 'exercicio_direitos' | 'protecao_vida' | 'tutela_saude'
  | 'legitimo_interesse' | 'protecao_credito';

/** As dez bases do Art. 7º, em runtime — para quem precisa validar o que chegou de fora. */
export const BASES_LEGAIS: BaseLegal[] = [
  'consentimento', 'obrigacao_legal', 'politica_publica', 'pesquisa', 'execucao_contrato',
  'exercicio_direitos', 'protecao_vida', 'tutela_saude', 'legitimo_interesse', 'protecao_credito',
];

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

/**
 * PR 8 — o gatilho no cenário diz **quais** acionaram e com que evidência. O que
 * cada código significa (rótulo e criticidade) mora no catálogo `GATILHOS` de
 * `mock/decisoes.ts`, que é a entrada da D3. Antes o rótulo e o `critico` eram
 * repetidos em cada cenário: três cópias da mesma verdade.
 */
export interface RipdTrigger {
  codigo: string;
  evidencias: string[];
}

/**
 * PR 11 — o gatilho de reabertura, e por que ele é **código**, não prosa.
 *
 * "Qualquer coleta de identificador direto reabre a triagem" é uma frase que
 * nenhuma esteira consegue disparar: ela depende de alguém ler, lembrar e
 * decidir. O gatilho aponta para um código do catálogo `GATILHOS` (PR 8) — o
 * mesmo vocabulário que a triagem do CI já usa —, e é isso que permite a
 * dispensa ser reaberta **sem intervenção manual** quando o gatilho dispara.
 *
 * A condição em prosa continua, ao lado: é ela que explica a quem lê o que o
 * código significa neste sistema.
 */
export interface GatilhoDeReabertura {
  codigo: string;
  condicao: string;
}

export interface DisparoDeGatilho {
  codigo: string;
  evidencia: string;
  quando: string;
  /** Disparo que não reabre continua registrado: o fato aconteceu. */
  reabriu: boolean;
}

/**
 * Dispensa de RIPD — **decisão registrada**, nunca ausência de RIPD.
 *
 * Lista append-only no artefato, como as decisões do PR 8: dispensar de novo
 * grava um registro novo, e o anterior continua dizendo por que se dispensou em
 * março e o que se comprometeu a vigiar.
 */
export interface DispensaDeRipd {
  justificativa: string;
  gatilhos: GatilhoDeReabertura[];
  por: string;
  quando: string;
  disparos: DisparoDeGatilho[];
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
  /** Entrada da D1. Ausente cai no cenário mais restritivo, não em erro. */
  volumeTitulares?: number;
  /** PR 7 — estados do `MAPA-PROCESSOS.md §2`. `vigente` é o antigo `aprovado`. */
  status: EstadoRipd;
  linddun: LinddunItem[];
  /**
   * PR 8 — as decisões como foram tomadas, com a versão da tabela e as entradas.
   *
   * Lista **append-only** pelo mesmo motivo do audit trail: reaplicar D1 grava
   * uma decisão nova e a anterior continua ali, dizendo por qual regra o parecer
   * foi julgado em março. Campo único seria mais simples e apagaria justamente a
   * prova que este PR existe para produzir. A vigente é a última da tabela.
   */
  decisoes?: DecisaoRegistrada[];
  /** PR 11 — as dispensas, append-only. A vigente é a última. */
  dispensas?: DispensaDeRipd[];
}

/**
 * PR 11 — o épico, com o checklist de PbD como campo dele.
 *
 * O checklist não é documento anexo: é campo do épico, e o gate de CI o lê do
 * `.privacy/epico.yml` do repositório com a **mesma** regra que esta tela usa
 * (`mock/pbd.ts`). Duas implementações divergiriam, e a que vale seria a que
 * ninguém está olhando.
 */
export interface Epico {
  id: string;
  codigo: string;
  titulo: string;
  repositorio: string;
  prNumero: number;
  pbd: MarcacaoPbd[];
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
  /** PR 8 — D2 aplicada, append-only como no RIPD. A vigente é a última. */
  decisoes?: DecisaoRegistrada[];
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
  /**
   * O canal de oposição que esta LIA publica — espelho da coluna
   * `lia.canal_oposicao`, que o schema declara `NOT NULL`.
   *
   * Estava só como texto fixo dentro da T8: a tela anunciava um canal que o
   * registro da LIA não carregava, e ninguém podia notar a diferença olhando
   * o artefato assinado. Agora a tela lê daqui, e o teste confere contra o
   * `db/seed.sql` e contra a rota servida.
   */
  canalOposicao: string;
}

export type DesfechoSolicitacao = 'atendido' | 'atendido_parcialmente' | 'recusado_com_fundamento';

export type Direito =
  | 'confirmacao' | 'acesso' | 'correcao' | 'anonimizacao' | 'bloqueio'
  | 'eliminacao' | 'portabilidade' | 'compartilhamentos' | 'revogacao' | 'revisao_decisao'
  | 'oposicao';

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

/**
 * Um resíduo que ficou, e a razão pela qual ficou.
 *
 * "Parte foi retida por obrigação legal" sem dizer o quê, por qual lei e até
 * quando não é resposta — é reticência. A tela mais importante do portal é a do
 * atendimento parcial, e ela só existe porque este tipo existe: separa apagado
 * de retido, nomeia a lei de cada retenção e dá a **data** de eliminação de
 * cada resíduo.
 */
export interface ItemRetido {
  /** O que ficou, em linguagem de pessoa. */
  item: string;
  baseLegal: BaseLegal;
  artigo?: string;
  /** Data absoluta da eliminação do resíduo. Prazo é data, nunca "conforme a lei". */
  retencaoAte: string;
  motivo?: string;
}

export interface Solicitacao {
  id: string;
  protocolo: string;
  titularId: string;
  titularPseudonimo: string;
  direito: Direito;
  status: EstadoSolicitacao;
  /**
   * **Derivado do direito, no servidor** (`mock/direitos.ts`). Nunca lido do
   * corpo da requisição: se fosse, bastaria pedir eliminação com nível 1.
   */
  nivelVerificacao: 1 | 2 | 3;
  /** Aberta pelo próprio titular no portal, ou registrada pelo balcão. */
  origem?: 'portal' | 'balcao';
  /** Texto livre do titular, **já redigido**. Opcional: o direito não depende de justificativa. */
  detalhe?: string;
  /** O que foi efetivamente apagado, para a tela do atendimento parcial. */
  apagados?: string[];
  /** O que ficou, com base legal e data — exigido em recusa e atendimento parcial. */
  retidos?: ItemRetido[];
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
  /**
   * `titular` é o autor do próprio pedido, feito pelo portal. Não é papel da
   * matriz interna — é a outra ponta do balcão, e o trail precisa saber
   * distinguir "o DPO abriu por ela" de "ela abriu sozinha".
   */
  atorPapel: Papel | 'system' | 'titular';
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

/**
 * PR 15 — a prova que cada etapa do achado deixa, encadeada.
 *
 * `hashAnterior` aponta para a evidência anterior **do mesmo achado**, pelo
 * mesmo motivo do audit trail: anexo solto prova que um arquivo existe, e nada
 * sobre a ordem em que apareceu. Encadeado, remontar a sequência depois exige
 * recalcular tudo o que veio depois — que é a diferença entre arquivo e prova.
 */
export interface EvidenciaDeAchado {
  arquivo: string;
  hash: string;
  hashAnterior: string | null;
  por: string;
  quando: string;
  /** A etapa em que a prova entrou. Evidência de execução não prova eficácia. */
  etapa: EstadoAchado;
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
  /**
   * PR 15 — o que faria alguém dizer que o plano funcionou, declarado **antes**
   * de executar. Sem ele, "verificado" é opinião de quem verifica, e a
   * verificação independente perde o que teria de conferir.
   */
  criterioDeEficacia?: string;
  /** Quem executou. É o fato que torna a independência da verificação aferível. */
  executadoPor?: string;
  verificadoPor?: string;
  /**
   * O veredito da verificação **contra o critério**. Separado do estado de
   * propósito: `verificado` diz que alguém conferiu; este campo diz o que a
   * conferência concluiu. Verificar e aprovar não são o mesmo ato.
   */
  eficaciaAtingida?: boolean;
  motivoDaReabertura?: string;
  /** Cadeia de custódia, append-only. */
  evidencias: EvidenciaDeAchado[];
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

// ── Portal do titular · Risco-001 ───────────────────────────────────────────

/**
 * Uma verificação em curso.
 *
 * `titularId` é `null` quando o identificador não corresponde a cadastro algum —
 * e a verificação **é criada mesmo assim**, com código e tudo. É o que torna a
 * recusa indistinguível: não existe caminho em que a ausência de cadastro
 * produza uma resposta diferente da de um código errado.
 */
export interface VerificacaoTitular {
  id: string;
  direito: Direito;
  /** Derivado do direito. Não há setter. */
  nivelExigido: 1 | 2 | 3;
  canal: 'email' | 'sms';
  identificadorHash: string;
  /** Nunca sai numa resposta: vai pelo canal, como na vida real. */
  codigo: string;
  titularId: string | null;
  criadaEmMs: number;
  expiraEmMs: number;
  tentativas: number;
  confirmadaEmMs?: number;
  /**
   * Só a impressão do documento, e só quando o nível 3 a exige. A imagem não
   * entra no cadastro; o que fica é esta marca e a data do descarte.
   */
  documentoImpressao?: string;
  documentoDescartaEmMs?: number;
}

/** A credencial do portal — presa ao direito e ao nível da verificação que a produziu. */
export interface SessaoTitular {
  token: string;
  verificacaoId: string;
  titularId: string;
  direito: Direito;
  nivelAtingido: 1 | 2 | 3;
  expiraEmMs: number;
}

export type TipoDaCascata = 'cessacao' | 'notificacao' | 'expurgo';

export interface ItemDaCascata {
  alvo: string;
  tipo: TipoDaCascata;
  /** O que acontece ali, sem jargão — inclusive o cripto-shredding. */
  efeito: string;
  estado: 'propagado' | 'pendente';
  iniciadaEmMs: number;
  confirmadaEmMs?: number;
}

/**
 * A revogação **de um titular**, não do campo inteiro.
 *
 * Retirar a autorização de uma pessoa não pode derrubar a base legal das
 * outras — o defeito que o Risco-002 descreve. O registro agregado por campo
 * (`Consentimento`) continua onde estava; a entidade de consentimento por
 * titular no schema de produção é o próximo bloco.
 */
/**
 * A oposição de um titular ao fundamento de uma LIA (Art. 18, §2º).
 *
 * `estado` nasce `acolhida`: registrada a oposição, o tratamento por legítimo
 * interesse daqueles campos cessa **antes** de qualquer análise. Se o
 * controlador tiver razões legítimas prevalecentes, ele as demonstra concluindo
 * o protocolo com recusa fundamentada — e é a conclusão que passa o estado a
 * `recusada` e retoma o tratamento. Tratar enquanto se decide faria o titular
 * esperar pelo fim de uma análise da qual ele é justamente o objeto.
 */
export interface OposicaoTitular {
  id: string;
  titularId: string;
  liaCodigo: string;
  /** Os campos que a LIA sustenta e que este titular tem. */
  camposIds: string[];
  protocolo: string;
  estado: 'acolhida' | 'recusada';
  abertaEmMs: number;
  decididaEmMs?: number;
}

export interface RevogacaoTitular {
  id: string;
  titularId: string;
  campoId: string;
  revogadoEmMs: number;
  cascata: ItemDaCascata[];
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
  /**
   * PR 10 — o ano provisionado. Não são instâncias de processo: são compromissos
   * agendados que **geram** item na fila quando entra a antecedência. Modelar
   * como processo em execução é o que faz painel de governança encher de coisa
   * que ninguém trata (MAPA §4).
   */
  obrigacoes: Obrigacao[];
  /** PR 11 — os épicos em andamento, com o checklist de PbD. */
  epicos: Epico[];
}
