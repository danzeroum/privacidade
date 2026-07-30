import { writeFileSync } from 'node:fs';
import { corpoDoAlerta, planoDeAlertas, relatorioDoRelogio, varrerOPrograma } from '../src/mock/relogio';

/**
 * CLI do relógio do programa (Risco-005, sub-item c).
 *
 * Zero rede. Ele recebe as chaves de alerta **já abertas** como entrada, decide o
 * que falta abrir e imprime o plano; o workflow move os bytes entre
 * `gh issue list`, este arquivo e `gh issue create`. A regra de idempotência mora
 * no módulo, exercitada por teste — num shell do YAML ela não seria executável em
 * casa nem conferível.
 *
 * ## Polaridade
 *
 * Pendência **não** é falha: sai 0 com o plano preenchido. Só varredura quebrada
 * sai diferente de zero, e nesse caso **nenhum plano é emitido** — um plano
 * parcial escrito por uma varredura que morreu no meio faria o workflow abrir
 * alerta sobre um levantamento incompleto, e silenciar o que a varredura não
 * chegou a olhar.
 */

const argumento = (nome: string): string | null => {
  const p = process.argv.slice(2).find((a) => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : null;
};

const bruto = argumento('agora');
const agora = bruto ? new Date(bruto).getTime() : Date.now();
if (!Number.isFinite(agora)) {
  process.stderr.write(`--agora inválido: ${bruto}\n`);
  process.exit(2);
}

const abertas = (argumento('abertos') ?? '')
  .split(/[\s,]+/)
  .map((s) => s.trim())
  .filter(Boolean);

let saida: { relatorio: string; plano: ReturnType<typeof planoDeAlertas> };
try {
  const pendencias = varrerOPrograma(agora);
  const plano = planoDeAlertas(pendencias, abertas);
  saida = { relatorio: relatorioDoRelogio(agora, pendencias, plano), plano };
} catch (e) {
  // O relógio parou. Nenhum plano sai daqui — vermelho aqui significa "não sei
  // se há pendência", e não "há pendência".
  process.stderr.write(`\nO relógio não completou a varredura: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}

process.stdout.write(saida.relatorio);

const destino = argumento('json');
if (destino) {
  writeFileSync(destino, `${JSON.stringify({
    criar: saida.plano.criar.map((p) => ({
      chave: p.chave,
      titulo: `${p.chave} — ${p.titulo}`,
      corpo: corpoDoAlerta(p),
      responsavel: p.responsavel,
    })),
    mantidos: saida.plano.mantidos.map((p) => p.chave),
  }, null, 2)}\n`, 'utf8');
}

const resumo = process.env.GITHUB_STEP_SUMMARY;
if (resumo) writeFileSync(resumo, saida.relatorio, { flag: 'a' });

process.exit(0);
