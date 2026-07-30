/**
 * Todo job ou roda em Windows, ou diz por que não.
 *
 * ── O defeito que isto fecha ────────────────────────────────────────────────
 *
 * O CI era Ubuntu, e dois defeitos de plataforma atravessaram a série inteira
 * com a suíte declarando verde: um `VITE_PERFIL=producao vite build` que cmd.exe
 * não entende, e um leitor de CSV que quebrava com CRLF. A matriz é a terceira
 * camada contra essa classe — depois do leitor e do `.gitattributes`.
 *
 * O risco da matriz é o oposto do risco que ela fecha: um job novo entra sem
 * `windows-latest` e ninguém percebe, e a cobertura volta a ser parcial sem que
 * nada fique vermelho. É o Risco-003 outra vez — aprovar por não ter olhado.
 *
 * ── Por que "declara o motivo" e não "está na lista de exceções" ────────────
 *
 * Lista de exceções separada envelhece longe do que ela excetua. O marcador mora
 * **no job**, três linhas acima do `runs-on` que ele explica, e é o mesmo padrão
 * do relógio: o que não pode ser marcado como required diz isso no próprio YAML,
 * não num documento paralelo.
 *
 * E o motivo tem corpo exigido porque `# fora-da-matriz: n/a` seria a exceção sem
 * registro que este repositório recusa — mesma regra da exceção de `npm audit`,
 * que tem validade e motivo ou não vale.
 *
 * ── Nem "não roda em Windows" nem "não quisemos" ────────────────────────────
 *
 * Quatro jobs ficam de fora por dois motivos diferentes, e a diferença é medível:
 *
 *   - **físicos** — `Schema` sobe service container de Postgres (Linux) e instala
 *     o cliente com `apt-get`; `Varreduras de prazo` tem passos em bash com `gh` e
 *     `jq`, e nem é check de PR.
 *   - **semânticos** — gitleaks e CodeQL *rodam* em Windows. Medido:
 *     `gitleaks-action@v2` é `using: node20` e trata `win32` explicitamente. Os
 *     dois leem o mesmo fonte e os mesmos blobs do git, então dariam a mesma
 *     resposta duas vezes; e dois uploads de SARIF na mesma categoria colidem.
 *
 * Escrever "não roda em Windows" para os dois últimos seria mentira medível, e o
 * motivo declarado é conferível justamente por ser específico.
 */

export type Job = {
  /** A chave do job no YAML — o que aparece no erro, para o achado ser acionável. */
  id: string;
  /** O `name:` como está escrito, com a expressão do sufixo ainda dentro. */
  nomeBruto: string | null;
  /** O nome do check no leg base, com a expressão removida. */
  nome: string | null;
  /** O bloco declara `os: windows-latest` na matriz? */
  naMatriz: boolean;
  /** Texto do `# fora-da-matriz:`, já juntado com as linhas de comentário seguintes. */
  motivo: string | null;
  /**
   * Texto do `# sustenta:` — o controle que este job mantém de pé.
   *
   * Uma linha só, e não a continuação de comentário que o `motivo` aceita: aqui
   * o texto vai para uma célula de tabela no README, e célula que engolisse as
   * linhas seguintes traria junto o `fora-da-matriz` que costuma vir logo abaixo.
   */
  sustenta: string | null;
};

export type Achado = {
  arquivo: string;
  job: string;
  regra: 'sem-windows-e-sem-motivo' | 'motivo-sem-corpo' | 'na-matriz-e-com-motivo';
  detalhe: string;
};

/** Um motivo mais curto que isto é rótulo, não explicação. */
export const MINIMO_DO_MOTIVO = 60;

/**
 * O nome do check no leg base, ou `null` quando ele não é estático.
 *
 * **Só** `matrix.sufixo` é removido, e a razão é que só ele foi declarado vazio
 * no leg base do `include`. `Tipos e testes${{ matrix.sufixo }}` é o check
 * `Tipos e testes` — o nome já marcado como required, e o que não pode mudar.
 *
 * Qualquer outra expressão devolve `null`, mesmo que fosse "óbvio" o que ela
 * resolve. A primeira versão disto apagava `${{ … }}` inteiro, e a injeção que
 * trocava o `name` por `Tipos e testes ${{ matrix.os }}` **passou**: o nome real
 * no leg base seria `Tipos e testes ubuntu-latest`, e a catraca de checks citados
 * afirmava que o check existia porque a remoção cega tinha reconstruído o nome
 * antigo. Aprovar por não ter olhado, no lugar exato que existe para olhar.
 *
 * `null` propaga como "este job não oferece nome de check", e é o que faz a
 * citação da tabela reprovar em vez de encontrar um nome que ninguém publica.
 */
const SUFIXO_DECLARADO_VAZIO = /\$\{\{\s*matrix\.sufixo\s*\}\}/g;

export const nomeDeCheck = (nomeBruto: string): string | null => {
  const semSufixo = nomeBruto.replace(SUFIXO_DECLARADO_VAZIO, '');
  if (semSufixo.includes('${{')) return null;
  const nome = semSufixo.trim();
  return nome.length > 0 ? nome : null;
};

/**
 * Fatia o YAML em jobs.
 *
 * Leitor de indentação, e não parser de YAML: a dependência de um parser aqui
 * traria a árvore inteira e perderia os comentários — e o marcador é comentário,
 * de propósito, para não virar chave que o GitHub Actions rejeitaria como campo
 * desconhecido.
 */
export const jobsDe = (yml: string): Job[] => {
  const linhas = yml.split(/\r?\n/);
  const inicioDosJobs = linhas.findIndex((l) => /^jobs:\s*$/.test(l));
  if (inicioDosJobs < 0) return [];

  const jobs: Job[] = [];
  let atual: string[] = [];
  let id = '';

  const fechar = () => {
    if (!id) return;
    const bloco = atual.join('\n');
    const nomeBruto = bloco.match(/^\s{4}name:\s*(.+?)\s*$/m)?.[1] ?? null;

    // Comentário do marcador: a primeira linha traz o texto depois dos dois
    // pontos, e as linhas de comentário imediatamente seguintes continuam a
    // frase. Para no primeiro não-comentário — normalmente o `runs-on` que ele
    // explica.
    let motivo: string | null = null;
    for (let i = 0; i < atual.length; i += 1) {
      const m = atual[i].match(/^\s*#\s*fora-da-matriz:\s*(.*)$/);
      if (!m) continue;
      const partes = [m[1].trim()];
      for (let j = i + 1; j < atual.length; j += 1) {
        const c = atual[j].match(/^\s*#\s?(.*)$/);
        if (!c) break;
        partes.push(c[1].trim());
      }
      motivo = partes.join(' ').trim();
      break;
    }

    // Comentário fora antes de procurar `windows-latest`: o motivo declarado
    // nomeia a plataforma que o job **não** roda, e contá-lo como matriz faria
    // todo job excluído passar por estar excluído. A catraca leria a própria
    // justificativa como prova do contrário dela.
    const semComentario = atual.filter((l) => !/^\s*#/.test(l)).join('\n');

    jobs.push({
      id,
      sustenta: atual.map((l) => l.match(/^\s*#\s*sustenta:\s*(.+)$/)).find(Boolean)?.[1].trim() ?? null,
      nomeBruto,
      nome: nomeBruto ? nomeDeCheck(nomeBruto) : null,
      naMatriz: /windows-latest/.test(semComentario),
      motivo,
    });
    atual = [];
    id = '';
  };

  for (const linha of linhas.slice(inicioDosJobs + 1)) {
    const chave = linha.match(/^ {2}([A-Za-z_][\w-]*):\s*$/);
    if (chave) {
      fechar();
      id = chave[1];
      continue;
    }
    if (id) atual.push(linha);
  }
  fechar();
  return jobs;
};

/**
 * Exatamente uma condição verdadeira por job.
 *
 * As três regras são separadas de propósito. "Sem os dois" é o job novo que
 * ninguém classificou. "Motivo sem corpo" é a exceção sem registro. "Os dois" é
 * um YAML que se contradiz — um job na matriz com um comentário dizendo por que
 * não está nela é um comentário que vai sobreviver à mudança e mentir depois.
 */
export const avaliarMatriz = (arquivos: { arquivo: string; yml: string }[]): Achado[] => {
  const achados: Achado[] = [];
  for (const { arquivo, yml } of arquivos) {
    for (const job of jobsDe(yml)) {
      const temMotivo = job.motivo !== null;
      if (job.naMatriz && temMotivo) {
        achados.push({
          arquivo, job: job.id, regra: 'na-matriz-e-com-motivo',
          detalhe: 'o job roda em windows-latest E declara motivo para não rodar — um dos dois está errado',
        });
        continue;
      }
      if (!job.naMatriz && !temMotivo) {
        achados.push({
          arquivo, job: job.id, regra: 'sem-windows-e-sem-motivo',
          detalhe: 'nem entra na matriz nem declara `# fora-da-matriz: <motivo>` acima do runs-on',
        });
        continue;
      }
      if (temMotivo && job.motivo!.length < MINIMO_DO_MOTIVO) {
        achados.push({
          arquivo, job: job.id, regra: 'motivo-sem-corpo',
          detalhe: `motivo com ${job.motivo!.length} caracteres; o mínimo é ${MINIMO_DO_MOTIVO}`,
        });
      }
    }
  }
  return achados;
};

/** Uma linha por achado, com arquivo e job — conferível à mão por quem lê o diff. */
export const relatorioDaMatriz = (achados: Achado[]): string =>
  achados.map((a) => `  ${a.arquivo} · ${a.job} · ${a.regra}: ${a.detalhe}`).join('\n');
