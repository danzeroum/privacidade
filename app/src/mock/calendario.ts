import type { Papel } from './types';

/**
 * T10 · Calendário do ano — as obrigações provisionadas.
 *
 * Este arquivo responde a três perguntas e não a uma quarta: quanto o mês já
 * está comprometido, o que sai no feed e o que entra na antecedência. **Ele não
 * cria item de fila** — quem promove obrigação a item é `fila.ts`, lendo estes
 * dados. A separação importa: se a obrigação virasse item aqui, teríamos duas
 * filas, uma derivada de estado e outra copiada do calendário, divergindo na
 * primeira vez que alguém prorrogasse uma data.
 *
 * Três decisões do `MAPA-PROCESSOS.md §4` moram aqui:
 *
 * 1. **A barra do mês é carga provisionada, não progresso.** Ela é somada das
 *    obrigações mais a reserva de demanda — nunca digitada. O desenho trazia um
 *    `cargaMes = [30, 20, 55, …]` escrito à mão; um número desses envelhece na
 *    primeira obrigação que muda de mês e ninguém percebe.
 *
 * 2. **O que chega por demanda não tem data, tem reserva de capacidade.**
 *    Incidente, direito do titular e achado disputam as mesmas pessoas, e
 *    provisioná-los como percentual é o que impede o ciclo de ser atropelado.
 *
 * 3. **Cada obrigação declara o que acontece se passar.** Não "revalidar
 *    consentimento em março", mas "o campo perde base legal e o gate bloqueia
 *    dois repositórios" — é esse texto que vai para a fila e para o convite.
 */

export type Trilha = 'ciclo' | 'vencimento' | 'legal' | 'capacitacao' | 'auditoria';
export type TipoObrigacao = 'compromisso' | 'prazo';

export const TRILHAS: { id: Trilha; rotulo: string; tom: string }[] = [
  { id: 'ciclo', rotulo: 'Ciclo do programa', tom: 'var(--accent)' },
  { id: 'vencimento', rotulo: 'Vencimento de artefato', tom: 'var(--warn)' },
  { id: 'legal', rotulo: 'Prazo legal', tom: 'var(--crit)' },
  { id: 'capacitacao', rotulo: 'Capacitação', tom: 'var(--sens)' },
  { id: 'auditoria', rotulo: 'Auditoria', tom: 'var(--text-3)' },
];

export const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * Capacidade do programa em dias-pessoa por mês, e a fatia que **não** se
 * agenda. Os dois são premissa declarada, não constante escondida: quem discorda
 * do número discute o número, em vez de descobrir que a barra era chute.
 */
export const CAPACIDADE_DIAS_MES = 60;
export const RESERVA_DEMANDA = 0.30;

export interface Prorrogacao {
  de: string;
  para: string;
  /** Já redigida (C-04), como toda justificativa que entra em registro. */
  justificativa: string;
  ator: string;
  quando: string;
}

export interface Obrigacao {
  codigo: string;
  titulo: string;
  /** Rótulo curto, para a grade de doze meses. */
  curto: string;
  trilha: Trilha;
  tipo: TipoObrigacao;
  /** ISO `AAAA-MM-DD`. Prorrogar muda isto — com justificativa registrada. */
  vence: string;
  /** Quantos dias antes ela entra na fila. É o que separa provisionado de agora. */
  antecedenciaDias: number;
  /** O que preparar dentro da antecedência. Vira "sua próxima ação" na fila. */
  preparar: string;
  /** O que acontece se passar. Vira "o que está travado" na fila e no convite. */
  seFalhar: string;
  /** Dias-pessoa que ela consome do mês. É daqui que sai a barra. */
  cargaDias: number;
  /**
   * De quem é a obrigação. **Declarado**, não derivado — e a diferença é do
   * modelo, não de conveniência.
   *
   * Item de artefato deriva o dono da `Acao`: o estado diz o que precisa ser
   * feito, e a tabela de permissões diz quem pode fazer. Ninguém escolhe.
   *
   * Obrigação é dado **autorado**: alguém sentou em 1º de janeiro e disse que o
   * diagnóstico AS-IS é da engenharia e o tabletop é da segurança. Derivar isso
   * de permissão exigiria uma `Acao` por recorte de papel — e não existe ação
   * que só a segurança tenha, então o tabletop cairia em `escrever` e apareceria
   * para três papéis. Foi o que aconteceu até aqui.
   *
   * O item herda esta declaração. O que ele **não** ganha é um campo de dono
   * próprio: quem responde por isso é `Titularidade`, em `fila.ts`.
   */
  responsavel: Papel;
  tela: string;
  /** Cumprida deixa de provisionar trabalho futuro e sai da fila. */
  cumpridaEm?: string;
  prorrogacoes?: Prorrogacao[];
}

const DIA_MS = 86_400_000;

export const mesDe = (o: Obrigacao): number => Number(o.vence.slice(5, 7)) - 1;

export const diasAte = (o: Obrigacao, agora: number): number =>
  Math.round((new Date(`${o.vence}T12:00:00Z`).getTime() - agora) / DIA_MS);

/** Pendente é o que ainda não foi cumprido. Data passada não cumpre nada sozinha. */
export const pendente = (o: Obrigacao): boolean => !o.cumpridaEm;

/**
 * A obrigação entrou na antecedência declarada?
 *
 * É a única porta entre calendário e fila. Fora dela a obrigação existe, está na
 * grade do ano e **não** ocupa ninguém; dentro dela vira trabalho. Já vencida e
 * não cumprida continua dentro, porque prazo estourado não sai da fila por ter
 * estourado.
 */
export const naAntecedencia = (o: Obrigacao, agora: number): boolean =>
  pendente(o) && diasAte(o, agora) <= o.antecedenciaDias;

export interface CargaDoMes {
  mes: number;
  /** Dias-pessoa somados das obrigações do mês. */
  provisionado: number;
  /** Dias-pessoa reservados para o que chega por demanda. */
  reservado: number;
  /** Percentual da capacidade, limitado a 100 para a barra. */
  percentual: number;
  obrigacoes: Obrigacao[];
}

/**
 * A carga de cada um dos doze meses, somada das obrigações. Cumprida continua
 * contando: ela consumiu o mês dela, e apagar isso reescreveria o passado do
 * ano — que é o mesmo motivo de a trilha de auditoria ser append-only.
 */
export function cargaDoAno(obrigacoes: Obrigacao[]): CargaDoMes[] {
  const reservado = Math.round(CAPACIDADE_DIAS_MES * RESERVA_DEMANDA);
  return MESES.map((_, mes) => {
    const doMes = obrigacoes.filter((o) => mesDe(o) === mes);
    const provisionado = doMes.reduce((s, o) => s + o.cargaDias, 0);
    return {
      mes,
      provisionado,
      reservado,
      percentual: Math.min(100, Math.round(((provisionado + reservado) / CAPACIDADE_DIAS_MES) * 100)),
      obrigacoes: doMes,
    };
  });
}

// ── feed ICS ────────────────────────────────────────────────────────────────

/**
 * O token do feed (Risco-036).
 *
 * O feed é lido por um cliente de calendário que não tem sessão e não manda
 * cabeçalho: a URL **é** a credencial, como em qualquer ICS. Isso é do
 * protocolo. O que era defeito nosso, e o PR 5 corrige, são quatro coisas:
 *
 * 1. **o segredo estava no código** — `'lastro-ics-demo'`, literal, e portanto
 *    dentro de `dist/assets/*.js`. Quem abrisse o DevTools mintava o feed de
 *    qualquer papel. Agora ele nasce por instância do banco, de bytes
 *    aleatórios, e nunca é literal em lugar nenhum;
 * 2. **não vencia** — assinatura de papel, válida para sempre. Agora o prazo
 *    entra no token e é conferido na hora;
 * 3. **ia na query string** — `?papel=dpo&token=…`, que é onde credencial vaza
 *    por `Referer` e por log de proxy que não normaliza query. Agora vai no
 *    caminho, como Google e Outlook fazem. O caminho também é registrado em
 *    log: o que isso compra é menos superfície, não sigilo — e vale dizer;
 * 4. **estava truncada em 16 hex** (64 bits). Agora é o digest inteiro.
 *
 * O segredo por instância tem um efeito colateral que é demonstração, não
 * acidente: reiniciar rotaciona o segredo e **revoga todos os feeds** — que é
 * exatamente o mecanismo que o comentário antigo prometia para "um backend de
 * verdade".
 */
export const VALIDADE_DO_FEED_MS = 30 * 24 * 60 * 60_000;

/**
 * Bytes de verdade, e sem plano B.
 *
 * Se `crypto` não existir, isto lança. Um `catch` que caísse para uma constante
 * reintroduziria o defeito exatamente onde ninguém olharia de novo — e um
 * segredo que só às vezes é segredo não é segredo.
 */
export function novoSegredoDeFeed(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `papel.expiraEmMs.assinatura` — tudo o que a verificação precisa, e nada além. */
export const tokenDoFeed = (
  segredo: string, papel: string, expiraEmMs: number, sha256: (s: string) => string,
): string => `${papel}.${expiraEmMs}.${sha256(`${segredo}|${papel}|${expiraEmMs}`)}`;

/**
 * Devolve o papel quando o token é válido **nesta hora**, e `null` para tudo
 * mais — assinatura errada, prazo vencido, formato estranho.
 *
 * Uma recusa só, sem dizer qual das três: distinguir "expirou" de "assinatura
 * inválida" diria a quem tenta forjar o que ele acertou.
 */
export function papelDoTokenDeFeed(
  segredo: string, token: string, agoraMs: number, sha256: (s: string) => string,
): string | null {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [papel, expira, assinatura] = partes;
  const expiraEmMs = Number(expira);
  if (!Number.isFinite(expiraEmMs) || expiraEmMs <= agoraMs) return null;
  if (assinatura !== sha256(`${segredo}|${papel}|${expiraEmMs}`)) return null;
  return papel;
}

/** Escapa TEXT conforme a RFC 5545 §3.3.11. */
const escapar = (t: string): string =>
  t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** Dobra a linha em 75 octetos, como manda a RFC 5545 §3.1. */
const dobrar = (linha: string): string => {
  if (linha.length <= 73) return linha;
  const partes = [linha.slice(0, 73)];
  for (let i = 73; i < linha.length; i += 72) partes.push(` ${linha.slice(i, i + 72)}`);
  return partes.join('\r\n');
};

/**
 * O feed, somente leitura.
 *
 * O que sai: código, tipo, a consequência declarada e o link de volta. O que
 * **não** sai, e é a regra 3 da sincronização: nada por demanda — incidente,
 * pedido de titular e achado ficam dentro da plataforma — e nenhum dado pessoal,
 * nem convidado. Calendário corporativo é infraestrutura de terceiro: o que sai
 * dele não volta.
 *
 * Sem `ATTENDEE`, apesar de o MAPA falar em "compromisso vira evento com
 * convidados": endereço de pessoa é dado pessoal, e num feed assinado por papel
 * o convidado é quem assinou. Quem quiser convidar mais gente convida no próprio
 * cliente, que é onde essa informação já mora.
 */
export function paraIcs(obrigacoes: Obrigacao[], papel: string, base: string): string {
  const semTraco = (d: string) => d.replace(/-/g, '');
  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lastro//Calendario de governanca//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapar(`Lastro · obrigações de ${papel}`)}`,
    // Somente leitura declarada no próprio feed: mover a data no cliente não
    // volta para cá, e o consumidor precisa saber disso antes de tentar.
    'X-PUBLISHED-TTL:PT12H',
    'X-WR-CALDESC:Feed somente leitura. Este calendario e a fonte: mover a data '
      + 'no cliente nao altera o prazo na plataforma.',
  ];

  for (const o of obrigacoes) {
    linhas.push(
      'BEGIN:VEVENT',
      `UID:${o.codigo}@lastro`,
      `DTSTART;VALUE=DATE:${semTraco(o.vence)}`,
      `DTEND;VALUE=DATE:${semTraco(o.vence)}`,
      `SUMMARY:${escapar(`[${o.tipo}] ${o.codigo} · ${o.titulo}`)}`,
      `DESCRIPTION:${escapar(`Se passar: ${o.seFalhar}\nPreparar: ${o.preparar}`)}`,
      `CATEGORIES:${o.trilha}`,
      `URL:${base}#${o.tela}?obrigacao=${o.codigo}`,
      // Prazo é dia inteiro marcado como prazo; compromisso é dia inteiro que
      // ocupa a agenda. Nenhum dos dois carrega convidado.
      o.tipo === 'prazo' ? 'TRANSP:TRANSPARENT' : 'TRANSP:OPAQUE',
      'CLASS:PUBLIC',
      'END:VEVENT',
    );
  }

  linhas.push('END:VCALENDAR');
  return linhas.map(dobrar).join('\r\n');
}
