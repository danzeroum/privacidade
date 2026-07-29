/**
 * Os onze direitos do Art. 18, e o regime de cada um.
 *
 * Este arquivo existe para responder **no servidor** a uma pergunta que o
 * cliente não pode responder: quanto de identidade o exercício deste direito
 * exige, e em quantos dias ele vence.
 *
 * O nível de verificação **não é parâmetro**. Se viesse do corpo, bastaria
 * pedir eliminação com `nivel_verificacao: 1` para apagar a conta de outra
 * pessoa com um código de e-mail — e a escada de verificação viraria sugestão.
 * Por isso a única função pública que devolve nível recebe o *direito*, nunca
 * um número: não há assinatura possível em que o chamador escolha.
 *
 * O prazo segue a mesma regra e pelo mesmo motivo: prazo que o cliente informa
 * é prazo que o cliente estende.
 */

import type { Direito } from './types';

export type NivelVerificacao = 1 | 2 | 3;

export interface RegimeDoDireito {
  /** Rótulo em linguagem de pessoa — o que a tela 01 do portal oferece. */
  rotulo: string;
  /** O artigo é legenda, nunca rótulo primário (PORTAL-DO-TITULAR.md §Regras). */
  artigo: string;
  nivel: NivelVerificacao;
  /** Por que este nível, e não outro. A escada fica visível para não parecer arbitrária. */
  porQueONivel: string;
  prazoDias: number;
  fundamentoDoPrazo: string;
}

/**
 * A escada da tela 02, transcrita sem acréscimo:
 *
 * | 1 | código no canal já conhecido   | confirmação, compartilhamentos                            |
 * | 2 | código + um dado de cadastro   | acesso, correção, bloqueio, oposição, revogação, revisão   |
 * | 3 | código + documento com foto    | eliminação, anonimização, portabilidade                   |
 *
 * `bloqueio` e `oposicao` dividem a linha 2 e continuam sendo direitos
 * distintos: os dois cessam tratamento sem destruir nada, e o erro de
 * identidade é reversível nos dois. Os três do nível 3 são os irreversíveis
 * (eliminação, anonimização) e o que produz um pacote exportável fora da
 * plataforma (portabilidade) — dano concreto se a identidade estiver errada.
 */
export const REGIME: Record<Direito, RegimeDoDireito> = {
  confirmacao: {
    rotulo: 'Confirmar se vocês tratam dados meus',
    artigo: 'Art. 18, I',
    nivel: 1,
    porQueONivel: 'A resposta é sim ou não sobre o canal que já é seu — não abre nenhum campo.',
    prazoDias: 15,
    fundamentoDoPrazo: 'Art. 19, II — declaração completa em até 15 dias.',
  },
  acesso: {
    rotulo: 'Ver todos os dados que vocês têm sobre mim',
    artigo: 'Art. 18, II',
    nivel: 2,
    porQueONivel: 'Sai o conteúdo do cadastro: um código de e-mail interceptado não basta.',
    prazoDias: 15,
    fundamentoDoPrazo: 'Art. 19, II — declaração completa em até 15 dias.',
  },
  correcao: {
    rotulo: 'Corrigir um dado errado',
    artigo: 'Art. 18, III',
    nivel: 2,
    porQueONivel: 'Escrever no cadastro de alguém exige mais do que alcançar a caixa de entrada dessa pessoa.',
    prazoDias: 15,
    fundamentoDoPrazo: 'Art. 19, II — declaração completa em até 15 dias.',
  },
  anonimizacao: {
    rotulo: 'Anonimizar dados que não são mais necessários',
    artigo: 'Art. 18, IV',
    nivel: 3,
    porQueONivel: 'É irreversível: anonimizado de verdade não volta a ser seu para conferência.',
    prazoDias: 15,
    fundamentoDoPrazo: 'Art. 19, II — declaração completa em até 15 dias.',
  },
  bloqueio: {
    rotulo: 'Parar de usar meus dados para isso',
    artigo: 'Art. 18, IV c/c §2º',
    nivel: 2,
    porQueONivel: 'Cessa o tratamento sem destruir nada — é reversível, e o erro de identidade também é.',
    prazoDias: 15,
    fundamentoDoPrazo: 'Art. 19, II — declaração completa em até 15 dias.',
  },
  eliminacao: {
    rotulo: 'Apagar meus dados',
    artigo: 'Art. 18, VI',
    nivel: 3,
    porQueONivel: 'Apagar não tem desfazer. É o nível que o próprio banco já exige (eliminacao_exige_nivel3).',
    prazoDias: 15,
    fundamentoDoPrazo: 'Art. 19, II — declaração completa em até 15 dias.',
  },
  portabilidade: {
    rotulo: 'Levar meus dados para outro serviço',
    artigo: 'Art. 18, V',
    nivel: 3,
    porQueONivel: 'Produz um pacote que sai da plataforma; entregue a quem não é você, não há como recolher.',
    prazoDias: 15,
    fundamentoDoPrazo: 'Art. 19, II — declaração completa em até 15 dias.',
  },
  compartilhamentos: {
    rotulo: 'Saber com quem vocês compartilharam',
    artigo: 'Art. 18, VII',
    nivel: 1,
    porQueONivel: 'A resposta é a lista de destinatários, não o conteúdo do cadastro.',
    prazoDias: 15,
    fundamentoDoPrazo: 'Art. 19, II — declaração completa em até 15 dias.',
  },
  revogacao: {
    rotulo: 'Retirar uma autorização que eu dei',
    artigo: 'Art. 18, VIII c/c Art. 8º, §5º',
    nivel: 2,
    porQueONivel: 'Revogar por engano tira do titular uma funcionalidade que ele não pediu para perder.',
    prazoDias: 15,
    fundamentoDoPrazo: 'Art. 19, II — declaração completa em até 15 dias.',
  },
  /**
   * Art. 18, §2º — e **não** um apelido de `bloqueio`.
   *
   * Bloqueio suspende um dado, por qualquer razão. Oposição objeta ao
   * *fundamento*: o titular não está dizendo "não use esse campo", está dizendo
   * "essa base legal não me alcança". É a salvaguarda que a LIA oferece como
   * contrapartida do legítimo interesse (Art. 10, §3º), e é o canal que ela
   * publica. Fundir os dois deixaria a LIA apontando para uma rota que decide
   * outra coisa — que é a forma mais silenciosa de a salvaguarda não existir.
   */
  oposicao: {
    rotulo: 'Discordar de vocês usarem meus dados sem me perguntar',
    artigo: 'Art. 18, §2º c/c Art. 10, §3º',
    nivel: 2,
    porQueONivel: 'Faz o tratamento parar na hora: nível 1 deixaria qualquer um desligar o serviço alheio.',
    prazoDias: 15,
    fundamentoDoPrazo: 'Art. 19, II — declaração completa em até 15 dias. A cessação, porém, é imediata.',
  },
  revisao_decisao: {
    rotulo: 'Pedir que uma pessoa revise a decisão automática',
    artigo: 'Art. 20',
    nivel: 2,
    porQueONivel: 'Abre os fatores da decisão sobre você — conteúdo de cadastro, não sim ou não.',
    prazoDias: 5,
    /**
     * Cinco dias é **compromisso interno**, mais estrito que a lei: o Art. 20
     * não fixa prazo, e prazo que a empresa não escreve é prazo que ninguém
     * cobra. Está aqui, e não no contrato do cliente, para que encurtá-lo seja
     * uma linha de código com teste — e alargá-lo, também.
     */
    fundamentoDoPrazo: 'Art. 20 não fixa prazo; 5 dias é compromisso interno mais estrito que o legal.',
  },
};

/** A lista, na ordem em que a tela 01 oferece: do mais leve ao mais pesado. */
export const DIREITOS: Direito[] = [
  'confirmacao', 'compartilhamentos', 'acesso', 'correcao', 'bloqueio',
  'oposicao', 'revogacao', 'revisao_decisao', 'portabilidade', 'anonimizacao', 'eliminacao',
];

/**
 * O nível exigido, derivado do direito.
 *
 * Recebe o direito e nada mais. Não existe sobrecarga que aceite um nível
 * sugerido, e é isso que torna o invariante verificável: para reduzir a
 * exigência de `eliminacao` é preciso editar a tabela acima, onde o teste olha.
 */
export const nivelExigido = (direito: Direito): NivelVerificacao => REGIME[direito].nivel;

/** Os dias de prazo, derivados do direito pelo mesmo motivo. */
export const prazoDiasDe = (direito: Direito): number => REGIME[direito].prazoDias;

export const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** O prazo como **data absoluta** — toda promessa de prazo é uma data (regra 6 do portal). */
export const prazoLimiteDe = (direito: Direito, agoraMs: number): number =>
  agoraMs + prazoDiasDe(direito) * MS_POR_DIA;

/** Os fatores que cada nível pede, na linguagem da tela 02. */
export const FATORES: Record<NivelVerificacao, string[]> = {
  1: ['codigo'],
  2: ['codigo', 'dado_cadastro'],
  3: ['codigo', 'documento'],
};

export const fatoresDe = (direito: Direito): string[] => FATORES[nivelExigido(direito)];

/** Um direito conhecido? A checagem é de vocabulário, não de permissão. */
export const eDireito = (v: unknown): v is Direito =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(REGIME, v);
