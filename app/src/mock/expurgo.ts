/**
 * O executor de expurgo — a metade que faltava do Risco-006.
 *
 * A plataforma registrava **pós-fato** o que um executor externo, não
 * versionado, declarava ter feito. A auditoria chamou isso de "ciclo de vida
 * sem motor", e com razão: prova de expurgo sem execução conferível é o mesmo
 * que prazo sem data.
 *
 * Este executor é o espelho em memória do que `db/schema.sql` desenha para a
 * produção. Ele existe para que as três propriedades que importam sejam
 * **exercitáveis**, não afirmadas:
 *
 * 1. **Idempotência.** A chave do lote vem de coisas imutáveis; reexecutar o
 *    mesmo dia não duplica registro nem reconta eliminado.
 * 2. **Prova pré/pós do lote.** A contagem é do lote, nunca da tabela — e a
 *    diferença é de complexidade, não de estilo (ver abaixo).
 * 3. **Transacional.** Falha de log em qualquer ponto derruba a execução
 *    inteira: nada é eliminado sem par pré/pós no trail.
 *
 * ## A armadilha de complexidade
 *
 * `count(*)` da tabela antes e depois de cada lote transforma *b* lotes em
 * **O(n·b)**: com 1,2 milhão de linhas e lotes de 5 000, seriam 257 varreduras
 * completas para eliminar o que caberia em 257 varreduras de faixa. A prova
 * pré/pós é **do lote** — `restanteAntes` e `restanteDepois` são aritmética
 * sobre o contador do campo, não recontagem —, e a seleção usa keyset
 * (`ORDER BY retencao_ate, id LIMIT`), nunca `OFFSET`, que reintroduziria o
 * O(n·b) pela porta dos fundos.
 */

import { BancoMock, FalhaDeAuditoria } from './db';
import {
  LIMITE_DO_LOTE, codigoDoAchado, criticidadeDoVencimento, derivarRetencaoAte, diasDeAtraso,
  loteChave, lotesNecessarios, retencaoQueImpedeEliminacao,
} from './retencao';
import { sha256 } from '../lib/sha256';
import type { Campo, Achado } from './types';

export interface EntradaDeExpurgo {
  campoId: string;
  tabela: string;
  sistema: string;
  metodo: 'hard_delete' | 'crypto_shredding' | 'anonimizacao' | 'compactacao_log';
  loteChave: string;
  registros: number;
  /** Contagem do LOTE, não da tabela. */
  restanteAntes: number;
  restanteDepois: number;
  hashPre: string;
  hashPos: string;
}

export interface ResultadoDoExpurgo {
  dataReferencia: string;
  entradas: EntradaDeExpurgo[];
  /** Somado das entradas. Nunca um contador — contador diverge do que contou. */
  registrosTotal: number;
  lotesIgnorados: number;
  achados: string[];
  recusados: { campoId: string; norma: string; retencaoAte: string | null; motivo: string }[];
}

/** O método de eliminação decorre de como o dado está guardado, não de escolha. */
export const metodoPara = (campo: Campo): EntradaDeExpurgo['metodo'] => {
  if (campo.categoria === 'anonimizado') return 'compactacao_log';
  if (campo.tipoArmazenado === 'criptografado') return 'crypto_shredding';
  if (campo.tipoArmazenado === 'agregado') return 'anonimizacao';
  return 'hard_delete';
};

/** A data de eliminação do campo, derivada — nunca lida de um campo digitado. */
export function retencaoAteDoCampo(campo: Campo): string | null {
  if (!campo.retencaoIso || !campo.fatoGerador || !campo.registroMaisAntigoEm) return null;
  return derivarRetencaoAte(campo.retencaoIso, campo.fatoGerador, {
    [campo.fatoGerador]: campo.registroMaisAntigoEm,
  });
}

/** Os campos vencidos na data de referência, com o que o achado precisa saber. */
export function vencidos(banco: BancoMock, hojeIso: string) {
  return banco.cenario.campos
    .map((c) => {
      const ate = retencaoAteDoCampo(c);
      return { campo: c, retencaoAte: ate, atraso: diasDeAtraso(ate, hojeIso) };
    })
    .filter((v) => v.retencaoAte !== null && v.atraso > 0 && v.campo.registrosEstimados! > 0);
}

/**
 * Executa o expurgo do dia.
 *
 * `hojeIso` é parâmetro e não `Date.now()`: um executor que só sabe rodar
 * "agora" não é testável em nenhum limite que importe — véspera, dia do
 * vencimento, seis dias depois.
 */
export function executarExpurgo(
  banco: BancoMock,
  opts: { hojeIso: string; ator: string; limite?: number; camposIds?: string[] },
): ResultadoDoExpurgo {
  const limite = opts.limite ?? LIMITE_DO_LOTE;
  const dataReferencia = opts.hojeIso.slice(0, 10);
  const entradas: EntradaDeExpurgo[] = [];
  const recusados: ResultadoDoExpurgo['recusados'] = [];
  let lotesIgnorados = 0;

  /**
   * Desfazimento explícito. A execução é atômica: se o trail falhar no lote 2,
   * o lote 1 volta atrás. Sem isto, "transacional" seria uma palavra no
   * comentário e o banco ficaria com dado eliminado sem prova — o pior dos dois
   * estados possíveis.
   */
  const desfazer: (() => void)[] = [];

  /**
   * Duas origens, uma execução.
   *
   * Sem `camposIds` é a varredura do dia: o candidato é o que **venceu**. Com
   * `camposIds` é um pedido de eliminação do titular, e aí o candidato é o que
   * ele pediu — vencido ou não. A diferença importa porque é só no segundo caso
   * que a obrigação legal precisa recusar: na varredura, obrigação legal
   * vencida é justamente o que deve ser eliminado.
   */
  const candidatos = opts.camposIds
    ? banco.cenario.campos
      .filter((c) => opts.camposIds!.includes(c.id))
      .map((c) => ({ campo: c, retencaoAte: retencaoAteDoCampo(c) }))
    : vencidos(banco, opts.hojeIso).map(({ campo, retencaoAte }) => ({ campo, retencaoAte }));

  try {
    for (const { campo, retencaoAte } of candidatos) {
      /**
       * Obrigação legal prevalece sobre pedido de eliminação (Art. 16, I) — e a
       * recusa nomeia a norma e a data. Um 500 aqui seria o pior desfecho
       * possível: o titular pediu, o sistema quebrou, e ninguém sabe se apagou.
       */
      if (opts.camposIds) {
        const impedimento = retencaoQueImpedeEliminacao(campo.retencaoIso ?? '', retencaoAte);
        if (impedimento && diasDeAtraso(retencaoAte, opts.hojeIso) === 0) {
          recusados.push({ campoId: campo.id, ...impedimento });
          continue;
        }
      }

      const total = campo.registrosEstimados ?? 0;
      const quantos = lotesNecessarios(total, limite);
      let restante = total;

      for (let i = 0; i < quantos; i += 1) {
        const chave = loteChave(sha256, campo.dataset, campo.id, dataReferencia, i);
        // Idempotência: o lote já registrado não entra de novo, e não reconta.
        if (banco.lotesDeExpurgo.has(chave)) { lotesIgnorados += 1; continue; }

        const registros = Math.min(limite, restante);
        const restanteAntes = restante;
        const restanteDepois = restante - registros;
        const hashPre = sha256(`${campo.id}|${dataReferencia}|${i}|${restanteAntes}`);
        const hashPos = sha256(`${campo.id}|${dataReferencia}|${i}|${restanteDepois}`);

        // Gravar, depois eliminar. A ordem é a mesma do Art. 37 em toda a casa.
        banco.auditAppend({
          ator: opts.ator, atorPapel: 'system', acao: 'EXPURGO_LOTE',
          recursoTipo: 'campo', recursoId: campo.id,
          campos: [
            campo.nome, `lote=${chave}`, `registros=${registros}`,
            `pre=${hashPre.slice(0, 16)}`, `pos=${hashPos.slice(0, 16)}`,
          ],
        });

        const entrada: EntradaDeExpurgo = {
          campoId: campo.id, tabela: campo.dataset, sistema: campo.sistema,
          metodo: metodoPara(campo), loteChave: chave, registros,
          restanteAntes, restanteDepois, hashPre, hashPos,
        };
        entradas.push(entrada);
        banco.lotesDeExpurgo.add(chave);
        desfazer.push(() => {
          banco.lotesDeExpurgo.delete(chave);
          campo.registrosEstimados = total;
        });

        restante = restanteDepois;
        campo.registrosEstimados = restante;
      }
    }
  } catch (e) {
    for (const f of desfazer.reverse()) f();
    throw e instanceof FalhaDeAuditoria ? e : new FalhaDeAuditoria('Falha ao registrar o expurgo.');
  }

  return {
    dataReferencia,
    entradas,
    // Somado. Se fosse incrementado, divergiria do que contou no primeiro erro —
    // e é o primeiro número que uma auditoria de expurgo confere.
    registrosTotal: entradas.reduce((s, e) => s + e.registros, 0),
    lotesIgnorados,
    achados: [],
    recusados,
  };
}

/**
 * A cascata da revogação também é vigiada.
 *
 * O portal já mostra ao titular que uma frente está pendente há mais de 24 h.
 * Mostrar não é vigiar: sem achado, o alerta some quando a pessoa fecha a aba,
 * e a pendência vira exatamente a espera silenciosa que a revogação deveria
 * acabar. O código é determinístico pelo mesmo motivo do vencimento — uma
 * varredura por dia sobre a mesma pendência não pode abrir um achado por dia.
 */
export function varrerPropagacoes(banco: BancoMock, agoraMs: number): Achado[] {
  const LIMITE_MS = 24 * 60 * 60 * 1000;
  const tocados: Achado[] = [];

  for (const revogacao of banco.revogacoesTitular) {
    for (const item of revogacao.cascata) {
      if (item.estado !== 'pendente') continue;
      const horas = (agoraMs - item.iniciadaEmMs) / (60 * 60 * 1000);
      if (agoraMs - item.iniciadaEmMs <= LIMITE_MS) continue;

      const codigo = `PROP-${revogacao.campoId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
        + `-${item.alvo.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
      const descricao = `A revogação de ${revogacao.campoId} não propagou para "${item.alvo}" `
        + `há ${horas.toFixed(0)} h. O titular já vê o atraso; falta alguém tratá-lo.`;

      const existente = banco.cenario.achados.find((a) => a.codigo === codigo);
      if (existente) {
        existente.descricao = descricao;
        // Passar de um dia é operação; passar de uma semana é processo.
        existente.criticidade = horas > 168 ? 'alta' : 'media';
        tocados.push(existente);
        continue;
      }
      const novo: Achado = {
        id: `ach_${sha256(codigo).slice(0, 10)}`,
        codigo,
        descricao,
        origem: 'motor_de_retencao',
        status: 'aberto',
        criticidade: horas > 168 ? 'alta' : 'media',
        reincidencias: 0,
        evidencias: [],
      };
      banco.cenario.achados.push(novo);
      tocados.push(novo);
    }
  }
  return tocados;
}

/**
 * A varredura que transforma prazo vencido em achado.
 *
 * Prazo que não faz nada é rótulo. O código é determinístico, e a segunda
 * varredura sobre o mesmo campo **atualiza** o achado em vez de abrir outro —
 * senão, em uma semana o DPO teria sete cópias do mesmo problema e nenhuma
 * pista de qual tratar.
 */
export function varrerVencimentos(banco: BancoMock, hojeIso: string): Achado[] {
  const tocados: Achado[] = [];

  for (const { campo, atraso } of vencidos(banco, hojeIso)) {
    const criticidade = criticidadeDoVencimento(atraso, campo.registrosEstimados ?? 0);
    if (!criticidade) continue;

    const codigo = codigoDoAchado(campo.dataset, campo.nome);
    const existente = banco.cenario.achados.find((a) => a.codigo === codigo);
    const descricao = `${campo.dataset}.${campo.nome} venceu há ${atraso} dia(s) com `
      + `${(campo.registrosEstimados ?? 0).toLocaleString('pt-BR')} registros e não foi expurgado.`;

    if (existente) {
      // Atualiza o que muda com o tempo; não reabre nem duplica.
      existente.descricao = descricao;
      existente.criticidade = criticidade;
      tocados.push(existente);
      continue;
    }

    const novo: Achado = {
      id: `ach_${sha256(codigo).slice(0, 10)}`,
      codigo,
      descricao,
      origem: 'motor_de_retencao',
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
