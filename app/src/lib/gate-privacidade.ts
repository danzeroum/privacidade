import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from 'yaml';
import { vereditoPbd } from '../mock/pbd';
import type { MarcacaoPbd } from '../mock/pbd';

/**
 * O gate de privacidade em CI (PR 11) — o que o C-18 prometeu para depois.
 *
 * O gate mínimo (`ci.yml`) prova que compila e que as nove regras passam. Este
 * prova outra coisa: que **este repositório** não está publicando dado pessoal
 * nem tratando campo que o inventário desconhece.
 *
 * A regra que separa este gate de um linter de texto: **ele barra por
 * evidência**. Não procura a palavra "privacidade" no PR, não conta linhas de
 * documentação e não confia em marcação. Procura CPF em arquivo de log, campo
 * fora do catálogo declarado e princípio de PbD marcado sem nada apontado. As
 * três coisas são verificáveis por quem lê o diff, que é o teste de um gate
 * honesto: se a reprovação não pode ser conferida à mão, ela é opinião.
 *
 * Falha fechada em três lugares, e vale nomeá-los porque é onde um gate costuma
 * mentir: repositório sem `.privacy/` **reprova** em vez de passar por omissão;
 * inventário ilegível reprova em vez de virar lista vazia; e evidência de PbD
 * que aponta para arquivo inexistente reprova como se não existisse — porque
 * não existe.
 *
 * ## PR 4 · o guardião passa a se vigiar (Risco-003)
 *
 * Até aqui a varredura lia **um** arquivo — o log de exemplo — e imprimia
 * "nenhum achado" enquanto 45 CPFs formatados viviam em 7 arquivos de fonte,
 * teste, SQL, HTML e documentação. O gate não estava errado no que dizia; estava
 * errado no que olhava, que é a forma mais confortável de um controle falhar.
 *
 * Agora a varredura de PII cobre o repositório inteiro, e o que autoriza uma
 * ocorrência é `.privacy/pii-sintetica.yaml` — lista fechada, valor a valor para
 * documento e telefone, por domínio para e-mail. Valor não declarado reprova;
 * valor declarado fora dos caminhos declarados reprova; e declaração que não
 * corresponde mais a nada no repositório também reprova, porque lista que
 * ninguém confere passa a autorizar o que já não está lá.
 *
 * ### Duas varreduras, dois escopos — e não é descuido
 *
 * A regra de **PII** varre tudo. A regra de **campo fora do catálogo** continua
 * só em log, e a medição é o argumento: aplicada ao repositório inteiro ela
 * produz 24.290 achados sobre 2.772 identificadores, porque `campo:` em
 * TypeScript é declaração de variável e não registro escrito. Gate que produz
 * vinte e quatro mil vermelhos é gate desligado pela equipe em duas semanas —
 * que continua sendo o pior desfecho possível.
 */

export type Severidade = 'bloqueia' | 'avisa';

export interface AchadoDoGate {
  regra: string;
  severidade: Severidade;
  arquivo?: string;
  linha?: number;
  mensagem: string;
  /** O que fazer. Achado sem correção é reclamação. */
  comoCorrigir: string;
}

export interface ResultadoDoGate {
  aprovado: boolean;
  achados: AchadoDoGate[];
  /**
   * Quantos arquivos a varredura de PII leu — o repositório inteiro, menos o
   * que está declarado abaixo. Um é o número que o Risco-003 descreve.
   */
  arquivosVarridos: number;
  /** Subconjunto onde a regra de campo fora do catálogo também roda. */
  logsVarridos: number;
  /** Arquivos pulados por serem binários. Pulado em silêncio é buraco. */
  binariosPulados: number;
  /** Diretórios efetivamente encontrados e ignorados, não a lista teórica. */
  diretoriosIgnorados: string[];
}

const DIR_PRIVACIDADE = '.privacy';
const ARQUIVO_PII_SINTETICA = 'pii-sintetica.yaml';

/**
 * Onde um log de exemplo mora, por convenção. A declaração do repositório só
 * **acrescenta** caminhos a esta lista: se pudesse remover, bastaria apagar uma
 * linha do YAML para o gate parar de olhar onde incomoda.
 */
const PADROES_DE_LOG = [/\.log$/, /[/\\]logs?[/\\]/, /[/\\]exemplos?[/\\]/, /[/\\]fixtures?[/\\]/];

const IGNORAR = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', 'build']);

/**
 * Os padrões de dado pessoal procurados no repositório.
 *
 * Conservadores de propósito: cada um casa uma forma que **só** um dado pessoal
 * tem. Um padrão frouxo produz vermelho falso, e gate que cria vermelho falso é
 * desligado pela equipe em duas semanas — que é o pior desfecho possível.
 *
 * `chave` é o que a declaração precisa casar para autorizar a ocorrência. Para
 * documento e telefone é o próprio valor; para e-mail é o domínio, porque o que
 * torna um endereço sintético é o domínio não roteável e não a parte antes do
 * arroba.
 */
const PADROES_PII: {
  tipo: 'cpf' | 'cnpj' | 'email' | 'telefone';
  nome: string; re: RegExp; comoCorrigir: string;
  chave: (encontrado: string) => string;
  rotulo: 'valor' | 'domínio';
}[] = [
  {
    tipo: 'cpf', nome: 'CPF',
    re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
    chave: (v) => v, rotulo: 'valor',
    comoCorrigir: 'Se for dado real, remova. Se for massa sintética, declare o valor em '
      + `${DIR_PRIVACIDADE}/${ARQUIVO_PII_SINTETICA} com o motivo e os caminhos onde pode aparecer. `
      + 'Em log, passe o registro pelo redator antes de escrever (app/src/lib/redator.ts): '
      + 'CPF em log é acesso a dado pessoal sem finalidade declarada (Art. 37).',
  },
  {
    tipo: 'cnpj', nome: 'CNPJ',
    re: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
    chave: (v) => v, rotulo: 'valor',
    comoCorrigir: `Remova, ou declare o valor em ${DIR_PRIVACIDADE}/${ARQUIVO_PII_SINTETICA}. `
      + 'Em log, redija o identificador antes de escrever.',
  },
  {
    tipo: 'email', nome: 'e-mail',
    re: /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,
    // O domínio, em caixa baixa: o mesmo endereço escrito com maiúsculas é a
    // mesma autorização, e tratá-los como dois obrigaria a declarar variantes.
    // (Este comentário não traz um exemplo literal de propósito: escrever um
    // aqui seria e-mail não declarado neste arquivo, e o gate — corretamente —
    // reprovaria a si mesmo. Foi o que ele fez na primeira execução do PR 4.)
    chave: (v) => v.split('@')[1].toLowerCase(), rotulo: 'domínio',
    comoCorrigir: 'Substitua por hash ou máscara — e-mail identifica o titular tão bem quanto o '
      + `documento. Se o domínio for sintético, declare-o em ${DIR_PRIVACIDADE}/${ARQUIVO_PII_SINTETICA}; `
      + 'prefira um TLD reservado pela RFC 2606 (.test, .example, .invalid), que ninguém pode registrar.',
  },
  {
    tipo: 'telefone', nome: 'telefone',
    re: /\(\d{2}\)\s?9?\d{4}-\d{4}\b/g,
    chave: (v) => v, rotulo: 'valor',
    comoCorrigir: 'Substitua por máscara — telefone é dado de contato do titular. Se for massa '
      + `sintética, declare o valor em ${DIR_PRIVACIDADE}/${ARQUIVO_PII_SINTETICA}.`,
  },
];

/**
 * O gate não pode ser o próximo lugar onde o dado aparece em texto claro.
 *
 * O relatório vai para o log do CI, que é um sistema de armazenamento como
 * qualquer outro — e imprimir o CPF encontrado ali seria copiá-lo para fora do
 * repositório justamente na hora de reclamar dele. A máscara preserva o que
 * torna o achado conferível à mão (a forma, os extremos, o arquivo e a linha) e
 * larga o resto.
 */
export function mascarar(valor: string): string {
  if (valor.includes('@')) return `•••@${valor.slice(valor.indexOf('@') + 1)}`;
  const total = (valor.match(/\d/g) ?? []).length;
  let i = -1;
  return [...valor].map((c) => {
    if (!/\d/.test(c)) return c;
    i += 1;
    return i < 3 || i >= total - 2 ? c : '•';
  }).join('');
}

/** Uma entrada do inventário de PII sintética: o valor, por que existe e onde pode aparecer. */
interface DeclaracaoDePii {
  valor?: string;
  dominio?: string;
  motivo?: string;
  onde?: string[];
}

interface PiiSintetica {
  cpf?: DeclaracaoDePii[];
  cnpj?: DeclaracaoDePii[];
  telefone?: DeclaracaoDePii[];
  email?: { dominios?: DeclaracaoDePii[] };
}

/** O que o gate guarda por chave declarada, para cobrar caminho e declaração morta no fim. */
interface Autorizacao {
  tipo: string;
  chave: string;
  onde: string[];
  vista: boolean;
}

/**
 * O caminho declarado cobre este arquivo?
 *
 * Entrada terminada em `/` é prefixo de diretório; o resto é arquivo exato. Não
 * há glob de propósito: `**​/*.ts` autorizaria PII em qualquer TypeScript futuro,
 * e uma autorização que se estende sozinha para arquivos que ainda não existem
 * não é uma lista fechada.
 */
const cobre = (onde: string[], rel: string): boolean =>
  onde.some((o) => {
    const n = String(o).split(sep).join('/').replace(/\/+$/, '');
    return rel === n || rel.startsWith(`${n}/`);
  });

/** Campo escrito num log estruturado: `campo=valor`, `"campo":` ou `campo: valor`. */
const CAMPO_EM_LOG = /(?:^|[\s,{[])"?([a-z][a-z0-9_]{2,})"?\s*[=:]/gi;

/**
 * Palavras que aparecem como chave em log e não são campo de dado pessoal.
 * Lista curta e explícita: cada entrada é uma decisão, não um filtro genérico.
 */
const NAO_SAO_CAMPOS = new Set([
  'level', 'ts', 'time', 'timestamp', 'msg', 'message', 'logger', 'span', 'trace',
  'req', 'status', 'method', 'path', 'duration', 'ms', 'service', 'env', 'version',
  'http', 'https', 'error', 'warn', 'info', 'debug', 'event', 'action', 'result',
  'purpose', 'finalidade', 'ator', 'papel', 'hash', 'protocolo',
]);

interface Inventario {
  repositorio?: string;
  campos?: {
    nome: string; categoria?: string; base_legal?: string;
    /** Versão do texto consentido. Obrigatória quando a base é consentimento. */
    consentimento_versao?: string;
  }[];
  logs?: string[];
}

interface EpicoDeclarado {
  codigo?: string;
  titulo?: string;
  pbd?: { chave: string; marcado?: boolean; evidencia?: string }[];
}

/**
 * Todos os arquivos do repositório, e o que foi deixado de fora.
 *
 * Os ignorados voltam nomeados — e são os efetivamente encontrados, não a lista
 * teórica. Diretório pulado em silêncio é buraco na varredura, e um relatório
 * que diz "95 arquivos" sem dizer o que não olhou é um número sem denominador.
 */
function arquivosDe(
  raiz: string, atual = raiz, acc: string[] = [], ignorados: string[] = [],
): { arquivos: string[]; ignorados: string[] } {
  for (const nome of readdirSync(atual)) {
    const caminho = join(atual, nome);
    if (IGNORAR.has(nome)) {
      ignorados.push(relative(raiz, caminho).split(sep).join('/'));
      continue;
    }
    if (statSync(caminho).isDirectory()) arquivosDe(raiz, caminho, acc, ignorados);
    else acc.push(caminho);
  }
  return { arquivos: acc, ignorados };
}

const ehLog = (rel: string, extras: string[]): boolean => {
  const normal = rel.split(sep).join('/');
  return PADROES_DE_LOG.some((re) => re.test(`/${normal}`))
    || extras.some((glob) => normal.startsWith(glob.replace(/\*+$/, '')));
};

/**
 * Roda o gate sobre um repositório.
 *
 * Devolve o resultado em vez de sair do processo: quem decide o código de saída
 * é o CLI. Assim o mesmo código é exercitado por teste, e o gate deixa de ser
 * aquele arquivo de CI que ninguém consegue rodar em casa.
 */
export function rodarGate(raiz: string): ResultadoDoGate {
  const achados: AchadoDoGate[] = [];
  const dir = join(raiz, DIR_PRIVACIDADE);

  // ── falha fechada: sem declaração, reprova ────────────────────────────────
  if (!existsSync(dir)) {
    return {
      aprovado: false,
      arquivosVarridos: 0, logsVarridos: 0, binariosPulados: 0, diretoriosIgnorados: [],
      achados: [{
        regra: 'declaracao/ausente', severidade: 'bloqueia', arquivo: DIR_PRIVACIDADE,
        mensagem: 'O repositório não declara nada sobre os dados que trata.',
        comoCorrigir: `Crie ${DIR_PRIVACIDADE}/data-inventory.*.yaml com os campos e ${DIR_PRIVACIDADE}/epico.yml `
          + 'com os sete princípios. Ausência de declaração não é ausência de tratamento.',
      }],
    };
  }

  const nomes = readdirSync(dir);
  const arquivoInventario = nomes.find((n) => /^data-inventory\..*\.ya?ml$/.test(n));
  let inventario: Inventario = {};

  if (!arquivoInventario) {
    achados.push({
      regra: 'catalogo/ausente', severidade: 'bloqueia', arquivo: `${DIR_PRIVACIDADE}/`,
      mensagem: 'Nenhum data-inventory.*.yaml no diretório de privacidade.',
      comoCorrigir: 'Declare o inventário. Campo tratado fora do catálogo é campo sem finalidade, base legal nem prazo.',
    });
  } else {
    try {
      inventario = parse(readFileSync(join(dir, arquivoInventario), 'utf8')) ?? {};
    } catch (e) {
      achados.push({
        regra: 'catalogo/ilegivel', severidade: 'bloqueia', arquivo: `${DIR_PRIVACIDADE}/${arquivoInventario}`,
        mensagem: `O inventário não pôde ser lido: ${(e as Error).message}`,
        // Tratar ilegível como vazio faria a varredura de campo passar em silêncio.
        comoCorrigir: 'Corrija o YAML. Inventário ilegível reprova em vez de virar lista vazia.',
      });
    }
  }

  /**
   * Base "consentimento" sem prova versionada reprova o merge.
   *
   * O ROPA pode declarar qualquer base legal, e é justamente por isso que esta
   * precisa de contrapartida: consentimento é a única que depende de um ato de
   * outra pessoa. Declarar consentimento sem apontar a versão do texto aceito é
   * afirmar a vontade de alguém que ninguém consultou — e o gate barra por
   * evidência, citando o campo, como faz com o resto.
   */
  for (const c of inventario.campos ?? []) {
    if (String(c.base_legal) !== 'consentimento') continue;
    if (String(c.consentimento_versao ?? '').trim()) continue;
    achados.push({
      regra: 'catalogo/consentimento-sem-prova', severidade: 'bloqueia',
      arquivo: `${DIR_PRIVACIDADE}/${arquivoInventario}`,
      mensagem: `O campo "${c.nome}" declara base legal "consentimento" sem `
        + 'consentimento_versao: não há texto publicado que prove o aceite.',
      comoCorrigir: 'Publique a versão do texto consentido e declare `consentimento_versao` no campo. '
        + 'Sem ela, a base legal é uma afirmação sobre a vontade de alguém que ninguém consultou (Art. 8º, §1º).',
    });
  }

  const catalogo = new Set((inventario.campos ?? []).map((c) => String(c.nome).toLowerCase()));
  const extras = inventario.logs ?? [];

  // ── inventário de PII sintética: ausente ou ilegível reprova ──────────────
  const caminhoPii = `${DIR_PRIVACIDADE}/${ARQUIVO_PII_SINTETICA}`;
  const autorizacoes = new Map<string, Autorizacao>();
  let inventarioDePiiUtilizavel = false;

  if (!existsSync(join(raiz, caminhoPii))) {
    achados.push({
      regra: 'pii/inventario-ausente', severidade: 'bloqueia', arquivo: caminhoPii,
      mensagem: 'O repositório não declara qual PII sintética publica.',
      comoCorrigir: `Crie ${caminhoPii} com os valores de CPF, CNPJ e telefone e os domínios de `
        + 'e-mail que a massa de demonstração usa, cada um com motivo e caminhos. '
        + 'PII sintética existente é inventário a declarar, não exceção a esconder.',
    });
  } else {
    try {
      const bruto: PiiSintetica = parse(readFileSync(join(raiz, caminhoPii), 'utf8')) ?? {};
      const declaradas: [string, DeclaracaoDePii[]][] = [
        ['cpf', bruto.cpf ?? []], ['cnpj', bruto.cnpj ?? []],
        ['telefone', bruto.telefone ?? []], ['email', bruto.email?.dominios ?? []],
      ];
      for (const [tipo, lista] of declaradas) {
        for (const d of lista) {
          const chave = String(d.dominio ?? d.valor ?? '').toLowerCase().trim();
          if (!chave) continue;
          autorizacoes.set(`${tipo}:${chave}`, {
            tipo, chave, onde: (d.onde ?? []).map(String), vista: false,
          });
        }
      }
      inventarioDePiiUtilizavel = true;
    } catch (e) {
      achados.push({
        regra: 'pii/inventario-ilegivel', severidade: 'bloqueia', arquivo: caminhoPii,
        mensagem: `O inventário de PII sintética não pôde ser lido: ${(e as Error).message}`,
        // Ilegível tratado como vazio faria toda a massa declarada reprovar de
        // uma vez — ruído que ninguém lê — ou, pior, passar por lista vazia.
        comoCorrigir: 'Corrija o YAML. Inventário ilegível reprova em vez de virar lista vazia.',
      });
    }
  }

  // ── varredura ─────────────────────────────────────────────────────────────
  const varredura = arquivosDe(raiz);
  const todos = varredura.arquivos.map((a) => ({ abs: a, rel: relative(raiz, a).split(sep).join('/') }));
  const logs = todos.filter((a) => ehLog(a.rel, extras));
  const ehLogDe = new Set(logs.map((a) => a.rel));
  let binariosPulados = 0;
  let arquivosLidos = 0;

  for (const { abs, rel } of todos) {
    let conteudo: string;
    try {
      conteudo = readFileSync(abs, 'utf8');
    } catch {
      binariosPulados += 1;
      continue;
    }
    // Byte nulo é a marca de arquivo binário lido como texto. Contado, não
    // ignorado: hoje são zero, e no dia em que não forem o número aparece.
    if (conteudo.includes('\0')) {
      binariosPulados += 1;
      continue;
    }
    arquivosLidos += 1;
    const ehOInventario = rel === caminhoPii;
    const ehLogEste = ehLogDe.has(rel);

    conteudo.split('\n').forEach((linha, i) => {
      // ── PII: repositório inteiro ───────────────────────────────────────────
      for (const p of PADROES_PII) {
        for (const encontrado of linha.matchAll(p.re)) {
          const chave = p.chave(encontrado[0]);
          const autorizacao = autorizacoes.get(`${p.tipo}:${chave.toLowerCase()}`);

          if (!autorizacao) {
            // Sem inventário utilizável, apontar cada ocorrência afogaria o
            // achado que importa — que é a ausência do inventário, já listada.
            if (!inventarioDePiiUtilizavel) continue;
            achados.push({
              regra: `pii/${p.tipo}`, severidade: 'bloqueia', arquivo: rel, linha: i + 1,
              mensagem: `${p.nome} em texto claro, ${p.rotulo} não declarado: ${mascarar(encontrado[0])}`
                + `${ehLogEste ? ' — e isto é um log publicado.' : '.'}`,
              comoCorrigir: p.comoCorrigir,
            });
            continue;
          }

          // O inventário é caminho implícito do que declara: não há como
          // declarar um valor sem escrevê-lo. Não é exceção escondida — é a
          // única forma de a lista existir, e ela está inteira no diff.
          //
          // E a ocorrência dentro dele **não conta como uso**: se contasse, toda
          // declaração se provaria viva por existir, e a regra de declaração
          // morta seria uma regra que nunca dispara. Um valor está vivo quando
          // aparece no repositório, não quando aparece na lista que o autoriza.
          if (ehOInventario) continue;

          autorizacao.vista = true;
          if (cobre(autorizacao.onde, rel)) continue;
          achados.push({
            regra: 'pii/fora-do-caminho', severidade: 'bloqueia', arquivo: rel, linha: i + 1,
            mensagem: `O ${p.rotulo} ${mascarar(encontrado[0])} é declarado como sintético, mas não `
              + `para este arquivo: ${caminhoPii} autoriza ${autorizacao.onde.join(', ') || '(nenhum caminho)'}.`,
            comoCorrigir: `Acrescente "${rel}" ao \`onde\` da declaração, ou tire o ${p.rotulo} daqui. `
              + 'Declaração não é passe livre global: ela vale onde alguém disse que vale.',
          });
        }
      }

      // ── campo fora do catálogo: só em log, e a medição é o motivo ─────────
      if (!ehLogEste) return;
      for (const m of linha.matchAll(CAMPO_EM_LOG)) {
        const campo = m[1].toLowerCase();
        if (NAO_SAO_CAMPOS.has(campo) || catalogo.has(campo)) continue;
        achados.push({
          regra: 'catalogo/campo-nao-declarado', severidade: 'bloqueia', arquivo: rel, linha: i + 1,
          mensagem: `O campo "${campo}" é tratado e não está no inventário do repositório.`,
          comoCorrigir: `Declare "${campo}" em ${DIR_PRIVACIDADE}/${arquivoInventario ?? 'data-inventory.yaml'} `
            + 'com categoria e base legal, ou pare de escrevê-lo no log.',
        });
      }
    });
  }

  // ── declaração morta ──────────────────────────────────────────────────────
  // Lista que ninguém confere apodrece, e apodrecida ela autoriza o que já não
  // está lá. Quem retira a massa retira a declaração no mesmo diff.
  for (const a of autorizacoes.values()) {
    if (a.vista) continue;
    achados.push({
      regra: 'pii/declaracao-morta', severidade: 'bloqueia', arquivo: caminhoPii,
      mensagem: `O ${a.tipo === 'email' ? 'domínio' : 'valor'} declarado "${mascarar(a.chave)}" não `
        + 'aparece em lugar nenhum do repositório.',
      comoCorrigir: 'Remova a declaração. Autorização que não corresponde a nada é autorização '
        + 'esperando um valor futuro — e o valor futuro entra sem ninguém rever.',
    });
  }

  // ── checklist dos sete princípios ─────────────────────────────────────────
  const caminhoEpico = join(dir, 'epico.yml');
  if (!existsSync(caminhoEpico)) {
    achados.push({
      regra: 'pbd/ausente', severidade: 'bloqueia', arquivo: `${DIR_PRIVACIDADE}/epico.yml`,
      mensagem: 'O épico não declara o checklist dos sete princípios de Privacy by Design.',
      comoCorrigir: 'Crie o arquivo com as sete chaves e a evidência de cada uma.',
    });
  } else {
    let epico: EpicoDeclarado = {};
    try {
      epico = parse(readFileSync(caminhoEpico, 'utf8')) ?? {};
    } catch (e) {
      achados.push({
        regra: 'pbd/ilegivel', severidade: 'bloqueia', arquivo: `${DIR_PRIVACIDADE}/epico.yml`,
        mensagem: `O épico não pôde ser lido: ${(e as Error).message}`,
        comoCorrigir: 'Corrija o YAML.',
      });
    }

    const marcacoes: MarcacaoPbd[] = (epico.pbd ?? []).map((p) => ({
      chave: String(p.chave), marcado: p.marcado !== false, evidencia: String(p.evidencia ?? ''),
    }));

    // A mesma regra que a tela usa. Uma segunda implementação aqui divergiria.
    for (const pendencia of vereditoPbd(marcacoes).pendencias) {
      achados.push({
        regra: `pbd/${pendencia.situacao}`, severidade: 'bloqueia', arquivo: `${DIR_PRIVACIDADE}/epico.yml`,
        mensagem: pendencia.motivo,
        comoCorrigir: pendencia.situacao === 'marcado_sem_evidencia'
          ? 'Aponte o arquivo, o teste ou o commit que sustenta a marca — ou desmarque.'
          : `Responda: ${pendencia.pergunta}`,
      });
    }

    // Evidência que aponta para arquivo inexistente é evidência que não existe.
    for (const p of epico.pbd ?? []) {
      const alvo = String(p.evidencia ?? '').split('#')[0].trim();
      if (!alvo || !/[/.]/.test(alvo) || alvo.startsWith('http')) continue;
      if (!existsSync(join(raiz, alvo))) {
        achados.push({
          regra: 'pbd/evidencia-inexistente', severidade: 'bloqueia',
          arquivo: `${DIR_PRIVACIDADE}/epico.yml`,
          mensagem: `A evidência do princípio "${p.chave}" aponta para "${alvo}", que não existe no repositório.`,
          comoCorrigir: 'Corrija o caminho. Evidência que ninguém consegue abrir não sustenta a marca.',
        });
      }
    }
  }

  return {
    aprovado: achados.every((a) => a.severidade !== 'bloqueia'),
    achados,
    arquivosVarridos: arquivosLidos,
    logsVarridos: logs.length,
    binariosPulados,
    diretoriosIgnorados: [...new Set(varredura.ignorados)].sort(),
  };
}

/**
 * Relatório para o terminal do CI: arquivo, linha, o que houve e como corrigir.
 *
 * O cabeçalho diz o denominador antes de dizer o resultado. "Nenhum achado"
 * sobre um arquivo e "nenhum achado" sobre noventa e cinco são a mesma frase
 * com valores probatórios opostos, e foi exatamente essa ambiguidade que deixou
 * o Risco-003 passar despercebido.
 */
export function relatorio(r: ResultadoDoGate): string {
  const ignorados = r.diretoriosIgnorados.length > 0
    ? `  Fora da varredura: ${r.diretoriosIgnorados.join(', ')}`
    : '  Fora da varredura: nada.';
  const linhas = [
    '',
    '  Gate de privacidade',
    `  ${r.arquivosVarridos} arquivo(s) varrido(s) · ${r.logsVarridos} log(s) · `
      + `${r.binariosPulados} binário(s) pulado(s)`,
    ignorados,
    '',
  ];
  if (r.achados.length === 0) {
    linhas.push('  Nenhum achado. Nenhum dado pessoal fora do inventário sintético, nenhum campo');
    linhas.push('  fora do catálogo, e os sete princípios com evidência apontada.', '');
    return linhas.join('\n');
  }
  for (const a of r.achados) {
    const onde = a.arquivo ? `${a.arquivo}${a.linha ? `:${a.linha}` : ''}` : '(repositório)';
    linhas.push(`  ${a.severidade === 'bloqueia' ? '⛔' : '⚠️'}  ${onde}`);
    linhas.push(`      [${a.regra}] ${a.mensagem}`);
    linhas.push(`      → ${a.comoCorrigir}`, '');
  }
  linhas.push(r.aprovado
    ? '  Nenhum achado bloqueante.'
    : `  ${r.achados.filter((a) => a.severidade === 'bloqueia').length} achado(s) bloqueiam o merge.`, '');
  return linhas.join('\n');
}
