/**
 * A tabela de paridade entre o contrato e o mock (Risco-034).
 *
 * O padrão sistêmico nº 1 do relatório de auditoria é este: *o mock está à
 * frente do contrato*. As correções de treze PRs viveram em `mock/api.ts`
 * enquanto `api/openapi.yaml` — que é o desenho da produção — ficou parado. Quem
 * implementasse o backend a partir do contrato reconstruiria o sistema anterior
 * às correções.
 *
 * Esta tabela é a catraca. Cada operação do contrato aparece aqui uma vez, e
 * declara **como exercitá-la no mock** ou **por que não há implementação**. Os
 * testes cobram os dois lados:
 *
 * 1. contrato → tabela: nenhuma operação do `openapi.yaml` fica de fora;
 * 2. tabela → contrato: nenhuma linha aponta para operação que o contrato não tem;
 * 3. **não-vacuidade**: toda linha com `mock` é chamada de verdade e não pode
 *    cair no 404 terminal do dispatcher. Sem isso a tabela seria só uma segunda
 *    lista de intenções, que é exatamente o defeito que ela existe para fechar;
 * 4. raízes: toda raiz que o `switch` de `api.ts` atende está declarada aqui.
 *
 * O que **não** entra no contrato precisa dizer o motivo em voz alta, e há só
 * duas razões admitidas: ingestão de CI (rota de produção que o protótipo em
 * memória não serve) e simulação de ataque (que não pode existir em produção).
 */

import type { Papel } from './types';

export type MetodoHttp = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
export type Superficie = 'console' | 'portal';

export interface Operacao {
  metodo: MetodoHttp;
  /** O caminho como o contrato o escreve, com `{chaves}`. */
  contrato: string;
  superficie: Superficie;
  /**
   * Um caminho concreto que o dispatcher do mock atende. Os identificadores são
   * de propósito inexistentes: a prova é de que a **rota** existe, não de que o
   * recurso existe. Um 404 "Não encontrado" passa; o 404 "Rota não encontrada"
   * do fim do `switch` reprova.
   */
  mock: string | null;
  /** O papel com que a rota é exercitada na prova de não-vacuidade. */
  papel?: Papel;
  /** Obrigatório quando `mock` é `null`. */
  motivo?: 'ingestao_ci';
  nota: string;
}

/**
 * As doze do portal (Risco-001) primeiro, porque são a razão desta tabela
 * existir. `mock` fica `null` para todas: elas não passam pelo dispatcher do
 * console, e sim por `requestPortal` — a superfície é outra, e o teste de
 * não-vacuidade delas tem bloco próprio.
 */
export const OPERACOES: Operacao[] = [
  // ── Portal do titular ────────────────────────────────────────────────────
  { metodo: 'GET', contrato: '/me/direitos', superficie: 'portal', mock: null,
    nota: 'O cardápio. Única rota do portal sem verificação: não carrega dado de titular.' },
  { metodo: 'POST', contrato: '/me/verificacao', superficie: 'portal', mock: null,
    nota: 'Abre a verificação no nível derivado do direito. 201 sempre — 404 aqui seria oráculo de cadastro.' },
  { metodo: 'POST', contrato: '/me/verificacao/{id}/codigo', superficie: 'portal', mock: null,
    nota: 'Confirma e emite a sessão. 401 único para código errado, fator errado e cadastro inexistente.' },
  { metodo: 'POST', contrato: '/requests', superficie: 'portal', mock: null,
    nota: 'Abre a solicitação. Calcula prazo_limite por direito e grava antes de responder.' },
  { metodo: 'GET', contrato: '/requests/{protocolo}', superficie: 'portal', mock: null,
    nota: 'Acompanhar o próprio pedido, com apagados[] e retidos[].' },
  { metodo: 'POST', contrato: '/requests/{id}/mensagens', superficie: 'portal', mock: '/v1/requests/nao-existe/mensagens', papel: 'dpo',
    nota: 'A mesma conversa das duas pontas: com token do console o remetente é o DPO, com sessão do portal é o titular.' },
  { metodo: 'GET', contrato: '/requests/{id}/pacote', superficie: 'portal', mock: null,
    nota: 'Link assinado com TTL de 24 h, e a frase que justifica a validade curta.' },
  { metodo: 'GET', contrato: '/me/consentimentos', superficie: 'portal', mock: null,
    nota: 'O texto consentido na versão aceita — a prova do Art. 8º, §2º do lado de quem consentiu.' },
  { metodo: 'POST', contrato: '/me/consentimentos/{id}/revogacao', superficie: 'portal', mock: null,
    nota: 'Revogação do titular, com a cascata declarada antes de confirmar.' },
  { metodo: 'GET', contrato: '/me/consentimentos/{id}/propagacao', superficie: 'portal', mock: null,
    nota: 'Propagação sistema por sistema; pendência acima de 24 h levanta alerta visível ao titular.' },
  { metodo: 'GET', contrato: '/me/decisoes/{id}', superficie: 'portal', mock: null,
    nota: 'Os fatores da decisão automatizada (Art. 20, §1º).' },
  { metodo: 'POST', contrato: '/me/decisoes/{id}/revisao', superficie: 'portal', mock: null,
    nota: 'A contestação do titular — o pedido, não o ato de rever.' },
  { metodo: 'POST', contrato: '/titulares/me/oposicao', superficie: 'portal', mock: null,
    nota: 'Art. 18, §2º. O caminho é o que a LIA vigente publica em canal_oposicao, letra por letra — '
      + 'e a cessação do legítimo interesse é imediata, não posterior à análise.' },

  // ── Catálogo ─────────────────────────────────────────────────────────────
  { metodo: 'POST', contrato: '/catalog/inventories', superficie: 'console', mock: null, motivo: 'ingestao_ci',
    nota: 'Webhook de push do data-inventory.yaml. Sem tela e sem chamador no protótipo.' },
  { metodo: 'POST', contrato: '/catalog/validar', superficie: 'console', mock: '/v1/catalog/validar', papel: 'dpo',
    nota: 'Validação de campo do ROPA — recusa por Art. 11, 12, 33 e por consentimento sem registro vigente.' },
  { metodo: 'GET', contrato: '/catalog/fields', superficie: 'console', mock: '/v1/catalog/fields', papel: 'dpo',
    nota: 'ROPA vivo. totalItems só para papel confiável.' },

  // ── Threat model ─────────────────────────────────────────────────────────
  { metodo: 'GET', contrato: '/threat-models/{repo}', superficie: 'console', mock: null, motivo: 'ingestao_ci',
    nota: 'Artefato 2. Vive no repositório como markdown; o protótipo não tem tela para ele.' },
  { metodo: 'PUT', contrato: '/threat-models/{repo}', superficie: 'console', mock: null, motivo: 'ingestao_ci',
    nota: 'Grava o modelo e devolve o markdown para commit. Sem tela no protótipo.' },

  // ── Gates ────────────────────────────────────────────────────────────────
  { metodo: 'POST', contrato: '/gates/runs', superficie: 'console', mock: null, motivo: 'ingestao_ci',
    nota: 'Chamada pelos workflows de CI, não pela interface.' },
  { metodo: 'GET', contrato: '/gates', superficie: 'console', mock: '/v1/gates', papel: 'dpo',
    nota: 'Execuções recentes — cartões da T1.' },
  { metodo: 'GET', contrato: '/epicos', superficie: 'console', mock: '/v1/epicos', papel: 'auditor',
    nota: 'Checklist dos sete princípios, com o veredito calculado pela mesma função do gate de CI.' },

  // ── RIPD ─────────────────────────────────────────────────────────────────
  { metodo: 'POST', contrato: '/ripds/triage', superficie: 'console', mock: null, motivo: 'ingestao_ci',
    nota: 'Recebe o ripd-report.json do ripd-triage.sh.' },
  { metodo: 'POST', contrato: '/ripds/{id}/render', superficie: 'console', mock: '/v1/ripds/nao-existe/render', papel: 'engenharia',
    nota: 'Renderiza o RIPD.md.' },
  { metodo: 'POST', contrato: '/ripds/{id}/aprovar', superficie: 'console', mock: '/v1/ripds/nao-existe/aprovar', papel: 'dpo',
    nota: 'Aprovação do DPO. Não fecha com recomendação P0 em aberto.' },
  { metodo: 'POST', contrato: '/ripds/{id}/gatilho', superficie: 'console', mock: '/v1/ripds/nao-existe/gatilho', papel: 'engenharia',
    nota: 'Dispara gatilho de reabertura pendurado numa dispensa.' },

  // ── LIA ──────────────────────────────────────────────────────────────────
  { metodo: 'POST', contrato: '/lias/{id}/campos', superficie: 'console', mock: '/v1/lias/nao-existe/campos', papel: 'dpo',
    nota: 'Vincula campo à LIA; sensível é recusado (Art. 11).' },
  { metodo: 'POST', contrato: '/lias/{id}/assinar', superficie: 'console', mock: '/v1/lias/nao-existe/assinar', papel: 'dpo',
    nota: 'Assina e gera o LIA.md.' },
  { metodo: 'POST', contrato: '/lias/{id}/equidade', superficie: 'console', mock: '/v1/lias/nao-existe/equidade', papel: 'engenharia',
    nota: 'Risco-007. Mede a massa versionada contra o piso e derruba a vigência abaixo dele. '
      + 'A razão é derivada no servidor: o corpo não carrega número nenhum.' },

  // ── Step-up de autenticação (Risco-011) ──────────────────────────────────
  { metodo: 'POST', contrato: '/step-up', superficie: 'console', mock: '/v1/step-up', papel: 'dpo',
    nota: 'Abre o desafio. O código não sai na resposta: vai pelo canal, como no portal.' },
  { metodo: 'POST', contrato: '/step-up/{id}/confirmar', superficie: 'console',
    mock: '/v1/step-up/nao-existe/confirmar', papel: 'dpo',
    nota: 'Confirma o desafio e abre a janela. Recusa única para código errado, vencido e alheio.' },

  // ── Titulares e revelação ────────────────────────────────────────────────
  { metodo: 'POST', contrato: '/pseudonyms/resolve', superficie: 'console', mock: '/v1/pseudonyms/resolve', papel: 'dpo',
    nota: 'Reidentificação sob finalidade, justificativa e protocolo.' },
  { metodo: 'POST', contrato: '/titulares/buscar', superficie: 'console', mock: '/v1/titulares/buscar', papel: 'dpo',
    nota: 'Busca por hash, com cota antes do find para o 429 não virar oráculo.' },
  { metodo: 'GET', contrato: '/titulares/{id}', superficie: 'console', mock: '/v1/titulares/nao-existe', papel: 'dpo',
    nota: 'Ficha do balcão, com valores mascarados.' },
  { metodo: 'POST', contrato: '/decisoes/{id}/revisar', superficie: 'console', mock: '/v1/decisoes/nao-existe/revisar', papel: 'dpo',
    nota: 'O ato humano da revisão (Art. 20) — o pedido do titular é POST /me/decisoes/{id}/revisao.' },

  // ── Solicitações (balcão) ────────────────────────────────────────────────
  { metodo: 'GET', contrato: '/requests', superficie: 'console', mock: '/v1/requests', papel: 'dpo',
    nota: 'Fila do DPO com cronômetro de SLA.' },
  { metodo: 'POST', contrato: '/requests/{id}/concluir', superficie: 'console', mock: '/v1/requests/nao-existe/concluir', papel: 'dpo',
    nota: 'Para o cronômetro. Parcial e recusa exigem retidos[] com base legal e data.' },

  // ── Consentimento (balcão) ───────────────────────────────────────────────
  { metodo: 'GET', contrato: '/consentimentos', superficie: 'console', mock: '/v1/consentimentos', papel: 'dpo',
    nota: 'Registros por campo — a prova que sustenta a base legal no ROPA.' },
  { metodo: 'POST', contrato: '/consentimentos/{id}/revogar', superficie: 'console', mock: '/v1/consentimentos/nao-existe/revogar', papel: 'dpo',
    nota: 'Revogação do registro do campo, operada pelo balcão.' },

  // ── Incidentes (Art. 48) ─────────────────────────────────────────────────
  { metodo: 'GET', contrato: '/incidentes', superficie: 'console', mock: '/v1/incidentes', papel: 'dpo',
    nota: 'Fila de incidentes.' },
  { metodo: 'POST', contrato: '/incidentes', superficie: 'console', mock: '/v1/incidentes', papel: 'engenharia',
    nota: 'Abre com escopo lido do catálogo.' },
  { metodo: 'POST', contrato: '/incidentes/{id}/conter', superficie: 'console', mock: '/v1/incidentes/nao-existe/conter', papel: 'engenharia',
    nota: 'Contenção antes da decisão.' },
  { metodo: 'POST', contrato: '/incidentes/{id}/decisao', superficie: 'console', mock: '/v1/incidentes/nao-existe/decisao', papel: 'dpo',
    nota: 'Fundamento obrigatório inclusive para NÃO comunicar.' },
  { metodo: 'POST', contrato: '/incidentes/{id}/comunicar', superficie: 'console', mock: '/v1/incidentes/nao-existe/comunicar', papel: 'dpo',
    nota: 'Efetiva a comunicação à ANPD e aos titulares.' },
  { metodo: 'POST', contrato: '/incidentes/{id}/registrar-nao-comunicacao', superficie: 'console', mock: '/v1/incidentes/nao-existe/registrar-nao-comunicacao', papel: 'dpo',
    nota: 'Registra formalmente a decisão de não comunicar.' },
  { metodo: 'POST', contrato: '/incidentes/{id}/encerrar', superficie: 'console', mock: '/v1/incidentes/nao-existe/encerrar', papel: 'dpo',
    nota: 'Encerra o incidente.' },

  // ── Processos ────────────────────────────────────────────────────────────
  { metodo: 'POST', contrato: '/estados/{artefato}/{id}', superficie: 'console', mock: '/v1/estados/parecer/nao-existe', papel: 'dpo',
    nota: 'Uma rota para os oito artefatos. 409 sequência, 422 conteúdo.' },
  { metodo: 'GET', contrato: '/fila', superficie: 'console', mock: '/v1/fila', papel: 'dpo',
    nota: 'A fila do papel da sessão. Sem parâmetro, por desenho.' },
  { metodo: 'GET', contrato: '/dmn', superficie: 'console', mock: '/v1/dmn', papel: 'auditor',
    nota: 'Catálogo de D1, D2 e D3 com todas as versões.' },
  { metodo: 'POST', contrato: '/dmn/{tabela}/aplicar', superficie: 'console', mock: '/v1/dmn/d1/aplicar', papel: 'dpo',
    nota: 'Grava a versão e as entradas antes de responder.' },
  { metodo: 'GET', contrato: '/calendario', superficie: 'console', mock: '/v1/calendario', papel: 'produto',
    nota: 'O ano provisionado, com carga por mês.' },
  { metodo: 'GET', contrato: '/calendario/assinatura', superficie: 'console', mock: '/v1/calendario/assinatura', papel: 'dpo',
    nota: 'A URL do feed do próprio papel, e de mais nenhum.' },
  { metodo: 'GET', contrato: '/calendario/{token}.ics', superficie: 'console', mock: '/v1/calendario/invalido.ics', papel: 'dpo',
    nota: 'Feed assinado. A URL é a credencial — limitação declarada (Risco-036).' },
  { metodo: 'POST', contrato: '/calendario/{codigo}/prorrogar', superficie: 'console', mock: '/v1/calendario/nao-existe/prorrogar', papel: 'dpo',
    nota: 'Prorrogar exige justificativa, gravada antes de a data nova valer.' },

  // ── Expurgo, KMS, métricas, riscos ───────────────────────────────────────
  { metodo: 'POST', contrato: '/purge/runs', superficie: 'console', mock: null, motivo: 'ingestao_ci',
    nota: 'Registro pós-fato da execução do expurgo-permanente.py — o executor é externo (Risco-006).' },
  { metodo: 'POST', contrato: '/purge/{id}/verificar', superficie: 'console', mock: '/v1/purge/nao-existe/verificar', papel: 'dpo',
    nota: 'Recalcula os hashes do lote.' },
  { metodo: 'GET', contrato: '/retencao', superficie: 'console', mock: '/v1/retencao', papel: 'dpo',
    nota: 'Ciclo de vida por campo, com retencao_ate derivada e os três estados da T6.' },
  { metodo: 'POST', contrato: '/purge/executar', superficie: 'console', mock: '/v1/purge/executar', papel: 'dpo',
    nota: 'O executor: lote com limite, prova pré/pós do lote, idempotente por lote_chave.' },
  { metodo: 'GET', contrato: '/kms', superficie: 'console', mock: '/v1/kms', papel: 'seguranca',
    nota: 'Chaves, rotação e log de acesso.' },
  { metodo: 'POST', contrato: '/kms/rotations/{id}/steps', superficie: 'console', mock: null, motivo: 'ingestao_ci',
    nota: 'Progresso reportado pelo kms-rotation.yml.' },
  { metodo: 'POST', contrato: '/kms/{alias}/agendar-rotacao', superficie: 'console', mock: '/v1/kms/nao-existe/agendar-rotacao', papel: 'seguranca',
    nota: 'Chave revogada não rotaciona.' },
  { metodo: 'POST', contrato: '/kms/{alias}/promover-canary', superficie: 'console', mock: '/v1/kms/nao-existe/promover-canary', papel: 'seguranca',
    nota: 'Só avança se a recriptografia terminou.' },
  { metodo: 'POST', contrato: '/metrics/snapshots', superficie: 'console', mock: null, motivo: 'ingestao_ci',
    nota: 'Recebe o latest.json do metrics-collector.py.' },
  { metodo: 'GET', contrato: '/metrics', superficie: 'console', mock: '/v1/metrics', papel: 'produto',
    nota: 'Séries e maturidade da T1.' },
  { metodo: 'POST', contrato: '/telemetry/redaction', superficie: 'console', mock: null, motivo: 'ingestao_ci',
    nota: 'Só contagens. O valor redigido nunca trafega.' },
  { metodo: 'GET', contrato: '/risks', superficie: 'console', mock: '/v1/risks', papel: 'produto',
    nota: 'Matriz de riscos.' },
  { metodo: 'PATCH', contrato: '/risks/{id}', superficie: 'console', mock: '/v1/risks/nao-existe', papel: 'dpo',
    nota: 'Reclassificação com justificativa e histórico imutável.' },

  // ── Auditoria ────────────────────────────────────────────────────────────
  { metodo: 'GET', contrato: '/audit', superficie: 'console', mock: '/v1/audit', papel: 'auditor',
    nota: 'Trail append-only.' },
  { metodo: 'PATCH', contrato: '/audit/{id}', superficie: 'console', mock: '/v1/audit/1', papel: 'dpo',
    nota: 'Recusada com 409 pelo banco, não por convenção da aplicação.' },
  { metodo: 'DELETE', contrato: '/audit/{id}', superficie: 'console', mock: '/v1/audit/1', papel: 'dpo',
    nota: 'Recusada com 409 pelo banco, não por convenção da aplicação.' },
  { metodo: 'POST', contrato: '/audit/verificar', superficie: 'console', mock: '/v1/audit/verificar', papel: 'auditor',
    nota: 'Leitura que deixa rastro: o registro é consequência do sistema, não escalada do ator.' },
  { metodo: 'POST', contrato: '/audit/exportar', superficie: 'console', mock: '/v1/audit/exportar', papel: 'dpo',
    nota: 'Exportar o trail é, ele mesmo, um acesso — gravado antes de o arquivo existir.' },
];

/**
 * A exceção declarada, e a única.
 *
 * `POST /v1/audit/forjar` simula um DBA comprometido editando o log direto.
 * Ela **não pode** estar no contrato de produção: um contrato que documenta a
 * rota de forja documenta o ataque. Fica aqui, nomeada, para que o teste de
 * paridade não a trate como esquecimento — e para que ela apareça na lista que
 * o PR das premissas de aceite (Risco-035) vai transformar em catraca de build.
 */
export const ROTAS_APENAS_DEMO = [
  { metodo: 'POST' as const, mock: '/v1/audit/forjar',
    nota: 'Simulação de ataque, presa ao modo demonstração. Fora do contrato de produção por desenho (Risco-035).' },
];

/** As raízes que o dispatcher do console atende, derivadas das declarações acima. */
export const RAIZES_DO_MOCK: Set<string> = new Set(
  [
    ...OPERACOES.filter((o) => o.mock).map((o) => ({ metodo: o.metodo, mock: o.mock! })),
    ...ROTAS_APENAS_DEMO,
  ].map(({ metodo, mock }) => `${metodo} ${mock.replace(/^\/v1\//, '').split('?')[0].split('/')[0]}`),
);

/**
 * O caminho da oposição, e o canal que a LIA publica derivado dele.
 *
 * Existia como texto solto em três lugares — a coluna `lia.canal_oposicao` no
 * banco, a linha do `db/seed.sql` e uma string fixa dentro da T8 — e apontava
 * para uma rota que não existia em contrato algum (Risco-001, sub-item 3). Uma
 * LIA que anuncia canal inexistente não tem promessa fraca: tem o balanceamento
 * do Art. 10, §3º sustentado por uma salvaguarda que nunca foi construída.
 *
 * Agora o caminho tem um dono. O SQL continua sendo uma string literal — é um
 * artefato de banco, não código —, e é o teste de paridade que amarra os dois:
 * renomear qualquer um dos lados quebra a suíte.
 */
export const CAMINHO_DA_OPOSICAO = '/v1/titulares/me/oposicao';

export const canalDeOposicao = (liaCodigo: string): string =>
  `POST ${CAMINHO_DA_OPOSICAO}?lia=${liaCodigo}`;

export const operacaoDe = (metodo: MetodoHttp, contrato: string): Operacao | undefined =>
  OPERACOES.find((o) => o.metodo === metodo && o.contrato === contrato);

/** A chave usada nas comparações de conjunto dos testes de paridade. */
export const chaveDaOperacao = (metodo: string, caminho: string): string => `${metodo} ${caminho}`;
