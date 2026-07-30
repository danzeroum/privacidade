import { parse } from 'yaml';

/**
 * Política de vulnerabilidade de dependência (Risco-005, sub-item b).
 *
 * `npm audit` sem política é uma de duas coisas: ruído, se qualquer achado
 * reprova, ou silêncio, se nada reprova. O limiar e as exceções decidem qual —
 * e as duas coisas moram em `.privacy/audit-excecoes.yaml`, num lugar só, lidas
 * pelo CLI e pelo teste.
 *
 * ## Por que não há `schedule`
 *
 * Advisory publicado hoje deixaria a `main` vermelha sem ninguém ter tocado em
 * nada. É a mesma polaridade que o relógio do programa resolveu: mudança do
 * **mundo** não é defeito do diff, e um vermelho diário treina a equipe a ignorar
 * vermelho. Este check roda em push e PR; advisory novo é pendência do mundo, e
 * pertence ao relógio.
 *
 * ## Por que a exceção tem prazo
 *
 * Aceite sem validade é aceite permanente com outro nome. Vencida, a exceção para
 * de valer sozinha e o check volta ao vermelho sem ninguém precisar lembrar — que
 * é a única forma de "aceitamos por enquanto" não virar "aceitamos".
 */

export const SEVERIDADES = ['info', 'low', 'moderate', 'high', 'critical'] as const;
export type Severidade = (typeof SEVERIDADES)[number];

export const pesoDe = (s: string): number => {
  const i = SEVERIDADES.indexOf(s as Severidade);
  // Severidade desconhecida cai no cenário mais restritivo: o indefinido nunca
  // cai no permissivo. É a mesma regra do prazo indefinido na fila.
  return i === -1 ? SEVERIDADES.length : i;
};

export interface Excecao {
  advisory: number;
  pacote: string;
  severidade: string;
  motivo: string;
  aceitoPor: string;
  validaAte: string;
}

export interface PoliticaDeAudit {
  limiar: Severidade;
  excecoes: Excecao[];
}

export interface AchadoDeAudit {
  regra: string;
  mensagem: string;
}

export type LeituraDaPolitica =
  | { ok: true; politica: PoliticaDeAudit }
  | { ok: false; achados: AchadoDeAudit[] };

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Falha fechada: arquivo ausente, ilegível ou sem limiar reprova. */
export function lerPolitica(bruto: string, arquivo: string): LeituraDaPolitica {
  let doc: Record<string, any>;
  try {
    doc = (parse(bruto) ?? {}) as Record<string, any>;
  } catch (e) {
    return {
      ok: false,
      achados: [{
        regra: 'politica/ilegivel',
        mensagem: `${arquivo} não é YAML válido (${e instanceof Error ? e.message.split('\n')[0] : 'erro'}). `
          + 'Política ilegível reprova em vez de virar política vazia.',
      }],
    };
  }

  const achados: AchadoDeAudit[] = [];
  const limiar = texto(doc.limiar) as Severidade;
  if (!SEVERIDADES.includes(limiar)) {
    achados.push({
      regra: 'politica/limiar-invalido',
      mensagem: `${arquivo}: limiar "${doc.limiar}" fora de ${SEVERIDADES.join(', ')}. `
        + 'Sem limiar não há política, e sem política o audit é ruído ou silêncio.',
    });
  }

  const cru = Array.isArray(doc.excecoes) ? doc.excecoes : [];
  const excecoes: Excecao[] = [];
  for (const [i, e] of cru.entries()) {
    const onde = `${arquivo}: exceção ${i + 1}`;
    const advisory = typeof e?.advisory === 'number' ? e.advisory : NaN;
    const pacote = texto(e?.pacote);
    const motivo = texto(e?.motivo);
    const aceitoPor = texto(e?.aceito_por);
    const validaAte = texto(e?.valida_ate);

    if (!Number.isFinite(advisory)) {
      achados.push({
        regra: 'excecao/sem-advisory',
        mensagem: `${onde}: sem \`advisory\`. Excepcionar por pacote cobriria advisories futuros `
          + 'que ninguém avaliou.',
      });
    }
    if (!pacote) achados.push({ regra: 'excecao/sem-pacote', mensagem: `${onde}: sem \`pacote\`.` });
    if (motivo.length < 20) {
      achados.push({
        regra: 'excecao/sem-motivo',
        mensagem: `${onde}: \`motivo\` curto ou ausente. "Sem correção disponível" é a situação, `
          + 'não a análise — e risco aceito sem análise escrita é risco esquecido.',
      });
    }
    if (!aceitoPor) {
      achados.push({
        regra: 'excecao/sem-dono',
        mensagem: `${onde}: sem \`aceito_por\`. Risco aceito sem dono é o que o próprio schema `
          + 'deste projeto recusa em `risco.dono_handle`.',
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validaAte)) {
      achados.push({
        regra: 'excecao/sem-validade',
        mensagem: `${onde}: \`valida_ate\` ausente ou fora de AAAA-MM-DD. Aceite sem prazo é aceite `
          + 'permanente com outro nome.',
      });
    }

    excecoes.push({
      advisory, pacote, severidade: texto(e?.severidade), motivo, aceitoPor, validaAte,
    });
  }

  if (achados.length > 0) return { ok: false, achados };
  return { ok: true, politica: { limiar, excecoes } };
}

export interface Advisory {
  source: number;
  pacote: string;
  severidade: string;
  titulo: string;
  url: string;
  correcaoDisponivel: boolean;
}

/**
 * Extrai os advisories do JSON do `npm audit`.
 *
 * A identidade é `via[].source` — o número que o próprio npm usa. O nome do
 * pacote sozinho agrupa problemas diferentes sob o mesmo rótulo, e uma exceção
 * ancorada nele cobriria o advisory de amanhã.
 */
export function lerAdvisories(relatorio: unknown): Advisory[] {
  const r = (relatorio ?? {}) as { vulnerabilities?: Record<string, any> };
  const saida = new Map<number, Advisory>();

  for (const v of Object.values(r.vulnerabilities ?? {})) {
    for (const via of Array.isArray(v?.via) ? v.via : []) {
      // `via` também traz strings, quando a vulnerabilidade é herdada de outro
      // pacote da árvore. O advisory de origem aparece como objeto no pacote que
      // o carrega, e é lá que ele é contado — uma vez.
      if (typeof via !== 'object' || via === null || typeof via.source !== 'number') continue;
      saida.set(via.source, {
        source: via.source,
        pacote: texto(via.name) || texto(v?.name),
        severidade: texto(via.severity) || texto(v?.severity),
        titulo: texto(via.title),
        url: texto(via.url),
        correcaoDisponivel: v?.fixAvailable !== false,
      });
    }
  }

  return [...saida.values()].sort((a, b) => a.source - b.source);
}

export interface ResultadoDaAuditoria {
  aprovado: boolean;
  achados: AchadoDeAudit[];
  /** No limiar ou acima, e sem exceção válida. */
  bloqueiam: Advisory[];
  /** No limiar ou acima, cobertos por exceção válida — com o motivo citado. */
  tolerados: { advisory: Advisory; excecao: Excecao }[];
  /** Abaixo do limiar: informados, nunca bloqueantes. */
  abaixoDoLimiar: Advisory[];
  limiar: Severidade;
}

/**
 * Vence hoje ainda vale — a mesma fronteira do DPA.
 *
 * Comparação de string ISO, e não de `Date`: `'2026-07-30' >= '2026-07-30'` é
 * exato, enquanto duas datas construídas com fuso diferente empatam por sorte.
 */
export const excecaoVigente = (e: Excecao, hoje: string): boolean => e.validaAte >= hoje;

export function avaliarAuditoria(
  relatorio: unknown, politica: PoliticaDeAudit, hoje: string,
): ResultadoDaAuditoria {
  const advisories = lerAdvisories(relatorio);
  const noLimiar = advisories.filter((a) => pesoDe(a.severidade) >= pesoDe(politica.limiar));
  const abaixoDoLimiar = advisories.filter((a) => pesoDe(a.severidade) < pesoDe(politica.limiar));

  const achados: AchadoDeAudit[] = [];
  const bloqueiam: Advisory[] = [];
  const tolerados: { advisory: Advisory; excecao: Excecao }[] = [];

  const porAdvisory = new Map(politica.excecoes.map((e) => [e.advisory, e]));
  const usadas = new Set<number>();

  for (const a of noLimiar) {
    const e = porAdvisory.get(a.source);
    if (!e) {
      bloqueiam.push(a);
      achados.push({
        regra: 'audit/sem-excecao',
        mensagem: `${a.pacote}: ${a.severidade} — ${a.titulo} (advisory ${a.source}). `
          + `${a.correcaoDisponivel ? 'Há correção disponível.' : 'Sem correção publicada.'} ${a.url}`,
      });
      continue;
    }
    usadas.add(a.source);
    if (e.pacote !== a.pacote) {
      achados.push({
        regra: 'excecao/pacote-divergente',
        mensagem: `exceção do advisory ${a.source} aponta para "${e.pacote}" e o relatório diz "${a.pacote}".`,
      });
      bloqueiam.push(a);
      continue;
    }
    if (!excecaoVigente(e, hoje)) {
      achados.push({
        regra: 'excecao/vencida',
        mensagem: `${a.pacote}: exceção do advisory ${a.source} venceu em ${e.validaAte}. `
          + 'Aceite tem prazo, e o vermelho volta sozinho quando ele passa.',
      });
      bloqueiam.push(a);
      continue;
    }
    tolerados.push({ advisory: a, excecao: e });
  }

  /**
   * Declaração morta — a mesma regra do inventário de PII. Exceção para advisory
   * que já não aparece no relatório apodrece autorizando o que foi corrigido, e
   * ninguém relê um arquivo de exceções por conta própria.
   */
  for (const e of politica.excecoes) {
    if (usadas.has(e.advisory)) continue;
    if (advisories.some((a) => a.source === e.advisory)) continue;
    achados.push({
      regra: 'excecao/declaracao-morta',
      mensagem: `exceção do advisory ${e.advisory} (${e.pacote}) não corresponde a nada no relatório. `
        + 'Corrigido, ela deve sair; renomeado, ela deve ser reescrita.',
    });
  }

  return {
    aprovado: achados.length === 0,
    achados,
    bloqueiam,
    tolerados,
    abaixoDoLimiar,
    limiar: politica.limiar,
  };
}

export function relatorioDaAuditoria(r: ResultadoDaAuditoria): string {
  const l: string[] = ['', '  Política de dependências vulneráveis', `  limiar: ${r.limiar}`];

  if (r.abaixoDoLimiar.length > 0) {
    l.push('', `  ${r.abaixoDoLimiar.length} abaixo do limiar (informado, não bloqueia):`);
    for (const a of r.abaixoDoLimiar) {
      // O identificador entra na linha porque um pacote pode carregar mais de um
      // advisory: `react-router` aparece duas vezes hoje, e sem o número a lista
      // parece ter duplicata — relatório que parece errado é relatório que a
      // equipe para de ler.
      l.push(`    ${a.pacote} · advisory ${a.source} · ${a.severidade}`
        + `${a.correcaoDisponivel ? ' · correção disponível' : ''}`);
    }
  }

  if (r.tolerados.length > 0) {
    l.push('', `  ${r.tolerados.length} no limiar, com exceção vigente:`);
    for (const { advisory, excecao } of r.tolerados) {
      l.push(`    ${advisory.pacote} · advisory ${advisory.source} · até ${excecao.validaAte} · ${excecao.aceitoPor}`);
      l.push(`      ${excecao.motivo.replace(/\s+/g, ' ').trim()}`);
    }
  }

  l.push('');
  if (r.aprovado) {
    l.push('  Nenhum advisory no limiar sem exceção vigente.');
  } else {
    l.push(`  ${r.achados.length} achado(s) que reprovam:`);
    for (const a of r.achados) {
      l.push(`    [${a.regra}] ${a.mensagem.replace(/\s+/g, ' ').trim()}`);
    }
  }

  return `${l.join('\n')}\n`;
}
