import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { linhaDaMedida, medirFimDeLinha } from '../src/lib/fim-de-linha';

/**
 * O que este runner realmente entregou na árvore de trabalho.
 *
 * Roda nas duas plataformas da matriz, e a saída é a mesma forma nas duas — é o
 * que permite comparar as duas colunas do log em vez de acreditar em uma delas.
 *
 * ## Nenhum caminho vem de argumento
 *
 * A lista é fechada e literal, pela mesma razão que tirou `--relatorio=` do CLI
 * de auditoria: caminho de `process.argv` chegando a `readFileSync` é sink de
 * path injection, e o CodeQL reprova — corretamente. Aqui a lista fechada também
 * é o conteúdo da medida: são os arquivos que um teste lê linha a linha, mais os
 * dois que o `.gitattributes` mentia a respeito.
 *
 * ## Isto não reprova
 *
 * Sai 0 sempre que conseguiu medir. CRLF na árvore não é defeito — a primeira
 * camada (o `split(/\r?\n/)` de cada leitor) existe para tolerá-lo. Sair
 * diferente de zero é reservado para não ter conseguido ler o que prometeu medir:
 * uma medição que falha em silêncio vira um log verde sobre nada.
 */

const RAIZ = join(import.meta.dirname, '..', '..');

const ARQUIVOS = [
  'db/retencao-casos.csv',
  '.privacy/equidade-decisoes.csv',
  'docs/processos/README.md',
  'docs/design_handoff_lastro_correcoes/MAPA-PROCESSOS.md',
  'README.md',
  'api/openapi.yaml',
  '.gitattributes',
] as const;

// `git` é executável de verdade em toda plataforma (`git.exe` em Windows), e por
// isso não passa pelo `precisaDeShell`: a regra de lá é sobre `npm`/`npx`, que
// são `.cmd`. Aplicá-la aqui seria cargo cult — e shell desnecessário é uma
// superfície a mais para argumento mal remontado.
const configDoGit = (chave: string): string => {
  const r = spawnSync('git', ['config', '--get', chave], { encoding: 'utf8', cwd: RAIZ });
  return r.stdout?.trim() || '(não definido)';
};

const linhas: string[] = [
  '',
  '  Fim de linha na árvore de trabalho — medido neste runner',
  '  ' + '─'.repeat(70),
  `  plataforma            ${process.platform} (${process.arch})`,
  `  core.autocrlf         ${configDoGit('core.autocrlf')}`,
  `  core.eol              ${configDoGit('core.eol')}`,
  '',
];

let ausentes = 0;
for (const rel of ARQUIVOS) {
  const abs = join(RAIZ, ...rel.split('/'));
  if (!existsSync(abs)) {
    linhas.push(`  ${rel.padEnd(48)} AUSENTE`);
    ausentes += 1;
    continue;
  }
  linhas.push(linhaDaMedida(rel, medirFimDeLinha(readFileSync(abs, 'utf8'))));
}

linhas.push('');
linhas.push(
  '  CRLF aqui não é reprovação: o leitor de cada formato normaliza sozinho, e esta',
);
linhas.push(
  '  etapa existe para que o número seja lido, e não suposto. Ver `.gitattributes`.',
);
linhas.push('');

process.stdout.write(linhas.join('\n'));

if (ausentes > 0) {
  process.stderr.write(`\n  ${ausentes} arquivo(s) da lista fechada não existem — a medida está incompleta.\n`);
  process.exit(1);
}
