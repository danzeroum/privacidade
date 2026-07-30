# Lastro — plataforma de governança de privacidade (LGPD)

Arquitetura, modelo de dados e protótipo de um sistema que **operacionaliza** os 12 artefatos de
privacidade de uma plataforma de crédito com IA — catálogo versionado, LINDDUN, gates de CI/CD,
triagem de RIPD, redator de PII, pseudonimizador, expurgo, rotação de KMS, coletor de métricas,
matriz de risco, parecer técnico e LIA — em uma interface única para engenharia, DPO, produto,
segurança e auditoria externa.

> A premissa: privacidade não é um documento que alguém lembra de escrever. É um controle que roda
> na esteira, bloqueia o que precisa ser bloqueado e deixa evidência verificável.

---

## A tese: a mesma doutrina em três camadas

O que diferencia este repositório de um conjunto de telas bonitas é que **cada regra de privacidade
é aplicada em três lugares independentes**, e cada um tem sua própria prova executável. Um formulário
mais permissivo que a persistência é teatro; uma tela que "explica" a regra sem recusá-la é
decoração.

| Camada | Onde | Como recusa | Prova |
|---|---|---|---|
| **Banco** | [`db/schema.sql`](db/schema.sql) | `CHECK`, índice único parcial, trigger, RLS | <!-- n:invariantes -->**98** invariantes em [`db/tests.sql`](db/tests.sql) |
| **API** | [`app/src/mock/api.ts`](app/src/mock/api.ts) | 403 · 404 · 409 · 422 · 503, com a regra citada | <!-- n:testes -->**700+** testes em [`app/tests/regras.test.tsx`](app/tests/regras.test.tsx) |
| **Interface** | [`app/src/ui/primitivos.tsx`](app/src/ui/primitivos.tsx) | o controle **não é renderizado** | asserção de DOM na mesma suíte |

Exemplo concreto — legítimo interesse sobre dado sensível (Art. 11):
o banco recusa com `campo_sensivel_base_legal`, a API devolve `422` citando o artigo, e a tela mostra
erro inline antes de deixar submeter. Derrubar qualquer uma das três não abre caminho.

---

## Entregáveis

| # | Entregável | Onde |
|---|---|---|
| 1 | **Arquitetura** — integração dos 12 artefatos via API, ABAC por finalidade, ADRs | [`docs/01-arquitetura.md`](docs/01-arquitetura.md) |
| 2 | **Wireframes** — spec anotada das telas originais e sistema visual | [`docs/02-wireframes.md`](docs/02-wireframes.md) |
| 3 | **Fluxo ponta a ponta** — do PR bloqueado ao expurgo e à métrica | [`docs/03-fluxo-e2e.md`](docs/03-fluxo-e2e.md) |
| 4 | **Schema PostgreSQL** — 39 tabelas, RLS, audit trail com hash encadeado | [`db/schema.sql`](db/schema.sql) |
| 5 | **Protótipo navegável** — React + TS, rota real, store, API mock, 3 cenários | [`app/`](app/) · roteiro em [`app/README.md`](app/README.md) |
| 6 | **Protótipo estático** — página única, referência visual de alta fidelidade | [`prototipo/index.html`](prototipo/index.html) |
| + | **Contrato de API** — OpenAPI 3.1 com 22 rotas | [`api/openapi.yaml`](api/openapi.yaml) |

Os dois protótipos coexistem de propósito: o estático é a **referência visual** congelada das 8
telas, em arquivo único que abre sem instalar nada; o navegável é onde as regras viram
**comportamento** e podem ser exercidas.

---

## Como rodar

### Protótipo navegável — comece por aqui

```bash
cd app
npm install
npm run dev      # http://localhost:5173
npm test         # a suíte inteira de comportamento
npm run build    # bundle estático em dist/
```

Os dois seletores no topo mudam o sistema, não o texto: **público** (5 papéis) e **cenário**
(crédito, varejo, mídia). O roteiro dos três fluxos críticos está em [`app/README.md`](app/README.md).

### Banco

```bash
createdb gov
psql -d gov -v ON_ERROR_STOP=1 -f db/schema.sql   # 39 tabelas, 4 visões, RLS, triggers
psql -d gov -v ON_ERROR_STOP=1 -f db/seed.sql     # massa de demonstração
psql -d gov -v ON_ERROR_STOP=1 -f db/tests.sql    # 23 invariantes de privacidade
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

### Protótipo estático

```bash
xdg-open prototipo/index.html    # arquivo único, sem dependências
```

---

## As telas

Transcritas de `TELAS` em [`app/src/App.tsx`](app/src/App.tsx), que é o mesmo array que monta o
trilho de navegação — uma tela fora dele não é alcançável, e por isso o trilho é a definição
operante de "as telas do app". Um teste confere a tabela abaixo contra ele **nos dois sentidos**:
tela nova sem linha aqui reprova, e linha aqui sem tela reprova.

<!-- telas:inicio -->
| | Tela | Rota | Grupo |
|---|---|---|---|
| **T0** | Minha fila | `/t0` | Trabalho |
| **T10** | Calendário do ano | `/t10` | Trabalho |
| **T1** | Painel de governança | `/t1` | Esteira de entrega |
| **T2** | Catálogo de dados | `/t2` | Esteira de entrega |
| **T3** | RIPD e LINDDUN | `/t3` | Esteira de entrega |
| **T4** | Direitos do titular | `/t4` | Operação e prova |
| **T5** | Riscos e RACI | `/t5` | Operação e prova |
| **T6** | Expurgo e auditoria | `/t6` | Operação e prova |
| **T7** | Chaves e criptografia | `/t7` | Operação e prova |
| **T8** | Editor de LIA | `/t8` | Operação e prova |
| **T9** | Incidentes | `/t9` | Operação e prova |
| **T11** | Achados e planos | `/t11` | Operação e prova |
<!-- telas:fim -->

### Cinco papéis, e o que cada um **não** recebe

O controle de acesso é por ação, não por CSS: `Permitido` devolve `null` e o componente não entra no
DOM. Nem `display:none`, nem `disabled` — os dois deixam o controle na página e não sobrevivem a uma
auditoria de código.

| Papel | Não é renderizado |
|---|---|
| **Engenharia** | aprovar RIPD, assinar LIA, revelar PII |
| **DPO** | log cru do workflow, pipeline de rotação de chaves |
| **Produto** | **todo** botão de revelar, contagem total, qualquer escrita |
| **Segurança** | a tela T4 inteira — não monta e não emite requisição |
| **Auditor externo** | contagem total e toda rota de escrita |

### Três cenários, três riscos dominantes

| Cenário | Setor | Risco que domina a matriz |
|---|---|---|
| **Crédito IA** | financeiro | decisão automatizada sem revisão humana (Art. 20) |
| **Rede Aurora** | varejo com farmácia | dado de saúde cruzando para o motor de recomendação |
| **Palco Streaming** | mídia | inferência reconstruindo categoria sensível sem coleta |

Mesma arquitetura, mesmas telas, mesmas regras — o que muda é onde a doutrina aperta.

---

## As 9 regras que o protótipo exerce

| # | Regra | Como a plataforma recusa |
|---|---|---|
| 1 | Legítimo interesse não cobre dado sensível (Art. 11) | 422 ao vincular campo sensível a uma LIA |
| 2 | Hash de CPF não é anonimização (Art. 12) | inventário recusado inteiro |
| 3 | Revelar PII exige finalidade + justificativa + registro **antes** da resposta | com o log indisponível: 503 e nenhum valor sai |
| 4 | Dado sensível não é revelável em tela alguma | 403 na API e nenhum botão montado no DOM |
| 5 | 404, nunca 403, fora do escopo do ator | resposta indistinguível de "não existe" |
| 6 | `totalItems` omitido para papéis não confiáveis | anti-enumeração |
| 7 | Audit trail append-only | 409 em `PATCH`/`DELETE`; a cadeia acusa adulteração feita no banco |
| 8 | Transferência internacional exige mecanismo (Art. 33) | 422 sem SCC, adequação ou norma corporativa |
| 9 | RIPD é gate de CI, não documento pós-fato | a aprovação do DPO repõe o status check do PR |

A regra 3 carrega o teste mais importante do conjunto: a ordem é **gravar, depois responder**. É o
que impede que uma falha de observabilidade se transforme em acesso sem rastro.

Complementos que valem para toda a interface:

- **Tudo mascarado por padrão**, inclusive para o DPO. Não existe interruptor global de "mostrar tudo".
- **A revelação vale para um campo, por 60 segundos**, e volta a mascarar sozinha.
- **A busca por CPF envia hash** calculado no navegador — sem PII em URL, histórico ou log de gateway.
- **Toggles nascem desligados**; nenhuma coleta começa ligada.

---

## Estrutura

```
.
├── docs/
│   ├── 01-arquitetura.md      diagramas, integração dos 12 artefatos, ABAC, ADRs
│   ├── 02-wireframes.md       spec anotada das telas originais + sistema visual
│   └── 03-fluxo-e2e.md        cenário completo, do PR ao expurgo
├── db/
│   ├── schema.sql             RLS, hash-chain, papéis por finalidade
│   ├── seed.sql               massa de demonstração
│   └── tests.sql              invariantes de privacidade, executadas no CI
├── api/
│   └── openapi.yaml           contrato 3.1, lido por teste de paridade
├── app/                       protótipo navegável React + TypeScript
│   ├── src/lib/sha256.ts      SHA-256 síncrono, sem dependências
│   ├── src/mock/api.ts        as 9 regras, implementadas fora da interface
│   ├── src/mock/scenarios.ts  três cenários: crédito, varejo, mídia
│   ├── src/screens/           uma tela por rota — ver "As telas" acima
│   └── tests/regras.test.tsx  a suíte de comportamento
└── prototipo/
    └── index.html             protótipo estático, arquivo único, tema claro/escuro
```

---

## Verificação

Instantâneo de uma verificação **manual**, feita à mão numa data. O que hoje roda a cada PR está
na seção **Checks de CI** — e é lá que a garantia mora: uma tabela conferida por alguém em algum
momento não impede a regressão de amanhã. As linhas abaixo ficam porque exercitam coisas que
nenhum check cobre (navegador real, fluxos ponta a ponta), e os números que envelhecem saíram.

| Verificação | Resultado |
|---|---|
| `schema.sql` em PostgreSQL 16 limpo | aplica sem erro — <!-- n:tabelas -->**48** tabelas, <!-- n:visoes -->**8** visões |
| `seed.sql` | carrega sem erro |
| `tests.sql` | todas as invariantes passam — hoje no check `Constraints e invariantes do banco` |
| Adulteração no audit trail | detectada mesmo com os gatilhos desligados |
| `openapi.yaml` | YAML válido, <!-- n:operacoes -->**73** operações, nenhuma `$ref` quebrada |
| `tsc -b` · `vitest run` · `vite build` | typecheck limpo, suíte verde — hoje no check `Tipos e testes` |
| App em Chromium, todas as rotas × 3 cenários | zero erro de console, zero overflow a 1440 px e 720 px |
| Protótipo estático em Chromium | zero erro de console, zero overflow |
| Fluxo A | RIPD aprovado → status check verde, PR sai da lista de bloqueados |
| Fluxo B | revelação registrada → valor volta a mascarar em 60 s |
| Fluxo C | log forjado → cadeia acusa o bloco e todos os seguintes |

O SHA-256 de `app/src/lib/sha256.ts` foi conferido contra `node:crypto` em 8 casos. É implementação
própria porque `crypto.subtle` é assíncrono, e uma cadeia de hashes que depende de `await` no meio do
append vira corrida — cadeia com corrida não prova nada.

---

## Checks de CI

Transcritos de [`.github/workflows/`](.github/workflows), e conferidos por teste nos dois sentidos:
job novo sem linha aqui reprova, e linha aqui sem job reprova. Os jobs em matriz publicam um check
por plataforma — o leg Ubuntu com o nome da tabela, e o leg Windows com ` (windows)` no fim.

A coluna **O que sustenta** também é transcrição: o texto mora no marcador `# sustenta:` do próprio
job, e não aqui. Controle descrito longe do job que o executa envelhece sozinho — é a mesma razão
pela qual o motivo de ficar fora da matriz mora no YAML e não numa lista de exceções à parte.

<!-- workflows:inicio -->
| Arquivo | Job (nome do check) | O que sustenta | Dispara em |
|---|---|---|---|
| `ci.yml` | `Tipos e testes` | as nove regras LGPD como comportamento, e a tipagem que as sustenta | PR, push |
| `equidade.yml` | `Disparidade e proxies do modelo` | o piso de disparidade e a lista fechada de proxies que a LIA-SCORING-001 cita | PR, push |
| `privacy-ci-gate.yml` | `PII, catálogo e PbD` | dado pessoal fora do inventário, campo fora do catálogo e as quatro premissas de aceite | PR, push |
| `relogio.yml` | `Varreduras de prazo` | as quatro varreduras de prazo, abrindo alerta idempotente — informa em vez de barrar, e por isso não deve ser required | agendado, manual |
| `schema.yml` | `Constraints e invariantes do banco` | os CHECK, triggers e colunas GENERATED que o schema apresenta como prova de conformidade | PR, push |
| `seguranca.yml` | `Segredos no diff e no histórico` | segredo de fornecedor no diff e em todo o histórico do git | PR, push, agendado |
| `seguranca.yml` | `Dependências vulneráveis` | o limiar de advisory declarado, com exceção datada e motivo | PR, push, agendado |
| `seguranca.yml` | `CodeQL` | alerta novo que o diff acrescenta — o pré-existente aparece na aba Security sem bloquear | PR, push, agendado |
<!-- workflows:fim -->

Três são *required status check* na proteção da `main`; os demais informam o vermelho sem impedir
o merge. **`Varreduras de prazo` não deve ser marcado**, e o próprio workflow explica por quê: a
pendência dele está no mundo (um DPA que vence), não no diff de quem abriu o PR — e uma `main`
vermelha todo dia treina a equipe a ignorar vermelho.

---
## Escopo e limites

Isto é **arquitetura e protótipo**, não um sistema em produção.

- **Não há backend.** A API do `app/` roda no navegador; recarregar a página zera o estado. O
  `openapi.yaml` está especificado e simulado, não implementado em servidor.
- **Não há autenticação.** Trocar de papel é um seletor, não um login. O que se demonstra é a
  *consequência* do papel, não o mecanismo que o estabelece.
- **O `schema.sql` é executável e testado**, mas nenhuma aplicação se conecta a ele — a API mock
  reproduz suas restrições, não as consulta.
- **O mermaid não usa o renderizador oficial**: a pré-visualização extrai os nós na ordem e desenha a
  cadeia, suficiente para conferir o fluxo antes do commit.
- **O CI existe, e três checks são obrigatórios.** Ver a seção **Checks de CI** acima. O que ele
  ainda não cobre: não há ambiente implantado, então nenhum check exercita o sistema em execução.

Nenhum dado de titular real aparece em qualquer arquivo — os CPFs são números de teste e os nomes e
pseudônimos são fictícios.
