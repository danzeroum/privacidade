---
# Avaliação de Impacto Algorítmico — credit-scoring (Risco-007).
#
# O cabeçalho abaixo é a parte conferida por máquina; o texto depois dele é para
# quem lê. A separação é a decisão central deste documento.
#
# O que está aqui é **transcrição travada**: `modelo`, `fatores` e a razão medida
# aparecem como valor, e um teste reprova o build quando divergem da fonte. Não é
# redigitação — é o mesmo padrão da tabela de estados transcrita do desenho, onde
# divergir é vermelho.
#
# O que NÃO está aqui é o piso: ele é política e mora num lugar só. O campo
# aponta para `.privacy/equidade.yaml` em vez de repetir o número, e a prosa
# abaixo não carrega nenhum literal de taxa — um teste recusa. Documento com
# número próprio envelhece contra o instrumento em silêncio, e foi assim que a
# faixa "0,8–1,2" sobreviveu no modelo de ameaças até o PR do teste de
# disparidade.
versao: 1
modelo: credit-scoring v2.3.1
declarado_em: '2026-07-30'
lia: LIA-SCORING-001

# Conjunto fechado. Fator que entra no SHAP e não aqui reprova; fator daqui que
# sai do SHAP reprova também — os dois sentidos, senão a lista deixa de ser
# fechada sem ninguém notar.
fatores:
  - tempo_emprego
  - score_serasa
  - renda

# Ponteiros, não cópias. A lista de proxies e o piso da razão de aprovação são
# decisões de política com um dono só.
proxies_declarados_em: .privacy/equidade.yaml
piso_declarado_em: .privacy/equidade.yaml

# Resultado datado, e travado contra a massa. Mudar a massa sem redatar esta
# medição reprova: é o que faz "mudança no modelo sem AIA reavaliada" ser
# bloqueio em vez de recomendação.
medicao:
  em: '2026-07-30'
  razao_milesimos: 867
  massa: .privacy/equidade-decisoes.csv
  comando: npm run equidade

# As duas pontas do Art. 20: o pedido é do titular, o ato é do controlador.
revisao_humana:
  pedido_do_titular: POST /me/decisoes/{id}/revisao
  ato_do_controlador: POST /decisoes/{id}/revisar

# Quem exige esta AIA. A D3 já respondia `analiseAlgoritmica=true` e não apontava
# para artefato nenhum — a saída exigia uma análise que não existia.
exigida_por:
  tabela: d3
  saida: analiseAlgoritmica

# O gatilho é dado, não prosa: a data mora na obrigação do calendário, e as
# condições estão aqui com código próprio.
#
# A obrigação é citada pelo rótulo curto, e não pelo código: `OBR-<ano>-23` tem o
# ano da grade dentro, e o ano da grade é derivado do relógio. Citar o código
# amarraria este documento a um ano específico e ele quebraria sozinho na virada.
reavaliacao:
  obrigacao: Reavaliar AIA
  condicoes:
    - codigo: AIA-G1
      condicao: a versão do modelo muda em qualquer um dos três lugares onde ela é escrita
    - codigo: AIA-G2
      condicao: entra ou sai fator do conjunto declarado acima
    - codigo: AIA-G3
      condicao: o piso da razão de aprovação muda no contrato de equidade
    - codigo: AIA-G4
      condicao: a massa medida muda e a razão datada acima deixa de conferir
    - codigo: AIA-G5
      condicao: chega o vencimento da obrigação de reavaliação, mesmo sem nenhuma das outras
---

# AIA — credit-scoring

Avaliação de impacto algorítmico do modelo de decisão automatizada de crédito.
Fecha a metade do Risco-007 que o teste de disparidade não alcançava: o
instrumento media, e não havia documento que dissesse **o que** estava sendo
medido, por quê, e o que acontece quando a medida muda.

Este documento não descreve um modelo real. O repositório não hospeda modelo: o
que existe são decisões semeadas com resultado por titular, e é sobre elas que a
medição do cabeçalho foi feita. Nenhuma afirmação aqui autoriza dizer que o
scoring é justo.

## 1 · Finalidade e base legal

Elevar a acurácia do scoring para reduzir recusa indevida de crédito a titulares
com histórico de pagamento consistente. A base é legítimo interesse, e o
balanceamento que a sustenta é o da `LIA-SCORING-001` — declarada no cabeçalho,
vigente em `db/seed.sql`, e derrubada para `em_revisao` quando a medição da §4
estoura o piso.

O que amarra esta seção: o código da LIA existe no cenário, e a queda dela
bloqueia a revelação do campo que ela sustenta. Uma finalidade que citasse uma
LIA inexistente descreveria um balanceamento sem dono.

## 2 · Fatores do modelo

Os fatores estão no cabeçalho, e a fonte deles é o SHAP das decisões semeadas em
`app/src/mock/scenarios.ts`. A lista é fechada nos dois sentidos: fator novo no
código sem entrada aqui reprova, e entrada aqui sem fator no código reprova
também.

Fechada nos dois sentidos porque cada direção esconde um defeito diferente. Só
código→documento deixaria a AIA prometer fator que já saiu do modelo; só
documento→código deixaria um fator entrar sem passar por revisão.

## 3 · Proxies removidos

A lista de proxies discriminatórios removidos do conjunto de treino mora em
`.privacy/equidade.yaml`, com o motivo escrito de cada um, e é o mesmo arquivo
que o instrumento lê para reprovar um fator que case algum deles — com arquivo e
linha.

Este documento **aponta** e não repete: proxy é decisão de política, e duas
listas divergiriam na primeira mudança.

Vale registrar a assimetria que essa separação carrega. A região derivada do CEP
é proibida como fator e **necessária** como dimensão de medição: não se mede
disparidade sem conhecer o grupo. Apagar o atributo de onde ele mede não elimina
a discriminação — elimina a capacidade de detectá-la.

## 4 · Medição de disparidade

A razão de aprovação entre grupos, medida por `npm run equidade` sobre a massa
versionada, está no cabeçalho com a data em que foi tomada. O piso contra o qual
ela é comparada está em `.privacy/equidade.yaml`; nenhum número de taxa aparece
neste texto, de propósito.

O que amarra esta seção: um teste recalcula a razão a partir da massa versionada
e confere contra a do cabeçalho. Mudar a massa sem redatar a medição reprova o
build — e é isso que faz esta AIA ser um documento vivo em vez de um retrato de
um dia.

A comparação com o piso é feita em aritmética inteira. Não é preciosismo: a
fronteira é onde o número precisa ser confiável, e taxa em ponto flutuante
transforma "passou por igualdade exata" em sorte.

O check de CI que cobra isto é `Disparidade e proxies do modelo`.

## 5 · Revisão humana (Art. 20)

Duas rotas, e elas fazem coisas diferentes. O **pedido** é do titular
(`POST /me/decisoes/{id}/revisao`): não exige fundamento, porque contestar não
pode depender de a pessoa saber argumentar contra critérios que ela acabou de
conhecer. O **ato** é do controlador (`POST /decisoes/{id}/revisar`), e deixa
prova no trail com resultado e fundamento.

O que amarra esta seção: as duas rotas estão no contrato e servidas pelo mock, e
o teste confere que a AIA cita caminho que existe. Revisão humana declarada num
documento e ausente do contrato é a forma mais comum de o Art. 20 virar frase.

Antes das rotas do titular existirem, o próprio RIPD do cenário listava a revisão
do Art. 20 como recomendação P0 pendente. Esta seção só pode ser escrita porque
elas existem.

## 6 · Gatilho de reavaliação

Cinco condições, com código próprio, no cabeçalho. Quatro delas são mudanças no
artefato — versão, fator, piso, massa — e reprovam o build no instante em que
acontecem sem a AIA acompanhar. A quinta é o relógio: a obrigação **Reavaliar
AIA** entra no calendário do ano com responsável declarado e consequência
escrita, e a fila do DPO a promove a item de trabalho dentro da antecedência.

A obrigação nasce com vencimento futuro. Uma obrigação semeada com data passada é
marcada como cumprida na origem, e uma reavaliação que nasce cumprida é o
artefato decorativo que este documento existe para não ser.

A obrigação vive só no cenário de crédito. Os outros dois cenários têm modelos
próprios e não têm AIA: uma obrigação genérica nos três prometeria três
documentos e entregaria um.

## 7 · Exigida por

A tabela de decisão **D3** — triagem de RIPD — responde `analiseAlgoritmica=true`
quando o gatilho de decisão automatizada está presente, e também no caso de
fallback restritivo, quando nada foi informado. Até este documento existir, essa
saída exigia uma análise que não estava em lugar nenhum do repositório: a decisão
cobrava um artefato inexistente, e ninguém podia notar.

O que amarra esta seção: o teste confere que a tabela citada existe, que a saída
citada é uma saída dela, e que alguma regra a produz como verdadeira. Uma AIA que
se declarasse exigida por uma decisão que nunca a exige seria voluntária com
aparência de obrigatória.

---

## O que esta AIA não cobre

- **Base legal por registro na linhagem de treino.** A linhagem registra execuções
  agregadas, não a base legal de cada registro que alimenta o modelo. É o resíduo
  do Risco-007 que continua aberto depois deste documento, e está nomeado assim na
  reconciliação da auditoria.
- **Acurácia.** Não há modelo, então não há AUC medida nem inferência sobre
  desempenho. O que foi medido é a razão de aprovação entre grupos numa massa
  sintética versionada.
- **Impacto individual.** A AIA é sobre o modelo. O efeito sobre uma pessoa
  específica se responde pela rota da §5, com os fatores da decisão dela.
