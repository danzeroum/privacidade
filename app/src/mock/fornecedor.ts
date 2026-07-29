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
   * A coluna existe e liga fornecedor a `kms_chave`. O que **não** existe ainda
   * é a revogação com SLA — desligar um parceiro destruindo a chave dele é
   * máquina própria, e fica declarada como resíduo em vez de insinuada por uma
   * coluna que ninguém usa.
   */
  kmsChaveId?: string;
}

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
