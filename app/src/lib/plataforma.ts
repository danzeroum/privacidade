/**
 * O que muda entre POSIX e Windows, num lugar só.
 *
 * ── Por que este arquivo existe ─────────────────────────────────────────────
 *
 * `npm` e `npx` não são executáveis em Windows: são `npm.cmd` e `npx.cmd`. Um
 * `spawn('npm', …)` lá não encontra nada, e desde o Node 18.20.2/20.12.2
 * (CVE-2024-27980) o próprio Node **recusa** executar `.cmd` sem `shell: true`
 * em vez de tentar — o que antes era ENOENT hoje é exceção explícita. Nos dois
 * casos o processo não roda, e quem chamou recebe um resultado vazio que é fácil
 * confundir com "a ferramenta não achou nada".
 *
 * O repositório tinha quatro chamadas assim: uma em código de produção
 * (`scripts/audit.ts`, o `npm audit` que alimenta a política de vulnerabilidade)
 * e três em teste. Nenhuma foi cobrada, porque o CI era Ubuntu — a mesma causa
 * raiz que deixou passar os dois defeitos de plataforma do #36.
 *
 * A resposta mora aqui, e não em cada chamada, pela razão de sempre nesta série:
 * quatro cópias de uma decisão são quatro chances de divergir, e a quinta chamada
 * nasceria sem nenhuma delas.
 *
 * ── O que este módulo NÃO resolve, declarado em vez de escondido ────────────
 *
 * Com `shell: true` o Windows **remonta** a linha de comando a partir dos
 * argumentos, e argumento com espaço (ou com `&`, `|`, `>`) se parte ao meio ou
 * vira outro comando. `argumentoSeguroParaShell` é o que separa "não tem espaço"
 * de "não olhei": quem passa caminho de `tmpdir()` confere antes, e um tmpdir com
 * espaço reprova em vez de virar argumento truncado.
 *
 * A alternativa seria citar os argumentos aqui dentro — e citar para `cmd.exe` e
 * para `/bin/sh` são regras diferentes, com precedência de aspas diferente. Uma
 * checagem que reprova é honesta; um escapador caseiro que quase funciona é a
 * forma de defeito que este repositório passou seis PRs removendo.
 */

/**
 * A ferramenta precisa de shell para ser encontrada nesta plataforma?
 *
 * Recebe a plataforma como parâmetro em vez de ler `process.platform`: é o que
 * permite ao teste exercer os dois lados no mesmo processo, em vez de provar
 * apenas o lado em que ele está rodando.
 */
export const precisaDeShell = (plataforma: string): boolean => plataforma === 'win32';

/**
 * O argumento sobrevive à remontagem da linha de comando?
 *
 * Lista fechada de caracteres que separam ou redirecionam em `cmd.exe`, em
 * PowerShell ou em `sh`. A união dos três, e não a interseção: o mesmo argumento
 * atravessa as três plataformas, e passar no mais permissivo não é passar.
 */
export const argumentoSeguroParaShell = (valor: string): boolean =>
  valor.length > 0 && !/[\s"'`&|<>^()$;]/.test(valor);
