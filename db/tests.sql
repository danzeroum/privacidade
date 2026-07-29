-- =====================================================================
--  Testes de invariantes do schema.
--  Cada bloco tenta violar uma regra de privacidade e espera falhar.
--  Execução:  psql -d gov -v ON_ERROR_STOP=1 -f db/tests.sql
-- =====================================================================

SET search_path = gov, public;

\set ON_ERROR_STOP on

-- Tudo roda em uma transação descartada no fim: os testes não sujam a base.
BEGIN;

CREATE OR REPLACE FUNCTION assert_falha(p_sql TEXT, p_caso TEXT) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'OK   %  → bloqueado: %', rpad(p_caso, 52), left(SQLERRM, 90);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: "%" deveria ter sido bloqueado e passou.', p_caso;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_igual(p_obtido ANYELEMENT, p_esperado ANYELEMENT, p_caso TEXT) RETURNS void AS $$
BEGIN
  IF p_obtido IS DISTINCT FROM p_esperado THEN
    RAISE EXCEPTION 'FALHA: % — esperado %, obtido %', p_caso, p_esperado, p_obtido;
  END IF;
  RAISE NOTICE 'OK   %  → %', rpad(p_caso, 52), p_obtido;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Art. 11 — dado sensível não se sustenta em legítimo interesse
-- ---------------------------------------------------------------------
SELECT assert_falha($$
  INSERT INTO campo (dataset_id, nome, tipo_armazenado, categoria, sensivel, finalidade, base_legal, retencao)
  VALUES ('55555555-5555-4555-8555-000000000003','religiao','criptografado','sensivel',true,
          'Segmentação de campanha','legitimo_interesse','P1Y')
$$, 'sensível + legítimo interesse (Art. 11)');

SELECT assert_falha($$
  INSERT INTO campo (dataset_id, nome, tipo_armazenado, categoria, sensivel, finalidade, base_legal, retencao)
  VALUES ('55555555-5555-4555-8555-000000000003','saude','criptografado','sensivel',true,
          'Entrega do contrato','execucao_contrato','P1Y')
$$, 'sensível + execução de contrato (Art. 11)');

-- ---------------------------------------------------------------------
-- Art. 7º, IX — legítimo interesse exige LIA vigente
-- ---------------------------------------------------------------------
SELECT assert_falha($$
  INSERT INTO campo (dataset_id, nome, tipo_armazenado, categoria, sensivel, finalidade, base_legal, retencao)
  VALUES ('55555555-5555-4555-8555-000000000003','perfil_navegacao','hmac','pseudonimizado',false,
          'Personalização','legitimo_interesse','P90D')
$$, 'legítimo interesse sem LIA vinculada');

-- LIA existente porém não vigente também barra.
INSERT INTO lia (id, tenant_id, codigo, titulo, finalidade, categoria_finalidade,
                 beneficio_controlador, dano_ao_titular, expectativa_titular,
                 medidas_mitigacao, transparencia_onde, canal_oposicao, conclusao, status)
VALUES ('66666666-6666-4666-8666-0000000000ff','11111111-1111-4111-8111-111111111111','LIA-DRAFT-999',
        'Rascunho','Testar','melhoria_produto',2,2,'media','—','—','—','sustenta','rascunho');

SELECT assert_falha($$
  INSERT INTO campo (dataset_id, nome, tipo_armazenado, categoria, sensivel, finalidade, base_legal, lia_id, retencao)
  VALUES ('55555555-5555-4555-8555-000000000003','perfil_navegacao','hmac','pseudonimizado',false,
          'Personalização','legitimo_interesse','66666666-6666-4666-8666-0000000000ff','P90D')
$$, 'legítimo interesse com LIA em rascunho');

-- ---------------------------------------------------------------------
-- Art. 12 — hash de CPF não é anonimização
-- ---------------------------------------------------------------------
SELECT assert_falha($$
  INSERT INTO campo (dataset_id, nome, tipo_armazenado, categoria, sensivel, finalidade, base_legal, retencao)
  VALUES ('55555555-5555-4555-8555-000000000003','cpf_sha256','hash','anonimizado',false,
          'BI','execucao_contrato','indeterminado')
$$, 'hash declarado como anonimizado (Art. 12)');

-- ---------------------------------------------------------------------
-- Art. 33 — transferência internacional exige mecanismo e evidência
-- ---------------------------------------------------------------------
SELECT assert_falha($$
  INSERT INTO compartilhamento (campo_id, destino, papel_destino, finalidade, transferencia_internacional)
  VALUES ('77777777-7777-4777-8777-000000000002','AdTech Inc.','controlador','Enriquecimento',true)
$$, 'transferência internacional sem mecanismo (Art. 33)');

-- ---------------------------------------------------------------------
-- Art. 18, VI — eliminação exige verificação elevada
-- ---------------------------------------------------------------------
SELECT assert_falha($$
  INSERT INTO solicitacao_titular (tenant_id, protocolo, titular_pseudonimo, direito, nivel_verificacao, prazo_limite)
  VALUES ('11111111-1111-4111-8111-111111111111','2026-9999','hmac:teste','eliminacao',1, now() + INTERVAL '15 days')
$$, 'eliminação com verificação básica');

-- ---------------------------------------------------------------------
-- Art. 37 — acesso a PII sem finalidade declarada não entra no log
-- ---------------------------------------------------------------------
SELECT assert_falha($$
  INSERT INTO audit_log (tenant_id, ator_tipo, acao, recurso_tipo, recurso_id)
  VALUES ('11111111-1111-4111-8111-111111111111','produto','CAMPO_REVELADO','campo','cpf')
$$, 'revelação de campo sem finalidade (Art. 37)');

-- Mensagem entre titular e DPO não carrega CPF em claro.
SELECT assert_falha($$
  INSERT INTO solicitacao_mensagem (solicitacao_id, remetente, corpo)
  SELECT id,'dpo','Confirmando o CPF 529.982.247-25 do titular.'
  FROM solicitacao_titular WHERE protocolo = '2026-0731'
$$, 'CPF em claro no canal titular↔DPO');

-- ---------------------------------------------------------------------
-- Append-only: auditoria, linhagem e reclassificação de risco
-- ---------------------------------------------------------------------
SELECT assert_falha($$ UPDATE audit_log SET acao = 'ADULTERADO' WHERE id = 1 $$, 'UPDATE em audit_log');
SELECT assert_falha($$ DELETE FROM audit_log WHERE id = 1 $$,                    'DELETE em audit_log');
SELECT assert_falha($$ DELETE FROM linhagem WHERE id = 1 $$,                     'DELETE em linhagem');

-- Reclassificar risco exige justificativa substantiva.
SELECT assert_falha($$
  INSERT INTO risco_reclassificacao (risco_id, prob_anterior, impacto_anterior, prob_nova, impacto_novo, justificativa, ator_id)
  SELECT id, 4, 5, 1, 5, 'ok', '22222222-2222-4222-8222-000000000002' FROM risco WHERE codigo = 'R1'
$$, 'reclassificação sem justificativa real');

-- ---------------------------------------------------------------------
-- RACI: um único accountable por processo
-- ---------------------------------------------------------------------
SELECT assert_falha($$
  INSERT INTO raci (tenant_id, processo, dominio, letra)
  VALUES ('11111111-1111-4111-8111-111111111111','LIA','Produto','A')
$$, 'dois accountables no mesmo processo');

-- ---------------------------------------------------------------------
-- KMS: uma única chave ativa por finalidade
-- ---------------------------------------------------------------------
SELECT assert_falha($$
  INSERT INTO kms_chave (tenant_id, alias, arn, finalidade, status, rotacao_prevista)
  VALUES ('11111111-1111-4111-8111-111111111111','alias/credit-pii-v9','arn:...','credito_pii','ativa', current_date + 90)
$$, 'segunda chave ativa para a mesma finalidade');

-- ---------------------------------------------------------------------
-- Achado de gate nunca carrega o valor encontrado
-- ---------------------------------------------------------------------
SELECT assert_falha($$
  INSERT INTO gate_finding (gate_run_id, regra, severidade, mensagem_bruta, mensagem_humana, como_corrigir, padrao_casado)
  VALUES ('99999999-9999-4999-8999-000000000001','pii_em_log','alta','x','y','z','52998224725')
$$, 'CPF vazando na evidência do gate');

-- ---------------------------------------------------------------------
-- Integridade da cadeia de auditoria
-- ---------------------------------------------------------------------
SELECT assert_igual(
  (SELECT count(*)::bigint FROM verificar_integridade_audit('11111111-1111-4111-8111-111111111111') WHERE NOT integro),
  0::bigint, 'cadeia de hash íntegra');

SELECT assert_igual(
  (SELECT count(*)::bigint FROM audit_log WHERE hash_anterior IS NULL), 1::bigint,
  'apenas o bloco gênese sem predecessor');

-- ---------------------------------------------------------------------
-- Art. 37 c/c Art. 16 — o trail tem prazo, e a cadeia sobrevive ao expurgo
-- ---------------------------------------------------------------------

SELECT assert_igual(
  (SELECT bool_and(integro) FROM verificar_integridade_audit('11111111-1111-4111-8111-111111111111')),
  true, 'cadeia íntegra antes do expurgo de PII');

-- Avança o relógio pelo PARÂMETRO, não mexendo nas linhas.
--
-- A primeira versão deste teste envelhecia `ocorrido_em` com o trigger
-- desligado — e derrubava a cadeia, porque `ocorrido_em` está no payload do
-- hash. O erro é instrutivo: prova que o encadeamento cobre o carimbo de tempo,
-- e que "simular passagem de tempo" editando dado selado nunca é simulação.
DO $$
DECLARE v_afetadas BIGINT;
BEGIN
  v_afetadas := gov.expurgar_pii_do_trail('11111111-1111-4111-8111-111111111111', current_date + 60);
  IF v_afetadas = 0 THEN
    RAISE EXCEPTION 'FALHA: nenhuma linha de trail tinha PII para expurgar — o teste não prova nada.';
  END IF;
  RAISE NOTICE 'OK   %  → % linhas', rpad('PII do trail expurgada após 30 dias', 52), v_afetadas;
END $$;

SELECT assert_igual(
  (SELECT count(*)::bigint FROM audit_log
    WHERE ip IS NOT NULL OR user_agent IS NOT NULL OR justificativa IS NOT NULL),
  0::bigint, 'nenhuma PII de operador sobrou no trail');

-- A prova da regra do sha256: o texto sumiu e a cadeia continua fechando.
SELECT assert_igual(
  (SELECT bool_and(integro) FROM verificar_integridade_audit('11111111-1111-4111-8111-111111111111')),
  true, 'cadeia íntegra DEPOIS do expurgo de PII');

SELECT assert_igual(
  (SELECT count(*)::bigint FROM audit_log WHERE justificativa_hash IS NULL), 0::bigint,
  'o selo da justificativa fica, mesmo sem o texto');

-- Reexecutar o expurgo é no-op: a linha já expurgada não volta.
SELECT assert_igual(
  gov.expurgar_pii_do_trail('11111111-1111-4111-8111-111111111111', current_date + 60),
  0::bigint, 'segundo expurgo do trail é no-op');

-- A exceção do append-only é estreita: qualquer outra mutação continua barrada.
SELECT assert_falha($$
  UPDATE audit_log SET acao = 'ADULTERADO' WHERE id = (SELECT min(id) FROM audit_log)
$$, 'alterar a ação do trail pelo caminho do expurgo');

SELECT assert_falha($$
  DELETE FROM audit_log WHERE id = (SELECT min(id) FROM audit_log)
$$, 'apagar linha do trail');


-- Adulteração detectada: mesmo com os gatilhos desligados no banco (cenário de
-- DBA comprometido), a recomputação da cadeia acusa a linha alterada e todas as
-- seguintes. É isso que o botão "Verificar integridade" da T6 demonstra.
ALTER TABLE audit_log DISABLE TRIGGER audit_log_imutavel;
UPDATE audit_log SET acao = 'ADULTERADO'
 WHERE id = (SELECT min(id) + 1 FROM audit_log);
ALTER TABLE audit_log ENABLE TRIGGER audit_log_imutavel;

SELECT assert_igual(
  (SELECT count(*)::bigint FROM verificar_integridade_audit('11111111-1111-4111-8111-111111111111') WHERE NOT integro) > 0,
  true, 'adulteração silenciosa é detectada');

-- ---------------------------------------------------------------------
-- Métricas derivadas usadas nas telas
-- ---------------------------------------------------------------------
SELECT assert_igual((SELECT score::int FROM risco WHERE codigo = 'R1'), 20, 'R1 score = P×I');

SELECT assert_igual(
  (SELECT count(*)::bigint FROM v_sla_titular WHERE alerta_dpo), 1::bigint,
  'uma solicitação a menos de 24h do prazo');

SELECT assert_igual(
  (SELECT count(*)::bigint FROM v_ropa WHERE transferencia_internacional), 2::bigint,
  'campos com transferência internacional');

SELECT assert_igual(
  (SELECT round(100.0 * count(*) FILTER (WHERE dentro_do_sla) / count(*))::int
   FROM solicitacao_titular WHERE status = 'concluida'), 100,
  '% de solicitações concluídas dentro do SLA');

-- ---------------------------------------------------------------------
-- Art. 16 — o ciclo de vida tem motor (Risco-006)
-- ---------------------------------------------------------------------

-- PARIDADE: a derivação em SQL e a de TypeScript são cobradas contra a MESMA
-- tabela de casos. O arquivo é lido pelos dois lados; divergir reprova aqui e
-- na suíte do app. Sem isto, "espelhada em SQL e TS" seria uma frase.
CREATE TEMP TABLE caso_retencao (
  caso TEXT, retencao TEXT, fato_gerador TEXT, marco DATE, esperado DATE
);
\copy caso_retencao FROM 'db/retencao-casos.csv' WITH (FORMAT csv, HEADER true)

SELECT assert_igual((SELECT count(*)::bigint FROM caso_retencao) >= 14, true,
  'o CSV de paridade tem casos suficientes');

DO $$
DECLARE r RECORD; v_obtido DATE;
BEGIN
  FOR r IN SELECT * FROM caso_retencao LOOP
    v_obtido := gov.retencao_ate(r.retencao, r.marco);
    IF v_obtido IS DISTINCT FROM r.esperado THEN
      RAISE EXCEPTION 'FALHA de paridade em "%": esperado %, obtido % (retencao=%, marco=%)',
        r.caso, r.esperado, v_obtido, r.retencao, r.marco;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK   %  → % casos', rpad('paridade da derivação SQL × TypeScript', 52),
    (SELECT count(*) FROM caso_retencao);
END $$;

-- O domínio recusa obrigação legal sem prazo: norma sem prazo não deriva data.
SELECT assert_falha($$
  INSERT INTO campo (dataset_id, nome, tipo_armazenado, categoria, sensivel, finalidade, base_legal, retencao)
  VALUES ('55555555-5555-4555-8555-000000000001','sem_prazo','hash','pessoal',false,
          'Teste','obrigacao_legal','obrigacao_legal:lei_8846_1994')
$$, 'obrigação legal sem prazo no domínio retencao');

-- retencao_ate é GERADA: o banco recusa quem tentar escrevê-la.
SELECT assert_falha($$
  INSERT INTO campo (dataset_id, nome, tipo_armazenado, categoria, sensivel, finalidade, base_legal, retencao, retencao_ate)
  VALUES ('55555555-5555-4555-8555-000000000001','digitada','hash','pessoal',false,
          'Teste','execucao_contrato','P5Y', DATE '2099-01-01')
$$, 'retencao_ate digitada em vez de derivada');

-- Prazo sem fim só existe declarado.
SELECT assert_falha($$
  INSERT INTO campo (dataset_id, nome, tipo_armazenado, categoria, sensivel, finalidade, base_legal, retencao)
  VALUES ('55555555-5555-4555-8555-000000000001','sem_fonte','hash','pessoal',false,
          'Teste','obrigacao_legal','indeterminado')
$$, 'indeterminado sem justificativa no ROPA');

SELECT assert_igual(
  (SELECT retencao_ate FROM campo WHERE nome = 'historico_compras'),
  (current_date - 6),
  'historico_compras venceu há 6 dias — a linha vermelha da T6');

SELECT assert_igual(
  (SELECT retencao_ate FROM campo WHERE nome = 'email'), NULL::date,
  'consentimento não revogado ainda não tem prazo');

-- Idempotência: o mesmo lote não entra duas vezes.
SELECT assert_falha($$
  INSERT INTO expurgo_entrada (expurgo_run_id, sistema_slug, tabela, metodo, registros, lote_chave, ids_afetados_hash, hash_pre, hash_pos)
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002','credit-scoring','decisoes_ia','hard_delete',1,
          'lote:d1:decisoes_ia:0','sha256:x','a','b')
$$, 'reexecutar o mesmo lote duplicaria o registro');

-- O total é somado, nunca incrementado.
SELECT assert_igual(
  (SELECT registros_total FROM gov.expurgo_run_resumo WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'),
  18432::bigint,
  'registros_total sai da soma dos lotes');

-- ---------------------------------------------------------------------
-- O resíduo retido de uma solicitação tem lei e data
-- ---------------------------------------------------------------------

SELECT assert_falha($$
  INSERT INTO solicitacao_retido (solicitacao_id, item, base_legal, retencao, marco)
  VALUES ((SELECT id FROM solicitacao_titular LIMIT 1),'Notas fiscais','obrigacao_legal',
          'indeterminado', current_date)
$$, 'reter resíduo de titular sem data de eliminação');

DO $$ BEGIN RAISE NOTICE '';
       RAISE NOTICE '=== Todas as invariantes verificadas ===';
END $$;

ROLLBACK;
