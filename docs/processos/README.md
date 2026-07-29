# Processos e decisões versionados

Os `.bpmn` e os `.dmn` deste diretório são a **especificação de referência** do
programa, versionados ao lado do `db/schema.sql` e do `api/openapi.yaml` pelo
mesmo motivo: fonte da verdade do processo pertence ao repositório, não a um
anexo de e-mail.

O que roda em produção continua sendo TypeScript — `app/src/mock/estados.ts` e
`app/src/mock/decisoes.ts`. Estes arquivos **não são uma segunda fonte de
verdade carregada em tempo de execução**; são a especificação conferida contra
o código por teste.

## A catraca

`app/tests/regras.test.tsx` compara os dois lados e reprova o build quando eles
divergem — **em qualquer direção**:

| Se acontecer | O teste diz |
|---|---|
| Aresta nova em `estados.ts`, `.bpmn` intocado | `transição X→Y existe no runtime e não no .bpmn` |
| Aresta apagada do `.bpmn`, runtime intocado | `transição X→Y existe no .bpmn e não no runtime` |
| Estado novo de um lado só | `estado "Z" existe no runtime e não no .bpmn` (e o inverso) |
| Limiar mudado num `.dmn` | a varredura de combinações acusa a primeira entrada que discorda |

Um teste que olhasse só para um lado deixaria o documento envelhecer em
silêncio, que é o destino comum de diagrama versionado junto com código.

A varredura dos `.dmn` deriva o domínio de cada campo **da própria tabela**:
valores citados nas regras, mais as fronteiras de cada limiar numérico. Limiar
novo entra na varredura sozinho.

## Como estes arquivos nasceram, e como se mantêm

Eles foram **gerados uma vez** a partir do runtime, no PR 12. Escrever doze XML
à mão teria a mesma circularidade, com erros de digitação a mais.

A partir daquele commit eles são mantidos **à mão**, como especificação. Não há
gerador no repositório de propósito: um comando que regenera transformaria o
documento num relatório do código, e a catraca deixaria de significar alguma
coisa — bastaria rodá-lo para o vermelho sumir sem ninguém decidir nada.

## O recorte dos arquivos

Um `.bpmn` por **artefato**, e não um por processo do `MAPA-PROCESSOS.md §1`.
A razão é a conformidade: `parecer.bpmn` corresponde a `MAQUINAS.parecer`, e a
comparação é mecânica. Um arquivo com três ciclos de vida dentro exigiria uma
convenção de recorte que ninguém consegue verificar.

O mapeamento para os cinco processos do §1 continua declarado — no `name` de
cada `<process>` e na tabela da página "Como funciona":

| Processo | Artefatos | Arquivos |
|---|---|---|
| PR-01 Parecer técnico | `parecer` | `parecer.bpmn` |
| PR-02 RIPD e análise algorítmica | `ripd` | `ripd.bpmn` |
| PR-03 PbD no ciclo de desenvolvimento | `chave` | `chave.bpmn` |
| PR-04 Ciclo de governança | `risco`, `lia` | `risco.bpmn`, `lia.bpmn` |
| PR-05 Auditoria, planos e evidências | `achado`, `incidente`, `solicitacao` | `achado.bpmn`, `incidente.bpmn`, `solicitacao.bpmn` |

Um `.dmn` por **versão publicada** da tabela: `d1.v1.dmn` e `d1.v2.dmn` convivem,
como convivem no catálogo do runtime. Uma decisão gravada em março aponta para a
versão de março, e quem confere precisa ler a tabela de março — não a de hoje.

## O que estes arquivos deliberadamente não dizem

**O `.bpmn` não declara o conteúdo que cada transição exige.** Fundamento, dono
declarado, prazo de reavaliação e justificativa são **validação**, e vivem em
`app/src/mock/api.ts`. A separação é a mesma que o código faz: sequência errada
é `409`, conteúdo faltando é `422`. Misturar as duas produz o defeito clássico —
devolver `422` para quem pulou um passo manda a pessoa reescrever um texto que
já estava bom.

**O `.dmn` não declara o preenchimento do indefinido.** "Entrada ausente cai no
cenário mais restritivo" é contrato de `aplicar()`, em volta da tabela: a tabela
recebe entradas já preenchidas. Modelá-lo como linha faria a regra de omissão
competir com as regras de negócio na mesma política de acerto.

**Nenhum arquivo carrega dado de cenário.** Especificação descreve o processo,
não uma instância dele — e há teste varrendo os doze arquivos contra os
identificadores da massa de demonstração.

## Onde isto aparece no produto

Em lugar nenhum operável, e isso é decisão do `MAPA-PROCESSOS.md §5`: ninguém
opera um diagrama. A página **"Como funciona"** (`/#/como-funciona`) explica onde
cada peça mora e o que impede a descrição de virar ficção, sem renderizar BPMN,
sem ler o banco e sem nenhum controle que escreva.
