# RIPD — Relatório de Impacto à Proteção de Dados

**Sistema:** Lastro — plataforma de governança de privacidade (protótipo de referência)
**Repositório:** `danzeroum/privacidade` · commit `8d0548a` · 2026-07-29
**Fundamento:** Art. 38 da Lei nº 13.709/2018 (LGPD)
**Status:** **Minuta — pendente de aprovação** (ver §8)
**Documento par:** [`RELATORIO-TECNICO-LGPD.md`](./RELATORIO-TECNICO-LGPD.md) — fichas completas dos 40 riscos citados como `Risco-NNN`

---

## 1. Executive Summary

### 1.1 O sistema e as finalidades de tratamento

O Lastro é uma **plataforma de governança de privacidade**: opera os artefatos de conformidade (catálogo/ROPA, RIPD, LIA, riscos, incidentes, solicitações de titulares, chaves, expurgo, auditoria) de uma organização que trata dados pessoais — nos cenários de demonstração, uma plataforma de crédito com IA, uma rede de varejo/farmácia e um serviço de streaming. Por decisão de arquitetura registrada (`docs/01-arquitetura.md:68-71`), a plataforma **não é fonte da verdade dos dados pessoais do produto**: trata metadados de governança e evidências. O tratamento próprio declarado (`.privacy/data-inventory.lastro.yaml`) é o do audit trail — pseudônimo do titular, nome do campo acessado, finalidade, justificativa redigida — sob **obrigação legal (Art. 7º, II c/c Art. 37)**.

O repositório é um **protótipo de referência**: app React com API simulada em memória, contrato OpenAPI e schema SQL como desenho da produção, gate de privacidade em CI, processos BPMN/DMN. Cinco papéis operam a interface (engenharia, DPO, produto, segurança, auditor externo); não há backend em execução nem dados reais — **toda a PII presente no fonte é massa fictícia de demonstração**.

### 1.2 Principais riscos e status de mitigação

A auditoria (metodologia no Relatório Técnico §2) consolidou **40 riscos**: 1 P0, 14 P1, 22 P2, 3 P3 — sendo 25 lacunas reais, 11 divergências documentação × código e 4 limitações estruturais de protótipo (tratadas como **premissas de aceite**, §7.3).

- **P0 (Risco-001):** o contrato de produção não tem rota de exercício para **nenhum** dos 10 direitos do titular que ele próprio enumera — inclusive o canal de oposição citado na LIA vigente. Análise de sanção no §7.2.
- **Padrões P1:** o mock implementa o que o contrato e o schema de produção não materializam (consentimento, incidentes, revisão Art. 20); promessas de segurança sem instrumento (X-Purpose, MFA, HMAC com chave em KMS); o aparato de fiscalização não se autofiscaliza (gate varre 1 arquivo, cadeia de hash não cobre o campo mais sensível, main vermelha sem required checks); retenção sem motor de execução.
- **Status de mitigação:** nenhum dos 40 riscos está mitigado nesta data; todos têm recomendação técnica concreta no Relatório Técnico §4. **38 dos 43 achados da rodada anterior de auditoria estão corrigidos com teste** — o histórico demonstra capacidade real de correção.

**Conclusão:** o desenho conceitual é maduro e acima da média (privacy by default, prova executável, fail-closed). O sistema **não está apto a produção** enquanto o P0 e os P1 estruturais (Riscos 001–015) não forem tratados; a aprovação deste RIPD deve ser condicionada ao plano de ação do §7.

---

## 2. Inventário de Dados

### 2.1 Plano A — dados que a plataforma trata em produção (schema `db/schema.sql`)

| Dado | Onde | Classificação | Observação |
|---|---|---|---|
| `titular_hash` (HMAC do documento) | `audit_log`, `solicitacao_titular.titular_pseudonimo` | Pseudonimizado (Art. 12 — segue sendo dado pessoal) | Chave prometida no KMS; implementação atual diverge (Risco-013) |
| Nome do campo acessado, finalidade, justificativa redigida, cadeia de hash | `audit_log:743-766` | Metadado + texto pessoal | Justificativa é dado pessoal do operador; fora da cadeia de hash (Risco-004) |
| `ator.nome`, `ator.email`, `ator.subject_oidc` | `schema.sql:92-94` | **Pessoal — colaborador** | Sem finalidade/base/retenção declaradas (Risco-022) |
| `audit_log.ip`, `audit_log.user_agent` | `schema.sql:756-757` | Pessoal — colaborador | Append-only sem prazo (Risco-006) |
| `kms_acesso.principal`, `kms_acesso.origem_ip` | `schema.sql:697-700` | Pessoal — colaborador/serviço | Exibido em tela sem redação (Risco-021) |
| `gate_run.pr_autor`, `risco.dono_handle` | `schema.sql:275,407` | Pessoal — colaborador | Handles identificáveis |
| Corpo das mensagens titular↔DPO | `solicitacao_mensagem.corpo:580` | Pessoal — titular | CPF em claro bloqueado por constraint (`:584`); demais PII depende do redator (Risco-021) |

### 2.2 Plano B — catálogo dos cenários (dados do produto, não hospedados pela plataforma)

Campos registrados no ROPA sintético (`app/src/mock/scenarios.ts`), com classificação declarada:

- **Identificação/contato:** CPF, nome, e-mail, telefone, endereço.
- **Financeiros/comportamentais:** renda, score de crédito, histórico de compras, plano de assinatura.
- **Sensíveis (Art. 5º, II — `sensivel: true`, finalidades compatíveis vazias, não reveláveis):** biometria facial (`b-bio`), medicamento controlado/saúde (`v-saude`), afinidade de conteúdo por orientação sexual (`m-orientacao` — dado **inferido**, tratado como sensível: correto).
- **Criança/adolescente:** `perfil_infantil` (`m-menor`) sob consentimento — **sem modelagem do Art. 14** (Risco-016).
- **Decisão automatizada:** score com explicação SHAP e revisão humana (Art. 20) no mock.

### 2.3 Plano C — PII sintética presente no fonte do repositório

Contagens reproduzíveis (E5, Relatório Técnico §2.2): **40 CPFs formatados fictícios em 7 arquivos** (9 titulares completos com nome/e-mail/telefone/endereço em `app/src/mock/scenarios.ts`; 4 no `prototipo/index.html` em atributos `data-value`; demais em testes e docs), 1 CPF sem máscara em `db/tests.sql:146`, operadores fictícios, 1 IP público roteável usado como exemplo (`db/seed.sql:254`). Nada disso é dado real; o risco associado é o de **hábito e de cegueira do gate** (Riscos 003, 030, 040) — nenhum valor é transcrito neste documento.

### 2.4 Fluxos

1. **Ingestão:** inventário versionado no repositório → validação em CI (`privacy-ci-gate.yml`) → catálogo (T2). Campo sem finalidade/base é recusado na validação (ponto forte).
2. **Acesso/revelação:** finalidade obrigatória → confronto com o catálogo → justificativa ≥ 20 caracteres → **registro antes da resposta** (falha ⇒ 503) → valor exposto por 60 s.
3. **Expurgo:** executor **externo ao repositório**; a plataforma registra a evidência pós-fato (Risco-006).
4. **Transferências internacionais (cenários):** OpenAI e SendGrid (EUA), Meta Ads, Google Ad Manager, Nielsen — o schema **bloqueia compartilhamento internacional sem mecanismo** (`transferencia_exige_mecanismo`, `schema.sql:204-207`, Art. 33); a vigilância do DPA vencido não existe (Risco-008). Nenhum dado sensível tem compartilhamento externo nos cenários.

---

## 3. Bases Legais

Mapeamento finalidade → base → artigo, com a justificativa e a lacuna encontrada:

| Finalidade | Base legal | Artigo | Situação verificada |
|---|---|---|---|
| Audit trail da própria plataforma | Obrigação legal | Art. 7º, II c/c Art. 37 | Declarada no inventário `.privacy/`; adequada. Resíduo: dado de colaborador no trail sem regime próprio (Risco-022) |
| Execução de contrato (produto) | Art. 7º, V | Art. 7º, V | Modelada no catálogo; DTOs por escopo limitam o excesso |
| Proteção ao crédito | Art. 7º, X | Art. 7º, X | Modelada nos cenários de crédito |
| Legítimo interesse | Art. 7º, IX | Art. 7º, IX c/c Art. 10 | **Forte:** campo sob LI sem LIA vigente é bloqueado por trigger (`schema.sql:528-530`); LIA vencida derruba a base. **Resíduo:** o balanceamento cita canal de oposição inexistente (Risco-001) e mitigações de equidade sem artefato (Risco-007) |
| Consentimento | Art. 7º, I c/c Art. 8º | Art. 7º, I; Art. 8º | Prova versionada e revogação propagante **no mock**; sem persistência por titular no contrato/schema de produção e sem cascata de eliminação (Risco-002) |
| Dado sensível | Art. 11 | Art. 11 | **Forte:** legítimo interesse × sensível bloqueado por constraint (`schema.sql:170-173`); sensível nunca revelável em tela; sem compartilhamento externo |
| Criança/adolescente | Consentimento (declarado) | **Art. 14 — não modelado** | `perfil_infantil` sem consentimento específico de responsável, sem registro vigente (Risco-016) |
| Pseudonimização/anonimização | — | Art. 12 | **Forte:** hash declarado como "anonimizado" é recusado por constraint (`:176-178`). **Resíduos:** HMAC prometido vs SHA-256 com sal público (Risco-013); "anonimizado" convivendo com base legal/LIA no catálogo (Risco-039) |

---

## 4. Medidas de Segurança

### 4.1 Implementado com prova executável

- **Privacy by default na interface:** mascaramento por padrão inclusive para DPO; controle sem permissão **não é renderizado** (`Permitido` → `null`); sensível sem botão de revelação (`primitivos.tsx:200-296`).
- **Controle de finalidade no mock:** revelação sem finalidade ⇒ 403 registrado; finalidade × catálogo; justificativa ≥ 20; posse do protocolo validada (`api.ts:152-234`).
- **Registro antes da resposta (Art. 37):** falha de log ⇒ 503 e nenhum valor sai; negativas também registradas.
- **Trail append-only com hash encadeado:** UPDATE/DELETE bloqueados por trigger; verificação recomputa a cadeia e detecta adulteração **mesmo com o trigger desligado** (`db/tests.sql:163-166`).
- **Redator de PII pré-append** em 12 pontos de escrita; prévia de redação na UI.
- **Anti-enumeração:** 404 uniforme; `totalItems` restrito; rate limit na busca; CPF hasheado no cliente; canal de mensagens recusa CPF em claro (constraint no banco).
- **Constraints de conformidade no schema:** Art. 11, Art. 12, Art. 18-VI (nível 3), Art. 20 (justificativa), Art. 33 (mecanismo de transferência), Art. 37 (finalidade no log), LIA vigente, RACI com um accountable, uma chave ativa por finalidade.
- **Gate de privacidade em CI fail-closed** (sem declaração ⇒ reprova; inventário ilegível ⇒ reprova) + checklist PbD com evidência obrigatória.
- **305 testes** cobrindo as invariantes acima (9 regras LGPD nomeadas, conformidade BPMN/DMN ↔ runtime bidirecional).

### 4.2 Declarado sem instrumento (mapa de resíduos)

| Medida prometida | Onde prometida | Realidade | Risco |
|---|---|---|---|
| `X-Purpose` obrigatório em toda rota de titular | `openapi.yaml:10` | 1 de 25 operações | Risco-011 |
| MFA / step-up para escopo interno e eliminação | `01-arquitetura.md:143`; `ator.mfa_ativo`; nível 3 | Nenhuma instrumentação | Risco-014 |
| HMAC-SHA256 com chave no KMS | `seed.sql`, schema, docs | SHA-256 com sal público no bundle | Risco-013 |
| k-anonimato k≥5 em séries; `data-hj-suppress` | `01-arquitetura.md:136,144` | Não implementados | Risco-031 |
| CSP/SRI/headers | Checklist PbD | Ausentes em todas as superfícies | Risco-019 |
| Imutabilidade ampla da evidência | Doutrina do repo | `bloqueia_mutacao` em 3 tabelas; `GRANT UPDATE` amplo; RLS sem `FORCE` | Risco-024 |
| Gate que "prova que o repositório não publica dado pessoal" | `privacy-ci-gate.yml:4` | Varre 1 arquivo; regex estreita; valida só `nome` | Riscos 003, 020, 025 |

---

## 5. Retenção e Expurgo

**Diagnóstico:** a retenção é declarativa, não estrutural (Risco-006). O domínio `retencao` existe **apenas** na tabela `campo` (rótulos como "5 anos", "indeterminado"); não há `retencao_ate` (data absoluta) em nenhuma das 39 tabelas; não há TTL, `pg_cron`, particionamento por data nem função de expurgo; `expurgo_run`/`expurgo_entrada` registram **pós-fato** o que um executor externo (não versionado no repositório) declara ter feito. O `audit_log` acumula IP/user-agent/justificativa **sem prazo e sem via de eliminação** — o checklist exige logs operacionais 30 dias e auditoria 5 anos sem PII. Backup: chave segregada existe como registro, mas sem cripto-shredding, sem TTL de snapshot e sem destruição auditada (Risco-023). Documentos e evidências PbD narram TTL/expurgo como operantes (Risco-032).

**Plano exigido (condição de produção):** (1) `retencao_ate` calculada na ingestão + job diário com evidência de hash pré/pós; (2) prazo e regime de eliminação para `audit_log` (expurgo dos campos de PII do operador preservando a cadeia); (3) executor de expurgo versionado e testado; (4) ciclo de backup com destruição auditada. Detalhes por risco no Relatório Técnico §4 (Riscos 006, 022, 023, 024, 032).

---

## 6. Direitos dos Titulares

### 6.1 O que existe

O **lado interno** (balcão do DPO) é real no mock: fila de protocolos com SLA, conclusão com desfecho registrado, recusa somente com fundamento legal (Art. 18 §4º), revisão de decisão automatizada com prova imutável (Art. 20), canal de mensagens que recusa CPF, incidente Art. 48 com fundamento obrigatório inclusive para não comunicar. O schema exige verificação nível 3 para eliminação (Art. 18, VI).

### 6.2 O que falta — por inciso do Art. 18

| Direito (Art. 18) | Endpoint no contrato | Status |
|---|---|---|
| I — Confirmação de tratamento | — | **Inexistente** (Risco-001) |
| II — Acesso aos dados | — | **Inexistente** (Risco-001) |
| III — Correção | — | **Inexistente** (Risco-001) |
| IV — Anonimização/bloqueio/eliminação de excessivos | — | **Inexistente** (Risco-001) |
| V — Portabilidade | — | **Inexistente** (Risco-001) |
| VI — Eliminação | — (nível 3 existe como dado; sem rota) | **Inexistente** (Riscos 001, 027) |
| VII — Informação sobre compartilhamentos | — (existe na ficha interna) | **Sem canal do titular** |
| VIII — Revogação do consentimento | — (mock revoga por campo, não por titular) | **Inexistente no contrato** (Riscos 001, 002) |
| IX — Oposição (Art. 18 §2º) | Citado na LIA; rota inexistente | **Inexistente** (Risco-001) |
| Art. 20 — Revisão de decisão automatizada | Mock sim; contrato não; recomendação P0 do próprio RIPD do cenário pendente | **Inexistente no contrato** (Riscos 001, 034) |

Regra do checklist aplicada: **direito sem endpoint com prazo, autenticação e log não existe no sistema.** Complementos: o processo de solicitação não tem etapa de verificação de identidade nem ator titular (Risco-009); a eliminação não tem vínculo verificável com o expurgo que a materializa (Risco-027).

---

## 7. Riscos Residuais

### 7.1 Tabela consolidada (40 riscos)

Nenhum risco está mitigado nesta data. Fichas completas com recomendação técnica no Relatório Técnico §4.

| ID | Risco | Sev. | Classe | Status | Plano de ação |
|---|---|---|---|---|---|
| Risco-001 | Direitos do titular sem rota de exercício no contrato de produção | P0 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-001 |
| Risco-002 | Consentimento sem persistência por titular no desenho de produção; revogação sem cascata de eliminação | P1 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-002 |
| Risco-003 | Gate de privacidade cego: varre 1 arquivo do repositório e aprova com 40 CPFs formatados publicados em 7 arquivos | P1 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-003 |
| Risco-004 | Cadeia de hash do audit trail não cobre justificativa nem base legal — o campo mais exposto é adulterável sem detecção | P1 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-004 |
| Risco-005 | Governança de mudança rompida: upload manual reverteu PR revisado, a main está vermelha e nenhum workflow é required status check | P1 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-005 |
| Risco-006 | Retenção existe só como rótulo: sem retencao_ate, sem TTL, sem executor de expurgo — e o audit_log não tem prazo definido | P1 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-006 |
| Risco-007 | Equidade algorítmica só declarada: teste de disparidade, remoção de proxies e AIA sem artefato executável ou versionado | P1 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-007 |
| Risco-008 | Fornecedor não é entidade: DPA sem validação programática, expiração sem vigilância, sem chave por parceiro nem revogação com SLA | P1 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-008 |
| Risco-009 | Processo de solicitação do titular sem etapa de verificação de identidade e sem ator titular | P1 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-009 |
| Risco-010 | Prazo de comunicação à ANPD sem relógio: nenhum artefato conhece o prazo do Art. 48 | P1 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-010 |
| Risco-011 | X-Purpose é regra global em prosa, mas instrumentado em 1 de 25 operações do contrato; propósito autodeclarado | P1 | Divergência | Aberto | Recomendação definida no Relatório Técnico §4, Risco-011 |
| Risco-012 | GET /titulares/{id} devolve a ficha do titular sem finalidade e sem gravar no trail | P1 | Divergência | Aberto | Recomendação definida no Relatório Técnico §4, Risco-012 |
| Risco-013 | Pseudonimização prometida como HMAC com chave no KMS é SHA-256 com sal público constante no bundle | P1 | Divergência | Aberto | Recomendação definida no Relatório Técnico §4, Risco-013 |
| Risco-014 | MFA/step-up prometidos em docs, schema e contrato sem nenhuma instrumentação | P1 | Divergência | Aberto | Recomendação definida no Relatório Técnico §4, Risco-014 |
| Risco-015 | Fluxo de incidente (Art. 48) existe só no protótipo: sem tabela incidente no schema e sem rota no contrato | P1 | Divergência | Aberto | Recomendação definida no Relatório Técnico §4, Risco-015 |
| Risco-016 | Art. 14 não modelado: perfil infantil sob consentimento sem registro vigente e sem responsável identificado | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-016 |
| Risco-017 | Anti-enumeração e cotas incompletas: sem paginação/hard limit nas coleções, IDs sequenciais como oráculo e rate limit só na busca | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-017 |
| Risco-018 | Cinco endpoints de ingestão de CI sem identidade de máquina, assinatura HMAC, idempotência ou proteção de replay | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-018 |
| Risco-019 | Nenhuma CSP nem cabeçalho de segurança em nenhuma superfície HTML | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-019 |
| Risco-020 | O gate retranscreve o valor de PII encontrado — no finding enviado ao contrato e no terminal do CI | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-020 |
| Risco-021 | Redator não cobre nome, endereço, RG, data de nascimento nem IP — e a massa exibe endereço e IP sem redação | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-021 |
| Risco-022 | Dado pessoal de colaborador fora do regime: sem finalidade/base/retenção no schema e isento do catálogo por exceção do gate | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-022 |
| Risco-023 | Ciclo de vida do backup incompleto: chave sem cripto-shredding, sem TTL de snapshot e sem destruição auditada | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-023 |
| Risco-024 | A prova do expurgo e o espelho do KMS são mutáveis: bloqueia_mutacao cobre 3 tabelas e gov_app tem UPDATE em todas | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-024 |
| Risco-025 | O inventário do próprio repositório é subconjunto pobre do modelo que o repositório prega — e o gate valida só o nome do campo | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-025 |
| Risco-026 | Controles de LLM externo sem verificação executável: SHAP sem PII por comentário, auditoria por execução e não por chamada | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-026 |
| Risco-027 | Eliminação sem vínculo verificável entre a solicitação do titular e o expurgo que a materializa | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-027 |
| Risco-028 | Plano de resposta a incidente como runbook testável não existe: o BPMN é máquina de estados, não plano | P2 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-028 |
| Risco-029 | /pseudonyms/resolve: contrato e implementação divergem em corpo, códigos e no vínculo de posse | P2 | Divergência | Aberto | Recomendação definida no Relatório Técnico §4, Risco-029 |
| Risco-030 | Protótipo estático contradiz a doutrina do repositório: PII em claro no DOM, registro prometido e não feito, gate por CSS, busca inerte | P2 | Divergência | Aberto | Recomendação definida no Relatório Técnico §4, Risco-030 |
| Risco-031 | Promessas de arquitetura sem instrumento no app: k-anonimato (k≥5) e data-hj-suppress | P2 | Divergência | Aberto | Recomendação definida no Relatório Técnico §4, Risco-031 |
| Risco-032 | Documentos e cenários afirmam TTL/expurgo operantes que o código não contém — inclusive como evidência verde do PbD | P2 | Divergência | Aberto | Recomendação definida no Relatório Técnico §4, Risco-032 |
| Risco-033 | READMEs negam o próprio repositório: “não há CI”, “26 testes”, “8 telas” | P2 | Divergência | Aberto | Recomendação definida no Relatório Técnico §4, Risco-033 |
| Risco-034 | Contrato OpenAPI congelado pré-correções: as rotas dos PRs 4–13 existem só no mock | P2 | Divergência | Aberto | Recomendação definida no Relatório Técnico §4, Risco-034 |
| Risco-035 | modoDemo=true embarcado por padrão mantém viva a rota de forja do trail e as afordâncias de ataque | P2 | Limitação de protótipo | Premissa de aceite | Condição de não-produção — ver §7.3 |
| Risco-036 | Feed ICS: credencial estática por papel em query string, segredo no bundle, assinatura truncada, sem expiração | P2 | Limitação de protótipo | Premissa de aceite | Condição de não-produção — ver §7.3 |
| Risco-037 | Sem autenticação real: papel por botão, sessão sem credencial — toda a matriz de acesso é cooperativa | P2 | Limitação de protótipo | Premissa de aceite | Condição de não-produção — ver §7.3 |
| Risco-038 | Documentos de handoff carregam terceiros ao abrir (unpkg com SRI; Google Fonts sem) — fornecedores sem DPA recebendo metadados | P3 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-038 |
| Risco-039 | Coerência do catálogo não forçada: “anonimizado” convive com base legal/LIA e a linhagem usa strings livres sem FK | P3 | Lacuna real | Aberto | Recomendação definida no Relatório Técnico §4, Risco-039 |
| Risco-040 | PII sintética completa embarca no bundle do cliente — e o comentário do código afirma o contrário | P3 | Limitação de protótipo | Premissa de aceite | Condição de não-produção — ver §7.3 |

### 7.2 Análise de sanção (Art. 52) — riscos P0

**Risco-001 — Direitos do titular sem rota de exercício.** Em produção como está, um universo de ~1,2 milhão de titulares sob scoring por legítimo interesse não teria como confirmar tratamento, acessar dados, opor-se ou pedir revisão da decisão automatizada — e o canal de oposição declarado na LIA vigente aponta para rota inexistente, o que fragiliza o próprio balanceamento que sustenta a base legal (Art. 10 c/c Art. 18 §2º). Exposição direta às sanções do **Art. 52**: advertência com prazo (inciso I); **multa simples de até 2% do faturamento do grupo no Brasil, limitada a R$ 50.000.000 por infração** (inciso II); publicização da infração (inciso IV); bloqueio ou eliminação dos dados a que se refere a infração (incisos V–VI). Agravantes prováveis (Art. 52 §1º): a recorrência documental — o RIPD do próprio cenário lista a rota de revisão do Art. 20 como recomendação P0 pendente — pesa contra a boa-fé; atenuante: a adoção comprovada de política de governança (Art. 52 §1º, IX) se o plano de ação for executado. **Condição de aceite: nenhum deploy de produção antes das rotas do Art. 18 existirem com prazo, autenticação e log.**

Os riscos P1 002–015, embora não classificados como P0 isoladamente, compõem o mesmo quadro sancionatório se concretizados em produção (Art. 52 aplica-se por infração): em particular Risco-002 (consentimento sem prova por titular — Art. 8º §§ 1º-2º), Risco-006 (retenção sem término — Art. 15-16), Risco-010 (prazo do Art. 48 sem relógio) e Risco-013 (pseudonimização mais fraca que a declarada — Art. 46).

### 7.3 Premissas de aceite (limitações de protótipo)

Quatro riscos são limitações estruturais do protótipo — não defeitos a "corrigir", mas **condições que precisam deixar de ser verdade antes de qualquer produção**:

| Risco | Limitação | Condição de não-produção |
|---|---|---|
| Risco-035 | `modoDemo=true` embarcado; rota de forja do trail viva | Nenhum build de produção pode conter a rota `/v1/audit/forjar` nem as afordâncias de ataque; amarrar a `import.meta.env` e testar o build |
| Risco-036 | Feed ICS com credencial em query string e segredo no bundle | Reemitir como token opaco por papel, com expiração e revogação, assinado no servidor |
| Risco-037 | Sem autenticação real (papel por botão) | OIDC real com MFA, claims de propósito revogáveis e sessão servidor antes de qualquer dado real |
| Risco-040 | PII sintética no bundle do cliente | Nenhum dado (nem fictício) embarcado; mock atrás de fronteira de rede real |

### 7.4 Prazo de reavaliação

Este RIPD deve ser reavaliado: (a) a cada release que toque contrato, schema ou gate; (b) na resolução do bloco P0/P1; (c) no máximo em **2027-01-29** (6 meses) — espelhando o campo `reavaliar_em` que o próprio schema do sistema exige dos RIPDs que gerencia.

---

## 8. Aprovação

| Papel | Nome | Assinatura | Data |
|---|---|---|---|
| **DPO (Encarregado)** | ____________________ | ____________________ | ___/___/______ |
| **Revisor de Engenharia** | ____________________ | ____________________ | ___/___/______ |
| **Segurança da Informação** | ____________________ | ____________________ | ___/___/______ |
| **Negócio/Produto** | ____________________ | ____________________ | ___/___/______ |

**Status:** minuta gerada por auditoria assistida por IA (Claude Code) com verificação adversarial — **pendente de validação humana do DPO e do Revisor de Engenharia**. As evidências são reproduzíveis (Relatório Técnico §2.2); a aprovação deste documento não substitui a execução do plano de ação do §7.

_Documento par: [`RELATORIO-TECNICO-LGPD.md`](./RELATORIO-TECNICO-LGPD.md)._
