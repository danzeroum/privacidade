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

CREATE TABLE compartilhamento (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campo_id                    UUID NOT NULL REFERENCES campo(id) ON DELETE CASCADE,
  destino                     TEXT NOT NULL,     -- 'OpenAI'
  papel_destino               TEXT NOT NULL CHECK (papel_destino IN ('operador','controlador','controlador_conjunto')),
  finalidade                  TEXT NOT NULL,
  transferencia_internacional BOOLEAN NOT NULL DEFAULT false,
  pais_destino                TEXT,
  mecanismo                   mecanismo_transferencia NOT NULL DEFAULT 'nao_aplicavel',
  evidencia_uri               TEXT,              -- s3://.../openai-scc.pdf
  evidencia_hash              TEXT,
  dpa_assinado                BOOLEAN NOT NULL DEFAULT false,
  dpa_expira_em               DATE,
  sla_incidente_horas         INT CHECK (sla_incidente_horas BETWEEN 1 AND 72),

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

-- Botão "Verificar integridade" da T6 chama esta função.
CREATE OR REPLACE FUNCTION verificar_integridade_audit(p_tenant UUID)
RETURNS TABLE (linha_id BIGINT, esperado TEXT, encontrado TEXT, integro BOOLEAN) AS $$
DECLARE
  r RECORD;
  v_prev TEXT := NULL;
  v_calc TEXT;
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
     || '|' || array_to_string(r.campos, ',')
     || '|' || r.resultado
     -- Lido da coluna, não recalculado do texto: é exatamente por isso que a
     -- verificação continua íntegra depois de a justificativa ser expurgada.
     || '|' || coalesce(r.justificativa_hash, ''))::bytea), 'hex');

    linha_id := r.id; esperado := v_calc; encontrado := r.hash; integro := (v_calc = r.hash);
    RETURN NEXT;
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
       array_remove(array_agg(DISTINCT sh.destino), NULL) AS destinos
FROM campo c
JOIN dataset d ON d.id = c.dataset_id AND d.vigente
JOIN sistema s ON s.id = d.sistema_id
LEFT JOIN compartilhamento sh ON sh.campo_id = c.id
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
