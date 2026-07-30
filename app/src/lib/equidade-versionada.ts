import contrato from '../../../.privacy/equidade.yaml?raw';
import massa from '../../../.privacy/equidade-decisoes.csv?raw';
import { CAMINHO_DO_CONTRATO, lerContrato } from './equidade';

/**
 * Os bytes versionados de `.privacy/`, do jeito que o pipeline os lê.
 *
 * Módulo separado por uma razão de grafo, não de organização: quem precisa do
 * piso declarado é `mock/scenarios.ts`, ao escrever a mitigação do modelo de
 * ameaças, e quem precisa derrubar a LIA é `mock/equidade.ts`, que importa
 * `db.ts`. Se os dois entrassem pelo mesmo módulo, `scenarios → equidade → db →
 * scenarios` fecharia um ciclo — e ciclo avaliado em tempo de módulo é
 * `undefined` intermitente em quem lê a constante primeiro.
 *
 * Aqui não há dependência de nada do mock. Só texto e leitura.
 */
export const BYTES_VERSIONADOS = { contrato, massa };

const lido = lerContrato(contrato, CAMINHO_DO_CONTRATO);

/**
 * O piso, como texto para exibir, lido do contrato — nunca redigitado.
 *
 * A prosa do modelo de ameaças prometia "limiar 0,8–1,2" com o número escrito à
 * mão, e a faixa era assimétrica: sob razão menor/maior, o teto equivalente a um
 * piso de 0,8 é 1,25. Documento com número próprio envelhece contra o
 * instrumento em silêncio, e é o defeito que este PR existe para não repetir —
 * então a frase passa a ler daqui.
 *
 * Contrato ilegível devolve `?`. Não é fallback silencioso: o mesmo contrato
 * ilegível reprova `npm run equidade` e a rota da LIA, e é lá que o vermelho
 * aparece. Uma exceção aqui derrubaria o protótipo inteiro na importação de um
 * cenário.
 */
export const PISO_DECLARADO: string = lido.ok
  ? (lido.contrato.metrica.pisoMilesimos / 1000).toFixed(2).replace('.', ',')
  : '?';

export const LIA_DA_EQUIDADE: string = lido.ok ? lido.contrato.lia : '?';
