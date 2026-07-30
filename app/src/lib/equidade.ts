import { parse } from 'yaml';

/**
 * Teste de disparidade como artefato executável (Risco-007).
 *
 * A LIA-SCORING-001 cita três mitigações — teste de disparate impact, remoção de
 * features proxy e AIA — e o RIPD §5 usa as duas primeiras no balanceamento do
 * Art. 10 §3º. Enquanto elas eram texto de seed, a base legal se apoiava em
 * prova que ninguém conseguia apresentar. Este módulo é a primeira e a segunda;
 * a AIA continua sem instrumento, e isso está declarado no PR e na tabela.
 *
 * ## O que ele mede, e o que não
 *
 * Não há modelo neste repositório. Ele mede **decisões agregadas por grupo,
 * versionadas em `.privacy/equidade-decisoes.csv`**, contra o piso declarado em
 * `.privacy/equidade.yaml`. É por isso que `natureza` sai em toda execução,
 * verde inclusive: "aprovado" aqui significa "esta massa, sob este piso" e nada
 * além. Nenhuma saída deste arquivo diz que o modelo é justo, porque nenhuma
 * medição feita aqui autoriza dizer isso.
 *
 * ## Puro, e por quê
 *
 * Nada de `fs`. Quem lê arquivo é `scripts/equidade.ts` no pipeline e
 * `mock/equidade.ts` no protótipo, **pelos mesmos bytes** — o teste de paridade
 * cobra que os dois cheguem à mesma razão. Um número calculado de dois jeitos é
 * um número que vai divergir, e a divergência apareceria como "a tela diz outra
 * coisa" muito depois de ter deixado de importar qual das duas estava certa.
 */

export interface AchadoDeEquidade {
  /** Família/caso, como no gate: `disparidade/abaixo-do-piso`, `proxy/em-fator`. */
  regra: string;
  mensagem: string;
  arquivo: string;
  linha?: number;
}

export interface ProxyRemovido {
  termo: string;
  porQue: string;
}

export interface ContratoDeEquidade {
  versao: number;
  natureza: string;
  lia: string;
  metrica: {
    nome: string;
    definicao: string;
    /** O piso em milésimos: inteiro, para a comparação nunca tocar em float. */
    pisoMilesimos: number;
    fundamentoDoPiso: string;
    minimoPorGrupo: number;
  };
  atributoDeGrupo: { nome: string; valores: string[]; porQuePermanece: string };
  fatoresDoModelo: { modelo: string; declarados: string[]; varrer: string[] };
  proxiesRemovidos: ProxyRemovido[];
  massa: string;
}

export interface TaxaDeGrupo {
  grupo: string;
  total: number;
  aprovadas: number;
}

export interface Medicao {
  grupos: TaxaDeGrupo[];
  menor: TaxaDeGrupo;
  maior: TaxaDeGrupo;
  /** Só para exibir. A decisão é `atendePiso`, tomada em inteiros. */
  razaoMilesimos: number;
  pisoMilesimos: number;
  atendePiso: boolean;
}

export interface ResultadoDeEquidade {
  aprovado: boolean;
  achados: AchadoDeEquidade[];
  /** `null` quando não houve o que medir — e nesse caso `aprovado` é falso. */
  medicao: Medicao | null;
  /** Repetida aqui para o relatório imprimi-la sem reler o contrato. */
  natureza: string;
  fatoresVarridos: number;
  arquivosVarridos: number;
}

export type Leitor = (relativo: string) => string | null;

// ── contrato ────────────────────────────────────────────────────────────────

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const inteiro = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/**
 * O piso vira inteiro na leitura, e mais de três decimais é recusado.
 *
 * `0.80` não tem representação binária exata, e é exatamente na fronteira que
 * você quer confiar no número: `taxa >= 0.80` em ponto flutuante é onde
 * "0,80 exato passa" deixa de ser verdade sem ninguém perceber. Aqui o valor é
 * convertido uma vez, com `Math.round`, e daí para frente só existe aritmética
 * inteira. A recusa acima de três decimais impede que um `0.8005` seja truncado
 * em silêncio para o mesmo 800 — arredondar o limiar de outra pessoa é decidir
 * por ela.
 */
export function pisoEmMilesimos(valor: unknown): number | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > 1) return null;
  const milesimos = Math.round(valor * 1000);
  if (Math.abs(valor * 1000 - milesimos) > 1e-6) return null;
  return milesimos;
}

export type LeituraDoContrato =
  | { ok: true; contrato: ContratoDeEquidade }
  | { ok: false; achados: AchadoDeEquidade[] };

/**
 * Lê o contrato de um texto YAML. Campo faltando reprova, e nomeia qual.
 *
 * Falha fechada em toda porta: sem isto, um arquivo truncado produziria piso
 * zero e uma aprovação que não olhou nada — a vacuidade que o Risco-003 fechou
 * no gate, aqui de novo.
 */
export function lerContrato(bruto: string, arquivo: string): LeituraDoContrato {
  const achados: AchadoDeEquidade[] = [];
  const falta = (campo: string, porQue: string) =>
    achados.push({ regra: 'contrato/campo-ausente', arquivo, mensagem: `${campo}: ${porQue}` });

  let doc: Record<string, any>;
  try {
    doc = (parse(bruto) ?? {}) as Record<string, any>;
  } catch (e) {
    return {
      ok: false,
      achados: [{
        regra: 'contrato/ilegivel',
        arquivo,
        mensagem: `não é YAML válido (${e instanceof Error ? e.message.split('\n')[0] : 'erro'}). `
          + 'Contrato ilegível reprova em vez de virar contrato vazio.',
      }],
    };
  }
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    return {
      ok: false,
      achados: [{ regra: 'contrato/ilegivel', arquivo, mensagem: 'o YAML não é um mapa de campos.' }],
    };
  }

  const natureza = texto(doc.natureza);
  if (natureza.length < 40) {
    falta('natureza', 'o relatório imprime esta frase em toda execução; sem ela o verde é lido '
      + 'como "o modelo é justo", que é o que nenhuma medição daqui autoriza');
  }

  const lia = texto(doc.lia);
  if (!lia) falta('lia', 'sem o código da LIA o estouro do piso não derruba nada');

  const m = (doc.metrica ?? {}) as Record<string, any>;
  const pisoMilesimos = pisoEmMilesimos(m.piso);
  if (pisoMilesimos === null) {
    falta('metrica.piso', 'precisa ser um decimal entre 0 e 1 com até três casas — '
      + 'arredondar o limiar em silêncio é decidir pelo autor dele');
  }
  const minimoPorGrupo = inteiro(m.minimo_por_grupo);
  if (minimoPorGrupo === null || minimoPorGrupo < 1) {
    falta('metrica.minimo_por_grupo', 'razão sobre punhado de decisões é ruído com aparência de medida');
  }

  const g = (doc.atributo_de_grupo ?? {}) as Record<string, any>;
  const valores = Array.isArray(g.valores) ? g.valores.map(texto).filter(Boolean) : [];
  if (!texto(g.nome)) falta('atributo_de_grupo.nome', 'não se mede disparidade sem o atributo protegido');
  if (valores.length < 2) {
    falta('atributo_de_grupo.valores', 'com menos de dois grupos não existe razão entre grupos');
  }

  const f = (doc.fatores_do_modelo ?? {}) as Record<string, any>;
  const declarados = Array.isArray(f.declarados) ? f.declarados.map(texto).filter(Boolean) : [];
  const varrer = Array.isArray(f.varrer) ? f.varrer.map(texto).filter(Boolean) : [];
  if (declarados.length === 0) falta('fatores_do_modelo.declarados', 'lista fechada de fatores, e ela está vazia');
  if (varrer.length === 0) {
    falta('fatores_do_modelo.varrer', 'sem caminho para varrer, a regra de proxy não olha lugar nenhum');
  }

  const proxies: ProxyRemovido[] = Array.isArray(doc.proxies_removidos)
    ? doc.proxies_removidos
      .map((p: any) => ({ termo: texto(p?.termo), porQue: texto(p?.por_que) }))
      .filter((p: ProxyRemovido) => p.termo)
    : [];
  if (proxies.length === 0) {
    falta('proxies_removidos', 'a lista é fechada e visível no diff; vazia, a regra aprova qualquer fator');
  }
  for (const p of proxies) {
    if (p.porQue.length < 20) {
      falta(`proxies_removidos[${p.termo}].por_que`, 'proxy sem motivo escrito é item que ninguém revisa');
    }
  }

  const massa = texto(doc.massa);
  if (!massa) falta('massa', 'sem caminho da massa não há o que medir');

  if (achados.length > 0) return { ok: false, achados };

  return {
    ok: true,
    contrato: {
      versao: inteiro(doc.versao) ?? 1,
      natureza,
      lia,
      metrica: {
        nome: texto(m.nome) || 'razao_de_aprovacao',
        definicao: texto(m.definicao),
        pisoMilesimos: pisoMilesimos!,
        fundamentoDoPiso: texto(m.fundamento_do_piso),
        minimoPorGrupo: minimoPorGrupo!,
      },
      atributoDeGrupo: { nome: texto(g.nome), valores, porQuePermanece: texto(g.por_que_permanece) },
      fatoresDoModelo: { modelo: texto(f.modelo), declarados, varrer },
      proxiesRemovidos: proxies,
      massa,
    },
  };
}

// ── massa ───────────────────────────────────────────────────────────────────

export const CABECALHO_DA_MASSA = 'grupo,total,aprovadas';

export type LeituraDaMassa =
  | { ok: true; grupos: TaxaDeGrupo[] }
  | { ok: false; achados: AchadoDeEquidade[] };

/**
 * Lê o CSV agregado. `split(/\r?\n/)` porque o #36 já ensinou o preço de não
 * fazer isso: num clone Windows cada campo termina com um `\r` invisível e
 * `'221\r'` deixa de ser número sem nenhuma mensagem de erro.
 */
export function lerMassa(bruto: string, arquivo: string): LeituraDaMassa {
  const achados: AchadoDeEquidade[] = [];
  const linhas = bruto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');

  if (linhas.length === 0 || linhas[0] !== CABECALHO_DA_MASSA) {
    return {
      ok: false,
      achados: [{
        regra: 'massa/cabecalho',
        arquivo,
        linha: 1,
        mensagem: `esperava exatamente "${CABECALHO_DA_MASSA}", achei "${linhas[0] ?? '(vazio)'}".`,
      }],
    };
  }

  const grupos: TaxaDeGrupo[] = [];
  const vistos = new Set<string>();
  for (let i = 1; i < linhas.length; i += 1) {
    const linha = i + 1;
    const partes = linhas[i].split(',');
    if (partes.length !== 3) {
      achados.push({ regra: 'massa/colunas', arquivo, linha, mensagem: `esperava 3 colunas, achei ${partes.length}.` });
      continue;
    }
    const [grupo, totalBruto, aprovadasBruto] = partes.map((p) => p.trim());
    if (!/^\d+$/.test(totalBruto) || !/^\d+$/.test(aprovadasBruto)) {
      achados.push({
        regra: 'massa/nao-inteiro',
        arquivo,
        linha,
        mensagem: `total e aprovadas precisam ser inteiros; achei "${totalBruto}" e "${aprovadasBruto}".`,
      });
      continue;
    }
    const total = Number(totalBruto);
    const aprovadas = Number(aprovadasBruto);
    if (aprovadas > total) {
      achados.push({
        regra: 'massa/aprovadas-acima-do-total',
        arquivo,
        linha,
        mensagem: `${grupo}: ${aprovadas} aprovadas em ${total} decisões é impossível.`,
      });
      continue;
    }
    if (vistos.has(grupo)) {
      // Duas linhas do mesmo grupo: a segunda venceria a primeira em silêncio, e
      // a massa passaria a medir metade do que declara.
      achados.push({ regra: 'massa/grupo-repetido', arquivo, linha, mensagem: `${grupo} aparece mais de uma vez.` });
      continue;
    }
    vistos.add(grupo);
    grupos.push({ grupo, total, aprovadas });
  }

  if (achados.length > 0) return { ok: false, achados };
  return { ok: true, grupos };
}

// ── medição ─────────────────────────────────────────────────────────────────

/** `a1/t1` vs `a2/t2` sem divisão: o produto cruzado decide. */
const menorTaxa = (a: TaxaDeGrupo, b: TaxaDeGrupo): boolean => a.aprovadas * b.total < b.aprovadas * a.total;

export type Afericao =
  | { ok: true; medicao: Medicao }
  | { ok: false; achados: AchadoDeEquidade[] };

/**
 * A razão, e a decisão sobre o piso — tudo em inteiros.
 *
 * `menor/maior ≥ piso` vira `aMin · tMax · 1000 ≥ piso‰ · tMin · aMax`. É a
 * mesma desigualdade sem uma única divisão, e é o que faz "0,80 exato passa" ser
 * verdade em vez de sorte: com `Number`, `221/340 / (300/400)` e `0.8` são dois
 * arredondamentos diferentes de dois números que ninguém escolheu.
 */
export function medir(
  grupos: TaxaDeGrupo[], contrato: ContratoDeEquidade, arquivo: string,
): Afericao {
  const achados: AchadoDeEquidade[] = [];
  const declarados = new Set(contrato.atributoDeGrupo.valores);
  const presentes = new Set(grupos.map((g) => g.grupo));

  for (const g of grupos) {
    if (!declarados.has(g.grupo)) {
      achados.push({
        regra: 'massa/grupo-nao-declarado',
        arquivo,
        mensagem: `"${g.grupo}" não está em atributo_de_grupo.valores — grupo que o contrato não conhece `
          + 'entra na razão sem ninguém ter decidido que ele deveria.',
      });
    }
  }
  // O outro sentido: grupo declarado e ausente da massa sairia da medição em
  // silêncio, e a razão passaria a ser entre os grupos que sobraram.
  for (const valor of contrato.atributoDeGrupo.valores) {
    if (!presentes.has(valor)) {
      achados.push({
        regra: 'massa/grupo-declarado-ausente',
        arquivo,
        mensagem: `"${valor}" está declarado no contrato e não aparece na massa.`,
      });
    }
  }

  if (grupos.length < 2) {
    achados.push({
      regra: 'massa/vacuidade',
      arquivo,
      mensagem: `${grupos.length} grupo(s) na massa: razão entre grupos exige pelo menos dois. `
        + 'Um grupo só produziria 1,000 e um verde que não olhou nada.',
    });
  }

  for (const g of grupos) {
    if (g.total < contrato.metrica.minimoPorGrupo) {
      achados.push({
        regra: 'massa/amostra-pequena',
        arquivo,
        mensagem: `${g.grupo}: ${g.total} decisões, abaixo do mínimo de ${contrato.metrica.minimoPorGrupo}. `
          + 'Razão sobre amostra pequena é ruído com aparência de medida.',
      });
    }
  }

  if (achados.length > 0) return { ok: false, achados };

  const ordenados = [...grupos].sort((a, b) => (menorTaxa(a, b) ? -1 : menorTaxa(b, a) ? 1 : 0));
  const menor = ordenados[0];
  const maior = ordenados[ordenados.length - 1];

  if (maior.aprovadas === 0) {
    return {
      ok: false,
      achados: [{
        regra: 'massa/nenhuma-aprovacao',
        arquivo,
        mensagem: 'nenhum grupo tem decisão aprovada: a razão seria 0/0. Recusa uniforme não é paridade.',
      }],
    };
  }

  const esquerda = menor.aprovadas * maior.total * 1000;
  const direita = contrato.metrica.pisoMilesimos * menor.total * maior.aprovadas;

  return {
    ok: true,
    medicao: {
      grupos,
      menor,
      maior,
      razaoMilesimos: Math.round((menor.aprovadas * maior.total * 1000) / (menor.total * maior.aprovadas)),
      pisoMilesimos: contrato.metrica.pisoMilesimos,
      atendePiso: esquerda >= direita,
    },
  };
}

// ── proxies nos fatores ─────────────────────────────────────────────────────

/**
 * Normaliza para tokens: minúsculas, sem acento, separadores fora.
 *
 * É a normalização que faz `nome_mae` e "nome da mãe" serem o mesmo proxy, e é
 * o que impede `recepcao` de casar `cep`. Um `includes('cep')` casaria
 * `recepcao`, `conceito` e `exceptional` — e vermelho falso ensina a equipe a
 * ignorar justamente este teste.
 */
export const tokens = (valor: string): string[] =>
  valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // `nomeDaMae` é o mesmo proxy que `nome_mae`, e nome de feature em código
    // costuma vir em camelCase. A quebra vem antes do `toLowerCase`, senão a
    // fronteira entre as palavras já teria sido apagada.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** O termo aparece como sequência consecutiva de tokens? */
export function casaProxy(valor: string, termo: string): boolean {
  const alvo = tokens(termo);
  if (alvo.length === 0) return false;
  const t = tokens(valor);
  // Palavras de ligação fora: "nome da mãe" tem o mesmo proxy que `nome_mae`, e
  // exigir o `da` no meio deixaria a variante escrita passar.
  const uteis = t.filter((x) => !['da', 'de', 'do', 'das', 'dos'].includes(x));
  for (let i = 0; i + alvo.length <= uteis.length; i += 1) {
    if (alvo.every((a, j) => uteis[i + j] === a)) return true;
  }
  return false;
}

const FATOR = /feature\s*:\s*'([^']*)'|feature\s*:\s*"([^"]*)"/g;

export interface FatorEncontrado {
  nome: string;
  arquivo: string;
  linha: number;
}

/**
 * Onde um fator entra é `feature:` — e é só isso que a varredura lê.
 *
 * Varrer o arquivo inteiro reprovaria a própria frase que declara a remoção dos
 * proxies ("removidas as features cep, nome_mae e canal_atendimento"), que vive
 * neste repositório de propósito. Foi o defeito que o PR 4 cometeu contra o
 * comentário do próprio gate: a declaração não é a infração, e uma regra que
 * não distingue as duas obriga a inventar exceção por arquivo.
 */
export function varrerFatores(contrato: ContratoDeEquidade, ler: Leitor): {
  achados: AchadoDeEquidade[];
  fatores: FatorEncontrado[];
  arquivosVarridos: number;
} {
  const achados: AchadoDeEquidade[] = [];
  const fatores: FatorEncontrado[] = [];
  let arquivosVarridos = 0;

  for (const caminho of contrato.fatoresDoModelo.varrer) {
    const conteudo = ler(caminho);
    if (conteudo === null) {
      achados.push({
        regra: 'fatores/caminho-ilegivel',
        arquivo: caminho,
        mensagem: 'declarado em fatores_do_modelo.varrer e não pôde ser lido. '
          + 'Varredura que não abre o arquivo aprova por não ter olhado.',
      });
      continue;
    }
    arquivosVarridos += 1;
    const linhas = conteudo.split(/\r?\n/);
    for (let i = 0; i < linhas.length; i += 1) {
      for (const m of linhas[i].matchAll(FATOR)) {
        const nome = (m[1] ?? m[2] ?? '').trim();
        if (nome) fatores.push({ nome, arquivo: caminho, linha: i + 1 });
      }
    }
  }

  if (achados.length === 0 && fatores.length === 0) {
    achados.push({
      regra: 'fatores/nenhum-encontrado',
      arquivo: contrato.fatoresDoModelo.varrer.join(', '),
      mensagem: 'nenhuma ocorrência de `feature:` nos caminhos declarados: a regra de proxy '
        + 'não teria como reprovar nada, e o verde não significaria nada.',
    });
  }

  const declarados = new Set(contrato.fatoresDoModelo.declarados);
  const encontrados = new Set(fatores.map((f) => f.nome));

  for (const f of fatores) {
    for (const p of contrato.proxiesRemovidos) {
      if (casaProxy(f.nome, p.termo)) {
        achados.push({
          regra: 'proxy/em-fator',
          arquivo: f.arquivo,
          linha: f.linha,
          mensagem: `o fator "${f.nome}" casa o proxy "${p.termo}", declarado como removido. `
            + p.porQue.replace(/\s+/g, ' ').trim(),
        });
      }
    }
    if (!declarados.has(f.nome)) {
      achados.push({
        regra: 'fatores/nao-declarado',
        arquivo: f.arquivo,
        linha: f.linha,
        mensagem: `o fator "${f.nome}" não está em fatores_do_modelo.declarados — `
          + 'a lista é fechada justamente para o fator novo ter de passar por revisão.',
      });
    }
  }

  // Declaração morta: o mesmo defeito que o gate cobra no inventário de PII.
  for (const nome of contrato.fatoresDoModelo.declarados) {
    if (!encontrados.has(nome)) {
      achados.push({
        regra: 'fatores/declaracao-morta',
        arquivo: '.privacy/equidade.yaml',
        mensagem: `"${nome}" está declarado como fator e não aparece em nenhum caminho varrido. `
          + 'Lista que não corresponde ao fonte deixa de ser fechada sem ninguém notar.',
      });
    }
  }

  return { achados, fatores, arquivosVarridos };
}

// ── o artefato inteiro ──────────────────────────────────────────────────────

export const CAMINHO_DO_CONTRATO = '.privacy/equidade.yaml';

/**
 * Roda o teste inteiro a partir de um leitor. Sem `fs`, para o pipeline e o
 * protótipo entrarem pela mesma porta.
 */
export function rodarEquidade(ler: Leitor): ResultadoDeEquidade {
  const semNatureza = 'Contrato ilegível: a natureza da medição não pôde ser lida.';
  const bruto = ler(CAMINHO_DO_CONTRATO);
  if (bruto === null) {
    return {
      aprovado: false,
      achados: [{
        regra: 'contrato/ausente',
        arquivo: CAMINHO_DO_CONTRATO,
        mensagem: 'o contrato do teste de disparidade não existe. Ausente reprova em vez de passar '
          + 'por omissão — é o Risco-003 com outro nome.',
      }],
      medicao: null,
      natureza: semNatureza,
      fatoresVarridos: 0,
      arquivosVarridos: 0,
    };
  }

  const leitura = lerContrato(bruto, CAMINHO_DO_CONTRATO);
  if (!leitura.ok) {
    return {
      aprovado: false,
      achados: leitura.achados,
      medicao: null,
      natureza: semNatureza,
      fatoresVarridos: 0,
      arquivosVarridos: 0,
    };
  }
  const contrato = leitura.contrato;

  const achados: AchadoDeEquidade[] = [];
  const varredura = varrerFatores(contrato, ler);
  achados.push(...varredura.achados);

  let medicao: Medicao | null = null;
  const brutoDaMassa = ler(contrato.massa);
  if (brutoDaMassa === null) {
    achados.push({
      regra: 'massa/ausente',
      arquivo: contrato.massa,
      mensagem: 'a massa declarada no contrato não existe. Sem massa não há medição, e sem medição '
        + 'não há aprovação.',
    });
  } else {
    const lidaMassa = lerMassa(brutoDaMassa, contrato.massa);
    if (!lidaMassa.ok) achados.push(...lidaMassa.achados);
    else {
      const aferida = medir(lidaMassa.grupos, contrato, contrato.massa);
      if (!aferida.ok) achados.push(...aferida.achados);
      else {
        medicao = aferida.medicao;
        if (!medicao.atendePiso) {
          achados.push({
            regra: 'disparidade/abaixo-do-piso',
            arquivo: contrato.massa,
            mensagem: descreverDisparidade(medicao),
          });
        }
      }
    }
  }

  return {
    aprovado: achados.length === 0,
    achados,
    medicao,
    natureza: contrato.natureza,
    fatoresVarridos: varredura.fatores.length,
    arquivosVarridos: varredura.arquivosVarridos,
  };
}

const porMil = (n: number): string => (n / 1000).toFixed(3).replace('.', ',');

/** A frase que nomeia grupos e razão — recusa sem número não é acionável. */
export function descreverDisparidade(m: Medicao): string {
  const taxa = (g: TaxaDeGrupo) => `${g.grupo} ${g.aprovadas}/${g.total}`;
  return `razão de aprovação ${porMil(m.razaoMilesimos)} abaixo do piso ${porMil(m.pisoMilesimos)}: `
    + `${taxa(m.menor)} contra ${taxa(m.maior)}.`;
}

export function relatorioDeEquidade(r: ResultadoDeEquidade): string {
  const linhas: string[] = ['', '  Teste de disparidade (Risco-007)'];

  if (r.medicao) {
    const m = r.medicao;
    linhas.push(`  ${m.grupos.length} grupo(s) · ${r.fatoresVarridos} fator(es) em ${r.arquivosVarridos} arquivo(s)`);
    for (const g of m.grupos) {
      const marca = g.grupo === m.menor.grupo ? ' ← menor' : g.grupo === m.maior.grupo ? ' ← maior' : '';
      linhas.push(`    ${g.grupo.padEnd(16)} ${String(g.aprovadas).padStart(5)}/${String(g.total).padEnd(5)}${marca}`);
    }
    linhas.push(`  razão ${porMil(m.razaoMilesimos)} · piso ${porMil(m.pisoMilesimos)}`);
  } else {
    linhas.push('  Sem medição.');
  }

  linhas.push('');
  // A natureza sai antes do veredito, e sai sempre: é o que impede o verde de
  // ser lido como uma afirmação sobre o modelo.
  linhas.push(`  ${r.natureza.replace(/\s+/g, ' ').trim()}`);
  linhas.push('');

  if (r.aprovado) {
    linhas.push('  Nenhum achado: esta massa, sob este piso, não apresenta disparidade além do declarado,');
    linhas.push('  e nenhum fator do modelo casa proxy da lista fechada.');
  } else {
    linhas.push(`  ${r.achados.length} achado(s) que reprovam:`);
    for (const a of r.achados) {
      const onde = a.linha ? `${a.arquivo}:${a.linha}` : a.arquivo;
      linhas.push(`    [${a.regra}] ${onde}`);
      linhas.push(`      ${a.mensagem.replace(/\s+/g, ' ').trim()}`);
    }
  }

  return `${linhas.join('\n')}\n`;
}
