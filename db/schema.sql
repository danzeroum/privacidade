-- =====================================================================
--  Plataforma de Governança de Privacidade (LGPD) — schema PostgreSQL 15
-- ---------------------------------------------------------------------
--  Escopo: metadados de governança e evidências.
--  NÃO armazena dado pessoal de titular em texto claro. As únicas colunas
--  que tocam titular guardam pseudônimo HMAC ou hash com sal — a resolução
--  é delegada ao serviço do produto (ver docs/01-arquitetura.md, ADR-4).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS gov;
SET search_path = gov, public;

-- ---------------------------------------------------------------------
-- 0. Domínios e enums — vocabulário controlado da LGPD
-- ---------------------------------------------------------------------

CREATE TYPE base_legal AS ENUM (
  'consentimento',            -- Art. 7º, I
  'obrigacao_legal',          -- Art. 7º, II
  'politica_publica',         -- Art. 7º, III
  'pesquisa',                 -- Art. 7º, IV
  'execucao_contrato',        -- Art. 7º, V
  'exercicio_direitos',       -- Art. 7º, VI
  'protecao_vida',            -- Art. 7º, VII
  'tutela_saude',             -- Art. 7º, VIII
  'legitimo_interesse',       -- Art. 7º, IX  (exige LIA vigente)
  'protecao_credito'          -- Art. 7º, X
);

CREATE TYPE categoria_dado AS ENUM ('anonimizado', 'pseudonimizado', 'pessoal', 'sensivel');

CREATE TYPE tipo_armazenamento AS ENUM (
  'bruto',            -- 📷  exibido sem máscara só com finalidade + step-up
  'hash',             -- 🔒  SHA-256 + sal, irreversível
  'hmac',             -- 🎭  pseudônimo reversível pelo serviço autorizado
  'criptografado',    --     envelope encryption (DEK por registro)
  'agregado'          --     k-anonimato aplicado (k >= 5)
);

CREATE TYPE mecanismo_transferencia AS ENUM (
  'pais_adequado', 'clausulas_padrao_anpd', 'normas_corporativas',
  'consentimento_especifico', 'nao_aplicavel'
);

-- As sete categorias canônicas do LINDDUN, mais os três rótulos operacionais que o
-- template `.privacy/threat-model.md` desta organização usa. A UI mostra os rótulos do
-- time com a equivalência canônica ao lado; o banco aceita ambos para que o modelo
-- continue comparável fora de casa sem forçar o time a trocar de vocabulário.
CREATE TYPE linddun_categoria AS ENUM (
  'linkability', 'identifiability', 'non_repudiation', 'detectability',
  'disclosure', 'unawareness', 'non_compliance',
  'location', 'inference', 'discrimination'
);

CREATE TYPE severidade AS ENUM ('baixa', 'media', 'alta', 'critica');

CREATE TYPE tratamento_risco AS ENUM ('mitigar', 'transferir', 'evitar', 'aceitar');

CREATE TYPE dano_titular AS ENUM ('material', 'moral', 'discriminacao', 'perda_de_controle');

-- 'oposicao' (Art. 18, §2º) é distinto de 'bloqueio' (Art. 18, IV): bloqueio
-- suspende um dado, oposição objeta ao FUNDAMENTO do tratamento. É a oposição
-- que a LIA publica em lia.canal_oposicao como salvaguarda do legítimo
-- interesse (Art. 10, §3º) — apelidar um de outro deixaria a LIA apontando
-- para um canal que decide outra coisa.
CREATE TYPE direito_titular AS ENUM (
  'confirmacao', 'acesso', 'correcao', 'anonimizacao', 'bloqueio',
  'eliminacao', 'portabilidade', 'compartilhamentos', 'revogacao', 'revisao_decisao',
  'oposicao'
);

CREATE TYPE status_solicitacao AS ENUM ('recebida', 'em_analise', 'aguardando_titular', 'concluida', 'recusada');

CREATE TYPE status_chave AS ENUM ('pendente', 'ativa', 'canary', 'depreciada', 'revogada');

CREATE TYPE papel_ator AS ENUM ('engenharia', 'dpo', 'produto', 'seguranca', 'juridico', 'dados', 'auditor_externo', 'system');

-- Nota de retenção legível por humano e por máquina: "P90D", "consentimento_revogado",
-- "obrigacao_legal:lei_8846_1994:P5Y".
--
-- A obrigação legal passou a exigir **prazo** além da norma. Antes era só o
-- nome da norma, e norma sem prazo não deriva data nenhuma: a forma mais forte
-- de retenção era a única sem vencimento calculável, o que é o avesso do que
-- ela deveria ser.
CREATE DOMAIN retencao AS TEXT CHECK (VALUE ~ '^(P[0-9]+[DMY]|indeterminado|consentimento_revogado|obrigacao_legal:[a-z0-9_.\- ]+:P[0-9]+[DMY])$');

-- De que instante o prazo conta. Declarado por campo no ROPA, nunca escolhido
-- no momento do expurgo: `retencao_ate` não é derivável de `retencao` sozinho
-- ("P5Y" a partir de quê?), e é essa metade que faltava para a coluna existir.
CREATE TYPE fato_gerador AS ENUM (
  'coleta', 'ultima_atualizacao', 'fim_do_contrato',
  'revogacao_do_consentimento', 'encerramento_da_solicitacao'
);

-- ---------------------------------------------------------------------
-- 0b. A derivação de retencao_ate — a mesma regra de app/src/mock/retencao.ts
--
-- IMMUTABLE de propósito: é o que permite usá-la em coluna GENERATED, e coluna
-- gerada é a forma mais forte de "derivada no servidor, nunca digitada" — o
-- banco recusa o INSERT que tentar escrever o valor.
--
-- As duas implementações (esta e a de TypeScript) são cobradas contra a MESMA
-- tabela de casos, db/retencao-casos.csv, por db/tests.sql e pela suíte do app.
-- Divergir entre elas reprova dos dois lados.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gov.retencao_ate(p_retencao TEXT, p_marco DATE)
RETURNS DATE
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
DECLARE
  v_periodo TEXT;
  v_n INT;
  v_u TEXT;
BEGIN
  -- Indeterminado nunca vence. Só é aceito com justificativa no ROPA
  -- (campo_indeterminado_exige_fonte), senão prazo sem fim entra por omissão.
  IF p_retencao = 'indeterminado' THEN RETURN NULL; END IF;

  -- Sem marco não há prazo: NULL aqui é "ainda não há fato gerador"
  -- (consentimento não revogado, contrato em curso), e não "sem prazo".
  IF p_marco IS NULL THEN RETURN NULL; END IF;

  -- Carência de 30 dias após a revogação: o tempo de propagar a cascata antes
  -- de eliminar. Zero faria a prova de execução chegar depois do dado sumir.
  IF p_retencao = 'consentimento_revogado' THEN
    RETURN (p_marco + INTERVAL '30 days')::DATE;
  END IF;

  v_periodo := CASE
    WHEN p_retencao LIKE 'obrigacao_legal:%' THEN split_part(p_retencao, ':', 3)
    ELSE p_retencao
  END;

  v_n := NULLIF(substring(v_periodo FROM '^P([0-9]+)'), '')::INT;
  v_u := substring(v_periodo FROM '([DMY])$');
  IF v_n IS NULL OR v_u IS NULL THEN RETURN NULL; END IF;

  RETURN (p_marco + (v_n || CASE v_u
                              WHEN 'D' THEN ' days'
                              WHEN 'M' THEN ' months'
                              ELSE ' years'
                            END)::INTERVAL)::DATE;
END;
$fn$;

COMMENT ON FUNCTION gov.retencao_ate(TEXT, DATE) IS
  'Deriva a data de eliminação a partir do domínio retencao e do marco do fato gerador. '
  'Espelhada em app/src/mock/retencao.ts; paridade cobrada por db/retencao-casos.csv.';

-- ---------------------------------------------------------------------
-- 1. Tenancy, atores e finalidades
-- ---------------------------------------------------------------------

CREATE TABLE tenant (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  nome          TEXT NOT NULL,
  dpo_email     TEXT NOT NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ator (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  subject_oidc  TEXT NOT NULL,                 -- claim `sub` do provedor OIDC
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL,
  papel         papel_ator NOT NULL,
  finalidades   TEXT[] NOT NULL DEFAULT '{}',  -- claim `purposes[]`: atendimento, cobranca, auditoria...
  mfa_ativo     BOOLEAN NOT NULL DEFAULT false,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subject_oidc)
);

CREATE INDEX ator_tenant_papel_idx ON ator (tenant_id, papel) WHERE ativo;

-- ---------------------------------------------------------------------
-- 2. Catálogo de dados vivo  — artefato (1) data-inventory.*.yaml   [Tela T2]
-- ---------------------------------------------------------------------

CREATE TABLE sistema (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,                  -- 'credit-scoring'
  nome           TEXT NOT NULL,
  repositorio    TEXT NOT NULL,                  -- 'danzeroum/credit-scoring'
  dominio        TEXT,                           -- 'financeiro'
  time_dono      TEXT NOT NULL,
  steward_id     UUID REFERENCES ator(id),
  criticidade    severidade NOT NULL DEFAULT 'media',
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

-- Cada push em .privacy/data-inventory.*.yaml cria uma versão imutável.
CREATE TABLE inventario_versao (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sistema_id     UUID NOT NULL REFERENCES sistema(id) ON DELETE CASCADE,
  arquivo        TEXT NOT NULL,                  -- '.privacy/data-inventory.product.yaml'
  commit_sha     TEXT NOT NULL,
  versao         TEXT NOT NULL,                  -- campo `versao` do YAML
  conteudo       JSONB NOT NULL,                 -- YAML normalizado
  conteudo_hash  TEXT NOT NULL,                  -- sha256 do YAML cru
  valido         BOOLEAN NOT NULL DEFAULT false,
  erros_validacao JSONB NOT NULL DEFAULT '[]',
  importado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  importado_por  UUID REFERENCES ator(id),
  UNIQUE (sistema_id, arquivo, commit_sha)
);

CREATE TABLE dataset (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sistema_id     UUID NOT NULL REFERENCES sistema(id) ON DELETE CASCADE,
  versao_id      UUID NOT NULL REFERENCES inventario_versao(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,                  -- 'clientes'
  schema_fisico  TEXT,                           -- 'public'
  zona_lake      TEXT CHECK (zona_lake IN ('raw', 'trusted', 'refined')),
  volume_diario  BIGINT,
  vigente        BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (versao_id, nome)
);

CREATE INDEX dataset_vigente_idx ON dataset (sistema_id) WHERE vigente;

CREATE TABLE campo (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id        UUID NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  nome              TEXT NOT NULL,               -- 'cpf'
  tipo_armazenado   tipo_armazenamento NOT NULL,
  categoria         categoria_dado NOT NULL,
  sensivel          BOOLEAN NOT NULL DEFAULT false,
  titular           TEXT NOT NULL DEFAULT 'pessoa_fisica',
  origem            TEXT,                        -- 'frontend_form' | 'API Serasa'
  finalidade        TEXT NOT NULL,
  base_legal        base_legal NOT NULL,
  lia_id            UUID,                        -- FK adiada: obrigatória se base_legal = legitimo_interesse
  retencao          retencao NOT NULL,
  retencao_fonte    TEXT,                        -- norma que sustenta o prazo
  fato_gerador      fato_gerador NOT NULL DEFAULT 'coleta',
  -- Volume e marco alimentam o motor: o primeiro dá a criticidade do achado, o
  -- segundo é de onde o prazo conta. Sem eles a retenção continuaria sendo um
  -- texto que ninguém consegue executar.
  registros_estimados     BIGINT NOT NULL DEFAULT 0 CHECK (registros_estimados >= 0),
  registro_mais_antigo_em DATE,
  -- GENERATED: o banco recusa quem tentar escrever esta coluna. É a forma mais
  -- forte de "derivada no servidor, nunca digitada" — mais forte que confiar na
  -- aplicação, porque não há caminho de escrita que a contorne.
  retencao_ate      DATE GENERATED ALWAYS AS (gov.retencao_ate(retencao, registro_mais_antigo_em)) STORED,
  UNIQUE (dataset_id, nome),

  -- Art. 11: legítimo interesse, contrato e proteção de crédito não sustentam dado sensível.
  CONSTRAINT campo_sensivel_base_legal CHECK (
    NOT sensivel OR base_legal IN
      ('consentimento','obrigacao_legal','protecao_vida','tutela_saude','politica_publica','pesquisa')
  ),
  -- Hash de CPF não é anonimização: o espaço de busca é pequeno e reverte por força bruta.
  -- Só agregação com k-anonimato tira o dado do escopo da LGPD (Art. 12).
  CONSTRAINT campo_anonimizado_exige_agregacao CHECK (
    categoria <> 'anonimizado' OR tipo_armazenado = 'agregado'
  ),
  CONSTRAINT campo_pseudonimizado_reversivel CHECK (
    categoria <> 'pseudonimizado' OR tipo_armazenado IN ('hmac','criptografado')
  ),
  -- Prazo sem fim só existe declarado, nunca por omissão: "indeterminado" tem
  -- de dizer qual norma ou finalidade o sustenta.
  CONSTRAINT campo_indeterminado_exige_fonte CHECK (
    retencao <> 'indeterminado' OR retencao_fonte IS NOT NULL
  ),
  -- Onde há marco e o domínio não é dos que nunca vencem, a data existe. Este
  -- CHECK é o que impede a coluna de voltar a ser decorativa.
  CONSTRAINT campo_retencao_ate_derivada CHECK (
    retencao IN ('indeterminado','consentimento_revogado')
    OR registro_mais_antigo_em IS NULL
    OR retencao_ate IS NOT NULL
  )
);

CREATE INDEX campo_sensivel_idx      ON campo (sensivel) WHERE sensivel;
CREATE INDEX campo_base_legal_idx    ON campo (base_legal);
CREATE INDEX campo_lia_idx           ON campo (lia_id) WHERE lia_id IS NOT NULL;
-- Índice PARCIAL: a maioria das linhas não tem prazo, e indexá-las custaria
-- espaço sem servir à única consulta que importa — "o que venceu?". Com ele o
-- executor faz varredura de faixa O(log n + k), k = vencidos; sem ele, O(n) por
-- execução sobre a tabela inteira.
CREATE INDEX campo_retencao_ate_idx  ON campo (retencao_ate) WHERE retencao_ate IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3b. Fornecedor — o destino como entidade, e o DPA como fato com prazo
--
-- `compartilhamento.destino` era TEXT livre: "OpenAI" repetido em várias
-- linhas, sem chave, sem contrato. `dpa_assinado` e `dpa_expira_em` existiam
-- ali desde sempre, sem uma constraint e sem um teste — e por isso a pergunta
-- "posso mandar dado pessoal para este parceiro hoje?" não tinha onde ser
-- feita: cada linha carregava a própria cópia da resposta, e nada garantia que
-- as cópias concordassem.
-- ---------------------------------------------------------------------
CREATE TABLE fornecedor (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  slug                TEXT NOT NULL,             -- 'openai'
  nome                TEXT NOT NULL,             -- 'OpenAI'
  papel               TEXT NOT NULL CHECK (papel IN ('operador','controlador','controlador_conjunto')),
  pais                TEXT,
  -- `dpa_uri` aponta para um arquivo; `dpa_assinado` diz que ele foi firmado.
  -- Tratar os dois como a mesma coisa é como a conformidade de papel nasce:
  -- alguém vê o anexo, marca o item, e ninguém mais pergunta se foi assinado.
  dpa_assinado        BOOLEAN NOT NULL DEFAULT false,
  dpa_uri             TEXT,
  dpa_hash            TEXT,
  dpa_expira_em       DATE,
  sla_incidente_horas INT CHECK (sla_incidente_horas BETWEEN 1 AND 72),
  -- Chave por parceiro (Risco-008). A coluna liga fornecedor a kms_chave, e o
  -- desligamento a destrói: é o que torna o encerramento verificável em vez de
  -- prometido. A máquina que rege isso vive em `app/src/mock/estados.ts` e em
  -- `docs/processos/fornecedor.bpmn`, como a dos outros oito artefatos.
  kms_chave_id        UUID,
  /*
   * O estado do parceiro no ciclo de vida da relação.
   *
   * `desligando` é a janela contratual entre a decisão e a destruição da chave:
   * o parceiro precisa devolver ou eliminar o que tem, e o dado em trânsito
   * precisa chegar. Durante ela nenhuma transferência **nova** é aceita — quem
   * recusa é o trigger abaixo, no ato, antes de qualquer destruição.
   *
   * `desligado` não some nem apaga histórico: as transferências já gravadas
   * continuam legíveis, e é justamente esse período que uma auditoria examina.
   */
  estado              TEXT NOT NULL DEFAULT 'ativo'
                      CHECK (estado IN ('ativo','desligando','desligado')),
  /*
   * Quantos dias o DPA promete para devolução ou eliminação no encerramento.
   *
   * Existe para a janela declarada no desligamento ser **conferível contra o
   * contrato** em vez de livre. Sem esta coluna, "cumprimos o DPA no
   * encerramento" seria afirmação sem nada contra o que ser checada — a promessa
   * sem instrumento que esta série passou treze PRs fechando.
   */
  dpa_encerramento_dias INT CHECK (dpa_encerramento_dias BETWEEN 0 AND 365),
  UNIQUE (tenant_id, slug),
  -- Contrato assinado sem prazo não se vigia: não há o que vencer, e o que não
  -- vence não entra em varredura nenhuma.
  CONSTRAINT dpa_assinado_tem_prazo CHECK (NOT dpa_assinado OR dpa_expira_em IS NOT NULL)
);

CREATE INDEX fornecedor_dpa_idx ON fornecedor (dpa_expira_em) WHERE dpa_assinado;

/*
 * O desligamento é **fato**, não flag.
 *
 * `UPDATE fornecedor SET estado='desligado'` responderia "está desligado" e
 * nada mais: quem decidiu, por quê, quando, e qual janela foi prometida sairiam
 * do registro no instante em que alguém rodasse o comando. É a mesma razão pela
 * qual a dispensa de RIPD virou linha append-only em vez de campo booleano.
 *
 * A janela é obrigatória mesmo quando é de zero dia. Zero declarado é uma
 * decisão ("não há dado a devolver"); zero implícito é uma etapa que ninguém
 * percebeu que existia.
 */
CREATE TABLE fornecedor_desligamento (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id UUID NOT NULL REFERENCES fornecedor(id) ON DELETE RESTRICT,
  motivo        TEXT NOT NULL CHECK (length(btrim(motivo)) >= 20),
  decidido_por  UUID NOT NULL REFERENCES ator(id),
  decidido_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  janela_dias   INT NOT NULL CHECK (janela_dias BETWEEN 0 AND 365),
  -- Derivada, e não digitada: o fim da janela é uma função da decisão, e um
  -- campo próprio permitiria que ele divergisse dela.
  janela_ate    DATE NOT NULL GENERATED ALWAYS AS ((decidido_em AT TIME ZONE 'UTC')::date + janela_dias) STORED,
  -- A prova da destruição da chave. Enquanto for nula, o desligamento está em
  -- curso; preenchida, ele terminou. É o que a varredura de prazo consulta.
  chave_destruida_em TIMESTAMPTZ,
  chave_destruida_por UUID REFERENCES ator(id),
  prova_hash    TEXT,
  CONSTRAINT prova_completa CHECK (
    (chave_destruida_em IS NULL AND chave_destruida_por IS NULL AND prova_hash IS NULL)
    OR (chave_destruida_em IS NOT NULL AND chave_destruida_por IS NOT NULL AND prova_hash IS NOT NULL)
  )
);

-- Um desligamento aberto por parceiro. Dois abertos seriam duas janelas
-- concorrentes, e nenhuma varredura saberia qual prazo cobrar.
CREATE UNIQUE INDEX fornecedor_desligamento_aberto_uk
  ON fornecedor_desligamento (fornecedor_id) WHERE chave_destruida_em IS NULL;

/*
 * A janela prometida não pode ultrapassar o que o contrato promete.
 *
 * Sem isto, "o desligamento cumpre o DPA" seria prosa: qualquer janela caberia,
 * inclusive uma maior que o prazo de devolução firmado. Contrato sem prazo de
 * encerramento declarado não restringe nada — e essa ausência é visível na
 * coluna, não escondida aqui.
 */
CREATE OR REPLACE FUNCTION janela_cabe_no_contrato() RETURNS TRIGGER AS $$
DECLARE v_prometido INT; v_nome TEXT;
BEGIN
  SELECT dpa_encerramento_dias, nome INTO v_prometido, v_nome
    FROM fornecedor WHERE id = NEW.fornecedor_id;
  IF v_prometido IS NOT NULL AND NEW.janela_dias > v_prometido THEN
    RAISE EXCEPTION 'Desligamento de %: janela de % dia(s) excede os % que o DPA promete no encerramento.',
      v_nome, NEW.janela_dias, v_prometido;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER desligamento_janela_cabe_no_contrato
  BEFORE INSERT OR UPDATE ON fornecedor_desligamento
  FOR EACH ROW EXECUTE FUNCTION janela_cabe_no_contrato();

CREATE TABLE compartilhamento (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campo_id                    UUID NOT NULL REFERENCES campo(id) ON DELETE CASCADE,
  -- `destino` saiu. Sem entidade, o mesmo parceiro era uma string diferente em
  -- cada linha, e o DPA dele não tinha dono.
  fornecedor_id               UUID NOT NULL REFERENCES fornecedor(id) ON DELETE RESTRICT,
  finalidade                  TEXT NOT NULL,
  transferencia_internacional BOOLEAN NOT NULL DEFAULT false,
  pais_destino                TEXT,
  mecanismo                   mecanismo_transferencia NOT NULL DEFAULT 'nao_aplicavel',
  evidencia_uri               TEXT,              -- s3://.../openai-scc.pdf
  evidencia_hash              TEXT,

  -- Art. 33: transferência internacional exige mecanismo declarado e evidência.
  CONSTRAINT transferencia_exige_mecanismo CHECK (
    NOT transferencia_internacional
    OR (mecanismo <> 'nao_aplicavel' AND evidencia_uri IS NOT NULL AND pais_destino IS NOT NULL)
  )
);

CREATE INDEX compartilhamento_internacional_idx ON compartilhamento (transferencia_internacional)
  WHERE transferencia_internacional;

-- Linhagem: responde "com quem meus dados foram compartilhados?" (Art. 18, VII)
CREATE TABLE linhagem (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  transformacao    TEXT NOT NULL,
  versao           TEXT NOT NULL,
  origem_sistema   TEXT NOT NULL,
  origem_dataset   TEXT NOT NULL,
  origem_campo     TEXT,
  destino_sistema  TEXT NOT NULL,
  destino_dataset  TEXT NOT NULL,
  destino_campo    TEXT,
  finalidade       TEXT NOT NULL,
  base_legal       base_legal NOT NULL,
  linhas           BIGINT,
  run_id           TEXT,
  ocorrido_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX linhagem_origem_idx  ON linhagem (origem_sistema, origem_dataset, origem_campo);
CREATE INDEX linhagem_destino_idx ON linhagem (destino_sistema, destino_dataset);

-- ---------------------------------------------------------------------
-- 3. LINDDUN — artefato (2) threat-model.md                         [Tela T3]
-- ---------------------------------------------------------------------

CREATE TABLE threat_model (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sistema_id     UUID NOT NULL REFERENCES sistema(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL,
  dfd_mermaid    TEXT NOT NULL,                  -- diagrama renderizado na T3
  commit_sha     TEXT,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por UUID REFERENCES ator(id)
);

CREATE TABLE linddun_ameaca (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  threat_model_id UUID NOT NULL REFERENCES threat_model(id) ON DELETE CASCADE,
  categoria       linddun_categoria NOT NULL,
  ameaca          TEXT NOT NULL,
  mitigacao       TEXT NOT NULL,
  severidade      severidade NOT NULL,
  implementada    BOOLEAN NOT NULL DEFAULT false,
  evidencia_uri   TEXT,
  risco_id        UUID,                          -- vincula à matriz de risco (T5)
  CONSTRAINT mitigacao_nao_vazia CHECK (length(btrim(mitigacao)) > 0)
);

CREATE INDEX linddun_categoria_idx ON linddun_ameaca (threat_model_id, categoria);

-- ---------------------------------------------------------------------
-- 4. Gates de CI/CD — artefatos (3) e (4)                           [Tela T1]
-- ---------------------------------------------------------------------

CREATE TABLE gate_run (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  sistema_id      UUID REFERENCES sistema(id) ON DELETE SET NULL,
  workflow        TEXT NOT NULL CHECK (workflow IN ('privacy-ci-gate','architecture-review','privacy-dod','kms-rotation')),
  pr_numero       INT,
  pr_titulo       TEXT,
  pr_autor        TEXT,
  head_sha        TEXT NOT NULL,
  conclusao       TEXT NOT NULL CHECK (conclusao IN ('success','failure','neutral','cancelled','action_required')),
  bloqueou_merge  BOOLEAN NOT NULL DEFAULT false,
  run_url         TEXT NOT NULL,
  iniciado_em     TIMESTAMPTZ NOT NULL,
  concluido_em    TIMESTAMPTZ,
  UNIQUE (tenant_id, workflow, head_sha)
);

CREATE INDEX gate_run_recente_idx ON gate_run (tenant_id, iniciado_em DESC);

CREATE TABLE gate_finding (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_run_id     UUID NOT NULL REFERENCES gate_run(id) ON DELETE CASCADE,
  regra           TEXT NOT NULL,                 -- 'pii_em_log' | 'schema_sem_base_legal' | 'linddun_ausente'
  arquivo         TEXT,
  linha           INT,
  severidade      severidade NOT NULL,
  -- Mensagem crua do workflow e a tradução amigável exibida na T1.
  mensagem_bruta  TEXT NOT NULL,
  mensagem_humana TEXT NOT NULL,
  como_corrigir   TEXT NOT NULL,
  -- A evidência NUNCA carrega o valor encontrado, apenas o padrão que casou.
  padrao_casado   TEXT,
  CONSTRAINT finding_sem_pii CHECK (padrao_casado !~ '[0-9]{11}' AND padrao_casado !~ '@[a-z]')
);

-- ---------------------------------------------------------------------
-- 5. RIPD — artefatos (5) ripd-triage.sh e (12) parecer-tecnico.md  [Tela T3]
-- ---------------------------------------------------------------------

CREATE TABLE ripd (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  sistema_id        UUID NOT NULL REFERENCES sistema(id) ON DELETE CASCADE,
  gate_run_id       UUID REFERENCES gate_run(id) ON DELETE SET NULL,
  codigo            TEXT NOT NULL,               -- 'RIPD-2026-014'
  titulo            TEXT NOT NULL,
  pr_numero         INT,
  -- Seções do template parecer-tecnico.md
  contexto_escopo   TEXT,
  fora_de_escopo    TEXT,
  fluxo_mermaid     TEXT,
  risco_residual    TEXT,
  referencias       JSONB NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'rascunho'
                    CHECK (status IN ('rascunho','em_revisao','aprovado','reprovado','expirado')),
  bloqueia_merge    BOOLEAN NOT NULL DEFAULT true,
  documento_uri     TEXT,                        -- s3://.../RIPD-2026-014.md
  documento_hash    TEXT,
  autor_id          UUID NOT NULL REFERENCES ator(id),
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reavaliar_em      DATE,
  UNIQUE (tenant_id, codigo)
);

CREATE INDEX ripd_status_idx ON ripd (tenant_id, status);

-- Saída do ripd-triage.sh: um registro por trigger acionado.
CREATE TABLE ripd_trigger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ripd_id      UUID REFERENCES ripd(id) ON DELETE CASCADE,
  gate_run_id  UUID REFERENCES gate_run(id) ON DELETE CASCADE,
  codigo       TEXT NOT NULL CHECK (codigo ~ '^T(10|[1-9])$'),
  categoria    TEXT NOT NULL,                    -- 'dado_sensivel', 'decisao_automatizada'...
  critico      BOOLEAN NOT NULL,
  evidencias   JSONB NOT NULL DEFAULT '[]',      -- ["Regex 'llm': 2 ocorrências"]
  CONSTRAINT trigger_tem_dono CHECK (ripd_id IS NOT NULL OR gate_run_id IS NOT NULL)
);

-- Seção 2 do parecer: dados tratados, importados do catálogo por seleção múltipla.
CREATE TABLE ripd_campo (
  ripd_id    UUID NOT NULL REFERENCES ripd(id) ON DELETE CASCADE,
  campo_id   UUID NOT NULL REFERENCES campo(id) ON DELETE RESTRICT,
  observacao TEXT,
  PRIMARY KEY (ripd_id, campo_id)
);

-- Seção 4: base legal por operação.
CREATE TABLE ripd_operacao (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ripd_id     UUID NOT NULL REFERENCES ripd(id) ON DELETE CASCADE,
  operacao    TEXT NOT NULL,                     -- 'POST /api/v1/creditos/avaliar'
  finalidade  TEXT NOT NULL,
  base_legal  base_legal NOT NULL,
  lia_id      UUID,
  dado_sensivel BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT operacao_li_exige_lia CHECK (base_legal <> 'legitimo_interesse' OR lia_id IS NOT NULL)
);

-- Seção 6: recomendações P0/P1/P2.
CREATE TABLE ripd_recomendacao (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ripd_id     UUID NOT NULL REFERENCES ripd(id) ON DELETE CASCADE,
  prioridade  TEXT NOT NULL CHECK (prioridade IN ('P0','P1','P2')),
  descricao   TEXT NOT NULL,
  evidencia_esperada TEXT NOT NULL,
  dono_id     UUID REFERENCES ator(id),
  dono_handle TEXT,
  prazo       DATE NOT NULL,
  concluida   BOOLEAN NOT NULL DEFAULT false,
  concluida_em TIMESTAMPTZ
);

CREATE TABLE ripd_aprovacao (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ripd_id       UUID NOT NULL REFERENCES ripd(id) ON DELETE CASCADE,
  aprovador_id  UUID NOT NULL REFERENCES ator(id),
  decisao       TEXT NOT NULL CHECK (decisao IN ('aprovado','reprovado','aprovado_com_ressalva')),
  parecer       TEXT NOT NULL,
  assinatura    TEXT NOT NULL,                   -- hash do documento + sub do aprovador
  decidido_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 6. Matriz de riscos — artefato (11) risk-matrix.csv               [Tela T5]
-- ---------------------------------------------------------------------

CREATE TABLE risco (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  codigo         TEXT NOT NULL,                  -- 'R1'
  descricao      TEXT NOT NULL,
  probabilidade  SMALLINT NOT NULL CHECK (probabilidade BETWEEN 1 AND 5),
  impacto        SMALLINT NOT NULL CHECK (impacto BETWEEN 1 AND 5),
  score          SMALLINT GENERATED ALWAYS AS ((probabilidade * impacto)::smallint) STORED,
  dano           dano_titular NOT NULL,
  dano_descricao TEXT NOT NULL,
  tratamento     TEXT NOT NULL,
  tipo           tratamento_risco NOT NULL,
  esforco_sprints NUMERIC(3,1) NOT NULL DEFAULT 1,
  dono_handle    TEXT NOT NULL,
  dominio        TEXT NOT NULL,                  -- engenharia, jurídico, SRE...
  prazo          DATE NOT NULL,
  reavaliacao    DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'aberto'
                 CHECK (status IN ('aberto','em_tratamento','mitigado','aceito','reaberto')),
  ripd_id        UUID REFERENCES ripd(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, codigo)
);

CREATE INDEX risco_score_idx ON risco (tenant_id, score DESC);

-- Arrastar a bolha na matriz 5x5 exige justificativa — o histórico é imutável.
CREATE TABLE risco_reclassificacao (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  risco_id            UUID NOT NULL REFERENCES risco(id) ON DELETE CASCADE,
  prob_anterior       SMALLINT NOT NULL,
  impacto_anterior    SMALLINT NOT NULL,
  prob_nova           SMALLINT NOT NULL,
  impacto_novo        SMALLINT NOT NULL,
  justificativa       TEXT NOT NULL CHECK (length(btrim(justificativa)) >= 20),
  ator_id             UUID NOT NULL REFERENCES ator(id),
  ocorrido_em         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE raci (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  processo   TEXT NOT NULL,
  dominio    TEXT NOT NULL,                      -- DPO, Jurídico, Segurança, Engenharia, Produto, Dados
  letra      CHAR(1) NOT NULL CHECK (letra IN ('R','A','C','I')),
  UNIQUE (tenant_id, processo, dominio)
);

-- Exatamente um "A" (accountable) por processo.
CREATE UNIQUE INDEX raci_um_accountable_idx ON raci (tenant_id, processo) WHERE letra = 'A';

-- ---------------------------------------------------------------------
-- 7. LIA — Legitimate Interest Assessment                            [Tela T8]
-- ---------------------------------------------------------------------

CREATE TABLE lia (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  codigo            TEXT NOT NULL,               -- 'LIA-SCORING-001'
  titulo            TEXT NOT NULL,
  -- Passo 1: finalidade legítima
  finalidade        TEXT NOT NULL,
  categoria_finalidade TEXT NOT NULL CHECK (categoria_finalidade IN
                      ('melhoria_produto','seguranca','prevencao_fraude','marketing_direto','analise_credito','outro')),
  -- Passo 3: balanceamento (matriz 3x3)
  beneficio_controlador SMALLINT NOT NULL CHECK (beneficio_controlador BETWEEN 1 AND 3),
  dano_ao_titular       SMALLINT NOT NULL CHECK (dano_ao_titular BETWEEN 1 AND 3),
  expectativa_titular   TEXT NOT NULL CHECK (expectativa_titular IN ('alta','media','baixa')),
  medidas_mitigacao     TEXT NOT NULL,
  transparencia_onde    TEXT NOT NULL,           -- onde o titular vê isso no produto
  canal_oposicao        TEXT NOT NULL,           -- endpoint de oposição
  conclusao         TEXT NOT NULL CHECK (conclusao IN ('sustenta','nao_sustenta','sustenta_com_mitigacao')),
  status            TEXT NOT NULL DEFAULT 'rascunho'
                    CHECK (status IN ('rascunho','em_revisao','vigente','vencida','revogada')),
  vigencia_inicio   DATE,
  vigencia_fim      DATE,
  documento_uri     TEXT,
  documento_hash    TEXT,
  assinatura_dpo    TEXT,
  assinado_por      UUID REFERENCES ator(id),
  assinado_em       TIMESTAMPTZ,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo),
  -- Art. 11: legítimo interesse nunca sustenta dado sensível — validado também em `lia_dataset`.
  CONSTRAINT lia_vigente_exige_assinatura CHECK (status <> 'vigente' OR (assinatura_dpo IS NOT NULL AND vigencia_fim IS NOT NULL))
);

-- Passo 2: necessidade — checklist contra alternativas menos invasivas.
CREATE TABLE lia_alternativa (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lia_id        UUID NOT NULL REFERENCES lia(id) ON DELETE CASCADE,
  alternativa   TEXT NOT NULL CHECK (alternativa IN
                ('anonimizacao','pseudonimizacao','escopo_menor','retencao_menor','agregacao','consentimento')),
  situacao      TEXT NOT NULL CHECK (situacao IN ('atendido','nao_aplicavel','rejeitado')),
  justificativa TEXT NOT NULL CHECK (length(btrim(justificativa)) >= 20),
  UNIQUE (lia_id, alternativa)
);

CREATE TABLE lia_evidencia (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lia_id       UUID NOT NULL REFERENCES lia(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('print_configuracao','log_redigido','policy_retencao','contrato','outro')),
  objeto_uri   TEXT NOT NULL,
  objeto_hash  TEXT NOT NULL,
  enviado_por  UUID NOT NULL REFERENCES ator(id),
  enviado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lia_dataset (
  lia_id     UUID NOT NULL REFERENCES lia(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  PRIMARY KEY (lia_id, dataset_id)
);

ALTER TABLE campo          ADD CONSTRAINT campo_lia_fk     FOREIGN KEY (lia_id) REFERENCES lia(id) ON DELETE RESTRICT;
ALTER TABLE ripd_operacao  ADD CONSTRAINT operacao_lia_fk  FOREIGN KEY (lia_id) REFERENCES lia(id) ON DELETE RESTRICT;
ALTER TABLE linddun_ameaca ADD CONSTRAINT ameaca_risco_fk  FOREIGN KEY (risco_id) REFERENCES risco(id) ON DELETE SET NULL;

-- Legítimo interesse exige LIA vigente — verificado na escrita do campo.
CREATE OR REPLACE FUNCTION exige_lia_vigente() RETURNS TRIGGER AS $$
DECLARE v_status TEXT;
BEGIN
  IF NEW.base_legal = 'legitimo_interesse' THEN
    IF NEW.lia_id IS NULL THEN
      RAISE EXCEPTION 'Campo %: base legal legítimo interesse exige LIA vinculada (Art. 7º, IX).', NEW.nome;
    END IF;
    SELECT status INTO v_status FROM lia WHERE id = NEW.lia_id;
    IF v_status IS DISTINCT FROM 'vigente' THEN
      RAISE EXCEPTION 'Campo %: LIA % não está vigente (status=%).', NEW.nome, NEW.lia_id, v_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campo_exige_lia_vigente
  BEFORE INSERT OR UPDATE ON campo
  FOR EACH ROW EXECUTE FUNCTION exige_lia_vigente();

/*
 * O DPA recusa a **escrita** da transferência (Risco-008).
 *
 * Mesmo molde do `exige_lia_vigente()` acima, e pelo mesmo motivo: a condição
 * que sustenta o tratamento é conferida na entrada, não confiada à disciplina
 * de quem escreve.
 *
 * O que este trigger NÃO faz, e é importante que não se leia nele: ele não
 * vigia. Dispara sobre a linha que está sendo escrita e nunca sobre a que já
 * está parada — a transferência gravada hoje com contrato válido continua
 * gravada quando o contrato vencer amanhã. Quem pega o que envelhece é a
 * varredura (`varrerDpas`), que abre achado. Chamar isto de vigilância seria
 * exatamente a promessa sem instrumento que a auditoria mapeou.
 */
CREATE OR REPLACE FUNCTION exige_dpa_vigente() RETURNS TRIGGER AS $$
DECLARE f RECORD;
BEGIN
  SELECT nome, dpa_assinado, dpa_expira_em, dpa_uri, estado INTO f
    FROM fornecedor WHERE id = NEW.fornecedor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transferência para fornecedor inexistente (%).', NEW.fornecedor_id;
  END IF;

  /*
   * O estado vem **antes** do DPA, e a ordem é a ordem das perguntas.
   *
   * Um parceiro em desligamento pode ter contrato válido até o fim da janela.
   * Checar o DPA primeiro deixaria a transferência passar por um contrato que
   * segue vigente para uma relação que já foi encerrada — e a recusa, quando
   * viesse, falaria de prazo em vez de falar do desligamento.
   */
  IF f.estado <> 'ativo' THEN
    RAISE EXCEPTION 'Transferência para %: o parceiro está em "%" (Art. 39). '
      'A relação foi encerrada; o histórico continua legível, mas nada novo entra.',
      f.nome, f.estado;
  END IF;

  -- Sem assinatura não há contrato, e prazo futuro não conserta isso.
  -- Evidência anexada também não: um PDF numa pasta não é um contrato firmado.
  IF NOT f.dpa_assinado THEN
    RAISE EXCEPTION 'Transferência para %: sem DPA assinado (Art. 39)%.',
      f.nome,
      CASE WHEN f.dpa_uri IS NOT NULL
        THEN ' — há evidência anexada, mas evidência não é contrato firmado'
        ELSE '' END;
  END IF;

  -- Vence **hoje** ainda vale: o contrato cobre o último dia, não a véspera.
  IF f.dpa_expira_em < current_date THEN
    RAISE EXCEPTION 'Transferência para %: o DPA venceu em % (Art. 39).',
      f.nome, f.dpa_expira_em;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER compartilhamento_exige_dpa_vigente
  BEFORE INSERT OR UPDATE ON compartilhamento
  FOR EACH ROW EXECUTE FUNCTION exige_dpa_vigente();

-- O que o trigger não alcança: transferência viva sob contrato que venceu
-- depois de gravada. É esta view que a varredura lê para abrir achado.
CREATE VIEW gov.transferencia_sem_dpa AS
SELECT c.id AS compartilhamento_id, c.campo_id, c.finalidade,
       f.id AS fornecedor_id, f.slug, f.nome, f.dpa_assinado, f.dpa_expira_em,
       greatest(0, current_date - f.dpa_expira_em) AS atraso_dias,
       CASE
         WHEN NOT f.dpa_assinado THEN 'nao_assinado'
         WHEN f.dpa_expira_em < current_date THEN 'vencido'
         ELSE 'vigente'
       END AS estado_dpa
FROM compartilhamento c
JOIN fornecedor f ON f.id = c.fornecedor_id
WHERE NOT f.dpa_assinado OR f.dpa_expira_em < current_date;

-- ---------------------------------------------------------------------
-- 8. Direitos do titular (Art. 18)                                   [Tela T4]
-- ---------------------------------------------------------------------

CREATE TABLE solicitacao_titular (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  protocolo          TEXT NOT NULL,              -- '2026-0731'
  -- Titular identificado apenas por pseudônimo HMAC. A resolução é feita
  -- pelo serviço do produto, com finalidade declarada e step-up de autenticação.
  titular_pseudonimo TEXT NOT NULL,
  direito            direito_titular NOT NULL,
  canal              TEXT NOT NULL DEFAULT 'portal' CHECK (canal IN ('portal','email','telefone','presencial')),
  status             status_solicitacao NOT NULL DEFAULT 'recebida',
  nivel_verificacao  SMALLINT NOT NULL DEFAULT 1 CHECK (nivel_verificacao BETWEEN 1 AND 3),
  sistemas_alcancados TEXT[] NOT NULL DEFAULT '{}',
  recebida_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  prazo_dias_uteis   SMALLINT NOT NULL DEFAULT 15,
  prazo_limite       TIMESTAMPTZ NOT NULL,
  concluida_em       TIMESTAMPTZ,
  dentro_do_sla      BOOLEAN GENERATED ALWAYS AS (
                       concluida_em IS NOT NULL AND concluida_em <= prazo_limite
                     ) STORED,
  motivo_recusa      TEXT,
  responsavel_id     UUID REFERENCES ator(id),
  -- A prova de que o pedido foi atendido é obrigação legal (Art. 37): fica
  -- cinco anos depois do encerramento, e só então é eliminada. `AT TIME ZONE
  -- 'UTC'` porque o cast direto de timestamptz para date é STABLE, e coluna
  -- gerada exige IMMUTABLE.
  retencao_ate       DATE GENERATED ALWAYS AS (
                       gov.retencao_ate('obrigacao_legal:art_37_lgpd:P5Y',
                                        (concluida_em AT TIME ZONE 'UTC')::DATE)
                     ) STORED,
  UNIQUE (tenant_id, protocolo),
  CONSTRAINT recusa_exige_motivo CHECK (status <> 'recusada' OR motivo_recusa IS NOT NULL),
  -- Eliminação exige verificação elevada (biometria/step-up).
  CONSTRAINT eliminacao_exige_nivel3 CHECK (direito <> 'eliminacao' OR nivel_verificacao = 3)
);

CREATE INDEX solicitacao_sla_idx ON solicitacao_titular (tenant_id, status, prazo_limite);
CREATE INDEX solicitacao_retencao_idx ON solicitacao_titular (retencao_ate) WHERE retencao_ate IS NOT NULL;

-- O que ficou retido quando o atendimento foi parcial ou recusado.
--
-- O PR do portal passou a exigir esta lista item a item, e ela não tinha onde
-- persistir: o titular via na tela algo que o desenho de produção não guardava.
-- Cada resíduo nomeia a lei e traz a data — "parte foi retida por obrigação
-- legal" sem dizer o quê, por qual norma e até quando não é resposta.
CREATE TABLE solicitacao_retido (
  id             BIGSERIAL PRIMARY KEY,
  solicitacao_id UUID NOT NULL REFERENCES solicitacao_titular(id) ON DELETE CASCADE,
  item           TEXT NOT NULL CHECK (length(btrim(item)) > 0),
  base_legal     base_legal NOT NULL,
  artigo         TEXT,
  retencao       retencao NOT NULL,
  marco          DATE NOT NULL,
  retencao_ate   DATE GENERATED ALWAYS AS (gov.retencao_ate(retencao, marco)) STORED,
  motivo         TEXT,
  -- Reter sem data é reter para sempre. Aqui não há "indeterminado" que passe:
  -- o resíduo de um pedido de titular tem fim, e a data é dita a ele.
  CONSTRAINT retido_tem_data CHECK (retencao_ate IS NOT NULL)
);

CREATE INDEX solicitacao_retido_prazo_idx ON solicitacao_retido (retencao_ate);

CREATE TABLE solicitacao_evento (
  id              BIGSERIAL PRIMARY KEY,
  solicitacao_id  UUID NOT NULL REFERENCES solicitacao_titular(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL,                 -- 'recebida','verificada','dados_reunidos','notificado_dpo','concluida'
  detalhe         TEXT,
  ator_id         UUID REFERENCES ator(id),
  ocorrido_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comunicação titular <-> DPO dentro da plataforma (não por e-mail).
CREATE TABLE solicitacao_mensagem (
  id              BIGSERIAL PRIMARY KEY,
  solicitacao_id  UUID NOT NULL REFERENCES solicitacao_titular(id) ON DELETE CASCADE,
  remetente       TEXT NOT NULL CHECK (remetente IN ('titular','dpo')),
  ator_id         UUID REFERENCES ator(id),
  corpo           TEXT NOT NULL,
  enviada_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  lida_em         TIMESTAMPTZ,
  -- Uma mensagem nunca carrega CPF em texto claro.
  CONSTRAINT mensagem_sem_cpf CHECK (corpo !~ '[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}')
);

-- Revisão de decisão automatizada (Art. 20) — humano com poder real de reverter.
CREATE TABLE revisao_decisao (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id     UUID NOT NULL REFERENCES solicitacao_titular(id) ON DELETE CASCADE,
  decisao_externa_id TEXT NOT NULL,              -- id em decisoes_ia no produto
  modelo_versao      TEXT NOT NULL,
  decisao_original   BOOLEAN NOT NULL,
  decisao_revisada   BOOLEAN,
  justificativa      TEXT,
  shap_resumo        JSONB,                      -- top features, sem PII
  revisor_id         UUID REFERENCES ator(id),
  revisado_em        TIMESTAMPTZ,
  CONSTRAINT revisao_exige_justificativa CHECK (decisao_revisada IS NULL OR length(btrim(justificativa)) >= 20)
);

-- ---------------------------------------------------------------------
-- 9. Expurgo — artefato (8) expurgo-permanente.py                    [Tela T6]
-- ---------------------------------------------------------------------

CREATE TABLE expurgo_run (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  data_referencia DATE NOT NULL,
  origem         TEXT NOT NULL DEFAULT 'cron' CHECK (origem IN ('cron','manual','solicitacao_titular','pos_restore')),
  status         TEXT NOT NULL DEFAULT 'executando' CHECK (status IN ('executando','concluido','falhou','parcial')),
  -- `registros_total` SAIU daqui de propósito. Era um contador, e contador
  -- diverge do que foi contado no primeiro erro de incremento — exatamente o
  -- número que uma auditoria de expurgo confere primeiro. O total agora é
  -- derivado em gov.expurgo_run_resumo, somando os lotes.
  iniciado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluido_em   TIMESTAMPTZ,
  executado_por  TEXT NOT NULL DEFAULT 'airflow-svc-account',
  relatorio_uri  TEXT,
  relatorio_hash TEXT,
  UNIQUE (tenant_id, data_referencia, origem)
);

CREATE TABLE expurgo_entrada (
  id             BIGSERIAL PRIMARY KEY,
  expurgo_run_id UUID NOT NULL REFERENCES expurgo_run(id) ON DELETE CASCADE,
  sistema_slug   TEXT NOT NULL,
  tabela         TEXT NOT NULL,
  campo_tipo     TEXT,                           -- categoria do dado eliminado
  metodo         TEXT NOT NULL CHECK (metodo IN ('hard_delete','crypto_shredding','anonimizacao','compactacao_log')),
  registros      BIGINT NOT NULL CHECK (registros >= 0),
  -- Identificadores afetados nunca em claro: hash com sal por execução.
  campo_id       UUID REFERENCES campo(id) ON DELETE SET NULL,
  -- A chave de idempotência. Deriva de coisas imutáveis — tabela, campo, data
  -- de referência e índice do lote —, nunca do estado. Se derivasse da contagem
  -- restante, reexecutar depois de eliminar mudaria a chave e o segundo passe
  -- reinseriria tudo: o defeito que a idempotência existe para impedir.
  lote_chave     TEXT NOT NULL,
  ids_afetados_hash TEXT NOT NULL,
  hash_pre       TEXT NOT NULL,
  hash_pos       TEXT NOT NULL,
  verificado_em  TIMESTAMPTZ,
  verificado_por UUID REFERENCES ator(id),
  integro        BOOLEAN,
  CONSTRAINT hashes_distintos CHECK (hash_pre <> hash_pos OR registros = 0)
);

CREATE UNIQUE INDEX expurgo_entrada_lote_uk ON expurgo_entrada (lote_chave);
CREATE INDEX expurgo_entrada_run_idx ON expurgo_entrada (expurgo_run_id, tabela);

-- O total, somado — nunca incrementado.
CREATE VIEW gov.expurgo_run_resumo AS
SELECT r.id, r.tenant_id, r.data_referencia, r.origem, r.status, r.iniciado_em, r.concluido_em,
       r.executado_por, r.relatorio_uri, r.relatorio_hash,
       coalesce(sum(e.registros), 0)::BIGINT AS registros_total,
       count(e.id)::BIGINT                   AS lotes,
       bool_and(coalesce(e.integro, true))   AS integro
FROM expurgo_run r
LEFT JOIN expurgo_entrada e ON e.expurgo_run_id = r.id
GROUP BY r.id;

-- ---------------------------------------------------------------------
-- 8b. Consentimento como entidade                          [Portal, telas 08-10]
--
-- Não havia tabela: consentimento era valor de enum e um contador
-- (`titulares: number`) na camada de demonstração. Assim não se responde às
-- duas perguntas que o Art. 8º faz — *esta pessoa consentiu?* e *com qual
-- texto?* — nem se executa a revogação individual do Art. 18, VIII, porque
-- revogar mudava o registro do campo inteiro.
--
-- São três fatos com donos distintos, e por isso três tabelas. A terceira é a
-- que custa: revogar **cria fato novo** e nunca edita o aceite. Se apagasse, a
-- organização perderia justamente a prova de que houve consentimento enquanto
-- houve tratamento — que é o que o Art. 8º, §2º cobra, inclusive depois.
-- ---------------------------------------------------------------------

CREATE TABLE consentimento_texto (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  campo_id       UUID NOT NULL REFERENCES campo(id) ON DELETE CASCADE,
  versao         TEXT NOT NULL,
  texto          TEXT NOT NULL CHECK (length(btrim(texto)) > 0),
  texto_hash     TEXT NOT NULL,
  -- Quanto o aceite vale, no mesmo domínio do ciclo de vida. `indeterminado` é
  -- legítimo aqui — há consentimento sem prazo —, e exige a mesma justificativa
  -- que o ROPA exige: prazo sem fim por omissão é o que faz um aceite de 2019
  -- sustentar um tratamento de hoje.
  validade       retencao NOT NULL,
  validade_fonte TEXT,
  publicado_em   DATE NOT NULL DEFAULT current_date,
  UNIQUE (campo_id, versao),
  CONSTRAINT texto_indeterminado_exige_fonte CHECK (
    validade <> 'indeterminado' OR validade_fonte IS NOT NULL
  )
);

-- Vigente é **derivado**, não um campo que alguém desliga: é a última versão
-- publicada do campo. Coluna `vigente` exigiria UPDATE numa tabela que não pode
-- ser editada, e a saída seria abrir a exceção justamente onde ela não cabe.
CREATE VIEW gov.consentimento_texto_vigente AS
SELECT DISTINCT ON (campo_id) *
FROM consentimento_texto
ORDER BY campo_id, publicado_em DESC, versao DESC;

CREATE TABLE consentimento (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  -- O titular do produto, pseudonimizado — a plataforma não hospeda o cadastro.
  titular_pseudonimo TEXT NOT NULL,
  texto_id           UUID NOT NULL REFERENCES consentimento_texto(id) ON DELETE RESTRICT,
  canal              TEXT NOT NULL CHECK (canal IN ('app','web','checkout','presencial','telefone')),
  coletado_em        DATE NOT NULL,
  prova_hash         TEXT NOT NULL,
  /*
   * `validade` é copiada do texto no instante do aceite, de propósito.
   *
   * Denormalização deliberada, e não descuido: publicar uma versão nova do
   * texto com prazo maior **não pode** estender em silêncio os aceites já
   * dados. O que vale é o prazo que estava em vigor quando a pessoa disse sim —
   * e congelá-lo aqui é o que permite `expira_em` ser coluna gerada.
   */
  validade           retencao NOT NULL,
  expira_em          DATE GENERATED ALWAYS AS (gov.retencao_ate(validade, coletado_em)) STORED,
  UNIQUE (tenant_id, titular_pseudonimo, texto_id)
);

CREATE INDEX consentimento_texto_idx   ON consentimento (texto_id);
CREATE INDEX consentimento_expira_idx  ON consentimento (expira_em) WHERE expira_em IS NOT NULL;

-- O aceite copia o prazo que estava valendo. Divergir dele é erro de escrita,
-- não uma escolha do chamador.
CREATE OR REPLACE FUNCTION consentimento_congela_validade() RETURNS TRIGGER AS $$
DECLARE v_validade TEXT;
BEGIN
  SELECT validade INTO v_validade FROM consentimento_texto WHERE id = NEW.texto_id;
  IF NEW.validade IS DISTINCT FROM v_validade THEN
    RAISE EXCEPTION 'consentimento: a validade (%) precisa ser a do texto aceito (%).',
      NEW.validade, v_validade;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consentimento_valida_prazo
  BEFORE INSERT ON consentimento
  FOR EACH ROW EXECUTE FUNCTION consentimento_congela_validade();

-- Revogar cria fato novo. O UNIQUE é o que impede revogar duas vezes; o
-- ON DELETE RESTRICT é o que impede o aceite sumir por baixo da revogação.
CREATE TABLE consentimento_revogacao (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consentimento_id UUID NOT NULL UNIQUE REFERENCES consentimento(id) ON DELETE RESTRICT,
  revogado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  canal            TEXT NOT NULL,
  motivo           TEXT,
  /*
   * O expurgo do que já foi coletado nasce daqui, com a data derivada do marco
   * de revogação — o `fato_gerador` que o ciclo de vida declarou e que até
   * agora não tinha quem o usasse. Trinta dias de carência: o tempo de propagar
   * a cascata antes de eliminar, senão a prova de execução chega depois de o
   * dado sumir.
   */
  retencao         retencao NOT NULL DEFAULT 'consentimento_revogado',
  retencao_ate     DATE GENERATED ALWAYS AS (
                     gov.retencao_ate(retencao, (revogado_em AT TIME ZONE 'UTC')::DATE)
                   ) STORED,
  CONSTRAINT revogacao_tem_prazo_de_expurgo CHECK (retencao_ate IS NOT NULL)
);

CREATE INDEX revogacao_expurgo_idx ON consentimento_revogacao (retencao_ate);

-- A cascata, persistida. No estágio atual nascem duas frentes: a cessação onde
-- o dado mora e o expurgo do que já foi coletado. A notificação de quem
-- recebeu ganha alvo de verdade quando fornecedor virar entidade — hoje ela
-- aponta para um nome em texto livre, e um nome não tem DPA nem SLA.
CREATE TABLE revogacao_propagacao (
  id             BIGSERIAL PRIMARY KEY,
  revogacao_id   UUID NOT NULL REFERENCES consentimento_revogacao(id) ON DELETE CASCADE,
  alvo           TEXT NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('cessacao','notificacao','expurgo')),
  efeito         TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('propagado','pendente')),
  iniciada_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmada_em  TIMESTAMPTZ,
  UNIQUE (revogacao_id, alvo, tipo),
  CONSTRAINT propagado_tem_confirmacao CHECK (estado <> 'propagado' OR confirmada_em IS NOT NULL)
);

CREATE INDEX propagacao_pendente_idx ON revogacao_propagacao (iniciada_em)
  WHERE estado = 'pendente';

-- O estado vigente de cada aceite, derivado. Revogado precede expirado: o ato
-- do titular não some porque o relógio também correu.
CREATE VIEW gov.consentimento_estado AS
SELECT c.id, c.tenant_id, c.titular_pseudonimo, c.canal, c.coletado_em, c.expira_em,
       t.campo_id, t.versao, t.texto, t.texto_hash,
       r.id AS revogacao_id, r.revogado_em, r.retencao_ate AS expurgo_ate,
       CASE
         WHEN r.id IS NOT NULL THEN 'revogado'
         WHEN c.expira_em IS NOT NULL AND c.expira_em < current_date THEN 'expirado'
         ELSE 'ativo'
       END AS estado
FROM consentimento c
JOIN consentimento_texto t ON t.id = c.texto_id
LEFT JOIN consentimento_revogacao r ON r.consentimento_id = c.id;

-- ---------------------------------------------------------------------
-- 9b. Achado de auditoria                                           [Tela T11]
--
-- O achado existia na interface e na máquina de estados do protótipo, e em
-- nenhuma das 38 tabelas: o ciclo que a T11 opera não tinha onde persistir. Sem
-- esta tabela, o achado que o motor de retenção abre sozinho morreria com o
-- processo — e um prazo vencido voltaria a ser pendência silenciosa.
-- ---------------------------------------------------------------------

CREATE TYPE estado_achado AS ENUM (
  'aberto', 'causa_raiz', 'plano', 'executado', 'verificado', 'encerrado', 'reaberto'
);

CREATE TABLE achado (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  -- Determinístico para as origens automáticas (RET-<tabela>-<campo>): uma
  -- varredura por dia sobre o mesmo campo vencido não pode abrir um achado por
  -- dia. O UNIQUE é o que transforma a segunda varredura em atualização.
  codigo            TEXT NOT NULL,
  descricao         TEXT NOT NULL,
  origem            TEXT NOT NULL,               -- 'auditoria_externa' | 'motor_de_retencao'
  estado            estado_achado NOT NULL DEFAULT 'aberto',
  criticidade       severidade NOT NULL,
  reincidencias     SMALLINT NOT NULL DEFAULT 0 CHECK (reincidencias >= 0),
  causa_raiz        TEXT,
  plano             TEXT,
  criterio_eficacia TEXT,
  executado_por     UUID REFERENCES ator(id),
  verificado_por    UUID REFERENCES ator(id),
  eficacia_atingida BOOLEAN,
  motivo_reabertura TEXT,
  -- O que o motor de retenção aponta, quando é ele que abre.
  campo_id          UUID REFERENCES campo(id) ON DELETE CASCADE,
  atraso_dias       INT CHECK (atraso_dias IS NULL OR atraso_dias >= 0),
  registros         BIGINT CHECK (registros IS NULL OR registros >= 0),
  aberto_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo),
  -- Quem executou não verifica: a independência da verificação é a razão de o
  -- estado `verificado` existir separado de `executado`.
  CONSTRAINT achado_verificacao_independente CHECK (
    verificado_por IS NULL OR executado_por IS NULL OR verificado_por <> executado_por
  ),
  -- Encerrar exige que a verificação tenha concluído que resolveu.
  CONSTRAINT achado_encerra_com_eficacia CHECK (
    estado <> 'encerrado' OR eficacia_atingida IS TRUE
  ),
  -- Reabrir exige motivo: a reabertura eleva criticidade e conta reincidência.
  CONSTRAINT achado_reabertura_exige_motivo CHECK (
    estado <> 'reaberto' OR length(btrim(motivo_reabertura)) >= 20
  ),
  -- Achado do motor aponta para o campo vencido; sem isso ninguém sabe o que tratar.
  CONSTRAINT achado_do_motor_aponta_campo CHECK (
    origem <> 'motor_de_retencao' OR (campo_id IS NOT NULL AND atraso_dias IS NOT NULL)
  )
);

CREATE INDEX achado_estado_idx ON achado (tenant_id, estado);
CREATE INDEX achado_campo_idx  ON achado (campo_id) WHERE campo_id IS NOT NULL;

-- Cadeia de custódia da evidência, append-only.
CREATE TABLE achado_evidencia (
  id          BIGSERIAL PRIMARY KEY,
  achado_id   UUID NOT NULL REFERENCES achado(id) ON DELETE CASCADE,
  arquivo     TEXT NOT NULL,
  etapa       estado_achado NOT NULL,
  por         UUID REFERENCES ator(id),
  hash        TEXT NOT NULL,
  hash_anterior TEXT,
  anexada_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX achado_evidencia_idx ON achado_evidencia (achado_id, id);
-- ---------------------------------------------------------------------
-- Incidente de segurança (Art. 48) — Risco-015
--
-- O fluxo existia na T9, nas rotas do contrato e no `incidente.bpmn`, e em
-- nenhuma tabela. A ficha do Risco-015 nomeia as duas metades — "sem tabela no
-- schema e sem rota no contrato" —, e a segunda fechou em `f86020e`, quando as
-- seis operações entraram no `openapi.yaml`. Esta é a primeira.
--
-- Sem ela, o incidente que a T9 abre morre com o processo, e o prazo do Art. 48
-- não tem de onde ser contado: um prazo que só existe em memória é um prazo que
-- ninguém consegue provar ter cumprido.
--
-- ── Duas tabelas, e a razão de serem duas ──────────────────────────────────
--
-- `incidente` é **estado**: o `estado` avança pela máquina, e a decisão chega
-- depois da contenção. Congelá-la pararia o fluxo no primeiro passo — critério
-- do Risco-024, e por isso ela entra em `MUTAVEL_COM_MOTIVO`.
--
-- `incidente_evento` é **fato**: cada passagem de estado, com ator e instante.
-- É o que prova que a comunicação saiu dentro do prazo, e por isso é append-only,
-- no mesmo molde de `solicitacao_evento`.
-- ---------------------------------------------------------------------

CREATE TYPE estado_incidente AS ENUM (
  'aberto', 'contido', 'decidido', 'comunicado', 'nao_comunicado', 'encerrado'
);

CREATE TYPE decisao_incidente AS ENUM (
  'comunicar_anpd_e_titulares', 'comunicar_anpd', 'nao_comunicar'
);

CREATE TABLE incidente (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  codigo              TEXT NOT NULL,
  estado              estado_incidente NOT NULL DEFAULT 'aberto',
  detectado_em        TIMESTAMPTZ NOT NULL,
  origem              TEXT NOT NULL CHECK (length(btrim(origem)) > 0),
  titulares_estimados BIGINT NOT NULL CHECK (titulares_estimados >= 0),
  risco_id            UUID REFERENCES risco(id) ON DELETE SET NULL,
  ripd_id             UUID REFERENCES ripd(id) ON DELETE SET NULL,
  decisao             decisao_incidente,
  -- Já redigido (C-04) e com corpo: "vazamento" não é fundamento de decisão
  -- sobre comunicar ou não comunicar à autoridade.
  fundamento          TEXT,
  contido_por         UUID REFERENCES ator(id),
  decidido_por        UUID REFERENCES ator(id),
  comunicado_em       TIMESTAMPTZ,
  encerrado_em        TIMESTAMPTZ,

  -- O prazo é **derivado da detecção**, nunca digitado ao lado dela. Mesma regra
  -- de `retencao_ate` e de `janela_ate`: data que alguém digita é data que
  -- diverge do fato no primeiro erro de digitação — e aqui o fato é o marco legal.
  --
  -- `AT TIME ZONE 'UTC'` não é enfeite: `timestamptz + interval` depende do
  -- `TimeZone` da sessão e o Postgres recusa a coluna gerada por não ser
  -- imutável. Convertido para hora de parede em UTC, o cálculo passa a ser o
  -- mesmo em qualquer sessão — que é o que uma prova de prazo precisa ser.
  --
  -- O intervalo é o **parâmetro declarado** deste repositório para o "prazo
  -- razoável" do Art. 48, e mora aqui num lugar só: a regulamentação da ANPD é
  -- quem o fixa, e mudá-la é mudar esta linha. Nenhum outro artefato o redigita.
  comunicar_ate       TIMESTAMP GENERATED ALWAYS AS
                        ((detectado_em AT TIME ZONE 'UTC') + INTERVAL '3 days') STORED,

  UNIQUE (tenant_id, codigo),

  -- Decidir exige a decisão e o porquê dela. Estado que avança sem o conteúdo
  -- que o justifica é a assinatura sem documento do Risco-024.
  --
  -- `coalesce` e `IS NOT DISTINCT FROM` não são estilo: em SQL, um CHECK que
  -- avalia para NULL **passa**. `length(btrim(NULL)) >= 20` é NULL, e a primeira
  -- versão destes três deixava entrar exatamente o caso que eles existem para
  -- barrar — decidir com `fundamento` nulo. Apareceu quando a injeção que
  -- removia este CHECK não reprovou: outro CHECK barrava antes, e escondia que
  -- este nunca barrava nada.
  CONSTRAINT incidente_decide_com_fundamento CHECK (
    estado IN ('aberto','contido')
    OR (decisao IS NOT NULL AND length(btrim(coalesce(fundamento, ''))) >= 20)
  ),
  -- Não comunicar é uma decisão, e só ela leva a "nao_comunicado". O caminho
  -- inverso — comunicar e registrar como não comunicado — apagaria a
  -- comunicação que de fato saiu.
  CONSTRAINT incidente_nao_comunicado_veio_da_decisao CHECK (
    estado <> 'nao_comunicado' OR decisao IS NOT DISTINCT FROM 'nao_comunicar'::decisao_incidente
  ),
  CONSTRAINT incidente_comunicado_veio_da_decisao CHECK (
    estado <> 'comunicado'
    OR (decisao IS NOT NULL
        AND decisao IN ('comunicar_anpd','comunicar_anpd_e_titulares')
        AND comunicado_em IS NOT NULL)
  ),
  CONSTRAINT incidente_encerra_com_data CHECK (
    estado <> 'encerrado' OR encerrado_em IS NOT NULL
  ),
  CONSTRAINT incidente_contido_tem_quem CHECK (
    estado = 'aberto' OR contido_por IS NOT NULL
  )
);

CREATE INDEX incidente_prazo_idx ON incidente (comunicar_ate)
  WHERE estado IN ('aberto', 'contido', 'decidido');

-- O escopo vem do catálogo, e não de texto digitado: quem responde ao Art. 48
-- precisa dizer qual dado vazou, e a resposta tem de sair do inventário — senão
-- o incidente descreve um universo que o ROPA desconhece.
CREATE TABLE incidente_campo (
  incidente_id UUID NOT NULL REFERENCES incidente(id) ON DELETE CASCADE,
  campo_id     UUID NOT NULL REFERENCES campo(id) ON DELETE RESTRICT,
  PRIMARY KEY (incidente_id, campo_id)
);

-- A trilha do incidente. Append-only: é ela que prova o cumprimento do prazo, e
-- prova que se reescreve não prova nada.
CREATE TABLE incidente_evento (
  id           BIGSERIAL PRIMARY KEY,
  incidente_id UUID NOT NULL REFERENCES incidente(id) ON DELETE CASCADE,
  de           estado_incidente,
  para         estado_incidente NOT NULL,
  ator_id      UUID REFERENCES ator(id),
  detalhe      TEXT,
  ocorrido_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);



-- ---------------------------------------------------------------------
-- 10. KMS — artefato (9) kms-rotation.yml                            [Tela T7]
-- ---------------------------------------------------------------------

CREATE TABLE kms_chave (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  alias           TEXT NOT NULL,                 -- 'alias/credit-pii-v3'
  arn             TEXT NOT NULL,
  finalidade      TEXT NOT NULL,                 -- EncryptionContext.purpose
  status          status_chave NOT NULL DEFAULT 'pendente',
  criada_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotacao_prevista DATE NOT NULL,
  revogada_em     TIMESTAMPTZ,
  suporta_cripto_shredding BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (tenant_id, alias)
);

-- Uma única chave ativa por finalidade.
CREATE UNIQUE INDEX kms_uma_ativa_por_finalidade ON kms_chave (tenant_id, finalidade) WHERE status = 'ativa';

CREATE TABLE kms_dependencia (
  chave_id   UUID NOT NULL REFERENCES kms_chave(id) ON DELETE CASCADE,
  sistema_id UUID NOT NULL REFERENCES sistema(id) ON DELETE CASCADE,
  dataset_id UUID REFERENCES dataset(id) ON DELETE CASCADE,
  PRIMARY KEY (chave_id, sistema_id, dataset_id)
);

CREATE TABLE kms_rotacao (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chave_nova_id UUID NOT NULL REFERENCES kms_chave(id) ON DELETE CASCADE,
  chave_antiga_id UUID REFERENCES kms_chave(id) ON DELETE SET NULL,
  workflow_run_url TEXT,
  status        TEXT NOT NULL DEFAULT 'em_andamento'
                CHECK (status IN ('em_andamento','concluida','revertida','falhou')),
  iniciada_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluida_em  TIMESTAMPTZ
);

CREATE TABLE kms_rotacao_etapa (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rotacao_id  UUID NOT NULL REFERENCES kms_rotacao(id) ON DELETE CASCADE,
  etapa       TEXT NOT NULL CHECK (etapa IN ('gerar','parameter_store','canary_5','recriptografar','revogar_antiga')),
  ordem       SMALLINT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','executando','concluida','falhou')),
  progresso   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progresso BETWEEN 0 AND 100),
  detalhe     TEXT,
  iniciada_em TIMESTAMPTZ,
  concluida_em TIMESTAMPTZ,
  UNIQUE (rotacao_id, etapa)
);

-- Espelho do CloudTrail: quem usou qual chave, para quê.
CREATE TABLE kms_acesso (
  id           BIGSERIAL PRIMARY KEY,
  chave_id     UUID NOT NULL REFERENCES kms_chave(id) ON DELETE CASCADE,
  principal    TEXT NOT NULL,
  operacao     TEXT NOT NULL CHECK (operacao IN ('Encrypt','Decrypt','GenerateDataKey','ScheduleKeyDeletion','DescribeKey')),
  finalidade   TEXT,
  origem_ip    INET,
  autorizado   BOOLEAN NOT NULL,
  ocorrido_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX kms_acesso_nao_autorizado_idx ON kms_acesso (chave_id, ocorrido_em DESC) WHERE NOT autorizado;

-- ---------------------------------------------------------------------
-- 11. Métricas — artefato (10) metrics-collector.py                  [Tela T1]
-- ---------------------------------------------------------------------

CREATE TABLE metric_snapshot (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  metrica      TEXT NOT NULL,                    -- 'ropa_cobertura', 'sla_titular_horas'...
  valor        NUMERIC(12,4) NOT NULL,
  unidade      TEXT NOT NULL CHECK (unidade IN ('percentual','horas','dias','contagem','score')),
  meta         NUMERIC(12,4),
  -- Quebras agregadas; supressão k-anonimato aplicada na origem (k >= 5).
  dimensoes    JSONB NOT NULL DEFAULT '{}',
  coletado_em  TIMESTAMPTZ NOT NULL,
  fonte        TEXT NOT NULL DEFAULT 'metrics-collector.py',
  UNIQUE (tenant_id, metrica, coletado_em)
);

CREATE INDEX metric_serie_idx ON metric_snapshot (tenant_id, metrica, coletado_em DESC);

-- Scorecard de maturidade (NIST Privacy Framework).
CREATE TABLE maturidade (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  dominio     TEXT NOT NULL CHECK (dominio IN ('governar','identificar','controlar','comunicar','proteger')),
  score       NUMERIC(2,1) NOT NULL CHECK (score BETWEEN 1 AND 5),
  score_anterior NUMERIC(2,1),
  evidencias  JSONB NOT NULL DEFAULT '[]',
  avaliado_em DATE NOT NULL,
  UNIQUE (tenant_id, dominio, avaliado_em)
);

-- ---------------------------------------------------------------------
-- 12. Audit trail append-only com hash encadeado                     [Tela T6]
-- ---------------------------------------------------------------------

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  ocorrido_em   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ator_id       UUID REFERENCES ator(id),
  ator_tipo     papel_ator NOT NULL,
  acao          TEXT NOT NULL,                   -- 'CAMPO_REVELADO', 'RIPD_APROVADO', 'EXPURGO_EXECUTADO'
  recurso_tipo  TEXT NOT NULL,
  recurso_id    TEXT,
  -- Art. 37: finalidade e base legal são obrigatórias em acesso a dado pessoal.
  finalidade    TEXT,
  base_legal    base_legal,
  campos        TEXT[] NOT NULL DEFAULT '{}',    -- campos efetivamente retornados
  justificativa TEXT,
  -- O hash da justificativa ENTRA na cadeia; o texto, não.
  --
  -- É a fronteira entre dois riscos que se atropelariam: a cadeia precisa
  -- cobrir a justificativa (senão o campo mais exposto do trail é adulterável
  -- sem detecção), e o trail precisa poder expurgar a justificativa (que é dado
  -- pessoal do operador, sem prazo até aqui). Selar o hash resolve os dois:
  -- adulterar o texto continua detectável, e apagá-lo preserva a cadeia.
  justificativa_hash TEXT,
  ip            INET,
  user_agent    TEXT,
  resultado     TEXT NOT NULL DEFAULT 'sucesso' CHECK (resultado IN ('sucesso','negado','erro')),
  -- A linha fica cinco anos (prova do Art. 37); a PII do operador sai em trinta
  -- dias. Duas datas porque são duas obrigações diferentes sobre a mesma linha.
  retencao_ate     DATE GENERATED ALWAYS AS (
                     gov.retencao_ate('obrigacao_legal:art_37_lgpd:P5Y',
                                      (ocorrido_em AT TIME ZONE 'UTC')::DATE)
                   ) STORED,
  pii_expurgo_ate  DATE GENERATED ALWAYS AS (
                     gov.retencao_ate('P30D', (ocorrido_em AT TIME ZONE 'UTC')::DATE)
                   ) STORED,
  pii_expurgada_em TIMESTAMPTZ,
  hash_anterior TEXT,
  hash          TEXT NOT NULL,
  -- Art. 37: acesso a dado pessoal exige finalidade e justificativa **no momento
  -- do acesso**. Depois do prazo, o texto da justificativa é eliminado — ele é
  -- dado pessoal do operador — e o que prova que ele existiu é o selo.
  --
  -- A segunda alternativa não afrouxa nada: `pii_expurgada_em` só pode ser
  -- preenchido pelo caminho controlado do trigger, que por sua vez exige que
  -- todo o resto da linha (inclusive `justificativa_hash`) fique idêntico. Não
  -- há INSERT que alcance esse ramo — só o expurgo alcança.
  CONSTRAINT acesso_pii_exige_finalidade CHECK (
    acao NOT IN ('CAMPO_REVELADO','TITULAR_CONSULTADO','PSEUDONIMO_RESOLVIDO')
    OR (finalidade IS NOT NULL
        AND (justificativa IS NOT NULL
             OR (pii_expurgada_em IS NOT NULL AND justificativa_hash IS NOT NULL)))
  )
);

CREATE INDEX audit_log_recurso_idx ON audit_log (tenant_id, recurso_tipo, recurso_id);
CREATE INDEX audit_log_tempo_idx   ON audit_log (tenant_id, ocorrido_em DESC);
CREATE INDEX audit_log_ator_idx    ON audit_log (ator_id, ocorrido_em DESC);
-- Parcial: só interessa a linha que ainda tem PII para expurgar.
CREATE INDEX audit_log_pii_idx     ON audit_log (pii_expurgo_ate)
  WHERE pii_expurgada_em IS NULL AND (ip IS NOT NULL OR user_agent IS NOT NULL OR justificativa IS NOT NULL);

-- Encadeamento tipo Merkle: cada linha sela a anterior.
CREATE OR REPLACE FUNCTION audit_log_encadeia() RETURNS TRIGGER AS $$
DECLARE
  v_prev TEXT;
  v_payload TEXT;
BEGIN
  SELECT hash INTO v_prev FROM audit_log WHERE tenant_id = NEW.tenant_id ORDER BY id DESC LIMIT 1;

  -- Selado ANTES do payload: é este valor que entra na cadeia, e ele sobrevive
  -- ao expurgo do texto.
  NEW.justificativa_hash := encode(sha256(coalesce(NEW.justificativa, '')::bytea), 'hex');

  v_payload := coalesce(v_prev, 'genesis:' || NEW.tenant_id::text)
            || '|' || NEW.ocorrido_em::text
            || '|' || coalesce(NEW.ator_id::text, '-')
            || '|' || NEW.acao
            || '|' || NEW.recurso_tipo
            || '|' || coalesce(NEW.recurso_id, '-')
            || '|' || coalesce(NEW.finalidade, '-')
            -- A base legal entra na cadeia (Risco-004). Ela estava gravada e não
            -- selada: um DBA comprometido trocava `consentimento` por
            -- `legitimo_interesse` na linha que registrou o acesso, e a
            -- verificação de integridade continuava fechando. O campo que
            -- justifica o tratamento era, até aqui, o único do trail que se
            -- podia reescrever sem deixar rastro.
            || '|' || coalesce(NEW.base_legal::text, '-')
            || '|' || array_to_string(NEW.campos, ',')
            || '|' || NEW.resultado
            || '|' || NEW.justificativa_hash;

  NEW.hash_anterior := v_prev;
  NEW.hash := encode(sha256(v_payload::bytea), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_hash_trg
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_encadeia();

-- Append-only de verdade: UPDATE e DELETE são rejeitados no banco.
CREATE OR REPLACE FUNCTION bloqueia_mutacao() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Tabela % é append-only: % não é permitido.', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- O trail é append-only, com UMA exceção nomeada: o expurgo da PII do operador.
--
-- Sem exceção alguma, `ip`, `user_agent` e `justificativa` ficariam para sempre
-- — dado pessoal de colaborador sem prazo, que é o que a auditoria apontou. Com
-- exceção larga (um `GRANT UPDATE` e boa-fé), o append-only vira convenção. A
-- saída é uma exceção que o próprio banco delimita: qualquer UPDATE que mexa em
-- outra coisa, ou que não zere as três, é recusado aqui.
CREATE OR REPLACE FUNCTION audit_log_expurgo_de_pii() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tabela audit_log é append-only: DELETE não é permitido.';
  END IF;
  IF NEW.ip IS NOT NULL OR NEW.user_agent IS NOT NULL OR NEW.justificativa IS NOT NULL THEN
    RAISE EXCEPTION 'audit_log: a única atualização permitida zera ip, user_agent e justificativa.';
  END IF;
  IF NEW.pii_expurgada_em IS NULL THEN
    RAISE EXCEPTION 'audit_log: o expurgo de PII precisa carimbar pii_expurgada_em.';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.ocorrido_em, NEW.ator_id, NEW.ator_tipo, NEW.acao,
      NEW.recurso_tipo, NEW.recurso_id, NEW.finalidade, NEW.base_legal, NEW.campos,
      NEW.resultado, NEW.justificativa_hash, NEW.hash_anterior, NEW.hash)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.ocorrido_em, OLD.ator_id, OLD.ator_tipo, OLD.acao,
      OLD.recurso_tipo, OLD.recurso_id, OLD.finalidade, OLD.base_legal, OLD.campos,
      OLD.resultado, OLD.justificativa_hash, OLD.hash_anterior, OLD.hash) THEN
    RAISE EXCEPTION 'audit_log: o expurgo de PII não altera nenhum outro campo.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_imutavel
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_expurgo_de_pii();

-- O expurgo em si, por lote e idempotente: a linha já expurgada não volta.
CREATE OR REPLACE FUNCTION gov.expurgar_pii_do_trail(p_tenant UUID, p_hoje DATE, p_limite INT DEFAULT 5000)
RETURNS BIGINT AS $$
DECLARE
  v_afetadas BIGINT;
BEGIN
  WITH alvo AS (
    SELECT id FROM audit_log
     WHERE tenant_id = p_tenant
       AND pii_expurgada_em IS NULL
       AND pii_expurgo_ate <= p_hoje
       AND (ip IS NOT NULL OR user_agent IS NOT NULL OR justificativa IS NOT NULL)
     ORDER BY pii_expurgo_ate, id      -- keyset pelo índice parcial, nunca OFFSET
     LIMIT p_limite
  )
  UPDATE audit_log a
     SET ip = NULL, user_agent = NULL, justificativa = NULL, pii_expurgada_em = now()
    FROM alvo WHERE a.id = alvo.id;
  GET DIAGNOSTICS v_afetadas = ROW_COUNT;
  RETURN v_afetadas;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER risco_reclassificacao_imutavel
  BEFORE UPDATE OR DELETE ON risco_reclassificacao
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

CREATE TRIGGER linhagem_imutavel
  BEFORE UPDATE OR DELETE ON linhagem
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

-- Append-only nos dois fatos que provam: o aceite e o texto aceito. Ficam aqui,
-- e não junto das tabelas, porque `bloqueia_mutacao()` só existe a partir desta
-- seção — e um schema que só aplica na ordem certa é um schema que aplica.
CREATE TRIGGER consentimento_imutavel
  BEFORE UPDATE OR DELETE ON consentimento
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

CREATE TRIGGER consentimento_texto_imutavel
  BEFORE UPDATE OR DELETE ON consentimento_texto
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

-- ── Risco-024 — o append-only chega onde a prova mora ───────────────────────
--
-- Até aqui, cinco tabelas eram append-only e todas mereciam: o trail, a
-- reclassificação de risco, a linhagem, o aceite do consentimento e o texto
-- aceito. O que faltava não era corrigir essas — era o resto da prova acumulada
-- pela série, que ficou sem barreira nenhuma enquanto o `GRANT UPDATE` amplo
-- seguia valendo. Onde não há trigger, não há nada.
--
-- O critério é um só, e ele **exclui** tanto quanto inclui: append-only é para
-- **fato que sustenta prova**, não para estado operacional. Proteger o mutável
-- travaria o produto sem ganhar garantia — e a lista do que ficou de fora, com o
-- motivo, está logo abaixo destes oito.

-- Quem tocou a chave, quando e se foi autorizado (Art. 46). Um log de acesso
-- editável responde à pergunta da auditoria com o que o editor quis que ela ouvisse.
CREATE TRIGGER kms_acesso_imutavel
  BEFORE UPDATE OR DELETE ON kms_acesso
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

-- A trilha do pedido do titular: recebida, verificada, concluída. É a prova de
-- que o prazo do Art. 18 §1º foi cumprido, e prazo se prova pela data do evento.
CREATE TRIGGER solicitacao_evento_imutavel
  BEFORE UPDATE OR DELETE ON solicitacao_evento
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

-- O marco da revogação — e `retencao_ate` é GENERATED a partir dele. Mover
-- `revogado_em` moveria em silêncio o prazo de expurgo que nasce da revogação.
CREATE TRIGGER consentimento_revogacao_imutavel
  BEFORE UPDATE OR DELETE ON consentimento_revogacao
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

-- Evidência com `hash` e `hash_anterior`: é uma cadeia. Cadeia mutável é o
-- Risco-004 noutra tabela — o selo continua batendo com o texto que o editor deixou.
CREATE TRIGGER achado_evidencia_imutavel
  BEFORE UPDATE OR DELETE ON achado_evidencia
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

-- A evidência que sustenta o balanceamento do Art. 10 §3º, com hash do objeto.
-- Trocar o hash depois é trocar a prova depois de ela ter sido aceita.
CREATE TRIGGER lia_evidencia_imutavel
  BEFORE UPDATE OR DELETE ON lia_evidencia
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

-- Decisão assinada (`assinatura` = hash do documento + sub do aprovador, Art. 38).
-- Assinatura reescrevível não é assinatura: é um campo de texto com nome solene.
CREATE TRIGGER ripd_aprovacao_imutavel
  BEFORE UPDATE OR DELETE ON ripd_aprovacao
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

-- O que o gate encontrou naquela execução. Achado editável deixa o gate verde
-- pelo caminho mais curto, que é exatamente o Risco-003 com permissão de escrita.
CREATE TRIGGER gate_finding_imutavel
  BEFORE UPDATE OR DELETE ON gate_finding
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

-- Instantâneo por definição — a UNIQUE já é (tenant, métrica, instante). Série
-- histórica que se reescreve é série que conta a história de agora.
CREATE TRIGGER metric_snapshot_imutavel
  BEFORE UPDATE OR DELETE ON metric_snapshot
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

-- A trilha do incidente (Risco-015). Prova o cumprimento do prazo do Art. 48, e
-- prazo provado por registro reescrevível não é prazo provado.
CREATE TRIGGER incidente_evento_imutavel
  BEFORE UPDATE OR DELETE ON incidente_evento
  FOR EACH ROW EXECUTE FUNCTION bloqueia_mutacao();

-- ── Deliberadamente NÃO append-only, e por quê ──────────────────────────────
--
-- Cada uma abaixo foi considerada e recusada. Proteção que trava a operação não
-- é rigor, é defeito com aparência de rigor — e a recusa fica escrita para que a
-- próxima leitura não a confunda com esquecimento:
--
--   * `expurgo_run`        — `status` sai de 'executando' e `concluido_em` é
--                            carimbado no fim. O executor precisa dos dois.
--   * `expurgo_entrada`    — `verificado_em`, `verificado_por` e `integro` são
--                            escritos na conferência, que é posterior por
--                            desenho: verificar antes de expurgar não verifica
--                            nada.
--   * `revogacao_propagacao` — `estado` acompanha a cascata até o parceiro
--                            confirmar; congelá-lo pararia a propagação no
--                            primeiro passo.
--   * `kms_rotacao_etapa`  — `status` é a própria etapa avançando: congelá-la
--                            deixaria toda rotação parada no primeiro passo.
--                            O que prova a rotação é `kms_acesso`, append-only.
--   * `solicitacao_mensagem` — fato, **menos** `lida_em`, que é recibo de
--                            leitura e só existe depois. Uma exceção estreita
--                            como a do `audit_log` resolveria, e não foi feita
--                            aqui: seria função nova sem defeito que a motive, e
--                            a mensagem já é protegida contra CPF por CHECK.


-- Botão "Verificar integridade" da T6 chama esta função.
--
-- Duas conferências, não uma, e a segunda é o que fecha o Risco-004.
--
-- A primeira é a cadeia: recompõe o payload de cada linha e confere o hash. A
-- segunda é o **selo contra o texto**: enquanto a justificativa existe, o seu
-- sha256 tem de bater com `justificativa_hash`. Sem ela havia um buraco exato:
-- quem trocasse só o texto, deixando a coluna do selo intacta, passava — porque
-- a cadeia consome o selo, não o texto. O campo mais aberto do trail era o
-- único que se podia reescrever sem deixar rastro.
--
-- Depois do expurgo controlado o texto não existe mais, e é `pii_expurgada_em`
-- que diz isso. Aí só a cadeia responde — que é precisamente o desenho: o selo
-- sobrevive ao texto e continua provando o que o texto dizia.
CREATE OR REPLACE FUNCTION verificar_integridade_audit(p_tenant UUID)
RETURNS TABLE (linha_id BIGINT, esperado TEXT, encontrado TEXT, integro BOOLEAN, motivo TEXT) AS $$
DECLARE
  r RECORD;
  v_prev TEXT := NULL;
  v_calc TEXT;
  v_selo BOOLEAN;
BEGIN
  FOR r IN SELECT * FROM audit_log WHERE tenant_id = p_tenant ORDER BY id LOOP
    v_calc := encode(sha256((
        coalesce(v_prev, 'genesis:' || p_tenant::text)
     || '|' || r.ocorrido_em::text
     || '|' || coalesce(r.ator_id::text, '-')
     || '|' || r.acao
     || '|' || r.recurso_tipo
     || '|' || coalesce(r.recurso_id, '-')
     || '|' || coalesce(r.finalidade, '-')
     -- Mesma posição do trigger, e as duas mudam juntas ou nenhuma delas: uma
     -- verificação que monta o payload em ordem diferente da gravação acusa o
     -- trail inteiro de adulterado e vira ruído que a equipe aprende a ignorar.
     || '|' || coalesce(r.base_legal::text, '-')
     || '|' || array_to_string(r.campos, ',')
     || '|' || r.resultado
     -- Lido da coluna, não recalculado do texto: é exatamente por isso que a
     -- verificação continua íntegra depois de a justificativa ser expurgada.
     || '|' || coalesce(r.justificativa_hash, ''))::bytea), 'hex');

    -- O selo só é conferível enquanto o texto existe. Depois do expurgo, quem
    -- responde é a cadeia — e ela responde justamente porque o selo entrou nela.
    v_selo := r.pii_expurgada_em IS NOT NULL
           OR encode(sha256(coalesce(r.justificativa, '')::bytea), 'hex') = coalesce(r.justificativa_hash, '');

    linha_id := r.id; esperado := v_calc; encontrado := r.hash;
    integro := (v_calc = r.hash) AND v_selo;
    motivo := CASE
                WHEN v_calc <> r.hash AND NOT v_selo THEN 'cadeia e selo da justificativa'
                WHEN v_calc <> r.hash THEN 'cadeia'
                WHEN NOT v_selo THEN 'texto da justificativa não corresponde ao selo'
                ELSE NULL
              END;
    RETURN NEXT;
    -- Encadeia pelo hash **gravado**, não pelo recalculado: é o que faz a
    -- adulteração de uma linha contaminar todas as seguintes em vez de ficar
    -- contida nela.
    v_prev := r.hash;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

-- ---------------------------------------------------------------------
-- 13. Row-Level Security
-- ---------------------------------------------------------------------

ALTER TABLE sistema             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ripd                ENABLE ROW LEVEL SECURITY;
ALTER TABLE risco               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lia                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitacao_titular ENABLE ROW LEVEL SECURITY;
ALTER TABLE expurgo_run         ENABLE ROW LEVEL SECURITY;
ALTER TABLE kms_chave           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_snapshot     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_run            ENABLE ROW LEVEL SECURITY;

-- A aplicação define `app.tenant_id` e `app.papel` por conexão.
CREATE POLICY tenant_isolation ON sistema             USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON ripd                USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON risco               USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON lia                 USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON expurgo_run         USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON kms_chave           USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON metric_snapshot     USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON gate_run            USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Solicitações de titular: DPO e responsável designado; auditor externo não vê o pseudônimo.
CREATE POLICY solicitacao_leitura ON solicitacao_titular
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND current_setting('app.papel', true) IN ('dpo','juridico','system')
  );

CREATE POLICY solicitacao_responsavel ON solicitacao_titular
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND responsavel_id::text = current_setting('app.ator_id', true)
  );

-- Auditoria: leitura ampla dentro do tenant, escrita só pela role de aplicação.
CREATE POLICY audit_leitura ON audit_log FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY audit_escrita ON audit_log FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- 14. Papéis de banco por finalidade (menor privilégio real)
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gov_app')      THEN CREATE ROLE gov_app NOLOGIN;      END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gov_leitura')  THEN CREATE ROLE gov_leitura NOLOGIN;  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gov_auditor')  THEN CREATE ROLE gov_auditor NOLOGIN;  END IF;
END$$;

GRANT USAGE ON SCHEMA gov TO gov_app, gov_leitura, gov_auditor;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA gov TO gov_app;
GRANT SELECT ON ALL TABLES IN SCHEMA gov TO gov_leitura;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA gov TO gov_app;

-- Auditor externo: tudo menos o pseudônimo do titular e o corpo das mensagens.
REVOKE ALL ON solicitacao_titular, solicitacao_mensagem FROM gov_auditor;
GRANT SELECT (id, tenant_id, protocolo, direito, canal, status, recebida_em,
              prazo_limite, concluida_em, dentro_do_sla)
  ON solicitacao_titular TO gov_auditor;
GRANT SELECT ON audit_log, expurgo_run, expurgo_entrada, metric_snapshot, risco, ripd TO gov_auditor;

-- ---------------------------------------------------------------------
-- 15. Visões de apoio às telas
-- ---------------------------------------------------------------------

-- T2: linha da tabela do ROPA vivo.
CREATE VIEW v_ropa AS
SELECT s.slug                AS sistema,
       s.repositorio,
       d.nome                AS dataset,
       d.zona_lake,
       c.nome                AS campo,
       c.tipo_armazenado,
       c.categoria,
       c.sensivel,
       c.base_legal,
       c.finalidade,
       c.retencao,
       c.lia_id,
       bool_or(sh.transferencia_internacional) AS transferencia_internacional,
       -- O destino agora tem nome porque tem entidade. O ROPA passa a poder
       -- responder "com quem" e "sob qual contrato" pela mesma junção.
       array_remove(array_agg(DISTINCT fo.nome), NULL) AS destinos,
       bool_and(coalesce(fo.dpa_assinado, true)) AS todos_com_dpa
FROM campo c
JOIN dataset d ON d.id = c.dataset_id AND d.vigente
JOIN sistema s ON s.id = d.sistema_id
LEFT JOIN compartilhamento sh ON sh.campo_id = c.id
LEFT JOIN fornecedor fo ON fo.id = sh.fornecedor_id
GROUP BY s.slug, s.repositorio, d.nome, d.zona_lake, c.nome, c.tipo_armazenado,
         c.categoria, c.sensivel, c.base_legal, c.finalidade, c.retencao, c.lia_id;

-- T4: cronômetro de SLA exibido para cada solicitação em aberto.
CREATE VIEW v_sla_titular AS
SELECT id,
       tenant_id,
       protocolo,
       direito,
       status,
       prazo_limite,
       GREATEST(prazo_limite - now(), INTERVAL '0') AS restante,
       (prazo_limite - now()) < INTERVAL '24 hours' AS alerta_dpo,
       now() > prazo_limite                          AS estourado
FROM solicitacao_titular
WHERE status NOT IN ('concluida','recusada');

-- T1: última leitura de cada métrica com variação contra a leitura anterior.
CREATE VIEW v_metricas_tendencia AS
SELECT DISTINCT ON (tenant_id, metrica)
       tenant_id,
       metrica,
       valor,
       unidade,
       meta,
       coletado_em,
       valor - lag(valor) OVER (PARTITION BY tenant_id, metrica ORDER BY coletado_em) AS variacao
FROM metric_snapshot
ORDER BY tenant_id, metrica, coletado_em DESC;

-- T5: distribuição de risco por domínio, para o heatmap organizacional.
CREATE VIEW v_risco_por_dominio AS
SELECT tenant_id, dominio,
       count(*)                                    AS total,
       count(*) FILTER (WHERE score >= 15)         AS criticos,
       round(avg(score), 1)                        AS score_medio,
       count(*) FILTER (WHERE prazo < current_date AND status <> 'mitigado') AS vencidos
FROM risco
GROUP BY tenant_id, dominio;
