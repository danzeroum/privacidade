import { BancoMock } from './db';
import { codigoDaPropagacao, varrerPropagacoes, varrerVencimentos, vencidos } from './expurgo';
import { codigoDoDesligamento, codigoDoAchadoDeDpa, diasAlemDaJanela, janelaVencida, varrerDpas } from './fornecedor';
import { codigoDoAchado, diasDeAtraso } from './retencao';
import { diasAte, naAntecedencia } from './calendario';
import { CENARIOS } from './scenarios';
import type { Achado, Papel } from './types';

/**
 * O relógio do programa (Risco-005, sub-item c).
 *
 * As quatro varreduras de prazo existiam e funcionavam — retenção vencida, DPA
 * vencido, propagação pendente, obrigação a vencer. Nenhuma rodava sem alguém
 * abrir a T0. Um prazo que só é notado por quem já estava olhando não é
 * vigilância: é sorte com aparência de controle, e foi o resíduo que o PR da AIA
 * nomeou ao entregar um gatilho de relógio que não dispara sozinho.
 *
 * ## A polaridade é o oposto dos outros quatro checks
 *
 * Gate, catraca, invariantes e equidade **reprovam**, porque o defeito está no
 * diff de quem abriu o PR. O relógio não reprova: a pendência está no mundo. Uma
 * `main` vermelha todo dia depois de um DPA vencer treina a equipe a ignorar
 * vermelho — o efeito contrário ao que ele existe para produzir.
 *
 * Então **pendência é exit 0 com alerta**, e só **varredura quebrada é exit
 * diferente de zero, sem alerta nenhum**. Vermelho aqui significa "o relógio
 * parou", não "há prazo estourado", e essa distinção é a razão de este job não
 * dever ser marcado como *required*.
 *
 * ## Sem backend, a idempotência mora na chave
 *
 * Não há onde guardar "já avisei". A chave é determinística — `RELOGIO-<cenário>-
 * <código do achado>` — e o CLI recebe as chaves já abertas como **entrada**. A
 * regra é literal: um alerta **aberto** por chave. Fechar um alerta com a
 * pendência viva faz ele voltar na execução seguinte, e isso é o relógio
 * funcionando: fechar a issue não renova o DPA.
 *
 * A decisão mora aqui e não no shell do workflow. `gh issue list | grep` poria a
 * regra num lugar que ninguém roda em casa nem consegue exercitar por teste — o
 * mesmo defeito que o gate de privacidade evita ao viver em `.ts`.
 */

export type TipoDePendencia = 'retencao' | 'dpa' | 'propagacao' | 'obrigacao' | 'desligamento';

export interface Pendencia {
  /** `RELOGIO-<cenario>-<codigo>`. É a identidade do alerta entre execuções. */
  readonly chave: string;
  readonly cenario: string;
  readonly tipo: TipoDePendencia;
  /** O código determinístico que a varredura já produzia. */
  readonly codigo: string;
  readonly titulo: string;
  /** Quem responde. Vem do dado — declarado na obrigação, derivado no achado. */
  readonly responsavel: Papel;
  /**
   * Dias desde o vencimento. Negativo é o que ainda vai vencer, e **`null` é
   * "não há prazo"**.
   *
   * A distinção não é cosmética: um DPA que nunca foi assinado não tem
   * vencimento, e a primeira versão deste módulo o exibia como "vence hoje" —
   * uma frase falsa sobre um contrato que nunca existiu. Zero e ausência de
   * prazo são coisas diferentes, e um alerta que as confunde manda a pessoa
   * renovar o que precisa ser assinado.
   */
  readonly diasDeAtraso: number | null;
  /**
   * O que acontece se ninguém tratar — **copiado do dado**, nunca escrito aqui.
   *
   * `seFalhar` da obrigação, `descricao` do achado. Prosa nova neste campo
   * divergiria da consequência que o artefato declara, e o alerta passaria a
   * dizer uma coisa enquanto a tela diz outra.
   */
  readonly consequencia: string;
  readonly criticidade: string;
}

export const CHAVE_PREFIXO = 'RELOGIO';

export const chaveDe = (cenario: string, codigo: string): string =>
  `${CHAVE_PREFIXO}-${cenario}-${codigo}`;

/**
 * Achado que a varredura tocou e que **continua sendo pendência**.
 *
 * `varrerDpas` também devolve o que ela fechou: um DPA renovado encerra o achado
 * com a evidência da renovação, e o achado encerrado entra em `tocados`. Alertar
 * sobre ele avisaria que o problema acabou de ser resolvido.
 */
const aberto = (a: Achado): boolean => a.status !== 'encerrado';

/** Papel que responde por achado de motor: engenharia executa, DPO decide. */
const RESPONSAVEL_POR_TIPO: Record<Exclude<TipoDePendencia, 'obrigacao'>, Papel> = {
  retencao: 'engenharia',
  dpa: 'dpo',
  propagacao: 'engenharia',
  // Quem decide encerrar é o DPO; quem destrói a chave é a segurança, e é a
  // destruição que está pendente aqui.
  desligamento: 'seguranca',
};

const iso = (agora: number): string => new Date(agora).toISOString().slice(0, 10);

const HORA_MS = 3_600_000;

/**
 * O atraso de cada achado, calculado **do dado** — nunca lido da descrição.
 *
 * A primeira versão deste módulo extraía o número por regex sobre a prosa do
 * achado ("venceu há 6 dia(s)"). É a mesma classe de defeito que o projeto recusa
 * nos documentos: reenunciar em vez de derivar. Um ajuste de redação na varredura
 * teria zerado o atraso de todos os alertas em silêncio.
 *
 * Cada mapa usa a função que **produz** o código do achado, e não uma cópia do
 * formato dele.
 */
function atrasosDe(banco: BancoMock, hoje: string, agora: number): Map<string, number | null> {
  const atrasos = new Map<string, number | null>();

  for (const { campo, atraso } of vencidos(banco, hoje)) {
    atrasos.set(codigoDoAchado(campo.dataset, campo.nome), atraso);
  }
  for (const f of banco.cenario.fornecedores) {
    // Sem prazo declarado não há atraso a informar — e é diferente de zero.
    atrasos.set(codigoDoAchadoDeDpa(f.slug), f.dpaExpiraEm ? diasDeAtraso(f.dpaExpiraEm, hoje) : null);
  }
  for (const revogacao of banco.revogacoesTitular) {
    for (const item of revogacao.cascata) {
      const horas = (agora - item.iniciadaEmMs) / HORA_MS;
      atrasos.set(codigoDaPropagacao(revogacao.campoId, item.alvo), Math.floor(horas / 24));
    }
  }

  return atrasos;
}

/**
 * Varre um banco. Recebe o instante **e o banco**, e nunca lê o relógio nem
 * constrói o cenário por conta própria.
 *
 * O parâmetro do banco é a costura que torna a regra exercitável: sem ele, um
 * teste que plantasse estado — um achado aberto sobre um DPA já renovado, por
 * exemplo — estaria olhando uma instância diferente da que a varredura constrói,
 * e a asserção passaria com a regra desligada. Foi o que aconteceu na primeira
 * versão deste módulo, e a injeção que deveria reprovar não reprovou.
 */
export function pendenciasDe(banco: BancoMock, cenario: string, agora: number): Pendencia[] {
  const hoje = iso(agora);
  const pendencias: Pendencia[] = [];
  const atrasos = atrasosDe(banco, hoje, agora);

  const doAchado = (a: Achado, tipo: Exclude<TipoDePendencia, 'obrigacao'>): Pendencia => ({
    chave: chaveDe(cenario, a.codigo),
    cenario,
    tipo,
    codigo: a.codigo,
    titulo: a.codigo,
    responsavel: RESPONSAVEL_POR_TIPO[tipo],
    diasDeAtraso: atrasos.get(a.codigo) ?? null,
    consequencia: a.descricao,
    criticidade: a.criticidade,
  });

  for (const a of varrerVencimentos(banco, hoje).filter(aberto)) {
    pendencias.push(doAchado(a, 'retencao'));
  }
  for (const a of varrerDpas(banco, hoje).filter(aberto)) {
    pendencias.push(doAchado(a, 'dpa'));
  }
  for (const a of varrerPropagacoes(banco, agora).filter(aberto)) {
    pendencias.push(doAchado(a, 'propagacao'));
  }

  /**
   * Desligamento cuja janela venceu sem prova de destruição (Risco-008).
   *
   * A janela existe para o parceiro devolver o que tem. Passado o prazo sem a
   * chave destruída, o dado dele continua descriptografável sob um contrato que
   * já acabou — e ninguém saberia, porque o estado da relação não fala sozinho.
   */
  for (const f of banco.cenario.fornecedores) {
    const d = f.desligamento;
    if (f.estado !== 'desligando' || !d) continue;
    if (d.chaveDestruidaEm) continue;
    if (!janelaVencida(d, hoje)) continue;
    const codigo = codigoDoDesligamento(f.slug);
    pendencias.push({
      chave: chaveDe(cenario, codigo),
      cenario,
      tipo: 'desligamento',
      codigo,
      titulo: `${f.nome} — chave não destruída`,
      responsavel: RESPONSAVEL_POR_TIPO.desligamento,
      diasDeAtraso: diasAlemDaJanela(d, hoje),
      consequencia: `A janela do desligamento de ${f.nome} terminou em ${d.janelaAte} e a chave dele `
        + 'continua de pé: o dado que ele recebeu segue descriptografável sob um contrato encerrado.',
      criticidade: 'critica',
    });
  }

  /**
   * Obrigação entra pela **antecedência declarada**, que é a porta que o
   * calendário já usava para virar item de fila. O relógio não inventa uma
   * segunda régua de urgência: se a obrigação ainda não ocupa ninguém na T0, ela
   * também não merece alerta.
   */
  for (const o of banco.cenario.obrigacoes) {
    if (!naAntecedencia(o, agora)) continue;
    pendencias.push({
      chave: chaveDe(cenario, o.codigo),
      cenario,
      tipo: 'obrigacao',
      codigo: o.codigo,
      titulo: o.titulo,
      responsavel: o.responsavel,
      diasDeAtraso: -diasAte(o, agora),
      consequencia: o.seFalhar,
      criticidade: diasAte(o, agora) < 0 ? 'alta' : 'media',
    });
  }

  return pendencias;
}

/** O caso comum: o cenário semeado, no instante dado. */
export const varrerCenario = (cenario: string, agora: number): Pendencia[] =>
  pendenciasDe(new BancoMock(cenario), cenario, agora);

/** Os três cenários. Escolher um seria arbitrário: o programa é o conjunto. */
export const varrerOPrograma = (agora: number, cenarios = Object.keys(CENARIOS)): Pendencia[] =>
  cenarios.flatMap((c) => varrerCenario(c, agora));

export interface PlanoDeAlertas {
  readonly criar: readonly Pendencia[];
  /** Já tinha alerta aberto: nada a fazer, e o relatório diz que continua de pé. */
  readonly mantidos: readonly Pendencia[];
}

/**
 * Um alerta **aberto** por chave.
 *
 * Duas execuções seguidas com a mesma pendência produzem um alerta, não dois. E
 * uma pendência cuja issue foi fechada sem a causa ser resolvida volta — porque
 * fechar o alerta não renova o contrato, não expurga o dado vencido e não
 * propaga a revogação.
 */
export function planoDeAlertas(
  pendencias: readonly Pendencia[], chavesAbertas: readonly string[],
): PlanoDeAlertas {
  const abertas = new Set(chavesAbertas);
  const criar: Pendencia[] = [];
  const mantidos: Pendencia[] = [];
  const vistas = new Set<string>();

  for (const p of pendencias) {
    // A mesma chave duas vezes na mesma execução é uma pendência, não duas: as
    // varreduras já são idempotentes por código, e isto fecha a última porta.
    if (vistas.has(p.chave)) continue;
    vistas.add(p.chave);
    (abertas.has(p.chave) ? mantidos : criar).push(p);
  }

  return { criar, mantidos };
}

export const quandoDe = (dias: number | null): string => {
  if (dias === null) return 'sem prazo declarado';
  if (dias > 0) return `vencida há ${dias} dia(s)`;
  if (dias === 0) return 'vence hoje';
  return `vence em ${-dias} dia(s)`;
};

const linhaDe = (p: Pendencia): string => {
  const quando = quandoDe(p.diasDeAtraso);
  return `- **${p.chave}** · ${p.titulo} · ${quando} · responsável: ${p.responsavel} · ${p.criticidade}\n`
    + `  ${p.consequencia}`;
};

/** O corpo da issue: só campos da pendência, para não divergir do artefato. */
export const corpoDoAlerta = (p: Pendencia): string => [
  `Pendência de prazo encontrada pelo relógio do programa em \`${p.cenario}\`.`,
  '',
  `| | |`,
  `|---|---|`,
  `| Tipo | ${p.tipo} |`,
  `| Código | \`${p.codigo}\` |`,
  `| Responsável | ${p.responsavel} |`,
  `| Prazo | ${quandoDe(p.diasDeAtraso)} |`,
  `| Criticidade | ${p.criticidade} |`,
  '',
  '**O que está travado por causa disto:**',
  '',
  p.consequencia,
  '',
  '---',
  '',
  'Este alerta é aberto uma vez por pendência. Fechá-lo sem resolver a causa faz o relógio '
  + 'reabri-lo na próxima execução — fechar o alerta não renova o contrato nem expurga o dado.',
].join('\n');

/**
 * O relatório de toda execução, inclusive a silenciosa.
 *
 * Execução verde precisa dizer "nenhuma pendência" em vez de não dizer nada:
 * ausência de saída é indistinguível de relógio parado, e é justamente o estado
 * que este PR existe para não deixar acontecer.
 */
export function relatorioDoRelogio(
  agora: number, pendencias: readonly Pendencia[], plano: PlanoDeAlertas,
): string {
  const linhas: string[] = [
    '## Relógio do programa',
    '',
    `Execução de \`${new Date(agora).toISOString()}\` sobre ${Object.keys(CENARIOS).length} cenário(s).`,
    '',
  ];

  if (pendencias.length === 0) {
    linhas.push('**Nenhuma pendência de prazo.** As quatro varreduras rodaram e não acharam');
    linhas.push('retenção vencida, DPA vencido, propagação parada nem obrigação dentro da antecedência.');
    return `${linhas.join('\n')}\n`;
  }

  linhas.push(`**${pendencias.length} pendência(s)** — ${plano.criar.length} alerta(s) a abrir, `
    + `${plano.mantidos.length} já aberto(s).`);

  for (const [rotulo, lista] of [['A abrir', plano.criar], ['Já aberto', plano.mantidos]] as const) {
    if (lista.length === 0) continue;
    linhas.push('', `### ${rotulo}`, '');
    for (const p of lista) linhas.push(linhaDe(p));
  }

  return `${linhas.join('\n')}\n`;
}
