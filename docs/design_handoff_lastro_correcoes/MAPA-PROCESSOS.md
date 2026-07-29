# Mapa de processos → estados → telas

Documento que liga os cinco processos BPMN do programa às telas e ao código do repositório.
Serve para uma decisão específica: **não criar uma tela por processo**. Quase tudo já existe;
o que falta é a entrada centrada em trabalho e a formalização dos estados.

Princípio que guia o mapa, herdado do projeto: a regra não mora na tela. Aqui ele se estende —
**o processo também não mora em um diagrama.** Ele mora no estado do artefato e no que o sistema
recusa. O BPMN é a especificação; a máquina de estados é a implementação; a fila é a interface.

---

## 1 · O que fica onde

| Processo (BPMN) | Artefato que ele move | Onde já vive no produto | O que falta |
|---|---|---|---|
| **PR-01** Parecer técnico | `parecer` | T2 (catálogo, classificação, DFD), T3 (parecer e alçada) | estado explícito do parecer; D1 executável |
| **PR-02** RIPD e análise algorítmica | `ripd` | T3 inteira; gate de CI | dispensa registrada com gatilho de reabertura; análise algorítmica como seção |
| **PR-03** PbD no ciclo de desenvolvimento | `mudanca` | gate de CI + T1 (o que a esteira barrou) + T2 (inventário pós-deploy) | checklist dos 7 princípios como campo do épico, lido pelo gate |
| **PR-04** Ciclo de governança | `risco`, `politica`, `indicador` | T1 (maturidade e métricas), T5 (matriz e RACI), T8 (LIA) | obrigações de calendário; D2 executável |
| **PR-05** Auditoria, planos e evidências | `achado`, `incidente` | T11 (achado: causa raiz → plano → verificação), T6 (expurgo, trilha), T9 (incidentes) | — |
| — | trabalho de cada pessoa | **T0 · Minha fila** (nova) | entrada centrada em trabalho, derivada dos estados |
| — | obrigações do ano | **T10 · Calendário do ano** (nova) | fonte das obrigações que a fila promove a item |
| — | ciclo do achado | **T11 · Achados e planos de ação** (nova) | artefato `achado` — o único dos oito sem tela própria antes disto |
| — | referência do programa | **T12 · Como funciona** (nova) | fica **fora** de `TELAS`, como o §5 pede: link próprio no trilho, sem controle e sem leitura de banco |

Duas telas por processo seriam dez telas. O produto cobre os cinco fluxos com **doze** no trilho —
porque o recorte dele é por artefato, não por processo. Das quatro acrescentadas, três entram no trilho:
duas de *trabalho* (T0 e T10) e uma do artefato que faltava (T11). A quarta não é tela de operação
nenhuma e por isso fica fora dele (T12). Mantenha esse recorte.

---

## 2 · Máquinas de estado — onde elas moram

Cada artefato tem um ciclo de vida, e ele **não é enunciado aqui**. A especificação
está em `docs/processos/*.bpmn`, um arquivo por artefato, e o que a executa está em
`app/src/mock/estados.ts`. Um teste de conformidade compara os dois nas duas
direções e reprova o build quando divergem — aresta nova no código sem atualizar o
desenho reprova, e aresta apagada do desenho sem tirar do código reprova também.

Este documento tinha as oito tabelas transcritas em prosa, e elas divergiram: a
subseção "Declarado × derivado" do §4 existiu por semanas na cópia de trabalho e
não na do repositório. Duas enunciações do mesmo processo, uma com catraca e outra
sem, é o mesmo defeito que recusamos na linha do tempo do incidente — um segundo
lugar para a história divergir. O que ficou aqui é a **intenção**; o que vale é o
par conferido.

O que continua sendo decisão deste documento, e não do desenho:

- **Transição só com evidência e registro no trail.** A ordem é gravar, depois
  mover: falha de registro aborta a transição com `503`, e o estado não muda.
- **Toda transição ilegal tem teste.** As nomeadas na primeira versão deste mapa
  seguem cobertas, e a varredura de conformidade cobre todas as outras.
- **Sequência e conteúdo são coisas separadas.** Estar fora de ordem é `409`; estar
  na ordem e faltar o que sustenta é `422`. Trocar os dois códigos manda a pessoa
  reescrever um texto que já estava bom quando o problema era o passo anterior.
  As exigências de conteúdo estão listadas em `docs/processos/README.md`, ao lado
  dos arquivos e presas por teste ao que a API aplica.

### Sobre o antigo limite de seis estados

A primeira versão deste mapa pedia **no máximo seis estados por artefato**. A regra
sai, e sai porque duas máquinas legitimamente têm sete.

O RIPD tem sete porque a dispensa é um desfecho próprio — decisão registrada com
gatilho de reabertura, não ausência de RIPD — e porque a revisão periódica é um
retorno ao trabalho, não um recomeço. O achado tem sete porque a reincidência entra
com criticidade elevada e conta como reincidência: tratá-la como uma abertura nova
apagaria justamente o que a auditoria precisa ver.

Comprimir qualquer uma das duas para caber em seis custaria um campo novo para
guardar a distinção que o estado deixaria de fazer — e campo paralelo diverge do
registro, que é o problema que a máquina de estados existe para não ter. O limite
era heurística contra proliferação, e a proliferação nunca aconteceu: seis das oito
máquinas cabiam nele sem esforço, e cinco delas têm cinco estados ou menos.

---

## 3 · As decisões como dados (DMN)

As três tabelas — complexidade e alçada, nível de risco, exigência de RIPD e de
análise algorítmica — **não são enunciadas aqui**. Elas estão em
`docs/processos/*.dmn`, uma por versão publicada, e o que as executa está em
`app/src/mock/decisoes.ts`. A varredura de conformidade deriva o domínio de cada
entrada da própria tabela e compara todas as combinações: limiar novo entra na
conferência sozinho.

O que continua sendo decisão deste documento:

1. **Entrada indefinida cai no cenário mais restritivo.** Nunca no mais permissivo,
   nunca em erro. A decisão registra o que assumiu, porque omissão que decide calada
   é omissão que ninguém revisita.
2. **A decisão é explicada em uma frase na tela**, com as entradas que a produziram.
   A frase é derivada da regra que casou, não escrita ao lado dela — texto ao lado
   de uma regra é a próxima divergência esperando acontecer.
3. **A versão aplicada fica gravada em cada decisão.** Publicar uma versão nova não
   mexe em decisão já tomada: as versões convivem, e quem confere uma decisão de
   março precisa ler a tabela de março.
4. **Um só modelo de risco.** A tabela de nível de risco é a fonte da faixa de cor
   da matriz da T5. Não existe segundo limiar escrito na tela.

---

## 4 · T0 · Minha fila — o recorte

Está desenhada em `Lastro Redesenho.dc.html`, primeira tela do trilho. O que ela é:

- **Derivada, nunca digitada.** Cada item vem de um artefato em estado que exige ação do papel atual.
  Não existe “criar item na fila”.
- **Ordenada por consequência**, não por data de chegada: prazo vencido → prazo legal correndo →
  próximos 30 dias.
- **Quatro informações por item, sempre as mesmas:** o que está travado por causa dele, o prazo, a
  sua próxima ação e quem vem depois de você. Mais que isso vira relatório.
- **O rito aparece explicado**, com a regra que o decidiu (D1/D2/D3).
- **Estado do artefato como faixa de passos**, com o atual destacado — a pessoa vê onde está no
  processo sem abrir diagrama nenhum.
- **Contadores como pergunta, não como métrica:** o que venceu · o que é para hoje · o que vem em 30
  dias · o que é de outro papel.

### Declarado × derivado — quem é dono

Item de fila é derivado: o dono sai da `Acao` que a próxima transição exige, nunca de campo escrito
à mão. Obrigação de calendário é dado autorado: declara `responsavel` como declara `antecedencia`, e
o item promovido herda esse dono. Não é exceção ao princípio da fila — é o outro lado dele. Um teste
falha quando uma obrigação promovível não declara `responsavel`, para o vazio não voltar a `escrever`
em silêncio.

O que ela **não** é: caixa de entrada de notificações, lista de tudo, nem substituta do painel. O
painel (T1) responde pelo estado do programa; a fila responde pelo seu dia.

### Obrigações de calendário — T10

O ano inteiro provisionado em 1º de janeiro, com três decisões que separam isto de um calendário comum:

1. **A barra de cada mês é carga provisionada, não progresso.** Julho e agosto já saem em 85% e 80%
   por causa do diagnóstico e do roadmap — logo, incidente em agosto custa mais caro que em fevereiro.
2. **O que chega por demanda não tem data, tem reserva de capacidade** (30%, pela média histórica de
   incidentes, direitos e achados). Sem essa reserva, o ciclo do programa é atropelado todo mês.
3. **Cada obrigação declara o que acontece se passar** — “o campo perde base legal e o gate bloqueia
   dois repositórios”, não “revalidar consentimento em março”. É esse texto que vai no convite.

Regras de sincronização com Teams e Google, desenhadas antes de existir integração: compromisso vira
evento com convidados; prazo vira evento de dia inteiro marcado como prazo; **nada por demanda sai e
nenhum evento carrega dado pessoal** (código, tipo e link de volta — nunca titular, protocolo com
dado, escopo de incidente ou anexo); e a direção é única — mover a data no Teams não muda o prazo
aqui, e prorrogar exige justificativa registrada. Comece por **feed ICS assinado por papel**, somente
leitura: pega quase todo o valor sem pedir permissão de escrita no calendário de ninguém.

O bloco resumido continua na fila (T0). Diagnóstico anual, revisão trimestral, reavaliação de risco
aceito, vencimento de LIA, de consentimento e de chave **não são instâncias de processo**: são
compromissos agendados que geram item na fila quando chega a hora. Modelar como processo em execução
é o que faz painel de governança encher de coisa que ninguém trata.

---

## 5 · Onde não gastar esforço

- **Não embutir renderizador de BPMN na interface.** Se quiser mostrar o fluxo, uma página “Como
  funciona” somente leitura resolve. Ninguém opera um diagrama.
- **Não adotar BPMS agora.** O repositório não tem backend; Camunda e digital workers só se pagam com
  volume e integrações reais. Se um dia entrar, a fronteira é: o BPMS orquestra **pessoas entre
  áreas** (comitê, jurídico, compras); o Lastro é dono dos **artefatos e dos gates**. Integração por
  API e por estado, nunca por incorporação.
- **Não transportar os formulários das atividades A1.1…A5.9 para a tela.** Sete passos por atividade
  × 40 atividades é formulário que ninguém preenche. Derive do que já existe: sistemas, campos,
  retenção e compartilhamentos vêm do catálogo lido do repositório; a pessoa responde finalidade,
  volume e terceiros.
- **Não documentar 30 SLAs.** Três prazos com consequência real valem mais que trinta com cor. Prazo
  estourado precisa fazer algo — bloquear, escalar, notificar —, e o gate de CI já é o modelo.
- **Não criar um segundo modelo de risco.** D2 e a matriz da T5 são a mesma coisa.

---

## 6 · Ordem sugerida (depois dos 6 PRs do handoff atual)

| PR | Escopo | Por quê nesta ordem |
|---|---|---|
| 7 | `estados.ts` + transições ilegais como teste | é a base dos dois seguintes; sem estado formal a fila é palpite |
| 8 | D1/D2/D3 como dados versionados, versão gravada na decisão | tira regra da tela e torna a decisão reproduzível meses depois |
| 9 | T0 · Minha fila, derivada dos estados | a tela que torna o programa operável |
| 10 | T10 · Calendário do ano + obrigações gerando item na fila | fecha a segunda natureza de trabalho |
| 11 | Dispensa de RIPD com gatilho de reabertura; checklist PbD lido pelo gate | completa PR-02 e PR-03 do BPMN |
| 12 | `docs/processos/*.bpmn` + `*.dmn` versionados e uma página “Como funciona” | a especificação entra no repositório como fonte, não como anexo |

> **Estatuto deste documento.** Os seis PRs acima entraram, e com eles a especificação executável
> passou a viver em `docs/processos/*.bpmn` e `*.dmn`, conferidos por teste contra
> `app/src/mock/estados.ts` e `app/src/mock/decisoes.ts`. A partir daí este mapa é **documento de
> intenção**: ele explica o porquê das decisões e não é fonte da verdade sobre estado, transição ou
> tabela de decisão. Quando o texto daqui e o par conferido discordarem, o par conferido está certo —
> e a discordância é um defeito deste arquivo, não do código.

**Antes de tudo isso, em PR próprio direto na `main`: o gate de CI do repositório (C-18).** O projeto
defende que RIPD é gate de CI e não documento pós-fato — e o repositório não tem `.github/workflows/`.
Um workflow com `tsc --noEmit` + `npm test`, marcado como *required status check* na `main`, é
pré-requisito de coerência para os PRs seguintes. Gate que não bloqueia merge é decoração, pelo mesmo
argumento que vale para SLA.

Os `.bpmn` e `.dmn` são bem-vindos no repositório — como fonte da verdade do processo, ao lado do
`schema.sql` e do `openapi.yaml`. O que eles não devem ser é a tela.
