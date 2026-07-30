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
  | 'concluir_solicitacao'
  | 'revisar_decisao'
  | 'verificar_integridade'
  | 'exportar_auditoria'
  | 'abrir_incidente'
  | 'comunicar_incidente'
  /** Decidir o encerramento da relação com um parceiro (Risco-008). */
  | 'desligar_parceiro'
  /** Destruir a chave do parceiro depois da janela. Separado de decidir. */
  | 'destruir_chave_de_parceiro'
  | 'revogar_consentimento'
  | 'aprovar_ripd'
  | 'assinar_lia'
  | 'gerar_ripd'
  | 'ver_gate_detalhe'
  | 'ver_pipeline_rotacao'
  | 'ver_log_kms'
  | 'gerenciar_risco'
  | 'gerenciar_achado'
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
/**
 * `verificar_integridade` é de **todos os cinco papéis**, auditor externo
 * incluído (T6-01).
 *
 * A rota passa a gravar `INTEGRIDADE_VERIFICADA` no trail, e a tentação seria
 * concluir que ela virou escrita. Não virou: a permissão é do **ato de
 * verificar**, que recomputa hashes e não muda uma linha; o registro é
 * consequência do sistema, não escalada do ator. Se caísse em `escrever`,
 * tiraríamos do auditor externo justamente o ato que sustenta o parecer dele.
 *
 * `exportar_auditoria` é mais estreita — DPO, segurança e auditor, quem tem
 * dever de prestar contas. Exportar registro de acesso é, ele mesmo, acesso a
 * dado pessoal.
 */
/**
 * `gerenciar_achado` é de engenharia e do DPO (PR 10).
 *
 * Antes, o achado caía em `escrever` e aparecia também para segurança — a
 * permissão larga escolhendo o dono por omissão. Quem apura causa raiz e executa
 * o plano é engenharia; quem valida o critério de eficácia é o DPO.
 *
 * `conduzir_ciclo` existiu entre o PR 10 e o PR 13 e **saiu**: ela nasceu porque
 * obrigação de calendário precisava de uma `Acao` para ter dono, e obrigação
 * deixou de derivar dono de permissão — ela o **declara**. Permissão que não
 * habilita nada é pior que ausência: sugere um recorte que o sistema não faz.
 *
 * A regra que ficou no lugar dela: item de artefato deriva o dono da `Acao`;
 * obrigação é dado autorado e declara `responsavel`. As duas convivem atrás de
 * `Titularidade`, em `mock/fila.ts`.
 */
const MAPA: Record<Papel, Acao[]> = {
  engenharia: ['gerar_ripd', 'ver_gate_detalhe', 'ver_pipeline_rotacao', 'ver_log_kms',
    'rodar_expurgo', 'ver_portal_titular', 'ver_total_itens', 'verificar_integridade',
    'abrir_incidente', 'gerenciar_achado', 'escrever'],
  dpo: ['revelar_pii', 'buscar_titular', 'concluir_solicitacao', 'revisar_decisao',
    'aprovar_ripd', 'assinar_lia', 'gerenciar_risco', 'gerenciar_achado', 'desligar_parceiro',
    'ver_portal_titular', 'ver_total_itens', 'rodar_expurgo',
    'verificar_integridade', 'exportar_auditoria',
    'comunicar_incidente', 'revogar_consentimento', 'escrever'],
  produto: ['ver_portal_titular', 'verificar_integridade'],
  /**
   * `destruir_chave_de_parceiro` é de segurança, e `desligar_parceiro` é do DPO.
   *
   * Quem decide encerrar a relação responde pelo contrato; quem destrói a chave
   * opera o KMS. Dar as duas ao mesmo papel faria a decisão e a execução caberem
   * na mesma pessoa — e é justamente a separação que a T11 já cobra na
   * verificação de eficácia.
   */
  seguranca: ['ver_pipeline_rotacao', 'ver_log_kms', 'ver_gate_detalhe', 'ver_total_itens',
    'rodar_expurgo', 'verificar_integridade', 'exportar_auditoria',
    'abrir_incidente', 'destruir_chave_de_parceiro', 'escrever'],
  auditor: ['verificar_integridade', 'exportar_auditoria'],
};

/**
 * Todas as ações declaradas, em runtime.
 *
 * Existe para o invariante que cobra que cada uma seja exercida em algum lugar:
 * permissão sem usuário sugere um recorte que o sistema não faz, e foi assim que
 * `conduzir_ciclo` ficou órfã entre o PR 10 e o PR 13.
 */
export const ACOES: Acao[] = [...new Set(Object.values(MAPA).flat())].sort();

export const pode = (papel: Papel, acao: Acao): boolean => MAPA[papel].includes(acao);

export const PAPEIS: { id: Papel; rotulo: string; resumo: string }[] = [
  { id: 'engenharia', rotulo: 'Engenharia', resumo: 'Vê o achado do gate com arquivo e linha, gera RIPD e roda expurgo. Não aprova RIPD nem assina LIA.' },
  { id: 'dpo', rotulo: 'DPO', resumo: 'Busca titular, aprova RIPD, assina LIA, revela PII com finalidade declarada e gerencia riscos. Não vê o detalhe técnico do gate nem o pipeline de rotação.' },
  { id: 'produto', rotulo: 'Produto', resumo: 'Vê volume, prazo e o mapa de esforço × risco. Nenhum botão de revelar ou de buscar titular existe no DOM.' },
  { id: 'seguranca', rotulo: 'Segurança', resumo: 'Vê log de acesso ao KMS e a rotação de chaves. Não tem acesso ao portal de direitos do titular.' },
  { id: 'auditor', rotulo: 'Auditor externo', resumo: 'Leitura de tudo, sem reidentificar e sem contagem total. Verifica a cadeia e exporta o trail: são os atos que sustentam o parecer, e ficam registrados.' },
];

/** Telas que cada papel pode abrir. Segurança não opera o balcão de atendimento. */
export const TELAS_BLOQUEADAS: Partial<Record<Papel, string[]>> = {
  seguranca: ['/t4'],
};
