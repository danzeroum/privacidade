import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ambienteParaFilho,
  dependenciasDesatualizadas,
  interpretarArgumentos,
  planoDePartida,
  textoDeAjuda,
  type Fatos,
} from '../src/lib/partida';

/**
 * CLI da partida local.
 *
 * Três responsabilidades, e só três: ler os fatos do ambiente, gastar processo, e
 * decidir código de saída. O plano — quais passos, em que ordem, qual falha para
 * tudo — mora em `src/lib/partida.ts`, que os testes exercitam sem subir
 * servidor nenhum.
 *
 * `shell: true` é deliberado e é o que faz isto funcionar em PowerShell, cmd e
 * sh sem três caminhos de código. O que autoriza usá-lo é o plano só produzir
 * comandos literais: nenhum fato do ambiente — nome de ramo em primeiro lugar —
 * entra numa linha executada.
 */

const RAIZ = resolve('..');
const APP = resolve('.');

/**
 * Calculado uma vez, usado em todo filho. Sem isto a partida constrói um
 * artefato diferente do que o mesmo comando constrói no terminal — o `vite-node`
 * que executa este arquivo deixa `NODE_ENV` no ambiente, e o build filho herda.
 */
const AMBIENTE = ambienteParaFilho(process.env);

const gitLendo = (comando: string): string | null => {
  const r = spawnSync(comando, { cwd: RAIZ, shell: true, encoding: 'utf8', env: AMBIENTE });
  return r.status === 0 ? (r.stdout ?? '').trim() : null;
};

const mtime = (caminho: string): number | null => (existsSync(caminho) ? statSync(caminho).mtimeMs : null);

const lerFatos = (): Fatos => {
  const ramo = gitLendo('git rev-parse --abbrev-ref HEAD');
  const estado = gitLendo('git status --porcelain');
  return {
    // Sem git, ou fora de um clone (um zip baixado, por exemplo), o passo de git
    // sai do plano em vez de reprovar por algo que ninguém pediu.
    ehRepositorio: ramo !== null,
    ramo: ramo ?? '',
    arvoreSuja: (estado ?? '') !== '',
    dependenciasDesatualizadas: dependenciasDesatualizadas(
      {
        existe: existsSync(join(APP, 'node_modules')),
        mtimeDoLockInstalado: mtime(join(APP, 'node_modules', '.package-lock.json')),
      },
      mtime(join(APP, 'package-lock.json')),
    ),
  };
};

const leitura = interpretarArgumentos(process.argv.slice(2));
if (!leitura.ok) {
  process.stderr.write(`\n${leitura.erro}\n\n${textoDeAjuda()}`);
  process.exit(2);
}

const plano = planoDePartida(leitura.opcoes, lerFatos());
if (plano.length === 0) {
  process.stdout.write(textoDeAjuda());
  process.exit(0);
}

let houveAviso = false;

for (const passo of plano) {
  process.stdout.write(`\n=== ${passo.titulo} ===\n`);
  if (passo.aviso) {
    process.stdout.write(`  aviso: ${passo.aviso}\n`);
    houveAviso = true;
  }

  const cwd = passo.ondeRodar === 'repositorio' ? RAIZ : APP;
  for (const comando of passo.comandos) {
    process.stdout.write(`  $ ${comando}\n`);
    const r = spawnSync(comando, { cwd, shell: true, stdio: 'inherit', env: AMBIENTE });
    if (r.status === 0) continue;

    // Encerrar o servidor é o fim normal da partida, não reprovação: Ctrl+C
    // devolve código diferente de zero, e anunciar "PARADO" aqui ensinaria a
    // equipe a ignorar a palavra quando ela importa.
    if (passo.chave === 'servidor') process.exit(0);

    if (!passo.fatal) {
      process.stdout.write(`  segue mesmo assim: ${passo.seFalhar}\n`);
      houveAviso = true;
      break;
    }

    process.stderr.write(`\nPARADO em "${passo.titulo}".\n  ${passo.seFalhar}\n`);
    process.exit(r.status ?? 1);
  }
}

if (houveAviso) process.stdout.write('\nA partida terminou com aviso — releia as linhas marcadas acima.\n');
process.exit(0);
