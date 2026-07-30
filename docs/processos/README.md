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

Elas estão enunciadas logo abaixo, e não no `.bpmn`, porque são a outra metade da
mesma decisão — quem lê o desenho precisa saber onde procurar a metade que falta.

**O `.dmn` não declara o preenchimento do indefinido.** "Entrada ausente cai no
cenário mais restritivo" é contrato de `aplicar()`, em volta da tabela: a tabela
recebe entradas já preenchidas. Modelá-lo como linha faria a regra de omissão
competir com as regras de negócio na mesma política de acerto.

**Nenhum arquivo carrega dado de cenário.** Especificação descreve o processo,
não uma instância dele — e há teste varrendo os doze arquivos contra os
identificadores da massa de demonstração.

## As exigências de conteúdo — o que produz `422`

O desenho diz quais transições são legais. Estas linhas dizem o que cada uma exige
**além** de estar na ordem certa. Elas vivem aqui, ao lado dos arquivos de processo,
porque até o PR 13 só existiam em `exigenciasDe()` e nos testes — executáveis e
conferidas, mas ilegíveis para quem não lê TypeScript.

Há catraca aqui também: um teste extrai os ramos de `exigenciasDe()` do código e
reprova o build quando um deles não tem linha nesta tabela. Exigência nova sem
enunciado vira lacuna apontada, não silêncio.

| Artefato | Transição | O que a rota exige além da sequência | Por quê |
|---|---|---|---|
| `parecer` | `homologado → devolvido` | motivo de ao menos 20 caracteres | Devolução sem motivo é ida e volta sem aprendizado — e a terceira devolução vai ao comitê sem que ninguém saiba por quê. |
| `ripd` | `triagem → dispensado` | justificativa de ao menos 20 caracteres **e** ao menos um gatilho de reabertura do catálogo da triagem, com a condição que o faria disparar neste sistema | Dispensa sem registro é omissão, não decisão. E gatilho em prosa não dispara nada: o código do catálogo é o que permite a esteira reabrir o RIPD sozinha. |
| `risco` | `em_tratamento → aceito` | dono da aceitação, prazo de reavaliação e gatilho de reabertura | Risco aceito sem dono volta como surpresa, e sem prazo vira permanente. |
| `solicitacao` | `em_analise → recusada_com_fundamento` | fundamento legal de ao menos 20 caracteres | Art. 18, §4º: a negativa é fundamentada. Recusa sem fundamento não é atendimento, é silêncio com carimbo. |
| `achado` | `→ causa_raiz` (de `aberto` ou de uma reabertura) | causa raiz de ao menos 20 caracteres, e **nova** quando vem de reabertura | Plano apoiado em sintoma corrige a ocorrência e deixa a causa de pé — que é como o mesmo achado volta com outro código seis meses depois. |
| `achado` | `causa_raiz → plano` | plano e critério de eficácia, ambos de ao menos 20 caracteres | O critério é declarado antes de executar. Declarado depois, ele é escrito por quem já sabe o resultado e passa a descrever o que aconteceu. |
| `achado` | `plano → executado` | quem executou e evidência anexada | Execução sem prova é relato. E o nome do executor é o fato contra o qual a independência da verificação é aferida no passo seguinte. |
| `achado` | `executado → verificado` | quem verificou, **diferente de quem executou**, o veredito contra o critério e evidência própria | A verificação de eficácia é independente de quem executou — executar não é comprovar que resolveu. E verificar sem concluir contra o critério deixa o encerramento sem base. |
| `achado` | `verificado → encerrado` | que a verificação tenha concluído que o critério **foi atingido** | Aqui a sequência está certa e o conteúdo é que falta: encerrar depois de uma verificação negativa registraria como resolvido o que a própria verificação disse que não resolveu. O caminho é reabrir. |
| `fornecedor` | `ativo → desligando` | motivo de ao menos 20 caracteres e janela declarada em dias, que não pode ultrapassar o prazo de encerramento do DPA | Desligar é fato com motivo e ator, não `UPDATE` de flag: sem os dois, o registro responde "está desligado" e nada mais. A janela é a promessa contratual de devolução — livre, ela deixaria de ser conferível contra o contrato. |
| `fornecedor` | `desligando → desligado` | prova de destruição da chave: quem destruiu, quando, e hash encadeado | Marcar desligado sem destruir a chave é declarar encerrado o que continua descriptografável. A prova precede o fato — falha de registro aborta a destruição e o estado não muda. |
| `achado` | `verificado → reaberto` | motivo de ao menos 20 caracteres | A reabertura eleva a criticidade e conta reincidência; quem receber o achado depois precisa saber por quê, e a análise anterior não é herdada. |

Duas exigências transversais, que não são de nenhuma transição em particular:

- **Toda transição grava antes de aplicar.** Falha de registro é `503` e o estado
  não muda. A ordem importa e existe teste para ela.
- **Todo texto que entra em registro passa pelo redator antes de ser gravado.** O
  que chega com dado pessoal é redigido na escrita, não na exibição.

## Onde isto aparece no produto

Em lugar nenhum operável, e isso é decisão do `MAPA-PROCESSOS.md §5`: ninguém
opera um diagrama. A página **"Como funciona"** (`/#/como-funciona`) explica onde
cada peça mora e o que impede a descrição de virar ficção, sem renderizar BPMN,
sem ler o banco e sem nenhum controle que escreva.
