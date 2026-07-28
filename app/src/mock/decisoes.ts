/**
 * As três decisões do `MAPA-PROCESSOS.md §3` como **dados versionados**.
 *
 * Este arquivo responde a uma pergunta: dadas estas entradas e esta versão da
 * tabela, qual é a saída? Ele não sabe o que é um RIPD, não lê o banco, não
 * conhece papel e não olha o relógio. A separação é a mesma do `estados.ts`:
 *
 * - **verificação** (aqui): a tabela foi aplicada corretamente?
 * - **validação** (em `api.ts`): as entradas vieram do artefato e a alçada
 *   resultante é a que a lei pede?
 *
 * Três propriedades sustentam tudo o que vem depois:
 *
 * 1. **Reprodutibilidade.** Uma decisão gravada carrega a versão e as entradas
 *    que a produziram. Meses depois, `reproduzir()` refaz a conta e confere.
 *    Publicar uma versão nova **não** mexe em decisão já gravada: as versões
 *    convivem no catálogo, e a antiga continua respondendo o que respondia.
 * 2. **Entrada indefinida cai no cenário mais restritivo.** Nunca no permissivo,
 *    nunca em erro. Cada versão declara o `restritivo` de cada campo, e a
 *    decisão registra quais entradas foram assumidas — omissão que decide
 *    calada é omissão que ninguém revisita.
 * 3. **Um só modelo de risco.** A D2 é a fonte da faixa de cor da matriz da T5.
 *    Não existe segundo limiar escrito na tela.
 *
 * Por que `.ts` e não os `d1.json`/`d2.json` sugeridos no MAPA: a tabela precisa
 * de união discriminada para o teste de condição e de tipo para a saída. Em JSON
 * o mesmo conteúdo entra sem tipo e sai com `as`, que é o contrário do ponto.
 * Continua sendo dado — declarativo, sem `if` espalhado — e continua sem import.
 */

export type TabelaId = 'd1' | 'd2' | 'd3';

export type Valor = string | number | boolean | string[];

/**
 * O vocabulário de condição da tabela. É pequeno de propósito: condição que
 * precisa de função vira código escondido dentro do dado, e código escondido
 * não é versionável nem legível por quem audita.
 */
export type Teste =
  | { em: (string | number | boolean)[] }
  | { min: number }
  | { max: number }
  | { contem: string };

export interface Regra {
  /** Conjunção. Vazio casa com tudo — é a última linha, e ela fecha. */
  quando: Record<string, Teste>;
  entao: Record<string, string | number | boolean>;
}

export interface Versao {
  versao: number;
  /** Documental: quem manda na escolha do vigente é a maior versão publicada. */
  vigenciaInicio: string;
  /** O que mudou em relação à anterior, em uma frase. */
  nota: string;
  /**
   * Ordem é prioridade: a **primeira** regra que casar vence. A última linha
   * de toda tabela é `{}`, e ela devolve o cenário mais restritivo — tabela com
   * buraco recusa, não libera.
   */
  regras: Regra[];
  /** O valor assumido para cada entrada ausente. Cobre o domínio inteiro. */
  restritivo: Record<string, Valor>;
  /** Frase de gente para cada condição, indexada pela chave canônica dela. */
  termos: Record<string, string>;
  /** Frase de gente para cada valor de saída, indexada por `campo=valor`. */
  saidas: Record<string, string>;
  /** Campo da saída que abre a explicação. */
  principal: string;
}

export interface TabelaDmn {
  id: TabelaId;
  titulo: string;
  pergunta: string;
  /** Artefato sobre o qual esta tabela decide. */
  sobre: string;
  versoes: Versao[];
}

export interface Decisao {
  tabela: TabelaId;
  versao: number;
  /** Já preenchidas com o restritivo onde faltava. */
  entradas: Record<string, Valor>;
  saida: Record<string, string | number | boolean>;
  /** A explicação em uma frase, citando as entradas que a produziram. */
  frase: string;
  /** Entradas que chegaram ausentes e caíram no restritivo. */
  assumidas: string[];
  /** Índice da regra que casou — o que torna a aplicação conferível linha a linha. */
  regra: number;
}

/** Decisão gravada. `quando` é carimbado por quem grava; aqui não existe relógio. */
export type DecisaoRegistrada = Decisao & { quando: string };

// ── D1 · complexidade e alçada ───────────────────────────────────────────────

export type Complexidade = 'baixa' | 'media' | 'alta';
export type Alcada = 'tecnica' | 'dpo' | 'dpo_e_comite';

/** O vocabulário de categoria do catálogo, do menos ao mais restritivo. */
export const CATEGORIAS = ['anonimizado', 'pseudonimizado', 'pessoal', 'sensivel'];

const TERMOS_D1: Record<string, string> = {
  'categoria=sensivel': 'campo sensível',
  'categoria=pessoal': 'campo pessoal',
  'categoria=anonimizado|pseudonimizado': 'dado anonimizado ou pseudonimizado',
  'decisaoAutomatizada=true': 'decisão automatizada',
  'transferenciaInternacional=true': 'transferência internacional',
  'volumeTitulares>=100000': 'mais de 100 mil titulares',
  'volumeTitulares>=1000000': 'mais de 1 milhão de titulares',
};

const SAIDAS_D1: Record<string, string> = {
  'complexidade=alta': 'alta complexidade',
  'complexidade=media': 'complexidade média',
  'complexidade=baixa': 'baixa complexidade',
  'alcada=dpo_e_comite': 'aprovação do DPO e do comitê',
  'alcada=dpo': 'aprovação do DPO',
  'alcada=tecnica': 'aprovação técnica do time dono',
};

/**
 * O restritivo da D1. Categoria ausente é tratada como sensível, volume ausente
 * como acima do maior limiar, e os dois gatilhos como acionados: quem não
 * declarou não ganha o benefício da dúvida.
 */
const RESTRITIVO_D1: Record<string, Valor> = {
  categoria: 'sensivel',
  volumeTitulares: 1_000_000,
  decisaoAutomatizada: true,
  transferenciaInternacional: true,
};

const D1_V1: Versao = {
  versao: 1,
  vigenciaInicio: '2025-09-01',
  nota: 'Primeira publicação: categoria do dado, volume, decisão automatizada e transferência internacional.',
  principal: 'complexidade',
  restritivo: RESTRITIVO_D1,
  termos: TERMOS_D1,
  saidas: SAIDAS_D1,
  regras: [
    { quando: { categoria: { em: ['sensivel'] }, decisaoAutomatizada: { em: [true] } },
      entao: { complexidade: 'alta', alcada: 'dpo_e_comite' } },
    { quando: { categoria: { em: ['sensivel'] }, volumeTitulares: { min: 100_000 } },
      entao: { complexidade: 'alta', alcada: 'dpo_e_comite' } },
    { quando: { categoria: { em: ['sensivel'] } },
      entao: { complexidade: 'alta', alcada: 'dpo' } },
    // Decisão automatizada sobe a complexidade mesmo sobre dado pseudonimizado:
    // o Art. 20 olha o efeito sobre a pessoa, não o formato do insumo.
    { quando: { decisaoAutomatizada: { em: [true] } },
      entao: { complexidade: 'alta', alcada: 'dpo' } },
    { quando: { volumeTitulares: { min: 1_000_000 } },
      entao: { complexidade: 'media', alcada: 'dpo' } },
    { quando: { transferenciaInternacional: { em: [true] } },
      entao: { complexidade: 'media', alcada: 'dpo' } },
    { quando: { categoria: { em: ['pessoal'] } },
      entao: { complexidade: 'media', alcada: 'dpo' } },
    { quando: { categoria: { em: ['anonimizado', 'pseudonimizado'] } },
      entao: { complexidade: 'baixa', alcada: 'tecnica' } },
    { quando: {}, entao: { complexidade: 'alta', alcada: 'dpo_e_comite' } },
  ],
};

const D1_V2: Versao = {
  versao: 2,
  vigenciaInicio: '2026-07-01',
  nota: 'Transferência internacional deixa de ser fator moderado: sem país adequado o titular perde foro e '
    + 'remédio (Art. 33). Combinada com decisão automatizada, passa a exigir o comitê.',
  principal: 'complexidade',
  restritivo: RESTRITIVO_D1,
  termos: TERMOS_D1,
  saidas: SAIDAS_D1,
  regras: [
    { quando: { categoria: { em: ['sensivel'] }, decisaoAutomatizada: { em: [true] } },
      entao: { complexidade: 'alta', alcada: 'dpo_e_comite' } },
    { quando: { decisaoAutomatizada: { em: [true] }, transferenciaInternacional: { em: [true] } },
      entao: { complexidade: 'alta', alcada: 'dpo_e_comite' } },
    { quando: { categoria: { em: ['sensivel'] }, volumeTitulares: { min: 100_000 } },
      entao: { complexidade: 'alta', alcada: 'dpo_e_comite' } },
    { quando: { categoria: { em: ['sensivel'] } },
      entao: { complexidade: 'alta', alcada: 'dpo' } },
    { quando: { decisaoAutomatizada: { em: [true] } },
      entao: { complexidade: 'alta', alcada: 'dpo' } },
    { quando: { transferenciaInternacional: { em: [true] } },
      entao: { complexidade: 'alta', alcada: 'dpo' } },
    { quando: { volumeTitulares: { min: 1_000_000 } },
      entao: { complexidade: 'media', alcada: 'dpo' } },
    { quando: { categoria: { em: ['pessoal'] } },
      entao: { complexidade: 'media', alcada: 'dpo' } },
    { quando: { categoria: { em: ['anonimizado', 'pseudonimizado'] } },
      entao: { complexidade: 'baixa', alcada: 'tecnica' } },
    { quando: {}, entao: { complexidade: 'alta', alcada: 'dpo_e_comite' } },
  ],
};

// ── D2 · nível de risco e tratamento (a mesma grade P × I da T5) ─────────────

export type NivelRisco = 'baixo' | 'moderado' | 'alto' | 'critico';

const D2_V1: Versao = {
  versao: 1,
  vigenciaInicio: '2025-09-01',
  nota: 'Primeira publicação: as quatro faixas de score da matriz probabilidade × impacto.',
  principal: 'nivel',
  restritivo: { probabilidade: 5, impacto: 5, score: 25 },
  termos: {
    'score>=15': 'score 15 ou mais',
    'score>=8': 'score entre 8 e 14',
    'score>=4': 'score entre 4 e 7',
    'score<=3': 'score até 3',
  },
  saidas: {
    'nivel=critico': 'risco crítico',
    'nivel=alto': 'risco alto',
    'nivel=moderado': 'risco moderado',
    'nivel=baixo': 'risco baixo',
    'tratamento=evitar ou mitigar antes do go-live': 'evitar ou mitigar antes do go-live',
    'tratamento=mitigar com dono e prazo': 'mitigar com dono e prazo',
    'tratamento=mitigar ou aceitar com prazo de reavaliação': 'mitigar ou aceitar com prazo de reavaliação',
    'tratamento=aceitar com reavaliação anual': 'aceitar com reavaliação anual',
    'aprovador=DPO e comitê': 'aval do DPO e do comitê',
    'aprovador=DPO': 'aval do DPO',
    'aprovador=dono do domínio': 'aval do dono do domínio',
  },
  regras: [
    { quando: { score: { min: 15 } },
      entao: { nivel: 'critico', tratamento: 'evitar ou mitigar antes do go-live', aprovador: 'DPO e comitê' } },
    { quando: { score: { min: 8 } },
      entao: { nivel: 'alto', tratamento: 'mitigar com dono e prazo', aprovador: 'DPO' } },
    { quando: { score: { min: 4 } },
      entao: { nivel: 'moderado', tratamento: 'mitigar ou aceitar com prazo de reavaliação', aprovador: 'DPO' } },
    { quando: { score: { max: 3 } },
      entao: { nivel: 'baixo', tratamento: 'aceitar com reavaliação anual', aprovador: 'dono do domínio' } },
    { quando: {},
      entao: { nivel: 'critico', tratamento: 'evitar ou mitigar antes do go-live', aprovador: 'DPO e comitê' } },
  ],
};

/**
 * A faixa de cor da matriz da T5 sai daqui, e só daqui.
 *
 * O tom é o vocabulário semântico da interface (`Pill`, `.matriz-celula`), não
 * um valor de CSS: a tabela decide o nível, este mapa diz como o nível aparece.
 * Mudar um limiar da D2 muda a cor da grade sem tocar em `T5.tsx` — que era o
 * ponto de "não criar um segundo modelo de risco".
 */
export const TOM_DO_NIVEL: Record<NivelRisco, 'ok' | 'warn' | 'crit'> = {
  baixo: 'ok', moderado: 'ok', alto: 'warn', critico: 'crit',
};

// ── D3 · exige RIPD / análise algorítmica ────────────────────────────────────

export type ExigenciaRipd = 'obrigatorio' | 'dispensavel_com_justificativa';

/**
 * O catálogo de gatilhos de triagem — a unificação pedida pelo MAPA.
 *
 * Antes, cada cenário repetia o rótulo e o `critico` de cada gatilho no próprio
 * dado, e o `ripd-triage.sh` do desenho tinha a terceira cópia. Três lugares
 * dizendo o que é um gatilho crítico é o mesmo defeito do `estados.ts` antes do
 * PR 7. Agora o cenário diz **quais** gatilhos acionaram e com que evidência; o
 * que cada um significa mora aqui.
 */
export const GATILHOS: Record<string, { rotulo: string; critico: boolean }> = {
  T1: { rotulo: 'dado sensível', critico: true },
  T2: { rotulo: 'menores', critico: true },
  T3: { rotulo: 'decisão automatizada', critico: true },
  T4: { rotulo: 'monitoramento', critico: true },
  T5: { rotulo: 'larga escala', critico: false },
  T6: { rotulo: 'nova tecnologia', critico: false },
  T7: { rotulo: 'cruzamento de bases', critico: false },
  T8: { rotulo: 'transferência internacional', critico: false },
};

export const rotuloDoGatilho = (codigo: string): string => GATILHOS[codigo]?.rotulo ?? codigo;
/** Gatilho desconhecido é tratado como crítico: catálogo incompleto não libera. */
export const gatilhoCritico = (codigo: string): boolean => GATILHOS[codigo]?.critico ?? true;

const D3_V1: Versao = {
  versao: 1,
  vigenciaInicio: '2025-09-01',
  nota: 'Primeira publicação: unifica os gatilhos da triagem do CI com os do cenário.',
  principal: 'ripd',
  /**
   * Lista de gatilhos **ausente** é diferente de lista vazia. Ausente significa
   * que a triagem não rodou ou não foi lida, e cai no pior caso; vazia significa
   * que rodou e nada acionou, o que é uma resposta e vale como tal.
   */
  restritivo: { gatilhos: ['T3'], gatilhosCriticos: 1, gatilhosTotal: 1 },
  termos: {
    'gatilhos~T3': 'decisão automatizada (T3)',
    'gatilhosCriticos>=1': 'ao menos um gatilho crítico',
    'gatilhosTotal>=2': 'dois ou mais gatilhos acionados',
    'gatilhosTotal<=1': 'no máximo um gatilho, nenhum deles crítico',
  },
  saidas: {
    'ripd=obrigatorio': 'RIPD obrigatório',
    'ripd=dispensavel_com_justificativa': 'RIPD dispensável com justificativa registrada',
    'analiseAlgoritmica=true': 'análise algorítmica exigida',
    'analiseAlgoritmica=false': 'sem análise algorítmica',
  },
  regras: [
    { quando: { gatilhos: { contem: 'T3' } }, entao: { ripd: 'obrigatorio', analiseAlgoritmica: true } },
    { quando: { gatilhosCriticos: { min: 1 } }, entao: { ripd: 'obrigatorio', analiseAlgoritmica: false } },
    { quando: { gatilhosTotal: { min: 2 } }, entao: { ripd: 'obrigatorio', analiseAlgoritmica: false } },
    { quando: { gatilhosTotal: { max: 1 } },
      entao: { ripd: 'dispensavel_com_justificativa', analiseAlgoritmica: false } },
    { quando: {}, entao: { ripd: 'obrigatorio', analiseAlgoritmica: true } },
  ],
};

// ── catálogo ────────────────────────────────────────────────────────────────

export const TABELAS: Record<TabelaId, TabelaDmn> = {
  d1: {
    id: 'd1', titulo: 'D1', sobre: 'ripd',
    pergunta: 'Qual a complexidade do parecer e de quem é a alçada de aprovação?',
    versoes: [D1_V1, D1_V2],
  },
  d2: {
    id: 'd2', titulo: 'D2', sobre: 'risco',
    pergunta: 'Qual o nível do risco, o tratamento esperado e quem aprova?',
    versoes: [D2_V1],
  },
  d3: {
    id: 'd3', titulo: 'D3', sobre: 'ripd',
    pergunta: 'O RIPD é obrigatório? A análise algorítmica é exigida?',
    versoes: [D3_V1],
  },
};

export const TABELAS_IDS: TabelaId[] = ['d1', 'd2', 'd3'];

/**
 * A versão vigente é a **maior publicada**. `vigenciaInicio` é documentação
 * para quem lê o catálogo: fazer a escolha depender do relógio tornaria a
 * decisão não reproduzível — o mesmo teste passaria hoje e falharia em agosto.
 */
export const vigenteDe = (tabela: TabelaId): Versao =>
  TABELAS[tabela].versoes.reduce((a, b) => (b.versao > a.versao ? b : a));

export const versaoDe = (tabela: TabelaId, versao: number): Versao | null =>
  TABELAS[tabela].versoes.find((v) => v.versao === versao) ?? null;

// ── motor ───────────────────────────────────────────────────────────────────

const chaveDoTeste = (campo: string, t: Teste): string => {
  if ('em' in t) return `${campo}=${t.em.join('|')}`;
  if ('min' in t) return `${campo}>=${t.min}`;
  if ('max' in t) return `${campo}<=${t.max}`;
  return `${campo}~${t.contem}`;
};

const casa = (valor: Valor | undefined, t: Teste): boolean => {
  if (valor === undefined || valor === null) return false;
  if ('em' in t) return t.em.includes(valor as string | number | boolean);
  if ('min' in t) return typeof valor === 'number' && valor >= t.min;
  if ('max' in t) return typeof valor === 'number' && valor <= t.max;
  return Array.isArray(valor) && valor.includes(t.contem);
};

/** Todas as chaves canônicas de condição de uma versão — usado pelos invariantes. */
export const condicoesDe = (v: Versao): string[] =>
  v.regras.flatMap((r) => Object.entries(r.quando).map(([campo, t]) => chaveDoTeste(campo, t)));

const escrever = (v: Valor): string => (Array.isArray(v) ? v.join(', ') : String(v));

function explicar(
  tabela: TabelaDmn, v: Versao, regra: Regra,
  saida: Record<string, string | number | boolean>, entradas: Record<string, Valor>, assumidas: string[],
): string {
  const termos = Object.entries(regra.quando).map(([campo, t]) => {
    const chave = chaveDoTeste(campo, t);
    return v.termos[chave] ?? chave;
  });
  const rotulo = (campo: string) => v.saidas[`${campo}=${saida[campo]}`] ?? String(saida[campo]);
  const resto = Object.keys(saida).filter((c) => c !== v.principal).map(rotulo);
  const fatores = termos.length > 0 ? termos.join(' + ') : 'nenhum fator declarado';
  const nota = assumidas.length > 0
    ? ` (${assumidas.map((a) => `${a} não informado, assumido ${escrever(entradas[a])}`).join('; ')})`
    : '';
  return `${tabela.titulo} · ${rotulo(v.principal)}: ${fatores} → ${resto.join(' · ')}${nota}`;
}

/**
 * Aplica a tabela. Nunca lança por causa das entradas: o domínio é fechado pelo
 * `restritivo`, e a última regra casa com tudo.
 *
 * Lança, sim, quando a **versão** pedida não existe — que é outra coisa. Entrada
 * ausente é um caso previsto do negócio; versão inexistente é chamada errada, e
 * substituí-la em silêncio por outra faria a decisão mentir sobre qual tabela a
 * produziu. Quem lida com registro antigo usa `reproduzir`, que devolve o motivo
 * em vez de estourar.
 */
export function aplicar(
  tabela: TabelaId, entradas: Record<string, Valor | undefined>, versao?: number,
): Decisao {
  const t = TABELAS[tabela];
  const v = versao === undefined ? vigenteDe(tabela) : versaoDe(tabela, versao);
  if (!v) throw new Error(`Versão ${tabela}@${versao} não está no catálogo.`);

  const cheias: Record<string, Valor> = {};
  const assumidas: string[] = [];
  // O domínio da entrada é exatamente o que a versão declara em `restritivo`.
  // Campo a mais no pedido é ignorado; campo a menos cai no restritivo.
  for (const campo of Object.keys(v.restritivo)) {
    const dado = entradas[campo];
    if (dado === undefined || dado === null) {
      cheias[campo] = v.restritivo[campo];
      assumidas.push(campo);
    } else {
      cheias[campo] = dado;
    }
  }

  const indice = v.regras.findIndex(
    (r) => Object.entries(r.quando).every(([campo, teste]) => casa(cheias[campo], teste)),
  );
  const regra = v.regras[indice];
  const saida = { ...regra.entao };
  return {
    tabela, versao: v.versao, entradas: cheias, saida,
    frase: explicar(t, v, regra, saida, cheias, assumidas),
    assumidas, regra: indice,
  };
}

/**
 * Refaz uma decisão gravada com a versão que a produziu.
 *
 * É a prova de reprodutibilidade: mesma entrada + mesma versão devolvem a mesma
 * saída, meses depois e com o catálogo já em outra versão vigente.
 */
export function reproduzir(reg: DecisaoRegistrada): {
  confere: boolean; motivo?: string; saida?: Record<string, string | number | boolean>;
} {
  if (!TABELAS[reg.tabela]) {
    return { confere: false, motivo: `A tabela ${reg.tabela} não está no catálogo.` };
  }
  if (!versaoDe(reg.tabela, reg.versao)) {
    return {
      confere: false,
      motivo: `A versão ${reg.tabela}@${reg.versao} não está no catálogo: sem ela a decisão não é conferível, `
        + 'e aplicar outra versão responderia por uma regra que não foi a usada.',
    };
  }
  const nova = aplicar(reg.tabela, reg.entradas, reg.versao);
  const iguais = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
  };
  const confere = iguais(nova.saida, reg.saida);
  return {
    confere, saida: nova.saida,
    motivo: confere ? undefined
      : `A tabela ${reg.tabela}@${reg.versao} hoje devolve outra saída para as mesmas entradas.`,
  };
}

/**
 * A decisão vigente de uma tabela num artefato: a **última** gravada.
 *
 * A lista é append-only, então "vigente" é uma leitura, não um estado guardado
 * em paralelo — e as anteriores continuam consultáveis, que é o ponto.
 */
export const ultimaDecisao = (
  decisoes: DecisaoRegistrada[] | undefined, tabela: TabelaId,
): DecisaoRegistrada | null => {
  const daTabela = (decisoes ?? []).filter((d) => d.tabela === tabela);
  return daTabela.length > 0 ? daTabela[daTabela.length - 1] : null;
};

// ── atalhos de uso — a D2 como fonte única do modelo de risco ────────────────

export const nivelDoRisco = (probabilidade: number, impacto: number): NivelRisco =>
  aplicar('d2', { probabilidade, impacto, score: probabilidade * impacto }).saida.nivel as NivelRisco;

/** A cor da célula da matriz. Muda quando a D2 muda, e em nenhum outro caso. */
export const tomDoRisco = (probabilidade: number, impacto: number): 'ok' | 'warn' | 'crit' =>
  TOM_DO_NIVEL[nivelDoRisco(probabilidade, impacto)];
