# Lastro — plataforma de governança de privacidade (LGPD)

Arquitetura, protótipo e modelo de dados de um sistema que **operacionaliza** os 12 artefatos de
privacidade de uma plataforma de crédito com IA — catálogo versionado, LINDDUN, gates de CI/CD,
triagem de RIPD, redator de PII, pseudonimizador, expurgo, rotação de KMS, coletor de métricas,
matriz de risco, parecer técnico e LIA — em uma interface única para **engenharia, DPO e produto**.

> A premissa: privacidade não é um documento que alguém lembra de escrever. É um controle que roda
> na esteira, bloqueia o que precisa ser bloqueado e deixa evidência verificável.

---

## Entregáveis

| # | Entregável | Onde |
|---|---|---|
| 1 | **Arquitetura** — como os 12 artefatos se conectam via API, ABAC por finalidade, ADRs | [`docs/01-arquitetura.md`](docs/01-arquitetura.md) |
| 2 | **Wireframes das 8 telas** — protótipo navegável de alta fidelidade | [`prototipo/index.html`](prototipo/index.html) · spec em [`docs/02-wireframes.md`](docs/02-wireframes.md) |
| 3 | **Fluxo ponta a ponta** — do PR bloqueado ao expurgo e à métrica | [`docs/03-fluxo-e2e.md`](docs/03-fluxo-e2e.md) |
| 4 | **Schema PostgreSQL** — catálogo, RIPD, riscos, LIA, direitos, expurgo, KMS, auditoria | [`db/schema.sql`](db/schema.sql) |
| + | **Contrato de API** — OpenAPI 3.1 que liga os artefatos à plataforma | [`api/openapi.yaml`](api/openapi.yaml) |

---

## Como rodar

### Protótipo

```bash
# abra no navegador — arquivo único, sem dependências
xdg-open prototipo/index.html
```

As 8 telas navegam pelo menu lateral. O seletor de **público** no topo (Engenharia / DPO / Produto)
muda o que cada tela oferece — não só o texto de ajuda. Tema claro e escuro pelo botão ◐.

### Banco

```bash
createdb gov
psql -d gov -v ON_ERROR_STOP=1 -f db/schema.sql   # 39 tabelas, 4 visões, RLS, triggers
psql -d gov -v ON_ERROR_STOP=1 -f db/seed.sql     # massa de demonstração
psql -d gov -v ON_ERROR_STOP=1 -f db/tests.sql    # 22 invariantes de privacidade
```

`db/tests.sql` roda dentro de uma transação descartada no fim — não suja a base. Cada bloco tenta
violar uma regra e **espera falhar**:

```
OK  sensível + legítimo interesse (Art. 11)     → bloqueado
OK  legítimo interesse com LIA em rascunho      → bloqueado
OK  hash declarado como anonimizado (Art. 12)   → bloqueado
OK  transferência internacional sem mecanismo   → bloqueado
OK  eliminação com verificação básica           → bloqueado
OK  revelação de campo sem finalidade (Art. 37) → bloqueado
OK  CPF em claro no canal titular↔DPO           → bloqueado
OK  UPDATE / DELETE em audit_log                → bloqueado
OK  reclassificação sem justificativa real      → bloqueado
OK  dois accountables no mesmo processo         → bloqueado
OK  segunda chave ativa na mesma finalidade     → bloqueado
OK  CPF vazando na evidência do gate            → bloqueado
OK  adulteração silenciosa é detectada          → t
```

---

## As 8 telas

| | Tela | Público | Artefatos que opera |
|---|---|---|---|
| **T1** | Painel de governança | todos | `metrics-collector.py`, `privacy-ci-gate.yml`, `architecture-review.yml`, `risk-matrix.csv` |
| **T2** | Catálogo de dados (ROPA vivo) | engenharia, DPO | `data-inventory.*.yaml`, linhagem |
| **T3** | RIPD e LINDDUN | engenharia escreve, DPO aprova | `ripd-triage.sh`, `threat-model.md`, `parecer-tecnico.md` |
| **T4** | Direitos do titular | DPO | `pseudonymizer.ts`, `privacy-redactor.ts`, Art. 18 e 20 |
| **T5** | Riscos e RACI | DPO, produto | `risk-matrix.csv` |
| **T6** | Expurgo e auditoria | engenharia, auditoria | `expurgo-permanente.py`, audit trail encadeado |
| **T7** | Chaves e criptografia | engenharia, segurança | `kms-rotation.yml` |
| **T8** | Editor de LIA | DPO | `LIA.md`, Art. 7º, IX |

---

## Privacy by design na própria interface

Não como declaração — como comportamento verificável:

- **Tudo mascarado por padrão**, inclusive para o DPO. Não existe interruptor global de "mostrar tudo".
- **Revelar exige finalidade e justificativa**, vale para um campo por 60 segundos e volta a mascarar sozinho.
- **A tentativa é registrada antes da resposta.** Se a gravação falha, a revelação falha.
- **Dado sensível não é revelável em tela alguma** — só a prova de que existe e quando será destruído.
- **O papel Produto não recebe o botão de revelar**: ele não fica desabilitado, ele não é renderizado.
- **Busca por CPF envia hash**, nunca o documento — sem PII em URL, histórico ou log de gateway.
- **Nenhuma contagem total** para papéis não confiáveis (anti-enumeração).
- **O audit trail não aceita `UPDATE` nem `DELETE`** — nem para administrador.

A mesma regra vale nas duas pontas: o que a tela recusa, o banco também recusa. Um formulário mais
permissivo que a persistência é teatro.

---

## Estrutura

```
.
├── docs/
│   ├── 01-arquitetura.md      diagramas, integração dos 12 artefatos, ABAC, ADRs
│   ├── 02-wireframes.md       spec anotada das 8 telas + sistema visual
│   └── 03-fluxo-e2e.md        cenário completo, do PR ao expurgo
├── prototipo/
│   └── index.html             protótipo navegável, arquivo único, tema claro/escuro
├── db/
│   ├── schema.sql             DDL: 39 tabelas, RLS, hash-chain, papéis por finalidade
│   ├── seed.sql               massa de demonstração (mesmos números do protótipo)
│   └── tests.sql              22 invariantes de privacidade
└── api/
    └── openapi.yaml           contrato 3.1 — 22 rotas
```

---

## Verificação

O que foi efetivamente executado, não apenas escrito:

| Verificação | Resultado |
|---|---|
| `schema.sql` em PostgreSQL 16 limpo | aplica sem erro — 39 tabelas, 4 visões |
| `seed.sql` | carrega sem erro |
| `tests.sql` | 22 invariantes, todas passam |
| Detecção de adulteração no audit trail | detectada mesmo com os gatilhos desligados |
| `openapi.yaml` | YAML válido, 22 rotas, nenhuma `$ref` quebrada |
| Protótipo em Chromium (1440 px e 720 px) | zero erro de console, zero overflow horizontal |
| Fluxos interativos | revelação com registro, arraste da matriz com justificativa, verificação de integridade, veredito do balanceamento |

---

## Escopo e limites

Isto é **arquitetura e protótipo**, não um sistema em produção. O protótipo é uma única página
estática com dados de demonstração: não há backend, autenticação nem persistência. O `schema.sql`
é executável e testado; a API está especificada, não implementada.

Nenhum dado de titular real aparece em qualquer arquivo — os CPFs do protótipo são números de teste
e os pseudônimos são fictícios.
