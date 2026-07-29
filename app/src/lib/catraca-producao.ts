/**
 * A catraca das premissas de aceite (RIPD §7.3 — Riscos 035, 037, 040).
 *
 * O RIPD lista quatro condições que **precisam deixar de ser verdade antes de
 * qualquer produção**. Elas eram uma tabela num documento — e uma tabela num
 * documento não impede um deploy. O que impede é isto: um build com o perfil de
 * produção e uma varredura sobre o artefato, que reprova nomeando o risco, o
 * arquivo e a linha.
 *
 * ## O que ela procura, e por que cada coisa prova o que promete
 *
 * · **selo da demonstração** (Risco-035) — vive dentro do invólucro que só o
 *   perfil de demonstração renderiza. Presente no artefato = o console de
 *   demonstração foi publicado;
 * · **rota de forja** (Risco-035) — `audit/forjar` só sobrevive à minificação se
 *   o ramo não foi dobrado, e o ramo só não é dobrado se `EH_DEMONSTRACAO` era
 *   verdadeiro em tempo de build;
 * · **selo do seletor de papel** (Risco-037) — viaja dentro do controle de troca
 *   de papel. É a afordância que o RIPD manda não existir;
 * · **identidades de sessão** (Risco-037) — os nomes fictícios que o protótipo
 *   usa como ator porque não há credencial nenhuma. Marcador real, não selo: se
 *   eles estão no artefato, a sessão sem credencial está junto;
 * · **PII sintética** (Risco-040) — os valores do inventário fechado do PR 4,
 *   lidos de `.privacy/pii-sintetica.yaml`. A fonte é a mesma que o gate usa, e
 *   por isso a lista não pode divergir: acrescentar massa nova ao inventário
 *   acrescenta ao que esta catraca procura, no mesmo diff.
 *
 * ## Por que ela não confia em ausência
 *
 * Diretório inexistente, vazio ou sem nenhum `.js` **reprova**. Uma catraca que
 * aprova por não ter olhado é o Risco-003 com outro nome, e este repositório já
 * pagou esse preço uma vez: o gate varria um arquivo e imprimia "nenhum achado".
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from 'yaml';
import { SELO_DE_DEMONSTRACAO, SELO_DO_SELETOR_DE_PAPEL } from './perfil';

export type RiscoDeAceite = 'Risco-035' | 'Risco-037' | 'Risco-040';

export interface AchadoDaCatraca {
  risco: RiscoDeAceite;
  regra: string;
  arquivo: string;
  linha?: number;
  mensagem: string;
  comoCorrigir: string;
}

export interface ResultadoDaCatraca {
  aprovado: boolean;
  achados: AchadoDaCatraca[];
  /** Quantos arquivos do artefato foram lidos. Zero reprova. */
  arquivosVarridos: number;
}

/**
 * As identidades que o protótipo usa como ator porque não existe credencial.
 *
 * Copiadas de `store/sessao.ts` de propósito: importar de lá arrastaria o mock
 * inteiro para dentro desta varredura, que roda em Node e não deve conhecer o
 * aplicativo. A divergência é coberta por teste — as duas listas são comparadas.
 */
export const IDENTIDADES_DE_DEMONSTRACAO = [
  'Maria Souza', 'Marcela Dias', 'Pedro Lima', 'Rita Nunes', 'Auditoria Externa',
];

interface MarcadorDaCatraca {
  risco: RiscoDeAceite;
  regra: string;
  agulha: string;
  mensagem: string;
  comoCorrigir: string;
}

const MARCADORES: MarcadorDaCatraca[] = [
  {
    risco: 'Risco-035', regra: 'aceite/modo-demonstracao', agulha: SELO_DE_DEMONSTRACAO,
    mensagem: 'O console de demonstração está dentro do artefato de produção.',
    comoCorrigir: 'Gere o artefato com `VITE_PERFIL=producao`. O `main.tsx` carrega o console por '
      + '`import()` dinâmico atrás da constante de build — se o selo chegou aqui, alguém trocou por '
      + 'um import estático, e o dado veio junto.',
  },
  {
    risco: 'Risco-035', regra: 'aceite/rota-de-forja', agulha: 'audit/forjar',
    mensagem: 'A rota que simula adulteração do audit trail está no artefato de produção.',
    comoCorrigir: 'A rota vive atrás de `EH_DEMONSTRACAO &&` em `mock/api.ts`. Com a constante '
      + 'primeiro na conjunção, o bloco é apagado em tempo de build; com ela por último, a rota '
      + 'continua publicada respondendo 404 — que é uma checagem que alguém remove.',
  },
  {
    risco: 'Risco-037', regra: 'aceite/papel-por-botao', agulha: SELO_DO_SELETOR_DE_PAPEL,
    mensagem: 'O seletor de papel — autenticação por botão — está no artefato de produção.',
    comoCorrigir: 'O controle vive atrás de `EH_DEMONSTRACAO` em `App.tsx`. Em produção quem '
      + 'responde é `NaoConfigurado`: sem provedor de identidade real não há sessão, e a resposta '
      + 'honesta é recusar dizendo o que falta.',
  },
];

const IGNORAR = new Set(['node_modules', '.git']);

function arquivosDe(raiz: string, atual = raiz, acc: string[] = []): string[] {
  if (!existsSync(atual)) return acc;
  for (const nome of readdirSync(atual)) {
    if (IGNORAR.has(nome)) continue;
    const caminho = join(atual, nome);
    if (statSync(caminho).isDirectory()) arquivosDe(raiz, caminho, acc);
    else acc.push(caminho);
  }
  return acc;
}

/** Os valores sintéticos declarados no inventário do PR 4 — a mesma fonte do gate. */
export function piiDeclarada(caminhoDoInventario: string): string[] {
  const bruto = parse(readFileSync(caminhoDoInventario, 'utf8')) as {
    cpf?: { valor?: string }[];
    cnpj?: { valor?: string }[];
    telefone?: { valor?: string }[];
    email?: { dominios?: { dominio?: string }[] };
  } | null;
  return [
    ...(bruto?.cpf ?? []), ...(bruto?.cnpj ?? []), ...(bruto?.telefone ?? []),
  ].map((d) => String(d.valor ?? '')).filter(Boolean)
    .concat((bruto?.email?.dominios ?? []).map((d) => String(d.dominio ?? '')).filter(Boolean));
}

/**
 * Varre o artefato de produção.
 *
 * `caminhoDoInventario` é obrigatório: sem ele a varredura de PII não teria o
 * que procurar, e um parâmetro opcional que desliga uma das quatro checagens é
 * exatamente o tipo de conveniência que esvazia uma catraca.
 */
export function rodarCatraca(dist: string, caminhoDoInventario: string): ResultadoDaCatraca {
  const achados: AchadoDaCatraca[] = [];

  if (!existsSync(dist)) {
    return {
      aprovado: false, arquivosVarridos: 0,
      achados: [{
        risco: 'Risco-035', regra: 'aceite/artefato-ausente', arquivo: dist,
        mensagem: 'O artefato de produção não existe: a catraca não teve o que ler.',
        comoCorrigir: 'Rode `VITE_PERFIL=producao npm run build -- --outDir <dir>` antes. '
          + 'Aprovar por não ter olhado é o Risco-003 com outro nome.',
      }],
    };
  }

  const arquivos = arquivosDe(dist).filter((a) => /\.(js|mjs|css|html|map|json)$/.test(a));
  if (arquivos.length === 0) {
    return {
      aprovado: false, arquivosVarridos: 0,
      achados: [{
        risco: 'Risco-035', regra: 'aceite/artefato-vazio', arquivo: dist,
        mensagem: 'O artefato existe e não tem nenhum arquivo varrível.',
        comoCorrigir: 'Confira o `--outDir` do build. Diretório vazio aprovaria as quatro '
          + 'premissas de uma vez, sem ter lido nada.',
      }],
    };
  }

  const pii = piiDeclarada(caminhoDoInventario);
  const agulhas: MarcadorDaCatraca[] = [
    ...MARCADORES,
    ...IDENTIDADES_DE_DEMONSTRACAO.map((nome) => ({
      risco: 'Risco-037' as const, regra: 'aceite/sessao-sem-credencial', agulha: nome,
      mensagem: 'Uma identidade fictícia de sessão está no artefato de produção.',
      comoCorrigir: 'Elas existem porque o protótipo não tem autenticação: o ator vem de um mapa '
        + 'por papel em `store/sessao.ts`. Em produção não há sessão a fabricar — há credencial a '
        + 'exigir.',
    })),
    ...pii.map((valor) => ({
      risco: 'Risco-040' as const, regra: 'aceite/pii-sintetica-no-bundle', agulha: valor,
      mensagem: 'Um valor do inventário de PII sintética está no artefato de produção.',
      comoCorrigir: 'Nenhum dado — nem fictício — vai embarcado no cliente. O cenário inteiro '
        + 'entra pelo `import()` dinâmico de `App`, que o perfil de produção não alcança.',
    })),
  ];

  for (const abs of arquivos) {
    const rel = relative(dist, abs).split(sep).join('/');
    let conteudo: string;
    try { conteudo = readFileSync(abs, 'utf8'); } catch { continue; }
    const linhas = conteudo.split('\n');
    for (const m of agulhas) {
      const i = linhas.findIndex((l) => l.includes(m.agulha));
      if (i < 0) continue;
      achados.push({
        risco: m.risco, regra: m.regra, arquivo: rel, linha: i + 1,
        // O valor não é reimpresso: o relatório do CI é um sistema de
        // armazenamento como outro qualquer — mesma regra do gate do PR 4.
        mensagem: m.mensagem,
        comoCorrigir: m.comoCorrigir,
      });
    }
  }

  return { aprovado: achados.length === 0, achados, arquivosVarridos: arquivos.length };
}

/** Relatório para o terminal do CI: risco, arquivo, linha e o que fazer. */
export function relatorioDaCatraca(r: ResultadoDaCatraca): string {
  const linhas = [
    '',
    '  Catraca das premissas de aceite (RIPD §7.3)',
    `  ${r.arquivosVarridos} arquivo(s) do artefato varrido(s)`,
    '',
  ];
  if (r.achados.length === 0) {
    linhas.push('  As quatro premissas valem neste artefato: sem modo demonstração, sem rota de');
    linhas.push('  forja, sem papel por botão e sem PII sintética.', '');
    return linhas.join('\n');
  }
  for (const a of r.achados) {
    linhas.push(`  ⛔  [${a.risco}] ${a.arquivo}${a.linha ? `:${a.linha}` : ''}`);
    linhas.push(`      [${a.regra}] ${a.mensagem}`);
    linhas.push(`      → ${a.comoCorrigir}`, '');
  }
  linhas.push(`  ${r.achados.length} achado(s) impedem este artefato de ir a produção.`, '');
  return linhas.join('\n');
}
