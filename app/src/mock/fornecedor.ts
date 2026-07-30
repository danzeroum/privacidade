/**
 * Fornecedor como **entidade**, e o DPA como fato com prazo (Risco-008).
 *
 * O destino de uma transferência era `TEXT` livre: "OpenAI" repetido em várias
 * linhas, sem chave, sem contrato, sem SLA. `dpa_assinado` e `dpa_expira_em`
 * existiam desde sempre em `compartilhamento` — sem uma única constraint e sem
 * um único teste. `grep dpa db/tests.sql` voltava vazio.
 *
 * O efeito de um destino sem entidade não é organizacional. É que a pergunta
 * *"posso mandar dado pessoal para este parceiro hoje?"* não tinha onde ser
 * feita: cada linha carregava a própria cópia da resposta, e nada garantia que
 * as cópias concordassem entre si.
 *
 * ## Duas coisas diferentes, ditas separadamente
 *
 * O banco **recusa a escrita**: um trigger no molde do `exige_lia_vigente()`
 * barra a transferência para quem não tem DPA assinado e vigente, com a data na
 * mensagem. Isso é tudo o que um trigger pode fazer — ele dispara sobre a linha
 * que está sendo escrita, nunca sobre a que já está parada.
 *
 * A linha gravada ontem com DPA válido **não se invalida sozinha** quando o
 * contrato vence amanhã. Quem pega isso é `varrerDpas()`, e o repositório não
 * escreve em lugar nenhum que o banco vigia o DPA: ele recusa, ela vigia.
 */

import { diasDeAtraso } from './retencao';
import { hashEncadeado } from '../lib/sha256';
import type { Achado as AchadoDeDpa } from './types';
import type { EstadoFornecedor } from './estados';

export type PapelDoFornecedor = 'operador' | 'controlador' | 'controlador_conjunto';

export interface Fornecedor {
  id: string;
  slug: string;
  nome: string;
  papel: PapelDoFornecedor;
  pais?: string;
  /**
   * O contrato foi assinado? Separado da evidência de propósito.
   *
   * `dpa_uri` aponta para um arquivo; `dpa_assinado` diz que ele foi firmado.
   * Um PDF anexado numa pasta não é um contrato vigente, e tratar os dois como
   * a mesma coisa é como a conformidade de papel nasce: alguém vê o anexo, marca
   * o item e ninguém mais pergunta se ele foi assinado.
   */
  dpaAssinado: boolean;
  dpaUri?: string;
  dpaHash?: string;
  /** AAAA-MM-DD. Ausente quando não há contrato com prazo declarado. */
  dpaExpiraEm?: string;
  slaIncidenteHoras?: number;
  /**
   * A chave que protege o dado deste parceiro (Risco-008, "chave por parceiro").
   *
   * Ligava fornecedor a `kms_chave` e não era usada por nada. O desligamento a
   * destrói: é o que torna o encerramento verificável em vez de prometido.
   */
  kmsChaveId?: string;
  /**
   * Onde o parceiro está no ciclo de vida da relação. Nono artefato da máquina
   * de estados — não há atalho por fornecedor.
   */
  estado: EstadoFornecedor;
  /**
   * Quantos dias o DPA promete para devolução ou eliminação no encerramento.
   *
   * É contra este número que a janela declarada no desligamento é conferida.
   * Ausente, o contrato não restringe nada — e a ausência fica visível no campo,
   * em vez de virar uma janela livre que ninguém percebe que é livre.
   */
  dpaEncerramentoDias?: number;
  /** O fato do desligamento. Ausente enquanto o parceiro está ativo. */
  desligamento?: Desligamento;
}

/**
 * O desligamento é **fato**, não flag.
 *
 * `estado = 'desligado'` responderia "está desligado" e nada mais: quem decidiu,
 * por quê, quando, e qual janela foi prometida sairiam do registro no instante
 * em que alguém mudasse o campo.
 */
export interface Desligamento {
  motivo: string;
  decididoPor: string;
  /** ISO completo: a janela é contada a partir daqui. */
  decididoEm: string;
  janelaDias: number;
  /** `AAAA-MM-DD`, derivada da decisão mais a janela — nunca digitada. */
  janelaAte: string;
  /** A prova da destruição. Ausente enquanto o desligamento está em curso. */
  chaveDestruidaEm?: string;
  chaveDestruidaPor?: string;
  provaHash?: string;
}

const DIA_MS = 86_400_000;

/** `AAAA-MM-DD` da decisão mais a janela. Derivada, como no banco. */
export const fimDaJanela = (decididoEm: string, janelaDias: number): string =>
  new Date(new Date(decididoEm).getTime() + janelaDias * DIA_MS).toISOString().slice(0, 10);

/**
 * Por que este desligamento não pode ser aceito — ou `null` quando pode.
 *
 * Separa conteúdo de sequência: a ordem dos passos é da máquina de estados, e o
 * que falta **dentro** do passo é isto. Janela maior que o contrato é 422 e não
 * 409, porque a transição é legal; o que não cabe é o prazo.
 */
export function motivoDaRecusaDoDesligamento(f: Fornecedor, motivo: string, janelaDias: unknown): string | null {
  if (motivo.trim().length < 20) {
    return 'O desligamento exige motivo de ao menos 20 caracteres: quem ler o registro daqui a um ano '
      + 'precisa saber por que a relação terminou.';
  }
  if (typeof janelaDias !== 'number' || !Number.isInteger(janelaDias) || janelaDias < 0 || janelaDias > 365) {
    return 'A janela precisa ser um número inteiro de dias entre 0 e 365. Zero é uma decisão declarada '
      + '— "não há dado a devolver" —, e omiti-la é uma etapa que ninguém percebeu que existia.';
  }
  if (f.dpaEncerramentoDias !== undefined && janelaDias > f.dpaEncerramentoDias) {
    return `A janela de ${janelaDias} dia(s) excede os ${f.dpaEncerramentoDias} que o DPA de ${f.nome} `
      + 'promete no encerramento. O prazo do desligamento não pode ser maior que o prazo contratado.';
  }
  return null;
}

/** A janela acabou? Vence **hoje** ainda vale, como o DPA. */
export const janelaVencida = (d: Desligamento, hojeIso: string): boolean => d.janelaAte < hojeIso;

/** Dias além da janela. Zero ou negativo enquanto ela não estourou. */
export const diasAlemDaJanela = (d: Desligamento, hojeIso: string): number =>
  Math.round((new Date(`${hojeIso}T12:00:00Z`).getTime() - new Date(`${d.janelaAte}T12:00:00Z`).getTime()) / DIA_MS);

/**
 * A chave de idempotência da destruição.
 *
 * Deriva de coisas **imutáveis** — o parceiro e o instante da decisão —, nunca
 * do estado. Se derivasse do estado, a segunda chamada produziria outro lote e a
 * cadeia de custódia passaria a contar destruições que não aconteceram. É a
 * mesma regra do `lote_chave` do expurgo.
 */
export const loteDaDestruicao = (slug: string, decididoEm: string): string =>
  `DESTRUICAO-${slug.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}-${decididoEm.slice(0, 19)}`;

/** O código determinístico do achado de desligamento vencido. */
export const codigoDoDesligamento = (slug: string): string =>
  `DESLIG-${slug.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;

export type EstadoDoDpa = 'vigente' | 'vencido' | 'nao_assinado' | 'sem_prazo';

/**
 * O DPA está vigente **nesta data**?
 *
 * `hojeIso` é parâmetro e não `Date.now()` pelo mesmo motivo do executor de
 * expurgo: uma regra de prazo que só sabe responder "agora" não é testável em
 * nenhum limite que importe — véspera, dia do vencimento, dia seguinte.
 */
export function estadoDoDpa(f: Fornecedor, hojeIso: string): EstadoDoDpa {
  // Sem assinatura não há contrato, e prazo futuro não conserta isso: a ordem
  // das checagens é a ordem das perguntas que um auditor faz.
  if (!f.dpaAssinado) return 'nao_assinado';
  if (!f.dpaExpiraEm) return 'sem_prazo';
  // Vence **hoje** ainda vale: o contrato cobre o último dia, não a véspera dele.
  return diasDeAtraso(f.dpaExpiraEm, hojeIso) > 0 ? 'vencido' : 'vigente';
}

export const dpaVigente = (f: Fornecedor, hojeIso: string): boolean =>
  estadoDoDpa(f, hojeIso) === 'vigente';

/**
 * Por que a transferência foi recusada, com a data quando ela existe.
 *
 * A mensagem carrega o prazo porque quem recebe a recusa precisa saber se o
 * caminho é renovar um contrato ou assinar o primeiro — são conversas
 * diferentes, com áreas diferentes, e um erro genérico manda a pessoa procurar
 * a errada.
 */
export function motivoDaRecusaDeTransferencia(f: Fornecedor, hojeIso: string): string | null {
  switch (estadoDoDpa(f, hojeIso)) {
    case 'vigente':
      return null;
    case 'nao_assinado':
      return `${f.nome} não tem DPA assinado`
        + `${f.dpaUri ? ' — há evidência anexada, mas evidência não é contrato firmado' : ''}.`;
    case 'sem_prazo':
      return `${f.nome} tem DPA assinado sem prazo declarado: contrato sem vencimento não se vigia.`;
    default:
      return `O DPA de ${f.nome} venceu em ${f.dpaExpiraEm}.`;
  }
}

/** O código do achado é determinístico: uma varredura por dia não abre um achado por dia. */
export const codigoDoAchadoDeDpa = (slug: string): string =>
  `DPA-${slug.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;

/**
 * Quanto pesa um DPA envelhecido.
 *
 * Sem contrato nenhum é crítico desde o primeiro dia — não há prazo correndo,
 * há transferência sem base contratual. Vencido escala com o tempo: uma semana
 * é operação, um trimestre é processo.
 */
export function criticidadeDoDpa(
  estado: EstadoDoDpa, atrasoDias: number,
): 'baixa' | 'media' | 'alta' | 'critica' | null {
  if (estado === 'vigente') return null;
  if (estado === 'nao_assinado') return 'critica';
  if (estado === 'sem_prazo') return 'media';
  if (atrasoDias >= 90) return 'critica';
  if (atrasoDias >= 30) return 'alta';
  if (atrasoDias >= 7) return 'media';
  return 'baixa';
}

// ── a varredura ─────────────────────────────────────────────────────────────

/**
 * O que o trigger não alcança.
 *
 * O banco recusa a **escrita** da transferência para quem não tem DPA vigente.
 * A linha gravada ontem, sob contrato válido, continua gravada quando o
 * contrato vencer amanhã — nenhum trigger dispara sobre linha parada. Esta
 * varredura é o que fecha esse buraco, e é por isso que o repositório não diz
 * em lugar nenhum que o banco vigia o DPA: ele recusa, ela vigia.
 *
 * Renovar o contrato **encerra** o achado em vez de apagá-lo. O problema
 * existiu, e a prova de que existiu é o que uma auditoria procura depois.
 */
export function varrerDpas(
  banco: { cenario: { campos: { id: string; nome: string; compartilhamentos: { fornecedorId: string }[] }[];
                      fornecedores: Fornecedor[]; achados: AchadoDeDpa[] } },
  hojeIso: string,
): AchadoDeDpa[] {
  const tocados: AchadoDeDpa[] = [];

  // Só fornecedor com transferência **viva** entra: um parceiro cadastrado e
  // sem uso não é risco, é cadastro.
  const emUso = new Set(
    banco.cenario.campos.flatMap((c) => c.compartilhamentos.map((x) => x.fornecedorId)),
  );

  for (const f of banco.cenario.fornecedores) {
    /**
     * Parceiro fora de `ativo` sai desta varredura (PR 31).
     *
     * Durante o desligamento a pendência é **destruir a chave**, não renovar o
     * contrato. Sem esta linha, um parceiro em encerramento com DPA vencendo
     * geraria dois alertas dizendo coisas diferentes sobre o mesmo fato, e quem
     * recebesse os dois trataria o errado.
     */
    if (f.estado !== 'ativo') continue;
    const codigo = codigoDoAchadoDeDpa(f.slug);
    const existente = banco.cenario.achados.find((a) => a.codigo === codigo);
    const estado = estadoDoDpa(f, hojeIso);
    const emRisco = emUso.has(f.id) && estado !== 'vigente';

    if (!emRisco) {
      /**
       * Renovado (ou desativado): o achado fecha com a data como evidência, e
       * não some. Apagar o achado apagaria o registro de que houve um período
       * de transferência sem contrato — que é justamente o que se audita.
       */
      if (existente && existente.status !== 'encerrado') {
        existente.status = 'encerrado';
        existente.eficaciaAtingida = true;
        // A evidência entra na cadeia de custódia do achado, encadeada como as
        // outras: a prova de que o contrato foi renovado é ela mesma auditável.
        const anterior = existente.evidencias.at(-1)?.hash ?? null;
        existente.evidencias = [
          ...existente.evidencias,
          {
            arquivo: `dpa-renovado-${hojeIso}`,
            hash: hashEncadeado(anterior, `dpa-renovado-${f.slug}-${hojeIso}`),
            hashAnterior: anterior,
            por: 'motor_de_dpa',
            etapa: 'verificado',
            quando: hojeIso,
          },
        ];
        tocados.push(existente);
      }
      continue;
    }

    const atraso = estado === 'vencido' ? diasDeAtraso(f.dpaExpiraEm ?? null, hojeIso) : 0;
    const criticidade = criticidadeDoDpa(estado, atraso)!;
    const descricao = `${f.nome} recebe dado pessoal e `
      + (estado === 'nao_assinado'
        ? `não tem DPA assinado${f.dpaUri ? ' (há evidência anexada, que não é contrato)' : ''}.`
        : estado === 'sem_prazo'
          ? 'tem DPA assinado sem prazo declarado: contrato sem vencimento não se vigia.'
          : `está com o DPA vencido há ${atraso} dia(s), desde ${f.dpaExpiraEm}.`);

    if (existente) {
      existente.descricao = descricao;
      existente.criticidade = criticidade;
      // Reabre se tinha sido encerrado: reincidência é fato novo sobre o mesmo
      // parceiro, e a T11 já sabe contá-la.
      if (existente.status === 'encerrado') {
        existente.status = 'reaberto';
        existente.reincidencias += 1;
        existente.motivoDaReabertura = `O contrato de ${f.nome} voltou a ficar irregular: ${descricao}`;
      }
      tocados.push(existente);
      continue;
    }

    const novo: AchadoDeDpa = {
      id: `ach_dpa_${f.slug}`,
      codigo,
      descricao,
      origem: 'motor_de_dpa',
      status: 'aberto',
      criticidade,
      reincidencias: 0,
      evidencias: [],
    };
    banco.cenario.achados.push(novo);
    tocados.push(novo);
  }

  return tocados;
}
