import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { avaliarAuditoria, lerPolitica, relatorioDaAuditoria } from '../src/lib/auditoria';
import { precisaDeShell } from '../src/lib/plataforma';

/**
 * CLI da política de dependências vulneráveis (Risco-005, sub-item b).
 *
 * `npm audit --json` sai com código diferente de zero sempre que há qualquer
 * vulnerabilidade, de `info` a `critical`. Usar esse código como veredito
 * transformaria dois `moderate` com correção disponível em build vermelho — o
 * ruído crônico que ensina a equipe a ignorar vermelho. Quem decide é a política,
 * e o código de saída do `npm` é só o sinal de que o relatório saiu.
 *
 * ## O relatório entra por stdin, e o caminho não entra por argumento
 *
 * O teste precisa injetar um advisory `high` sem depender de a árvore de
 * dependências ter um, e sem esperar que o mundo publique a vulnerabilidade certa
 * no dia certo. A primeira versão aceitava `--relatorio=<caminho>` e `--raiz=`, e
 * o CodeQL reprovou o PR com dois alertas `high` de **path injection**: caminho
 * vindo de `process.argv` chegando a `readFileSync`.
 *
 * Discutir com a ferramenta seria fácil — quem passa o caminho é quem executa o
 * comando, e essa pessoa já pode ler o arquivo direto. Mas dispensar alerta à mão
 * é a exceção sem registro que este repositório recusa em todo lugar, e a
 * alternativa era melhor de qualquer forma: o relatório entra por **stdin**,
 * `--raiz` sai (nunca foi usado), e não sobra caminho vindo de argumento. Menos
 * botão, menos sink, nada a dispensar.
 *
 * A leitura de stdin é **explícita**, por `--stdin`, e não adivinhada por
 * `isTTY`. A primeira tentativa adivinhava, e quebrou na hora: `readFileSync(0)`
 * lança `EAGAIN` quando stdin é um cano não-bloqueante que ninguém fechou, e o
 * CLI passou a falhar conforme o ambiente de quem o chamou. Heurística sobre
 * stdin é a classe de código que funciona na máquina de quem escreveu.
 */

const argumento = (nome: string): string | null => {
  const p = process.argv.slice(2).find((a) => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : null;
};

// A raiz é o repositório, e não é configurável: o CLI mora em `app/scripts/` e o
// arquivo de política em `.privacy/`. Um flag de raiz seria caminho vindo de
// argumento sem nenhum uso real.
const caminhoDaPolitica = resolve('..', '.privacy', 'audit-excecoes.yaml');

if (!existsSync(caminhoDaPolitica)) {
  process.stderr.write(`\n  ${caminhoDaPolitica} não existe. Ausente reprova em vez de passar por omissão.\n`);
  process.exit(1);
}

const lida = lerPolitica(readFileSync(caminhoDaPolitica, 'utf8'), '.privacy/audit-excecoes.yaml');
if (!lida.ok) {
  process.stderr.write(`\n  Política inválida:\n${lida.achados.map((a) => `    [${a.regra}] ${a.mensagem}`).join('\n')}\n`);
  process.exit(1);
}

let relatorio: unknown;
if (process.argv.includes('--stdin')) {
  let daEntrada = '';
  try {
    daEntrada = readFileSync(0, 'utf8');
  } catch (e) {
    process.stderr.write(`\n  --stdin pedido e a entrada não pôde ser lida: ${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  }
  try {
    relatorio = JSON.parse(daEntrada);
  } catch {
    process.stderr.write('\n  A entrada padrão não é JSON. Sem relatório não há veredito.\n');
    process.exit(1);
  }
} else {
  // `shell` pela plataforma: em Windows o alvo é `npm.cmd`, e o Node recusa
  // `.cmd` sem shell desde a correção da CVE-2024-27980. Sem isto o `spawnSync`
  // volta sem stdout e o CLI reprova por "não produziu relatório" — que é a pior
  // forma de errar aqui, porque a mensagem culpa o npm por um defeito nosso.
  const r = spawnSync('npm', ['audit', '--json'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: precisaDeShell(process.platform),
  });
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
