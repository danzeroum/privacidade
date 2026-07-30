/**
 * O README conferido contra o repositório que ele descreve (Risco-033).
 *
 * ── O defeito ───────────────────────────────────────────────────────────────
 *
 * O README dizia **"Não há CI neste repositório"** e **"26 testes"** em cinco
 * linhas. As duas afirmações já eram falsas no corte da auditoria, e a série de
 * remediação as tornou mais falsas a cada PR: a suíte passou de 26 para mais de
 * 700, e três checks viraram *required* na proteção da `main`.
 *
 * Isso não é documentação desatualizada, é defeito. Um README que nega o próprio
 * repositório manda o leitor tomar decisões sobre um projeto que não existe — e
 * o primeiro leitor de um README é sempre alguém que não pode conferir sozinho.
 *
 * ── Por que catraca, e não "atualizar o texto" ──────────────────────────────
 *
 * Atualizar os números resolveria hoje e reabriria no próximo PR. É o mesmo
 * raciocínio do §7.1: número em documento é dívida — ou um teste o mantém, ou
 * ele mente em silêncio. Aqui há três formas de manter, e cada afirmação usa a
 * que couber:
 *
 *   1. **Transcrição travada** (padrão do `doMapa`) — a lista de telas e a de
 *      workflows são conferidas nos dois sentidos contra `App.tsx` e contra
 *      `.github/workflows`. Tela nova sem linha no README reprova; linha no
 *      README sem tela reprova.
 *   2. **Contagem exata derivada** — tabelas, visões, invariantes e operações do
 *      contrato saem de arquivo versionado, e o número declarado tem de bater.
 *   3. **Piso com ordem de grandeza** — a contagem da suíte é o único número que
 *      vem de execução, e travá-lo no exato faria o README mudar a cada PR que
 *      acrescenta um teste. O declarado é um piso (`700+`), e a catraca cobra
 *      duas coisas: que o piso seja verdadeiro, e que ele não esteja defasado por
 *      uma ordem de grandeza. `26` passa no piso e reprova no teto — que é
 *      exatamente o defeito que este módulo existe para pegar.
 *
 * ── O que o piso NÃO cobre, declarado ───────────────────────────────────────
 *
 * Entre `700` e `1399` a catraca aceita qualquer coisa, inclusive um README que
 * envelheceu um pouco. É a troca deliberada: precisão exata aqui produziria um
 * arquivo que muda a cada PR, e um arquivo que muda a cada PR deixa de ser lido.
 * O que a catraca garante é que ele nunca esteja errado por um fator de dois.
 */

export type Achado = { regra: string; detalhe: string };

export type Tela = { id: string; nome: string };

/**
 * As cinco frases que o Risco-033 nomeia, na letra.
 *
 * Lista fechada e literal de propósito: a catraca de transcrição já cobriria as
 * listas, mas não impediria alguém de reescrever a frase do CI em outro lugar do
 * arquivo. Estas voltam a aparecer, reprova — em qualquer arquivo, em qualquer
 * seção.
 */
export const FRASES_PROIBIDAS = [
  'Não há CI neste repositório',
  '26 testes',
  '8 telas',
  'T1..T8',
  'bundle de 322 kB',
] as const;

export const frasesProibidasEm = (texto: string): string[] =>
  FRASES_PROIBIDAS.filter((f) => texto.includes(f));

/**
 * As telas como `App.tsx` as declara — a fonte, não a cópia.
 *
 * Lê o array `TELAS`, que é o mesmo que monta o trilho de navegação. Uma tela que
 * exista como arquivo mas não esteja no trilho não é alcançável pelo usuário, e
 * por isso o trilho é a definição operante de "as telas do app".
 */
export const telasDeApp = (appTsx: string): Tela[] => {
  const bloco = appTsx.slice(appTsx.indexOf('export const TELAS'));
  const fim = bloco.indexOf('\n];');
  return [...bloco.slice(0, fim).matchAll(/id: '([^']+)', nome: '([^']+)'/g)]
    .map((m) => ({ id: m[1], nome: m[2] }));
};

/** As telas como o README as transcreve, na tabela marcada. */
export const telasDeLeiaMe = (readme: string): Tela[] => {
  const i = readme.indexOf('<!-- telas:inicio -->');
  const f = readme.indexOf('<!-- telas:fim -->');
  if (i < 0 || f < 0) return [];
  return [...readme.slice(i, f).matchAll(/^\| \*\*(T\d+)\*\* \| ([^|]+?) \|/gm)]
    .map((m) => ({ id: m[1], nome: m[2].trim() }));
};

/**
 * Os workflows como o README os transcreve — uma linha por **job**, não por
 * arquivo.
 *
 * A tabela era por arquivo até a coluna "O que sustenta" entrar. Um arquivo com
 * três jobs tem três controles distintos, e agrupá-los numa célula obrigaria a
 * comparar listas dentro de listas — a comparação por linha é a que produz um
 * achado dizendo qual job diverge.
 */
export const workflowsDeLeiaMe = (readme: string): { arquivo: string; job: string; sustenta: string }[] => {
  const i = readme.indexOf('<!-- workflows:inicio -->');
  const f = readme.indexOf('<!-- workflows:fim -->');
  if (i < 0 || f < 0) return [];
  return [...readme.slice(i, f).matchAll(/^\| `([^`]+\.yml)` \| `([^`]+)` \| ([^|]+?) \|/gm)]
    .map((m) => ({ arquivo: m[1], job: m[2], sustenta: m[3].trim() }));
};

/**
 * Um número declarado no README, marcado por rótulo.
 *
 * A marca é `<!-- n:rotulo -->` imediatamente antes do número em negrito. Marcar
 * em vez de casar por vizinhança de palavra é o que impede a catraca de conferir
 * o número errado quando a frase for reescrita — e reescrever a frase é a coisa
 * mais provável de acontecer com um README.
 */
export const numeroDeclarado = (readme: string, rotulo: string): { valor: number; piso: boolean } | null => {
  const m = readme.match(new RegExp(`<!-- n:${rotulo} -->\\*\\*([\\d.]+)(\\+?)\\*\\*`));
  if (!m) return null;
  return { valor: Number(m[1].replace(/\./g, '')), piso: m[2] === '+' };
};

/**
 * Quantas vezes o piso o valor real pode ser antes de o piso estar defasado.
 *
 * Declarado **aqui e em nenhum outro lugar**, e é a correção de um defeito da
 * primeira versão deste módulo: o teto era `piso * 2`, com o `2` escrito à mão
 * dentro de `pisoHonesto`. Um número literal solto no meio da regra é a mesma
 * classe das cinco frases que este arquivo existe para remover — a diferença é
 * só que estava em código em vez de em prosa, e código não é lido por quem
 * confere o README.
 *
 * O README não repete este número: quem quiser a faixa exata lê o módulo. Repetir
 * seria criar a segunda cópia que a constante acabou de eliminar.
 */
export const FATOR_DO_TETO = 2;

/** O teto derivado do piso — a única forma de obtê-lo. */
export const tetoDoPiso = (piso: number): number => piso * FATOR_DO_TETO;

/**
 * O piso é verdadeiro **e** não está defasado por uma ordem de grandeza.
 *
 * As duas metades importam. Só o piso deixaria `1` passar para sempre; só o teto
 * deixaria um piso mentiroso passar enquanto estivesse perto. `26` contra 706
 * passa na primeira e reprova na segunda.
 */
export const pisoHonesto = (piso: number, real: number): boolean =>
  real >= piso && real < tetoDoPiso(piso);

/**
 * Um achado por divergência, com o que confrontar.
 *
 * `esperado`/`obtido` entram no detalhe porque um achado que diz "a lista
 * divergiu" manda o leitor procurar; um que diz qual item sobra ou falta manda
 * corrigir.
 */
const conjunto = (regra: string, esperado: string[], obtido: string[]): Achado[] => {
  const faltam = esperado.filter((x) => !obtido.includes(x));
  const sobram = obtido.filter((x) => !esperado.includes(x));
  const achados: Achado[] = [];
  if (faltam.length) achados.push({ regra, detalhe: `ausente(s) do README: ${faltam.join(', ')}` });
  if (sobram.length) achados.push({ regra, detalhe: `no README e não no repositório: ${sobram.join(', ')}` });
  return achados;
};

export const avaliarLeiaMe = (entrada: {
  readme: string;
  outrosTextos: { arquivo: string; texto: string }[];
  telas: Tela[];
  workflows: { arquivo: string; job: string; sustenta: string | null }[];
  contagens: { rotulo: string; real: number }[];
}): Achado[] => {
  const achados: Achado[] = [];

  for (const { arquivo, texto } of [{ arquivo: 'README.md', texto: entrada.readme }, ...entrada.outrosTextos]) {
    for (const frase of frasesProibidasEm(texto)) {
      achados.push({ regra: 'frase-do-risco-033', detalhe: `${arquivo}: "${frase}"` });
    }
  }

  achados.push(...conjunto(
    'telas',
    entrada.telas.map((t) => `${t.id} · ${t.nome}`),
    telasDeLeiaMe(entrada.readme).map((t) => `${t.id} · ${t.nome}`),
  ));

  // O `sustenta` entra na chave da comparação, e não numa checagem à parte: um
  // job cujo controle foi reescrito no YAML e não no README é a mesma divergência
  // que um job ausente, e merece o mesmo achado.
  for (const w of entrada.workflows) {
    if (w.sustenta === null) {
      achados.push({ regra: 'job-sem-sustenta', detalhe: `${w.arquivo} · ${w.job}: sem \`# sustenta:\` no YAML` });
    }
  }
  const chave = (w: { arquivo: string; job: string; sustenta: string | null }) =>
    `${w.arquivo} · ${w.job} · ${w.sustenta ?? '(sem sustenta)'}`;
  achados.push(...conjunto(
    'workflows',
    entrada.workflows.map(chave),
    workflowsDeLeiaMe(entrada.readme).map(chave),
  ));

  for (const { rotulo, real } of entrada.contagens) {
    const d = numeroDeclarado(entrada.readme, rotulo);
    if (!d) {
      achados.push({ regra: 'numero-sem-marca', detalhe: `${rotulo}: sem <!-- n:${rotulo} --> no README` });
      continue;
    }
    if (d.piso) {
      if (!pisoHonesto(d.valor, real)) {
        achados.push({
          regra: 'piso-desonesto',
          detalhe: `${rotulo}: declarado ${d.valor}+, real ${real} — fora de [${d.valor}, ${d.valor * 2})`,
        });
      }
    } else if (d.valor !== real) {
      achados.push({ regra: 'numero-divergente', detalhe: `${rotulo}: declarado ${d.valor}, real ${real}` });
    }
  }

  return achados;
};

export const relatorioDoLeiaMe = (achados: Achado[]): string =>
  achados.map((a) => `  ${a.regra}: ${a.detalhe}`).join('\n');
