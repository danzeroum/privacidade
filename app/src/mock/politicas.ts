import type { Acao } from './permissoes';

export type Metodo = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * Política de resposta declarada por rota.
 *
 * Antes desta tabela, a guarda de escrita era **desviada**: rotas com
 * necessidade própria saíam antes dela, e o motivo ficava na ordem das linhas
 * do `switch`. Isso é uma lista de exceções, e lista de exceções cresce.
 *
 * Aqui o motivo mora no dado. Cada rota declara o que é e como responde a quem
 * está fora de escopo; a guarda lê a tabela em vez de ser contornada. Quem
 * acrescentar a próxima rota é obrigado a declarar a política dela — a entrada
 * ausente é recusada por padrão (`POLITICA_PADRAO`), não liberada.
 */
export interface PoliticaRota {
  metodo: Metodo;
  caminho: RegExp;
  /** `escrita` exige a ação `escrever`; `leitura` não. */
  tipo: 'leitura' | 'escrita';
  /**
   * Como a rota responde a quem não pode alcançá-la.
   *
   * `404_uniforme` para tudo que confirma a existência de um titular: um 403
   * ali diria "existe, você é que não pode" — o oráculo que a Regra 5 fecha.
   * `403` para recusa sobre a capacidade do ator, que não revela nada sobre
   * quem está do outro lado.
   */
  foraDeEscopo: '404_uniforme' | '403';
  /** Permissão adicional, além do que `tipo` exige. */
  acao?: Acao;
  /** Descrição curta, para a mensagem de recusa e para quem lê a tabela. */
  nota: string;
}

export const POLITICAS: PoliticaRota[] = [
  // ── Auditoria ─────────────────────────────────────────────────────────────
  {
    metodo: 'POST', caminho: /^audit\/verificar$/,
    tipo: 'leitura', foraDeEscopo: '403', acao: 'verificar_integridade',
    nota: 'Recomputa hashes e compara, sem mudar uma linha. É o ato que sustenta o parecer do auditor externo. '
      + 'Continua leitura mesmo gravando INTEGRIDADE_VERIFICADA (T6-01): o registro é consequência do sistema, não escalada do ator.',
  },
  {
    metodo: 'POST', caminho: /^audit\/exportar$/,
    tipo: 'leitura', foraDeEscopo: '403', acao: 'exportar_auditoria',
    nota: 'Exportar o registro de acessos é, ele mesmo, um acesso — gravado antes de o arquivo existir (C-06). '
      + 'Leitura pelo mesmo motivo da verificação, e por isso alcança o auditor externo.',
  },
  {
    metodo: 'GET', caminho: /^audit(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    nota: 'Leitura do trail.',
  },
  {
    metodo: 'POST', caminho: /^audit\/forjar$/,
    tipo: 'escrita', foraDeEscopo: '403',
    nota: 'Simulação de ataque. Exige também o modo demonstração, checado na rota.',
  },
  {
    metodo: 'PATCH', caminho: /^audit(\/.*)?$/,
    tipo: 'escrita', foraDeEscopo: '403',
    nota: 'Recusada pelo banco com 409 — append-only.',
  },
  {
    metodo: 'DELETE', caminho: /^audit(\/.*)?$/,
    tipo: 'escrita', foraDeEscopo: '403',
    nota: 'Recusada pelo banco com 409 — append-only.',
  },

  // ── Titulares ─────────────────────────────────────────────────────────────
  {
    metodo: 'POST', caminho: /^titulares\/buscar$/,
    tipo: 'escrita', foraDeEscopo: '404_uniforme', acao: 'buscar_titular',
    nota: 'Localizar um titular pelo documento. Grava no trail antes de responder, por isso é escrita.',
  },
  {
    metodo: 'GET', caminho: /^titulares\/[^/]+$/,
    tipo: 'leitura', foraDeEscopo: '404_uniforme', acao: 'ver_portal_titular',
    nota: 'Ficha do titular no balcão de atendimento.',
  },

  // ── Revelação e decisão ───────────────────────────────────────────────────
  {
    metodo: 'POST', caminho: /^pseudonyms\/resolve$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'revelar_pii',
    nota: 'Reidentificação. A recusa é sobre a capacidade do ator, não sobre a existência do titular.',
  },
  {
    metodo: 'POST', caminho: /^decisoes\/[^/]+\/revisar$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'revisar_decisao',
    nota: 'Revisão de decisão automatizada (Art. 20).',
  },

  // ── Transições de estado (PR 7) ───────────────────────────────────────────
  {
    metodo: 'POST', caminho: /^estados\/[^/]+\/[^/]+$/,
    tipo: 'escrita', foraDeEscopo: '403',
    nota: 'Mover artefato entre estados. A sequência é da tabela de mock/estados.ts; o conteúdo exigido, da rota.',
  },

  // ── Fila de trabalho (PR 9 · T0) ──────────────────────────────────────────
  {
    metodo: 'GET', caminho: /^fila$/,
    tipo: 'leitura', foraDeEscopo: '403',
    nota: 'A fila do papel da sessão, derivada dos estados. Leitura sem parâmetro: quem lê recebe a '
      + 'própria fila e a contagem do que é de outros — contagem, nunca a lista alheia.',
  },

  // ── Tabelas de decisão (PR 8 · DMN) ───────────────────────────────────────
  {
    metodo: 'GET', caminho: /^dmn(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    nota: 'Catálogo de D1, D2 e D3 com todas as versões publicadas. Leitura ampla de propósito: '
      + 'regra que decidiu e não pode ser lida por quem audita é regra que não se defende.',
  },
  {
    metodo: 'POST', caminho: /^dmn\/[^/]+\/aplicar$/,
    tipo: 'escrita', foraDeEscopo: '403',
    nota: 'Aplicar a tabela grava a versão e as entradas antes de responder — por isso é escrita, '
      + 'mesmo a decisão sendo derivada do artefato.',
  },

  // ── Incidentes (C-07 · Art. 48) ───────────────────────────────────────────
  {
    metodo: 'GET', caminho: /^incidentes(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    nota: 'Fila de incidentes. Leitura ampla de propósito: incidente escondido de quem audita não é incidente tratado.',
  },
  {
    metodo: 'POST', caminho: /^incidentes$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'abrir_incidente',
    nota: 'Abre o incidente com escopo lido do catálogo. É de quem opera a resposta — engenharia e segurança.',
  },
  {
    metodo: 'POST', caminho: /^incidentes\/[^/]+\/conter$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'abrir_incidente',
    nota: 'Contenção: estanca antes de decidir. Mesma mão que abriu o incidente.',
  },
  {
    metodo: 'POST', caminho: /^incidentes\/[^/]+\/(decisao|comunicar|registrar-nao-comunicacao|encerrar)$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'comunicar_incidente',
    nota: 'Decidir, comunicar e encerrar são do DPO, que responde pela comunicação ao titular e à ANPD (Art. 48).',
  },

  // ── Consentimento (C-08) ──────────────────────────────────────────────────
  {
    metodo: 'GET', caminho: /^consentimentos(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    nota: 'Registros de consentimento — a prova que sustenta a base legal no ROPA.',
  },
  {
    metodo: 'POST', caminho: /^consentimentos\/[^/]+\/revogar$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'revogar_consentimento',
    nota: 'Revogação do titular (Art. 18, VIII), operada pelo balcão. Propaga: o campo perde base legal e o gate bloqueia.',
  },

  // ── Solicitações ──────────────────────────────────────────────────────────
  {
    metodo: 'POST', caminho: /^requests\/[^/]+\/concluir$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'concluir_solicitacao',
    nota: 'Encerra o atendimento e para o cronômetro do SLA.',
  },
  {
    metodo: 'POST', caminho: /^requests\/[^/]+\/mensagens$/,
    tipo: 'escrita', foraDeEscopo: '403',
    nota: 'Canal entre titular e DPO.',
  },
  {
    metodo: 'GET', caminho: /^requests(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    nota: 'Fila de atendimento.',
  },

  // ── Catálogo, RIPD, LIA, risco, expurgo, KMS, métricas ────────────────────
  { metodo: 'GET', caminho: /^catalog(\/.*)?$/, tipo: 'leitura', foraDeEscopo: '403', nota: 'ROPA vivo.' },
  { metodo: 'POST', caminho: /^catalog\/validar$/, tipo: 'escrita', foraDeEscopo: '403', nota: 'Validação de inventário.' },
  { metodo: 'GET', caminho: /^gates(\/.*)?$/, tipo: 'leitura', foraDeEscopo: '403', nota: 'Execuções dos gates.' },
  { metodo: 'POST', caminho: /^ripds\/[^/]+\/(aprovar|render)$/, tipo: 'escrita', foraDeEscopo: '403', nota: 'Aprovação e geração do RIPD.' },
  { metodo: 'POST', caminho: /^lias\/[^/]+\/(campos|assinar)$/, tipo: 'escrita', foraDeEscopo: '403', nota: 'Vínculo e assinatura da LIA.' },
  { metodo: 'GET', caminho: /^risks(\/.*)?$/, tipo: 'leitura', foraDeEscopo: '403', nota: 'Matriz de risco.' },
  { metodo: 'PATCH', caminho: /^risks\/[^/]+$/, tipo: 'escrita', foraDeEscopo: '403', acao: 'gerenciar_risco', nota: 'Reclassificação de risco.' },
  { metodo: 'POST', caminho: /^purge\/[^/]+\/verificar$/, tipo: 'escrita', foraDeEscopo: '403', nota: 'Verificação de lote de expurgo.' },
  { metodo: 'GET', caminho: /^kms(\/.*)?$/, tipo: 'leitura', foraDeEscopo: '403', nota: 'Chaves e rotação.' },
  {
    metodo: 'POST', caminho: /^kms\/[^/]+\/(agendar-rotacao|promover-canary)$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'ver_pipeline_rotacao',
    nota: 'Operar o ciclo de chave é de quem responde por ele — engenharia e segurança. T7-01.',
  },
  { metodo: 'GET', caminho: /^metrics(\/.*)?$/, tipo: 'leitura', foraDeEscopo: '403', nota: 'Métricas de governança.' },
];

/**
 * Rota sem política declarada é tratada como escrita e recusada. O padrão
 * fecha, não abre: quem esquecer de declarar descobre no primeiro teste, não
 * em produção.
 */
export const POLITICA_PADRAO: PoliticaRota = {
  metodo: 'POST', caminho: /.*/, tipo: 'escrita', foraDeEscopo: '403',
  nota: 'Rota sem política declarada.',
};

export function politicaDe(metodo: Metodo, caminhoSemPrefixo: string): PoliticaRota | null {
  return POLITICAS.find((p) => p.metodo === metodo && p.caminho.test(caminhoSemPrefixo)) ?? null;
}
