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
  /** Quantos arquivos a varredura de PII realmente leu. Zero é suspeito. */
  arquivosVarridos: number;
}

const DIR_PRIVACIDADE = '.privacy';

/**
 * Onde um log de exemplo mora, por convenção. A declaração do repositório só
 * **acrescenta** caminhos a esta lista: se pudesse remover, bastaria apagar uma
 * linha do YAML para o gate parar de olhar onde incomoda.
 */
const PADROES_DE_LOG = [/\.log$/, /[/\\]logs?[/\\]/, /[/\\]exemplos?[/\\]/, /[/\\]fixtures?[/\\]/];

const IGNORAR = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', 'build']);

/**
 * Os padrões de dado pessoal procurados em log.
 *
 * Conservadores de propósito: cada um casa uma forma que **só** um dado pessoal
 * tem. Um padrão frouxo produz vermelho falso, e gate que cria vermelho falso é
 * desligado pela equipe em duas semanas — que é o pior desfecho possível.
 */
const PADROES_PII: { regra: string; nome: string; re: RegExp; comoCorrigir: string }[] = [
  {
    regra: 'pii-em-log/cpf', nome: 'CPF',
    re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
    comoCorrigir: 'Passe o registro pelo redator antes de escrever (app/src/lib/redator.ts). '
      + 'CPF em log é acesso a dado pessoal sem finalidade declarada (Art. 37).',
  },
  {
    regra: 'pii-em-log/cnpj', nome: 'CNPJ',
    re: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
    comoCorrigir: 'Redija o identificador antes de escrever no log.',
  },
  {
    regra: 'pii-em-log/email', nome: 'e-mail',
    re: /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,
    comoCorrigir: 'Substitua por hash ou máscara. E-mail identifica o titular tão bem quanto o documento.',
  },
  {
    regra: 'pii-em-log/telefone', nome: 'telefone',
    re: /\(\d{2}\)\s?9?\d{4}-\d{4}\b/g,
    comoCorrigir: 'Substitua por máscara. Telefone é dado de contato do titular.',
  },
];

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
  campos?: { nome: string; categoria?: string; base_legal?: string }[];
  logs?: string[];
}

interface EpicoDeclarado {
  codigo?: string;
  titulo?: string;
  pbd?: { chave: string; marcado?: boolean; evidencia?: string }[];
}

function arquivosDe(raiz: string, atual = raiz, acc: string[] = []): string[] {
  for (const nome of readdirSync(atual)) {
    if (IGNORAR.has(nome)) continue;
    const caminho = join(atual, nome);
    if (statSync(caminho).isDirectory()) arquivosDe(raiz, caminho, acc);
    else acc.push(caminho);
  }
  return acc;
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
      aprovado: false, arquivosVarridos: 0,
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

  const catalogo = new Set((inventario.campos ?? []).map((c) => String(c.nome).toLowerCase()));
  const extras = inventario.logs ?? [];

  // ── varredura de PII e de campo fora do catálogo ──────────────────────────
  const todos = arquivosDe(raiz).map((a) => ({ abs: a, rel: relative(raiz, a) }));
  const logs = todos.filter((a) => ehLog(a.rel, extras));

  for (const { abs, rel } of logs) {
    let conteudo: string;
    try {
      conteudo = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    conteudo.split('\n').forEach((linha, i) => {
      for (const p of PADROES_PII) {
        for (const achado of linha.matchAll(p.re)) {
          achados.push({
            regra: p.regra, severidade: 'bloqueia', arquivo: rel, linha: i + 1,
            mensagem: `${p.nome} em texto claro no log: ${achado[0]}`,
            comoCorrigir: p.comoCorrigir,
          });
        }
      }
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
    arquivosVarridos: logs.length,
  };
}

/** Relatório para o terminal do CI: arquivo, linha, o que houve e como corrigir. */
export function relatorio(r: ResultadoDoGate): string {
  const linhas = [
    '',
    '  Gate de privacidade',
    `  ${r.arquivosVarridos} arquivo(s) de log varrido(s)`,
    '',
  ];
  if (r.achados.length === 0) {
    linhas.push('  Nenhum achado. Nenhum dado pessoal em log, nenhum campo fora do catálogo,');
    linhas.push('  e os sete princípios com evidência apontada.', '');
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
