import { BYTES_VERSIONADOS } from '../lib/equidade-versionada';
import { CAMINHO_DO_CONTRATO, descreverDisparidade, lerContrato, lerMassa, medir } from '../lib/equidade';
import type { AchadoDeEquidade, ContratoDeEquidade, Medicao } from '../lib/equidade';
import { transicaoPermitida } from './estados';
import { BancoMock, FalhaDeAuditoria } from './db';

/**
 * A consequência de runtime do teste de disparidade (Risco-007).
 *
 * O pipeline reprova o build; isto derruba a base legal. As duas pontas são
 * necessárias, e por um motivo que não é simetria: o RIPD §5 usa a mitigação de
 * equidade no balanceamento do Art. 10 §3º. Se o piso estourasse e a LIA
 * seguisse `vigente`, o balanceamento continuaria citando um teste verde que
 * deixou de existir — que é exatamente a forma como esta mitigação já vivia
 * antes deste PR, só que sem ninguém poder notar.
 *
 * ## Os mesmos bytes, não o mesmo número redigitado
 *
 * O contrato e a massa entram por `?raw` de `.privacy/`. O pipeline lê os mesmos
 * dois arquivos do disco, e um teste de paridade cobra que os dois cheguem à
 * mesma razão. A alternativa era semear o resultado no cenário, e resultado
 * semeado é a redigitação que o PR 8 do histórico recusou nas decisões: dois
 * números para o mesmo fato, e nenhuma maneira de saber qual envelheceu.
 *
 * ## O que fica de fora daqui, de propósito
 *
 * A varredura de proxy nos fatores é regra de **fonte**, e mora no pipeline. Ela
 * lê `app/src/mock/scenarios.ts` procurando `feature:`, e trazer o fonte para
 * dentro do navegador só para reexecutá-la embutiria o arquivo inteiro no
 * artefato — com a PII sintética que ele carrega. Aqui roda a medição, que é o
 * que tem consequência sobre o estado da LIA.
 */

export { BYTES_VERSIONADOS };

export interface Bytes {
  contrato: string;
  massa: string;
}

export type Avaliacao =
  | { situacao: 'aprovada'; medicao: Medicao; contrato: ContratoDeEquidade }
  | {
    situacao: 'reprovada';
    medicao: Medicao;
    contrato: ContratoDeEquidade;
    lia: string;
    de: string;
    para: string;
    motivo: string;
  }
  | { situacao: 'sem_medicao'; achados: AchadoDeEquidade[] }
  | { situacao: 'sem_registro'; mensagem: string };

/**
 * Mede a massa e, abaixo do piso, puxa a vigência da LIA de volta.
 *
 * A ordem é **gravar, depois mover** — a mesma do `transitar` genérico, e pelo
 * mesmo motivo: uma LIA que caiu sem linha no trail é uma queda que a auditoria
 * não pode reconstituir, e reconstituir é o que o Art. 37 pede. Se o append
 * falhar, o estado não muda e a resposta é 503.
 *
 * A transição passa por `transicaoPermitida`. Não é cerimônia: escrever
 * `lia.status = 'em_revisao'` direto criaria o atalho por artefato que o PR 7 do
 * histórico fechou, e a máquina de estados deixaria de ser o único caminho.
 */
export function avaliarEquidade(
  banco: BancoMock,
  quem: { ator: string; papel: 'engenharia' | 'dpo' | 'produto' | 'seguranca' | 'auditor' | 'system' },
  bytes: Bytes = BYTES_VERSIONADOS,
): Avaliacao {
  const lida = lerContrato(bytes.contrato, CAMINHO_DO_CONTRATO);
  if (!lida.ok) return { situacao: 'sem_medicao', achados: lida.achados };
  const contrato = lida.contrato;

  const massa = lerMassa(bytes.massa, contrato.massa);
  if (!massa.ok) return { situacao: 'sem_medicao', achados: massa.achados };

  const aferida = medir(massa.grupos, contrato, contrato.massa);
  if (!aferida.ok) return { situacao: 'sem_medicao', achados: aferida.achados };
  const medicao = aferida.medicao;

  const lia = banco.cenario.lias.find((l) => l.codigo === contrato.lia);
  if (!lia) {
    // Contrato apontando para LIA inexistente: o estouro não derrubaria nada, e
    // o verde do pipeline sustentaria um balanceamento sem dono.
    return {
      situacao: 'sem_medicao',
      achados: [{
        regra: 'contrato/lia-inexistente',
        arquivo: CAMINHO_DO_CONTRATO,
        mensagem: `${contrato.lia} não existe neste cenário: o piso estouraria sem derrubar base legal nenhuma.`,
      }],
    };
  }

  if (medicao.atendePiso) return { situacao: 'aprovada', medicao, contrato };

  const motivo = descreverDisparidade(medicao);

  // Já em revisão por medição anterior: nada a mover, e a resposta continua
  // reprovada. Transicionar de novo empilharia linhas idênticas no trail.
  if (lia.status === 'em_revisao') {
    return { situacao: 'reprovada', medicao, contrato, lia: lia.codigo, de: 'em_revisao', para: 'em_revisao', motivo };
  }

  const de = lia.status;
  if (!transicaoPermitida('lia', de, 'em_revisao')) {
    return {
      situacao: 'sem_medicao',
      achados: [{
        regra: 'lia/transicao-ilegal',
        arquivo: CAMINHO_DO_CONTRATO,
        mensagem: `${lia.codigo} está em "${de}", de onde a máquina não vai para "em_revisao". `
          + 'A medição continua reprovada; o que não acontece é a transição.',
      }],
    };
  }

  try {
    banco.auditAppend({
      ator: quem.ator,
      atorPapel: quem.papel,
      acao: 'EQUIDADE_ABAIXO_DO_PISO',
      recursoTipo: 'lia',
      recursoId: lia.codigo,
      baseLegal: 'legitimo_interesse',
      justificativa: motivo,
      campos: [
        `${de}→em_revisao`,
        `razao=${medicao.razaoMilesimos}`,
        `piso=${medicao.pisoMilesimos}`,
        `menor=${medicao.menor.grupo}`,
        `maior=${medicao.maior.grupo}`,
      ],
      resultado: 'negado',
    });
  } catch (e) {
    return {
      situacao: 'sem_registro',
      mensagem: e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a queda da LIA.',
    };
  }

  lia.status = 'em_revisao';
  lia.equidade = {
    razaoMilesimos: medicao.razaoMilesimos,
    pisoMilesimos: medicao.pisoMilesimos,
    menorGrupo: medicao.menor.grupo,
    maiorGrupo: medicao.maior.grupo,
    motivo,
  };

  return { situacao: 'reprovada', medicao, contrato, lia: lia.codigo, de, para: 'em_revisao', motivo };
}

/**
 * A LIA que sustenta este campo está valendo?
 *
 * `null` quando o campo não depende de LIA ou a LIA está `vigente`. Uma frase
 * quando não está — e a frase nomeia a razão de aprovação, se foi a equidade que
 * a derrubou. Recusa que diz apenas "LIA não vigente" manda a pessoa procurar o
 * motivo em outro lugar.
 */
export function motivoDaLiaNaoVigente(banco: BancoMock, codigoDaLia: string | undefined): string | null {
  if (!codigoDaLia) return null;
  const lia = banco.cenario.lias.find((l) => l.codigo === codigoDaLia);
  if (!lia) {
    return `A LIA ${codigoDaLia} vinculada a este campo não existe no cenário: `
      + 'legítimo interesse sem LIA não é base legal (Art. 7º, IX).';
  }
  if (lia.status === 'vigente') return null;
  if (lia.status === 'em_revisao' && lia.equidade) {
    return `A ${lia.codigo} está em revisão: ${lia.equidade.motivo} `
      + 'A mitigação de equidade que sustentava o balanceamento caiu, e com ela a base legal.';
  }
  return `A ${lia.codigo} está em "${lia.status}", não vigente: o balanceamento que sustentava `
    + 'este tratamento não está de pé.';
}
