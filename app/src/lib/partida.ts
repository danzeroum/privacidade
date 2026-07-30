/**
 * A partida local: o que rodar, em que ordem, e o que a falha de cada passo
 * significa.
 *
 * O passo a passo existia como prosa — seis blocos para colar no terminal, na
 * ordem certa, com a explicação do que cada vermelho quer dizer. Prosa não tem
 * ordem obrigatória: quem cola o quarto bloco antes do segundo descobre o
 * problema pelo erro, e quem pula o gate descobre pelo CI.
 *
 * ## Por que a decisão mora aqui e não no CLI
 *
 * Igual a `gate.ts` e `catraca.ts`: o `scripts/start.ts` só gasta processo e
 * decide código de saída. Toda a escolha — quais passos entram, em que ordem,
 * qual falha para tudo e qual segue com aviso — é função pura de duas entradas,
 * as opções e os fatos do ambiente. É o que permite provar a ordem sem subir
 * servidor nenhum, e provar que `--rapido` não desliga a catraca quando o alvo
 * é justamente o artefato de produção.
 *
 * ## Os comandos são literais, e isso é regra
 *
 * Nenhum fato do ambiente entra numa string de comando — o nome do ramo aparece
 * em aviso, nunca em linha executada. Um plano que interpolasse `ramo` daria a
 * um nome de ramo poder sobre um shell (`shell: true` no CLI), e o teste da
 * suíte varre o produto cartesiano de opções e fatos justamente para segurar
 * isso.
 */

export type ChaveDePasso = 'git' | 'instalar' | 'testes' | 'gate' | 'catraca' | 'servidor';

export interface Passo {
  readonly chave: ChaveDePasso;
  readonly titulo: string;
  /** Linhas executadas em ordem; a primeira que falhar encerra o passo. */
  readonly comandos: readonly string[];
  /** `repositorio` é a raiz (o git e o gate olham o repositório inteiro). */
  readonly ondeRodar: 'app' | 'repositorio';
  /** `false` = a falha vira aviso e a partida continua. */
  readonly fatal: boolean;
  /** O que a reprovação deste passo quer dizer — não "o comando falhou". */
  readonly seFalhar: string;
  readonly aviso?: string;
}

export interface Opcoes {
  readonly rapido: boolean;
  readonly semGit: boolean;
  readonly semNavegador: boolean;
  readonly producao: boolean;
  readonly ajuda: boolean;
}

export interface Fatos {
  readonly ehRepositorio: boolean;
  /** Ramo atual; `''` quando indeterminado. Nunca entra num comando. */
  readonly ramo: string;
  readonly arvoreSuja: boolean;
  readonly dependenciasDesatualizadas: boolean;
}

export const OPCOES_PADRAO: Opcoes = {
  rapido: false,
  semGit: false,
  semNavegador: false,
  producao: false,
  ajuda: false,
};

interface Bandeira {
  readonly campo: keyof Opcoes;
  readonly alias?: string;
  readonly ajuda: string;
}

/**
 * Uma fonte só para o parser e para o texto de ajuda.
 *
 * Duas listas divergiriam na primeira bandeira nova, e a ajuda mentiria sobre o
 * que o script aceita — que é o tipo de defeito que ninguém abre issue para
 * relatar.
 */
export const BANDEIRAS: Readonly<Record<string, Bandeira>> = {
  '--rapido': {
    campo: 'rapido',
    ajuda: 'sobe direto: sem git, sem testes, sem gate, sem catraca',
  },
  '--sem-git': {
    campo: 'semGit',
    ajuda: 'não toca no git — para trabalhar offline ou em ramo próprio',
  },
  '--sem-navegador': {
    campo: 'semNavegador',
    ajuda: 'não abre o navegador; o endereço sai impresso',
  },
  '--producao': {
    campo: 'producao',
    ajuda: 'serve o artefato de produção em vez do console de demonstração',
  },
  '--ajuda': { campo: 'ajuda', alias: '--help', ajuda: 'mostra este texto' },
};

export type Leitura = { readonly ok: true; readonly opcoes: Opcoes } | { readonly ok: false; readonly erro: string };

export const interpretarArgumentos = (argv: readonly string[]): Leitura => {
  const opcoes: Record<string, boolean> = { ...OPCOES_PADRAO };
  for (const bruto of argv) {
    const arg = bruto.trim();
    if (arg === '') continue;
    const encontrada = Object.entries(BANDEIRAS).find(([nome, b]) => nome === arg || b.alias === arg);
    // Recusar em vez de ignorar: `--sem-teste` no singular ignorado em silêncio
    // roda a suíte inteira e faz a pessoa concluir que a bandeira não funciona.
    if (!encontrada) return { ok: false, erro: `opção desconhecida: ${arg}` };
    opcoes[encontrada[1].campo] = true;
  }
  return { ok: true, opcoes: opcoes as unknown as Opcoes };
};

export const textoDeAjuda = (): string => {
  const largura = Math.max(...Object.entries(BANDEIRAS).map(([n, b]) => (b.alias ? `${n}, ${b.alias}` : n).length));
  const linhas = Object.entries(BANDEIRAS).map(([nome, b]) => {
    const rotulo = b.alias ? `${nome}, ${b.alias}` : nome;
    return `  ${rotulo.padEnd(largura)}  ${b.ajuda}`;
  });
  return [
    'npm start -- [opções]',
    '',
    'Atualiza a main, instala se o lock mudou, roda os três checks que o CI',
    'cobra e sobe o servidor com o navegador aberto.',
    '',
    ...linhas,
    '',
  ].join('\n');
};

/**
 * `npm ci` custa minuto e apaga `node_modules`: só quando o lock andou.
 *
 * O sinal é o que o próprio npm escreve — `node_modules/.package-lock.json`, a
 * cópia do lock no momento da instalação. Comparar com o `package-lock.json` do
 * repositório responde exatamente "instalei este lock?".
 *
 * Igualdade conta como instalado. Um `>=` reinstalaria a cada partida, e o
 * script viraria o que se pula.
 */
export const dependenciasDesatualizadas = (
  instalado: { readonly existe: boolean; readonly mtimeDoLockInstalado: number | null },
  mtimeDoLock: number | null,
): boolean => {
  if (!instalado.existe) return true;
  if (mtimeDoLock === null) return false; // sem lock não há o que comparar
  if (instalado.mtimeDoLockInstalado === null) return true;
  return mtimeDoLock > instalado.mtimeDoLockInstalado;
};

/**
 * O ambiente que os filhos recebem — e o que **não** recebem.
 *
 * Este é o defeito que a primeira versão deste módulo tinha, medido: o mesmo
 * `npm run catraca:producao` produzia `index-DHE84t5H.js` com 144 kB no terminal
 * e `index-Bh9DQDmL.js` com 330 kB quando disparado pela partida. O `vite-node`
 * que roda o CLI define `NODE_ENV` no processo pai, o filho herdava, e o Vite
 * respeita `NODE_ENV` já definido — então o build de produção embutia o React de
 * desenvolvimento.
 *
 * O tamanho é o sintoma; o problema é outro: um lançador que altera o artefato
 * faz a catraca aprovar um arquivo que não é o que se publica. Verificar coisa
 * diferente da que envia é o mesmo que não verificar.
 *
 * `VITE_*` sai pela razão gêmea: um `VITE_PERFIL` exportado no terminal venceria
 * o `.env.producao` e escolheria o perfil por trás do `--mode`. O perfil é
 * decidido pelo modo do build, não pelo shell de quem chamou.
 */
export const ambienteParaFilho = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(env)) {
    if (valor === undefined) continue;
    if (chave === 'NODE_ENV' || chave.startsWith('VITE_')) continue;
    saida[chave] = valor;
  }
  return saida;
};

const RAMO_PRINCIPAL = 'main';

const passoDeGit = (fatos: Fatos): Passo | null => {
  if (!fatos.ehRepositorio) return null;

  // O `--prune` derruba referências de ramos que já não existem no remoto —
  // inclusive os da série, apagados depois do merge.
  const comandos = ['git fetch --prune origin'];
  let aviso: string | undefined;

  if (fatos.arvoreSuja) {
    aviso = 'árvore com alteração local: busquei do remoto e não puxei, porque um pull sobre árvore suja para no meio do caminho';
  } else if (fatos.ramo !== RAMO_PRINCIPAL) {
    aviso = `você está em "${fatos.ramo || '(indeterminado)'}", não em ${RAMO_PRINCIPAL}: puxar a ${RAMO_PRINCIPAL} aqui misturaria histórico de outro ramo`;
  } else {
    // `--ff-only` recusa em vez de criar merge silencioso: se a main local tem
    // commit próprio, isso é decisão de quem trabalha, não do script de partida.
    comandos.push('git pull --ff-only origin main');
  }

  return {
    chave: 'git',
    titulo: 'atualizando a main',
    comandos,
    ondeRodar: 'repositorio',
    // Sem rede o fetch falha, e ficar sem rede não é motivo para não abrir o
    // protótipo. O aviso registra que o código pode estar velho.
    fatal: false,
    seFalhar: 'não consegui falar com o remoto — o que roda a seguir é o código que já está no disco',
    ...(aviso ? { aviso } : {}),
  };
};

/**
 * O plano, inteiro, em função das opções e dos fatos.
 *
 * A ordem não é estética. Instalar depois de puxar, porque o pull pode trazer
 * lock novo. Os três checks antes do servidor, porque o servidor bloqueia — um
 * check depois dele nunca rodaria. E a catraca por último entre os checks,
 * porque ela constrói o artefato e é a mais cara.
 */
export const planoDePartida = (opcoes: Opcoes, fatos: Fatos): readonly Passo[] => {
  if (opcoes.ajuda) return [];

  const passos: Passo[] = [];

  if (!opcoes.semGit && !opcoes.rapido) {
    const git = passoDeGit(fatos);
    if (git) passos.push(git);
  }

  if (fatos.dependenciasDesatualizadas) {
    passos.push({
      chave: 'instalar',
      titulo: 'instalando dependências (o lock andou)',
      comandos: ['npm ci'],
      ondeRodar: 'app',
      fatal: true,
      seFalhar: 'sem dependências instaladas nada mais roda; se o lock estiver fora de sincronia com o package.json, `npm install` reescreve o lock',
    });
  }

  if (!opcoes.rapido) {
    passos.push({
      chave: 'testes',
      titulo: 'a suíte',
      comandos: ['npm test'],
      ondeRodar: 'app',
      fatal: true,
      seFalhar: 'a suíte é onde as regras da LGPD viram comportamento provado; vermelho aqui é regra quebrada, não teste chato',
    });
    passos.push({
      chave: 'gate',
      titulo: 'gate de privacidade',
      comandos: ['npm run gate:privacidade'],
      ondeRodar: 'app',
      fatal: true,
      seFalhar: 'achado de PII fora do inventário .privacy/pii-sintetica.yaml — declare no inventário ou tire o dado, e não desligue a regra',
    });
  }

  // A catraca sobrevive ao `--rapido` quando o alvo é o próprio artefato de
  // produção: `--producao` sem ela serviria o build de ontem e chamaria isso de
  // prova.
  if (!opcoes.rapido || opcoes.producao) {
    passos.push({
      chave: 'catraca',
      titulo: 'catraca de produção (RIPD §7.3)',
      comandos: ['npm run catraca:producao'],
      ondeRodar: 'app',
      fatal: true,
      seFalhar: 'o artefato de produção carrega algo que as quatro premissas de aceite proíbem: modo demonstração, rota de forja, papel por botão ou PII sintética',
    });
  }

  // O `--` não é enfeite: `npm run dev --open` liga uma configuração do npm e
  // não chega ao Vite. Quem escreve sem ele vê o servidor subir e o navegador
  // não abrir, e conclui que a bandeira do Vite está quebrada.
  const abrir = opcoes.semNavegador ? '' : ' --open';
  passos.push(
    opcoes.producao
      ? {
          chave: 'servidor',
          titulo: 'servindo o artefato de produção — a tela é a recusa, de propósito',
          comandos: [`npm run preview -- --outDir dist-producao${abrir}`],
          ondeRodar: 'app',
          fatal: false,
          seFalhar: 'o servidor de pré-visualização encerrou',
        }
      : {
          chave: 'servidor',
          titulo: 'subindo o console de demonstração',
          comandos: [abrir ? `npm run dev --${abrir}` : 'npm run dev'],
          ondeRodar: 'app',
          fatal: false,
          seFalhar: 'o servidor de desenvolvimento encerrou',
        },
  );

  return passos;
};
