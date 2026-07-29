/**
 * Os sete princípios de Privacy by Design como campo do épico.
 *
 * Este arquivo é puro, sem import nenhum, pelo mesmo motivo de `estados.ts` e
 * `decisoes.ts`: ele é lido por **dois** consumidores que não podem divergir —
 * a tela, que mostra o checklist do épico, e o gate de CI, que reprova o merge
 * quando ele está incompleto. Duas implementações da mesma regra é o defeito que
 * este projeto já corrigiu três vezes; aqui ele nem chega a existir.
 *
 * A regra que dá dente ao checklist:
 *
 * - **em branco** é incompleto. O time ainda não olhou o princípio.
 * - **marcado com evidência** é o único caso que passa.
 * - **marcado sem evidência é reprovação, não aprovação** — e é uma reprovação
 *   mais séria que o branco, porque afirma um controle que ninguém consegue
 *   apontar. Um checklist que aceita a marca sozinha mede disciplina de clicar,
 *   não privacidade no produto.
 */

export interface PrincipioPbd {
  chave: string;
  numero: number;
  rotulo: string;
  /** O que o time precisa conseguir responder — e apontar. */
  pergunta: string;
}

/** Os sete de Cavoukian, na ordem canônica. */
export const PRINCIPIOS_PBD: PrincipioPbd[] = [
  { chave: 'proativo', numero: 1, rotulo: 'Proativo, não reativo; preventivo, não corretivo',
    pergunta: 'O que nesta entrega impede o problema de acontecer, em vez de detectá-lo depois?' },
  { chave: 'padrao', numero: 2, rotulo: 'Privacidade como configuração padrão',
    pergunta: 'Sem ninguém configurar nada, qual é o estado do dado pessoal nesta entrega?' },
  { chave: 'embutida', numero: 3, rotulo: 'Privacidade incorporada ao design',
    pergunta: 'Qual controle está no desenho do sistema, e não numa checagem à parte?' },
  { chave: 'soma_positiva', numero: 4, rotulo: 'Funcionalidade total — soma positiva, não soma zero',
    pergunta: 'Que funcionalidade foi preservada sem abrir mão da proteção?' },
  { chave: 'ciclo_de_vida', numero: 5, rotulo: 'Segurança fim a fim, por todo o ciclo de vida',
    pergunta: 'Onde está a proteção na coleta, no trânsito, no repouso e no descarte?' },
  { chave: 'transparencia', numero: 6, rotulo: 'Visibilidade e transparência',
    pergunta: 'O que um auditor externo consegue verificar sozinho nesta entrega?' },
  { chave: 'centrado_no_titular', numero: 7, rotulo: 'Respeito pela privacidade do titular',
    pergunta: 'Que direito do titular ficou operável por causa desta entrega?' },
];

export interface MarcacaoPbd {
  chave: string;
  marcado: boolean;
  /** Caminho, teste ou commit. Prosa vaga não é evidência. */
  evidencia: string;
}

export type SituacaoPbd = 'evidenciado' | 'em_branco' | 'marcado_sem_evidencia';

/**
 * Piso da evidência. Curto de propósito — o que se cobra é que ela **aponte**
 * para alguma coisa, e a verificação de que o alvo existe é do gate, que tem
 * acesso ao repositório.
 */
const MINIMO_EVIDENCIA = 8;

export interface AvaliacaoPbd {
  chave: string;
  numero: number;
  rotulo: string;
  /** Vai junto porque o gate a usa como instrução de correção. */
  pergunta: string;
  situacao: SituacaoPbd;
  evidencia: string;
  /** Por que este princípio não passou. Vazio quando passou. */
  motivo: string;
}

export function avaliarPbd(marcacoes: MarcacaoPbd[]): AvaliacaoPbd[] {
  return PRINCIPIOS_PBD.map((p) => {
    const m = marcacoes.find((x) => x.chave === p.chave);
    const evidencia = (m?.evidencia ?? '').trim();
    const marcado = Boolean(m?.marcado);

    if (marcado && evidencia.length >= MINIMO_EVIDENCIA) {
      return { ...p, situacao: 'evidenciado' as const, evidencia, motivo: '' };
    }
    if (marcado) {
      return {
        ...p, situacao: 'marcado_sem_evidencia' as const, evidencia,
        motivo: `Princípio ${p.numero} está marcado e não aponta evidência. `
          + 'Marca sem evidência afirma um controle que ninguém consegue conferir — é reprovação, não aprovação.',
      };
    }
    return {
      ...p, situacao: 'em_branco' as const, evidencia,
      motivo: `Princípio ${p.numero} em branco: ${p.pergunta}`,
    };
  });
}

export interface VereditoPbd {
  aprovado: boolean;
  evidenciados: number;
  total: number;
  /** O que falta, nomeado. Um gate que só diz "incompleto" não é acionável. */
  pendencias: AvaliacaoPbd[];
}

export function vereditoPbd(marcacoes: MarcacaoPbd[]): VereditoPbd {
  const avaliacao = avaliarPbd(marcacoes);
  const pendencias = avaliacao.filter((a) => a.situacao !== 'evidenciado');
  return {
    aprovado: pendencias.length === 0,
    evidenciados: avaliacao.length - pendencias.length,
    total: avaliacao.length,
    pendencias,
  };
}
