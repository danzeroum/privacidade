-- =====================================================================
--  Massa de demonstração — plataforma de credito com IA
--  Os mesmos números aparecem no protótipo (prototipo/index.html).
--  Nenhum dado real de titular: CPFs são pseudônimos HMAC fictícios.
-- =====================================================================

SET search_path = gov, public;

-- ---------- tenant e atores -------------------------------------------------
INSERT INTO tenant (id, slug, nome, dpo_email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'creditoia', 'Crédito IA S.A.', 'dpo@creditoia.example');

INSERT INTO ator (id, tenant_id, subject_oidc, nome, email, papel, finalidades, mfa_ativo) VALUES
  ('22222222-2222-4222-8222-000000000001','11111111-1111-4111-8111-111111111111','oidc|maria','Maria Souza','maria@creditoia.example','engenharia','{atendimento}',true),
  ('22222222-2222-4222-8222-000000000002','11111111-1111-4111-8111-111111111111','oidc|marcela','Marcela Dias','marcela@creditoia.example','dpo','{auditoria,atendimento,cobranca}',true),
  ('22222222-2222-4222-8222-000000000003','11111111-1111-4111-8111-111111111111','oidc|rita','Rita Nunes','rita@creditoia.example','seguranca','{auditoria}',true),
  ('22222222-2222-4222-8222-000000000004','11111111-1111-4111-8111-111111111111','oidc|pedro','Pedro Lima','pedro@creditoia.example','produto','{}',false),
  ('22222222-2222-4222-8222-000000000005','11111111-1111-4111-8111-111111111111','oidc|ana','Ana Ferraz','ana@creditoia.example','juridico','{auditoria}',true),
  ('22222222-2222-4222-8222-000000000009','11111111-1111-4111-8111-111111111111','svc|platform','Serviço da plataforma','noreply@creditoia.example','system','{}',false);

-- ---------- sistemas --------------------------------------------------------
INSERT INTO sistema (id, tenant_id, slug, nome, repositorio, dominio, time_dono, steward_id, criticidade) VALUES
  ('33333333-3333-4333-8333-000000000001','11111111-1111-4111-8111-111111111111','credit-scoring','Scoring de crédito','danzeroum/credit-scoring','financeiro','@squad-credito','22222222-2222-4222-8222-000000000001','critica'),
  ('33333333-3333-4333-8333-000000000002','11111111-1111-4111-8111-111111111111','onboarding','Onboarding e cadastro','danzeroum/onboarding','crescimento','@squad-growth','22222222-2222-4222-8222-000000000004','alta'),
  ('33333333-3333-4333-8333-000000000003','11111111-1111-4111-8111-111111111111','analytics','Pipeline analítico','danzeroum/analytics','dados','@squad-dados','22222222-2222-4222-8222-000000000001','media');

INSERT INTO inventario_versao (id, sistema_id, arquivo, commit_sha, versao, conteudo, conteudo_hash, valido, importado_por) VALUES
  ('44444444-4444-4444-8444-000000000001','33333333-3333-4333-8333-000000000001','.privacy/data-inventory.product.yaml','a1b2c3d4e5f60718293a4b5c6d7e8f9012345678','2.3.1','{"produto":"Credit Scoring com IA"}','9f2c4e8a11d0b7c3e5a6f8901b2c3d4e5f60718293a4b5c6d7e8f9012345abcd',true,'22222222-2222-4222-8222-000000000001'),
  ('44444444-4444-4444-8444-000000000002','33333333-3333-4333-8333-000000000002','.privacy/data-inventory.onboarding.yaml','b2c3d4e5f60718293a4b5c6d7e8f901234567890','1.8.0','{"produto":"Onboarding"}','ae31bb7740c9d2e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9',true,'22222222-2222-4222-8222-000000000004');

INSERT INTO dataset (id, sistema_id, versao_id, nome, schema_fisico, zona_lake, volume_diario) VALUES
  ('55555555-5555-4555-8555-000000000001','33333333-3333-4333-8333-000000000001','44444444-4444-4444-8444-000000000001','clientes','public','trusted',42000),
  ('55555555-5555-4555-8555-000000000002','33333333-3333-4333-8333-000000000001','44444444-4444-4444-8444-000000000001','decisoes_ia','public','trusted',42000),
  ('55555555-5555-4555-8555-000000000003','33333333-3333-4333-8333-000000000002','44444444-4444-4444-8444-000000000002','cadastros','public','raw',9800);

-- ---------- LIA vigente (precede os campos de legítimo interesse) -----------
INSERT INTO lia (id, tenant_id, codigo, titulo, finalidade, categoria_finalidade,
                 beneficio_controlador, dano_ao_titular, expectativa_titular,
                 medidas_mitigacao, transparencia_onde, canal_oposicao, conclusao,
                 status, vigencia_inicio, vigencia_fim, documento_uri, documento_hash,
                 assinatura_dpo, assinado_por, assinado_em) VALUES
  ('66666666-6666-4666-8666-000000000001','11111111-1111-4111-8111-111111111111','LIA-SCORING-001',
   'Enriquecimento do modelo de scoring com histórico de compras',
   'Elevar a acurácia do scoring reduzindo recusa indevida de crédito','analise_credito',
   3,2,'media',
   'Pseudonimização HMAC pré-prompt; retenção de 180 dias; exclusão do CEP como feature; teste de disparate impact a cada release.',
   'Aviso de privacidade, seção 4 "Como decidimos seu crédito", e tela de resultado da proposta.',
   'POST /v1/titulares/me/oposicao?lia=LIA-SCORING-001',
   'sustenta_com_mitigacao','vigente', DATE '2026-02-01', DATE '2027-02-01',
   's3://gov-docs/lia/LIA-SCORING-001.md',
   '7c1f0a9b3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a',
   'sig:sha256:7c1f0a9b…:oidc|marcela','22222222-2222-4222-8222-000000000002', now() - INTERVAL '170 days');

INSERT INTO lia_alternativa (lia_id, alternativa, situacao, justificativa) VALUES
  ('66666666-6666-4666-8666-000000000001','anonimizacao','rejeitado','A agregação com k-anonimato destrói o sinal individual necessário para o scoring; testado em jul/2026 com queda de 31 p.p. de AUC.'),
  ('66666666-6666-4666-8666-000000000001','pseudonimizacao','atendido','CPF substituído por token HMAC-SHA256 com chave no KMS antes de qualquer uso analítico ou envio a LLM.'),
  ('66666666-6666-4666-8666-000000000001','escopo_menor','atendido','Removidas as features cep, nome_mae e canal_atendimento por serem proxies discriminatórios detectados no teste de disparidade.'),
  ('66666666-6666-4666-8666-000000000001','retencao_menor','atendido','Janela reduzida de 24 para 6 meses de histórico de compras sem perda relevante de acurácia (−1,2 p.p. de AUC).'),
  ('66666666-6666-4666-8666-000000000001','agregacao','nao_aplicavel','A decisão é individual por titular; agregado não sustenta a finalidade.'),
  ('66666666-6666-4666-8666-000000000001','consentimento','rejeitado','Consentimento condicionaria a análise de crédito à aceitação, tornando-o não livre; a via legítima aqui é o balanceamento com oposição facilitada.');

INSERT INTO lia_evidencia (lia_id, tipo, objeto_uri, objeto_hash, enviado_por) VALUES
  ('66666666-6666-4666-8666-000000000001','log_redigido','s3://gov-docs/evidencias/lia-001-log.txt','3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b','22222222-2222-4222-8222-000000000001'),
  ('66666666-6666-4666-8666-000000000001','policy_retencao','s3://gov-docs/evidencias/lia-001-ttl.sql','5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d','22222222-2222-4222-8222-000000000001');

INSERT INTO lia_dataset (lia_id, dataset_id) VALUES
  ('66666666-6666-4666-8666-000000000001','55555555-5555-4555-8555-000000000001');

-- ---------- campos do catálogo ---------------------------------------------
-- `fato_gerador`, `registros_estimados` e `registro_mais_antigo_em` são novos:
-- sem eles `retencao_ate` não deriva, e a retenção continuaria sendo um texto
-- que ninguém executa. O marco mais antigo é o que vence primeiro.
INSERT INTO campo (id, dataset_id, nome, tipo_armazenado, categoria, sensivel, origem, finalidade, base_legal, lia_id, retencao, retencao_fonte, fato_gerador, registros_estimados, registro_mais_antigo_em) VALUES
  ('77777777-7777-4777-8777-000000000001','55555555-5555-4555-8555-000000000001','cpf','hash','pessoal',false,'frontend_form','Identificação do titular para emissão de nota fiscal','execucao_contrato',NULL,'P5Y','Lei 8.846/1994 + Art. 7º, II','coleta',1204873, current_date - INTERVAL '3 years'),
  ('77777777-7777-4777-8777-000000000002','55555555-5555-4555-8555-000000000001','renda','criptografado','pessoal',false,'frontend_form','Análise de capacidade de pagamento','execucao_contrato',NULL,'P2Y','Encerramento contratual + 24 meses','fim_do_contrato',842190, current_date - INTERVAL '18 months'),
  ('77777777-7777-4777-8777-000000000003','55555555-5555-4555-8555-000000000001','score_serasa','criptografado','pessoal',false,'API Serasa','Avaliação de risco de inadimplência','protecao_credito',NULL,'P90D','Art. 7º, X','ultima_atualizacao',418902, current_date - INTERVAL '60 days'),
  ('77777777-7777-4777-8777-000000000004','55555555-5555-4555-8555-000000000001','historico_compras','hmac','pseudonimizado',false,'eventos de transação','Enriquecimento do modelo de scoring','legitimo_interesse','66666666-6666-4666-8666-000000000001','P180D','LIA-SCORING-001','coleta',1284502, current_date - INTERVAL '186 days'),
  ('77777777-7777-4777-8777-000000000005','55555555-5555-4555-8555-000000000002','shap_values','agregado','anonimizado',false,'modelo LLM','Explicabilidade da decisão automatizada (Art. 20)','protecao_credito',NULL,'P90D','Art. 20, §1º','coleta',96331, current_date - INTERVAL '30 days'),
  ('77777777-7777-4777-8777-000000000006','55555555-5555-4555-8555-000000000003','email','hmac','pseudonimizado',false,'frontend_form','Comunicação transacional','execucao_contrato',NULL,'consentimento_revogado','Art. 7º, V','revogacao_do_consentimento',31207, NULL),
  ('77777777-7777-4777-8777-000000000007','55555555-5555-4555-8555-000000000003','biometria_facial','criptografado','sensivel',true,'app mobile','Prova de vida no onboarding','consentimento',NULL,'P30D','Art. 11, I','coleta',8412, current_date - INTERVAL '12 days');

INSERT INTO compartilhamento (campo_id, destino, papel_destino, finalidade, transferencia_internacional, pais_destino, mecanismo, evidencia_uri, evidencia_hash, dpa_assinado, dpa_expira_em, sla_incidente_horas) VALUES
  ('77777777-7777-4777-8777-000000000004','OpenAI','operador','Enriquecimento textual para o modelo de scoring',true,'EUA','clausulas_padrao_anpd','s3://gov-docs/dpa/openai-scc.pdf','d4e5f60718293a4b5c6d7e8f9012345678abcdef0123456789abcdef01234567',true,DATE '2027-08-01',24),
  ('77777777-7777-4777-8777-000000000003','Serasa','controlador','Consulta de score para proteção ao crédito',false,NULL,'nao_aplicavel',NULL,NULL,true,DATE '2027-03-15',24),
  ('77777777-7777-4777-8777-000000000006','SendGrid','operador','Entrega de e-mail transacional',true,'EUA','clausulas_padrao_anpd','s3://gov-docs/dpa/sendgrid-scc.pdf','ef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd',true,DATE '2026-09-30',48);

INSERT INTO linhagem (tenant_id, transformacao, versao, origem_sistema, origem_dataset, origem_campo, destino_sistema, destino_dataset, destino_campo, finalidade, base_legal, linhas, run_id) VALUES
  ('11111111-1111-4111-8111-111111111111','etl_pedidos_daily','v2.1.0','credit-scoring','clientes','cpf','analytics','fact_pedidos','cpf_hmac','Análise de vendas','legitimo_interesse',41893,'run_2026_07_27'),
  ('11111111-1111-4111-8111-111111111111','llm_enrichment','v3.0.2','credit-scoring','clientes','historico_compras','openai','prompt_context','texto_pseudonimizado','Scoring de crédito','legitimo_interesse',41893,'run_2026_07_27');

-- ---------- LINDDUN ---------------------------------------------------------
INSERT INTO threat_model (id, sistema_id, titulo, dfd_mermaid, commit_sha, atualizado_por) VALUES
  ('88888888-8888-4888-8888-000000000001','33333333-3333-4333-8333-000000000001','Threat model — Credit Scoring v2.3.1',
   'graph LR; A[Browser]-->|HTTPS|B(API Gateway); B-->C[Scoring]; C-->D[(PostgreSQL)]; C-->E[OpenAI]; D-->F[Data Lake];',
   'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678','22222222-2222-4222-8222-000000000001');

INSERT INTO linddun_ameaca (threat_model_id, categoria, ameaca, mitigacao, severidade, implementada) VALUES
  ('88888888-8888-4888-8888-000000000001','identifiability','CPF em texto claro no prompt enviado ao LLM externo','Pseudonimização HMAC pré-prompt com chave no KMS','critica',true),
  ('88888888-8888-4888-8888-000000000001','linkability','Correlação entre pseudônimos de homologação e produção','Sal descartável por ambiente e por finalidade','alta',true),
  ('88888888-8888-4888-8888-000000000001','disclosure','API devolve renda e score em rota de perfil','DTO por escopo com allowlist de campos','alta',true),
  ('88888888-8888-4888-8888-000000000001','detectability','404 vs 403 revela existência de CPF na base','Resposta 404 uniforme para não encontrado e não autorizado','media',true),
  ('88888888-8888-4888-8888-000000000001','non_repudiation','Ausência de log de quem reidentificou um pseudônimo','audit_log append-only com hash encadeado e finalidade obrigatória','alta',true),
  ('88888888-8888-4888-8888-000000000001','unawareness','Titular não sabe que a decisão foi automatizada','Explicação com SHAP e link de revisão na tela de resultado','alta',false),
  ('88888888-8888-4888-8888-000000000001','non_compliance','Retenção do histórico sem prazo definido','TTL de 180 dias com job de expurgo diário e evidência de hash','media',true);

-- ---------- gates de CI/CD --------------------------------------------------
INSERT INTO gate_run (id, tenant_id, sistema_id, workflow, pr_numero, pr_titulo, pr_autor, head_sha, conclusao, bloqueou_merge, run_url, iniciado_em, concluido_em) VALUES
  ('99999999-9999-4999-8999-000000000001','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001','privacy-ci-gate',1234,'feat: scoring v2 com LLM','@maria.silva','a1b2c3d','failure',true,'https://github.com/danzeroum/credit-scoring/actions/runs/1234', now() - INTERVAL '4 hours', now() - INTERVAL '3 hours 52 minutes'),
  ('99999999-9999-4999-8999-000000000002','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001','architecture-review',1234,'feat: scoring v2 com LLM','@maria.silva','a1b2c3d','action_required',true,'https://github.com/danzeroum/credit-scoring/actions/runs/1235', now() - INTERVAL '4 hours', now() - INTERVAL '3 hours 50 minutes'),
  ('99999999-9999-4999-8999-000000000003','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000002','privacy-ci-gate',88,'fix: máscara no formulário de cadastro','@pedro.lima','f7e6d5c','success',false,'https://github.com/danzeroum/onboarding/actions/runs/882', now() - INTERVAL '9 hours', now() - INTERVAL '8 hours 55 minutes'),
  ('99999999-9999-4999-8999-000000000004','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000003','privacy-ci-gate',307,'chore: nova coluna em fact_eventos','@squad-dados','c4d5e6f','neutral',false,'https://github.com/danzeroum/analytics/actions/runs/3071', now() - INTERVAL '6 hours', now() - INTERVAL '5 hours 58 minutes');

INSERT INTO gate_finding (gate_run_id, regra, arquivo, linha, severidade, mensagem_bruta, mensagem_humana, como_corrigir, padrao_casado) VALUES
  ('99999999-9999-4999-8999-000000000001','pii_em_log','src/models/credit_model.py',38,'critica',
   'Error: Process completed with exit code 1. grep matched ''(cpf|cnpj|cartao|email).*logger''',
   'Este PR envia CPF para o log da aplicação. Log é banco de dados pessoal: entra no ROPA e fica visível para todo mundo que acessa o Kibana.',
   'Passe a chamada pelo middleware privacy-redactor.ts ou logue o UUID do cliente em vez do CPF.','(cpf).*logger'),
  ('99999999-9999-4999-8999-000000000001','schema_sem_base_legal','.privacy/data-inventory.product.yaml',52,'alta',
   'ValidationError: field ''historico_compras'' missing required property ''base_legal''',
   'O campo historico_compras entrou no catálogo sem base legal. Sem isso ele não aparece no ROPA e a auditoria não consegue justificar o tratamento.',
   'Declare base_legal no YAML. Se for legítimo interesse, vincule uma LIA vigente na tela T8.',NULL),
  ('99999999-9999-4999-8999-000000000004','linddun_ausente','.privacy/threat-model.md',NULL,'baixa',
   'Warning: .privacy/threat-model.md not updated for changed paths',
   'A nova coluna mudou o fluxo de dados, mas o threat model continua na versão anterior.',
   'Abra a T3, revise as 6 categorias LINDDUN e gere o diagrama atualizado.',NULL);

-- ---------- RIPD -----------------------------------------------------------
INSERT INTO ripd (id, tenant_id, sistema_id, gate_run_id, codigo, titulo, pr_numero, contexto_escopo,
                  fora_de_escopo, fluxo_mermaid, risco_residual, status, bloqueia_merge, autor_id, reavaliar_em) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001',
   '99999999-9999-4999-8999-000000000002','RIPD-2026-014','Scoring de crédito v2 com LLM externo',1234,
   'API de scoring v2.3.1, frontend web v1.8.0, pipeline Airflow DAG-credit-v3 e serviço de decisão via OpenAI gpt-4o.',
   'App mobile v1.2.0 (não integra scoring nesta versão) e CRM de cobrança (ROPA próprio).',
   'graph LR; A[Form]-->B(API); B-->C[Pseudonimizador]; C-->D[OpenAI]; D-->E[(Decisões)];',
   'Após pseudonimização HMAC e SCC assinada, o risco residual de vazamento de CPF via prompt cai de 20 para 5 (probabilidade 1 × impacto 5). Aceito formalmente com reavaliação em 90 dias.',
   'em_revisao', true, '22222222-2222-4222-8222-000000000001', DATE '2026-10-26');

INSERT INTO ripd_trigger (ripd_id, gate_run_id, codigo, categoria, critico, evidencias) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','99999999-9999-4999-8999-000000000002','T1','dado_sensivel',true,'["CPF interpolado no prompt do LLM (src/models/credit_model.py:38)"]'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','99999999-9999-4999-8999-000000000002','T3','decisao_automatizada',true,'["Endpoint /creditos/avaliar retorna aprovado/reprovado"]'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','99999999-9999-4999-8999-000000000002','T6','nova_tecnologia',false,'["Dependência openai; modelo gpt-4o"]'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','99999999-9999-4999-8999-000000000002','T8','transferencia_internacional',false,'["Processamento em us-east-1"]');

INSERT INTO ripd_campo (ripd_id, campo_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','77777777-7777-4777-8777-000000000001'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','77777777-7777-4777-8777-000000000002'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','77777777-7777-4777-8777-000000000003'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','77777777-7777-4777-8777-000000000004');

INSERT INTO ripd_operacao (ripd_id, operacao, finalidade, base_legal, lia_id, dado_sensivel) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','POST /api/v1/auth/cadastrar','Criar conta','execucao_contrato',NULL,false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','POST /api/v1/creditos/avaliar','Decidir concessão de crédito','protecao_credito',NULL,false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','DAG credit-v3 · enriquecimento','Melhorar acurácia do modelo','legitimo_interesse','66666666-6666-4666-8666-000000000001',false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','GET /api/v1/me/dados','Direito de acesso do titular','obrigacao_legal',NULL,false);

INSERT INTO ripd_recomendacao (ripd_id, prioridade, descricao, evidencia_esperada, dono_handle, prazo, concluida, concluida_em) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','P0','Pseudonimizar CPF com HMAC antes de qualquer envio ao LLM','Commit no PR #1234 + teste de integração verde','@eng-maria',DATE '2026-08-04',true, now() - INTERVAL '2 days'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','P0','Publicar endpoint de revisão de decisão automatizada','Rota /me/decisoes/{id}/revisao documentada no OpenAPI','@eng-maria',DATE '2026-08-11',false,NULL),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','P0','Assinar SCC da ANPD com a OpenAI','dpa/openai-scc.pdf versionado com hash','@juridico-ana',DATE '2026-08-04',true, now() - INTERVAL '5 days'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','P1','Teste de disparate impact no pipeline do modelo','Job ci-disparate-test com limiar 0.8–1.2','@ml-joao',DATE '2026-08-18',false,NULL),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','P2','Diferencial privacy nas agregações de BI','Relatório com épsilon declarado','@squad-dados',DATE '2026-09-30',false,NULL);

-- ---------- matriz de risco (R1..R10 do risk-matrix.csv) --------------------
INSERT INTO risco (tenant_id, codigo, descricao, probabilidade, impacto, dano, dano_descricao, tratamento, tipo, esforco_sprints, dono_handle, dominio, prazo, reavaliacao, status, ripd_id) VALUES
 ('11111111-1111-4111-8111-111111111111','R1','Vazamento de CPF via prompt do LLM',4,5,'material','Crédito negado indevidamente e exposição do documento a terceiro fora do perímetro','Pseudonimização HMAC pré-prompt + SCC com a OpenAI','mitigar',1.0,'@eng-maria','engenharia',DATE '2026-08-15',DATE '2026-11-15','em_tratamento','aaaaaaaa-aaaa-4aaa-8aaa-000000000001'),
 ('11111111-1111-4111-8111-111111111111','R2','Decisão automatizada sem canal de revisão',3,5,'discriminacao','Discriminação algorítmica sem via de contestação (Art. 20)','Endpoint /revisao + teste de disparidade no CI','mitigar',2.0,'@dpo-marcela','dpo',DATE '2026-08-29',DATE '2026-11-29','em_tratamento','aaaaaaaa-aaaa-4aaa-8aaa-000000000001'),
 ('11111111-1111-4111-8111-111111111111','R3','Transferência internacional sem SCC válida',2,5,'perda_de_controle','Dado sai do país sem mecanismo do Art. 33','Contrato DPA + cláusulas-padrão da ANPD','mitigar',0.25,'@juridico-ana','juridico',DATE '2026-08-08',DATE '2026-11-08','mitigado',NULL),
 ('11111111-1111-4111-8111-111111111111','R4','Retenção além do necessário',4,3,'perda_de_controle','Acúmulo de PII sem finalidade ativa','TTL policies no PostgreSQL + job de expurgo diário','mitigar',1.0,'@sre-carlos','sre',DATE '2026-08-15',DATE '2026-11-15','mitigado',NULL),
 ('11111111-1111-4111-8111-111111111111','R5','PII em log de produção',5,3,'perda_de_controle','Exposição do titular em qualquer incidente de log','Middleware de redação + redator no Fluentd','mitigar',0.5,'@sre-lucas','sre',DATE '2026-08-01',DATE '2026-11-01','mitigado',NULL),
 ('11111111-1111-4111-8111-111111111111','R6','Tracking de terceiro ativado por padrão',3,4,'perda_de_controle','Rastreamento sem consentimento livre e informado','Feature flag default false + gate no CI','mitigar',1.0,'@eng-pedro','engenharia',DATE '2026-08-22',DATE '2026-11-22','em_tratamento',NULL),
 ('11111111-1111-4111-8111-111111111111','R7','Legítimo interesse sem LIA documentada',4,2,'perda_de_controle','Tratamento sem balanceamento demonstrável','Preencher e assinar LIA-SCORING-001','mitigar',0.5,'@dpo-marcela','dpo',DATE '2026-08-15',DATE '2026-11-15','mitigado',NULL),
 ('11111111-1111-4111-8111-111111111111','R8','Ausência de RLS no banco de clientes',2,5,'material','Conta comprometida acessa a base inteira','RLS por tenant + RBAC por finalidade','mitigar',2.0,'@seg-rita','seguranca',DATE '2026-08-29',DATE '2026-11-29','em_tratamento',NULL),
 ('11111111-1111-4111-8111-111111111111','R9','Revogação de consentimento sem cascata',3,4,'perda_de_controle','Titular revoga e o dado permanece nos sistemas a jusante','Job de eliminação por escopo + webhook a parceiros','mitigar',2.0,'@eng-maria','engenharia',DATE '2026-08-22',DATE '2026-11-22','aberto',NULL),
 ('11111111-1111-4111-8111-111111111111','R10','Backup sem criptografia gerenciada',1,5,'perda_de_controle','Perda irreversível e exposição do snapshot','Habilitar SSE-KMS nos snapshots do RDS','mitigar',1.0,'@sre-carlos','sre',DATE '2026-08-08',DATE '2026-11-08','mitigado',NULL);

INSERT INTO raci (tenant_id, processo, dominio, letra) VALUES
 ('11111111-1111-4111-8111-111111111111','Definição de base legal','DPO','A'),
 ('11111111-1111-4111-8111-111111111111','Definição de base legal','Jurídico','C'),
 ('11111111-1111-4111-8111-111111111111','Definição de base legal','Engenharia','I'),
 ('11111111-1111-4111-8111-111111111111','Definição de base legal','Produto','C'),
 ('11111111-1111-4111-8111-111111111111','LINDDUN / threat model','Engenharia','A'),
 ('11111111-1111-4111-8111-111111111111','LINDDUN / threat model','Segurança','C'),
 ('11111111-1111-4111-8111-111111111111','LINDDUN / threat model','DPO','C'),
 ('11111111-1111-4111-8111-111111111111','LIA','DPO','A'),
 ('11111111-1111-4111-8111-111111111111','LIA','Jurídico','C'),
 ('11111111-1111-4111-8111-111111111111','SCC / DPA com terceiros','Jurídico','A'),
 ('11111111-1111-4111-8111-111111111111','SCC / DPA com terceiros','DPO','C'),
 ('11111111-1111-4111-8111-111111111111','Controle técnico','Engenharia','A'),
 ('11111111-1111-4111-8111-111111111111','Controle técnico','Segurança','C'),
 ('11111111-1111-4111-8111-111111111111','Resposta a incidente','Segurança','A'),
 ('11111111-1111-4111-8111-111111111111','Resposta a incidente','DPO','C'),
 ('11111111-1111-4111-8111-111111111111','Atendimento a titular','DPO','A'),
 ('11111111-1111-4111-8111-111111111111','Atendimento a titular','Engenharia','C');

-- ---------- direitos do titular --------------------------------------------
INSERT INTO solicitacao_titular (tenant_id, protocolo, titular_pseudonimo, direito, status, nivel_verificacao, sistemas_alcancados, recebida_em, prazo_limite, concluida_em, responsavel_id) VALUES
 ('11111111-1111-4111-8111-111111111111','2026-0731','hmac:9f4c…a71b','acesso','em_analise',2,'{credit-scoring,onboarding,analytics}', now() - INTERVAL '11 days', now() + INTERVAL '3 days 4 hours', NULL,'22222222-2222-4222-8222-000000000002'),
 ('11111111-1111-4111-8111-111111111111','2026-0730','hmac:3b81…cc02','eliminacao','em_analise',3,'{onboarding}', now() - INTERVAL '14 days', now() + INTERVAL '19 hours', NULL,'22222222-2222-4222-8222-000000000002'),
 ('11111111-1111-4111-8111-111111111111','2026-0729','hmac:d20e…8f13','revisao_decisao','aguardando_titular',2,'{credit-scoring}', now() - INTERVAL '2 days', now() + INTERVAL '3 days', NULL,'22222222-2222-4222-8222-000000000002'),
 ('11111111-1111-4111-8111-111111111111','2026-0721','hmac:77aa…12de','portabilidade','concluida',2,'{credit-scoring,onboarding}', now() - INTERVAL '20 days', now() - INTERVAL '5 days', now() - INTERVAL '8 days','22222222-2222-4222-8222-000000000002'),
 ('11111111-1111-4111-8111-111111111111','2026-0718','hmac:11cd…90fa','correcao','concluida',2,'{onboarding}', now() - INTERVAL '25 days', now() - INTERVAL '10 days', now() - INTERVAL '23 days','22222222-2222-4222-8222-000000000002'),
 ('11111111-1111-4111-8111-111111111111','2026-0705','hmac:5e6f…33ab','confirmacao','concluida',1,'{credit-scoring}', now() - INTERVAL '30 days', now() - INTERVAL '15 days', now() - INTERVAL '30 days','22222222-2222-4222-8222-000000000002');

INSERT INTO solicitacao_mensagem (solicitacao_id, remetente, ator_id, corpo, enviada_em)
SELECT id,'titular',NULL,'Quero saber quais empresas receberam meus dados e por qual finalidade.', now() - INTERVAL '10 days'
FROM solicitacao_titular WHERE protocolo = '2026-0731';

INSERT INTO solicitacao_mensagem (solicitacao_id, remetente, ator_id, corpo, enviada_em)
SELECT id,'dpo','22222222-2222-4222-8222-000000000002','Recebido. Estou reunindo a linhagem completa nos três sistemas; retorno até 31/07 com a relação de destinatários e as finalidades.', now() - INTERVAL '9 days'
FROM solicitacao_titular WHERE protocolo = '2026-0731';

INSERT INTO revisao_decisao (solicitacao_id, decisao_externa_id, modelo_versao, decisao_original, shap_resumo)
SELECT id,'dec_9f21c7','credit-scoring v2.3.1', false,
       '{"top_features":[{"feature":"tempo_emprego","impacto":-0.34},{"feature":"score_serasa","impacto":-0.21},{"feature":"renda","impacto":0.12}]}'
FROM solicitacao_titular WHERE protocolo = '2026-0729';

-- ---------- consentimento como entidade -------------------------------------
-- Texto versionado, aceites por titular e uma revogação. O agregado
-- (`titulares: number`) não existe mais: a contagem sai daqui, somada.
INSERT INTO consentimento_texto (id, tenant_id, campo_id, versao, texto, texto_hash, validade, validade_fonte, publicado_em) VALUES
 ('cc000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','77777777-7777-4777-8777-000000000007','v2',
  'Autorizo o uso da minha imagem facial para verificacao de identidade na abertura de conta.',
  '9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b','P1Y',NULL, current_date - 400),
 ('cc000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','77777777-7777-4777-8777-000000000007','v3',
  'Autorizo o uso da minha imagem facial para prova de vida, com descarte em 30 dias.',
  '1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c','P1Y',NULL, current_date - 120),
 ('cc000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','77777777-7777-4777-8777-000000000006','v1',
  'Aceito receber comunicacoes transacionais por e-mail enquanto eu for cliente.',
  '3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d','indeterminado',
  'Adesao ao servico, revogavel a qualquer tempo (Art. 8, par. 5)', current_date - 200);

-- Três aceites: um ativo, um já vencido (aceitou o texto antigo há mais de um
-- ano) e um que será revogado logo abaixo.
INSERT INTO consentimento (id, tenant_id, titular_pseudonimo, texto_id, canal, coletado_em, prova_hash, validade) VALUES
 ('cd000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','hmac:9f4c…a71b',
  'cc000000-0000-4000-8000-000000000002','app', current_date - 30,'prova:9f4c','P1Y'),
 ('cd000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','hmac:3b81…cc02',
  'cc000000-0000-4000-8000-000000000001','app', current_date - 400,'prova:3b81','P1Y'),
 ('cd000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','hmac:d20e…8f13',
  'cc000000-0000-4000-8000-000000000003','web', current_date - 150,'prova:d20e','indeterminado');

-- Revogar é fato novo: o aceite acima continua ali, legível.
INSERT INTO consentimento_revogacao (id, consentimento_id, revogado_em, canal, motivo) VALUES
 ('ce000000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000003',
  now() - INTERVAL '26 hours','portal','Nao quero mais receber nada por e-mail.');

-- A cascata: cessação confirmada, expurgo pendente há 26 h — acima do limite de
-- 24 h, e portanto matéria de achado.
INSERT INTO revogacao_propagacao (revogacao_id, alvo, tipo, efeito, estado, iniciada_em, confirmada_em) VALUES
 ('ce000000-0000-4000-8000-000000000001','Onboarding e cadastro','cessacao',
  'Comunicacao transacional para este titular para imediatamente.','propagado',
  now() - INTERVAL '26 hours', now() - INTERVAL '26 hours'),
 ('ce000000-0000-4000-8000-000000000001','Eliminacao do que ja foi coletado','expurgo',
  'Os registros ja coletados entram no proximo expurgo, com prova de execucao.','pendente',
  now() - INTERVAL '26 hours', NULL);

-- ---------- expurgo ---------------------------------------------------------
-- `registros_total` saiu da tabela: o total vem de gov.expurgo_run_resumo,
-- somando os lotes. Contador diverge do que foi contado; soma, não.
INSERT INTO expurgo_run (id, tenant_id, data_referencia, origem, status, iniciado_em, concluido_em, relatorio_uri, relatorio_hash) VALUES
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','11111111-1111-4111-8111-111111111111', current_date,'cron','concluido', now() - INTERVAL '9 hours', now() - INTERVAL '8 hours 41 minutes','s3://gov-docs/expurgo/2026-07-28.pdf','c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002','11111111-1111-4111-8111-111111111111', current_date - 1,'cron','concluido', now() - INTERVAL '33 hours', now() - INTERVAL '32 hours 44 minutes','s3://gov-docs/expurgo/2026-07-27.pdf','e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000003','11111111-1111-4111-8111-111111111111', current_date - 2,'cron','parcial', now() - INTERVAL '57 hours', now() - INTERVAL '56 hours 30 minutes',NULL,NULL);

INSERT INTO expurgo_entrada (expurgo_run_id, sistema_slug, tabela, campo_tipo, metodo, registros, campo_id, lote_chave, ids_afetados_hash, hash_pre, hash_pos, verificado_em, verificado_por, integro) VALUES
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','credit-scoring','decisoes_ia','shap_values','hard_delete',8120,'77777777-7777-4777-8777-000000000005','lote:d1:decisoes_ia:0','sha256:41ab…9d0e','a3f19c2b4d6e8f0a1b3c5d7e9f1a3b5c','7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b', now() - INTERVAL '8 hours','22222222-2222-4222-8222-000000000003',true),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','credit-scoring','historico_compras','pseudonimizado','crypto_shredding',6301,'77777777-7777-4777-8777-000000000004','lote:d1:historico_compras:0','sha256:88cd…14fa','b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5','1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b', now() - INTERVAL '8 hours','22222222-2222-4222-8222-000000000003',true),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','onboarding','biometria_facial','sensivel','crypto_shredding',411,'77777777-7777-4777-8777-000000000007','lote:d1:biometria_facial:0','sha256:c1e2…77bb','d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7','3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d', now() - INTERVAL '8 hours','22222222-2222-4222-8222-000000000003',true),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','analytics','eventos_brutos','pessoal','compactacao_log',3600,NULL,'lote:d1:eventos_brutos:0','sha256:02fa…3c9d','f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1','5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f',NULL,NULL,NULL),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002','credit-scoring','decisoes_ia','shap_values','hard_delete',9902,'77777777-7777-4777-8777-000000000005','lote:d2:decisoes_ia:0','sha256:7ab1…55ce','c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9','9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f', now() - INTERVAL '32 hours','22222222-2222-4222-8222-000000000003',true),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002','onboarding','cadastros','pessoal','anonimizacao',7208,NULL,'lote:d2:cadastros:0','sha256:9d0e…41ab','e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1','b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9', now() - INTERVAL '32 hours','22222222-2222-4222-8222-000000000003',true);

-- ---------- KMS -------------------------------------------------------------
INSERT INTO kms_chave (id, tenant_id, alias, arn, finalidade, status, criada_em, rotacao_prevista, suporta_cripto_shredding) VALUES
 ('cccccccc-cccc-4ccc-8ccc-000000000001','11111111-1111-4111-8111-111111111111','alias/credit-pii-v3','arn:aws:kms:us-east-1:0000:key/v3','credito_pii','ativa', now() - INTERVAL '80 days', current_date + 10, true),
 ('cccccccc-cccc-4ccc-8ccc-000000000002','11111111-1111-4111-8111-111111111111','alias/credit-pii-v4','arn:aws:kms:us-east-1:0000:key/v4','credito_pii_next','canary', now() - INTERVAL '6 days', current_date + 84, true),
 ('cccccccc-cccc-4ccc-8ccc-000000000003','11111111-1111-4111-8111-111111111111','alias/onboarding-bio-v2','arn:aws:kms:us-east-1:0000:key/bio2','biometria','ativa', now() - INTERVAL '40 days', current_date + 50, true),
 ('cccccccc-cccc-4ccc-8ccc-000000000004','11111111-1111-4111-8111-111111111111','alias/backup-rds-v1','arn:aws:kms:us-east-1:0000:key/bkp1','backup','ativa', now() - INTERVAL '200 days', current_date + 5, false),
 ('cccccccc-cccc-4ccc-8ccc-000000000005','11111111-1111-4111-8111-111111111111','alias/credit-pii-v2','arn:aws:kms:us-east-1:0000:key/v2','credito_pii_legado','revogada', now() - INTERVAL '400 days', current_date - 90, true);

INSERT INTO kms_dependencia (chave_id, sistema_id, dataset_id) VALUES
 ('cccccccc-cccc-4ccc-8ccc-000000000001','33333333-3333-4333-8333-000000000001','55555555-5555-4555-8555-000000000001'),
 ('cccccccc-cccc-4ccc-8ccc-000000000001','33333333-3333-4333-8333-000000000001','55555555-5555-4555-8555-000000000002'),
 ('cccccccc-cccc-4ccc-8ccc-000000000003','33333333-3333-4333-8333-000000000002','55555555-5555-4555-8555-000000000003');

INSERT INTO kms_rotacao (id, chave_nova_id, chave_antiga_id, workflow_run_url, status, iniciada_em) VALUES
 ('dddddddd-dddd-4ddd-8ddd-000000000001','cccccccc-cccc-4ccc-8ccc-000000000002','cccccccc-cccc-4ccc-8ccc-000000000001','https://github.com/danzeroum/infra/actions/runs/9910','em_andamento', now() - INTERVAL '6 days');

INSERT INTO kms_rotacao_etapa (rotacao_id, etapa, ordem, status, progresso, detalhe, iniciada_em, concluida_em) VALUES
 ('dddddddd-dddd-4ddd-8ddd-000000000001','gerar',1,'concluida',100,'Chave v4 criada em us-east-1', now() - INTERVAL '6 days', now() - INTERVAL '6 days'),
 ('dddddddd-dddd-4ddd-8ddd-000000000001','parameter_store',2,'concluida',100,'SecureString /prod/privacy/data-key atualizada', now() - INTERVAL '6 days', now() - INTERVAL '6 days'),
 ('dddddddd-dddd-4ddd-8ddd-000000000001','canary_5',3,'concluida',100,'5% do tráfego por 48h sem erro de decrypt', now() - INTERVAL '6 days', now() - INTERVAL '4 days'),
 ('dddddddd-dddd-4ddd-8ddd-000000000001','recriptografar',4,'executando',63.4,'1.187.402 de 1.873.900 registros re-envelopados', now() - INTERVAL '4 days', NULL),
 ('dddddddd-dddd-4ddd-8ddd-000000000001','revogar_antiga',5,'pendente',0,'Agendada para 30 dias após o fim da re-encriptação', NULL, NULL);

INSERT INTO kms_acesso (chave_id, principal, operacao, finalidade, origem_ip, autorizado, ocorrido_em) VALUES
 ('cccccccc-cccc-4ccc-8ccc-000000000001','arn:aws:iam::0000:role/scoring-svc','Decrypt','credito_pii','10.4.2.11',true, now() - INTERVAL '20 minutes'),
 ('cccccccc-cccc-4ccc-8ccc-000000000001','arn:aws:iam::0000:role/scoring-svc','GenerateDataKey','credito_pii','10.4.2.11',true, now() - INTERVAL '35 minutes'),
 ('cccccccc-cccc-4ccc-8ccc-000000000003','arn:aws:iam::0000:user/estagiario.dev','Decrypt','biometria','189.22.7.90',false, now() - INTERVAL '2 hours'),
 ('cccccccc-cccc-4ccc-8ccc-000000000004','arn:aws:iam::0000:role/rds-backup','Encrypt','backup','10.4.9.3',true, now() - INTERVAL '5 hours');

-- ---------- métricas e maturidade ------------------------------------------
INSERT INTO metric_snapshot (tenant_id, metrica, valor, unidade, meta, coletado_em) VALUES
 ('11111111-1111-4111-8111-111111111111','ropa_cobertura',85.7,'percentual',90, now() - INTERVAL '1 day'),
 ('11111111-1111-4111-8111-111111111111','ropa_cobertura',78.6,'percentual',90, now() - INTERVAL '31 days'),
 ('11111111-1111-4111-8111-111111111111','base_legal_documentada',94.3,'percentual',95, now() - INTERVAL '1 day'),
 ('11111111-1111-4111-8111-111111111111','base_legal_documentada',89.8,'percentual',95, now() - INTERVAL '31 days'),
 ('11111111-1111-4111-8111-111111111111','sla_titular_horas',34.0,'horas',120, now() - INTERVAL '1 day'),
 ('11111111-1111-4111-8111-111111111111','sla_titular_horas',41.5,'horas',120, now() - INTERVAL '31 days'),
 ('11111111-1111-4111-8111-111111111111','logs_sem_pii',92.0,'percentual',95, now() - INTERVAL '1 day'),
 ('11111111-1111-4111-8111-111111111111','logs_sem_pii',88.0,'percentual',95, now() - INTERVAL '31 days'),
 ('11111111-1111-4111-8111-111111111111','ripd_pendentes',3,'contagem',5, now() - INTERVAL '1 day'),
 ('11111111-1111-4111-8111-111111111111','ripd_pendentes',6,'contagem',5, now() - INTERVAL '31 days'),
 ('11111111-1111-4111-8111-111111111111','deteccao_incidente_horas',2.1,'horas',1, now() - INTERVAL '1 day'),
 ('11111111-1111-4111-8111-111111111111','acessos_privilegiados_revisados',91.1,'percentual',100, now() - INTERVAL '1 day'),
 ('11111111-1111-4111-8111-111111111111','cobertura_treinamento',76.0,'percentual',90, now() - INTERVAL '1 day');

INSERT INTO maturidade (tenant_id, dominio, score, score_anterior, avaliado_em, evidencias) VALUES
 ('11111111-1111-4111-8111-111111111111','governar',3.0,2.0, current_date,'["RACI publicado","Comitê mensal com ata"]'),
 ('11111111-1111-4111-8111-111111111111','identificar',4.0,3.0, current_date,'["ROPA gerado do catálogo em 12 de 14 sistemas","Linhagem em 2 pipelines"]'),
 ('11111111-1111-4111-8111-111111111111','controlar',3.0,3.0, current_date,'["TTL em 83 de 88 datasets","RLS pendente no core"]'),
 ('11111111-1111-4111-8111-111111111111','comunicar',2.0,2.0, current_date,'["Portal de direitos em produção","Aviso de privacidade sem versionamento"]'),
 ('11111111-1111-4111-8111-111111111111','proteger',3.0,2.0, current_date,'["Envelope encryption com KMS","Rotação trimestral automatizada"]');

-- ---------- audit trail (o hash é calculado pelo trigger) -------------------
INSERT INTO audit_log (tenant_id, ator_id, ator_tipo, acao, recurso_tipo, recurso_id, finalidade, base_legal, campos, justificativa, ip, resultado) VALUES
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000002','dpo','TITULAR_CONSULTADO','solicitacao','2026-0731','atendimento','obrigacao_legal','{nome,email}','Atendimento ao protocolo 2026-0731 (direito de acesso)','10.4.1.20','sucesso'),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000002','dpo','CAMPO_REVELADO','campo','cpf','atendimento','obrigacao_legal','{cpf}','Confirmação de identidade para o protocolo 2026-0731','10.4.1.20','sucesso'),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000004','produto','CAMPO_REVELADO','campo','renda','marketing',NULL,'{renda}','Análise de segmento para campanha','10.4.3.71','negado'),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000009','system','EXPURGO_EXECUTADO','expurgo_run','bbbbbbbb-bbbb-4bbb-8bbb-000000000001',NULL,NULL,'{}',NULL,NULL,'sucesso'),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000003','seguranca','INTEGRIDADE_VERIFICADA','expurgo_run','bbbbbbbb-bbbb-4bbb-8bbb-000000000001',NULL,NULL,'{}',NULL,'10.4.8.5','sucesso'),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000001','engenharia','RIPD_SUBMETIDO','ripd','RIPD-2026-014',NULL,NULL,'{}',NULL,'10.4.2.9','sucesso'),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000003','seguranca','KMS_ACESSO_NEGADO','kms_chave','alias/onboarding-bio-v2',NULL,NULL,'{}',NULL,'189.22.7.90','negado');
