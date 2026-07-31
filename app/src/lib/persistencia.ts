/**
 * Onde cada operação que grava vai parar (Risco-015).
 *
 * ── O defeito que isto torna visível ────────────────────────────────────────
 *
 * A ficha do Risco-015 diz que o fluxo de incidente existe só no protótipo:
 * "sem tabela `incidente` no schema e sem rota no contrato". A segunda metade
 * fechou em `f86020e`, quando as seis operações entraram no `openapi.yaml` — e a
 * primeira ficou. Rota servida sem tabela é promessa de persistência que o
 * desenho de produção não cumpre: o que a T9 abre morre com o processo, e o
 * prazo do Art. 48 fica sem de onde ser contado.
 *
 * Medindo antes de mexer, o vão era maior que incidentes. Seis famílias de rota
 * gravam sem tabela correspondente, e cada uma por um motivo diferente — algumas
 * porque não deveriam ter tabela mesmo (validação pura, rota de forja que existe
 * para ser recusada), outras porque é lacuna real com risco próprio já aberto.
 *
 * ── Por que um mapa, e não só a tabela nova ────────────────────────────────
 *
 * Fechar incidentes sem isto deixaria as outras cinco invisíveis: continuariam
 * sem tabela, sem ninguém saber, até a próxima auditoria. O mapa não as resolve —
 * torna cada uma **declarada**, com motivo e, quando é lacuna, o risco que a
 * cobre. Uma operação nova que nasça sem entrada aqui reprova, e é isso que
 * impede o vão de crescer em silêncio.
 *
 * A diferença entre "não tem tabela porque não deve ter" e "não tem tabela e
 * deveria" é a razão de `risco` existir como campo separado do motivo.
 */

export type Destino =
  /** Persiste nesta tabela do `schema.sql`. */
  | { tabela: string }
  /** Não persiste, e o motivo. `risco` presente = lacuna real já catalogada. */
  | { motivo: string; risco?: string };

/**
 * Toda operação de escrita do contrato, e o destino dela.
 *
 * A chave é `MÉTODO /caminho` exatamente como o `openapi.yaml` a escreve: é o que
 * permite conferir os dois lados sem normalizar nada de cabeça.
 */
export const DESTINO: Record<string, Destino> = {
  // ── Trail ────────────────────────────────────────────────────────────────
  'POST /audit/exportar': { tabela: 'audit_log' },
  'POST /audit/verificar': {
    motivo: 'Recalcula a cadeia de hash sobre o que já existe e devolve o veredito. Verificação não cria fato — '
      + 'e um "registro de que alguém verificou" seria fato novo sobre o verificador, não sobre o trail.',
  },
  'PATCH /audit/{id}': {
    motivo: 'Rota de forja: existe no contrato para ser recusada, e é assim que a recusa vira comportamento '
      + 'testável em vez de promessa. Nunca persiste — persistir seria o defeito que ela demonstra.',
  },
  'DELETE /audit/{id}': {
    motivo: 'Rota de forja, mesmo caso do PATCH: o trail é append-only e o DELETE existe para provar que é.',
  },

  // ── Catálogo e modelagem ─────────────────────────────────────────────────
  'POST /catalog/inventories': { tabela: 'inventario_versao' },
  'POST /catalog/validar': {
    motivo: 'Valida o inventário submetido e devolve os achados. Nada é aceito no catálogo por esta rota — '
      + 'validar e admitir são operações diferentes, e juntá-las faria a validação virar escrita.',
  },
  'PUT /threat-models/{repo}': { tabela: 'threat_model' },
  'POST /dmn/{tabela}/aplicar': {
    motivo: 'Aplica a tabela de decisão versionada em `docs/processos/*.dmn` à entrada dada e devolve o '
      + 'resultado. A decisão é função pura da versão da DMN; guardá-la duplicaria o que a DMN já determina.',
  },
  'POST /estados/{artefato}/{id}': {
    motivo: 'Transição genérica dos nove artefatos: despacha para a tabela do artefato alvo (`lia`, `achado`, '
      + '`incidente`, `solicitacao_titular`, `fornecedor`…). Não tem tabela própria porque não é entidade.',
  },

  // ── Gate, métricas, telemetria ───────────────────────────────────────────
  'POST /gates/runs': { tabela: 'gate_run' },
  'POST /metrics/snapshots': { tabela: 'metric_snapshot' },
  'POST /telemetry/redaction': {
    motivo: 'Contagem agregada de quanto o redator removeu, por tipo. Guardar por evento significaria guardar '
      + 'o que foi redigido — o oposto do que o redator existe para fazer.',
  },

  // ── LIA ──────────────────────────────────────────────────────────────────
  'POST /lias/{id}/assinar': { tabela: 'lia' },
  'POST /lias/{id}/campos': { tabela: 'lia_dataset' },
  'POST /lias/{id}/equidade': { tabela: 'lia_evidencia' },

  // ── RIPD ─────────────────────────────────────────────────────────────────
  'POST /ripds/triage': { tabela: 'ripd' },
  'POST /ripds/{id}/aprovar': { tabela: 'ripd_aprovacao' },
  'POST /ripds/{id}/gatilho': { tabela: 'ripd_trigger' },
  'POST /ripds/{id}/render': {
    motivo: 'Renderiza o RIPD a partir do que já está persistido e devolve o documento. O que prova a '
      + 'aprovação é `ripd_aprovacao`, com assinatura; o render é leitura com formato.',
  },

  // ── Risco ────────────────────────────────────────────────────────────────
  'PATCH /risks/{id}': { tabela: 'risco_reclassificacao' },

  // ── Incidente (Art. 48) — o que este PR fecha ────────────────────────────
  'POST /incidentes': { tabela: 'incidente' },
  'POST /incidentes/{id}/conter': { tabela: 'incidente_evento' },
  'POST /incidentes/{id}/decisao': { tabela: 'incidente_evento' },
  'POST /incidentes/{id}/comunicar': { tabela: 'incidente_evento' },
  'POST /incidentes/{id}/registrar-nao-comunicacao': { tabela: 'incidente_evento' },
  'POST /incidentes/{id}/encerrar': { tabela: 'incidente_evento' },

  // ── Solicitação do titular ───────────────────────────────────────────────
  'POST /requests': { tabela: 'solicitacao_titular' },
  'POST /requests/{id}/concluir': { tabela: 'solicitacao_evento' },
  'POST /requests/{id}/mensagens': { tabela: 'solicitacao_mensagem' },
  'POST /decisoes/{id}/revisar': { tabela: 'revisao_decisao' },
  'POST /me/decisoes/{id}/revisao': { tabela: 'revisao_decisao' },

  // ── Consentimento ────────────────────────────────────────────────────────
  'POST /consentimentos/{id}/revogar': { tabela: 'consentimento_revogacao' },
  'POST /me/consentimentos/{id}/revogacao': { tabela: 'consentimento_revogacao' },

  // ── Expurgo ──────────────────────────────────────────────────────────────
  'POST /purge/runs': { tabela: 'expurgo_run' },
  'POST /purge/executar': { tabela: 'expurgo_run' },
  'POST /purge/{id}/verificar': { tabela: 'expurgo_entrada' },

  // ── Fornecedor ───────────────────────────────────────────────────────────
  'POST /fornecedores/{slug}/desligamento': { tabela: 'fornecedor_desligamento' },
  'POST /fornecedores/{slug}/chave/destruicao': { tabela: 'fornecedor_desligamento' },

  // ── KMS ──────────────────────────────────────────────────────────────────
  'POST /kms/{alias}/agendar-rotacao': { tabela: 'kms_rotacao' },
  'POST /kms/{alias}/promover-canary': { tabela: 'kms_rotacao_etapa' },
  'POST /kms/rotations/{id}/steps': { tabela: 'kms_rotacao_etapa' },

  // ── Pseudônimo ───────────────────────────────────────────────────────────
  'POST /pseudonyms/resolve': { tabela: 'audit_log' },
  'POST /titulares/buscar': { tabela: 'audit_log' },
  // Leitura, e persiste mesmo assim: a ficha do balcão grava `TITULAR_CONSULTADO`
  // antes de responder. Entra no mapa porque persistir é o critério, não o verbo.
  'GET /titulares/{id}': { tabela: 'audit_log' },

  // ── Lacunas reais, declaradas com o risco que as cobre ───────────────────
  //
  // Estas cinco não têm tabela **e deveriam ter**. Ficam aqui nomeadas em vez de
  // invisíveis: é a diferença entre uma ausência que alguém decidiu e uma que
  // ninguém percebeu.
  'POST /me/verificacao': {
    motivo: 'A verificação de identidade do portal vive só em memória: `BancoMock.verificacoes` é um `Map`, e o '
      + 'schema não tem tabela. Sem ela, a etapa que autoriza o exercício de direito não deixa rastro.',
    risco: 'Risco-009',
  },
  'POST /me/verificacao/{id}/codigo': {
    motivo: 'Mesma lacuna do POST anterior: o código enviado e a tentativa de confirmação não persistem, e '
      + 'sem persistência não há como provar quantas tentativas houve nem em que janela.',
    risco: 'Risco-009',
  },
  'POST /titulares/me/oposicao': {
    motivo: 'A oposição do Art. 18 §2º é lida de `BancoMock.oposicaoALia` e não tem tabela: o ato que faz o '
      + 'tratamento cessar não é persistido no desenho de produção.',
    risco: 'Risco-001',
  },
  'POST /step-up': {
    motivo: 'O step-up é derivado da operação no servidor e tem janela provada, mas não persiste: sem fator '
      + 'real (TOTP ou WebAuthn) não há o que guardar além de uma afirmação.',
    risco: 'Risco-014',
  },
  'POST /step-up/{id}/confirmar': {
    motivo: 'Mesma lacuna: a confirmação valida a janela derivada e não grava fato algum, porque o fator que '
      + 'ela deveria confirmar não existe.',
    risco: 'Risco-014',
  },
  'POST /calendario/{codigo}/prorrogar': {
    motivo: 'As obrigações do calendário anual são massa de cenário, sem tabela: prorrogar altera memória, e o '
      + 'prazo prorrogado não sobrevive ao processo.',
    risco: 'Risco-010',
  },
};

/** Um motivo mais curto que isto é rótulo, não explicação. */
export const MINIMO_DO_MOTIVO = 60;

export type Achado = { regra: string; detalhe: string };

/**
 * As leituras que persistem.
 *
 * Lista fechada, e curta de propósito: é a única `GET` com ação de PII e
 * finalidade exigida. O critério do mapa é **persistir**, não o verbo — uma
 * leitura que grava no trail antes de responder tem destino tanto quanto um
 * POST, e deixá-la de fora faria o mapa dizer que ela não persiste.
 */
export const LEITURAS_QUE_PERSISTEM = ['GET /titulares/{id}'] as const;

/** As operações do contrato que persistem, na forma `MÉTODO /caminho`. */
export const escritasDoContrato = (paths: Record<string, Record<string, unknown>>): string[] => {
  const ops: string[] = [];
  for (const [caminho, item] of Object.entries(paths)) {
    for (const m of ['post', 'patch', 'put', 'delete']) {
      if (item[m]) ops.push(`${m.toUpperCase()} ${caminho}`);
    }
    if (item.get && (LEITURAS_QUE_PERSISTEM as readonly string[]).includes(`GET ${caminho}`)) {
      ops.push(`GET ${caminho}`);
    }
  }
  return ops.sort();
};

/**
 * Nenhuma operação sem destino, nenhum destino sem tabela, nenhum motivo sem
 * corpo — e nenhuma entrada órfã.
 *
 * A quarta regra é a que evita o mapa envelhecer para o outro lado: entrada aqui
 * para operação que saiu do contrato é uma decisão sobre algo que não existe
 * mais, e ela sobrevive silenciosamente até confundir a próxima leitura.
 */
export const avaliarPersistencia = (
  escritas: string[],
  tabelasDoSchema: string[],
): Achado[] => {
  const achados: Achado[] = [];

  for (const op of escritas) {
    const d = DESTINO[op];
    if (!d) {
      achados.push({ regra: 'sem-destino', detalhe: `${op}: grava e não declara onde` });
      continue;
    }
    if ('tabela' in d) {
      if (!tabelasDoSchema.includes(d.tabela)) {
        achados.push({ regra: 'tabela-inexistente', detalhe: `${op}: aponta \`${d.tabela}\`, que não existe no schema` });
      }
    } else if (d.motivo.trim().length < MINIMO_DO_MOTIVO) {
      achados.push({ regra: 'motivo-sem-corpo', detalhe: `${op}: motivo com ${d.motivo.trim().length} caracteres` });
    }
  }

  for (const op of Object.keys(DESTINO)) {
    if (!escritas.includes(op)) {
      achados.push({ regra: 'destino-orfao', detalhe: `${op}: declarado aqui e ausente do contrato` });
    }
  }

  return achados;
};

/** As lacunas reais, com o risco que cobre cada uma — contáveis, não invisíveis. */
export const lacunasDeclaradas = (): { op: string; risco: string }[] =>
  Object.entries(DESTINO)
    .filter(([, d]) => !('tabela' in d) && d.risco)
    .map(([op, d]) => ({ op, risco: (d as { risco: string }).risco }));

export const relatorioDaPersistencia = (achados: Achado[]): string =>
  achados.map((a) => `  ${a.regra}: ${a.detalhe}`).join('\n');
