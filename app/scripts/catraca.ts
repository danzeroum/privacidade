import { resolve } from 'node:path';
import { relatorioDaCatraca, rodarCatraca } from '../src/lib/catraca-producao';

/**
 * CLI da catraca das premissas de aceite (RIPD §7.3).
 *
 * Roda **sobre o artefato**, não sobre o fonte: as quatro premissas falam do que
 * é publicado, e a única prova disso é o que saiu do build. O código de saída é
 * a única coisa que este arquivo decide — as regras moram no módulo, que os
 * testes exercitam nos dois sentidos.
 */
const dist = resolve(process.argv[2] ?? 'dist-producao');
const inventario = resolve(process.argv[3] ?? '../.privacy/pii-sintetica.yaml');

const resultado = rodarCatraca(dist, inventario);
process.stdout.write(relatorioDaCatraca(resultado));
process.exit(resultado.aprovado ? 0 : 1);
