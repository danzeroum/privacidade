/**
 * Varredura de segredo estático (Risco-036).
 *
 * O feed ICS era assinado com uma constante de segredo escrita à mão em
 * `mock/calendario.ts`. A frase seguinte no comentário dizia que num backend de
 * verdade ele viria do KMS — o que é exatamente o padrão sistêmico nº 2 do
 * relatório: a promessa escrita ao lado do defeito, servindo de anestésico. E
 * como era literal no fonte, ele estava dentro de `dist/assets/*.js`: quem
 * abrisse o DevTools mintava o feed de qualquer papel.
 *
 * (O valor não aparece neste comentário de propósito. Ele existe uma única vez
 * no repositório, em `SEGREDOS_HISTORICOS` abaixo, que é a lista que impede o
 * retorno dele — e este módulo é importado só pelo CLI, nunca pelo aplicativo,
 * para que a lista não seja o próximo caminho de volta ao bundle.)
 *
 * Duas regras, e cada uma pega o que a outra não alcança:
 *
 * · **no fonte** — nome de constante que anuncia segredo não recebe literal.
 *   Pega o próximo antes de ele existir, e é conferível lendo o diff;
 * · **no bundle** — a lista fechada dos literais que já vazaram não reaparece.
 *   Depois da minificação os nomes somem e a primeira regra fica cega; o texto
 *   do segredo, esse, sobrevive inteiro. É a única das duas que funciona sobre
 *   o artefato publicado, e é por isso que as duas existem.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface AchadoDeSegredo {
  regra: 'segredo/literal-no-fonte' | 'segredo/vazado-no-bundle';
  arquivo: string;
  linha?: number;
  mensagem: string;
  comoCorrigir: string;
}

/**
 * Nomes que anunciam segredo. Lista curta e explícita: cada entrada é uma
 * decisão, e um padrão frouxo produziria vermelho falso — que é como um gate
 * é desligado.
 */
const NOMES_DE_SEGREDO = /\b(SEGREDO|SECRET|SENHA|PASSWORD|API_?KEY|TOKEN_FIXO|PRIVATE_KEY)\w*\s*[:=]\s*(['"`])([^'"`\n]{4,})\2/gi;

/**
 * Literais que já vaziram para o bundle e não podem voltar. Lista fechada e
 * visível no diff, como o inventário de PII sintética do PR 4.
 */
export const SEGREDOS_HISTORICOS = [
  // Assinava o feed ICS de todos os papéis até o PR 5 (Risco-036).
  'lastro-ics-demo',
];

const IGNORAR = new Set(['node_modules', '.git', 'coverage', '.next']);

function arquivos(raiz: string, atual = raiz, acc: string[] = []): string[] {
  if (!existsSync(atual)) return acc;
  for (const nome of readdirSync(atual)) {
    if (IGNORAR.has(nome)) continue;
    const caminho = join(atual, nome);
    if (statSync(caminho).isDirectory()) arquivos(raiz, caminho, acc);
    else acc.push(caminho);
  }
  return acc;
}

/** Regra 1 — no fonte: nome que anuncia segredo não recebe literal. */
export function varrerFonte(raiz: string): AchadoDeSegredo[] {
  const achados: AchadoDeSegredo[] = [];
  for (const abs of arquivos(raiz)) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(abs)) continue;
    const rel = relative(raiz, abs).split(sep).join('/');
    let conteudo: string;
    try { conteudo = readFileSync(abs, 'utf8'); } catch { continue; }
    conteudo.split('\n').forEach((linha, i) => {
      for (const m of linha.matchAll(NOMES_DE_SEGREDO)) {
        achados.push({
          regra: 'segredo/literal-no-fonte', arquivo: rel, linha: i + 1,
          mensagem: `${m[0].split(/[:=]/)[0].trim()} recebe um literal de string neste arquivo.`,
          comoCorrigir: 'Gere o valor em tempo de execução (como `novoSegredoDeFeed`) ou leia de '
            + 'variável de ambiente. Literal no fonte é literal no bundle publicado.',
        });
      }
    });
  }
  return achados;
}

/** Regra 2 — no artefato publicado: o que já vazou não volta. */
export function varrerBundle(dir: string, segredos = SEGREDOS_HISTORICOS): AchadoDeSegredo[] {
  const achados: AchadoDeSegredo[] = [];
  for (const abs of arquivos(dir)) {
    if (!/\.(js|mjs|css|html|map)$/.test(abs)) continue;
    let conteudo: string;
    try { conteudo = readFileSync(abs, 'utf8'); } catch { continue; }
    for (const segredo of segredos) {
      if (!conteudo.includes(segredo)) continue;
      achados.push({
        regra: 'segredo/vazado-no-bundle', arquivo: relative(dir, abs).split(sep).join('/'),
        // O valor não é reimpresso: o relatório do CI é um sistema de
        // armazenamento como outro qualquer, e a mesma regra do PR 4 vale aqui.
        mensagem: 'Um segredo da lista histórica voltou ao artefato publicado.',
        comoCorrigir: 'Remova o literal do fonte. Ele está em app/src/lib/segredos.ts na lista '
          + 'SEGREDOS_HISTORICOS justamente porque já saiu uma vez.',
      });
    }
  }
  return achados;
}
