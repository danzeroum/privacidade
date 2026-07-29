# Portal do Titular — handoff de design

Protótipo: `Portal do Titular.dc.html` (abra no navegador; precisa do `support.js` ao lado).
Onze telas navegáveis pelo trilho, cada uma com nota de design, risco que fecha e a rota de contrato
que ela exige. Alterne "Mostrar notas de design" para ver a versão limpa.

Este é o **lado de fora** do Lastro — o titular exercendo os direitos do Art. 18. O lado de dentro
(balcão do DPO) já existe e é real no mock; era esta metade que não tinha nem tela nem rota, e é o
**P0 (Risco-001)** da auditoria.

---

## Por que um produto separado

Mesma marca, mesmos tokens, **voz e densidade opostas**. O console interno é dense e para especialista
oito horas por dia. Aqui o usuário aparece uma vez na vida, possivelmente irritado, no telefone, com
qualquer idade. Consequências no desenho:

| | Console interno | Portal do titular |
|---|---|---|
| Corpo de texto | 13–14 px | **16 px** |
| Alvo de toque | 32 px | **44–52 px** |
| Ações por tela | várias | **uma primária** |
| Rótulo primário | `Art. 18, II` | “Ver todos os dados que vocês têm sobre mim” |
| Jargão | vocabulário controlado | **nenhum** — artigo como legenda |
| Largura | fluida, 1420 px | **420 px**, coluna única |

Tokens idênticos aos de `TOKENS.md`: petróleo `#0B5F66`, superfície `#FFFFFF`, `--ok/warn/crit`
inalterados. Fundo do portal é `#DDE3E4` (um passo mais escuro que o console) só para o cartão do
telefone destacar na apresentação — em produção é o `#E9EDEE` de sempre.

---

## As onze telas, e o que cada uma decide

**01 · O que você pode pedir.** Não pergunta nada antes de oferecer. Os onze direitos em linguagem de
pessoa, ordenados por leveza (confirmar antes de apagar). Atalho para quem já tem protocolo.
→ `GET /me/direitos`

**02 · Confirmar que é você — verificação escalonada.** O nível é **derivado do direito**, não fixo:

| Nível | O que pede | Direitos |
|---|---|---|
| 1 | código no canal já conhecido | confirmação, compartilhamentos |
| 2 | código + um dado de cadastro | acesso, correção, **bloqueio**, **oposição**, revogação, revisão Art. 20 |
| 3 | código + documento com foto | eliminação, anonimização, portabilidade |

A escada fica **visível** para a exigência não parecer arbitrária, e o destino do documento é dito
antes do envio: uso único, fora do cadastro, descarte em 30 dias com registro.
→ `POST /me/verificacao` · `POST /me/verificacao/{id}/codigo`

**03 · Detalhar o pedido.** Campo livre **opcional**, com o motivo escrito: o direito não depende de
justificativa. Em eliminação, avisa **antes do envio** que parte pode ser retida por obrigação legal.
Aviso de redação de documento — mesmo redator do lado interno.
→ `POST /requests`

**04 · Pedido recebido.** Prazo como **data**, não contagem abstrata, e as três etapas seguintes antes
de sair da tela. Prazo legal que só o DPO enxerga é prazo que só a empresa controla.
→ `POST /requests` → `201 { protocolo, prazo_limite }`

**05 · Acompanhar.** Espelho do balcão sem o vocabulário dele: estado, prazo, histórico e canal de
mensagem — a mesma conversa da T4, vista do outro lado.
→ `GET /requests/{protocolo}` · `POST /requests/{id}/mensagens`

**06 · Resposta pronta.** Pacote assinado, link de 24 h **com a frase que o justifica** (“pede de novo
aqui, sem custo”). Sumário do conteúdo para não precisar abrir o arquivo.
→ `GET /requests/{id}/pacote` (link assinado, TTL 24 h)

**07 · Atendido em parte — a tela mais importante.** Separa apagado de retido, nomeia a lei de cada
retenção, dá a **data** de eliminação de cada resíduo, e fecha oferecendo revisão **e** o caminho da
ANPD lado a lado. Esconder a autoridade é o que transforma insatisfação em denúncia.
→ `GET /requests/{id}` → `{ apagados[], retidos[{ base_legal, retencao_ate }] }`

**08 · Minhas autorizações.** Texto consentido **na versão aceita**, com data e canal — a prova do
Art. 8º §2º do lado de quem consentiu. Retirar é um botão no mesmo lugar em que se lê a autorização.
→ `GET /me/consentimentos`

**09 · Retirar autorização — a cascata antes de confirmar.** Quais sistemas param, o que acontece com
o dado já coletado, e **o que o titular perde em funcionalidade**. Revogação sem consequência
declarada é revogação de fachada.
→ `POST /me/consentimentos/{id}/revogacao`

**10 · Autorização retirada.** Propagação sistema por sistema; pendência de 24 h vira alerta interno
**visível ao titular**. Cripto-shredding explicado sem o termo: “a chave que protegia foi destruída”.
→ `GET /me/consentimentos/{id}/propagacao`

**11 · Confirmação falhou.** A recusa enquadrada como proteção, não suspeita: “sem confirmação,
ninguém acessa nem apaga seus dados — nem nós”. Três saídas, incluindo falar com uma pessoa.
Tentativa não confirmada não cria cadastro e é descartada em 7 dias.
→ `POST /me/verificacao/{id}/codigo` → `401` + retentativa

---

## Regras que valem em todas as telas

1. **Nenhum dado do titular aparece antes da confirmação de identidade.** Nem parcial, nem mascarado.
2. **O pedido nunca exige justificativa** — e a tela diz isso, para o titular não achar que precisa.
3. **Recusa sempre nomeia a lei e oferece a ANPD.** As duas coisas, na mesma tela.
4. **Nada de jargão como rótulo primário.** Artigo é legenda.
5. **Toque 44 px, corpo 16 px.** O titular pode ter qualquer idade e qualquer aparelho.
6. **Toda promessa de prazo é uma data**, e toda expiração vem com o que fazer depois.

---

## O que isto muda no contrato (`api/openapi.yaml`)

Treze rotas novas. As quatro do bloco P0 primeiro:

```
POST   /requests                              abre solicitação { direito, nivel_verificacao, texto? }
                                              → 201 { protocolo, prazo_limite }
GET    /requests/{protocolo}                  estado, andamento, apagados[], retidos[]
POST   /requests/{id}/mensagens               canal titular↔DPO (redator obrigatório)
GET    /requests/{id}/pacote                  link assinado, TTL 24 h

POST   /me/verificacao                        inicia verificação no nível exigido pelo direito
POST   /me/verificacao/{id}/codigo            confirma; 401 sem vazar existência de cadastro
GET    /me/direitos                           os 11 direitos com nível e prazo de cada
GET    /me/consentimentos                     texto versionado, data, canal, estado
POST   /me/consentimentos/{id}/revogacao      revoga + dispara cascata
GET    /me/consentimentos/{id}/propagacao     estado por sistema, pendência > 24 h
POST   /me/decisoes/{id}/revisao              contestação Art. 20 { fundamento }
GET    /me/decisoes/{id}                      fatores da decisão automatizada
POST   /titulares/me/oposicao?lia={codigo}    oposição Art. 18 §2º; cessa o legítimo interesse
```

**Invariante do nível de verificação:** o nível não é parâmetro que o cliente escolhe — é **derivado
do direito no servidor**. Se vier no corpo, é ignorado. Um teste deve provar que pedir eliminação com
`nivel_verificacao: 1` não reduz a exigência.

---

## Também no console interno (`Lastro Redesenho.dc.html`)

**T6 · Ciclo de vida do dado** (bloco novo, acima do audit trail): a face visível do **Risco-006**.
`retencao_ate` calculada por campo, contagem de registros, prova pré/pós do expurgo e três estados —
*a vencer*, *vencido sem expurgo*, *expurgo comprovado*. A linha vermelha é o ponto: prazo vencido sem
execução **abre achado na T11 automaticamente**. Prazo que não faz nada é rótulo, e rótulo não cumpre
o Art. 16.

---

## O que continua sendo só engenharia

Sem interface, sem desenho a fazer: gate de privacidade varrendo o repositório (Risco-003), cadeia de
hash cobrindo justificativa e base legal (Risco-004), `X-Purpose` nas 25 operações (Risco-011), DPA
programático (Risco-008), teste de disparidade no pipeline (Risco-007), autenticação real
(Risco-037).

---

## Adendo — 2026-07-29 · o décimo primeiro direito

Este handoff foi escrito com **dez** direitos, e a tabela da tela 02 colocava "oposição" na linha do
nível 2 sem que ela existisse no vocabulário do sistema: o enum do contrato tinha dez valores, e
nenhum era `oposicao`. Quem implementasse pelo desenho acabaria mapeando oposição em `bloqueio`,
porque é o que sobrava na linha.

Os dois **não** são o mesmo direito. Bloqueio (Art. 18, IV) suspende um dado. Oposição (Art. 18, §2º)
objeta ao **fundamento** — e é a salvaguarda que a análise de legítimo interesse oferece em troca de
dispensar o consentimento (Art. 10, §3º). A LIA vigente do cenário de crédito já publicava um canal
de oposição em `lia.canal_oposicao`; ele apontava para uma rota que não existia em contrato algum.
Uma salvaguarda que aponta para o vazio não sustenta o balanceamento que a LIA afirma ter feito.

O que mudou: `oposicao` entrou como décimo primeiro valor do enum (contrato, schema e mock), com
nível 2 e prazo de 15 dias, e a rota passou a existir **no endereço que a LIA publica** — hoje
`POST /v1/titulares/me/oposicao?lia={codigo}`, a mesma string dos dois lados, com teste que quebra se
alguém renomear um deles. O prefixo `/api/v1` da LIA original foi normalizado para o `/v1` que o
resto do sistema usa; foi a única letra alterada no artefato.

Uma consequência de desenho para a tela 02: a escada continua com três degraus, mas a linha 2 agora
tem **dois** rótulos distintos, e eles precisam se distinguir sem jargão — algo como "parar de usar
meus dados para isso" (bloqueio) e "discordar de vocês usarem meus dados sem me perguntar"
(oposição). Se a tela oferecer os dois com o mesmo texto, a diferença que a lei faz volta a se perder
onde ela sempre se perde: no rótulo.
