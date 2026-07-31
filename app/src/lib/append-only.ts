/**
 * Que tabelas são append-only, e por que as outras não são (Risco-024).
 *
 * ── O que a auditoria encontrou, e o que a medição corrigiu ─────────────────
 *
 * A ficha diz que `bloqueia_mutacao` cobria três tabelas e que ficavam mutáveis
 * `expurgo_run`, `expurgo_entrada`, `kms_acesso`, `solicitacao_evento` e
 * `gate_finding`. Medindo antes de mexer, duas coisas mudaram de figura:
 *
 *   1. `audit_log` **está** protegido — por função própria
 *      (`audit_log_expurgo_de_pii`), que abre uma exceção estreita e nomeada para
 *      o expurgo da PII do operador. Contar só `bloqueia_mutacao` não o via.
 *   2. As duas tabelas que a série acrescentou — `consentimento` e
 *      `consentimento_texto` — são **fatos imutáveis**, e protegê-las estava
 *      certo. Não havia "tabela errada" a destravar: havia prova acumulada sem
 *      barreira nenhuma, que é coisa diferente.
 *
 * ── O critério, que exclui tanto quanto inclui ──────────────────────────────
 *
 * Append-only é para **fato que sustenta prova**. Estado operacional não entra:
 * `expurgo_run` carimba `concluido_em` no fim, `expurgo_entrada` recebe a
 * conferência depois — verificar antes de expurgar não verifica nada —, e
 * `revogacao_propagacao` acompanha a cascata até o parceiro confirmar. Congelar
 * qualquer uma travaria a operação sem ganhar garantia, e barreira que trava sem
 * garantir é defeito com aparência de rigor.
 *
 * ── Por que este módulo existe, e não só o trigger ─────────────────────────
 *
 * O protótipo não consulta o banco: reproduz as restrições dele. Uma regra que
 * só existisse no `schema.sql` valeria para uma produção que ainda não existe, e
 * não para o que roda. As duas listas abaixo são a mesma decisão escrita onde o
 * mock a lê, e um teste de paridade confere as duas contra o SQL — tabela
 * append-only no schema e ausente daqui reprova, e o contrário também.
 */

/**
 * Fato que sustenta prova. UPDATE e DELETE recusados pelo banco.
 *
 * A ordem é a do `schema.sql`, para a conferência lado a lado ser possível sem
 * ordenar nada de cabeça.
 */
export const APPEND_ONLY = [
  'audit_log',
  'risco_reclassificacao',
  'linhagem',
  'consentimento',
  'consentimento_texto',
  'kms_acesso',
  'solicitacao_evento',
  'consentimento_revogacao',
  'achado_evidencia',
  'lia_evidencia',
  'ripd_aprovacao',
  'gate_finding',
  'metric_snapshot',
  'incidente_evento',
] as const;

/**
 * Considerada e recusada, com o motivo.
 *
 * A lista existe para que a recusa não seja confundida com esquecimento na
 * próxima leitura — é a mesma razão pela qual o job fora da matriz declara o
 * motivo no próprio YAML em vez de numa lista de exceções à parte.
 */
export const MUTAVEL_COM_MOTIVO: Record<string, string> = {
  expurgo_run:
    '`status` sai de "executando" e `concluido_em` é carimbado no fim: o executor precisa dos dois.',
  expurgo_entrada:
    '`verificado_em`, `verificado_por` e `integro` são escritos na conferência, que é posterior por '
    + 'desenho — verificar antes de expurgar não verifica nada.',
  revogacao_propagacao:
    '`estado` acompanha a cascata até o parceiro confirmar; congelá-lo pararia a propagação no primeiro passo.',
  kms_rotacao_etapa:
    '`status` é a própria etapa avançando: uma rotação de chave é uma sequência de passos que muda de '
    + 'estado até terminar, e congelá-la deixaria toda rotação parada no primeiro passo. O que prova a '
    + 'rotação é o `kms_acesso`, que está append-only.',
  incidente:
    '`estado` avança pela máquina (aberto → contido → decidido → comunicado/nao_comunicado → encerrado) e a '
    + 'decisão chega depois da contenção: congelá-la pararia o fluxo do Art. 48 no primeiro passo. O que prova '
    + 'o cumprimento do prazo é `incidente_evento`, que está append-only.',
  solicitacao_mensagem:
    'Fato, **menos** `lida_em`, que é recibo de leitura e só existe depois. Uma exceção estreita como a do '
    + '`audit_log` resolveria, e não foi feita: seria função nova sem defeito que a motive, e o corpo já é '
    + 'protegido contra CPF por CHECK.',
};

/**
 * As tabelas que o `schema.sql` de fato protege.
 *
 * Lê os dois caminhos, porque são dois: o `bloqueia_mutacao()` genérico e a
 * função própria do trail. Procurar só o primeiro foi o que fez a primeira
 * medição declarar o `audit_log` desprotegido — e um inventário que perde uma
 * proteção existente erra para o lado de exigir trabalho que já foi feito.
 */
export const appendOnlyDoSchema = (schema: string): string[] => {
  const nomes = new Set<string>();
  for (const m of schema.matchAll(
    /BEFORE UPDATE OR DELETE ON (\w+)\s*\n\s*FOR EACH ROW EXECUTE FUNCTION (\w+)\(\)/g,
  )) {
    if (m[2] === 'bloqueia_mutacao' || m[2].startsWith('audit_log_')) nomes.add(m[1]);
  }
  return [...nomes];
};

export type Achado = { regra: string; detalhe: string };

/**
 * Paridade entre a decisão escrita aqui e a aplicada no banco, nos dois sentidos.
 *
 * E a terceira regra, que é a que impede a lista de virar decoração: nenhuma
 * tabela pode estar nas duas listas. Uma tabela append-only com motivo declarado
 * para ser mutável é um par de afirmações que se contradiz, e a contradição
 * sobrevive à mudança — vai continuar lá, mentindo, depois de alguém corrigir só
 * um dos lados.
 */
export const avaliarAppendOnly = (schema: string): Achado[] => {
  const noSchema = appendOnlyDoSchema(schema);
  const declaradas: string[] = [...APPEND_ONLY];
  const achados: Achado[] = [];

  for (const t of noSchema.filter((t) => !declaradas.includes(t))) {
    achados.push({ regra: 'no-schema-e-nao-no-mock', detalhe: `${t}: protegida no banco e ausente de APPEND_ONLY` });
  }
  for (const t of declaradas.filter((t) => !noSchema.includes(t))) {
    achados.push({ regra: 'no-mock-e-nao-no-schema', detalhe: `${t}: em APPEND_ONLY e sem trigger no banco` });
  }
  for (const t of declaradas.filter((t) => t in MUTAVEL_COM_MOTIVO)) {
    achados.push({ regra: 'nas-duas-listas', detalhe: `${t}: append-only E com motivo para ser mutável` });
  }
  for (const [t, motivo] of Object.entries(MUTAVEL_COM_MOTIVO)) {
    if (motivo.trim().length < 40) {
      achados.push({ regra: 'motivo-sem-corpo', detalhe: `${t}: motivo com ${motivo.trim().length} caracteres` });
    }
  }
  return achados;
};

export const relatorioDoAppendOnly = (achados: Achado[]): string =>
  achados.map((a) => `  ${a.regra}: ${a.detalhe}`).join('\n');
