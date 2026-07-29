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
| **PR-05** Auditoria, planos e evidências | `achado`, `incidente` | T11 (achado: causa raiz→plano→verificação), T6 (expurgo, trilha), T9 (incidentes) | — |
| — | trabalho de cada pessoa | **T0 · Minha fila** (nova) | entrada centrada em trabalho, derivada dos estados |
| — | obrigações do ano | **T10 · Calendário do ano** (nova) | fonte das obrigações que a fila promove a item |
| — | ciclo do achado | **T11 · Achados e planos de ação** (nova) | artefato `achado` — o único dos oito sem tela própria antes disto |

Duas telas por processo seriam dez telas. O produto cobre os cinco fluxos com onze — porque o recorte
dele é por artefato, não por processo, e as duas telas novas são de *trabalho*, não de processo.
Mantenha esse recorte.

---

## 2 · Máquinas de estado — ponteiro

As oito máquinas (parecer, ripd, lia, risco, solicitacao, achado, incidente, chave) são especificadas
em `docs/processos/*.bpmn` e conferidas contra `estados.ts` por catraca de conformidade — quando este
texto e o par conferido discordarem, o par conferido está certo e a discordância é defeito do arquivo.
O que não vive em lugar nenhum além daqui: a ordem gravar-antes-de-mover (falha de log é 503 e o
estado não muda), a separação entre sequência (409) e conteúdo (422), e as voltas declaradas de
propósito — risco reavaliado é risco vivo, revisar é reabrir o trabalho, reincidência não recomeça do
plano que falhou. As exigências de conteúdo (422) estão enunciadas em `docs/processos/README.md`,
com teste que aponta lacuna quando um ramo novo nasce sem linha.

## 3 · As decisões como dados — ponteiro

D1 (complexidade e alçada), D2 (nível de risco — a mesma grade da matriz da T5, uma fonte só) e D3
(exige RIPD) vivem em `decisoes.ts`, versionadas, com a versão aplicada gravada em cada decisão
dentro do payload do hash; a especificação conferível é `docs/processos/*.dmn`. Permanece daqui o que
os XML não dizem: entrada indefinida cai no cenário mais restritivo, nunca no permissivo; e a decisão
é explicada em uma frase na tela, com as entradas que a produziram.

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

### Declarado × derivado — quem é dono

A regra que sustenta os dois lados, e que deve virar invariante para não regredir: **item de fila é
*derivado*** — o dono sai da `Acao` que a próxima transição exige, nunca de um campo escrito à mão
(senão diverge de `permissoes.ts`, como o rótulo do gatilho divergia do catálogo antes do PR 8).
**Obrigação de calendário é *dado autorado*** — provisionada em 1º de janeiro, declara `responsavel`
do mesmo jeito que declara `antecedencia` e `consequencia`; o item que ela promove herda esse dono.
Não é exceção ao princípio da fila: é o outro lado dele. Por isso obrigação de condução do programa
não deve cair em `escrever` (que a espalha por engenharia e segurança) — ela nomeia o `responsavel`.
Um teste deve falhar quando uma obrigação promovível não declara `responsavel`, para que o vazio não
volte a `escrever` em silêncio.

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

**Antes de tudo isso, em PR próprio direto na `main`: o gate de CI do repositório (C-18).** O projeto
defende que RIPD é gate de CI e não documento pós-fato — e o repositório não tem `.github/workflows/`.
Um workflow com `tsc --noEmit` + `npm test`, marcado como *required status check* na `main`, é
pré-requisito de coerência para os PRs seguintes. Gate que não bloqueia merge é decoração, pelo mesmo
argumento que vale para SLA.

Os `.bpmn` e `.dmn` são bem-vindos no repositório — como fonte da verdade do processo, ao lado do
`schema.sql` e do `openapi.yaml`. O que eles não devem ser é a tela.
