import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { relatorioDeEquidade, rodarEquidade } from '../src/lib/equidade';

/**
 * CLI do teste de disparidade (Risco-007).
 *
 * A raiz é o repositório, não `app/`: o contrato vive em `.privacy/` e a massa
 * ao lado dele. O código de saída é a única coisa que este arquivo decide — a
 * regra mora no módulo, que os testes exercitam nos dois sentidos.
 *
 * O leitor devolve `null` em vez de lançar. Não é conveniência: é o que faz
 * "arquivo ausente" chegar ao módulo como **achado que reprova** em vez de
 * exceção que aborta antes do relatório. Exceção não imprime a natureza da
 * medição, e é a natureza que impede o verde de ser lido como afirmação sobre o
 * modelo.
 */
const raiz = resolve(process.argv[2] ?? '..');

const ler = (relativo: string): string | null => {
  // Caminho absoluto ou que escape da raiz é recusado como ilegível: o contrato
  // aponta para arquivos do repositório, e um `../../etc` ali não é caminho, é
  // pedido.
  if (isAbsolute(relativo) || relativo.split(/[\\/]/).includes('..')) return null;
  const abs = join(raiz, relativo);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
};

const resultado = rodarEquidade(ler);

process.stdout.write(relatorioDeEquidade(resultado));
process.exit(resultado.aprovado ? 0 : 1);
