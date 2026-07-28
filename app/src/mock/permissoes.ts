import type { Papel } from './types';

/**
 * Ações de granularidade fina. A regra de implementação é que o componente
 * correspondente **não é renderizado** para quem não tem a ação — não basta
 * desabilitar nem esconder por CSS, porque as duas coisas continuam no DOM e
 * não sobrevivem a uma auditoria de código.
 */
export type Acao =
  | 'revelar_pii'
  | 'buscar_titular'
  | 'aprovar_ripd'
  | 'assinar_lia'
  | 'gerar_ripd'
  | 'ver_gate_detalhe'
  | 'ver_pipeline_rotacao'
  | 'ver_log_kms'
  | 'gerenciar_risco'
  | 'rodar_expurgo'
  | 'ver_portal_titular'
  | 'ver_total_itens'
  | 'escrever';

/**
 * `buscar_titular` é do DPO e de mais ninguém (C-01).
 *
 * Localizar um titular pelo documento é o primeiro passo do atendimento, e
 * quem não atende não precisa dele. Conceder a engenharia seria conveniência
 * de demonstração: se um dia o balcão técnico precisar, é decisão de produto
 * com registro, não linha acrescentada aqui em silêncio.
 *
 * Note que `ver_portal_titular` continua mais amplo — ver a fila e os prazos
 * não é a mesma coisa que apontar um documento e confirmar que ele existe.
 */
const MAPA: Record<Papel, Acao[]> = {
  engenharia: ['gerar_ripd', 'ver_gate_detalhe', 'ver_pipeline_rotacao', 'ver_log_kms',
    'rodar_expurgo', 'ver_portal_titular', 'ver_total_itens', 'escrever'],
  dpo: ['revelar_pii', 'buscar_titular', 'aprovar_ripd', 'assinar_lia', 'gerenciar_risco',
    'ver_portal_titular', 'ver_total_itens', 'rodar_expurgo', 'escrever'],
  produto: ['ver_portal_titular'],
  seguranca: ['ver_pipeline_rotacao', 'ver_log_kms', 'ver_gate_detalhe', 'ver_total_itens',
    'rodar_expurgo', 'escrever'],
  auditor: [],
};

export const pode = (papel: Papel, acao: Acao): boolean => MAPA[papel].includes(acao);

export const PAPEIS: { id: Papel; rotulo: string; resumo: string }[] = [
  { id: 'engenharia', rotulo: 'Engenharia', resumo: 'Vê o achado do gate com arquivo e linha, gera RIPD e roda expurgo. Não aprova RIPD nem assina LIA.' },
  { id: 'dpo', rotulo: 'DPO', resumo: 'Busca titular, aprova RIPD, assina LIA, revela PII com finalidade declarada e gerencia riscos. Não vê o detalhe técnico do gate nem o pipeline de rotação.' },
  { id: 'produto', rotulo: 'Produto', resumo: 'Vê volume, prazo e o mapa de esforço × risco. Nenhum botão de revelar ou de buscar titular existe no DOM.' },
  { id: 'seguranca', rotulo: 'Segurança', resumo: 'Vê log de acesso ao KMS e a rotação de chaves. Não tem acesso ao portal de direitos do titular.' },
  { id: 'auditor', rotulo: 'Auditor externo', resumo: 'Leitura de tudo, sem reidentificar, sem contagem total e sem nenhum botão de ação.' },
];

/** Telas que cada papel pode abrir. Segurança não opera o balcão de atendimento. */
export const TELAS_BLOQUEADAS: Partial<Record<Papel, string[]>> = {
  seguranca: ['/t4'],
};
