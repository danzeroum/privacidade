# Relatório Técnico — Auditoria LGPD & Privacy by Design

**Sistema:** Lastro — plataforma de governança de privacidade (protótipo de referência)
**Repositório:** `danzeroum/privacidade` · commit auditado `8d0548a` · branch `claude/lgpd-privacy-design-audit-koy7cy`
**Data da auditoria:** 2026-07-29
**Norma de referência:** Lei nº 13.709/2018 (LGPD) e os 7 Princípios de Privacy by Design (Cavoukian)
**Documento par:** [`RIPD.md`](./RIPD.md) — Relatório de Impacto à Proteção de Dados, que consolida estes riscos com bases legais, medidas e riscos residuais

---

## 1. Sumário executivo

Esta auditoria varreu **todos os artefatos** do repositório — app React com API mock (`app/`), contrato OpenAPI (`api/openapi.yaml`), modelo de dados (`db/`), gate de CI de privacidade (`.privacy/` + `.github/workflows/`), processos BPMN/DMN (`docs/processos/`), documentação e protótipo estático — contra o checklist de 13 categorias de LGPD/PbD, com verificação adversarial de cada achado e reverificação individual dos 43 achados prévios de `docs/design_handoff_lastro_correcoes/ACHADOS.md`.

**Resultado: 40 riscos consolidados** (de 55 candidatos, após verificação adversarial e fusão de duplicatas):

| Severidade | Lacuna real | Divergência doc × código | Limitação de protótipo | **Total** |
|---|---|---|---|---|
| **P0** | 1 | — | — | **1** |
| **P1** | 9 | 5 | — | **14** |
| **P2** | 13 | 6 | 3 | **22** |
| **P3** | 2 | — | 1 | **3** |
| **Total** | **25** | **11** | **4** | **40** |

### O que o repositório faz bem

A auditoria registra, antes dos riscos, que o núcleo do protótipo pratica o que prega — e prova por teste: mascaramento por padrão inclusive para o DPO (`app/src/ui/primitivos.tsx:200-296`), dado sensível sem caminho de revelação (Art. 11), gravar-antes-de-responder com 503 em falha de log (Art. 37), 404 uniforme anti-oráculo, trail com hash encadeado e adulteração detectável mesmo com trigger desligado (`db/tests.sql:163-166`), redator de PII antes de todo append, constraints de banco que materializam Art. 11, 12, 18-VI, 20, 33 e 37, revogação de consentimento que propaga no mock, fluxo de incidente Art. 48 com fundamento obrigatório inclusive para *não* comunicar, e 305 testes verdes cobrindo essas invariantes. **Nenhum dado de titular real existe no repositório** — toda a PII encontrada é massa fictícia de demonstração.

### Os quatro padrões sistêmicos de risco

**1. A produção é de papel: o mock está à frente do contrato e do schema.** As correções dos 13 PRs (consentimento como prova, conclusão de solicitação, revisão Art. 20, incidentes) vivem em `app/src/mock/api.ts` — mas `api/openapi.yaml` e `db/schema.sql`, que são o desenho da produção, ficaram para trás: **não há rota de exercício de nenhum dos 10 direitos do titular** (Risco-001, o único P0 — a rota de oposição citada na própria LIA vigente não existe), não há tabela de consentimento (Risco-002), não há tabela nem rota de incidente (Risco-015), e as rotas dos PRs 4–13 existem só no mock (Risco-034). Pela régua do próprio checklist: *direito sem endpoint com prazo, autenticação e log não existe no sistema*.

**2. Promessa sem instrumento.** `X-Purpose` é obrigatório em prosa e instrumentado em 1 de 25 operações (Risco-011); o MFA/step-up prometido em três camadas não tem nenhuma instrumentação (Risco-014); a pseudonimização vendida como "HMAC com chave no KMS" é SHA-256 com sal público constante no bundle (Risco-013); k-anonimato k≥5 e `data-hj-suppress` são prometidos e não implementados (Risco-031); documentos citam TTL/expurgo operantes que o código não contém — inclusive como evidência "verde" do checklist PbD (Risco-032).

**3. O guardião não se vigia.** O gate de privacidade varre **1 arquivo** do repositório e aprova enquanto 40 CPFs formatados (fictícios) estão publicados em 7 arquivos (Risco-003); a cadeia de hash do trail não cobre justificativa nem base legal — o campo mais exposto é adulterável sem detecção (Risco-004); nenhum workflow era *required status check* e a main estava vermelha no commit auditado: o commit HEAD, um upload manual, reverteu um PR revisado e quebrou 4 testes sem que nada o impedisse (Risco-005 — parcialmente remediado logo após o corte da auditoria; ver o Adendo abaixo); o próprio gate retranscreve o valor de PII que encontra (Risco-020).

**4. Ciclo de vida sem motor.** Retenção existe só como rótulo: nenhuma coluna `retencao_ate`, nenhum TTL, nenhum executor de expurgo no repositório, e o `audit_log` guarda IP e user-agent sem prazo (Risco-006); a revogação de consentimento não dispara cascata de eliminação — o risco R9 do próprio seed está aberto (Risco-002); dado pessoal de colaborador fica fora do regime por desenho (Risco-022).

### Leitura recomendada

Desenvolvedores: seção 4 (fichas), na ordem dos IDs. Gestão/DPO: este sumário + RIPD §1 e §7. A seção 6 mostra que **38 dos 43 achados prévios estão corrigidos e testados** — o histórico de correção é real; os riscos deste relatório são o que a rodada anterior não cobria.

### Adendo pós-auditoria (2026-07-29, após o commit auditado)

Os achados e a numeração deste relatório estão **congelados no commit `8d0548a`**. Entre o corte da auditoria e a abertura do PR desta entrega, a `main` avançou 7 commits que alteram o estado de parte do Risco-005:

| Mudança na main | Efeito sobre a auditoria |
|---|---|
| `d4785f0` (#19) restaura o `MAPA-PROCESSOS.md` revertido pelo upload manual | Os 4 testes do bloco "PR 14" voltam a passar — o sub-item (a) do Risco-005 ("main vermelha") está **remediado**; a suíte completa está verde na main atual |
| `ca252ed` (#18) adiciona a tela **T11 · ciclo do achado** (571 linhas + 405 linhas de teste) | A faceta "MAPA promete T11 que não existe" do Risco-005 está **resolvida** |
| PRs-sonda #21–#25 ("sonda: verde, ramo defasado", "após Update branch") | Indicam **ruleset de proteção de branch** em vigor exigindo branch atualizado antes do merge (este PR ficou "behind" até o merge da main) — evidência comportamental de que a recomendação de *required checks* foi ao menos parcialmente adotada; a configuração não é verificável em arquivo do repositório |

**Permanecem em aberto** os demais sub-itens do Risco-005: (b) sem gitleaks/secret-scanning, CodeQL ou `npm audit`; (c) sem workflow com `schedule` para vencimentos (`dpa_expira_em`, `reavaliar_em`, `rotacao_prevista`); (d) `db/schema.sql`/`db/tests.sql` e `api/openapi.yaml` continuam fora do CI. Os demais 39 riscos não são afetados pelas mudanças da main: o diff `8d0548a..main` não toca `api/openapi.yaml`, `db/`, o gate nem o redator — as alterações em `app/src/` são aditivas (a mecânica do ciclo do achado da T11, incluindo verificação independente com recusa de auto-verificação e evidência com hash encadeado — novo `hashEncadeado` em `sha256.ts`; o `hashCpf` citado no Risco-013 está intocado).

### Adendo de reconciliação (2026-07-30)

O adendo acima cobre 7 commits e um risco. A série de remediação que veio depois avançou a `main` de `8d0548a`
até `3b25b46` e alterou o estado de **14** dos 40 riscos: 11 fechados, 3 parciais com resíduo nomeado. **Atualização:** com a AIA (`9614ab3`) o Risco-007 fechou, com o relógio (`e1a35df`) e as varreduras de segurança (`77afe42`) o Risco-005 fechou inteiro, e com o desligamento de parceiro (`c081ce8`, `55bb029`) o Risco-008 fechou. Com o README conferido contra o repositório (`89593bf`) o Risco-033 fechou também, e a conta passou a 15 fechados e 0 parciais.

A anotação não reescreve ficha nenhuma. Cada uma das 14 fichas do §4 ganhou uma linha **Fechado por**, com o
commit e o teste ou check que impede a reabertura; a tabela do §7.1 do RIPD ganhou a coluna equivalente, e o
§7.5 de lá descreve o método. Os achados continuam sendo o que a auditoria encontrou — reescrevê-los apagaria o
que a próxima passagem precisa comparar, e "estava assim" viraria afirmação sem lastro.

**O que os quatro padrões sistêmicos do §1 têm de novo:** o padrão 3 ("o guardião não se vigia") fechou por
inteiro — gate varrendo o repositório com o denominador impresso, cadeia cobrindo `justificativa` e `base_legal`,
valor de PII mascarado no achado, e três checks *required* na `main`. O padrão da promessa sem instrumento
fechou em cinco frentes (X-Purpose, retenção, DPA, disparidade e a AIA) e permanece em uma: **MFA sem fator
real** (Risco-014 — sem TOTP nem WebAuthn). A AIA era a última promessa desse padrão a virar artefato: `.privacy/aia-credit-scoring.md`
é conferida contra o modelo, os fatores, a massa medida e as rotas do Art. 20, e a D3 deixou de exigir uma análise que não existia.

**Um caso em que o commit e o código divergiam, e o código venceu:** `cada46c` traz "(Riscos 035, 037, 040)" no
assunto, e o **Risco-037 não fechou**. A catraca garante que a identidade fabricada não chega a um artefato de
produção; não cria autenticação. Está anotado assim nas duas tabelas.

---

## 2. Escopo e metodologia

### 2.1 Escopo

Todos os artefatos do repositório no commit `8d0548a`: `app/` (fonte, testes, gate), `api/openapi.yaml`, `db/` (schema, seed, testes SQL), `.privacy/` (inventário, épico PbD, exemplos), `.github/workflows/`, `docs/` (arquitetura, wireframes, fluxo E2E, processos BPMN/DMN, handoff de design) e `prototipo/index.html`. Não há backend em execução — a análise de comportamento usa a API mock e a suíte de testes como oráculo, e o contrato + schema como desenho da produção.

### 2.2 Método

1. **Exploração**: três varreduras independentes (frontend; API/banco/CI; documentação/processos) mapearam mecanismos e candidatos.
2. **Evidências executáveis** (reproduzíveis; carimbo: commit `8d0548a`, 2026-07-29):
   - **E1** `cd app && npm ci` — ambiente reprodutível (Node 22).
   - **E2** `npm test` — **305 passam, 4 falham**; as 4 falhas são do bloco "PR 14 · verificação — o documento corresponde ao código?" e decorrem do commit HEAD ter sobrescrito `MAPA-PROCESSOS.md` (evidência do Risco-005).
   - **E3** `npm run gate:privacidade` — **aprovado**, saída: "1 arquivo(s) de log varrido(s). Nenhum achado." (evidência do Risco-003).
   - **E4** `git log --oneline --merges` — PRs 1–13 e #14–#17 mergeados; HEAD `8d0548a` "Add files via upload" alterou apenas 2 arquivos de docs (`git show --stat`).
   - **E5** greps reproduzíveis de PII (CPF formatado `\b\d{3}\.\d{3}\.\d{3}-\d{2}\b`, e-mail, telefone, 11 dígitos corridos) sobre `*.ts|*.tsx|*.sql|*.html|*.md` excluindo `node_modules` — 40 CPFs formatados em 7 arquivos; 1 CPF sem máscara em `db/tests.sql:146`; 2 telefones em `scenarios.ts`.
3. **Cinco lentes de auditoria** em paralelo, agrupadas por artefato (UI/consentimento; API/autenticação; dados/retenção/criptografia/catálogo; logging/gate/CI/incidentes; governança/ML/fornecedores/direitos/docs), cada uma obrigada a confirmar `arquivo:linha` no código atual e a declarar itens N/A com justificativa.
4. **Verificação adversarial cruzada**: cada candidato foi reverificado por um verificador independente que conferiu o fato no código, procurou correção já mergeada, e atacou classe, severidade e enquadramento legal. Dos 55 candidatos: 53 confirmados, 2 reclassificados, **0 falsos positivos**.
5. **Consolidação**: fusão de duplicatas entre lentes (10 fusões), numeração congelada `Risco-001…040` ordenada por severidade → classe → categoria.

### 2.3 Critérios

**Classes** — *Lacuna real*: falta/defeito com efeito se isto for a produção como está. *Divergência doc × código*: a documentação promete X e o código faz Y (ou vice-versa). *Limitação de protótipo*: limitação estrutural declarada do protótipo (sem backend, sem autenticação real); entra no RIPD §7 como premissa de aceite, não como defeito.

**Severidade** — *P0*: dano concreto plausível a titular ou exposição direta a sanção (Art. 52) em produção; *P1*: lacuna estrutural importante; *P2*: risco moderado; *P3*: higiene/observação.

**Regra de PII deste relatório**: nenhum valor de dado pessoal (mesmo fictício) é transcrito — apenas `arquivo:linha` e contagens.

---

## 3. Tabela-mestre dos riscos

| ID | Título | Categoria | Sev. | Classe | Localização principal |
|---|---|---|---|---|---|
| Risco-001 | Direitos do titular sem rota de exercício no contrato de produção | 12 | P0 | Lacuna real | `api/openapi.yaml` |
| Risco-002 | Consentimento sem persistência por titular no desenho de produção; revogação sem cascata de eliminação | 1, 8 | P1 | Lacuna real | `api/openapi.yaml` |
| Risco-003 | Gate de privacidade cego: varre 1 arquivo do repositório e aprova com 40 CPFs formatados publicados em 7 arquivos | 6 | P1 | Lacuna real | `app/src/lib/gate-privacidade.ts` |
| Risco-004 | Cadeia de hash do audit trail não cobre justificativa nem base legal — o campo mais exposto é adulterável sem detecção | 6 | P1 | Lacuna real | `app/src/mock/db.ts` |
| Risco-005 | Governança de mudança rompida: upload manual reverteu PR revisado, a main está vermelha e nenhum workflow é required status check | 6, 10 | P1 | Lacuna real | `.github/workflows/ci.yml` |
| Risco-006 | Retenção existe só como rótulo: sem retencao_ate, sem TTL, sem executor de expurgo — e o audit_log não tem prazo definido | 8, 6 | P1 | Lacuna real | `db/schema.sql` |
| Risco-007 | Equidade algorítmica só declarada: teste de disparidade, remoção de proxies e AIA sem artefato executável ou versionado | 10 | P1 | Lacuna real | `db/seed.sql` |
| Risco-008 | Fornecedor não é entidade: DPA sem validação programática, expiração sem vigilância, sem chave por parceiro nem revogação com SLA | 11 | P1 | Lacuna real | `db/schema.sql` |
| Risco-009 | Processo de solicitação do titular sem etapa de verificação de identidade e sem ator titular | 12 | P1 | Lacuna real | `docs/processos/solicitacao.bpmn` |
| Risco-010 | Prazo de comunicação à ANPD sem relógio: nenhum artefato conhece o prazo do Art. 48 | 13 | P1 | Lacuna real | `app/src/screens/T9.tsx` |
| Risco-011 | X-Purpose é regra global em prosa, mas instrumentado em 1 de 25 operações do contrato; propósito autodeclarado | 3 | P1 | Divergência doc × código | `api/openapi.yaml` |
| Risco-012 | GET /titulares/{id} devolve a ficha do titular sem finalidade e sem gravar no trail | 3 | P1 | Divergência doc × código | `app/src/mock/api.ts` |
| Risco-013 | Pseudonimização prometida como HMAC com chave no KMS é SHA-256 com sal público constante no bundle | 3, 7 | P1 | Divergência doc × código | `app/src/lib/sha256.ts` |
| Risco-014 | MFA/step-up prometidos em docs, schema e contrato sem nenhuma instrumentação | 4 | P1 | Divergência doc × código | `docs/01-arquitetura.md` |
| Risco-015 | Fluxo de incidente (Art. 48) existe só no protótipo: sem tabela incidente no schema e sem rota no contrato | 13 | P1 | Divergência doc × código | `db/schema.sql` |
| Risco-016 | Art. 14 não modelado: perfil infantil sob consentimento sem registro vigente e sem responsável identificado | 2 | P2 | Lacuna real | `app/src/mock/scenarios.ts` |
| Risco-017 | Anti-enumeração e cotas incompletas: sem paginação/hard limit nas coleções, IDs sequenciais como oráculo e rate limit só na busca | 3 | P2 | Lacuna real | `api/openapi.yaml` |
| Risco-018 | Cinco endpoints de ingestão de CI sem identidade de máquina, assinatura HMAC, idempotência ou proteção de replay | 3 | P2 | Lacuna real | `api/openapi.yaml` |
| Risco-019 | Nenhuma CSP nem cabeçalho de segurança em nenhuma superfície HTML | 5 | P2 | Lacuna real | `app/index.html` |
| Risco-020 | O gate retranscreve o valor de PII encontrado — no finding enviado ao contrato e no terminal do CI | 6 | P2 | Lacuna real | `app/src/lib/gate-privacidade.ts` |
| Risco-021 | Redator não cobre nome, endereço, RG, data de nascimento nem IP — e a massa exibe endereço e IP sem redação | 6 | P2 | Lacuna real | `app/src/lib/redator.ts` |
| Risco-022 | Dado pessoal de colaborador fora do regime: sem finalidade/base/retenção no schema e isento do catálogo por exceção do gate | 6, 8 | P2 | Lacuna real | `db/schema.sql` |
| Risco-023 | Ciclo de vida do backup incompleto: chave sem cripto-shredding, sem TTL de snapshot e sem destruição auditada | 7 | P2 | Lacuna real | `db/seed.sql` |
| Risco-024 | A prova do expurgo e o espelho do KMS são mutáveis: bloqueia_mutacao cobre 3 tabelas e gov_app tem UPDATE em todas | 8 | P2 | Lacuna real | `db/schema.sql` |
| Risco-025 | O inventário do próprio repositório é subconjunto pobre do modelo que o repositório prega — e o gate valida só o nome do campo | 9 | P2 | Lacuna real | `.privacy/data-inventory.lastro.yaml` |
| Risco-026 | Controles de LLM externo sem verificação executável: SHAP sem PII por comentário, auditoria por execução e não por chamada | 10 | P2 | Lacuna real | `db/schema.sql` |
| Risco-027 | Eliminação sem vínculo verificável entre a solicitação do titular e o expurgo que a materializa | 12 | P2 | Lacuna real | `db/schema.sql` |
| Risco-028 | Plano de resposta a incidente como runbook testável não existe: o BPMN é máquina de estados, não plano | 13 | P2 | Lacuna real | `docs/processos/incidente.bpmn` |
| Risco-029 | /pseudonyms/resolve: contrato e implementação divergem em corpo, códigos e no vínculo de posse | 3 | P2 | Divergência doc × código | `api/openapi.yaml` |
| Risco-030 | Protótipo estático contradiz a doutrina do repositório: PII em claro no DOM, registro prometido e não feito, gate por CSS, busca inerte | 5 | P2 | Divergência doc × código | `prototipo/index.html` |
| Risco-031 | Promessas de arquitetura sem instrumento no app: k-anonimato (k≥5) e data-hj-suppress | 6 | P2 | Divergência doc × código | `docs/01-arquitetura.md` |
| Risco-032 | Documentos e cenários afirmam TTL/expurgo operantes que o código não contém — inclusive como evidência verde do PbD | 8 | P2 | Divergência doc × código | `.privacy/epico.yml` |
| Risco-033 | READMEs negam o próprio repositório: “não há CI”, “26 testes”, “8 telas” | 10 | P2 | Divergência doc × código | `README.md` |
| Risco-034 | Contrato OpenAPI congelado pré-correções: as rotas dos PRs 4–13 existem só no mock | 12 | P2 | Divergência doc × código | `api/openapi.yaml` |
| Risco-035 | modoDemo=true embarcado por padrão mantém viva a rota de forja do trail e as afordâncias de ataque | 3, 13 | P2 | Limitação de protótipo | `app/src/mock/db.ts` |
| Risco-036 | Feed ICS: credencial estática por papel em query string, segredo no bundle, assinatura truncada, sem expiração | 4 | P2 | Limitação de protótipo | `app/src/mock/calendario.ts` |
| Risco-037 | Sem autenticação real: papel por botão, sessão sem credencial — toda a matriz de acesso é cooperativa | 4 | P2 | Limitação de protótipo | `app/src/App.tsx` |
| Risco-038 | Documentos de handoff carregam terceiros ao abrir (unpkg com SRI; Google Fonts sem) — fornecedores sem DPA recebendo metadados | 5, 11 | P3 | Lacuna real | `docs/design_handoff_lastro_correcoes/support.js` |
| Risco-039 | Coerência do catálogo não forçada: “anonimizado” convive com base legal/LIA e a linhagem usa strings livres sem FK | 9, 2 | P3 | Lacuna real | `app/src/mock/scenarios.ts` |
| Risco-040 | PII sintética completa embarca no bundle do cliente — e o comentário do código afirma o contrário | 2, 5 | P3 | Limitação de protótipo | `app/src/mock/scenarios.ts` |

---

## 4. Fichas por risco

Uma ficha por risco, com os nove campos obrigatórios. Riscos que fundem achados de mais de uma lente indicam as facetas fundidas na descrição.

### Risco-001 — Direitos do titular sem rota de exercício no contrato de produção

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-001 |
| **Severidade** | P0 · Impacto Alto |
| **Categoria** | 12 · Direitos dos titulares |
| **Classe** | Lacuna real |
| **Localização** | `api/openapi.yaml:464-499, 537-540, 754-757`; `db/seed.sql:48, 155` |
| **Descrição** | O contrato OpenAPI declara o enum `direito` com 10 direitos (confirmacao, acesso, correcao, anonimizacao, bloqueio, eliminacao, portabilidade, compartilhamentos, revogacao, revisao_decisao — openapi.yaml:754-757), mas as únicas rotas da tag `direitos` que tocam solicitação são GET /requests (fila do DPO, :464) e POST /requests/{id}/messages (:480). Sub-itens: (1) não há POST /requests — solicitação não pode ser aberta pelo contrato; (2) nenhum dos 10 direitos tem endpoint de exercício com resposta específica (confirmação 200, acesso JSON, declaração completa 202+15 dias, eliminação com nível 3 — o nível existe como dado em :759-763, mas nenhuma rota o estabelece); (3) a rota de oposição POST /api/v1/titulares/me/oposicao, citada como canal na LIA vigente (seed.sql:48), não existe em contrato algum; (4) a rota /me/decisoes/{id}/revisao é recomendação P0 pendente do próprio RIPD (seed.sql:155) — a plataforma sabe que falta e o contrato não a entrega; (5) a segurança global é OIDC do SSO interno (sso.internal, :537-540) — não existe fluxo de autenticação de titular. Pela régua do checklist, direito sem endpoint com prazo, autenticação e log NÃO EXISTE no sistema. O lado DPO é forte (fila com SLA, conclusão com desfecho, revisão Art. 20 no mock), mas o titular não tem porta de entrada. |
| **Base legal violada** | Art. 18; Art. 8º; Art. 20; Art. 9º; Art. 49; Art. 52 |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 6 · Visibilidade e transparência; 7 · Respeito pela privacidade do usuário |
| **Impacto** | Alto — Se isto for a produção como está: 1,2 milhão de titulares sob scoring por legítimo interesse (scenarios.ts:399 volumeTitulares) não têm como abrir solicitação, opor-se ou pedir revisão da decisão automatizada pelo sistema — o canal de oposição declarado na própria LIA vigente (seed.sql:48) aponta para rota que não existe em contrato algum do repositório, o que invalida o balanceamento que sustenta a base legal e expõe diretamente a sanção (Art. 52). O RIPD do próprio cenário lista a rota de revisão Art. 20 como recomendação P0 NÃO concluída (seed.sql:155). |
| **Recomendação** | Adicionar ao api/openapi.yaml: POST /requests (abertura com `direito`, `nivel_verificacao` exigido por direito e `prazo_limite` calculado); POST /me/decisoes/{id}/revisao (fecha a recomendação P0 de seed.sql:155); POST /titulares/me/oposicao (fecha o canal declarado em seed.sql:48); e um securityScheme separado para o titular (OIDC do portal com step-up para nível 2/3, espelhando o CHECK eliminacao_exige_nivel3 de db/schema.sql:560). Cada rota com resposta, prazo e gravação no audit trail declarados. |
| **Evidência** | openapi.yaml:756-757 "enum: [confirmacao, acesso, correcao, anonimizacao, bloqueio, eliminacao, portabilidade, compartilhamentos, revogacao, revisao_decisao]" — únicos paths de direitos: GET /requests (:464) e POST /requests/{id}/messages (:480) |
| **Fechado por (adendo 2026-07-30)** | Fechado — `bea0325` (invariantes antes das rotas), `f86020e` (as 12 rotas no contrato e no mock), `1c310d3` (o 11º direito e o canal da LIA). Provas: `PR 16 · as doze rotas — verificação: existem e respondem o contrato?`, `PR 16 · invariante — o nível de verificação é derivado do direito, no servidor`, `PR 16 · invariante — o 401 não diz se o cadastro existe`, `PR 17 · validação — o titular consegue se opor, e o tratamento para`. O nível de verificação é derivado do direito **no servidor**, e o 401 é indistinguível entre "não confirmou", "confirmou outro direito" e "cadastro inexistente" — senão a rota nova viraria o oráculo que a Regra 5 fecha. |

### Risco-002 — Consentimento sem persistência por titular no desenho de produção; revogação sem cascata de eliminação

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-002 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 1 · Consentimento e interface; 8 · Retenção e expurgo |
| **Classe** | Lacuna real |
| **Localização** | `api/openapi.yaml:47-522`; `db/schema.sql:20, 75, 81-743`; `app/src/mock/types.ts:509-521`; `app/src/mock/api.ts:1496-1543`; `app/src/screens/T2.tsx:462-548`; `db/seed.sql:48, 76, 170` |
| **Descrição** | A correção C-08 (PR 4) criou registro de consentimento com texto, versão, canal, hash e revogação operável com propagação real (bloqueia revelação e derruba o gate) — mas apenas na camada mock/UI. Três elos faltam: (i) api/openapi.yaml, o contrato da produção, não tem nenhuma rota /consentimentos entre seus 22 paths (nem POST /v1/titulares/buscar, também implementado só no mock); (ii) db/schema.sql não tem tabela de consentimento entre as 39 CREATE TABLE — a prova (texto, versão, hash, canal, estado) não tem onde persistir no desenho de produção; (iii) o modelo Consentimento é agregado por campo, com `titulares: number` (um contador, types.ts:520), sem consentId/titularId — o checklist pede consentimento persistido vinculado a userId/consentId, e a revogação individual do Art. 18, VIII (que a fila da T4 aceita como tipo de solicitação) não tem granularidade para ser executada.<br>**Facete fundida (F-02):** Sub-itens da mesma lacuna: (i) no schema, consentimento é só valor de enum (:20) e token do domínio retencao ('consentimento_revogado', :75) — o registro de consentimento (texto, versão, canal, hash, revogadoEm) existe apenas no mock (types.ts:511-521, scenarios.ts consentimentos); (ii) revogarConsentimento (api.ts:1503-1531) muda estado, bloqueia revelação e derruba gate, mas não agenda eliminação/expurgo dos dados revogados — não existe DELETE /me/dados nem rota de oposição no contrato (openapi.yaml tem 22 paths; nenhum /me/*, e o canal_oposicao da LIA em seed.sql:48 aponta 'POST /api/v1/titulares/me/oposicao', rota inexistente); (iii) o campo email tem retencao='consentimento_revogado' com base_legal='execucao_contrato' (seed.sql:76) — o gatilho de retenção referencia um consentimento que não é a base do tratamento e que o schema nem registra; nenhuma constraint amarra retencao='consentimento_revogado' a base_legal='consentimento'. |
| **Base legal violada** | Art. 7º, I; Art. 8º; Art. 18, VIII; Art. 37; Art. 49; Art. 18; Art. 15-16 |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 3 · Privacidade incorporada ao design; 7 · Respeito pela privacidade do usuário |
| **Impacto** | Alto — Um titular do programa de fidelidade pede a revogação (Art. 18, VIII) apenas do SMS. O único mecanismo existente revoga o registro do campo inteiro (POST /v1/consentimentos/{campoId}/revogar), cessando o tratamento dos outros ~31 mil titulares — ou o pedido individual fica sem execução. Se isto for a produção como está, não há como provar consentimento por titular (o contrato não tem rota e o banco não tem tabela) nem processar revogação individual. |
| **Recomendação** | Criar tabela `consentimento` em db/schema.sql (tenant_id, campo_id, titular_id, versao_texto, hash, canal, coletado_em, estado, revogado_em) com invariante em db/tests.sql; adicionar ao openapi.yaml as rotas GET /consentimentos e POST /consentimentos/{id}/revogar (e /titulares/buscar) espelhando o mock; evoluir o mock para registro por titular, de modo que revogar o consentimento de um titular não derrube a base legal dos demais — com teste novo em regras.test.tsx cobrindo exatamente esse caso.<br>Adicionalmente: Criar tabela gov.consentimento espelhando types.ts:511-521 (campo_id, versao, texto_hash, canal, coletado_em, estado, revogado_em); ao revogar, enfileirar expurgo_run(origem='solicitacao_titular') cobrindo os datasets dependentes e registrar notificação a operadores; adicionar a rota de oposição/eliminação ao openapi.yaml; adicionar CHECK ligando retencao='consentimento_revogado' a base_legal='consentimento'. |
| **Evidência** | grep '^  /' api/openapi.yaml → 22 paths, nenhum /consentimentos; grep 'CREATE TABLE' db/schema.sql → 39 tabelas, nenhuma de consentimento; types.ts:520: `titulares: number;` — grep 'consentimento' db/schema.sql → só enum (:20), domínio (:75) e rol do Art. 11 (:172); db/seed.sql:170 "R9','Revogação de consentimento sem cascata'...'aberto'"; scenarios.ts:85 R9 status 'identificado'. |
| **Fechado por (adendo 2026-07-30)** | Fechado — `8f636be` (entidade e aceite imutável no schema), `022a1d1` (migração da camada de demonstração). Provas: `PR 19 · unidade — o estado é derivado dos fatos, nos limites`, `PR 20 · integração — revogado e expirado cessam igual, e dizem coisas diferentes`, `PR 20 · aceitação — a migração é completa, não parcial`, `PR 20 · sistema — a cascata pendente é vigiada, não só exibida`; check `Constraints e invariantes do banco`. O estado do consentimento passou a ser derivado dos fatos, não gravado. **Exceção declarada:** `m-menor` segue sem texto publicado — é o Art. 14 (Risco-016), e publicar um texto ali inventaria o aceite de um responsável que ninguém consultou. |
| **Achado prévio relacionado** | C-08 |

### Risco-003 — Gate de privacidade cego: varre 1 arquivo do repositório e aprova com 40 CPFs formatados publicados em 7 arquivos

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-003 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 6 · Logging e auditoria |
| **Classe** | Lacuna real |
| **Localização** | `app/src/lib/gate-privacidade.ts:54, 65-90, 156, 178, 208`; `db/tests.sql:146`; `.privacy/data-inventory.lastro.yaml:14-15`; `.github/workflows/privacy-ci-gate.yml:4, 56-57` |
| **Descrição** | Guarda-chuva de defeitos complementares no gate (PR 11): (a) PADROES_DE_LOG (linha 54) só casa *.log, /logs?/, /exemplos?/ e /fixtures?/ — neste repositório isso resulta em exatamente 1 arquivo varrido (.privacy/exemplos/audit-trail.log), enquanto E5 encontrou 40 CPFs formatados em 7 arquivos (scenarios.ts, regras.test.tsx, prototipo/index.html, db/tests.sql, redator.ts, IMPLEMENTACAO.md, Lastro Redesenho.dc.html), todos invisíveis ao gate; o cabeçalho do próprio módulo (linhas 11-12) promete que 'este repositório não está publicando dado pessoal'. (b) A regex de CPF (linha 68) exige pontuação completa; o CPF de 11 dígitos sem máscara em db/tests.sql:146 passaria mesmo se o arquivo fosse varrido — enquanto o redator (redator.ts:27) casa também sem máscara: as duas defesas têm buracos complementares. (c) O gate lê apenas o campo `nome` do inventário (linha 178); `categoria` e `base_legal` existem na interface (linha 105) e nunca são validados — uma entrada '- nome: renda' sem categoria nem base legal legitima o campo. (d) O padrão de arquivo de inventário exige `data-inventory.*.yaml` com sufixo (linha 156), divergindo da mensagem de correção que sugere 'data-inventory.yaml' (linha 149). Reconhecido no equilíbrio: o gate falha-fechado (sem .privacy/ reprova), roda igual em CI e em casa, e é exercitado por testes (regras.test.tsx:3500-3666).<br>**Facete fundida (F-12):** E3 (npm run gate:privacidade): "1 arquivo(s) de log varrido(s). Nenhum achado." — só .privacy/exemplos/audit-trail.log casa os PADROES_DE_LOG (gate-privacidade.ts:54: *.log, /logs/, /exemplos/, /fixtures/). E5 (grep de CPF formatado) encontra 40 ocorrências em 7 arquivos fora desse recorte (scenarios.ts, regras.test.tsx, prototipo/index.html, db/tests.sql, redator.ts, IMPLEMENTACAO.md, Lastro Redesenho.dc.html), mais 1 CPF de 11 dígitos sem máscara em db/tests.sql:146 que nem o padrão do gate (exige pontuação) detectaria. O conservadorismo é deliberado e documentado (gate-privacidade.ts:60-63, para evitar falso vermelho), mas o workflow promete mais do que a varredura cobre: "prova ... que este repositório não publica dado pessoal" (privacy-ci-gate.yml:4) e "a raiz varrida é o repositório inteiro" (:56-57). |
| **Base legal violada** | Art. 46; Art. 49; Art. 6º, VIII; Art. 6º, X; Art. 6º |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 2 · Privacidade por padrão; 5 · Segurança de ponta a ponta; 6 · Visibilidade e transparência |
| **Impacto** | Alto — Um desenvolvedor cola um dump real (CPF, e-mail) em scenarios.ts, em um teste ou em um .md; o gate aprova ('Nenhum achado') porque só olha caminhos com cara de log, e o dado pessoal é publicado no repositório com histórico git permanente. O controle que o produto vende como prova de PII-zero não olha 99% do que o repositório publica. |
| **Recomendação** | Varrer PADROES_PII no repositório inteiro (todos os arquivos texto, não só logs), mantendo a varredura de campo-fora-do-catálogo restrita a logs; acrescentar padrão de CPF sem máscara com validação de dígito verificador para conter falso positivo; reprovar entrada de inventário sem `categoria` ou `base_legal` (os campos já estão na interface Inventario, linha 105); adicionar teste que planta um CPF formatado em um .ts fora de logs/ e prova a reprovação.<br>Adicionalmente: Ou estender a varredura a .md/.sql/.html com uma allowlist explícita e versionada dos CPFs de teste documentados (e cobrir o padrão de 11 dígitos sem máscara), ou reescrever o cabeçalho do workflow e o relatório para o escopo real ("PII em arquivos de log declarados"), mantendo a honestidade que o próprio gate exige de si. |
| **Evidência** | E3: `cd app && npm run gate:privacidade` imprime '1 arquivo(s) de log varrido(s). Nenhum achado.' enquanto E5 (grep -rEno de CPF formatado) encontra 40 ocorrências em 7 arquivos; gate-privacidade.ts:54 `const PADROES_DE_LOG = [/\.log$/, /[/\\]logs?[/\\]/, ...]`; :178 `new Set((inventario.campos ?? []).map((c) => String(c.nome)...))`. — E3 "cd app && npm run gate:privacidade" → "1 arquivo(s) de log varrido(s). Nenhum achado." vs E5 grep: 40 CPFs formatados em 7 arquivos |
| **Fechado por (adendo 2026-07-30)** | Fechado — `3fd6bf7`. Provas: `PR 22 · integração — a varredura cobre o repositório, e a de campo não vazou`, `PR 22 · aceitação — o gate olha o repositório inteiro, e a catraca prova`; check `PII, catálogo e PbD`. A varredura passou de 1 arquivo para o repositório inteiro, e o relatório imprime o denominador — quantos arquivos leu, quantos eram log, quantos binários pulou. **Resíduo:** os CPFs removidos continuam no histórico do git; reescrever histórico é decisão de quem opera o repositório. |

### Risco-004 — Cadeia de hash do audit trail não cobre justificativa nem base legal — o campo mais exposto é adulterável sem detecção

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-004 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 6 · Logging e auditoria |
| **Classe** | Lacuna real |
| **Localização** | `app/src/mock/db.ts:77-83, 155-169`; `db/schema.sql:773-794`; `app/src/mock/api.ts:1580-1584` |
| **Descrição** | O payload do hash encadeado em db.ts:78-83 inclui hashAnterior, ocorridoEm, ator, acao, recursoTipo, recursoId, finalidade, protocolo, campos e resultado — e exclui `justificativa` e `atorPapel`. A função de verificação (db.ts:155-169) recomputa com os mesmos campos, logo alterar justificativa ou papel do ator não quebra a cadeia. O trigger do Postgres (schema.sql:780-788) tem a mesma lacuna e exclui também `base_legal`, `ip` e `user_agent`. Agravantes: (a) o projeto repete que 'o fundamento fica anexado para sempre' (T9.tsx:284) e que a decisão de não comunicar 'é a que a fiscalização examina primeiro' (api.ts:1419-1423) — mas é justamente esse texto que fica fora da proteção de integridade; (b) o export CSV (api.ts:1580-1584: id, ocorrido_em, ator, papel, acao, recurso, finalidade, protocolo, resultado, hash) também omite justificativa, então não há cópia externa para conferência; (c) o checklist do trail pede base legal por acesso — a coluna `base_legal` existe no schema (:754) mas a EntradaAudit do app (db.ts:5-17) não tem o campo e nenhuma rota a grava. Reconhecido no equilíbrio: append-only real (triggers :807-809, api PATCH/DELETE 409), gravar-antes-de-responder com 503, negativas registradas — a arquitetura do trail é forte; a lacuna é o escopo do que a cadeia sela. |
| **Base legal violada** | Art. 37; Art. 48; Art. 46; Art. 6º, X |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 5 · Segurança de ponta a ponta; 6 · Visibilidade e transparência |
| **Impacto** | Alto — Um DBA comprometido (o exato cenário que o botão 'forjar' da T6 demonstra) reescreve a `justificativa` da linha INCIDENTE_DECIDIDO — o fundamento de não comunicar à ANPD — ou de um CAMPO_REVELADO. `auditVerificar()` devolve integro=true, o CSV exportado não carrega a coluna, e a prova apresentada à fiscalização (Art. 48/37) está corrompida sem que nenhum controle acuse. |
| **Recomendação** | Incluir `justificativa`, `atorPapel`/`ator_tipo`, `base_legal`, `protocolo`, `ip` e `user_agent` no payload do hash nos dois lugares (db.ts:78-83 e schema.sql:780-788, na mesma ordem, com teste de paridade); acrescentar teste que forja a justificativa de uma linha e espera integro=false; popular `base_legal` no auditAppend das ações PII lendo do catálogo do campo. |
| **Evidência** | db.ts:80-82 `l.ocorridoEm, l.ator, l.acao, l.recursoTipo, l.recursoId, l.finalidade ?? '-', l.protocolo ?? '-', l.campos.join(','), l.resultado` — sem justificativa; schema.sql:786-788 payload termina em `coalesce(NEW.finalidade,'-') \|\| ... \|\| NEW.resultado` — sem justificativa/base_legal. |
| **Fechado por (adendo 2026-07-30)** | Fechado — `3fd6bf7`. Provas: `PR 22 · unidade — a cadeia cobre a base legal, e o selo cobre o texto`, `PR 22 · sistema — o expurgo dos 30 dias continua preservando a cadeia`; check `Constraints e invariantes do banco`. `justificativa_hash` e `base_legal` entram no payload do hash. O selo é o sha256, não o texto: expurgar a justificativa preserva a cadeia, e a verificação passou a devolver `motivo` por linha. |

### Risco-005 — Governança de mudança rompida: upload manual reverteu PR revisado, a main está vermelha e nenhum workflow é required status check

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-005 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 6 · Logging e auditoria; 10 · Governança de ML/IA |
| **Classe** | Lacuna real |
| **Localização** | `.github/workflows/ci.yml:7-10`; `.github/workflows/privacy-ci-gate.yml:17-19`; `db/schema.sql:200, 328, 410, 653`; `docs/design_handoff_lastro_correcoes/MAPA-PROCESSOS.md:21, 24`; `app/tests/regras.test.tsx:4024-4146` |
| **Descrição** | Guarda-chuva do pipeline: (a) os dois workflows admitem em comentário que, sem a marcação de required status check, 'este arquivo é conselho e não regra' (ci.yml:7-10; privacy-ci-gate.yml:17-19) — e E2 prova a consequência: a suite está com 4 falhas na main no HEAD atual (bloco 'PR 14 - verificação: o documento corresponde ao código?'), porque um upload manual regrediu MAPA-PROCESSOS.md e 'Lastro Redesenho.dc.html'; (b) não há gitleaks/secret-scanning, CodeQL nem npm audit em nenhum workflow; (c) o schema define invariantes de data que exigem relógio — dpa_expira_em (:200), ripd.reavaliar_em (:328), risco.reavaliacao (:410), kms_chave.rotacao_prevista (:653) — e não existe workflow com `schedule` para acusar vencimento: DPA vencido, LIA/RIPD sem reavaliação e chave sem rotação envelhecem em silêncio; (d) db/schema.sql e db/tests.sql nunca são executados em CI (nenhum serviço Postgres) e api/openapi.yaml nunca é lintado — as invariantes SQL, incluindo o teste anti-PII do gate_finding, são letra morta no pipeline.<br>**Facete fundida (F-06):** O commit HEAD 8d0548a ("Add files via upload") sobrescreveu MAPA-PROCESSOS.md e "Lastro Redesenho.dc.html" com versão anterior ao PR #17 (git show --stat 8d0548a: apenas esses 2 arquivos), revertendo o rebaixamento do MAPA a "documento de intenção". Consequências verificadas: (1) 4 testes do bloco "PR 14 · verificação — o documento corresponde ao código?" (regras.test.tsx:4024) falham na main (E2); (2) o MAPA restaurado volta a prometer a tela "T11 · Achados e planos de ação" (MAPA-PROCESSOS.md:21,24) que não existe em app/src/screens/ (T0-T10 + ComoFunciona); (3) os dois workflows admitem no próprio cabeçalho não ser required status check ("este arquivo é conselho e não regra", ci.yml:7-10) — o gate C-18 existe mas não impede exatamente o que acabou de acontecer. O mecanismo anti-divergência do PR 14 funcionou (detectou); o processo de merge não o respeitou. |
| **Base legal violada** | Art. 46; Art. 49; Art. 6º, VIII; Art. 6º; Art. 37 |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 3 · Privacidade incorporada ao design; 6 · Visibilidade e transparência |
| **Impacto** | Alto — Exatamente o que já aconteceu: o commit HEAD 8d0548a ('Add files via upload') entrou na main sobrescrevendo docs pós-PR17 e deixou 4 testes de conformidade quebrados — o CI informou o vermelho e não impediu nada. O mesmo caminho aceita um PR que remova o redator ou o gate de privacidade inteiro; e um segredo/token commitado nunca seria detectado (não há gitleaks/secret scanning). |
| **Recomendação** | Corrigir a main (restaurar os 2 arquivos pós-PR17 e deixar E2 verde); marcar `verificacao` e `privacidade` como required status checks na proteção da main; adicionar ao ci.yml um job com serviço Postgres que roda db/schema.sql + db/tests.sql e um passo spectral/redocly no openapi.yaml; adicionar gitleaks e npm audit; criar workflow com `schedule` diário que falha listando linhas de dpa/reavaliação/rotação vencidas.<br>Adicionalmente: Reverter os 2 arquivos de 8d0548a para o estado do PR #17 (git checkout 326ef30 -- "docs/design_handoff_lastro_correcoes/MAPA-PROCESSOS.md" "docs/design_handoff_lastro_correcoes/Lastro Redesenho.dc.html") devolvendo a main ao verde; marcar os jobs `verificacao` e `privacidade` como required status checks na proteção da branch main e bloquear push direto — a instrução já está escrita em ci.yml:7-10, falta a configuração. |
| **Evidência** | E2: `cd app && npm test` — 305 passam, 4 falham na main (HEAD 8d0548a, git show --stat confirma sobrescrita de 2 docs); ci.yml:7-9 'Enquanto o job `verificacao` não estiver marcado como *required status check* ... este arquivo é conselho e não regra'. — E2 "cd app && npm test": 305 passam, 4 FALHAM — todas do bloco PR 14; git show --stat 8d0548a: só MAPA-PROCESSOS.md e Lastro Redesenho.dc.html alterados |
| **Fechado por (adendo 2026-07-30)** | Fechado — os quatro sub-itens. `2cf1c18` põe `db/schema.sql` e `db/tests.sql` no CI (check `Constraints e invariantes do banco`, hoje *required*), e `f86020e` põe `api/openapi.yaml` sob catraca de leitura pelo teste `PR 16 · invariante de paridade — contrato e mock, nos dois sentidos (Risco-034)`. O sub-item (c) fecha em `e1a35df`: o workflow `Relógio do programa` roda `schedule` diário sobre as quatro varreduras de prazo — retenção vencida, DPA vencido, propagação parada e obrigação dentro da antecedência, que é onde `dpa_expira_em`, `reavaliar_em` e `rotacao_prevista` viram trabalho — e abre alerta idempotente por chave `RELOGIO-<cenário>-<código>`, com a decisão em `.ts` exercitada por `PR 29 · Risco-005(c) — o relógio do programa dispara sem sessão aberta` e o workflow apenas movendo bytes. As três limitações do `schedule` (atraso, ausência em fork, desativação após 60 dias de inatividade) estão declaradas no próprio YAML, com teste. O sub-item (b) fecha em `77afe42`: o workflow `Segurança` traz três jobs nomeados e marcáveis — `Segredos no diff e no histórico` (gitleaks com `fetch-depth: 0`, varrendo árvore e histórico completo), `Dependências vulneráveis` (`npm audit` sob política de limiar `high`, com exceção datada que exige advisory existente, motivo, dono e validade — vencida, o vermelho volta sozinho) e `CodeQL` (`javascript-typescript`, semanal e em PR). **O CodeQL reprova alerta novo:** o `analyze` do workflow falha só por erro de execução, e um segundo check homônimo — do code scanning — reprova quando o diff acrescenta alerta; alerta pré-existente aparece na aba Security sem bloquear. Medição que mudou o desenho: gitleaks casa segredo e não dado pessoal — a massa sintética declarada passa sem allowlist, e o `.gitleaks.toml` não tem nenhuma, com a regra de origem no inventário travada por teste em vez de por um gerador vazio. **Resíduo:** dois `moderate` em `react-router` e `react-router-dom`, abaixo do limiar e com correção disponível. |
| **Achado prévio relacionado** | C-18 |
| **Atualização (adendo)** | Parcialmente remediado após o commit auditado: #19 restaurou o MAPA (main verde), #18 entregou a T11, e os PRs-sonda #21–#25 indicam ruleset de proteção de branch em vigor. Permanecem: gitleaks/CodeQL/npm audit, `schedule` de vencimentos, e schema/OpenAPI fora do CI — ver "Adendo pós-auditoria" no §1. |

### Risco-006 — Retenção existe só como rótulo: sem retencao_ate, sem TTL, sem executor de expurgo — e o audit_log não tem prazo definido

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-006 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 8 · Retenção e expurgo; 6 · Logging e auditoria |
| **Classe** | Lacuna real |
| **Localização** | `db/schema.sql:74-75, 153-182, 606-639, 743-766`; `app/src/mock/types.ts:80-81`; `.privacy/data-inventory.lastro.yaml:18-41`; `docs/01-arquitetura.md:134-144` |
| **Descrição** | A retenção só existe como duração/prosa, nunca como data ou mecanismo: (i) o domínio `retencao` (schema.sql:75) é TEXT e admite 'indeterminado' sem exigir justificativa ou fonte normativa; (ii) nenhuma das 39 tabelas tem coluna `retencao_ate` (data absoluta calculada na ingestão) — grep por retencao_ate/pg_cron/particionamento em db/ não retorna nada; (iii) não há job de expurgo no repo (nenhum .py; expurgo-permanente.py é apenas citado em docs/01-arquitetura.md:26): expurgo_run/expurgo_entrada (schema.sql:606-639) registram pós-fato um 'airflow-svc-account' externo (:615); (iv) no mock, campos com retenção por evento têm retencaoDias null (b-email, v-email, v-tel, m-plano, m-inferencia, m-menor) sem nenhum gatilho implementado. A retenção declarada no catálogo não é estrutural: nada a executa nem a verifica.<br>**Facete fundida (F6-06):** O schema tem um DOMAIN `retencao` obrigatório para todo campo do catálogo (:74-75, :165) — mas a tabela audit_log (:743-766) não tem política de retenção, particionamento, arquivamento ou expurgo; grep por prazos de log em docs/ não encontra nada (nenhuma menção a 30 dias para logs operacionais nem a 5 anos para auditoria, os alvos do checklist); o inventário .privacy declara os campos do log de exemplo sem prazo; e a tabela de componentes de 01-arquitetura.md define controles por camada sem citar retenção de logs/observabilidade. A tensão é real: o trail é append-only por design (correto), o que torna obrigatório declarar o término do tratamento por outro mecanismo (arquivamento WORM com prazo, cripto-shredding da chave do HMAC de titular_hash) em vez de silêncio. |
| **Base legal violada** | Art. 15-16; Art. 6º, III; Art. 6º, X; Art. 37 |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 3 · Privacidade incorporada ao design; 5 · Segurança de ponta a ponta |
| **Impacto** | Alto — Em produção como está, um dado coletado hoje nunca ganha data de eliminação: o prazo 'P5Y' do CPF é uma string que nenhum processo lê. O acúmulo indefinido de PII (o próprio R4 do repo) se materializa, e uma fiscalização não encontra evidência executável de término de tratamento (Art. 15-16) — apenas o registro pós-fato de um job externo que não está versionado em lugar nenhum. |
| **Recomendação** | Adicionar `retencao_ate DATE` calculada na ingestão (trigger derivando do domínio `retencao`) ao modelo de campo/dataset; remover 'indeterminado' do domínio ou exigir `retencao_fonte NOT NULL` quando usado; versionar o executor do expurgo (expurgo-permanente.py ou SQL com pg_cron) que produza as linhas de expurgo_run/expurgo_entrada em vez de apenas recebê-las prontas.<br>Adicionalmente: Declarar a política no schema (comentário normativo + particionamento mensal de audit_log com arquivamento WORM e prazo de 5 anos, eliminação por cripto-shredding da chave HMAC dos pseudônimos ao fim do prazo); adicionar `retencao` às entradas do data-inventory.lastro.yaml; registrar em 01-arquitetura.md os prazos de logs operacionais (30d) e de auditoria (5 anos), citando a fonte normativa. |
| **Evidência** | db/schema.sql:75 "CREATE DOMAIN retencao AS TEXT CHECK (VALUE ~ '^(P[0-9]+[DMY]\|indeterminado\|consentimento_revogado\|obrigacao_legal:...')" — única representação de prazo; grep por 'retencao_ate\|pg_cron' em db/ sem ocorrências (E5/inspeção direta). — schema.sql:743-766 CREATE TABLE audit_log sem qualquer cláusula/comentário de retenção, em contraste com :165 `retencao retencao NOT NULL` exigido de todo campo do catálogo; grep -i 'retencao\|30 dias\|5 anos' em docs/*.md não retorna política de logs. |
| **Fechado por (adendo 2026-07-30)** | Fechado — `2cf1c18`. Provas: `PR 18 · unidade — retencao_ate é derivada, e por uma função só`, `PR 18 · unidade — a chave de idempotência não depende do estado`, `PR 18 · integração — o executor elimina, prova e não repete`, `PR 18 · sistema — prazo vencido vira achado, e não pendência silenciosa`; check `Constraints e invariantes do banco`. `retencao_ate` é `GENERATED ALWAYS AS ... STORED` sobre função `IMMUTABLE` — derivada, e por uma função só, com os 17 casos de fronteira num CSV que o SQL e o TypeScript leem juntos. |

### Risco-007 — Equidade algorítmica só declarada: teste de disparidade, remoção de proxies e AIA sem artefato executável ou versionado

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-007 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 10 · Governança de ML/IA |
| **Classe** | Lacuna real |
| **Localização** | `db/seed.sql:46, 57, 157`; `app/src/mock/scenarios.ts:391, 427`; `app/src/mock/decisoes.ts:305-314`; `db/schema.sql:214-230` |
| **Descrição** | Quatro lacunas da mesma natureza: (1) contradição interna — a LIA vigente declara como mitigação ativa "teste de disparate impact a cada release" (seed.sql:46) e "removidas as features cep, nome_mae e canal_atendimento" (seed.sql:57, scenarios.ts:427), mas o RIPD do mesmo cenário lista o job ci-disparate-test como P1 NÃO concluída (seed.sql:157, scenarios.ts:391) — a base legal se apoia em mitigação que o próprio repositório admite não existir; (2) não há AIA/análise de impacto algorítmico como documento vivo versionado: a DMN D3 exige "análise algorítmica" com fallback restritivo (decisoes.ts:309-314, ponto forte), mas a saída é um flag que não materializa template nem documento em lugar algum do repo; (3) a remoção de proxies discriminatórias não tem verificação — nenhum gate, teste ou inventário de features do modelo confere que cep/nome/canal ficaram fora; (4) não há verificação por registro de base legal para dados de treino: a linhagem registra runs agregados (schema.sql:214-230, 41.893 linhas por run em seed.sql:86), não a base de cada registro que alimenta o modelo. |
| **Base legal violada** | Art. 20; Art. 6º, IX; Art. 7º, IX; Art. 38 |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 3 · Privacidade incorporada ao design; 6 · Visibilidade e transparência |
| **Impacto** | Alto — Decisão automatizada de crédito para 1,2M de titulares em que a mitigação de discriminação que sustenta a LIA vigente (teste de disparate impact "a cada release", remoção de cep/nome_mae/canal_atendimento) é texto de seed sem nenhum job, relatório ou teste que a verifique — o próprio RIPD lista o job como pendente. Em fiscalização, o balanceamento do legítimo interesse cai por falta de evidência (Art. 6o IX, Art. 20). |
| **Recomendação** | Criar docs/aia/AIA-credit-scoring.md versionado, referenciado pela saída analiseAlgoritmica=true da D3 (mesmo padrão dos .dmn versionados do PR 12); transformar o disparate impact em artefato: job de CI com limiar 0.8-1.2 (exatamente como seed.sql:157 descreve a evidência esperada) e relatório versionado; corrigir a medidas_mitigacao da LIA para o status real; adicionar coluna de base legal por lote na linhagem de treino com teste em db/tests.sql. |
| **Evidência** | seed.sql:46 "teste de disparate impact a cada release" (mitigação declarada vigente) vs seed.sql:157 "'P1','Teste de disparate impact no pipeline do modelo'...,false,NULL" (pendente) |
| **Fechado por (adendo 2026-07-30)** | Fechado — `0da2b08` e `9614ab3`. Provas: `PR 26 · Risco-007 — equidade deixa de ser declarada e vira artefato`, `PR 28 · Risco-007 — a AIA é documento conferido, não anexo`; check `Disparidade e proxies do modelo`. **Fecharam** (1) a contradição interna — a mitigação da LIA passou a citar `npm run equidade`, com o piso lido de `.privacy/equidade.yaml` em vez de redigitado —, (3) a verificação da remoção de proxies, com lista fechada e reprovação por arquivo e linha, e (2) a AIA como documento vivo: `.privacy/aia-credit-scoring.md`, com cabeçalho transcrito sob catraca (modelo, fatores, razão datada), piso e proxies como ponteiros, e o corpo proibido de repetir literal de taxa. A AIA fecha também a ponta que esta recomendação pedia — ser referenciada pela saída `analiseAlgoritmica=true` da D3, que até então exigia uma análise inexistente — e traz o gatilho de reavaliação como obrigação de calendário com responsável, vencimento e consequência. **Resíduo declarado:** (4) a base legal por registro na linhagem de treino, nomeado na própria AIA. A recomendação original pedia "limiar 0.8-1.2": a faixa é assimétrica e foi substituída por piso 0,80 sob razão menor/maior, com a razão do troco escrita no contrato. |

### Risco-008 — Fornecedor não é entidade: DPA sem validação programática, expiração sem vigilância, sem chave por parceiro nem revogação com SLA

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-008 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 11 · Fornecedores e transferência internacional |
| **Classe** | Lacuna real |
| **Localização** | `db/schema.sql:188-208`; `db/seed.sql:82, 170`; `app/src/mock/scenarios.ts:107-161`; `app/src/mock/api.ts:1530-1538` |
| **Descrição** | Fortes reconhecidos: transferencia_exige_mecanismo com evidência e país (schema.sql:204-207, Art. 33), SCCs com evidencia_uri + evidencia_hash (:197-198) e o teste da Regra 8. As lacunas, todas da mesma raiz — fornecedor não existe como entidade: (1) dpa_assinado é BOOLEAN default false sem nenhum CHECK, trigger ou invariante — um compartilhamento com operador sem DPA insere sem erro, e db/tests.sql não tem um único teste de DPA; (2) dpa_expira_em (:200) não é vigiado: sem trigger, sem obrigação no calendário anual T10 — as 22 obrigações (scenarios.ts:107-161) cobrem LIA, consentimento, chaves e RIPD, nenhuma cobre renovação de DPA/SCC; (3) destino é TEXT livre ('OpenAI', :191) sem FK para entidade parceiro — sem visão consolidada, sem grafia canônica; (4) não há chave de API por parceiro rotacionável em schema ou contrato; (5) a revogação de consentimento propaga apenas para os gates internos de CI (api.ts:1534) — não há webhook a parceiros com SLA, e o risco R9 "Revogação de consentimento sem cascata... webhook a parceiros" está 'aberto' (seed.sql:170). |
| **Base legal violada** | Art. 33; Art. 46; Art. 8º; Art. 15-16; Art. 6º |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 2 · Privacidade por padrão; 5 · Segurança de ponta a ponta |
| **Impacto** | Alto — O DPA da SendGrid vence em 30/09/2026 (seed.sql:82) — dois meses da data desta auditoria — e nada no schema, no calendário T10 ou nos gates acusa o vencimento: o e-mail dos titulares continua fluindo para os EUA com contrato vencido. Um titular revoga o consentimento e o dado permanece nos parceiros a jusante — risco R9 que o próprio repositório registra como 'aberto'. |
| **Recomendação** | Criar tabela fornecedor (nome canônico, país, dpa_uri, dpa_hash, dpa_expira_em, webhook_revogacao_url, sla_horas, chave_api_rotacionada_em) com FK em compartilhamento; CHECK exigindo dpa_assinado quando papel_destino='operador' + invariante em db/tests.sql que tenta inserir compartilhamento sem DPA e espera falhar; obrigação "Renovação de DPA/SCC" no calendário T10 com antecedência de 60 dias (mesmo padrão da LIA em scenarios.ts:133-134); propagar revogação a parceiros no mock com evento auditado. |
| **Evidência** | schema.sql:199-200 "dpa_assinado BOOLEAN NOT NULL DEFAULT false, dpa_expira_em DATE" — nenhuma constraint associada; grep -i dpa db/tests.sql retorna vazio |
| **Fechado por (adendo 2026-07-30)** | Fechado — `4aa1f78`, `c081ce8` e `55bb029`. Provas: `PR 21 · unidade — a vigência do DPA, na fronteira de um dia`, `PR 21 · integração — a varredura pega o que o trigger não alcança`, `PR 21 · sistema — a entidade chega às telas e à cascata`, `PR 31 · Risco-008 (resíduo) — desligar parceiro destruindo a chave dele`; check `Constraints e invariantes do banco`. **Fecharam** (1) o DPA recusado na escrita pelo banco, (2) a expiração vigiada por varredura — o banco barra a escrita, a varredura pega o que envelhece —, (3) `destino` virou FK para entidade, (4) `kms_chave_id` liga fornecedor à chave e (5) a revogação com SLA: o fornecedor é o nono artefato da máquina de estados (`ativo → desligando → desligado`, `estados.ts` e `docs/processos/fornecedor.bpmn`), desligar é fato com motivo e ator em `fornecedor_desligamento` — não `UPDATE` de flag —, a janela vem do `dpa_encerramento_dias` do contrato como coluna `GENERATED`, o trigger recusa transferência para quem está saindo **antes** de a chave cair, destruir antes do fim da janela devolve 409 (a janela protege a devolução que o DPA promete) e a destruição grava prova encadeada no mesmo formato do expurgo. **Resíduo declarado:** a chave é registro versionado, não material em KMS — destruir aqui apaga a referência, não zera HSM; e webhook a parceiros continua inexistente, substituído pela destruição da chave, que não depende de o parceiro atender. |

### Risco-009 — Processo de solicitação do titular sem etapa de verificação de identidade e sem ator titular

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-009 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 12 · Direitos dos titulares |
| **Classe** | Lacuna real |
| **Localização** | `docs/processos/solicitacao.bpmn:19-50`; `db/schema.sql:546-560`; `app/src/mock/api.ts:869-879` |
| **Descrição** | O BPMN do processo PR-05 (solicitacao.bpmn) vai de "Direito do titular aberto" → recebida → em analise → concluida/recusada, com as tarefas "iniciar análise", "concluir" e "recusar com fundamento legal" — não existe tarefa de verificação de identidade, embora o schema modele nivel_verificacao 1-3 (schema.sql:546) e exija nível 3 para eliminação (CHECK eliminacao_exige_nivel3, :560), e o evento 'verificada' esteja previsto só como comentário (schema.sql:568). No mock, o nivelVerificacao chega pronto no dado do cenário (scenarios.ts:275-283) e nenhuma rota o estabelece ou o confere antes de transitar; toda mensagem do canal sai com remetente 'dpo' fixo (api.ts:878) — não há ator, papel ou sessão de titular em todo o app. A verificação é dado que ninguém produz. |
| **Base legal violada** | Art. 18; Art. 6º; Art. 46 |
| **Princípio PbD violado** | 5 · Segurança de ponta a ponta; 7 · Respeito pela privacidade do usuário |
| **Impacto** | Alto — Uma eliminação atendida sem que nenhum processo estabeleça o nível 3 de verificação é entrega de poder destrutivo a um terceiro que se passa pelo titular; um acesso atendido sem MFA vaza o dossiê completo do titular para quem pediu em nome dele. |
| **Recomendação** | Adicionar ao solicitacao.bpmn a tarefa "verificar identidade" entre recebida e em análise, com gateway pelo nível exigido do direito; no mock (app/src/mock/api.ts), recusar a transição recebida→em_analise com 422 quando nivelVerificacao for menor que o exigido pelo direito (espelhando o CHECK de schema.sql:560) e gravar o evento 'verificada' no trail, exercitado por teste em regras.test.tsx. |
| **Evidência** | solicitacao.bpmn tarefas: "iniciar análise", "concluir", "recusar com fundamento legal" — nenhuma de verificação; schema.sql:560 "CONSTRAINT eliminacao_exige_nivel3 CHECK (direito <> 'eliminacao' OR nivel_verificacao = 3)" |

### Risco-010 — Prazo de comunicação à ANPD sem relógio: nenhum artefato conhece o prazo do Art. 48

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-010 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 13 · Incidentes de segurança |
| **Classe** | Lacuna real |
| **Localização** | `app/src/screens/T9.tsx:108-133`; `app/src/mock/api.ts:1363-1372, 1447-1475`; `docs/design_handoff_lastro_correcoes/IMPLEMENTACAO.md:266-268` |
| **Descrição** | A FaixaDoIncidente calcula apenas 'Detectado há X h Y min' (T9.tsx:110-112) — tempo decorrido, sem alvo, sem cor de urgência, sem data-limite. O tipo Incidente e a rota de abertura (api.ts:1363-1372) não têm campo de prazo; a efetivação da comunicação (:1447-1475) registra o ato sem compará-lo a limite algum; o calendário T10/ICS agrega obrigações mas não recebe prazo de incidente. O handoff prometeu 'prazos correndo à vista' (Validacao UX e LGPD.dc.html:290) e IMPLEMENTACAO.md:268 diz 'o prazo corre à vista, a partir de detectadoEm' — implementou-se o cronômetro, não o prazo. Contraste interno: as solicitações de titular (T4) têm SLA duplo com prazo legal e alerta <24h, provando que o padrão existe no repo e não foi aplicado ao artefato mais sensível a prazo. |
| **Base legal violada** | Art. 48; Art. 52 |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 6 · Visibilidade e transparência |
| **Impacto** | Alto — Incidente contido numa sexta-feira; o DPO decide comunicar na segunda seguinte e efetiva na quarta. Ninguém — tela, API, schema, calendário T10 — computa o prazo regulamentar de 3 dias úteis (Res. CD/ANPD 15/2024, que concretiza o 'prazo razoável' do Art. 48 §1º) nem alerta a aproximação. A comunicação intempestiva é exposição direta a sanção do Art. 52, num produto cuja tela promete 'prazo à vista'. |
| **Recomendação** | Acrescentar `prazoAnpdEm` ao tipo Incidente (detectadoEm + 3 dias úteis, mesma aritmética de dias úteis já usada no SLA da T4), exibir contagem regressiva com tom crítico <24h na FaixaDoIncidente, gravar na linha INCIDENTE_COMUNICADO o delta contra o prazo, e incluir o vencimento na fila/calendário T10; na tabela `incidente` proposta (F13-01), coluna `prazo_anpd_em DATE NOT NULL`. |
| **Evidência** | T9.tsx:110-112 `const desdeMs = Date.now() - new Date(incidente.detectadoEm).getTime(); const horas = ...` — único cálculo temporal do fluxo; grep 'prazo' em T9.tsx → apenas texto informativo, nenhum limite. |

### Risco-011 — X-Purpose é regra global em prosa, mas instrumentado em 1 de 25 operações do contrato; propósito autodeclarado

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-011 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 3 · Segurança de endpoints e PII |
| **Classe** | Divergência doc × código |
| **Localização** | `api/openapi.yaml:8-11, 257, 537-550`; `app/src/mock/api.ts:152-155, 917-921` |
| **Descrição** | O contrato declara na descrição global que 'X-Purpose é obrigatório em qualquer rota que toque dado de titular' e que a ausência devolve 403 com ACESSO_SEM_FINALIDADE (openapi.yaml:8-11), mas o parâmetro components/parameters/Purpose é referenciado em exatamente 1 das 25 operações (/pseudonyms/resolve, openapi.yaml:257). No mock, req.purpose só é exigido em POST /pseudonyms/resolve (api.ts:152-155) e POST /titulares/buscar (api.ts:917-921); as demais rotas que tocam dado de titular não o pedem. Não existe nenhum mecanismo (escopo OIDC, claim modelada, resposta 403 reutilizável) que amarre o header ao token — o propósito é autodeclarado pelo cliente. Cobre também o item 'propósito no token revogável' do checklist 4: sem claim modelada não há o que revogar. |
| **Base legal violada** | Art. 37; Art. 6º, I; Art. 6º, II; Art. 9º |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 6 · Visibilidade e transparência |
| **Impacto** | Alto — Em produção como está, toda leitura de dado de titular fora de 2 rotas (resolve e buscar) acontece sem finalidade declarada nem verificável — GET /titulares/{id}, GET /requests, GET /audit, GET /catalog não exigem X-Purpose. O registro do Art. 37 fica sem a finalidade e a prova de adequação (Art. 6º, II) não existe. Onde o header existe, o propósito é escolhido pelo chamador: a regra 'Deve constar no claim purposes[] do token' (openapi.yaml:547) é só prosa, pois o securityScheme oidc não define escopos (openapi.yaml:537-540) e nenhum artefato descreve a verificação. |
| **Recomendação** | Referenciar $ref: '#/components/parameters/Purpose' em toda operação que toca dado de titular (/requests*, /audit*, futura GET /titulares/{id}) e declarar uma resposta 403 reutilizável ACESSO_SEM_FINALIDADE; definir escopos/claims no securityScheme (ex.: purposes[] com semântica de revogação) em vez de prosa. No mock, mover a exigência para politicas.ts (campo exigeFinalidade: true) para a guarda de topo aplicar uniformemente, com teste por rota em regras.test.tsx. |
| **Evidência** | openapi.yaml:10 '**`X-Purpose` é obrigatório** em qualquer rota que toque dado de titular' vs. único uso do parâmetro em openapi.yaml:257 ('- { $ref: #/components/parameters/Purpose }'). |
| **Fechado por (adendo 2026-07-30)** | Fechado — `a367a89`. Provas: `PR 23 · unidade — cada rota declara se exige finalidade, e por quê`, `PR 23 · integração — a guarda cobra a finalidade, e a ausência fica registrada`, `PR 23 · sistema — a catraca comportamental do Risco-011`, `PR 23 · aceitação — contrato e política dizem a mesma coisa`. `finalidade` virou campo **obrigatório** no tipo da política de rota: a rota nova é forçada a decidir, e dispensar exige motivo escrito e cobrado por teste. A catraca é comportamental — lê o que a rota *fez*, não o que ela declara. **Resíduo:** `purposes[]` no token OIDC segue sendo desenho de produção; o mock não tem emissor para conferir o claim. |

### Risco-012 — GET /titulares/{id} devolve a ficha do titular sem finalidade e sem gravar no trail

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-012 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 3 · Segurança de endpoints e PII |
| **Classe** | Divergência doc × código |
| **Localização** | `app/src/mock/api.ts:262-276`; `api/openapi.yaml:14`; `app/src/mock/db.ts:20, 175-178` |
| **Descrição** | O case 'GET titulares' (api.ts:262-276) aplica corretamente o 404 uniforme (Regra 5), mas devolve ok({id, campos, compartilhamentos, decisao}) sem exigir req.purpose e sem chamar banco.auditAppend — únicas rotas de titular com registro são buscar e resolve. O vocabulário de auditoria já prevê a ação: 'TITULAR_CONSULTADO' está em ACOES_PII (db.ts:20) e aparece uma única vez, na semente estática (db.ts:175-178), nunca emitida por rota. A decisão de crédito (aprovado/score/fatores) é dado pessoal do titular e sai nessa resposta sem rastro. |
| **Base legal violada** | Art. 37; Art. 6º, VI; Art. 6º, X; Art. 46 |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 6 · Visibilidade e transparência |
| **Impacto** | Alto — DPO ou engenharia (ver_portal_titular) abrem a ficha — lista de campos, compartilhamentos e a decisão automatizada de crédito do titular — sem declarar finalidade e sem deixar uma linha no trail. Consulta por curiosidade a um titular específico é invisível; numa fiscalização ou pedido do titular, o controlador não consegue provar quem consultou a ficha de quem, contrariando a regra que o próprio contrato vende como diferencial ('Toda leitura de dado pessoal grava antes de responder', openapi.yaml:14). |
| **Recomendação** | Na rota GET titulares/{id}: exigir req.purpose (403 sem ele, como resolve) e gravar banco.auditAppend({acao: 'TITULAR_CONSULTADO', recursoTipo: 'titular', recursoId: id, finalidade: req.purpose, justificativa/protocolo}) antes do ok(), com 503 se o log falhar (Regra 3); adicionar GET /titulares/{id} ao contrato (hoje a rota nem existe no openapi) com o parâmetro Purpose; teste no bloco da Regra 3 em regras.test.tsx. |
| **Evidência** | api.ts:270-275: 'return ok({ id: titular.id, campos: titular.campos, compartilhamentos: ..., decisao: titular.decisao })' — nenhum auditAppend nem checagem de purpose no case (262-276). |

### Risco-013 — Pseudonimização prometida como HMAC com chave no KMS é SHA-256 com sal público constante no bundle

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-013 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 3 · Segurança de endpoints e PII; 7 · Criptografia, chaves e backup |
| **Classe** | Divergência doc × código |
| **Localização** | `app/src/lib/sha256.ts:73-79`; `db/seed.sql:56`; `db/schema.sql:6, 37`; `app/src/mock/api.ts:310-313, 910-942`; `app/src/mock/scenarios.ts:301`; `.privacy/data-inventory.lastro.yaml:18-21` |
| **Descrição** | sha256.ts:78-79 deriva o índice de busca com sha256(cpf + ':' + sal) e sal default público 'lastro-busca-v1'. Os artefatos de referência prometem outra coisa: seed.sql:56 ('CPF substituído por token HMAC-SHA256 com chave no KMS'), schema.sql:6/37 (pseudônimo HMAC reversível apenas pelo serviço autorizado) e docs/01-arquitetura.md (pseudonymizer HMAC). Há uma tensão de desenho não resolvida: o objetivo declarado 'o CPF digitado nunca sai do navegador' (sha256.ts:76-77) é incompatível com HMAC de chave secreta — chave no cliente é chave pública. A resolução canônica (CPF vai ao backend por TLS e o HMAC é derivado no serviço com chave no KMS) não está escrita em lugar nenhum, e o contrato não tem rota de busca que a modele.<br>**Facete fundida (F-07):** O inventário do repo declara titular_hash como 'HMAC-SHA256 do documento, com chave no KMS. Nunca o documento.' (data-inventory.lastro.yaml:21), e seed/cenários repetem 'HMAC + KMS' (seed.sql:56, scenarios.ts:333). O código real é `hashCpf(cpf, sal = 'lastro-busca-v1')` (sha256.ts:78-79): SHA-256 simples com sal literal, público, versionado e embarcado no cliente — nem HMAC, nem chave, nem KMS. Checklist da categoria 7 ('nunca chave hardcoded') violado na única primitiva criptográfica que o repositório de fato implementa. |
| **Base legal violada** | Art. 12; Art. 46; Art. 6º, VII |
| **Princípio PbD violado** | 3 · Privacidade incorporada ao design; 5 · Segurança de ponta a ponta |
| **Impacto** | Alto — O espaço útil de CPFs (~10^9 com dígitos verificadores) é enumerável em minutos de GPU. Com o sal fixo 'lastro-busca-v1' embarcado no bundle do cliente, qualquer cópia da coluna cpfHash (dump, backup, log de replicação) é reversível em massa: o pilar de pseudonimização que a matriz de risco usa para mitigar R1 ('Pseudonimização HMAC pré-prompt + chave no KMS') não existe no código. O próprio produto reconhece: 'Hash reverte por força bruta — o espaço de CPFs cabe em horas de GPU' (api.ts:312). |
| **Recomendação** | Decidir e documentar o desenho de produção: rota POST /titulares:search no contrato recebendo o CPF por TLS (nunca em URL), com HMAC-SHA-256 derivado no backend com chave no KMS (alias já modelável em /kms/keys, com rotação revogando o índice); no protótipo, anotar hashCpf e o RIPD com a premissa de que o sal público é encenação de demonstração; registrar a linkability do índice atual no threat model LINDDUN.<br>Adicionalmente: Ou implementar HMAC com chave injetada por ambiente (nunca literal no fonte), ou corrigir a declaração do inventário para a realidade do protótipo ('SHA-256 com sal estático de demonstração; produção exige HMAC com chave no KMS') e registrar a divergência como premissa de aceite; nunca reutilizar o sal 'lastro-busca-v1' fora do mock. |
| **Evidência** | sha256.ts:78-79: "export const hashCpf = (cpf: string, sal = 'lastro-busca-v1') => sha256(`${cpf.replace(/\D/g, '')}:${sal}`);" vs. seed.sql:56 'token HMAC-SHA256 com chave no KMS'. — .privacy/data-inventory.lastro.yaml:21 "HMAC-SHA256 do documento, com chave no KMS. Nunca o documento." vs app/src/lib/sha256.ts:78 "export const hashCpf = (cpf: string, sal = 'lastro-busca-v1') =>". |

### Risco-014 — MFA/step-up prometidos em docs, schema e contrato sem nenhuma instrumentação

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-014 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 4 · Autenticação, sessão e tokens |
| **Classe** | Divergência doc × código |
| **Localização** | `docs/01-arquitetura.md:143`; `db/schema.sql:97, 559-560`; `api/openapi.yaml:21-22, 537-540, 759-763`; `app/src/mock/api.ts:829-867, 996-998` |
| **Descrição** | Três camadas prometem e nenhuma executa: docs/01-arquitetura.md:143 (MFA + step-up para eliminação); schema.sql:97 (ator.mfa_ativo) e schema.sql:559-560 (CHECK eliminacao_exige_nivel3); openapi Solicitacao.nivel_verificacao 1-3 com '3 obrigatório para eliminação' (759-763). Mas: (i) nenhuma operação do contrato cria, eleva ou consome verificação — não existe rota de desafio/step-up; (ii) nenhuma resposta 401 é declarada em nenhuma das 25 operações e o securityScheme oidc não tem escopos (537-540); (iii) no mock, POST /v1/requests/{id}/concluir encerra solicitação de eliminação sem consultar nivelVerificacao (api.ts:829-867), e a transição de estados só valida fundamento na recusa (api.ts:996-998). O item do checklist 'verificação descartada após uso' não aparece em artefato algum: nada define retenção/descarte da prova de verificação elevada (ex.: biometria do step-up), que é ela mesma dado sensível (Art. 5º, II / Art. 11). |
| **Base legal violada** | Art. 46; Art. 18; Art. 6º, VII; Art. 49; Art. 11 |
| **Princípio PbD violado** | 3 · Privacidade incorporada ao design; 5 · Segurança de ponta a ponta |
| **Impacto** | Alto — Um pedido de eliminação (Art. 18, VI) pode ser conduzido e concluído sem que nada no contrato ou no fluxo verifique a verificação elevada que o schema exige: um atacante que sequestre a sessão de balcão elimina (ou nega) dados de um titular sem step-up. A promessa 'MFA obrigatório para escopo interno; step-up para eliminação' (docs/01-arquitetura.md:143) não tem nenhuma rota, claim, resposta 401 ou precondição que a realize. |
| **Recomendação** | No contrato: declarar 401 reutilizável, escopos/ACR no securityScheme, uma rota POST /requests/{id}/verification que registre a elevação de nível com expiração curta e descarte da prova após uso, e precondição explícita em concluir eliminação (409 quando nivel_verificacao < 3). No mock: recusar 'concluir' de solicitação com direito 'eliminacao' e nivelVerificacao < 3, espelhando o CHECK do schema, com teste — hoje o CHECK do banco (schema.sql:560) é o único guarda e só vale na inserção, não na condução. |
| **Evidência** | schema.sql:560 'CONSTRAINT eliminacao_exige_nivel3 CHECK (direito <> ''eliminacao'' OR nivel_verificacao = 3)' vs. api.ts:829-867 (bloco concluir sem qualquer referência a nivelVerificacao) e openapi sem 401/step-up. |

### Risco-015 — Fluxo de incidente (Art. 48) existe só no protótipo: sem tabela incidente no schema e sem rota no contrato

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-015 |
| **Severidade** | P1 · Impacto Alto |
| **Categoria** | 13 · Incidentes de segurança |
| **Classe** | Divergência doc × código |
| **Localização** | `db/schema.sql:81-743 (39 CREATE TABLE, nenhum `incidente`)`; `api/openapi.yaml:47-520 (22 paths, nenhum /incidentes)`; `app/src/mock/api.ts:1342-1493` |
| **Descrição** | O app implementa o ciclo completo e bem desenhado do Art. 48 — abertura com escopo lido do catálogo (api.ts:1342-1386), contenção, decisão com fundamento mínimo de 20 caracteres inclusive para não comunicar (:1408-1445), efetivação que recusa contradizer a decisão registrada (:1447-1475), T9 e incidente.bpmn com máquina de estados testada. Mas os dois artefatos de produção não acompanharam: grep de CREATE TABLE em db/schema.sql lista 39 tabelas e nenhuma de incidente (há `solicitacao_titular`, `achado` não, `incidente` não), e grep de 'incident' em api/openapi.yaml retorna vazio. IMPLEMENTACAO.md:266 declara as rotas (`GET/POST /v1/incidentes`, `/decisao` etc.) como entregues, mas o contrato nunca foi atualizado. O mesmo vale para `POST /v1/audit/exportar` (C-06) e as rotas de consentimento, ausentes do contrato — o incidente é o caso mais grave por ser obrigação legal com prazo. |
| **Base legal violada** | Art. 48; Art. 49; Art. 46 |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 3 · Privacidade incorporada ao design |
| **Impacto** | Alto — Se isto for a produção como está: o registro do incidente vive em memória (cenario.incidentes) e desaparece em restart; a única evidência durável seriam linhas esparsas de audit_log sem estado, prazo ou escopo consultável. Um time que implemente o backend a partir do contrato (openapi.yaml, 22 paths) e do schema (39 tabelas) entrega a plataforma sem o processo do Art. 48 que a T9, o BPMN e o handoff prometem. |
| **Recomendação** | Criar em db/schema.sql a tabela `incidente` (tenant_id, estado com CHECK espelhando estados.ts, detectado_em, contido/decidido/comunicado_em, decisao, fundamento, titulares_estimados, risco_id FK, ripd_id FK) + tabela de escopo `incidente_campo` FK para campo(id), com trigger de transição válida como nas demais; adicionar os paths /incidentes ao openapi.yaml espelhando api.ts:1342-1493; incluir teste tipo PR-12 que confere contrato x rotas do mock. |
| **Evidência** | grep 'CREATE TABLE' db/schema.sql → 39 tabelas, nenhuma `incidente`; grep -i 'incident' api/openapi.yaml → 'No matches found'; api.ts:1363 `const id = \`INC-${new Date().getFullYear()}-...\`` vive só em banco.cenario.incidentes (memória). |
| **Achado prévio relacionado** | C-07 |

### Risco-016 — Art. 14 não modelado: perfil infantil sob consentimento sem registro vigente e sem responsável identificado

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-016 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 2 · Minimização e finalidade |
| **Classe** | Lacuna real |
| **Localização** | `app/src/mock/scenarios.ts:668-669, 688-694`; `app/src/mock/types.ts:38-46, 511-521`; `app/src/mock/api.ts:329-334` |
| **Descrição** | O campo m-menor 'perfil_infantil' (scenarios.ts:668) declara baseLegal 'consentimento', mas: (i) o cenário mídia só tem registros de Consentimento para m-inferencia e m-orientacao (scenarios.ts:688-694) — m-menor não tem registro, violando a regra que o próprio validador impõe ('consentimento exige registro vigente', api.ts:329-334); se o campo fosse resubmetido à validação, seria recusado; (ii) a interface Consentimento (types.ts:511-521) não tem campo para o titular responsável (quem consentiu) nem para condição de criança/adolescente — o Art. 14 não existe no modelo, nem no schema SQL (nenhuma coluna/tabela sobre menoridade); (iii) types.ts:44-46 codifica o rol do Art. 11 (BASES_PARA_SENSIVEL), mas nenhuma estrutura equivalente cobre o Art. 14. As proteções existentes são apenas narrativas: gate_finding de exemplo 'menor_sem_verificacao' (scenarios.ts:700) e a etapa de linhagem em prosa (:669). |
| **Base legal violada** | Art. 14; Art. 6º, I |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 7 · Respeito pela privacidade do usuário |
| **Impacto** | Médio — Em fiscalização, o tratamento de dado de criança (perfil_infantil, cenário mídia) não se sustenta: o Art. 14, §1º exige consentimento específico e em destaque de um dos pais, e o sistema não registra quem consentiu, não distingue titular criança/adolescente e nem possui registro de consentimento para o campo — a linhagem apenas narra 'consentimento parental (Art. 14)' em prosa. |
| **Recomendação** | Estender Consentimento com responsavel (quem consentiu) e titular_menor: boolean; semear o registro de consentimento parental de m-menor; adicionar ao validador do inventário (api.ts POST catalog) a regra: campo com titular criança/adolescente exige consentimento parental específico registrado e proíbe finalidades de publicidade comportamental; espelhar a regra no schema (coluna titular da tabela campo já comporta um valor 'crianca_adolescente' + CHECK de base legal). |
| **Evidência** | app/src/mock/scenarios.ts:668 "{ id: 'm-menor', ... nome: 'perfil_infantil', ... baseLegal: 'consentimento', ..." — sem entrada correspondente em consentimentos (scenarios.ts:688-694 lista apenas m-inferencia e m-orientacao). |

### Risco-017 — Anti-enumeração e cotas incompletas: sem paginação/hard limit nas coleções, IDs sequenciais como oráculo e rate limit só na busca

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-017 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 3 · Segurança de endpoints e PII |
| **Classe** | Lacuna real |
| **Localização** | `api/openapi.yaml:1-784`; `app/src/mock/api.ts:146-258, 278-284, 487-489, 882-883, 922-926, 1363`; `app/src/mock/politicas.ts:52-55, 199-202`; `app/src/mock/permissoes.ts:109-111`; `app/src/mock/db.ts:125-135` |
| **Descrição** | Guarda-chuva de 4 itens da mesma natureza: (i) paginação por cursor só existe declarada em /catalog/fields (openapi.yaml:90-104), sem parâmetro limit nem hard limit; GET /gates/runs, /requests, /audit, /kms/keys, /risks e /metrics devolvem arrays sem página; (ii) o mock ignora até esse cursor: GET catalog devolve tudo com hasMore:false (api.ts:278-284), GET audit devolve o trail inteiro (api.ts:487-489), GET requests idem (api.ts:882-883); (iii) totalItems é ocultado de papéis não confiáveis (Regra 6), mas AuditLinha.id é inteiro sequencial (openapi.yaml:771; proximoId++ em db.ts) e o audit_id de resolve idem (openapi.yaml:279) — o volume que a Regra 6 esconde vaza pelo id; o código de incidente INC-AAAA-NNN deriva da contagem (api.ts:1363); (iv) GET /audit e GET /requests não têm acao na tabela de políticas (politicas.ts:52-55 e 199-202), então todos os cinco papéis alcançam o trail completo e a fila de direitos — o bloqueio de 'seguranca' existe só na tela (TELAS_BLOQUEADAS, permissoes.ts:109-111), não na API.<br>**Facete fundida (CAT3-04):** consumirCotaDeBusca (db.ts:125-135, 5/min por ator, consumida antes do find para não virar oráculo — desenho correto) é chamada exclusivamente em buscarTitular (api.ts:922-926). O case POST pseudonyms/resolve (api.ts:146-258), que devolve PII em claro, não tem cota; nenhuma listagem (GET catalog/audit/requests/gates/consentimentos) nem o feed calendario.ics tem. No contrato, a resposta 429 não é declarada em nenhuma operação (o arquivo inteiro só usa 200/201/202/403/404/409/422). |
| **Base legal violada** | Art. 46; Art. 6º, VII; Art. 6º, VIII |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 2 · Privacidade por padrão; 5 · Segurança de ponta a ponta |
| **Impacto** | Médio — O papel não confiável de quem a Regra 6 esconde totalItems lê o volume total por outros caminhos: o id sequencial do trail e o array integral das listagens. Um ator de 'produto' raspa o audit trail inteiro (atores, justificativas, recursoId com titularId/campo) e 'seguranca', bloqueada da tela T4, lê a fila de solicitações de titulares direto pela API. |
| **Recomendação** | Declarar cursor + limit (hard limit servidor, ex.: 100) em toda listagem do contrato e implementar o corte no mock; trocar audit_id/AuditLinha.id por identificador opaco (ULID/UUID) no contrato; gerar código de incidente não derivado da contagem; adicionar acao às políticas de GET /audit (ex.: exportar_auditoria ou nova acao ver_trail) e GET /requests (espelhando TELAS_BLOQUEADAS na API, que é onde a regra vale).<br>Adicionalmente: Generalizar consumirCotaDeBusca para consumirCota(ator, operacao, limite, janela) e aplicá-la em POST /pseudonyms/resolve e nas listagens; declarar uma resposta 429 reutilizável em components/responses do openapi e referenciá-la nessas operações; replicar para resolve o teste de indistinguibilidade do 429 que já existe para a busca (regras.test.tsx:398-416). |
| **Evidência** | openapi.yaml:771 'id: { type: integer }' (AuditLinha) e api.ts:882-883 "case 'GET requests': return ok(banco.cenario.solicitacoes)" — sem página, sem acao de permissão (politicas.ts:199-202). — E3/leitura integral: única chamada de cota é api.ts:922 'if (!banco.consumirCotaDeBusca(ator))'; grep por '429' no openapi.yaml não encontra nenhuma declaração. |

### Risco-018 — Cinco endpoints de ingestão de CI sem identidade de máquina, assinatura HMAC, idempotência ou proteção de replay

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-018 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 3 · Segurança de endpoints e PII |
| **Classe** | Lacuna real |
| **Localização** | `api/openapi.yaml:47-62, 111, 137-158, 174-202, 286-296, 356-368, 602-609` |
| **Descrição** | POST /catalog/inventories (autodescrito 'webhook de push'), /gates/runs, /ripds/triage, /purge/runs e /metrics/snapshots são chamados por workflows de CI, mas compartilham o único securityScheme de usuários (oidc sem escopos, :21-22/:537-540): (i) nenhuma assinatura de webhook (X-Hub-Signature-256), nenhum Idempotency-Key, nenhuma proteção de replay; (ii) /metrics/snapshots aceita 'type: object, additionalProperties: true' (:365-366) e InventarioEntrada.conteudo idem (:609) — os dois únicos pontos do contrato sem allowlist de propriedades; (iii) {repo} é string livre no path sem pattern (:111). O checklist pede webhook como notificação (só ID, consumidor busca via API autenticada); aqui o conteúdo inteiro entra no push. Contraste positivo interno: /telemetry/redaction (:384-405) acerta o desenho — só contagens, com additionalProperties tipado. |
| **Base legal violada** | Art. 46; Art. 6º, III; Art. 6º, VII; Art. 16 |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 5 · Segurança de ponta a ponta |
| **Impacto** | Médio — Qualquer portador de token oidc válido (não há escopos que separem humano de máquina) posta um /purge/runs forjado — fabricando prova de expurgo que nunca aconteceu (Art. 16) — ou re-posta (replay) um run antigo; /metrics/snapshots aceita objeto arbitrário (additionalProperties: true), por onde PII pode entrar sem validação num store que a T1 exibe. |
| **Recomendação** | Declarar securityScheme próprio para máquinas (mTLS ou client-credentials com escopo ci:ingest por rota); exigir cabeçalhos X-Hub-Signature-256 e Idempotency-Key nesses 5 POSTs, documentando janela de replay; adicionar pattern a {repo} (ex.: ^[\w.-]+/[\w.-]+$); fechar os schemas de /metrics/snapshots e InventarioEntrada.conteudo com propriedades nomeadas e additionalProperties: false. |
| **Evidência** | openapi.yaml:365-366 'schema: { type: object, additionalProperties: true }' em POST /metrics/snapshots; :111 '{ name: repo, in: path, required: true, schema: { type: string } }' sem pattern; nenhum header de assinatura em nenhuma das 5 operações. |

### Risco-019 — Nenhuma CSP nem cabeçalho de segurança em nenhuma superfície HTML

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-019 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 5 · Frontend, terceiros e CSP |
| **Classe** | Lacuna real |
| **Localização** | `app/index.html:1-13`; `app/vite.config.ts:1-12`; `prototipo/index.html:1-30` |
| **Descrição** | O checklist exige CSP obrigatória e não há nenhuma: app/index.html (13 linhas) não tem meta Content-Security-Policy nem Referrer-Policy; vite.config.ts não configura server.headers nem plugin de headers; não existe artefato de deploy com headers (_headers, nginx, vercel.json); prototipo/index.html e os *.dc.html do handoff também não têm. grep case-insensitive por 'Content-Security' no repositório inteiro retorna zero ocorrências fora de package-lock.json. Como o app é 100% self-contained (nenhum CDN, fonte ou pixel), uma CSP restritiva seria barata e transformaria a conformidade atual (acidental) em garantia verificável. |
| **Base legal violada** | Art. 46; Art. 6º, VII; Art. 49 |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 2 · Privacidade por padrão; 5 · Segurança de ponta a ponta |
| **Impacto** | Médio — Um XSS (ou dependência npm comprometida no build) executa sem qualquer restrição de origem e exfiltra o que a tela exibe — inclusive valores revelados no rito de 60s da T4 — para um host arbitrário. Hoje o app não carrega nenhum recurso externo (ponto forte), mas nada congela essa propriedade: um script de terceiro adicionado num PR futuro carregaria sem bloqueio, contrariando o default de bloquear tudo. |
| **Recomendação** | Adicionar `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; object-src 'none'; base-uri 'self'">` (ajustando para os inline styles existentes) e `<meta name="referrer" content="no-referrer">` em app/index.html e prototipo/index.html; configurar os mesmos headers em vite.config.ts (server.headers) para o dev server; e acrescentar um check no .github/workflows/ci.yml que falha se app/index.html não contiver a meta CSP — a mesma disciplina de gate que o repo já usa para inventário. |
| **Evidência** | app/index.html:3-8 — head contém apenas charset, icon, viewport e title; grep -ri 'Content-Security' no repo → 0 resultados fora de app/package-lock.json |

### Risco-020 — O gate retranscreve o valor de PII encontrado — no finding enviado ao contrato e no terminal do CI

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-020 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 6 · Logging e auditoria |
| **Classe** | Lacuna real |
| **Localização** | `app/src/lib/gate-privacidade.ts:192-199, 285-289`; `api/openapi.yaml:390-391, 663-673`; `db/schema.sql:298-301`; `db/tests.sql:141-147` |
| **Descrição** | gate-privacidade.ts:197 monta a mensagem do achado com o casamento integral do padrão: mensagem: `${p.nome} em texto claro no log: ${achado[0]}` — achado[0] é o CPF/CNPJ/e-mail/telefone completo encontrado. O schema GateFinding.mensagem_bruta ('Saída original do workflow', openapi.yaml:671) e mensagem_humana ('Tradução exibida na tela T1', :672) institucionalizam o trânsito e a exibição desse valor. O repositório tem o redator pronto (app/src/lib/redator.ts, usado pelo C-04 em todas as justificativas) e não o aplica aqui.<br>**Facete fundida (F6-04):** gate-privacidade.ts:197 monta a mensagem do achado com o valor casado: `mensagem: \`${p.nome} em texto claro no log: ${achado[0]}\``, e `relatorio()` (:285-289) imprime essa mensagem no stdout do CI. O banco de referência decide o contrário duas vezes: schema.sql:298-300 comenta 'A evidência NUNCA carrega o valor encontrado' e impõe `CONSTRAINT finding_sem_pii CHECK (padrao_casado !~ '[0-9]{11}' AND padrao_casado !~ '@[a-z]')`; db/tests.sql:141-147 tem teste dedicado ('CPF vazando na evidência do gate') provando que o INSERT com o valor falha. A implementação TypeScript do mesmo gate diverge da regra que o schema formaliza — e é ela que roda em CI hoje. |
| **Base legal violada** | Art. 6º, III; Art. 6º, VII; Art. 46; Art. 6º, VIII |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 3 · Privacidade incorporada ao design; 5 · Segurança de ponta a ponta |
| **Impacto** | Médio — Um CPF que estava num log de um repositório passa a existir também na mensagem do finding: viaja no POST /gates/runs, é persistido pela plataforma de governança e renderizado nos cartões da T1 para engenharia/segurança — multiplicando as cópias do dado que o gate existe para conter. É exatamente o anti-padrão que a descrição de /telemetry/redaction veta: 'O valor redigido nunca trafega — enviá-lo transformaria a telemetria em um segundo vazamento' (openapi.yaml:390-391). |
| **Recomendação** | Em gate-privacidade.ts, mascarar o valor antes de montar a mensagem (reutilizando app/src/lib/redator.ts ou máscara posicional tipo 999.***.***-**), mantendo arquivo:linha como localizador — o revisor confere no próprio arquivo; anotar em GateFinding.mensagem_bruta que o valor deve chegar redigido e cobrir com teste no bloco do PR 11 (o gate hoje aprova o repo, E3, então o caminho com achado só é exercitado em teste).<br>Adicionalmente: Trocar a mensagem para tipo + posição + valor mascarado (ex.: 'CPF em texto claro (***.***.***-**)' com arquivo:linha, que já são reportados); adicionar em regras.test.tsx um teste espelho do db/tests.sql:144-147: rodar o gate sobre um log com CPF e afirmar que nenhuma mensagem/`relatorio()` contém os dígitos. |
| **Evidência** | gate-privacidade.ts:197: 'mensagem: `${p.nome} em texto claro no log: ${achado[0]}`' vs. openapi.yaml:390-391 (regra do segundo vazamento em /telemetry/redaction). — gate-privacidade.ts:197 `mensagem: \`${p.nome} em texto claro no log: ${achado[0]}\`` vs schema.sql:298 '-- A evidência NUNCA carrega o valor encontrado, apenas o padrão que casou.' + :300 `CONSTRAINT finding_sem_pii CHECK (...)`. |
| **Fechado por (adendo 2026-07-30)** | Fechado — `3fd6bf7`. Provas: `PR 22 · unidade — o inventário decide, e o dígito verificador não` (o caso "a máscara preserva a forma e os extremos, e larga o miolo"), `PR 22 · integração — a varredura cobre o repositório, e a de campo não vazou`. O achado passou a citar valor mascarado: `274.•••.•••-77`. **Resíduo:** o valor íntegro continua nos commits anteriores ao `3fd6bf7`. |

### Risco-021 — Redator não cobre nome, endereço, RG, data de nascimento nem IP — e a massa exibe endereço e IP sem redação

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-021 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 6 · Logging e auditoria |
| **Classe** | Lacuna real |
| **Localização** | `app/src/lib/redator.ts:15-32`; `app/src/mock/scenarios.ts:479-483, 601, 607, 610`; `app/src/screens/T7.tsx:109-127` |
| **Descrição** | O redator (C-04) cobre exatamente cpf, cnpj, cartao, email e telefone (redator.ts:26-32) — nada de nome, endereço/CEP, RG, data de nascimento ou IP. O risco não é teórico no próprio repo: a massa tem endereços completos de titulares (scenarios.ts:601 e :607, valores tipo 'Rua ..., nº — cidade/UF') e IPs (acessosKms, :479-483). A T7 renderiza `a.principal` e `a.origemIp` na tabela do log KMS (T7.tsx:114-117) sem redação — incluindo um IP público e o principal nominal de um colaborador ('user/estagiario.dev') destacado em nota de negativa (:122-127). IP vinculável a pessoa é dado pessoal; os mesmos padrões faltam no gate (PADROES_PII, gate-privacidade.ts:65-87), então as duas linhas de defesa têm a mesma cegueira. C-04 está corrigido no mecanismo (redigir antes do append, usado em todos os campos livres da API) — o que permanece é a cobertura. |
| **Base legal violada** | Art. 5º; Art. 46; Art. 6º, III |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 5 · Segurança de ponta a ponta |
| **Impacto** | Médio — Um atendente digita no fundamento de um incidente 'exposição do endereço Rua X, 123 da titular Marina' — o redator não remove nada, o texto entra no trail imutável (C-04 diz que redigir depois não é opção) e vive para sempre num registro que ninguém pode editar, exportável em CSV. Em paralelo, a T7 exibe IP de origem e principal nominal do log KMS sem qualquer máscara. |
| **Recomendação** | Acrescentar padrões de CEP, RG, data de nascimento e IPv4/IPv6 ao redator (com marca própria por tipo) e os mesmos ao PADROES_PII do gate; na T7, truncar origemIp (ex.: 10.4.2.0/24) para papéis sem `ver_log_kms` pleno ou mascarar o último octeto por padrão; teste com endereço e IP num fundamento provando a remoção. |
| **Evidência** | redator.ts:26-32 lista fechada `cpf\|cnpj\|cartao\|email\|telefone`; T7.tsx:114-117 `<td className="mono" ...>{a.principal}</td> ... <td className="mono">{a.origemIp}</td>` — sem passar por redigir(). |
| **Achado prévio relacionado** | C-04 |

### Risco-022 — Dado pessoal de colaborador fora do regime: sem finalidade/base/retenção no schema e isento do catálogo por exceção do gate

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-022 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 6 · Logging e auditoria; 8 · Retenção e expurgo |
| **Classe** | Lacuna real |
| **Localização** | `db/schema.sql:89-101, 694-703, 743-766, 807-809`; `.privacy/data-inventory.lastro.yaml:17-41`; `app/src/lib/gate-privacidade.ts:92-101`; `.privacy/exemplos/audit-trail.log:8-11`; `app/src/mock/api.ts:1580-1584` |
| **Descrição** | As tabelas da própria plataforma tratam dado pessoal sem os atributos que a tabela `campo` torna NOT NULL para os produtos: (i) ator.nome/email (schema.sql:93-94) sem finalidade/base/retenção; (ii) audit_log guarda ip INET, user_agent e justificativa (756-758) em tabela append-only cujo trigger bloqueia UPDATE/DELETE sem carve-out (807-809) — o método 'compactacao_log' previsto em expurgo_entrada (:627) é inaplicável ao próprio audit_log; (iii) kms_acesso.principal/origem_ip (697-700) idem; (iv) solicitacao_mensagem.corpo retém texto do titular indefinidamente. O inventário do próprio repo (.privacy/data-inventory.lastro.yaml) declara 5 campos, nenhum com retenção. Há tensão legítima entre Art. 37 (registro) e Art. 16, mas ela precisa ser resolvida por prazo declarado + via técnica de término, não por retenção infinita por omissão.<br>**Facete fundida (F6-08):** Registrar o ator é exigência do próprio Art. 37 — o problema não é registrar, é tratar fora do catálogo. A lista NAO_SAO_CAMPOS (gate-privacidade.ts:96-101) classifica `ator`, `papel` e `purpose`/`finalidade` como 'palavras que não são campo de dado pessoal', então o gate nunca exige que sejam declarados; o log de exemplo publica identificadores nominais de colaboradores (formato nome.sobrenome em ator=, .privacy/exemplos/audit-trail.log:8-11); o inventário (.privacy/data-inventory.lastro.yaml) declara titular_hash, campo, recurso, justificativa e cadeia — e não declara ator/papel; e o export CSV (api.ts:1580-1584) entrega ator e papel de todos os operadores a quem tiver `exportar_auditoria`. Nome de empregado é dado pessoal (Art. 5o, I); o tratamento tem base legal sólida (obrigação/legítimo interesse para accountability), mas base legal não declarada e retenção indefinida são exatamente o que o gate reprovaria em qualquer outro campo. |
| **Base legal violada** | Art. 6º, III; Art. 15-16; Art. 37; Art. 5º; Art. 6º, I; Art. 18 |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 3 · Privacidade incorporada ao design; 6 · Visibilidade e transparência |
| **Impacto** | Médio — O IP, o user_agent e a justificativa de cada acesso de operador entram no audit_log e nunca saem: o trigger bloqueia DELETE incondicionalmente e não há prazo declarado. Em anos de operação, a plataforma de privacidade se torna acervo indefinido de dados comportamentais dos próprios funcionários (e do titular, via corpo de solicitacao_mensagem), sem base nem término de tratamento registrados para si mesma. |
| **Recomendação** | Declarar finalidade/base/retenção das tabelas próprias no catálogo do repositório (dogfooding do modelo `campo`); particionar audit_log por mês com selo de fechamento de partição e prever compactação/pseudonimização de ip/user_agent após prazo definido, preservando a verificabilidade da cadeia; dar a kms_acesso e solicitacao_mensagem retenção própria com expurgo_entrada correspondente.<br>Adicionalmente: Declarar `ator` e `papel` no data-inventory.lastro.yaml (categoria pessoal-colaborador, base_legal obrigacao_legal com referência ao Art. 37, retencao alinhada à política de F6-06) e retirar os dois da lista NAO_SAO_CAMPOS, mantendo na lista apenas chaves técnicas (ts, level, hash...); avaliar id funcional pseudônimo no export para papéis não confiáveis. |
| **Evidência** | db/schema.sql:756-758 "justificativa TEXT, ip INET, user_agent TEXT" + :807-809 "CREATE TRIGGER audit_log_imutavel BEFORE UPDATE OR DELETE" — sem qualquer prazo ou via de eliminação. — gate-privacidade.ts:100 `'purpose', 'finalidade', 'ator', 'papel', 'hash', 'protocolo',` dentro de NAO_SAO_CAMPOS; .privacy/exemplos/audit-trail.log:8 contém `ator=<nome.sobrenome> papel=dpo` (identificador nominal de colaboradora). |

### Risco-023 — Ciclo de vida do backup incompleto: chave sem cripto-shredding, sem TTL de snapshot e sem destruição auditada

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-023 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 7 · Criptografia, chaves e backup |
| **Classe** | Lacuna real |
| **Localização** | `db/seed.sql:233`; `app/src/mock/scenarios.ts:86, 466`; `db/schema.sql:610`; `app/src/mock/types.ts:375-381` |
| **Descrição** | O backup só existe em forma registral e incompleta: (i) chave 'alias/backup-rds-v1' com suporta_cripto_shredding=false (seed.sql:233; scenarios.ts:466 idem) — o expurgo por destruição de chave, que sustenta a eliminação nos dados primários, não alcança os snapshots; (ii) não há tabela de snapshot/backup com TTL, nem destruição de backup auditada com hash em nenhum dos 39 modelos; (iii) o schema prevê expurgo_run.origem='pos_restore' (:610), mas o tipo do mock omite 'pos_restore' (types.ts:378) e nenhum seed/cenário o exercita; (iv) o risco R10 aparece 'mitigado' apenas com 'Habilitar SSE-KMS nos snapshots' (seed.sql:171), o que não cobre TTL nem expurgo pós-restore. |
| **Base legal violada** | Art. 46; Art. 15-16; Art. 6º, VIII |
| **Princípio PbD violado** | 5 · Segurança de ponta a ponta |
| **Impacto** | Médio — Um restore de snapshot devolve registros já expurgados — cenário descrito pelo próprio repo no texto do R10 ('Restauração devolve dado já eliminado') — e nada o detecta: a chave de backup não suporta cripto-shredding, não há tabela de snapshots com TTL nem evidência de destruição com hash, e o fluxo pos_restore existe no schema mas nunca é exercitado. |
| **Recomendação** | Modelar backup_snapshot (chave_id, criado_em, ttl, destruido_em, destruicao_hash) com trigger de imutabilidade; exigir suporta_cripto_shredding=true para chave de finalidade 'backup' que cubra PII (CHECK ou validação de ingestão); adicionar 'pos_restore' ao tipo ExpurgoRun do mock e semear um run pos_restore demonstrável; reabrir R10 até que TTL e destruição auditada existam. |
| **Evidência** | db/seed.sql:233 "'alias/backup-rds-v1','arn:...','backup','ativa', now() - INTERVAL '200 days', current_date + 5, false"; app/src/mock/scenarios.ts:86 R10 danoTexto 'Restauração devolve dado já eliminado' com status 'mitigado'. |

### Risco-024 — A prova do expurgo e o espelho do KMS são mutáveis: bloqueia_mutacao cobre 3 tabelas e gov_app tem UPDATE em todas

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-024 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 8 · Retenção e expurgo |
| **Classe** | Lacuna real |
| **Localização** | `db/schema.sql:621-637, 694-703, 807-817, 902` |
| **Descrição** | Os triggers bloqueia_mutacao existem apenas em audit_log, risco_reclassificacao e linhagem (schema.sql:807-817). Ficam mutáveis: expurgo_run e expurgo_entrada (a evidência hash do expurgo, :621-637), kms_acesso (:694-703), solicitacao_evento e gate_finding. Agrava o GRANT amplo 'SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA gov TO gov_app' (:902): a única proteção contra reescrita de evidência é o trigger — e onde ele não existe, não há nada. tests.sql só exercita o append-only das 3 tabelas protegidas (:115-117). |
| **Base legal violada** | Art. 6º, X; Art. 37; Art. 16 |
| **Princípio PbD violado** | 5 · Segurança de ponta a ponta; 6 · Visibilidade e transparência |
| **Impacto** | Médio — Um operador (ou atacante) com a role gov_app reescreve hash_pre/hash_pos de expurgo_entrada depois de um expurgo que falhou, e o relatório continua 'íntegro' — a evidência de eliminação, que é o argumento central da T6, é editável sem quebrar cadeia nenhuma. O mesmo vale para kms_acesso (espelho do CloudTrail) e solicitacao_evento. |
| **Recomendação** | Estender bloqueia_mutacao (UPDATE/DELETE) a expurgo_run, expurgo_entrada, kms_acesso, solicitacao_evento e gate_finding; substituir o GRANT UPDATE ON ALL TABLES por grants por tabela; para os campos de verificação legítimos de expurgo_entrada (verificado_em/verificado_por/integro), expor função SECURITY DEFINER de escrita única em vez de UPDATE direto; adicionar os casos correspondentes a db/tests.sql. |
| **Evidência** | db/schema.sql:902 "GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA gov TO gov_app;" — triggers de imutabilidade só em :807-817 (audit_log, risco_reclassificacao, linhagem). |

### Risco-025 — O inventário do próprio repositório é subconjunto pobre do modelo que o repositório prega — e o gate valida só o nome do campo

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-025 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 9 · Catálogo, ROPA e linhagem |
| **Classe** | Lacuna real |
| **Localização** | `.privacy/data-inventory.lastro.yaml:17-41`; `app/src/lib/gate-privacidade.ts:54, 103-107, 178`; `api/openapi.yaml:579-592`; `db/schema.sql:153-182` |
| **Descrição** | Divergência entre o que o repo prega e o que ele pratica consigo mesmo: (i) o schema Campo do contrato exige nome, categoria, base_legal e retencao (openapi.yaml:581) e a tabela campo exige titular, finalidade, base_legal e retencao NOT NULL (schema.sql:160-165); o inventário do próprio repo (.privacy/data-inventory.lastro.yaml) tem 5 campos apenas com nome/categoria/base_legal/observacao — sem finalidade, retencao, sensivel, titular; (ii) o gate tipa esses atributos como opcionais (gate-privacidade.ts:105) e usa somente `c.nome` para montar o catálogo (:178) — nunca valida completude; (iii) a varredura de PII e de campo-fora-do-catálogo se restringe a PADROES_DE_LOG (:54) mais caminhos declarados: E3 confirma '1 arquivo(s) de log varrido(s). Nenhum achado.'. O item do checklist 'campo novo registrado no catálogo antes de produção com CI bloqueando' vale, na prática, só para logs de exemplo e só para o nome. |
| **Base legal violada** | Art. 37; Art. 6º, I |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 6 · Visibilidade e transparência |
| **Impacto** | Médio — Um desenvolvedor declara um campo novo no YAML apenas com o nome: o gate aprova sem finalidade, base legal ou prazo — a promessa 'campo sem base legal não entra no ROPA' não vale para o inventário do próprio repositório. E como a varredura de PII só olha caminhos de log (1 único arquivo no repo inteiro, E3), as 40 ocorrências de CPF formatado em código, seeds e HTML (E5) passam verdes. |
| **Recomendação** | Fazer o gate validar cada entrada do inventário contra o mesmo shape do schema Campo do contrato (reprovar entrada sem finalidade/base_legal/retencao/categoria); completar .privacy/data-inventory.lastro.yaml com os atributos faltantes; estender a varredura de PII a todo o repositório com allowlist explícita de fixtures de teste, em vez de varrer apenas caminhos de log. |
| **Evidência** | E3: `cd app && npm run gate:privacidade` → APROVADO, '1 arquivo(s) de log varrido(s). Nenhum achado.'; gate-privacidade.ts:178 "const catalogo = new Set((inventario.campos ?? []).map((c) => String(c.nome).toLowerCase()));". |

### Risco-026 — Controles de LLM externo sem verificação executável: SHAP sem PII por comentário, auditoria por execução e não por chamada

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-026 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 10 · Governança de ML/IA |
| **Classe** | Lacuna real |
| **Localização** | `db/schema.sql:596`; `db/seed.sql:86, 136-139`; `app/src/mock/scenarios.ts:332` |
| **Descrição** | Guarda-chuva dos controles de LLM que existem como intenção e não como regra: (1) revisao_decisao.shap_resumo é JSONB com o comentário "top features, sem PII" (schema.sql:596) sem CHECK — contraste com mensagem_sem_cpf, que na mesma seção É constraint (schema.sql:584); (2) a auditoria do envio ao LLM é por run agregado (linhagem llm_enrichment, 41.893 linhas por execução — seed.sql:86), não por chamada: o checklist pede auditoria de cada chamada a LLM externo; (3) nenhum gatilho de RIPD (T1-T10, seed.sql:136-139) nem recomendação exige teste de extração/membership inference antes do LLM em produção; (4) sanitização pós-inferência inexistente — o redator (app/src/lib/redator.ts) cobre logs e justificativas, não respostas de modelo. Reconhecidos os fortes: pseudonimização HMAC pré-prompt declarada, SCC com hash, revisão Art. 20 com prova no mock e no schema. |
| **Base legal violada** | Art. 46; Art. 37; Art. 48; Art. 20 |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 5 · Segurança de ponta a ponta |
| **Impacto** | Médio — Um revisor grava em shap_resumo um JSON com nome ou documento do titular e nada recusa (o "sem PII" é comentário); num incidente com a OpenAI, a linhagem por run agregado não responde quais titulares foram enviados em qual chamada, inviabilizando a comunicação dirigida do Art. 48. |
| **Recomendação** | Adicionar CHECK em revisao_decisao proibindo padrão de CPF/e-mail no shap_resumo::text e restringindo as chaves ao formato top_features (com invariante em db/tests.sql); granularidade por chamada na linhagem (run_id + sequência + hash dos pseudônimos enviados); novo gatilho de RIPD para LLM externo exigindo teste de extração e sanitização pós-inferência documentados como evidência. |
| **Evidência** | schema.sql:596 "shap_resumo JSONB, -- top features, sem PII" (comentário, sem constraint) vs schema.sql:584 "CONSTRAINT mensagem_sem_cpf CHECK (corpo !~ ...)" |

### Risco-027 — Eliminação sem vínculo verificável entre a solicitação do titular e o expurgo que a materializa

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-027 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 12 · Direitos dos titulares |
| **Classe** | Lacuna real |
| **Localização** | `db/schema.sql:606-619`; `app/src/mock/api.ts:829-867` |
| **Descrição** | O expurgo tem origem 'solicitacao_titular' (schema.sql:610) e entradas com hash_pre/hash_pos verificados (:630-636) — fortes. Mas expurgo_run não tem FK para solicitacao_titular: quando a origem é solicitação, nada liga o run ao protocolo. No mock, POST /requests/{id}/concluir (api.ts:829-867) exige fundamento >= 20 caracteres apenas para a recusa (:844); o desfecho 'atendido' de uma eliminação aceita evidência vazia — o ato que deveria carregar a prova da eliminação (Art. 18 VI) não a exige. |
| **Base legal violada** | Art. 18; Art. 15-16; Art. 6º |
| **Princípio PbD violado** | 5 · Segurança de ponta a ponta; 6 · Visibilidade e transparência |
| **Impacto** | Médio — O DPO conclui a solicitação de eliminação como 'atendido' com texto livre; seis meses depois, a auditoria não consegue ligar o protocolo a nenhum expurgo_run com hash pré/pós verificado — a eliminação é afirmação, não evidência. |
| **Recomendação** | Adicionar solicitacao_id UUID REFERENCES solicitacao_titular(id) em expurgo_run com CHECK (origem <> 'solicitacao_titular' OR solicitacao_id IS NOT NULL) + invariante em db/tests.sql; no mock, concluir com desfecho 'atendido' para direito='eliminacao' deve exigir referência a um expurgo com entradas verificadas, devolvendo 422 sem ela. |
| **Evidência** | schema.sql:610 "origem ... CHECK (origem IN ('cron','manual','solicitacao_titular','pos_restore'))" — tabela sem coluna solicitacao_id; api.ts:844 exige fundamento só "if (desfecho === 'recusado_com_fundamento' ...)" |

### Risco-028 — Plano de resposta a incidente como runbook testável não existe: o BPMN é máquina de estados, não plano

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-028 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 13 · Incidentes de segurança |
| **Classe** | Lacuna real |
| **Localização** | `docs/processos/incidente.bpmn:1-63`; `docs/processos/README.md:58`; `.github/:sem PULL_REQUEST_TEMPLATE` |
| **Descrição** | O que existe é forte no seu escopo: máquina de estados documentada (incidente.bpmn) com teste de conformidade bidirecional, decisão com fundamento obrigatório, trilha derivada do trail (T9.tsx:83-103). O que falta para o checklist: (a) runbook operacional — papéis e contatos de acionamento, passos de contenção por tipo de incidente, orientação de preservação de evidência (a cadeia de custódia hoje é implicitamente o próprio audit trail, que sofre da lacuna F6-02 justamente no campo narrativo), template de comunicação ANPD/titulares; (b) exercício/simulado — nenhum registro, ação de trail (ex.: SIMULADO_EXECUTADO) ou agenda T10 prevê testar o plano; (c) análise de cenário de incidente em review — o vínculo incidente→risco→RIPD existe a posteriori (T9 mostra 'Risco previsto' e RIPD relacionado), mas não há item de checklist de PR/review que pergunte 'que incidente este código habilita' (não existe PULL_REQUEST_TEMPLATE nem pergunta equivalente no épico PbD). |
| **Base legal violada** | Art. 46; Art. 48; Art. 49 |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 5 · Segurança de ponta a ponta |
| **Impacto** | Médio — Às 2h de um sábado, o plantão descobre exfiltração. O repositório responde 'aberto → contido → decidido' e quem pode clicar em cada botão — mas não diz quem acionar, como preservar evidência forense antes de conter (conter destrói prova), o que escrever à ANPD/titulares, nem nunca ensaiou o processo. O primeiro incidente real é também o primeiro teste do plano. |
| **Recomendação** | Criar docs/processos/incidente-runbook.md com: matriz de acionamento por papel (reusando o RACI da T5), passos de contenção com nota de preservação de evidência antes de conter, template das duas comunicações do Art. 48, e exercício semestral cujo resultado entra no trail com ação própria e no calendário T10; adicionar .github/PULL_REQUEST_TEMPLATE.md com item 'cenário de incidente considerado' ligado ao épico PbD. |
| **Evidência** | incidente.bpmn:10-12 declara de propósito que o arquivo só descreve estados/transições ('O que este arquivo NÃO diz... é validação e vive em api.ts'); nenhum runbook/simulado em docs/ (grep -i 'runbook\|simula' → apenas simulação de violação da T1). |

### Risco-029 — /pseudonyms/resolve: contrato e implementação divergem em corpo, códigos e no vínculo de posse

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-029 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 3 · Segurança de endpoints e PII |
| **Classe** | Divergência doc × código |
| **Localização** | `api/openapi.yaml:248-284`; `app/src/mock/api.ts:146-258` |
| **Descrição** | Divergências verificadas: (i) contrato exige {token, campo, justificativa} (:261-268); mock usa {titularId, campo, justificativa, protocolo} (api.ts:148-150); (ii) o vínculo protocolo↔titular — ponto forte do código (api.ts:224-234, recusa 'protocolo de outro titular') — não tem campo correspondente no contrato; (iii) contrato promete 403 para 'finalidade não autorizada... ou justificativa insuficiente' (:283-284); mock responde 422 nesses casos (api.ts:196-198, 213-215) e reserva 403 para ausência de X-Purpose/permissão — distinção deliberada e melhor que a do contrato; (iv) as recusas C-17 (fora do catálogo, api.ts:179-182) e C-08 (consentimento revogado, api.ts:207-210) não existem no contrato; (v) contrato devolve expira_em + Cache-Control: no-store (:277-282), mock devolve expiraEmSegundos sem modelar o cabeçalho (api.ts:254). |
| **Base legal violada** | Art. 49; Art. 37; Art. 6º, VI |
| **Princípio PbD violado** | 3 · Privacidade incorporada ao design; 6 · Visibilidade e transparência |
| **Impacto** | Médio — Quem implementar o backend pelo contrato perde controles que o produto já provou: sem o campo protocolo no requestBody, a checagem de posse (revelar só sob solicitação do próprio titular, T4-01) não é exigível; e o 403 prometido para 'justificativa insuficiente' recriaria a confusão semântica que o mock resolveu com 422. |
| **Recomendação** | Atualizar o openapi de /pseudonyms/resolve para o comportamento vencedor do mock: requestBody com protocolo obrigatório; respostas 422 distintas (finalidade incompatível, consentimento revogado, campo fora do catálogo, protocolo de outro titular, justificativa curta) separadas do 403 (sem X-Purpose/sem permissão); e estender a verificação 'documento × código' do PR 14 (bloco em regras.test.tsx) para cobrir o contrato, não só o MAPA. |
| **Evidência** | openapi.yaml:264 'required: [token, campo, justificativa]' vs. api.ts:148-150 'const { titularId, campo, justificativa, protocolo } = body' e api.ts:229-234 (posse protocolo↔titular ausente do contrato). |

### Risco-030 — Protótipo estático contradiz a doutrina do repositório: PII em claro no DOM, registro prometido e não feito, gate por CSS, busca inerte

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-030 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 5 · Frontend, terceiros e CSP |
| **Classe** | Divergência doc × código |
| **Localização** | `prototipo/index.html:78-79, 99, 118, 142-143, 353-356, 783-850, 922-928, 1290-1314, 1466-1499`; `README.md:115-119`; `docs/design_handoff_lastro_correcoes/IMPLEMENTACAO.md:337-338` |
| **Descrição** | Quatro contradições no mesmo artefato, nunca corrigidas (git log: intocado desde o commit 44cc025, anterior aos 13 PRs): (i) PII fictícia em claro em data-value dos .masked (CPFs nas linhas 783/792/801/841, nome/e-mail/renda/score em 840-850) — o mascaramento é só de exibição; (ii) o diálogo de revelação afirma 'A revelação é registrada no audit trail com seu nome, a finalidade e os campos' (linha 1294) e o botão diz 'Revelar e registrar' (1311), mas o handler (1475-1499) descarta finalidade e justificativa e não registra nada; (iii) gate por papel via CSS `display: none` (353-356) — exatamente o que README.md:117-118 declara que 'não sobrevive a uma auditoria de código'; (iv) a busca por CPF (922-928) promete 'envia apenas o hash' mas o botão não tem handler algum — controle inerte sem a marca NaoImplementado que o app adota (C-15). IMPLEMENTACAO.md:337-338 mandava conferir o protótipo estático ao terminar os PRs; não foi feito.<br>**Facete fundida (F-10):** IMPLEMENTACAO.md:337-338 determina: "confira o protótipo estático prototipo/index.html: os itens de tipografia, ARIA e layout (C-09, C-11, C-12, C-14) valem para ele também". O C-14 foi aplicado (breakpoint @media max-width:1180px em prototipo/index.html:137), mas o C-11 não: font-size 10.5px (:79), 11px (:78, :87, :99, :118, :143) e 11.5px (:89, :142) permanecem no cromo do estático, abaixo do piso de 12,5px que o app trava por teste (regras.test.tsx:1776). |
| **Base legal violada** | Art. 6º, VI; Art. 9º; Art. 46; Art. 6º |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 3 · Privacidade incorporada ao design; 6 · Visibilidade e transparência; 7 · Respeito pela privacidade do usuário |
| **Impacto** | Médio — Um designer ou dev usa a 'referência visual congelada' (README.md:45) como base de uma tela nova com dados reais e copia o padrão: valores de titular em atributos data-value, mascaramento só de exibição e gate por display:none. DevTools revela CPF, nome, e-mail e renda sem finalidade, sem justificativa e sem linha de auditoria. Dados aqui são fictícios (por isso não é P1), mas o artefato ensina exatamente o padrão que o README condena e faz afirmações de segurança falsas. |
| **Recomendação** | Aplicar ao prototipo/index.html o tratamento mínimo: (a) trocar as afirmações falsas — remover 'é registrada no audit trail' e 'envia apenas o hash' ou marcar os controles com a marca 'não implementado' equivalente ao padrão C-15 do app; (b) substituir os valores de data-value por máscaras estáticas sem valor (o reveal pode exibir um placeholder '(simulado)'); (c) adicionar banner no topo: 'Referência visual — controles simulados; o controle de acesso real é o do app/ (Permitido devolve null)'. Alternativa mais barata: nota de obsolescência no README apontando as divergências.<br>Adicionalmente: Elevar o piso tipográfico do prototipo/index.html a 12,5px (mesmos tokens do app) ou emendar IMPLEMENTACAO.md:337-338 e o README declarando o estático explicitamente congelado pré-correções e não-normativo. |
| **Evidência** | prototipo/index.html:1294 'A revelação é registrada no audit trail…' vs. handler 1475-1499 que não grava nada; :353-356 `body[data-role="produto"] [data-only="dpo"] … { display: none; }` vs. README.md:117-118 'Nem display:none, nem disabled' — prototipo/index.html:79 ".rail-group { font-size: 10.5px; ... }" vs IMPLEMENTACAO.md:337-338 "os itens de tipografia... (C-09, C-11, C-12, C-14) valem para ele também" |
| **Achado prévio relacionado** | C-11 |

### Risco-031 — Promessas de arquitetura sem instrumento no app: k-anonimato (k≥5) e data-hj-suppress

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-031 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 6 · Logging e auditoria |
| **Classe** | Divergência doc × código |
| **Localização** | `docs/01-arquitetura.md:136, 144`; `db/schema.sql:711-723`; `app/src/mock/scenarios.ts:510`; `app/src/ui/primitivos.tsx:200-355`; `app/src/screens/T4.tsx:280-340` |
| **Descrição** | A promessa aparece em docs/01-arquitetura.md:144 ('supressão k-anonimato (k≥5) nas quebras'), em schema.sql:718 (comentário: 'supressão k-anonimato aplicada na origem (k >= 5)') e na linhagem da massa (scenarios.ts:510 'agregação k≥5 · células suprimidas'). Não existe instrumento em nenhum lugar: nenhum CHECK/constraint sobre `dimensoes` no schema, nenhuma função de supressão no app, nada na T1/métricas, nenhum alerta de supressão (o checklist pede supressão *alertada*). O único código que toca o tema é a validação de catálogo (api.ts:312) que recusa hash como 'anonimizado' citando k-anonimato — regra correta, mas que valida rótulo de campo, não dashboards. É promessa sem mecanismo, do tipo que o próprio repo chama de teatro.<br>**Facete fundida (F5-HJ-SUPPRESS):** docs/01-arquitetura.md:136 lista como controle de privacidade embutido do frontend: 'Mascaramento por padrão, toggles `false`, re-mascaramento por TTL, `data-hj-suppress` nas áreas de titular'. Três dos quatro estão implementados e verificados (CampoPII mascara por padrão, toggles nascem desligados em T2.tsx:336/447, TTL por relógio em primitivos.tsx:214-234). O quarto não existe: grep por data-hj-suppress/hotjar no repositório retorna apenas a própria linha do doc — nem CampoPII nem os painéis da T4 marcam supressão. Além disso, prometer o atributo pressupõe uma ferramenta de session-replay de terceiro no design de produção sem nenhuma menção a consentimento, contrato de operador ou entrada na CSP. |
| **Base legal violada** | Art. 12; Art. 6º, III; Art. 6º, VI; Art. 46 |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 2 · Privacidade por padrão; 3 · Privacidade incorporada ao design; 4 · Funcionalidade total (soma positiva) |
| **Impacto** | Médio — Uma quebra de métrica por dimensão rara (ex.: solicitações Art. 18 por município pequeno) entra em metric_snapshot.dimensoes com contagem 1 e aparece no dashboard: reidentificação por célula única, exatamente o que a promessa de supressão k≥5 existe para impedir. Como a categoria 'anonimizado' do catálogo depende dessa agregação (Art. 12), a promessa vazia contamina a alegação de anonimização. |
| **Recomendação** | Implementar a supressão no caminho das métricas do mock (função que oculta dimensão com contagem <5, substituindo por '<5 · suprimido', com aviso visível na T1 quando houver supressão) + teste; no schema, documentar o contrato como constraint verificável (ex.: função de validação de `dimensoes` usada pelo collector) — ou remover as três promessas até que o instrumento exista.<br>Adicionalmente: Escolher um dos lados e alinhar: (a) adicionar data-hj-suppress ao wrapper de CampoPII (primitivos.tsx) e aos tabpanels de dados da T4, com teste em regras.test.tsx afirmando a presença do atributo; ou (b) remover a promessa de 01-arquitetura.md:136 e registrar que ferramenta de session-replay só entra no design mediante consentimento, contrato de operador e entrada explícita na allowlist da CSP (F2). |
| **Evidência** | docs/01-arquitetura.md:144 '\| Observabilidade \| ... \| Séries agregadas; supressão k-anonimato (k≥5) nas quebras \|'; grep -i 'supress\|suprim\|kanon' em app/src → única ocorrência é o rótulo estático scenarios.ts:510. — grep -rni 'data-hj-suppress\|hotjar' → única ocorrência: docs/01-arquitetura.md:136 '`data-hj-suppress` nas áreas de titular' |

### Risco-032 — Documentos e cenários afirmam TTL/expurgo operantes que o código não contém — inclusive como evidência verde do PbD

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-032 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 8 · Retenção e expurgo |
| **Classe** | Divergência doc × código |
| **Localização** | `.privacy/epico.yml:45-50`; `app/src/mock/scenarios.ts:252`; `db/seed.sql:165, 276`; `app/src/lib/gate-privacidade.ts:251-261` |
| **Descrição** | Afirmações de retenção operante sem correspondência no código: (i) epico.yml:45-50, princípio ciclo_de_vida com evidência db/schema.sql e nota 'RLS por tenant, TTL por dataset e cripto-shredding por chave' — o schema não define TTL nenhum (ver F-01); (ii) scenarios.ts:252 repete 'db/schema.sql · TTL e cripto-shredding' como evidência do épico semeado; (iii) seed.sql:165 marca R4 'mitigado' com tratamento 'TTL policies no PostgreSQL + job de expurgo diário' e seed.sql:276 registra maturidade com 'TTL em 83 de 88 datasets' — nada disso existe em artefato executável; (iv) as etapas de linhagem dos campos ('Expurgo: 5 anos' etc., scenarios.ts:323 em diante) narram um descarte que nenhum componente realiza. |
| **Base legal violada** | Art. 6º, X; Art. 15-16 |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 6 · Visibilidade e transparência |
| **Impacto** | Médio — O DPO apresenta o épico com o princípio 'ciclo_de_vida' marcado e evidência apontando db/schema.sql ('TTL por dataset'); o auditor abre o arquivo e não encontra TTL algum. O checklist de PbD — que o repo vende como 'marca sem evidência é reprovação' — aceita evidência que não sustenta a marca, porque o gate só confere que o arquivo existe (gate-privacidade.ts:251-261), não o que ele contém. E o risco R4 consta 'mitigado' por controle inexistente. |
| **Recomendação** | Trocar a evidência do ciclo_de_vida no epico.yml para o que de fato existe (domínio retencao, expurgo_run/expurgo_entrada, cripto-shredding registrado) ou implementar o TTL (F-01); reabrir R4 no seed/cenários até existir executor; evoluir o gate para validar conteúdo mínimo da evidência (âncora de linha ou nome de teste presente no alvo), não apenas a existência do arquivo. |
| **Evidência** | .privacy/epico.yml:47-50 "evidencia: db/schema.sql / nota: RLS por tenant, TTL por dataset e cripto-shredding por chave" — grep 'TTL' em db/schema.sql: nenhuma ocorrência (só em seed.sql como texto). |

### Risco-033 — READMEs negam o próprio repositório: “não há CI”, “26 testes”, “8 telas”

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-033 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 10 · Governança de ML/IA |
| **Classe** | Divergência doc × código |
| **Localização** | `README.md:24-25, 38, 45, 59, 102, 173, 204, 229-230`; `app/README.md:3, 9, 28` |
| **Descrição** | Sub-itens verificados no HEAD: (1) README.md:229-230 "**Não há CI neste repositório.**" — falso desde o PR de C-18: existem .github/workflows/ci.yml e privacy-ci-gate.yml; (2) "26 testes" em README.md:24, :25, :59, :186, :204 e app/README.md:9 — a suíte tem 309 testes (E2: 305 passam + 4 falham); (3) "8 telas"/"T1..T8" em README.md:38, :45, :102, :173, :185 e app/README.md:3, :28 — app/src/screens/ tem 12 telas (T0-T10 + ComoFunciona), incluindo a T9 de incidentes (Art. 48) que o README nem menciona; (4) README.md:204 "26 testes, bundle de 322 kB" congela números de verificação antigos como se fossem atuais. |
| **Base legal violada** | Art. 6º |
| **Princípio PbD violado** | 6 · Visibilidade e transparência |
| **Impacto** | Médio — Um avaliador ou auditor que confie no README conclui que o repositório não tem gate de CI (tem dois workflows), que a suíte tem 26 testes (tem 309) e que o app tem 8 telas (tem 12, incluindo T9 de incidente Art. 48 e T0/T10) — a prova de conformidade existente fica invisível e a doc raiz falha o critério que o próprio projeto impõe aos documentos (PR 12/14: documento que diverge do código reprova). |
| **Recomendação** | Atualizar os dois READMEs (contagem de testes, lista das 12 telas, remover o parágrafo "Não há CI" citando os dois workflows e sua limitação de required check); melhor: aplicar o padrão declarado×derivado do PR 13/14 — teste em regras.test.tsx que extrai do README os números citados e os compara com screens/ e com a suíte, como já se faz com o MAPA. |
| **Evidência** | README.md:229 "**Não há CI neste repositório.**" vs ls .github/workflows/ = ci.yml, privacy-ci-gate.yml; README.md:59 "npm test # 26 testes" vs E2 (309 testes) |
| **Fechado por (adendo 2026-07-30)** | Fechado — `89593bf`. Provas: `PR 33 · Risco-033 — o README conferido contra o repositório que descreve`; os números do README passaram a ser mantidos, não redigitados. **Transcrição travada nos dois sentidos:** a tabela de telas contra `TELAS` em `App.tsx` (o array que monta o trilho — tela fora dele não é alcançável, e por isso ele é a definição operante) e a de workflows contra `.github/workflows`. **Contagem exata derivada** para tabelas, visões, invariantes e operações do contrato, cada uma marcada por `<!-- n:rotulo -->` colado ao número: casar por vizinhança de palavra conferiria o número errado assim que a frase fosse reescrita. **Piso com ordem de grandeza** só para a contagem da suíte, que é a única vinda de execução — travá-la no exato faria o README mudar a cada PR, e arquivo que muda a cada PR deixa de ser lido; `26` passa no piso e reprova no teto, que é o defeito literal desta ficha. A frase do CI virou seção com os seis workflows, e não é só o contrário da antiga: nomeia `Varreduras de prazo` como o job que **não** deve ser marcado. **Escopo declarado:** `docs/01-arquitetura.md` e `docs/02-wireframes.md` mantêm “T1..T8” de propósito — descrevem o desenho de então, e documento que narra o projeto daquele momento não nega o repositório. |

### Risco-034 — Contrato OpenAPI congelado pré-correções: as rotas dos PRs 4–13 existem só no mock

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-034 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 12 · Direitos dos titulares |
| **Classe** | Divergência doc × código |
| **Localização** | `api/openapi.yaml:46-534, 747-766`; `app/src/mock/api.ts:568, 625, 674, 679, 722, 747-760, 816-829` |
| **Descrição** | O contrato mantém os mesmos 22 paths de antes das correções, enquanto o mock implementa rotas inteiras sem representação contratual: POST /v1/requests/{id}/concluir com desfecho/fundamento (api.ts:829, T4-02), POST /v1/decisoes/{id}/revisar (api.ts:568, Art. 20), GET/POST /v1/consentimentos e .../revogar (api.ts:816-822, C-08), GET/POST /v1/incidentes com máquina de decisão de comunicação (api.ts:747-760, C-07/Art. 48), POST /v1/estados/{artefato}/{id} (PR 7), GET /v1/fila (PR 9), GET /v1/calendario + feed ICS (PR 10), GET /v1/epicos (PR 11), POST /v1/titulares/buscar (C-01) e POST /v1/audit/exportar (C-06). O schema Solicitacao do contrato (:747-766) não tem desfecho, fundamento nem os status recusada_com_fundamento — o contrato descreve a fila que os achados T4-01/T4-02 condenaram. |
| **Base legal violada** | Art. 49; Art. 18; Art. 20; Art. 48 |
| **Princípio PbD violado** | 3 · Privacidade incorporada ao design; 6 · Visibilidade e transparência |
| **Impacto** | Médio — Quem implementar o backend a partir do contrato — o uso declarado do openapi.yaml — reconstrói o sistema anterior ao handoff: sem concluir solicitação (o SLA volta a correr para sempre, T4-02), sem revisão Art. 20 com prova, sem consentimento revogável, sem processo de incidente Art. 48. |
| **Recomendação** | Atualizar api/openapi.yaml com as rotas e schemas do mock (concluir, revisar, consentimentos, incidentes, estados, fila, calendário, épicos, buscar, exportar) e travar com um teste estilo PR 14: extrair os paths do switch de api.ts e comparar com os paths do contrato, falhando em rota órfã de qualquer lado. |
| **Evidência** | api/openapi.yaml sem /incidents, /consents, /decisions/{id}/review ou /requests/{id}/close (22 paths) vs api.ts:747 "case 'GET incidentes'" / :829 "case 'POST requests'" (concluir) |
| **Fechado por (adendo 2026-07-30)** | Fechado — `f86020e`. Prova: `PR 16 · invariante de paridade — contrato e mock, nos dois sentidos (Risco-034)`. A paridade é bidirecional e não-vacuosa: operação no contrato sem linha em `rotas.ts` reprova, linha em `rotas.ts` sem operação no contrato reprova, e quem não é servida declara o motivo numa lista fechada. É o que impede o mock de voltar a andar na frente do contrato. |

### Risco-035 — modoDemo=true embarcado por padrão mantém viva a rota de forja do trail e as afordâncias de ataque

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-035 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 3 · Segurança de endpoints e PII; 13 · Incidentes de segurança |
| **Classe** | Limitação de protótipo |
| **Localização** | `app/src/mock/db.ts:42-51, 149-153`; `app/src/mock/api.ts:503-521`; `app/src/App.tsx:174-185`; `app/src/screens/T6.tsx:239-263` |
| **Descrição** | banco.modoDemo é um campo de classe com default true (db.ts:51), não amarrado a import.meta.env nem a build de produção. A rota POST /v1/audit/forjar (api.ts:505-519) existe enquanto o campo for true e exige apenas 'escrever' — as duas condições estão bem construídas (404 fora do modo, re-checagem de permissão dentro, testadas em regras.test.tsx:447-495), mas nada garante que o default vire false fora da demonstração. A UI condiciona os controles de simulação ao mesmo campo (App.tsx:176).<br>**Facete fundida (F13-04):** A defesa em duas condições é real e testada: fora do modoDemo a rota devolve 404 (api.ts:510-513, teste regras.test.tsx:459-464) e mesmo dentro dele exige `escrever` (:514-516); os botões da T6 só aparecem sob as duas condições (T6.tsx:241). Mas `modoDemo = true` é literal hard-coded (db.ts:51), nenhum código de produção o desliga (grep: só testes e telas o leem), e não há derivação de ambiente/build — ou seja, o estado seguro depende de alguém lembrar de editar uma linha. Como demonstração pedagógica isso é premissa aceitável do protótipo (por isso limitacao_prototipo e não bug), mas precisa constar como premissa de aceite no RIPD e ter trava técnica antes de qualquer promoção.<br>**Facete fundida (F7-MODODEMO-DEFAULT-ON):** db.ts:51 define `modoDemo = true` como valor fixo de classe: não há setter, toggle de UI, variável de ambiente ou checagem de build que o desligue (grep: os únicos usos são leituras em T3/T5/T6/App/api). O design interno é bom — a rota de forja exige modoDemo E a ação `escrever` (api.ts:505-516, 'duas condições, não uma'), e a T6 esconde os botões atrás das mesmas duas — mas a segunda condição nunca varia: o modo demonstração é, na prática, permanente. Pela ótica de UI, controles de ataque e o toggle 'simular queda' (App.tsx:176-185) são cromo de demonstração exibido por padrão como se fosse operação. |
| **Base legal violada** | Art. 46; Art. 37; Art. 6º, VII; Art. 6º, VIII |
| **Princípio PbD violado** | 1 · Proativo, não reativo; 2 · Privacidade por padrão; 5 · Segurança de ponta a ponta |
| **Impacto** | Médio — Se isto fosse a produção como está, qualquer ator com a ação 'escrever' (engenharia, dpo, seguranca) teria uma rota pronta para editar linha do trail sem recalcular hash. A cadeia detecta a adulteração na próxima verificação (auditVerificar), mas detecção não é prevenção, e o registro adulterado fica adulterado — o trail é append-only. |
| **Recomendação** | Amarrar modoDemo ao ambiente (ex.: modoDemo = import.meta.env.DEV, ou VITE_MODO_DEMO com default false) e adicionar teste garantindo que o build de produção responde 404 em audit/forjar por default — o comportamento com modoDemo=false já está testado (regras.test.tsx:459-464); o que falta é o default seguro.<br>Adicionalmente: Derivar o default do ambiente de build (`modoDemo = import.meta.env.DEV`), manter a possibilidade de ligar explicitamente em demo, e adicionar teste que constrói o banco simulando build de produção e afirma 404 em POST /v1/audit/forjar e ausência do bloco 'Demonstração de ataque' na T6; registrar a premissa no RIPD do próprio produto.<br>Adicionalmente: Amarrar o default ao ambiente: `modoDemo = import.meta.env.DEV` (ou flag explícita de build), de modo que `npm run build` produza um artefato sem os botões de ataque da T6 e com POST /v1/audit/forjar devolvendo 404 — e acrescentar um teste em regras.test.tsx cobrindo `modoDemo = false` (a rota de forja já devolve 404 nesse estado, api.ts:510-513, mas nenhum teste fixa isso). |
| **Evidência** | db.ts:51 'modoDemo = true;' (campo mutável, default ligado) + api.ts:510-512: fora do modo, 'A simulação de ataque só existe no modo demonstração.' — db.ts:51 `modoDemo = true;` (default literal da classe); grep 'modoDemo' em app/ mostra que apenas testes atribuem `false` — nenhum caminho de produção o desliga. — db.ts:51 `modoDemo = true;` (sem nenhum ponto de escrita no repo); T6.tsx:241 `{banco.modoDemo && (` — 'Demonstração de ataque'; api.ts:510 `if (!banco.modoDemo) { return erro(404, …) }` |
| **Fechado por (adendo 2026-07-30)** | Fechado — `cada46c`. Provas: `PR 24 · unidade — a catraca reprova o que promete reprovar`, `PR 24 · sistema — o artefato de produção, construído e varrido`; check `PII, catálogo e PbD`. `modoDemo` deriva de `import.meta.env` e o ramo morto **sai do artefato** — não é 404 em produção, é código não publicado. A catraca é exercitada nos dois sentidos: reprova o artefato de demonstração e aprova o de produção. |

### Risco-036 — Feed ICS: credencial estática por papel em query string, segredo no bundle, assinatura truncada, sem expiração

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-036 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 4 · Autenticação, sessão e tokens |
| **Classe** | Limitação de protótipo |
| **Localização** | `app/src/mock/calendario.ts:160-167, 195-231`; `app/src/mock/api.ts:683-687, 706-715`; `app/src/screens/T10.tsx:273, 277-278` |
| **Descrição** | assinaturaDoFeed = sha256('lastro-ics-demo:' + papel).slice(0, 16) (calendario.ts:164-167): segredo hardcoded no código do cliente, assinatura truncada a 64 bits, token estático por papel, entregue e exibido em query string (api.ts:686; T10.tsx:273). O comentário calendario.ts:160-163 declara honestamente a limitação ('num backend de verdade ele viria do KMS'), mas a interface afirma o contrário ao usuário (T10.tsx:277-278) e a própria mensagem da rota repete a alegação ('o segredo não sai da plataforma', api.ts:711) — exatamente o caso em que a limitação declarada vira achado: a interface promete mais do que o mecanismo entrega. Itens do checklist 4 sem resposta: token não expira, não é revogável por ator, e não carrega propósito. |
| **Base legal violada** | Art. 46; Art. 6º, VII |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 5 · Segurança de ponta a ponta; 6 · Visibilidade e transparência |
| **Impacto** | Médio — O segredo 'lastro-ics-demo' vive em calendario.ts, que é servido a todo visitante do app: qualquer pessoa minta o token de qualquer papel com uma linha de console — o oposto do que a Nota da T10 afirma ('a de outro papel exige um segredo que não sai da plataforma'). Em produção como está, a credencial em query string vazaria em logs de servidor/proxy e histórico do navegador, e por ser por papel (não por ator) e sem expiração, não há revogação individual — só trocando o segredo global. Mitigante: o feed não carrega dado pessoal (sem ATTENDEE, só obrigações). |
| **Recomendação** | No desenho de produção (contrato + MAPA): token de feed por ator, derivado com chave no KMS, com expiração e rota de revogação/rotação; no protótipo, corrigir os dois textos (T10.tsx:277-278 e a regra em api.ts:711) para dizer que o segredo é de demonstração e mora no código do cliente, e registrar a premissa no RIPD. |
| **Evidência** | calendario.ts:164 "const SEGREDO_DO_FEED = 'lastro-ics-demo';" + T10.tsx:277-278 'a de outro papel exige um segredo que não sai da plataforma' — o segredo está no bundle que todo papel recebe. |
| **Fechado por (adendo 2026-07-30)** | Fechado — `a367a89`. Provas: `PR 23 · unidade — o token do feed ICS`, `PR 10 · o feed ICS`. Token com papel e prazo no caminho, assinatura inteira, segredo gerado por instância — rotacioná-lo revoga os feeds emitidos. **Resíduo declarado:** o token viaja no caminho porque é o desenho do protocolo iCalendar; credencial em URL permanece, agora expirável e revogável. |

### Risco-037 — Sem autenticação real: papel por botão, sessão sem credencial — toda a matriz de acesso é cooperativa

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-037 |
| **Severidade** | P2 · Impacto Médio |
| **Categoria** | 4 · Autenticação, sessão e tokens |
| **Classe** | Limitação de protótipo |
| **Localização** | `app/src/App.tsx:140-149`; `app/src/store/sessao.ts:14-20, 150-163`; `app/src/mock/scenarios.ts:301-302` |
| **Descrição** | Não há token, cookie, MFA nem sessão: setPapel troca o papel da sessão zustand e chamar() injeta ator = NOME_POR_PAPEL[papel] (sessao.ts:163). Não existe JWT em cookie HttpOnly nem em memória (item do checklist 4) porque não existe JWT. Consequência composta: o purpose (achado CAT3-01) e o papel são ambos autodeclarados client-side. O contrato tampouco instrumenta a autenticação além do securityScheme nu (sem 401, sem escopos — coberto em CAT4-02). Classificação honesta: limitacao_prototipo para o app (estrutural e declarada); o lado contratual, que deveria compensar e não compensa, está apontado em CAT4-02/CAT3-01. |
| **Base legal violada** | Art. 46; Art. 6º, VII |
| **Princípio PbD violado** | 5 · Segurança de ponta a ponta |
| **Impacto** | Médio — Qualquer visitante clica em 'DPO' (App.tsx:140-149) e passa a operar com revelar_pii/buscar_titular; o ator é um nome fixo por papel (sessao.ts:14-20). Como o mock roda inteiro no navegador com os segredos dos titulares no bundle (scenarios.ts:302), nenhuma regra do api.ts é oponível a um usuário hostil — as nove regras valem como especificação executável, não como controle. Limitação estrutural e declarada do protótipo ('Protótipo navegável... nenhum titular real'), mas precisa virar premissa de aceite formal. |
| **Recomendação** | Registrar no RIPD como premissa de aceite: 'controles do protótipo são especificação, não enforcement; nenhum dado real pode entrar neste ambiente'. No handoff de backend, mapear cada Acao de permissoes.ts para escopo/claim OIDC verificado no servidor, com JWT entregue em cookie HttpOnly (ou header via memória) e nunca em storage persistente. |
| **Evidência** | App.tsx:145 'onClick={() => setPapel(p.id)}' e sessao.ts:163 'request<T>(banco, { ...req, papel, ator: NOME_POR_PAPEL[papel] })' — papel e ator saem do estado do cliente. |

### Risco-038 — Documentos de handoff carregam terceiros ao abrir (unpkg com SRI; Google Fonts sem) — fornecedores sem DPA recebendo metadados

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-038 |
| **Severidade** | P3 · Impacto Baixo |
| **Categoria** | 5 · Frontend, terceiros e CSP; 11 · Fornecedores e transferência internacional |
| **Classe** | Lacuna real |
| **Localização** | `docs/design_handoff_lastro_correcoes/support.js:1143-1148, 1838-1846, 1854-1866`; `docs/design_handoff_lastro_correcoes/Validacao UX e LGPD.dc.html:6, 11-13`; `docs/design_handoff_lastro_correcoes/Lastro Redesenho.dc.html:6` |
| **Descrição** | Ambos os *.dc.html carregam ./support.js, que injeta React/ReactDOM (e Babel para componentes JSX) de unpkg.com em runtime. Correção sobre a exploração anterior: os três scripts TÊM SRI — hashes sha384 fixados (support.js:1144/1146/1148) e aplicados com crossOrigin anonymous (1828-1831) — a integridade está tratada. O que permanece: (i) execução e requisições a terceiro disparam no ato de abrir o arquivo, sem bloqueio por default nem consentimento, contrariando o checklist ('default bloquear tudo'); (ii) 'Validacao UX e LGPD.dc.html' adiciona preconnect + stylesheet de Google Fonts (linhas 11-13), cujo CSS é dinâmico por user-agent e não admite SRI; (iii) support.js:1858-1865 faz window.parent.postMessage com targetOrigin '*' (só metadados de componente, mas prática frágil). Nenhum outro artefato do repo tem dependência externa — o app e o prototipo são self-contained.<br>**Facete fundida (F-08):** "Validacao UX e LGPD.dc.html":11-13 faz preconnect e carrega stylesheet de fonts.googleapis.com/fonts.gstatic.com; support.js:1143-1147 carrega React, ReactDOM e Babel de unpkg.com (com SRI, o que mitiga integridade mas não a remessa de metadados). Incoerência com o restante do repo: prototipo/index.html é deliberadamente autocontido ("arquivo único, sem dependências", README.md:97) e o cenário de mídia trata tags de terceiros exatamente como risco de compartilhamento. |
| **Base legal violada** | Art. 6º, III; Art. 33; Art. 46; Art. 6º |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 6 · Visibilidade e transparência |
| **Impacto** | Baixo — Um membro da equipe abre o handoff (evidência do programa de privacidade) na rede corporativa: IP, user-agent e horário vazam para unpkg.com e fonts.googleapis.com/gstatic.com (servidores fora do Brasil) sem consentimento nem aviso; offline ou com unpkg indisponível, o documento de evidência não renderiza. O conteúdo em si é fictício e a audiência é interna — por isso P3. |
| **Recomendação** | Vendorizar as dependências do handoff: baixar react.production.min.js, react-dom.production.min.js e babel.min.js para docs/design_handoff_lastro_correcoes/vendor/ e alimentá-los via window.__resources (mecanismo que support.js:1150-1152 já suporta); substituir Google Fonts por font-face local ou pela pilha de sistema (como o Lastro Redesenho.dc.html já faz); trocar o targetOrigin '*' do postMessage por origem explícita. Critério de aceite: abrir os dois .dc.html sem rede e sem nenhuma requisição externa no DevTools.<br>Adicionalmente: Embutir as fontes (woff2 em data: URI ou font stack de sistema) e as libs nos próprios HTML do handoff, como o prototipo/index.html já faz; alternativamente, declarar a exceção e o destinatário na documentação do handoff. |
| **Evidência** | Validacao UX e LGPD.dc.html:13 `<link href="https://fonts.googleapis.com/css2?family=Newsreader…" rel="stylesheet" />`; support.js:1143 `var REACT_URL = "https://unpkg.com/react@18.3.1/…"` (com SRI na linha 1144) — Validacao UX e LGPD.dc.html:11 '<link rel="preconnect" href="https://fonts.googleapis.com" />'; support.js:1143 'REACT_URL = "https://unpkg.com/react@18.3.1/..."' |

### Risco-039 — Coerência do catálogo não forçada: “anonimizado” convive com base legal/LIA e a linhagem usa strings livres sem FK

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-039 |
| **Severidade** | P3 · Impacto Baixo |
| **Categoria** | 9 · Catálogo, ROPA e linhagem; 2 · Minimização e finalidade |
| **Classe** | Lacuna real |
| **Localização** | `app/src/mock/scenarios.ts:509-510, 661-662`; `db/seed.sql:75, 84-86`; `db/schema.sql:214-233, 512-530` |
| **Descrição** | Casos no catálogo: v-cesta 'cesta_media_por_regiao' com categoria 'anonimizado' + baseLegal 'legitimo_interesse' + liaCodigo 'LIA-RECO-002' (scenarios.ts:509); m-geo 'geolocalizacao_ip' anonimizado com base 'execucao_contrato' (scenarios.ts:661); shap_values anonimizado com base 'protecao_credito' (seed.sql:75). O schema garante que anonimizado exige agregação (campo_anonimizado_exige_agregacao, schema.sql:176-178 — ponto forte), mas nada impede/questiona base_legal ou lia_id em dado declarado fora do escopo (Art. 12: dado anonimizado não é dado pessoal). Falta a regra inversa da que já existe.<br>**Facete fundida (F-12):** Pontos fortes reconhecidos: linhagem é append-only (trigger :815-817) e indexada para consulta de impacto (:232-233). Lacunas: (i) origem_sistema/origem_dataset/origem_campo/destino_* são TEXT livres (:219-224) sem resolução contra sistema/dataset/campo — compreensível para destinos externos ('openai'), mas sistemas internos deveriam ser resolvidos no ingest; (ii) linhagem.base_legal aceita 'legitimo_interesse' sem lia_id (a coluna nem existe), enquanto campo (:528-530) e ripd_operacao (:363) exigem LIA — seed.sql:85-86 grava duas linhas de LI sem vínculo com a LIA-SCORING-001; (iii) sem vínculo, a query de impacto por campo do catálogo depende de igualdade de string, frágil a renames. |
| **Base legal violada** | Art. 12; Art. 5º; Art. 18; Art. 7º, IX; Art. 37 |
| **Princípio PbD violado** | 3 · Privacidade incorporada ao design; 6 · Visibilidade e transparência |
| **Impacto** | Baixo — Ou o dado agregado está de fato fora do escopo da LGPD e a base legal/LIA atribuída é ruído que infla o ROPA e confunde a resposta ao titular, ou o agregado ainda permite singularização e a categoria 'anonimizado' é falsa — nos dois casos o catálogo afirma algo incoerente que uma auditoria de qualidade de inventário apontaria. |
| **Recomendação** | Adicionar validação (no schema como CHECK/trigger e no validador do mock, api.ts POST catalog): categoria='anonimizado' → lia_id nulo e base_legal marcada como 'nao_aplicavel'/anotação de fora de escopo; ou reclassificar os campos citados como 'pseudonimizado'/'pessoal' se houver reversibilidade residual que justifique manter base legal.<br>Adicionalmente: Adicionar lia_id UUID à linhagem com trigger reutilizando exige_lia_vigente quando base_legal='legitimo_interesse'; no ingest, resolver origem/destino internos contra o catálogo e gravar o id resolvido ao lado do texto (validação de ingestão, não FK rígida, para preservar destinos externos); documentar a consulta de impacto canônica sobre linhagem_origem_idx/linhagem_destino_idx. |
| **Evidência** | app/src/mock/scenarios.ts:509 "categoria: 'anonimizado', ... baseLegal: 'legitimo_interesse', liaCodigo: 'LIA-RECO-002'" (campo cesta_media_por_regiao). — db/schema.sql:219-224 "origem_sistema TEXT NOT NULL, origem_dataset TEXT NOT NULL, origem_campo TEXT, ..." (sem FK, sem lia_id); db/seed.sql:85 linha de linhagem com base_legal 'legitimo_interesse' sem referência a LIA. |

### Risco-040 — PII sintética completa embarca no bundle do cliente — e o comentário do código afirma o contrário

| Campo | Conteúdo |
|---|---|
| **ID** | Risco-040 |
| **Severidade** | P3 · Impacto Baixo |
| **Categoria** | 2 · Minimização e finalidade; 5 · Frontend, terceiros e CSP |
| **Classe** | Limitação de protótipo |
| **Localização** | `app/src/mock/scenarios.ts:293-312, 440-456, 599-613, 760-772`; `app/src/App.tsx:130-149`; `app/src/mock/db.ts:34-44`; `app/src/mock/types.ts:306-311`; `db/seed.sql:254, 288` |
| **Descrição** | Limitação estrutural declarada do protótipo (API mock síncrona em memória, sem backend, sem autenticação): a fronteira de confiança inteira mora no cliente. As regras que o produto demonstra — mascaramento por padrão, revelação com finalidade catalogada, gravar-antes-de-responder — são reais dentro da API mock, mas o dado que ela protege é entregue no mesmo bundle JS. Não é defeito a corrigir e sim premissa a registrar: o repositório já faz a parte honesta (App.tsx:131-133 'Dados de demonstração — nenhum titular real'; README.md:219 'não é um sistema em produção'), falta o registro formal como premissa de aceite.<br>**Facete fundida (F-06):** A função titular() (scenarios.ts:293-312) monta `segredos` com CPF, nome, e-mail e extras (telefone em :602/:610, endereço em :601/:607) de 9 titulares sintéticos nos 3 cenários. O comentário de types.ts:309 afirma que segredos 'Só existe no mock do backend. Nunca é serializado para a UI sem passar por /pseudonyms/resolve' — mas o mock é síncrono em memória no cliente: o objeto inteiro embarca no bundle. É limitação estrutural declarada do protótipo (sem backend), que deve virar premissa de aceite — mas o comentário promete uma fronteira que não existe. Higiene relacionada no repositório versionado: CPF formatado em 7 arquivos (E5, 40 ocorrências), CPF sem máscara em db/tests.sql:146, e IP público roteável real (189.22.*.*) usado como dado de exemplo em db/seed.sql:254 e :288 e scenarios.ts:482. |
| **Base legal violada** | Art. 46; Art. 6º, VII; Art. 12; Art. 52 |
| **Princípio PbD violado** | 2 · Privacidade por padrão; 5 · Segurança de ponta a ponta |
| **Impacto** | Baixo — Qualquer pessoa com o app aberto lê em DevTools os valores brutos de scenarios.ts (9 CPFs formatados, telefones em :602/:610, endereço em :601, renda/score em :441-453) sem finalidade, sem justificativa e sem linha no audit trail — o mesmo vale para trocar de papel na topbar (App.tsx:140-149), que não tem autenticação. Aceitável apenas porque todo dado é sintético e o rodapé declara isso; com dado real seria exposição direta. |
| **Recomendação** | Registrar no RIPD/documentação de arquitetura a premissa de aceite: 'fronteira de confiança no cliente, dados 100% sintéticos; nenhuma regra do mock vale como controle de segurança em produção'. Adicionar salvaguarda barata contra regressão: estender a varredura do gate-privacidade (ou um teste) para falhar se scenarios.ts ganhar um CPF válido fora da lista de sintéticos conhecidos, garantindo que dado real nunca entre no bundle.<br>Adicionalmente: Registrar como premissa de aceite no RIPD do protótipo; corrigir o comentário de types.ts:309 para dizer que no protótipo os segredos embarcam no bundle; isolar segredos em módulo carregado só em dev/test (import dinâmico atrás de flag) para que a fronteira prometida exista no código; substituir o IP público real por faixa de documentação (TEST-NET/198.51.100.0/24) em seed.sql e scenarios.ts; manter aviso explícito de que scenarios.ts jamais recebe dado real. |
| **Evidência** | E5 (grep -rEno de CPF formatado, commit 8d0548a): 9 ocorrências em app/src/mock/scenarios.ts; telefones fictícios em claro em scenarios.ts:602 e :610 (campo `valor:` com máscara aplicada só na exibição) — app/src/mock/scenarios.ts:302 "segredos: { cpf, nome, email, ...Object.fromEntries(extras.map((e) => [e.chave, e.valor])) }" vs types.ts:309 "Só existe no mock do backend. Nunca é serializado para a UI"; E5 (grep de PII: 40 ocorrências em 7 arquivos). |
| **Fechado por (adendo 2026-07-30)** | Fechado — `cada46c`. Provas: `PR 24 · sistema — o artefato de produção, construído e varrido`, `PR 24 · unidade — a catraca reprova o que promete reprovar`; check `PII, catálogo e PbD`. O console entra por `import()` dinâmico atrás de constante de build, e `mock/scenarios.ts` não entra no grafo do perfil de produção. A prova é sobre o arquivo servido, não sobre a tela: o teste varre o bundle procurando os valores reveláveis dos nove titulares e as afordâncias que o §7.3 nomeia. |

---

## 5. Itens do checklist sem correspondência — N/A ou ausentes

Nenhuma categoria foi silenciada: todo item do checklist de 13 categorias sem risco correspondente está listado abaixo com justificativa. **N/A** = sem correspondência pela natureza do sistema (plataforma de metadados de governança, sem data lake próprio, sem pixel de marketing, sem LLM integrado); **Ausente** = deveria existir e não existe (quando relevante, o item já virou risco na seção 4); **Parcial** = parcialmente atendido.

| Cat. | Item do checklist | Status | Justificativa |
|---|---|---|---|
| 1 | Toggles granulares por finalidade, default OFF e 'Recusar tudo' com peso visual igual (banner/central de consentimento ao titular) | N/A | N/A por natureza do sistema: o repositório contém o console interno de governança (papéis engenharia/dpo/produto/segurança/auditor), não a superfície de coleta voltada ao titular — o consentimento é coletado em canais externos apenas referenciados como metadados ('app iOS' em scenarios.ts:361, 'checkout web' em :535). Nos toggles que existem (ValidadorInventario, T2.tsx:336-341 e 399-411), o default é OFF por decisão documentada ('Os toggles nascem desligados', T2.tsx:447) — conforme. A persistência do consentimento coletado lá fora, essa sim do escopo deste repo, é o achado F1. |
| 1 | Consentimento persistido vinculado a userId/consentId (nunca só localStorage) | Ausente | Parcialmente presente e parcialmente ausente-deveria-existir: virou o achado F1 (registro existe no mock com prova versionada, mas é agregado por campo, sem rota no contrato e sem tabela no schema). O lado localStorage é conforme: zero usos de localStorage/sessionStorage/cookies em app/ e prototipo/ (grep em 2026-07-29, commit 8d0548a — nenhuma ocorrência). |
| 1 | Disciplina de PR para campo novo | N/A | Presente — não reportado como achado: campo novo sem finalidades declaradas ou sem base legal é recusado pela API de validação de inventário (C-03, api.ts:320-336) e o repo tem .github/workflows/ci.yml + privacy-ci-gate.yml. A limitação de alcance do gate (varre 1 único arquivo de log, E3) pertence à categoria de CI, fora do meu escopo. |
| 2 | Nunca ORM direto (nenhuma entidade serializada direta) | N/A | N/A: não há ORM no protótipo. O mock monta DTOs literais campo a campo (por exemplo api.ts:252-258 na revelação e :270-275 no GET titulares), que é exatamente o comportamento que o checklist pede; a ameaça LINDDUN correspondente consta como mitigada por 'DTO por escopo com allowlist' (scenarios.ts:46). Ponto forte confirmado, sem achado. |
| 3 | Middleware admin separado com propósito | N/A | Sem correspondência no repo: nem o contrato nem o app expõem superfície administrativa — a gestão de tenant/ator existe apenas como tabelas em db/schema.sql:83-101, sem nenhuma rota CRUD no openapi e sem papel 'admin' em permissoes.ts. Hoje é N/A pelo recorte do protótipo (12 artefatos, 5 papéis operacionais); vira exigência real (middleware próprio, com finalidade e trail) no momento em que a administração de atores entrar no contrato — recomendo registrar essa pendência no backlog do contrato para que ela não nasça dentro do middleware comum. |
| 3 | Busca por e-mail via POST com hash sem devolver o identificador | N/A | N/A por natureza do sistema: a única busca de titular existente é por CPF (POST /v1/titulares/buscar, api.ts:140-142); não há rota de busca por e-mail em contrato nem mock, e nenhuma tela a pede. A busca por CPF cumpre o padrão do checklist — POST com hash calculado no cliente, resposta sem o identificador (devolve id interno + pseudônimo truncado, api.ts:939-941), 404 uniforme e cota — ressalvado que a função de hash em si é fraca (achado CAT3-05). |
| 3 | 404 nunca 403 | N/A | Correspondência existe e é deliberadamente mais fina que o enunciado: politicas.ts:23-30 distingue '404_uniforme' (recursos de titular — GET /titulares/{id} e POST /titulares/buscar respondem 404 idêntico para inexistente e fora de escopo, api.ts:262-269 e 910-941) de '403' para recusa sobre capacidade do ator, que não revela nada sobre titulares. Os 403 do contrato (:245, :283) são desse segundo tipo. Não reportado como achado por ser desenho coerente com o objetivo anti-oráculo da regra; a divergência de código 403×422 dentro de /pseudonyms/resolve está coberta no achado CAT3-09. |
| 4 | Eliminação permanente com verificação descartada após uso | Ausente | Ausente — e relevante: nenhum artefato define o ciclo de vida (retenção e descarte) da prova de verificação elevada usada na eliminação; o schema apenas exige nivel_verificacao=3 na solicitação (db/schema.sql:559-560). Por ser inseparável da ausência geral de instrumentação de MFA/step-up, foi absorvido como sub-item do achado CAT4-02, incluindo a recomendação de rota de verificação com expiração curta e descarte da prova após uso. |
| 5 | SRI obrigatória no app | N/A | N/A por natureza: o build Vite embute todos os assets e app/index.html:1-13 referencia apenas /src/main.tsx e um favicon data:URI — não existe recurso cross-origin ao qual aplicar integrity. Nos docs de handoff, onde há CDN, o SRI está presente e correto (support.js:1144-1148 com sha384 + crossOrigin anonymous), corrigindo a hipótese da exploração anterior; o residual (execução de terceiro sem bloqueio + Google Fonts sem SRI possível) é o achado F4. |
| 5 | Review de tags/pixels de marketing | Ausente | N/A — ausência total confirmada: nenhum pixel, gtag, fbq, hotjar ou similar em qualquer superfície (grep no repo inteiro; a única menção a ferramenta de replay é a promessa de data-hj-suppress em 01-arquitetura.md:136, tratada no achado F5). O cenário de risco R6 ('Tracking de terceiro ligado por padrão', scenarios.ts:82) existe como conteúdo didático da matriz de riscos, não como código. |
| 5 | Review de dashboards de terceiros | N/A | N/A por natureza: nenhum dashboard de terceiro embutido no repositório; Grafana aparece apenas como promessa de arquitetura (01-arquitetura.md:144, com supressão k-anonimato k>=5 declarada). Se/quando materializado, deverá passar pelo review — premissa a registrar no RIPD, não achado atual. |
| 5 | JWT nunca em localStorage/sessionStorage; localStorage só para preferências de UI | N/A | N/A por natureza do protótipo: não existe autenticação nem token — a sessão é um papel escolhido client-side (App.tsx:140-149), limitação estrutural registrada no achado F6. O uso de storage é zero (nem preferências de UI são persistidas — tema e modo apresentação vivem só em memória), portanto conforme por ausência; quando a identidade real (Keycloak/Auth0 OIDC prometida em 01-arquitetura.md:143) entrar, o requisito passa a ser testável. |
| 6 | Stack trace nunca com payload | N/A | Atendido/N-A por natureza do protótipo: a API mock é síncrona e nunca serializa exceções — todo caminho de erro passa por erro() que devolve apenas {erro, regra} (api.ts:41-42); FalhaDeAuditoria/LogImutavel são capturadas e traduzidas em mensagem didática (ex.: api.ts:1379-1381, 493-499); não há console.log/error em app/src (grep vazio) nem ErrorBoundary que exponha componentStack. Em produção real o requisito volta a ser verificável no backend, que não existe aqui. |
| 6 | Erros devolvem errorId (correlação) sem stack/dados | Ausente | Parcial: a metade 'sem stack/dados' é cumprida (ver item anterior), mas não existe errorId de correlação em nenhuma resposta de erro (grep errorId/error_id no repo: zero) nem no contrato openapi.yaml. Num mock em memória sem logs de servidor não há o que correlacionar — ausência de baixa relevância aqui, porém o contrato openapi.yaml deveria já prever o campo no schema de erro para o backend futuro. Registrado como premissa, não como achado, para manter o foco nos defeitos com efeito. |
| 6 | Retenção de logs operacionais 30d | Ausente | N-A por natureza na metade 'operacional': o protótipo não gera logs operacionais (sem servidor, sem console.*, sem telemetria real — a rota /telemetry/redaction do openapi é declarativa). A metade que tem correspondência concreta — retenção do log de auditoria — está ausente e virou o achado F6-06. |
| 6 | Propósito registrado em cada acesso | N/A | Atendido no que o sistema trata como acesso a dado pessoal: ACOES_PII exigem finalidade + justificativa >=20 chars com falha-fechada (db.ts:89-95), TITULAR_BUSCADO exige finalidade (:96-98), X-Purpose é obrigatório nas rotas de titular e a constraint espelho existe no schema (:762-765). Ações administrativas (RIPD_SUBMETIDO etc.) entram sem finalidade por não tocarem dado de titular — decisão defensável. Sem achado; a lacuna residual (base_legal nunca gravada) está coberta em F6-02. |
| 7 | Envelope encryption DEK/KEK operacional na plataforma | N/A | N/A por natureza do sistema: por decisão registrada (ADR-4, docs/01-arquitetura.md:176), a plataforma nunca detém a KEK — a reidentificação e a cifra real são do serviço do produto; o schema apenas registra chaves, dependências e rotações (kms_chave/kms_dependencia, db/schema.sql:645-667). Deve constar como premissa de aceite no RIPD do protótipo, não como ausência. |
| 7 | Rotação automática de chaves | Ausente | Ausente como automação neste repositório — .github/workflows contém apenas ci.yml e privacy-ci-gate.yml; o kms-rotation.yml é citado (docs/01-arquitetura.md:20; enum de workflow em db/schema.sql:272) mas não versionado aqui. Existe como modelo de dados completo (kms_rotacao/kms_rotacao_etapa com etapas gerar→canary→recriptografar→revogar, schema.sql:669-691). Limitação estrutural do protótipo: a automação vive na infra dos produtos, fora deste repo. |
| 7 | Chave própria por campo sensível | Parcial | Correspondência parcial: a segregação é por finalidade (biometria, saude, afinidade_sensivel — chaves dedicadas nos cenários e no seed) e a dependência é por dataset (kms_dependencia, db/schema.sql:662-667), não por campo. Para os dados sensíveis modelados, cada um tem chave de finalidade própria; a granularidade por campo não existe e deveria ser registrada como decisão consciente no RIPD. |
| 7 | Backup com TTL, chave segregada, expurgo pós-restore e destruição auditada com hash | Ausente | Parcialmente presente (chave segregada de finalidade 'backup' em db/seed.sql:233; origem 'pos_restore' prevista em expurgo_run, db/schema.sql:610); o restante — TTL de snapshot, expurgo pós-restore exercitado e destruição auditada com hash — está ausente e é relevante: virou o achado F-08. |
| 8 | Job de expurgo diário com evidência hash (executor) | Ausente | O executor não existe no repositório (nenhum script .py; expurgo-permanente.py apenas citado em docs/01-arquitetura.md:26). O que existe é o registro pós-fato (expurgo_run/expurgo_entrada com hash_pre/hash_pos, db/schema.sql:606-639). A ausência é relevante e virou o achado F-01. |
| 8 | Revogação de consentimento para marketing → DELETE /me/dados com cascata | Ausente | Ausente: a revogação existe e propaga no mock (bloqueia revelação e gate, api.ts:1496-1543), mas não há rota /me/dados no contrato (openapi.yaml, 22 paths conferidos) nem cascata de eliminação. Virou o achado F-02. |
| 9 | Queries de impacto em 5 minutos | N/A | Não é promessa do repositório: docs/01-arquitetura.md não menciona prazo de query de impacto (grep sem ocorrências). A consulta é estruturalmente suportada pelos índices linhagem_origem_idx/linhagem_destino_idx (db/schema.sql:232-233); a fragilidade do casamento por string está no achado F-12. |
| 9 | Zona bruta sem acesso de analista | N/A | N/A por natureza do sistema: a plataforma é de metadados e não hospeda o data lake ('Princípio de fronteira', docs/01-arquitetura.md:68-71). A zona é registrada no catálogo (dataset.zona_lake com CHECK raw/trusted/refined, db/schema.sql:145), mas o controle de acesso à zona bruta pertence aos sistemas do produto — deve constar como responsabilidade delegada no RIPD. |
| 9 | Views mascaradas por padrão | N/A | N/A por natureza no banco de governança: as views (v_ropa, v_sla_titular, v_metricas_tendencia, v_risco_por_dominio, db/schema.sql:918-975) expõem apenas metadados; o único identificador de titular no banco é pseudônimo HMAC, e o auditor externo tem grant de colunas que exclui o pseudônimo e o corpo de mensagens (db/schema.sql:907-911). |
| 10 | Saúde/biometria processada on-prem (nunca em LLM externo) | N/A | N/A por natureza dos cenários modelados: nenhum campo sensível tem compartilhamento externo em cenário algum (biometria_facial com compartilhamentos vazios, scenarios.ts:336-337) e o schema veda base frágil para dado sensível (campo_sensivel_base_legal, schema.sql:170-173). Não existe tratamento de saúde via LLM no repositório; o controle está atendido por modelagem, e a verificação em runtime é premissa do RIPD por não haver backend. |
| 10 | Dataset de treino pseudonimizado (verificação em execução) | N/A | Atendido como declaração — CPF vira HMAC-SHA256 com chave no KMS antes de uso analítico ou envio a LLM (seed.sql:56; campo historico_compras tipo hmac, seed.sql:74; constraint campo_pseudonimizado_reversivel, schema.sql:179-181) — mas não verificável em execução: não há pipeline real de treino no repositório. Vira premissa de aceite no RIPD; a lacuna acionável (verificação de base legal por registro) foi convertida no achado F-03. |
| 11 | Bloqueio no gateway: fornecedor sem DPA não recebe dados / gateway filtra payload por allowlist de campos | N/A | Limitação estrutural declarada do protótipo: não existe gateway executável ("Não há backend", README.md:221-222). O registro declarativo por campo existe (compartilhamento com FK para campo, schema.sql:188-208), o que equivale a uma allowlist declarada, mas o enforcement em runtime não é demonstrável aqui — premissa de aceite no RIPD. A parte acionável no que o repo controla (invariante de DPA no registro, entidade fornecedor) virou o achado F-05. |
| 12 | Portal de autoatendimento do titular (face externa do Art. 18) | N/A | N/A por escopo de produto: o repositório implementa o lado de dentro do balcão (T4 declara 'Esta tela é o lado de dentro do balcão', T4.tsx:135) com todos os direitos do Art. 18 como tipos de solicitação, prazos, níveis de verificação, revisão do Art. 20 com fundamento obrigatório e recusa fundamentada (Art. 18, §4º). A face externa (portal do titular) é referenciada como existente fora do repo (prototipo, maturidade 'Portal de direitos em produção'). Registro adicional: os botões de portabilidade não geram arquivo e estão honestamente marcados 'não implementado' (T4.tsx:329-334, padrão C-15) — limitação declarada, não reportada como achado. |
| 12 | Formatos de resposta específicos por direito (confirmação 200 com JWT; acesso JSON imediato com MFA; declaração completa PDF 202 + 15 dias) | Ausente | Ausente — deveria existir, e a raiz da ausência (não há nenhuma rota de exercício no contrato) foi convertida no achado P0 F-01. Registro honesto do que existe como dado: prazo_dias_uteis default 15 (schema.sql:549), nivel_verificacao 1-3 com semântica "1 sessão, 2 MFA, 3 verificação elevada" (openapi.yaml:759-763) e dentro_do_sla calculado (schema.sql:552-554) — os insumos estão modelados, as respostas não. |
| 13 | Cadeia de evidências de incidente | Ausente | Existe por derivação: todo evento do incidente é linha do trail hash-encadeado (T9.tsx:83-103 'derivada do audit trail — não é uma lista mantida à parte'), com gravar-antes-de-responder. Não é item ausente; os dois defeitos que a enfraquecem viraram achados próprios — o fundamento fora do payload do hash (F6-02) e a ausência de persistência real do incidente (F13-01). Cadeia de custódia forense (preservação pré-contenção) está coberta em F13-03. |
| 13 | Análise de cenário de incidente em cada review | Parcial | Parcialmente presente por outro caminho: o incidente da massa nasce vinculado a risco previsto e RIPD (T9 'Risco previsto'/'RIPD relacionado'; scenarios.ts incidentePadrao(..., 'R09', 'r1')), e o LINDDUN do RIPD faz análise de ameaça por projeto. O que não existe é o gancho por review/PR (sem PULL_REQUEST_TEMPLATE, sem pergunta no épico PbD) — incorporado à recomendação do achado F13-03 em vez de duplicar achado. |

---

## 6. Reverificação dos 43 achados prévios (ACHADOS.md)

Cada achado de `docs/design_handoff_lastro_correcoes/ACHADOS.md` foi reverificado no código do commit auditado. **Resultado: 38 corrigidos (com teste correspondente), 5 parciais, 0 permanecem em aberto integralmente.** Os parciais têm o resíduo convertido em risco novo (última coluna). O número está congelado no commit auditado; dos cinco riscos derivados, o Risco-002 (C-08) fechou e o Risco-005 (C-18) ficou parcial — anotado na própria linha, e no §7.1 do RIPD.

| Achado prévio | Status | Evidência da reverificação | Risco derivado |
|---|---|---|---|
| C-01 | corrigido | Busca por CPF gated por ação 'buscar_titular' com alternativa explicativa (T2.tsx:124-137; T4.tsx:404-409), hash SHA-256 calculado no cliente e CPF limpo da sessão (T2.tsx:80-88), registro no trail antes da resposta e rate-limit contra enumeração (api.ts:85; db.ts buscasPorAtor); testes em regras.test.tsx:288-408. | — |
| C-02 | corrigido | A guarda de topo lê a política declarada por rota (api.ts:90-105; tabela em politicas.ts:37-236, default fechado POLITICA_PADRAO:233-236); audit/forjar re-checa 'escrever' dentro da rota (api.ts:514-516). | — |
| C-03 | corrigido | Finalidades ofertadas na revelação vêm do catálogo do campo, não de lista fixa da tela (primitivos.tsx:244-253 'finalidadesOfertadas = catalogado?.finalidadesCompativeis'); campo fora do ROPA ou sem finalidade não recebe botão, e a API recusa qualquer finalidade não catalogada. | — |
| C-04 | parcial | Redator existe e roda antes do append em todos os campos livres (redigir() em api.ts:1368, 1392, 1429, 1511, 551), com prévia na UI (T9.tsx:220, 293-298) — mecanismo corrigido; permanece a cobertura restrita a 5 tipos (redator.ts:26-32), sem nome/endereço/RG/nascimento/IP → achado F6-05. | Risco-021 |
| C-05 | corrigido | Re-mascaramento por instante de relógio (expiraEm = Date.now() + TTL) em vez de contador de intervalo estrangulável em aba inativa — primitivos.tsx:214-234; o tick apenas desenha, quem decide é o relógio. | — |
| C-06 | corrigido | exportarAuditoria grava AUDIT_EXPORTADO (papel, filtro, contagem) antes de gerar o CSV e falha com 503 se o log falhar (api.ts:1561-1596); gated pela acao 'exportar_auditoria' (politicas.ts:45-50). | — |
| C-07 | parcial | T9 + rotas de incidente + incidente.bpmn existem e são fortes (api.ts:1342-1493), mas db/schema.sql não tem tabela incidente e openapi.yaml não tem path /incidentes → achado F13-01; prazo ANPD sem relógio → F13-02. | Risco-015 |
| C-08 | parcial | Corrigido no mock/UI: registro com texto, versão, canal e hash (types.ts:509-521; T2.tsx:462-548), revogação operável com propagação real (api.ts:1496-1543; primitivos.tsx:260-262 'consentimento revogado' remove o botão) e testes em regras.test.tsx:1251-1331. Permanece a lacuna estrutural: sem rota /consentimentos no openapi.yaml, sem tabela no schema.sql e sem vínculo por titular (registro agregado com `titulares: number`) — reaberto como achado F1. **Adendo 2026-07-30:** o Risco-002 fechou — `8f636be` traz a entidade e o aceite imutável no schema, `022a1d1` migra a camada de demonstração, e `titulares: number` deixou de existir. Provas em `PR 19 · unidade — o estado é derivado dos fatos, nos limites` e `PR 20 · aceitação — a migração é completa, não parcial`. | Risco-002 — **fechado** |
| C-09 | corrigido | Menu filtra telas por papel em vez de desabilitar (App.tsx:73-75, TELAS_BLOQUEADAS), aviso de uma linha do que entrou/saiu ao trocar de papel (App.tsx:82-97) e página de bloqueio apenas para acesso por link direto (App.tsx:202-209). No protótipo estático o padrão antigo (display:none) permanece — coberto no achado F3. | — |
| C-10 | corrigido | regras.test.tsx:1345 'a recusa mora no controle, não no canto' | — |
| C-11 | parcial | App corrigido (regras.test.tsx:1776 'piso tipográfico'); prototipo/index.html:78-79,:87,:99 mantém 10.5-11.5px, contrariando IMPLEMENTACAO.md:337-338 (achado F-10) | Risco-030 |
| C-12 | corrigido | regras.test.tsx:1817 'um só padrão de popover, acionável por teclado' | — |
| C-13 | corrigido | regras.test.tsx:1853 'os quatro estados' | — |
| C-14 | corrigido | app/src/ui/estilos.css:90,:94,:106 @media de largura; prototipo/index.html:137 @media max-width:1180px | — |
| C-15 | corrigido | No app: área de drop do inventário trata dragover/drop de verdade (T2.tsx:558-595) e controles inertes recebem a marca acessível 'não implementado' (primitivos.tsx:94-100; T4.tsx:329-334). O escopo original (T2·T4·T6·T8) está atendido; a busca inerte do protótipo estático (prototipo/index.html:922-928) não estava no escopo do C-15 e foi absorvida no achado F3. | — |
| C-16 | corrigido | regras.test.tsx:1385 'didático some, operacional permanece' | — |
| C-17 | corrigido | Fail-closed verificado no código atual: campo exibível sem entrada no catálogo não é revelável (api.ts:170-183 retorna 422; testes em regras.test.tsx:545 'C-17 — campo revelável precisa estar no ROPA'). | — |
| C-18 | parcial | ci.yml e privacy-ci-gate.yml existem, sem continue-on-error, rodando em push+PR; porém nenhum é required status check (admitido em ci.yml:7-10) e E2 prova a main vermelha com 4 testes falhando no HEAD 8d0548a → achado F6-03. **Adendo 2026-07-30:** três checks são *required* na `main` — `Tipos e testes`, `PII, catálogo e PbD` e `Constraints e invariantes do banco`, o último provado bloqueando merge por PR-sonda —, e `2cf1c18` põe schema e invariantes no CI. O quarto, `Disparidade e proxies do modelo`, roda e reprova mas ainda não está marcado. **Resta** do Risco-005: gitleaks/CodeQL/`npm audit` e o `schedule` de vencimentos. **Adendo 2026-07-30 (`4778663`):** o CI deixou de ser monoplataforma. Os quatro jobs Node puros passaram a rodar em `ubuntu-latest` **e** `windows-latest`, com os legs Windows como checks próprios (`… (windows)`) e o leg Ubuntu mantendo o nome exato — a marcação existente não foi tocada. Isso não é conforto de portabilidade: dois defeitos reais atravessaram a série com a suíte verde porque nenhum ambiente onde eles existiam era executado, e um terceiro estava de pé no momento da mudança (`spawnSync('npm')` sem shell no CLI de `npm audit`, que em Windows devolvia relatório vazio e reprovava culpando o npm). Os quatro jobs fora da matriz declaram o motivo no próprio YAML, com teste cobrando que todo job faça uma coisa ou a outra — e a distinção entre motivo **físico** (service container Linux) e **semântico** (gitleaks e CodeQL rodam em Windows, mas leem os mesmos bytes) é medida, não suposta. | Risco-005 — **parcial** |
| T1-01 | corrigido | regras.test.tsx:1588 'dois mapas, dois eixos, um caminho de reclassificação' | — |
| T1-02 | corrigido | regras.test.tsx:1613 e :1629 (simulação com estado próprio, risco fabricado não reclassificável) | — |
| T1-03 | corrigido | regras.test.tsx:1923 'a bolha é botão inteiro' | — |
| T2-01 | corrigido | setCpf('') imediatamente após o cálculo do hash, com comentário da regra ('o documento sai da sessão assim que o hash é calculado') — T2.tsx:84-87 e T4.tsx:95-97. | — |
| T2-02 | corrigido | regras.test.tsx:1571 'a linhagem abre como região focável e nomeada' | — |
| T2-03 | corrigido | regras.test.tsx:1556 'sem resultado, o estado vazio nomeia os filtros e oferece limpar' | — |
| T3-01 | corrigido | regras.test.tsx:1419 e :1431 (stepper deriva do conteúdo) | — |
| T3-02 | corrigido | regras.test.tsx:1439 e :1445 (baixar e anexar distintos; anexar exibe commit, autor e hora) | — |
| T3-03 | corrigido | regras.test.tsx:1455 e :1470 (combinação válida confirma, inválida alerta) | — |
| T4-01 | corrigido | Revelação exige protocolo selecionado e recusa protocolo de outro titular (api.ts:224-234); o protocolo entra no payload do hash do trail (db.ts:13, 81). | — |
| T4-02 | corrigido | regras.test.tsx:691 'concluir o atendimento'; api.ts:829-867 POST requests/{id}/concluir com desfecho e registro | — |
| T4-03 | corrigido | regras.test.tsx:745 'revisão... deixa prova (Art. 20)'; api.ts:568-616; schema.sql:588-600 revisao_decisao | — |
| T4-04 | corrigido | app/src/screens/T4.tsx:261-281 — role=tablist, aria-selected, onKeyDown de navegação e tabpanel nomeados | — |
| T4-05 | corrigido | regras.test.tsx:789 '"atendidas no SLA" mede SLA' | — |
| T5-01 | corrigido | regras.test.tsx:947 'reclassificar sem arrasto' | — |
| T5-02 | corrigido | regras.test.tsx:1012 'cada cenário guarda o próprio histórico' | — |
| T5-03 | corrigido | regras.test.tsx:1051 'só é botão a célula que a ação alcança' | — |
| T6-01 | corrigido | POST /v1/audit/verificar grava INTEGRIDADE_VERIFICADA antes de devolver o resultado, permanecendo 'leitura' com acao própria 'verificar_integridade' (api.ts:118-129; politicas.ts:39-44). | — |
| T6-02 | corrigido | Botões de ataque atrás de duas condições — modoDemo && Permitido acao='escrever' (T6.tsx:241-263); testes regras.test.tsx:474-497. O default modoDemo=true segue como premissa de protótipo → achado F13-04. | — |
| T6-03 | corrigido | app/src/screens/T6.tsx:31-33 divergenciaEscondida + aviso em :203-206 'O filtro está escondendo a divergência' | — |
| T7-01 | corrigido | T7 opera o ciclo via API (agendar rotação/promover canary, T7.tsx:17-20) com registro no trail; a exibição de IP/principal sem redação nessa tela virou o achado F6-05. | — |
| T7-02 | corrigido | regras.test.tsx:1672 'as duas listas de cripto-shredding são cartões separados' | — |
| T8-01 | corrigido | regras.test.tsx:1496 'o editor edita' | — |
| T8-02 | corrigido | regras.test.tsx:1496 (mesmo bloco: 'o veredito guarda o raciocínio') | — |
| T8-03 | corrigido | regras.test.tsx:1505 'campo sensível é inelegível com motivo, não selecionável' | — |

---

_Relatório gerado por auditoria assistida por IA (Claude Code) com verificação adversarial; evidências reproduzíveis na seção 2.2. Documento par: [`RIPD.md`](./RIPD.md)._
