import { estadosDe } from './estados';
import { ultimaDecisao } from './decisoes';
import { pode } from './permissoes';
import { naAntecedencia } from './calendario';
import type { Artefato } from './estados';
import type { Acao } from './permissoes';
import type { Cenario, DecisaoRegistrada, Papel } from './types';
import type { Obrigacao } from './calendario';

/**
 * T0 · Minha fila — a fila **derivada**, nunca digitada.
 *
 * Não existe "criar item na fila". Um item é um artefato parado num estado que
 * exige ação, e some no instante em que o estado muda — porque ele nunca foi
 * uma entidade, só uma leitura da máquina de estados do PR 7.
 *
 * Três decisões que valem mais que a tabela abaixo:
 *
 * 1. **Quem decide de quem é o item é a permissão, não o item.** Cada regra
 *    declara a `Acao` que a próxima ação exige, e a fila de um papel é o
 *    subconjunto que ele alcança. Não existe campo "papéis" escrito à mão: se
 *    existisse, ele divergiria de `permissoes.ts` em três meses, do mesmo jeito
 *    que o rótulo do gatilho divergia do catálogo antes do PR 8.
 *
 * 2. **Trabalho em curso não é item de fila.** `risco em_tratamento` tem dono e
 *    prazo — está andando. Item de fila é o que está **parado esperando você**.
 *    Misturar as duas coisas é o que faz painel de governança encher de linha
 *    que ninguém trata, que é exatamente o que o `MAPA-PROCESSOS.md §5` manda
 *    não fazer.
 *
 * 3. **Prazo que o sistema não sabe calcular não adia o item.** Artefato sem
 *    relógio próprio vem **na frente** dentro da mesma faixa, e a tela diz "sem
 *    prazo declarado". É a regra do PR 8 aplicada ao tempo: o indefinido cai no
 *    cenário mais restritivo, nunca no permissivo. E a ausência do prazo fica
 *    visível em vez de virar silêncio — um passo de processo sem prazo é um
 *    achado, não um detalhe de exibição.
 */

/**
 * As três faixas de consequência do `MAPA-PROCESSOS.md §4`, nesta ordem.
 *
 * `agora` não é "falta pouco tempo": é **prazo legal correndo**, e isso é
 * propriedade do artefato, não do relógio. Uma solicitação com três dias de
 * folga continua na frente de uma chave que vence em oito, porque quem responde
 * pela primeira responde ao titular e à ANPD.
 */
export type Urgencia = 'vencido' | 'agora' | '30d';

const FAIXA: Record<Urgencia, number> = { vencido: 0, agora: 1, '30d': 2 };

export const ROTULO_URGENCIA: Record<Urgencia, string> = {
  vencido: 'Prazo vencido', agora: 'Para hoje', '30d': 'Próximos 30 dias',
};

/**
 * Quando o estado sozinho não basta.
 *
 * Vocabulário fechado de propósito. `ripd em_revisao` com P0 aberta é trabalho de
 * engenharia; a mesma `em_revisao` com as P0 fechadas é a aprovação do DPO — e a
 * máquina do PR 7 não distingue as duas, porque é o mesmo estado. A saída não
 * podia ser um `if` na fila: seria a sopa de condições que o PR 7 fechou. É uma
 * condição **declarada**, do mesmo jeito que `vencendo` já era para o relógio.
 */
export type Quando = 'sempre' | 'vencendo' | 'com_pendencia' | 'sem_pendencia';

/** Janela do "vencendo": o que cabe planejar, mas não cabe esquecer. */
const JANELA_DIAS = 30;
const DIA_MS = 86_400_000;

export interface RegraDaFila {
  artefato: Artefato;
  estado: string;
  /** A permissão que a próxima ação exige — e, por consequência, de quem é o item. */
  acao: Acao;
  quando: Quando;
  urgencia: Urgencia;
  tipo: string;
  /** O que está travado por causa dele. Aceita `{chave}` do contexto do artefato. */
  travado: string;
  proximaAcao: string;
  proximo: string;
  tela: string;
}

/**
 * A tabela. Um item por (artefato, estado) que exige ação — e nada mais.
 *
 * Estados ausentes daqui são deliberados: `ripd vigente`, `solicitacao
 * concluida` e `achado encerrado` não pedem nada. A ausência é a declaração.
 */
export const REGRAS: RegraDaFila[] = [
  // ── parecer técnico ───────────────────────────────────────────────────────
  { artefato: 'parecer', estado: 'rascunho', acao: 'gerar_ripd', quando: 'sempre', urgencia: '30d',
    tipo: 'Parecer técnico', tela: '/t3',
    travado: 'O RIPD não avança sem o parecer: {codigo} está em rascunho.',
    proximaAcao: 'Emitir o parecer técnico com a evidência que o sustenta',
    proximo: 'depois de você: o DPO homologa' },
  { artefato: 'parecer', estado: 'emitido', acao: 'aprovar_ripd', quando: 'sempre', urgencia: '30d',
    tipo: 'Parecer técnico', tela: '/t3',
    travado: '{codigo} está emitido e sem homologação — o RIPD não fecha sem ela.',
    proximaAcao: 'Homologar o parecer ou devolvê-lo com motivo',
    proximo: 'depois de você: o parecer entra em vigência ou volta para quem escreveu' },
  { artefato: 'parecer', estado: 'devolvido', acao: 'gerar_ripd', quando: 'sempre', urgencia: '30d',
    tipo: 'Parecer técnico', tela: '/t3',
    travado: '{codigo} voltou com motivo registrado — {devolucoes} devolução(ões) até aqui.',
    proximaAcao: 'Reemitir endereçando o motivo da devolução',
    proximo: 'na terceira devolução o parecer vai ao comitê' },

  // ── RIPD ──────────────────────────────────────────────────────────────────
  { artefato: 'ripd', estado: 'triagem', acao: 'gerar_ripd', quando: 'sempre', urgencia: '30d',
    tipo: 'RIPD', tela: '/t3',
    travado: 'A triagem de {codigo} não foi decidida: nada entra em elaboração nem sai dispensado.',
    proximaAcao: 'Decidir entre dispensar com justificativa e gatilho, ou elaborar',
    proximo: 'depois de você: o parecer jurídico' },
  { artefato: 'ripd', estado: 'elaboracao', acao: 'gerar_ripd', quando: 'sempre', urgencia: '30d',
    tipo: 'RIPD', tela: '/t3',
    travado: 'O merge do PR #{pr} está travado: {codigo} em elaboração com {p0} recomendação(ões) P0 em aberto.',
    proximaAcao: 'Fechar as recomendações P0 e completar o parecer',
    proximo: 'depois de você: o parecer jurídico e a deliberação' },
  { artefato: 'ripd', estado: 'parecer_juridico', acao: 'aprovar_ripd', quando: 'sempre', urgencia: '30d',
    tipo: 'RIPD', tela: '/t3',
    travado: '{codigo} espera deliberação sobre o parecer jurídico.',
    proximaAcao: 'Deliberar sobre o parecer jurídico',
    proximo: 'depois de você: a entrada em vigência' },
  { artefato: 'ripd', estado: 'deliberado', acao: 'aprovar_ripd', quando: 'sempre', urgencia: '30d',
    tipo: 'RIPD', tela: '/t3',
    travado: '{codigo} está deliberado e ainda não vigente — o tratamento segue sem RIPD válido.',
    proximaAcao: 'Colocar o RIPD em vigência',
    proximo: 'depois de você: o status check do PR #{pr} volta a verde' },
  { artefato: 'ripd', estado: 'em_revisao', acao: 'gerar_ripd', quando: 'com_pendencia', urgencia: '30d',
    tipo: 'RIPD', tela: '/t3',
    travado: 'O merge do PR #{pr} está travado por {codigo}: {p0} recomendação(ões) P0 em aberto.',
    proximaAcao: 'Fechar as recomendações P0 — a aprovação do DPO é recusada enquanto houver uma aberta',
    proximo: 'depois de você: o DPO aprova e o status check volta a verde' },
  { artefato: 'ripd', estado: 'em_revisao', acao: 'aprovar_ripd', quando: 'sem_pendencia', urgencia: '30d',
    tipo: 'RIPD', tela: '/t3',
    travado: 'O merge do PR #{pr} está travado por {codigo}, em revisão e sem P0 pendente.',
    proximaAcao: 'Aprovar o RIPD',
    proximo: 'depois de você: o status check do PR #{pr} volta a verde e o merge libera' },

  // ── LIA ───────────────────────────────────────────────────────────────────
  { artefato: 'lia', estado: 'rascunho', acao: 'assinar_lia', quando: 'sempre', urgencia: '30d',
    tipo: 'Base legal', tela: '/t8',
    travado: '{codigo} está em rascunho: {campos} campo(s) sob legítimo interesse sem balanceamento.',
    proximaAcao: 'Preencher o balanceamento por eixo',
    proximo: 'depois de você: a assinatura do DPO' },
  { artefato: 'lia', estado: 'balanceamento', acao: 'assinar_lia', quando: 'sempre', urgencia: '30d',
    tipo: 'Base legal', tela: '/t8',
    travado: '{codigo} tem balanceamento e nenhuma assinatura — o gate bloqueia quem tocar os campos.',
    proximaAcao: 'Assinar a LIA',
    proximo: 'a assinatura devolve a base legal e libera o gate' },
  { artefato: 'lia', estado: 'vencida', acao: 'assinar_lia', quando: 'sempre', urgencia: '30d',
    tipo: 'Base legal', tela: '/t8',
    travado: '{codigo} venceu: {campos} campo(s) ficaram sem base legal e o gate de CI bloqueia os PRs que os tocam.',
    proximaAcao: 'Reabrir o balanceamento e renovar — vencida não volta direto a vigente',
    proximo: 'a assinatura devolve a base legal e libera o gate' },
  { artefato: 'lia', estado: 'vigente', acao: 'assinar_lia', quando: 'vencendo', urgencia: '30d',
    tipo: 'Base legal', tela: '/t8',
    travado: '{codigo} vence em {dias} dia(s) e cobre {campos} campo(s).',
    proximaAcao: 'Programar a renovação antes do vencimento',
    proximo: 'sem renovação, o gate passa a bloquear no dia seguinte' },

  // ── risco ─────────────────────────────────────────────────────────────────
  { artefato: 'risco', estado: 'identificado', acao: 'gerenciar_risco', quando: 'sempre', urgencia: '30d',
    tipo: 'Risco', tela: '/t5',
    travado: '{codigo} está identificado e não avaliado: entra em nenhuma priorização.',
    proximaAcao: 'Avaliar probabilidade e impacto na matriz',
    proximo: 'depois de você: a definição de tratamento e dono' },
  { artefato: 'risco', estado: 'avaliado', acao: 'gerenciar_risco', quando: 'sempre', urgencia: '30d',
    tipo: 'Risco', tela: '/t5',
    travado: '{codigo} está avaliado com score {score} e sem tratamento definido.',
    proximaAcao: 'Definir tratamento e dono',
    proximo: 'depois de você: o acompanhamento até mitigar ou aceitar' },

  // ── direitos do titular ───────────────────────────────────────────────────
  { artefato: 'solicitacao', estado: 'recebida', acao: 'concluir_solicitacao', quando: 'sempre', urgencia: 'agora',
    tipo: 'Direito do titular', tela: '/t4',
    travado: 'Pedido de {direito} recebido e sem análise. O prazo legal já está correndo.',
    proximaAcao: 'Iniciar a análise e verificar a identidade',
    proximo: 'depois de você: a conclusão para o cronômetro e alimenta o indicador' },
  { artefato: 'solicitacao', estado: 'em_analise', acao: 'concluir_solicitacao', quando: 'sempre', urgencia: 'agora',
    tipo: 'Direito do titular', tela: '/t4',
    travado: 'Pedido de {direito} em análise sobre {sistemas} sistema(s), com prazo legal correndo.',
    proximaAcao: 'Concluir o atendimento ou recusar com fundamento (Art. 18, §4º)',
    proximo: 'a conclusão para o cronômetro e envia a devolutiva ao titular' },

  // ── achado de auditoria ───────────────────────────────────────────────────
  /**
   * PR 10 — o achado ganhou ação própria (`gerenciar_achado`, de engenharia e do
   * DPO). Antes caía em `escrever` e aparecia também para segurança: permissão
   * larga escolhendo o dono por omissão.
   *
   * E todos os estados abertos entram, ao contrário do `risco em_tratamento`.
   * A diferença é do modelo, não de gosto: risco declara dono e prazo, então
   * `em_tratamento` é trabalho **andando**; achado não tem dono declarado, então
   * todo estado aberto dele é alguém esperando. No dia em que `Achado` ganhar um
   * dono, esta lista encolhe.
   */
  { artefato: 'achado', estado: 'aberto', acao: 'gerenciar_achado', quando: 'sempre', urgencia: '30d',
    tipo: 'Achado de auditoria', tela: '/t6',
    travado: '{codigo} ({criticidade}) está aberto sem causa raiz — o plano não tem em que se apoiar.',
    proximaAcao: 'Registrar a causa raiz',
    proximo: 'depois de você: o plano com critério de eficácia' },
  { artefato: 'achado', estado: 'causa_raiz', acao: 'gerenciar_achado', quando: 'sempre', urgencia: '30d',
    tipo: 'Achado de auditoria', tela: '/t6',
    travado: '{codigo} ({criticidade}) tem causa raiz registrada e nenhum plano.',
    proximaAcao: 'Propor o plano com critério de eficácia verificável',
    proximo: 'depois de você: a execução e a verificação independente' },
  { artefato: 'achado', estado: 'plano', acao: 'gerenciar_achado', quando: 'sempre', urgencia: '30d',
    tipo: 'Achado de auditoria', tela: '/t6',
    travado: '{codigo} tem plano aprovado e não executado.',
    proximaAcao: 'Executar o plano e anexar a evidência',
    proximo: 'depois de você: a verificação independente de eficácia' },
  { artefato: 'achado', estado: 'executado', acao: 'gerenciar_achado', quando: 'sempre', urgencia: '30d',
    tipo: 'Achado de auditoria', tela: '/t6',
    travado: '{codigo} foi executado e ainda não verificado — executar não é comprovar que resolveu.',
    proximaAcao: 'Verificar a eficácia de forma independente',
    proximo: 'depois de você: encerrar ou reabrir' },
  { artefato: 'achado', estado: 'reaberto', acao: 'gerenciar_achado', quando: 'sempre', urgencia: '30d',
    tipo: 'Achado de auditoria', tela: '/t6',
    travado: '{codigo} foi reaberto — {reincidencias} reincidência(s), criticidade {criticidade}.',
    proximaAcao: 'Reapurar a causa raiz: reincidência não recomeça do plano antigo',
    proximo: 'o encerramento de reincidente vai ao comitê' },
  { artefato: 'achado', estado: 'verificado', acao: 'gerenciar_achado', quando: 'sempre', urgencia: '30d',
    tipo: 'Achado de auditoria', tela: '/t6',
    travado: '{codigo} foi verificado e segue aberto: encerrar ou reabrir é decisão pendente.',
    proximaAcao: 'Encerrar, ou reabrir se a evidência não comprova o controle',
    proximo: 'reabrir eleva a criticidade e conta como reincidência' },

  // ── incidente (Art. 48) ───────────────────────────────────────────────────
  { artefato: 'incidente', estado: 'aberto', acao: 'abrir_incidente', quando: 'sempre', urgencia: 'agora',
    tipo: 'Incidente', tela: '/t9',
    travado: '{id} está aberto e não contido. {titulares} titulares no escopo apurado, e a exposição continua.',
    proximaAcao: 'Conter e anexar a evidência da contenção',
    proximo: 'depois de você: o DPO decide sobre comunicar, com fundamento' },
  { artefato: 'incidente', estado: 'contido', acao: 'comunicar_incidente', quando: 'sempre', urgencia: 'agora',
    tipo: 'Incidente', tela: '/t9',
    travado: 'A decisão de comunicar {id} está pendente. {titulares} titulares no escopo apurado.',
    proximaAcao: 'Registrar a decisão com fundamento — inclusive a de não comunicar',
    proximo: 'a comunicação versionada sai do mesmo ato' },
  { artefato: 'incidente', estado: 'decidido', acao: 'comunicar_incidente', quando: 'sempre', urgencia: 'agora',
    tipo: 'Incidente', tela: '/t9',
    travado: '{id} está decidido e a comunicação ainda não saiu.',
    proximaAcao: 'Efetivar a comunicação, ou registrar a não comunicação',
    proximo: 'depois de você: o encerramento do incidente' },
  { artefato: 'incidente', estado: 'comunicado', acao: 'comunicar_incidente', quando: 'sempre', urgencia: '30d',
    tipo: 'Incidente', tela: '/t9',
    travado: '{id} foi comunicado e segue aberto no registro de operações.',
    proximaAcao: 'Encerrar o incidente',
    proximo: 'o encerramento fecha o registro do Art. 48' },
  { artefato: 'incidente', estado: 'nao_comunicado', acao: 'comunicar_incidente', quando: 'sempre', urgencia: '30d',
    tipo: 'Incidente', tela: '/t9',
    travado: '{id} teve a não comunicação registrada e segue aberto.',
    proximaAcao: 'Encerrar o incidente',
    proximo: 'o encerramento fecha o registro do Art. 48' },

  // ── chave ─────────────────────────────────────────────────────────────────
  { artefato: 'chave', estado: 'nova', acao: 'ver_pipeline_rotacao', quando: 'sempre', urgencia: '30d',
    tipo: 'Chave', tela: '/t7',
    travado: '{alias} foi criada e não começou a recriptografia — a chave velha continua sendo a que protege.',
    proximaAcao: 'Iniciar a recriptografia',
    proximo: 'depois de você: a janela de canary' },
  { artefato: 'chave', estado: 'recriptografando', acao: 'ver_pipeline_rotacao', quando: 'sempre', urgencia: '30d',
    tipo: 'Chave', tela: '/t7',
    travado: '{alias} está recriptografando {dependencias} dataset(s); a promoção depende do fim disso.',
    proximaAcao: 'Acompanhar e abrir a janela de canary',
    proximo: 'depois de você: a promoção do canary' },
  { artefato: 'chave', estado: 'canary', acao: 'ver_pipeline_rotacao', quando: 'sempre', urgencia: '30d',
    tipo: 'Chave', tela: '/t7',
    travado: '{alias} está em canary: a rotação não fecha e a chave antiga não é revogada.',
    proximaAcao: 'Promover o canary a ativa',
    proximo: 'depois de você: a revogação da chave antiga' },
  { artefato: 'chave', estado: 'ativa', acao: 'ver_pipeline_rotacao', quando: 'vencendo', urgencia: '30d',
    tipo: 'Chave', tela: '/t7',
    travado: 'A rotação de {alias} vence em {dias} dia(s) e {dependencias} dataset(s) dependem dela.',
    proximaAcao: 'Agendar a rotação e a janela de canary',
    proximo: 'chave vencida não quebra o sistema: para de proteger em silêncio' },
];

/**
 * De onde o item veio. `obrigacao` **não** é um artefato: não tem máquina de
 * estados e nunca terá — é compromisso agendado, a outra natureza de trabalho do
 * MAPA §4. Enfiá-la em `Artefato` obrigaria a inventar uma máquina para ela só
 * para caber no tipo.
 */
export type Origem = Artefato | 'obrigacao';

/**
 * De quem é o item — **declarado × derivado**.
 *
 * As duas naturezas de trabalho respondem à mesma pergunta por caminhos
 * diferentes, e achatar as duas num campo só custaria uma das duas verdades:
 *
 * - **derivada** — artefato. O estado diz o que precisa ser feito e a tabela de
 *   permissões diz quem pode fazer. Ninguém escolhe, e é por isso que a fila de
 *   artefato nunca ganha um campo de dono escrito à mão: ele divergiria de
 *   `permissoes.ts`, como o rótulo do gatilho divergia do catálogo antes do PR 8.
 *
 * - **declarada** — obrigação. É dado autorado: alguém disse, no calendário, que
 *   o tabletop é da segurança. Derivar isso de permissão exigiria uma `Acao` por
 *   recorte de papel, e não existe ação que só a segurança tenha — o tabletop
 *   caía em `escrever` e aparecia para três papéis.
 *
 * Quem filtra a fila depende **desta abstração**, não do papel concreto nem de
 * qual das duas naturezas é. Acrescentar uma terceira origem amanhã não toca em
 * `minhaFila` nem em `contadoresDe`.
 */
export type Titularidade =
  | { tipo: 'derivada'; acao: Acao }
  | { tipo: 'declarada'; responsavel: Papel };

/** A única pergunta que a fila faz sobre titularidade. */
export const eDe = (t: Titularidade, papel: Papel): boolean => (
  t.tipo === 'derivada' ? pode(papel, t.acao) : t.responsavel === papel
);

export interface ItemDaFila {
  /** Código do artefato ou da obrigação. Nunca titular, nunca pseudônimo. */
  id: string;
  artefato: Origem;
  tipo: string;
  /** De quem é o item — derivado da permissão ou declarado pelo autor. */
  titularidade: Titularidade;

  // ── as quatro informações, sempre as mesmas (MAPA §4) ────────────────────
  travado: string;
  /** `restanteMs` é a chave de ordenação; o que a tela mostra é o `texto`. */
  prazo: { texto: string; urgencia: Urgencia; restanteMs: number | null };
  proximaAcao: string;
  proximo: string;

  /**
   * Contexto que o `MAPA §4` pede à parte das quatro: o rito com a regra que o
   * decidiu, e o estado do artefato como faixa de passos. Nenhum dos dois é
   * informação **sobre o item** — são a explicação de por que ele existe e onde
   * ele está no processo.
   */
  rito: { texto: string; fonte: string };
  estados: string[];
  estadoAtual: number;
  tela: string;
}

type Candidato = {
  artefato: Artefato;
  id: string;
  estado: string;
  contexto: Record<string, string | number>;
  /**
   * O artefato tem trabalho pendente que impede o próximo passo? `null` quando a
   * noção não existe para ele — e aí nenhuma regra com `com_pendencia` ou
   * `sem_pendencia` casa, que é o comportamento certo: condição indefinida não
   * libera regra nenhuma.
   */
  pendencia: boolean | null;
  /** Milissegundos até o vencimento. `null` quando o artefato não tem relógio. */
  restanteMs: number | null;
  prazoTexto: string;
  decisao: DecisaoRegistrada | null;
};

const preencher = (texto: string, contexto: Record<string, string | number>): string =>
  texto.replace(/\{(\w+)\}/g, (bruto, chave) => (chave in contexto ? String(contexto[chave]) : bruto));

const emDias = (ms: number): string => {
  const dias = Math.round(ms / DIA_MS);
  if (dias < 0) return `vencido há ${Math.abs(dias)} dia(s)`;
  if (dias === 0) return 'vence hoje';
  return `em ${dias} dia(s)`;
};

const emHoras = (ms: number): string => {
  if (ms < 0) return `vencido há ${Math.floor(Math.abs(ms) / 3_600_000)} h`;
  const horas = Math.floor(ms / 3_600_000);
  return horas < 48 ? `${horas} h restantes` : emDias(ms);
};

/**
 * Onde cada artefato guarda o próprio estado, o próprio relógio e o próprio
 * contexto. É o análogo do `alvoDaTransicao` do PR 7: o único lugar que precisa
 * saber a forma de cada um, para que a tabela acima não precise.
 */
function candidatos(c: Cenario, agora: number): Candidato[] {
  const lista: Candidato[] = [];

  for (const p of c.pareceres) {
    lista.push({ artefato: 'parecer', id: p.codigo, estado: p.status, restanteMs: null, pendencia: null,
      prazoTexto: 'sem prazo declarado', decisao: null,
      contexto: { codigo: p.codigo, devolucoes: p.devolucoes } });
  }

  for (const r of c.ripds) {
    const p0 = r.recomendacoes.filter((x) => x.prioridade === 'P0' && !x.concluida).length;
    lista.push({ artefato: 'ripd', id: r.codigo, estado: r.status, restanteMs: null, pendencia: p0 > 0,
      prazoTexto: 'sem prazo declarado', decisao: ultimaDecisao(r.decisoes, 'd1'),
      contexto: { codigo: r.codigo, pr: r.prNumero, p0, sistema: r.sistema } });
  }

  for (const l of c.lias) {
    lista.push({ artefato: 'lia', id: l.codigo, estado: l.status, pendencia: null,
      restanteMs: l.diasParaVencer * DIA_MS,
      prazoTexto: emDias(l.diasParaVencer * DIA_MS), decisao: null,
      contexto: { codigo: l.codigo, dias: l.diasParaVencer, campos: l.camposIds.length } });
  }

  for (const r of c.riscos) {
    lista.push({ artefato: 'risco', id: r.codigo, estado: r.status, restanteMs: null, pendencia: null,
      prazoTexto: 'sem prazo declarado', decisao: ultimaDecisao(r.decisoes, 'd2'),
      contexto: { codigo: r.codigo, score: r.probabilidade * r.impacto, dominio: r.dominio } });
  }

  for (const s of c.solicitacoes) {
    // O protocolo é o código do artefato. O titular e o pseudônimo dele não
    // entram no contexto — nem como chave que ninguém usou hoje.
    lista.push({ artefato: 'solicitacao', id: s.protocolo, estado: s.status, pendencia: null,
      restanteMs: s.prazoLimiteMs - agora,
      prazoTexto: emHoras(s.prazoLimiteMs - agora), decisao: null,
      contexto: { direito: s.direito.replace(/_/g, ' '), sistemas: s.sistemas.length } });
  }

  for (const a of c.achados) {
    lista.push({ artefato: 'achado', id: a.codigo, estado: a.status, restanteMs: null, pendencia: null,
      prazoTexto: 'sem prazo declarado', decisao: null,
      contexto: { codigo: a.codigo, criticidade: a.criticidade, reincidencias: a.reincidencias } });
  }

  for (const i of c.incidentes) {
    // Art. 48 fala em "prazo razoável" e o sistema não declara qual é. Em vez de
    // inventar um número aqui, a fila diz o que sabe — há quanto tempo corre — e
    // o item entra na frente da própria faixa por não ter relógio.
    const horas = Math.floor((agora - new Date(i.detectadoEm).getTime()) / 3_600_000);
    lista.push({ artefato: 'incidente', id: i.id, estado: i.estado, restanteMs: null, pendencia: null,
      prazoTexto: `correndo há ${horas} h · Art. 48 sem prazo declarado no sistema`, decisao: null,
      contexto: { id: i.id, titulares: i.titularesEstimados } });
  }

  for (const k of c.chaves) {
    // O relógio da chave é o da **rotação**, e ele só significa alguma coisa
    // para a chave em uso. Exibi-lo em `canary` faria "em 84 dias" parecer o
    // prazo de promover o canary, que é outra coisa — rótulo que promete o que
    // o número não quer dizer.
    const restante = k.status === 'ativa' && k.rotacaoEmDias !== null ? k.rotacaoEmDias * DIA_MS : null;
    lista.push({ artefato: 'chave', id: k.alias, estado: k.status, restanteMs: restante, pendencia: null,
      prazoTexto: restante !== null ? emDias(restante)
        : k.rotacaoEmDias === null ? 'sem rotação programada' : 'sem prazo declarado', decisao: null,
      contexto: { alias: k.alias, dias: k.rotacaoEmDias ?? 0, dependencias: k.dependencias.length } });
  }

  return lista;
}

const casaAcondicao = (cand: Candidato, quando: Quando): boolean => {
  switch (quando) {
    case 'sempre': return true;
    case 'vencendo': return cand.restanteMs !== null && cand.restanteMs <= JANELA_DIAS * DIA_MS;
    case 'com_pendencia': return cand.pendencia === true;
    case 'sem_pendencia': return cand.pendencia === false;
    default: return false;
  }
};

const regraDe = (cand: Candidato): RegraDaFila | null =>
  REGRAS.find((r) => (
    r.artefato === cand.artefato && r.estado === cand.estado && casaAcondicao(cand, r.quando)
  )) ?? null;

/**
 * O rito, citando a regra que produziu o item.
 *
 * Quando existe decisão gravada, a fonte é a versão aplicada (`d1@1`) e o texto
 * é a frase derivada da tabela do PR 8. Quando não existe, a fonte é a máquina
 * de estados — que é, literalmente, a regra que colocou o item aqui.
 */
const ritoDe = (cand: Candidato): ItemDaFila['rito'] => (
  cand.decisao
    ? { texto: cand.decisao.frase, fonte: `${cand.decisao.tabela}@${cand.decisao.versao}` }
    : {
      texto: `${cand.artefato} em "${cand.estado}" exige ação antes de avançar.`,
      fonte: `estados.ts · MAPA §2`,
    }
);

/**
 * PR 10 — a obrigação promovida a item.
 *
 * **Derivação, nunca cópia.** O item não é gravado em lugar nenhum: ele é a
 * leitura de uma obrigação que entrou na antecedência declarada. Prorrogar a
 * data faz o item sair da fila no mesmo ciclo, sem ninguém apagar nada — e é
 * essa propriedade que uma cópia perderia.
 *
 * A faixa de passos fica vazia de propósito: obrigação não tem máquina de
 * estados, e desenhar uma barra falsa só para o cartão ficar simétrico seria
 * inventar processo onde há compromisso.
 */
function daObrigacao(o: Obrigacao, agora: number): ItemDaFila {
  const dias = Math.round((new Date(`${o.vence}T12:00:00Z`).getTime() - agora) / DIA_MS);
  const prorrogada = (o.prorrogacoes ?? []).length;
  return {
    id: o.codigo,
    artefato: 'obrigacao',
    tipo: o.tipo === 'prazo' ? 'Prazo do calendário' : 'Compromisso do calendário',
    titularidade: { tipo: 'declarada', responsavel: o.responsavel },
    // A consequência declarada é o que está em jogo — "revalidar consentimento
    // em março" não diz a ninguém por que largar o que está fazendo.
    travado: `${o.titulo}. Se passar: ${o.seFalhar}.`,
    prazo: {
      texto: dias < 0 ? `vencido há ${Math.abs(dias)} dia(s)` : dias === 0 ? 'vence hoje' : `em ${dias} dia(s)`,
      urgencia: dias < 0 ? 'vencido' : '30d',
      restanteMs: dias * DIA_MS,
    },
    proximaAcao: o.preparar,
    proximo: o.tipo === 'prazo'
      ? 'depois da data não há próximo: a consequência acima é o que acontece'
      : 'depois de você: o compromisso acontece na data e vira registro',
    rito: {
      texto: `Obrigação do calendário promovida a item: entrou na antecedência de ${o.antecedenciaDias} dias.`
        + (prorrogada ? ` Prorrogada ${prorrogada}× com justificativa registrada.` : ''),
      fonte: `calendario.ts · ${o.trilha}`,
    },
    estados: [],
    estadoAtual: -1,
    tela: o.tela,
  };
}

export function derivarFila(cenario: Cenario, agora: number): ItemDaFila[] {
  const itens: ItemDaFila[] = [];

  for (const o of cenario.obrigacoes) {
    if (naAntecedencia(o, agora)) itens.push(daObrigacao(o, agora));
  }

  for (const cand of candidatos(cenario, agora)) {
    const regra = regraDe(cand);
    if (!regra) continue;

    // O relógio só agrava: nunca abranda a faixa declarada pela regra. Uma
    // solicitação com folga continua "para hoje"; vencida vira "vencido".
    const vencido = cand.restanteMs !== null && cand.restanteMs < 0;
    const urgencia: Urgencia = vencido ? 'vencido' : regra.urgencia;

    const estados = estadosDe(cand.artefato) as string[];
    itens.push({
      id: cand.id,
      artefato: cand.artefato,
      tipo: regra.tipo,
      titularidade: { tipo: 'derivada', acao: regra.acao },
      travado: preencher(regra.travado, cand.contexto),
      prazo: { texto: cand.prazoTexto, urgencia, restanteMs: cand.restanteMs },
      proximaAcao: preencher(regra.proximaAcao, cand.contexto),
      proximo: preencher(regra.proximo, cand.contexto),
      rito: ritoDe(cand),
      // A faixa de passos vem da máquina, não de uma lista escrita na tela.
      estados,
      estadoAtual: estados.indexOf(cand.estado),
      tela: regra.tela,
    });
  }

  return itens.sort(ordenarPorConsequencia);
}

/**
 * Ordem por consequência, não por chegada.
 *
 * Faixa primeiro — vencido, prazo legal correndo, trinta dias. Dentro da faixa,
 * o que não tem relógio vem antes do que tem: não dá para afirmar que um passo
 * sem prazo pode esperar, e a dúvida não trabalha a favor de adiar.
 */
function ordenarPorConsequencia(a: ItemDaFila, b: ItemDaFila): number {
  const faixa = FAIXA[a.prazo.urgencia] - FAIXA[b.prazo.urgencia];
  if (faixa !== 0) return faixa;
  const semRelogio = (i: ItemDaFila) => (i.prazo.restanteMs === null ? 0 : 1);
  const relogio = semRelogio(a) - semRelogio(b);
  if (relogio !== 0) return relogio;
  // Dentro da faixa, menos tempo restante vem primeiro. Ordenar por código aqui
  // seria ordem de chegada com outro nome.
  const tempo = (a.prazo.restanteMs ?? 0) - (b.prazo.restanteMs ?? 0);
  if (tempo !== 0) return tempo;
  return a.id.localeCompare(b.id);
}

export const minhaFila = (itens: ItemDaFila[], papel: Papel): ItemDaFila[] =>
  itens.filter((i) => eDe(i.titularidade, papel));

export interface ContadoresDaFila {
  vencido: number;
  agora: number;
  trintaDias: number;
  /**
   * Itens que existem no programa e não são seus. **Contagem, nunca lista**: a
   * fila não expõe o trabalho alheio, só o fato de que ele existe — senão o
   * papel que não alcança a ação passaria a enxergar por aqui o que a tela dele
   * não mostra.
   */
  deOutrosPapeis: number;
}

export function contadoresDe(todos: ItemDaFila[], papel: Papel): ContadoresDaFila {
  const meus = minhaFila(todos, papel);
  const conta = (u: Urgencia) => meus.filter((i) => i.prazo.urgencia === u).length;
  return {
    vencido: conta('vencido'),
    agora: conta('agora'),
    trintaDias: conta('30d'),
    deOutrosPapeis: todos.length - meus.length,
  };
}
