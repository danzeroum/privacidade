import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { varrerBundle, varrerFonte } from '../src/lib/segredos';

/**
 * CLI da varredura de segredo estático (Risco-036).
 *
 * Roda depois do `npm run build`, porque metade da prova só existe no artefato
 * construído: depois da minificação os nomes de constante somem, e o que
 * sobrevive é o texto do segredo. A outra metade roda sobre o fonte e pega o
 * próximo antes de ele chegar ao bundle.
 *
 * **Bundle ausente reprova.** Aprovar por não ter olhado seria o Risco-003 de
 * novo, com outro nome — e é o erro mais fácil de cometer num passo de CI que
 * depende de outro ter rodado antes.
 */
const fonte = resolve(process.argv[2] ?? 'src');
const dist = resolve(process.argv[3] ?? 'dist');

const achados = [...varrerFonte(fonte)];

if (!existsSync(dist)) {
  achados.push({
    regra: 'segredo/vazado-no-bundle', arquivo: 'dist/',
    mensagem: 'O artefato construído não existe: metade da varredura não teve o que ler.',
    comoCorrigir: 'Rode `npm run build` antes desta varredura. Passar por não ter olhado é o '
      + 'defeito que esta varredura existe para não repetir.',
  });
} else {
  achados.push(...varrerBundle(dist));
}

process.stdout.write(`\n  Varredura de segredo estático\n  fonte: ${fonte}\n  bundle: ${dist}\n\n`);
for (const a of achados) {
  process.stdout.write(`  ⛔  ${a.arquivo}${a.linha ? `:${a.linha}` : ''}\n`);
  process.stdout.write(`      [${a.regra}] ${a.mensagem}\n      → ${a.comoCorrigir}\n\n`);
}
if (achados.length === 0) {
  process.stdout.write('  Nenhum segredo estático no fonte, e nenhum segredo histórico no bundle.\n\n');
}
process.exit(achados.length === 0 ? 0 : 1);
