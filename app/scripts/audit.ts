import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { avaliarAuditoria, lerPolitica, relatorioDaAuditoria } from '../src/lib/auditoria';

/**
 * CLI da política de dependências vulneráveis (Risco-005, sub-item b).
 *
 * `npm audit --json` sai com código diferente de zero sempre que há qualquer
 * vulnerabilidade, de `info` a `critical`. Usar esse código como veredito
 * transformaria dois `moderate` com correção disponível em build vermelho — o
 * ruído crônico que ensina a equipe a ignorar vermelho. Quem decide é a política,
 * e o código de saída do `npm` é só o sinal de que o relatório saiu.
 *
 * `--relatorio=` aceita um JSON pronto. É o que permite ao teste injetar um
 * advisory `high` sem depender de a árvore de dependências ter um — e sem esperar
 * que o mundo publique a vulnerabilidade certa no dia certo.
 */

const argumento = (nome: string): string | null => {
  const p = process.argv.slice(2).find((a) => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : null;
};

const raiz = resolve(argumento('raiz') ?? '..');
const caminhoDaPolitica = join(raiz, '.privacy', 'audit-excecoes.yaml');

if (!existsSync(caminhoDaPolitica)) {
  process.stderr.write(`\n  ${caminhoDaPolitica} não existe. Ausente reprova em vez de passar por omissão.\n`);
  process.exit(1);
}

const lida = lerPolitica(readFileSync(caminhoDaPolitica, 'utf8'), '.privacy/audit-excecoes.yaml');
if (!lida.ok) {
  process.stderr.write(`\n  Política inválida:\n${lida.achados.map((a) => `    [${a.regra}] ${a.mensagem}`).join('\n')}\n`);
  process.exit(1);
}

const deArquivo = argumento('relatorio');
let relatorio: unknown;
if (deArquivo) {
  relatorio = JSON.parse(readFileSync(deArquivo, 'utf8'));
} else {
  const r = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (!r.stdout) {
    process.stderr.write(`\n  npm audit não produziu relatório: ${r.stderr?.slice(0, 400) ?? 'sem saída'}\n`);
    process.exit(1);
  }
  try {
    relatorio = JSON.parse(r.stdout);
  } catch {
    process.stderr.write('\n  npm audit devolveu saída que não é JSON. Sem relatório não há veredito.\n');
    process.exit(1);
  }
}

const hoje = argumento('hoje') ?? new Date().toISOString().slice(0, 10);
const resultado = avaliarAuditoria(relatorio, lida.politica, hoje);

process.stdout.write(relatorioDaAuditoria(resultado));
process.exit(resultado.aprovado ? 0 : 1);
