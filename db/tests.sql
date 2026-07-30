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

-- PR 7 · Risco-007 — a LIA que caiu por disparidade barra igual à que nunca valeu.
--
-- `em_revisao` já estava no CHECK do status desde o desenho de produção; o que
-- não havia era prova de que o trigger a trata como não vigente. É o par exato
-- do 422 que o protótipo passa a devolver quando o teste de disparidade estoura:
-- lá a leitura é recusada, aqui a escrita.
--
-- O estado sai de `vigente`, e não direto para `em_revisao`, porque é assim que
-- a queda acontece — uma LIA que nunca valeu não tem vigência para perder.
UPDATE lia SET status = 'vigente', assinatura_dpo = 'sig:teste', vigencia_fim = current_date + 180
 WHERE id = '66666666-6666-4666-8666-0000000000ff';
UPDATE lia SET status = 'em_revisao' WHERE id = '66666666-6666-4666-8666-0000000000ff';

SELECT assert_igual(
  (SELECT status FROM lia WHERE id = '66666666-6666-4666-8666-0000000000ff'),
  'em_revisao'::text,
  'em_revisao é status aceito pelo CHECK da LIA');

SELECT assert_falha($$
  INSERT INTO campo (dataset_id, nome, tipo_armazenado, categoria, sensivel, finalidade, base_legal, lia_id, retencao)
  VALUES ('55555555-5555-4555-8555-000000000003','perfil_navegacao_2','hmac','pseudonimizado',false,
          'Personalização','legitimo_interesse','66666666-6666-4666-8666-0000000000ff','P90D')
$$, 'legítimo interesse com LIA em revisão por disparidade');

-- ---------------------------------------------------------------------
-- Risco-008 (resíduo) — desligamento de parceiro com SLA
-- ---------------------------------------------------------------------

-- O parceiro em desligamento recusa transferência NOVA no ato, e a recusa fala
-- do desligamento — não do prazo do contrato, que pode seguir válido.
UPDATE fornecedor SET estado = 'desligando' WHERE slug = 'serasa';

SELECT assert_falha($$
  INSERT INTO compartilhamento (campo_id, fornecedor_id, finalidade, transferencia_internacional, mecanismo)
  SELECT c.id, f.id, 'Consulta de score', false, 'nao_aplicavel'
    FROM campo c, fornecedor f
   WHERE c.nome = 'score_serasa' AND f.slug = 'serasa'
$$, 'transferência para parceiro em desligamento');

-- E o histórico continua legível: o encerramento não apaga o que houve, que é
-- justamente o período que uma auditoria examina.
SELECT assert_igual(
  (SELECT count(*) > 0 FROM compartilhamento c JOIN fornecedor f ON f.id = c.fornecedor_id WHERE f.slug = 'serasa'),
  true,
  'compartilhamento antigo de parceiro em desligamento segue legível');

UPDATE fornecedor SET estado = 'desligado' WHERE slug = 'serasa';
SELECT assert_falha($$
  INSERT INTO compartilhamento (campo_id, fornecedor_id, finalidade, transferencia_internacional, mecanismo)
  SELECT c.id, f.id, 'Consulta de score', false, 'nao_aplicavel'
    FROM campo c, fornecedor f
   WHERE c.nome = 'score_serasa' AND f.slug = 'serasa'
$$, 'transferência para parceiro desligado');

UPDATE fornecedor SET estado = 'ativo' WHERE slug = 'serasa';

-- Estado fora do vocabulário fechado.
SELECT assert_falha($$
  UPDATE fornecedor SET estado = 'suspenso' WHERE slug = 'serasa'
$$, 'estado de fornecedor fora do CHECK');

-- A janela prometida não ultrapassa o que o contrato promete no encerramento.
UPDATE fornecedor SET dpa_encerramento_dias = 30 WHERE slug = 'serasa';

SELECT assert_falha($$
  INSERT INTO fornecedor_desligamento (fornecedor_id, motivo, decidido_por, janela_dias)
  SELECT f.id, 'Encerramento contratual por decisão do comitê de privacidade.', a.id, 45
    FROM fornecedor f, ator a WHERE f.slug = 'serasa' AND a.papel = 'dpo' LIMIT 1
$$, 'janela de desligamento maior que o prazo do DPA');

-- Motivo curto não sustenta o encerramento em auditoria.
SELECT assert_falha($$
  INSERT INTO fornecedor_desligamento (fornecedor_id, motivo, decidido_por, janela_dias)
  SELECT f.id, 'saiu', a.id, 10
    FROM fornecedor f, ator a WHERE f.slug = 'serasa' AND a.papel = 'dpo' LIMIT 1
$$, 'desligamento sem motivo escrito');

-- Janela válida entra, e `janela_ate` é derivada — não digitada.
INSERT INTO fornecedor_desligamento (fornecedor_id, motivo, decidido_por, janela_dias)
SELECT f.id, 'Encerramento contratual por decisão do comitê de privacidade.', a.id, 30
  FROM fornecedor f, ator a WHERE f.slug = 'serasa' AND a.papel = 'dpo' LIMIT 1;

SELECT assert_igual(
  (SELECT janela_ate FROM fornecedor_desligamento d JOIN fornecedor f ON f.id = d.fornecedor_id
    WHERE f.slug = 'serasa'),
  ((SELECT (decidido_em AT TIME ZONE 'UTC')::date FROM fornecedor_desligamento d
      JOIN fornecedor f ON f.id = d.fornecedor_id WHERE f.slug = 'serasa') + 30),
  'janela_ate é derivada da decisão mais a janela');

-- Dois desligamentos abertos seriam duas janelas concorrentes, e nenhuma
-- varredura saberia qual prazo cobrar.
SELECT assert_falha($$
  INSERT INTO fornecedor_desligamento (fornecedor_id, motivo, decidido_por, janela_dias)
  SELECT f.id, 'Segundo encerramento, aberto por engano em outra tela.', a.id, 5
    FROM fornecedor f, ator a WHERE f.slug = 'serasa' AND a.papel = 'dpo' LIMIT 1
$$, 'segundo desligamento aberto para o mesmo parceiro');

-- Prova pela metade não é prova: quem destruiu, quando e o hash andam juntos.
SELECT assert_falha($$
  UPDATE fornecedor_desligamento SET chave_destruida_em = now()
   WHERE fornecedor_id = (SELECT id FROM fornecedor WHERE slug = 'serasa')
$$, 'destruição registrada sem quem destruiu e sem hash');

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
  SELECT id,'dpo','Confirmando o CPF 274.065.813-77 do titular.'
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
  VALUES ('99999999-9999-4999-8999-000000000001','pii_em_log','alta','x','y','z','27406581377')
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
-- Risco-004 — a cadeia cobre a BASE LEGAL, e o selo cobre o TEXTO
-- ---------------------------------------------------------------------
--
-- Dois buracos diferentes, com detecções diferentes, e é por isso que os testes
-- abaixo repõem o valor original em vez de deixarem o trail quebrado:
--
--   · `base_legal` estava gravada e **fora do payload**. Trocar `consentimento`
--     por `legitimo_interesse` na linha que registrou o acesso reescrevia a
--     justificação jurídica do tratamento sem quebrar nada — quem consumisse a
--     verificação via verde.
--
--   · a justificativa entra na cadeia como sha256 (é o que permite expurgá-la
--     sem quebrar a prova), e por isso a cadeia sozinha **não** percebe o texto
--     trocado: ela consome o selo. Quem percebe é a conferência do selo contra
--     o texto, e o teste abaixo prova as duas coisas separadamente.
--
-- Repor o valor e ver a verificação voltar a fechar é o que separa "detectou"
-- de "estava vermelho de qualquer jeito".

CREATE TEMP TABLE _alvo_da_cadeia AS
SELECT id, base_legal, justificativa
  FROM audit_log
 WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
   AND base_legal IS NOT NULL AND justificativa IS NOT NULL
 ORDER BY id LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM _alvo_da_cadeia) <> 1 THEN
    RAISE EXCEPTION 'FALHA: nenhuma linha do trail tem base legal e justificativa — o teste não provaria nada.';
  END IF;
END $$;

-- ── a base legal ─────────────────────────────────────────────────────────────
ALTER TABLE audit_log DISABLE TRIGGER audit_log_imutavel;
UPDATE audit_log
   SET base_legal = CASE WHEN base_legal = 'legitimo_interesse'
                         THEN 'consentimento'::base_legal ELSE 'legitimo_interesse'::base_legal END
 WHERE id = (SELECT id FROM _alvo_da_cadeia);
ALTER TABLE audit_log ENABLE TRIGGER audit_log_imutavel;

SELECT assert_igual(
  (SELECT bool_and(integro) FROM verificar_integridade_audit('11111111-1111-4111-8111-111111111111')),
  false, 'trocar a base legal do trail quebra a verificação');

SELECT assert_igual(
  (SELECT min(linha_id) FROM verificar_integridade_audit('11111111-1111-4111-8111-111111111111')
    WHERE NOT integro),
  (SELECT id FROM _alvo_da_cadeia), 'a divergência começa exatamente na linha adulterada');

SELECT assert_igual(
  (SELECT motivo FROM verificar_integridade_audit('11111111-1111-4111-8111-111111111111')
    WHERE linha_id = (SELECT id FROM _alvo_da_cadeia)),
  'cadeia'::text, 'e o motivo apontado é a cadeia, não o selo');

ALTER TABLE audit_log DISABLE TRIGGER audit_log_imutavel;
UPDATE audit_log SET base_legal = (SELECT base_legal FROM _alvo_da_cadeia)
 WHERE id = (SELECT id FROM _alvo_da_cadeia);
ALTER TABLE audit_log ENABLE TRIGGER audit_log_imutavel;

SELECT assert_igual(
  (SELECT bool_and(integro) FROM verificar_integridade_audit('11111111-1111-4111-8111-111111111111')),
  true, 'repor a base legal original faz a verificação voltar a fechar');

-- ── o texto da justificativa ────────────────────────────────────────────────
ALTER TABLE audit_log DISABLE TRIGGER audit_log_imutavel;
UPDATE audit_log SET justificativa = justificativa || ' — reescrito por quem tinha acesso ao banco'
 WHERE id = (SELECT id FROM _alvo_da_cadeia);
ALTER TABLE audit_log ENABLE TRIGGER audit_log_imutavel;

SELECT assert_igual(
  (SELECT integro FROM verificar_integridade_audit('11111111-1111-4111-8111-111111111111')
    WHERE linha_id = (SELECT id FROM _alvo_da_cadeia)),
  false, 'reescrever a justificativa sem tocar no selo é detectado');

-- A prova de que a segunda conferência faz trabalho: o hash da linha continua
-- batendo, porque a cadeia consome o selo e não o texto. Sem esta asserção, o
-- teste acima passaria mesmo que a detecção viesse de outro lugar.
SELECT assert_igual(
  (SELECT esperado = encontrado FROM verificar_integridade_audit('11111111-1111-4111-8111-111111111111')
    WHERE linha_id = (SELECT id FROM _alvo_da_cadeia)),
  true, 'a cadeia sozinha não acusaria: o hash da linha ainda fecha');

SELECT assert_igual(
  (SELECT motivo FROM verificar_integridade_audit('11111111-1111-4111-8111-111111111111')
    WHERE linha_id = (SELECT id FROM _alvo_da_cadeia)),
  'texto da justificativa não corresponde ao selo'::text, 'e o motivo nomeia o selo');

ALTER TABLE audit_log DISABLE TRIGGER audit_log_imutavel;
UPDATE audit_log SET justificativa = (SELECT justificativa FROM _alvo_da_cadeia)
 WHERE id = (SELECT id FROM _alvo_da_cadeia);
ALTER TABLE audit_log ENABLE TRIGGER audit_log_imutavel;

SELECT assert_igual(
  (SELECT bool_and(integro) FROM verificar_integridade_audit('11111111-1111-4111-8111-111111111111')),
  true, 'repor o texto original faz a verificação voltar a fechar');

DROP TABLE _alvo_da_cadeia;

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

-- ---------------------------------------------------------------------
-- Art. 8º — consentimento é entidade, e o aceite é imutável (Risco-002)
-- ---------------------------------------------------------------------

-- A regra que sustenta as outras: revogar cria fato novo, nunca edita o aceite.
-- Se o aceite pudesse ser alterado, a organização perderia a prova de que houve
-- consentimento enquanto houve tratamento — que é o que o §2º cobra, inclusive
-- depois da revogação.
SELECT assert_falha($$
  UPDATE consentimento SET canal = 'presencial' WHERE id = 'cd000000-0000-4000-8000-000000000001'
$$, 'UPDATE em consentimento');

SELECT assert_falha($$
  DELETE FROM consentimento WHERE id = 'cd000000-0000-4000-8000-000000000001'
$$, 'DELETE em consentimento');

SELECT assert_falha($$
  UPDATE consentimento_texto SET texto = 'outro' WHERE id = 'cc000000-0000-4000-8000-000000000001'
$$, 'UPDATE no texto consentido');

SELECT assert_falha($$
  INSERT INTO consentimento_revogacao (consentimento_id, canal)
  VALUES ('cd000000-0000-4000-8000-000000000003','portal')
$$, 'revogar duas vezes o mesmo aceite');

-- Publicar versão nova com prazo maior não estende aceites já dados.
SELECT assert_falha($$
  INSERT INTO consentimento (tenant_id, titular_pseudonimo, texto_id, canal, coletado_em, prova_hash, validade)
  VALUES ('11111111-1111-4111-8111-111111111111','hmac:novo',
          'cc000000-0000-4000-8000-000000000002','app', current_date,'p','P5Y')
$$, 'aceite com prazo diferente do texto aceito');

SELECT assert_falha($$
  INSERT INTO consentimento_texto (tenant_id, campo_id, versao, texto, texto_hash, validade)
  VALUES ('11111111-1111-4111-8111-111111111111','77777777-7777-4777-8777-000000000006','v9',
          'Sem prazo e sem razao','h','indeterminado')
$$, 'texto com validade indeterminada e sem justificativa');

SELECT assert_igual(
  (SELECT estado FROM gov.consentimento_estado WHERE titular_pseudonimo = 'hmac:d20e…8f13'),
  'revogado', 'revogado precede expirado');

SELECT assert_igual(
  (SELECT estado FROM gov.consentimento_estado WHERE titular_pseudonimo = 'hmac:3b81…cc02'),
  'expirado', 'aceite vencido sem revogação está expirado');

-- O aceite revogado continua legível: o fato histórico não some.
SELECT assert_igual(
  (SELECT count(*)::bigint FROM consentimento c
    JOIN consentimento_revogacao r ON r.consentimento_id = c.id
   WHERE c.prova_hash IS NOT NULL), 1::bigint,
  'o aceite revogado segue legível como fato');

-- O expurgo nasce do marco de revogação, derivado pela mesma função do ciclo.
SELECT assert_igual(
  (SELECT retencao_ate FROM consentimento_revogacao WHERE id = 'ce000000-0000-4000-8000-000000000001'),
  ((now() - INTERVAL '26 hours' + INTERVAL '30 days')::date),
  'expurgo da revogação derivado do marco, +30 dias de carência');

-- A contagem de titulares é somada da entidade — não existe mais campo para ela.
SELECT assert_igual(
  (SELECT count(*)::bigint FROM gov.consentimento_estado WHERE estado = 'ativo'), 1::bigint,
  'titulares ativos somados da entidade');

-- Só a última versão publicada é a vigente, e isso é derivado.
SELECT assert_igual(
  (SELECT versao FROM gov.consentimento_texto_vigente
    WHERE campo_id = '77777777-7777-4777-8777-000000000007'),
  'v3', 'texto vigente é a última versão publicada');

-- Propagação pendente acima de 24 h: é o que a varredura transforma em achado.
SELECT assert_igual(
  (SELECT count(*)::bigint FROM revogacao_propagacao
    WHERE estado = 'pendente' AND iniciada_em < now() - INTERVAL '24 hours'), 1::bigint,
  'uma frente da cascata pendente além do limite');

SELECT assert_falha($$
  INSERT INTO revogacao_propagacao (revogacao_id, alvo, tipo, efeito, estado)
  VALUES ('ce000000-0000-4000-8000-000000000001','X','cessacao','y','propagado')
$$, 'propagado sem data de confirmação');

-- ---------------------------------------------------------------------
-- Art. 39 — fornecedor é entidade, e o DPA recusa a escrita (Risco-008)
-- ---------------------------------------------------------------------

-- Um fornecedor sem DPA assinado, e outro com contrato vencido. São os dois
-- casos que o trigger precisa barrar, e eles não existiam na massa: até aqui,
-- `dpa_assinado` e `dpa_expira_em` nunca tinham sido exercitados por teste.
INSERT INTO fornecedor (id, tenant_id, slug, nome, papel, pais, dpa_assinado, dpa_uri, dpa_expira_em) VALUES
  ('f0000000-0000-4000-8000-0000000000ff','11111111-1111-4111-8111-111111111111',
   'sem-contrato','Parceiro Sem Contrato','operador','Brasil', false,'s3://gov-docs/dpa/anexo.pdf', NULL),
  ('f0000000-0000-4000-8000-0000000000fe','11111111-1111-4111-8111-111111111111',
   'vencido','Parceiro Vencido','operador','Brasil', true, NULL, current_date - 1),
  ('f0000000-0000-4000-8000-0000000000fd','11111111-1111-4111-8111-111111111111',
   'vence-hoje','Parceiro Vence Hoje','operador','Brasil', true, NULL, current_date);

-- Contrato assinado sem prazo não se vigia: não há o que vencer.
SELECT assert_falha($$
  INSERT INTO fornecedor (tenant_id, slug, nome, papel, dpa_assinado)
  VALUES ('11111111-1111-4111-8111-111111111111','sem-prazo','X','operador', true)
$$, 'DPA assinado sem prazo declarado');

-- Evidência anexada NÃO é contrato firmado. Este parceiro tem dpa_uri.
SELECT assert_falha($$
  INSERT INTO compartilhamento (campo_id, fornecedor_id, finalidade)
  VALUES ('77777777-7777-4777-8777-000000000003','f0000000-0000-4000-8000-0000000000ff','Teste')
$$, 'transferência para fornecedor com anexo mas sem DPA assinado');

-- Vencido ontem: recusado, e a mensagem carrega a data.
SELECT assert_falha($$
  INSERT INTO compartilhamento (campo_id, fornecedor_id, finalidade)
  VALUES ('77777777-7777-4777-8777-000000000003','f0000000-0000-4000-8000-0000000000fe','Teste')
$$, 'transferência com DPA vencido ontem');

-- Vencendo hoje: aceito. O contrato cobre o último dia, não a véspera dele.
DO $$
BEGIN
  INSERT INTO compartilhamento (campo_id, fornecedor_id, finalidade)
  VALUES ('77777777-7777-4777-8777-000000000003','f0000000-0000-4000-8000-0000000000fd','Fronteira');
  RAISE NOTICE 'OK   %  → aceito', rpad('transferência com DPA vencendo hoje', 52);
END $$;

SELECT assert_falha($$
  INSERT INTO compartilhamento (campo_id, fornecedor_id, finalidade)
  VALUES ('77777777-7777-4777-8777-000000000003','f0000000-0000-4000-8000-00000000dead','Teste')
$$, 'transferência para fornecedor inexistente');

/*
 * A limitação, provada em vez de descrita.
 *
 * A linha abaixo entra com contrato válido. Envelhecer o contrato depois NÃO
 * dispara trigger nenhum — ele só olha a linha que está sendo escrita. É por
 * isso que a varredura existe, e é por isso que este repositório não escreve em
 * lugar nenhum que o banco vigia o DPA.
 */
DO $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO compartilhamento (campo_id, fornecedor_id, finalidade)
  VALUES ('77777777-7777-4777-8777-000000000003','f0000000-0000-4000-8000-000000000002','Envelhece depois')
  RETURNING id INTO v_id;

  UPDATE fornecedor SET dpa_expira_em = current_date - 10
   WHERE id = 'f0000000-0000-4000-8000-000000000002';

  IF NOT EXISTS (SELECT 1 FROM compartilhamento WHERE id = v_id) THEN
    RAISE EXCEPTION 'FALHA: a transferência sumiu — o banco não deveria mexer no que já está gravado.';
  END IF;
  RAISE NOTICE 'OK   %  → segue gravada', rpad('DPA que vence DEPOIS da escrita', 52);
END $$;

-- E é a view que enxerga o que o trigger não alcança.
-- Duas linhas, e não uma: o vencimento é do **contrato**, não da transferência.
-- Um DPA vencido arrasta toda transferência para aquele parceiro — que é o
-- ganho de ter entidade, e o que a string livre em `destino` não conseguia.
SELECT assert_igual(
  (SELECT count(*)::bigint FROM gov.transferencia_sem_dpa WHERE slug = 'serasa'), 2::bigint,
  'o contrato vencido arrasta todas as transferências do parceiro');

SELECT assert_igual(
  (SELECT estado_dpa FROM gov.transferencia_sem_dpa WHERE slug = 'serasa' LIMIT 1),
  'vencido', 'e o estado dela é vencido, com atraso contado');

SELECT assert_igual(
  (SELECT atraso_dias FROM gov.transferencia_sem_dpa WHERE slug = 'serasa' LIMIT 1),
  10, 'dez dias de atraso, contados do vencimento');

-- Renovar o contrato tira a transferência da varredura.
UPDATE fornecedor SET dpa_expira_em = current_date + 365
 WHERE id = 'f0000000-0000-4000-8000-000000000002';

SELECT assert_igual(
  (SELECT count(*)::bigint FROM gov.transferencia_sem_dpa WHERE slug = 'serasa'), 0::bigint,
  'renovado o DPA, a transferência sai da varredura');

-- O fornecedor não some por baixo da transferência.
SELECT assert_falha($$
  DELETE FROM fornecedor WHERE id = 'f0000000-0000-4000-8000-000000000001'
$$, 'apagar fornecedor com transferência viva');

-- Dois fornecedores com o mesmo slug no mesmo tenant: é o defeito que a
-- entidade existe para acabar — "OpenAI" repetido em linhas independentes.
SELECT assert_falha($$
  INSERT INTO fornecedor (tenant_id, slug, nome, papel)
  VALUES ('11111111-1111-4111-8111-111111111111','openai','OpenAI de novo','operador')
$$, 'fornecedor duplicado no mesmo tenant');

-- ---------------------------------------------------------------------
-- Risco-024 — append-only onde a prova mora, e só onde ela mora
--
-- ── Não-vacuidade primeiro ─────────────────────────────────────────────────
--
-- `BEFORE UPDATE ... FOR EACH ROW` só dispara se houver linha. Um `UPDATE` numa
-- tabela vazia **passa**, e um `assert_falha` sobre ele reprovaria por vacuidade
-- em vez de por defeito. Três das oito não têm massa (`solicitacao_evento`,
-- `achado_evidencia`, `ripd_aprovacao`), e por isso a seção começa semeando o que
-- falta e conferindo que nenhuma das oito está vazia — a asserção que vem depois
-- só vale sobre linha que existe.
-- ---------------------------------------------------------------------

INSERT INTO solicitacao_evento (solicitacao_id, tipo, detalhe)
  SELECT id, 'recebida', 'semeado pela invariante do Risco-024' FROM solicitacao_titular LIMIT 1;

INSERT INTO achado (tenant_id, codigo, descricao, origem, estado, criticidade)
  SELECT id, 'R024-SEMENTE', 'achado semeado pela invariante do Risco-024', 'auditoria_externa',
         'aberto', 'media'
  FROM tenant LIMIT 1;

INSERT INTO achado_evidencia (achado_id, arquivo, etapa, hash)
  SELECT id, 'evidencia.md', 'aberto', 'sha256:semeado' FROM achado LIMIT 1;

INSERT INTO ripd_aprovacao (ripd_id, aprovador_id, decisao, parecer, assinatura)
  SELECT r.id, a.id, 'aprovado', 'parecer semeado pela invariante do Risco-024', 'sha256:semeado'
  FROM ripd r, ator a LIMIT 1;

DO $$
DECLARE t TEXT; n BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY['kms_acesso','solicitacao_evento','consentimento_revogacao',
                           'achado_evidencia','lia_evidencia','ripd_aprovacao',
                           'gate_finding','metric_snapshot'] LOOP
    EXECUTE format('SELECT count(*) FROM gov.%I', t) INTO n;
    IF n = 0 THEN
      RAISE EXCEPTION 'FALHA: % está vazia — a invariante de append-only passaria por vacuidade.', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK   %  → todas com linha', rpad('não-vacuidade das oito append-only', 52);
END $$;

--
-- As duas direções na mesma seção, de propósito. Só a metade que barra provaria
-- que o banco recusa; ela não provaria que a recusa é **seletiva** — e uma
-- barreira que barrasse tudo travaria o executor de expurgo e a cascata de
-- revogação sem acrescentar garantia nenhuma.
-- ---------------------------------------------------------------------

-- log de acesso à chave
SELECT assert_falha($$
  UPDATE kms_acesso SET autorizado = true
$$, 'UPDATE em kms_acesso');
SELECT assert_falha($$
  DELETE FROM kms_acesso
$$, 'DELETE em kms_acesso');

-- evento da solicitação do titular
SELECT assert_falha($$
  UPDATE solicitacao_evento SET ocorrido_em = now()
$$, 'UPDATE em solicitacao_evento');
SELECT assert_falha($$
  DELETE FROM solicitacao_evento
$$, 'DELETE em solicitacao_evento');

-- marco da revogação (move retencao_ate)
SELECT assert_falha($$
  UPDATE consentimento_revogacao SET revogado_em = now()
$$, 'UPDATE em consentimento_revogacao');
SELECT assert_falha($$
  DELETE FROM consentimento_revogacao
$$, 'DELETE em consentimento_revogacao');

-- elo da cadeia de evidência do achado
SELECT assert_falha($$
  UPDATE achado_evidencia SET hash = 'outro'
$$, 'UPDATE em achado_evidencia');
SELECT assert_falha($$
  DELETE FROM achado_evidencia
$$, 'DELETE em achado_evidencia');

-- hash da evidência da LIA
SELECT assert_falha($$
  UPDATE lia_evidencia SET objeto_hash = 'outro'
$$, 'UPDATE em lia_evidencia');
SELECT assert_falha($$
  DELETE FROM lia_evidencia
$$, 'DELETE em lia_evidencia');

-- parecer assinado do RIPD
SELECT assert_falha($$
  UPDATE ripd_aprovacao SET parecer = 'outro'
$$, 'UPDATE em ripd_aprovacao');
SELECT assert_falha($$
  DELETE FROM ripd_aprovacao
$$, 'DELETE em ripd_aprovacao');

-- achado do gate de privacidade
SELECT assert_falha($$
  UPDATE gate_finding SET severidade = 'baixa'
$$, 'UPDATE em gate_finding');
SELECT assert_falha($$
  DELETE FROM gate_finding
$$, 'DELETE em gate_finding');

-- instantâneo de métrica
SELECT assert_falha($$
  UPDATE metric_snapshot SET valor = 100
$$, 'UPDATE em metric_snapshot');
SELECT assert_falha($$
  DELETE FROM metric_snapshot
$$, 'DELETE em metric_snapshot');

-- ── E o outro sentido: estado operacional continua mutável ──────────────────
--
-- Sem isto a seção acima seria compatível com um `bloqueia_mutacao` aplicado a
-- todas as 48 tabelas — o que passaria em oito asserções e quebraria o produto.

-- O executor de expurgo carimba o fim da execução. Se isto falhar, nenhum
-- expurgo consegue se declarar concluído.
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM expurgo_run LIMIT 1;
  UPDATE expurgo_run SET status = 'concluido', concluido_em = now() WHERE id = v_id;
  RAISE NOTICE 'OK   %  → aceito', rpad('UPDATE em expurgo_run (estado, não fato)', 52);
END $$;

-- A conferência do expurgo é posterior por desenho: verificar antes de expurgar
-- não verifica nada.
DO $$
DECLARE v_id BIGINT;
BEGIN
  SELECT id INTO v_id FROM expurgo_entrada LIMIT 1;
  UPDATE expurgo_entrada SET verificado_em = now(), integro = true WHERE id = v_id;
  RAISE NOTICE 'OK   %  → aceito', rpad('UPDATE em expurgo_entrada (conferência)', 52);
END $$;

-- ---------------------------------------------------------------------
-- Risco-015 — o incidente do Art. 48 tem onde persistir, e o banco cobra
--
-- As invariantes são sobre o que o fluxo promete: decidir exige o porquê,
-- "não comunicado" só nasce da decisão de não comunicar, e a trilha que prova o
-- prazo não se reescreve.
-- ---------------------------------------------------------------------

-- Não-vacuidade: sem linha, os CHECK de estado nunca são exercidos e o
-- append-only não dispara. A lição do FOR EACH ROW do Risco-024.
DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n FROM incidente;
  IF n < 2 THEN RAISE EXCEPTION 'FALHA: incidente tem % linha(s) — as invariantes precisam dos dois lados.', n; END IF;
  SELECT count(*) INTO n FROM incidente_evento;
  IF n = 0 THEN RAISE EXCEPTION 'FALHA: incidente_evento vazia — o append-only passaria por vacuidade.'; END IF;
  RAISE NOTICE 'OK   %  → com linha dos dois lados', rpad('não-vacuidade do incidente', 52);
END $$;

-- O prazo do Art. 48 é derivado da detecção, e não digitado ao lado dela.
SELECT assert_igual(
  (SELECT comunicar_ate = (detectado_em AT TIME ZONE 'UTC') + INTERVAL '3 days'
     FROM incidente WHERE codigo = 'INC-2026-001'),
  true, 'comunicar_ate é derivada de detectado_em');

-- Decidir sem fundamento, ou com fundamento curto, é recusado.
SELECT assert_falha($$
  UPDATE incidente SET estado = 'decidido', decisao = 'comunicar_anpd',
         contido_por = (SELECT id FROM ator LIMIT 1)
  WHERE codigo = 'INC-2026-001'
$$, 'decidir sem fundamento');

SELECT assert_falha($$
  UPDATE incidente SET estado = 'decidido', decisao = 'comunicar_anpd', fundamento = 'vazou',
         contido_por = (SELECT id FROM ator LIMIT 1)
  WHERE codigo = 'INC-2026-001'
$$, 'decidir com fundamento sem corpo');

-- "Não comunicado" só nasce da decisão de não comunicar: o caminho inverso
-- apagaria a comunicação que de fato saiu.
SELECT assert_falha($$
  UPDATE incidente SET estado = 'nao_comunicado', decisao = 'comunicar_anpd',
         fundamento = 'Fundamento suficientemente longo para passar do minimo exigido.',
         contido_por = (SELECT id FROM ator LIMIT 1)
  WHERE codigo = 'INC-2026-001'
$$, 'nao_comunicado com decisão de comunicar');

-- Comunicar sem carimbar quando é dizer que cumpriu o prazo sem dizer quando.
SELECT assert_falha($$
  UPDATE incidente SET estado = 'comunicado', decisao = 'comunicar_anpd',
         fundamento = 'Fundamento suficientemente longo para passar do minimo exigido.',
         contido_por = (SELECT id FROM ator LIMIT 1)
  WHERE codigo = 'INC-2026-001'
$$, 'comunicado sem comunicado_em');

-- Encerrar sem data de encerramento.
SELECT assert_falha($$
  UPDATE incidente SET estado = 'encerrado', decisao = 'nao_comunicar',
         fundamento = 'Fundamento suficientemente longo para passar do minimo exigido.',
         contido_por = (SELECT id FROM ator LIMIT 1)
  WHERE codigo = 'INC-2026-001'
$$, 'encerrar sem encerrado_em');

-- Avançar sem dizer quem conteve: a contenção é ato de alguém, e o estado que a
-- registra sem o ator não registra a contenção.
SELECT assert_falha($$
  UPDATE incidente SET estado = 'contido' WHERE codigo = 'INC-2026-001'
$$, 'conter sem dizer quem conteve');

-- Titulares estimados negativos.
SELECT assert_falha($$
  UPDATE incidente SET titulares_estimados = -1 WHERE codigo = 'INC-2026-001'
$$, 'titulares estimados negativos');

-- O escopo sai do catálogo: campo inexistente é recusado pela FK.
SELECT assert_falha($$
  INSERT INTO incidente_campo (incidente_id, campo_id)
  VALUES ('11111111-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-000000000000')
$$, 'escopo do incidente fora do catálogo');

-- E a trilha não se reescreve.
SELECT assert_falha($$
  UPDATE incidente_evento SET para = 'encerrado'
$$, 'UPDATE em incidente_evento');
SELECT assert_falha($$
  DELETE FROM incidente_evento
$$, 'DELETE em incidente_evento');

-- Direção inversa: o incidente **é** estado, e avançar precisa continuar
-- possível. Congelá-lo pararia o fluxo no primeiro passo.
DO $$
BEGIN
  UPDATE incidente SET estado = 'contido', contido_por = (SELECT id FROM ator LIMIT 1)
  WHERE codigo = 'INC-2026-001';
  RAISE NOTICE 'OK   %  → aceito', rpad('UPDATE em incidente (estado, não fato)', 52);
END $$;

DO $$ BEGIN RAISE NOTICE '';
       RAISE NOTICE '=== Todas as invariantes verificadas ===';
END $$;

ROLLBACK;
