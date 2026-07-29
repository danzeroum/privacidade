import { resolve } from 'node:path';
import { relatorio, rodarGate } from '../src/lib/gate-privacidade';

/**
 * CLI do gate de privacidade.
 *
 * A raiz é o repositório inteiro, não `app/`: o gate olha o que o repositório
 * publica, e o protótipo é só uma parte dele. O código de saída é a única coisa
 * que este arquivo decide — a regra mora no módulo, que os testes exercitam.
 */
const raiz = resolve(process.argv[2] ?? '..');
const resultado = rodarGate(raiz);

process.stdout.write(relatorio(resultado));
process.exit(resultado.aprovado ? 0 : 1);
