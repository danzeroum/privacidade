import { readFileSync } from 'fs';
import { join } from 'path';
import type { Teste, Valor } from '../src/mock/decisoes';

/**
 * Conformidade entre a especificação (`docs/processos/*.bpmn` e `*.dmn`) e o
 * runtime (`mock/estados.ts` e `mock/decisoes.ts`).
 *
 * Este arquivo é **ferramenta de conferência**, não código de produção: mora em
 * `tests/` de propósito, e nada em `src/` o importa. O que roda em produção
 * continua sendo o `.ts`; o XML é a especificação conferida, e não uma segunda
 * fonte de verdade que alguém precisaria manter carregada.
 *
 * A catraca funciona nas **duas** direções, e é isso que a torna útil: aresta
 * nova em `estados.ts` sem atualizar o `.bpmn` reprova, e aresta apagada do
 * `.bpmn` sem tirar do runtime reprova também. Um teste que só olhasse para um
 * lado deixaria o documento envelhecer em silêncio, que é o problema que este
 * PR existe para fechar.
 */

const RAIZ = join('..', 'docs', 'processos');

export const lerProcesso = (nome: string): Document => {
  const xml = readFileSync(join(RAIZ, nome), 'utf8');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const erro = doc.querySelector('parsererror');
  if (erro) throw new Error(`${nome} não é XML válido: ${erro.textContent}`);
  return doc;
};

// ── BPMN ────────────────────────────────────────────────────────────────────

export interface LeituraBpmn {
  /** Ids das `<task>`: os estados do artefato. */
  estados: string[];
  /** Pares `de→para` entre tasks: as transições legais. */
  arestas: string[];
  /** Estado para onde o `<startEvent>` aponta. */
  inicial: string | null;
  /** Estados com fluxo para um `<endEvent>`: os finais declarados. */
  finais: string[];
}

const filhos = (doc: Document, tag: string): Element[] =>
  [...doc.getElementsByTagName('*')].filter((e) => e.localName === tag);

export function lerBpmn(nome: string): LeituraBpmn {
  const doc = lerProcesso(nome);
  const tasks = new Set(filhos(doc, 'task').map((t) => t.getAttribute('id') ?? ''));
  const eventosFim = new Set(filhos(doc, 'endEvent').map((e) => e.getAttribute('id') ?? ''));
  const eventosInicio = new Set(filhos(doc, 'startEvent').map((e) => e.getAttribute('id') ?? ''));

  const arestas: string[] = [];
  const finais: string[] = [];
  let inicial: string | null = null;

  for (const f of filhos(doc, 'sequenceFlow')) {
    const de = f.getAttribute('sourceRef') ?? '';
    const para = f.getAttribute('targetRef') ?? '';
    if (tasks.has(de) && tasks.has(para)) arestas.push(`${de}→${para}`);
    else if (eventosInicio.has(de) && tasks.has(para)) inicial = para;
    else if (tasks.has(de) && eventosFim.has(para)) finais.push(de);
  }

  return { estados: [...tasks], arestas, inicial, finais };
}

/** O que difere entre o desenho e o código, nomeado dos dois lados. */
export function divergenciasBpmn(
  leitura: LeituraBpmn,
  maquina: Record<string, string[]>,
): string[] {
  const doCodigo = Object.keys(maquina);
  const arestasDoCodigo = doCodigo.flatMap((de) => maquina[de].map((para) => `${de}→${para}`));
  const finaisDoCodigo = doCodigo.filter((e) => maquina[e].length === 0);

  const faltando = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));
  const d: string[] = [];

  for (const e of faltando(doCodigo, leitura.estados)) d.push(`estado "${e}" existe no runtime e não no .bpmn`);
  for (const e of faltando(leitura.estados, doCodigo)) d.push(`estado "${e}" existe no .bpmn e não no runtime`);
  for (const a of faltando(arestasDoCodigo, leitura.arestas)) d.push(`transição ${a} existe no runtime e não no .bpmn`);
  for (const a of faltando(leitura.arestas, arestasDoCodigo)) d.push(`transição ${a} existe no .bpmn e não no runtime`);
  for (const e of faltando(finaisDoCodigo, leitura.finais)) d.push(`estado final "${e}" não tem evento de fim no .bpmn`);
  for (const e of faltando(leitura.finais, finaisDoCodigo)) d.push(`"${e}" tem evento de fim no .bpmn e não é final no runtime`);
  if (leitura.inicial !== doCodigo[0]) {
    d.push(`o .bpmn começa em "${leitura.inicial}" e o runtime declara "${doCodigo[0]}" como primeiro estado`);
  }
  return d;
}

// ── DMN ─────────────────────────────────────────────────────────────────────

export interface RegraDmn {
  quando: Record<string, Teste>;
  entao: Record<string, string | number | boolean>;
}

export interface LeituraDmn {
  campos: string[];
  saidas: string[];
  regras: RegraDmn[];
  hitPolicy: string;
}

/**
 * O subconjunto de FEEL que a tabela usa, e só ele.
 *
 * Um parser generoso aceitaria expressões que o runtime não sabe executar, e a
 * conformidade passaria a comparar duas coisas diferentes. Entrada fora deste
 * vocabulário estoura — melhor falhar alto do que conferir o que não se entende.
 */
export function lerEntrada(texto: string): Teste | null {
  const t = texto.trim();
  if (t === '-' || t === '') return null;
  if (t.startsWith('>=')) return { min: Number(t.slice(2)) };
  if (t.startsWith('<=')) return { max: Number(t.slice(2)) };
  const contem = t.match(/^list contains\(\?,\s*"([^"]+)"\)$/);
  if (contem) return { contem: contem[1] };
  if (/^(true|false)(,(true|false))*$/.test(t)) return { em: t.split(',').map((x) => x === 'true') };
  if (/^"[^"]*"(,"[^"]*")*$/.test(t)) return { em: t.split(',').map((x) => x.slice(1, -1)) };
  throw new Error(`Entrada FEEL fora do vocabulário conferível: ${texto}`);
}

const lerSaida = (texto: string): string | number | boolean => {
  const t = texto.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t.startsWith('"')) return t.slice(1, -1);
  return Number(t);
};

export function lerDmn(nome: string): LeituraDmn {
  const doc = lerProcesso(nome);
  const tabela = filhos(doc, 'decisionTable')[0];
  const campos = filhos(doc, 'input').map((i) => i.getAttribute('label') ?? '');
  const saidas = filhos(doc, 'output').map((o) => o.getAttribute('label') ?? '');

  const regras = filhos(doc, 'rule').map((r) => {
    const entradas = [...r.children].filter((c) => c.localName === 'inputEntry');
    const saidasXml = [...r.children].filter((c) => c.localName === 'outputEntry');
    const quando: Record<string, Teste> = {};
    entradas.forEach((e, i) => {
      const teste = lerEntrada(e.textContent ?? '');
      if (teste) quando[campos[i]] = teste;
    });
    const entao: Record<string, string | number | boolean> = {};
    saidasXml.forEach((s, i) => { entao[saidas[i]] = lerSaida(s.textContent ?? ''); });
    return { quando, entao };
  });

  return { campos, saidas, regras, hitPolicy: tabela?.getAttribute('hitPolicy') ?? '' };
}

/**
 * Executa a tabela lida do XML. É a reimplementação mínima do motor, e o ponto
 * é justamente esse: se ela e o `aplicar()` concordarem em toda entrada, o
 * documento descreve o que o código faz.
 */
export function aplicarDmn(leitura: LeituraDmn, entradas: Record<string, Valor>): Record<string, unknown> | null {
  const casa = (valor: Valor | undefined, t: Teste): boolean => {
    if (valor === undefined) return false;
    if ('em' in t) return t.em.includes(valor as string | number | boolean);
    if ('min' in t) return typeof valor === 'number' && valor >= t.min;
    if ('max' in t) return typeof valor === 'number' && valor <= t.max;
    return Array.isArray(valor) && valor.includes(t.contem);
  };
  const regra = leitura.regras.find(
    (r) => Object.entries(r.quando).every(([campo, teste]) => casa(entradas[campo], teste)),
  );
  return regra ? regra.entao : null;
}

/**
 * O domínio de varredura, derivado da própria tabela.
 *
 * Para cada campo: os valores citados nas regras, mais as fronteiras dos limiares
 * numéricos (n-1, n, n+1) e o zero. Deriva em vez de listar à mão para que um
 * limiar novo entre na varredura sozinho — lista escrita ao lado da tabela é a
 * próxima coisa a envelhecer.
 */
export function dominioDe(leitura: LeituraDmn, restritivo: Record<string, Valor>): Record<string, Valor[]> {
  const dominio: Record<string, Valor[]> = {};
  for (const campo of leitura.campos) {
    const valores = new Set<string>();
    const brutos: Valor[] = [];
    const guardar = (v: Valor) => {
      const chave = JSON.stringify(v);
      if (!valores.has(chave)) { valores.add(chave); brutos.push(v); }
    };
    guardar(restritivo[campo]);
    for (const r of leitura.regras) {
      const t = r.quando[campo];
      if (!t) continue;
      if ('em' in t) t.em.forEach((v) => guardar(v as Valor));
      if ('min' in t) [t.min - 1, t.min, t.min + 1].forEach(guardar);
      if ('max' in t) [t.max - 1, t.max, t.max + 1].forEach(guardar);
      if ('contem' in t) { guardar([t.contem]); guardar([]); }
    }
    if (typeof restritivo[campo] === 'number') guardar(0);
    if (typeof restritivo[campo] === 'boolean') { guardar(true); guardar(false); }
    dominio[campo] = brutos;
  }
  return dominio;
}

/** Produto cartesiano do domínio: toda combinação que a varredura precisa cobrir. */
export function combinacoes(dominio: Record<string, Valor[]>): Record<string, Valor>[] {
  return Object.entries(dominio).reduce<Record<string, Valor>[]>(
    (acc, [campo, valores]) => acc.flatMap((base) => valores.map((v) => ({ ...base, [campo]: v }))),
    [{}],
  );
}
