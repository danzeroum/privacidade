# Protótipo navegável — guia de exploração

Reimplementação das 8 telas em **React 18 + TypeScript**, com rota real, store, API mock e as
**9 regras LGPD implementadas como comportamento do sistema** — não como texto explicativo na tela.

```bash
npm start        # o caminho completo, e é só isto que você precisa saber
```

`npm start` atualiza a `main`, instala se o lock andou, roda os três checks que o
CI cobra — suíte, gate de privacidade, catraca de produção — e sobe o servidor
com o navegador aberto. Qualquer check vermelho **para a partida**: um script que
abrisse o navegador depois de reprovar o gate ensinaria a rolar a tela para cima
e ignorar o vermelho.

```bash
npm start -- --rapido           # sobe direto, sem check nenhum
npm start -- --producao         # serve o artefato de produção: a tela é a recusa
npm start -- --sem-git          # não toca no remoto (offline, ou ramo próprio)
npm start -- --sem-navegador    # só imprime o endereço
npm start -- --ajuda
```

Cada passo separado, quando for isso que você quer:

```bash
npm install
npm run dev              # http://localhost:5173
npm test                 # a suíte inteira
npm run gate:privacidade # varre o repositório: PII fora do inventário reprova
npm run catraca:producao # constrói e varre o artefato (RIPD §7.3)
npm run build            # bundle estático em dist/
```

O plano da partida — quais passos, em que ordem, qual falha para tudo — é função
pura em `src/lib/partida.ts`; `scripts/start.ts` só gasta processo. É o que
permite provar que o servidor é sempre o último passo sem subir servidor nenhum.

---

## Como está organizado

```
src/
├── lib/sha256.ts        SHA-256 síncrono e sem dependências (cadeia de auditoria e hash de CPF)
├── mock/
│   ├── types.ts         vocabulário controlado — espelha os enums de db/schema.sql
│   ├── scenarios.ts     três cenários completos: banco, varejo, mídia
│   ├── db.ts            banco em memória com audit trail append-only e hash encadeado
│   ├── api.ts           as 22 rotas do openapi.yaml — é aqui que as 9 regras vivem
│   └── permissoes.ts    ABAC por ação; o que um papel não tem, não é renderizado
├── store/sessao.ts      papel, cenário, chamadas à API e avisos
├── ui/                  primitivos, incluindo CampoPII (mascaramento com registro)
└── screens/T1..T8.tsx
```

**A regra não mora na tela.** `src/mock/api.ts` recusa a operação; a interface apenas não oferece o
caminho. É por isso que reescrever uma tela não afrouxa nenhum controle — e por que os testes
conseguem provar as regras sem montar componente nenhum.

---

## Os dois seletores no topo mudam o sistema, não o texto

**Público** — Engenharia · DPO · Produto · Segurança · Auditor externo

| Papel | Recebe | Não é renderizado |
|---|---|---|
| Engenharia | achado do gate com arquivo e linha, gerar RIPD, expurgo, pipeline de chaves | aprovar RIPD, assinar LIA, revelar PII |
| DPO | aprovar RIPD, assinar LIA, revelar PII, reclassificar risco | log cru do workflow, pipeline de rotação |
| Produto | volume, prazo, mapa esforço × risco | **todo botão de revelar**, contagem total, qualquer escrita |
| Segurança | log do KMS, rotação, gates | a tela T4 inteira — não monta e não emite requisição |
| Auditor externo | leitura de tudo | contagem total e **toda** rota de escrita |

**Cenário** — Crédito IA (financeiro) · Rede Aurora (varejo) · Palco Streaming (mídia).
Mesma arquitetura, três domínios, três riscos dominantes diferentes: decisão automatizada (Art. 20),
dado de saúde vazando para marketing, e inferência reconstruindo categoria sensível sem coleta.

---

## Roteiro dos três fluxos críticos

### Fluxo A — PR bloqueado → RIPD → aprovação → merge

1. **T1**, papel **Engenharia**: o cartão "PRs bloqueados" mostra 2. Na tabela, expanda *log cru do workflow* — só engenharia recebe esse detalhe.
2. **T3**: a faixa vermelha traz os gatilhos da triagem. As seções 1 a 4 vêm do catálogo, sem redigitação.
3. Ainda em **T3**, seção 4, use *Testar combinação*: escolha um campo sensível com `legitimo_interesse`. O erro inline cita o Art. 11.
4. Marque as recomendações **P0** como concluídas (só engenharia vê os toggles).
5. Clique em **Gerar RIPD.md** — o arquivo é baixado de verdade, montado a partir do template.
6. Troque para **DPO** e clique em **Aprovar como DPO**. A faixa vira "Merge liberado" e o status check volta a verde.
7. Volte à **T1**: o contador de bloqueados caiu.

> Tente aprovar como Engenharia: o botão não existe. Tente aprovar com P0 em aberto: 409.

### Fluxo B — titular pede acesso → revelação controlada → expurgo

1. **T4**, papel **DPO**. Todos os campos chegam mascarados, inclusive para você.
2. Clique em **revelar** no CPF. O modal exige finalidade e justificativa de 20 caracteres.
3. Confirme: o valor aparece com contagem regressiva e **volta a mascarar em 60 segundos**.
4. Tente revelar a **biometria**: não há botão. A API também recusa — não existe caminho.
5. Na busca lateral, digite um CPF: a tela mostra o **hash** que sai do navegador. O documento não viaja.
6. Aba **Mensagens**: envie um texto contendo um CPF. O canal recusa.
7. **T6**: clique em **Verificar integridade** — a cadeia é recalculada e confere.

### Fluxo C — adulteração do log e LIA vencida

1. **T6**: clique em **Tentar editar uma linha** → 409, append-only.
2. Clique em **Forjar edição no banco** → simula o DBA comprometido escrevendo direto na tabela.
3. A cadeia acusa: o bloco alterado e **todos os seguintes** ficam vermelhos.
4. Troque o cenário para **Palco Streaming** e vá para **T8**: a LIA está vencida há 18 dias.
5. O cartão "Datasets vinculados" mostra a consequência: o campo perde base legal e o gate volta a bloquear.
6. Em **T8**, tente **Vincular à LIA** um campo sensível: 422 com a citação do Art. 11.

---

## As 9 regras e onde cada uma é testada

| # | Regra | Implementação | Teste |
|---|---|---|---|
| 1 | Legítimo interesse não cobre dado sensível (Art. 11) | `POST /v1/lias/{id}/campos` → 422 | `Regra 1` |
| 2 | Hash de CPF não é anonimização (Art. 12) | `POST /v1/catalog/validar` → 422 | `Regra 2` |
| 3 | Revelar exige finalidade + justificativa + registro **antes** da resposta | `POST /v1/pseudonyms/resolve` | `Regra 3` |
| 4 | Dado sensível não é revelável em tela alguma | 403 na API; sem botão no DOM | `Regra 4` |
| 5 | 404, nunca 403, fora do escopo do ator | `GET /v1/titulares/{id}` | `Regra 5` |
| 6 | `totalItems` omitido para papéis não confiáveis | `GET /v1/catalog/fields` | `Regra 6` |
| 7 | Audit trail append-only, adulteração detectável | 409 em PATCH/DELETE; hash encadeado | `Regra 7` |
| 8 | Transferência internacional exige mecanismo (Art. 33) | validação do inventário → 422 | `Regra 8` |
| 9 | RIPD é gate de CI, não documento pós-fato | `POST /v1/ripds/{id}/aprovar` | `Regra 9` |

A regra 3 tem o teste mais importante do conjunto: com `banco.simularFalhaDeLog = true`, a resposta
vira 503 e **nenhum valor sai**. A ordem — gravar, depois responder — é o que impede que uma falha de
observabilidade se transforme em acesso sem rastro.

---

## Limites honestos deste protótipo

- **Não há backend.** A API mock roda no navegador; recarregar a página zera o estado.
- **Não há autenticação.** Trocar de papel é um seletor, não um login. O que o protótipo demonstra é
  a *consequência* do papel, não o mecanismo de autenticação.
- **O mermaid não é renderizado pelo renderizador oficial.** A pré-visualização extrai os nós na ordem
  e desenha a cadeia — suficiente para conferir o fluxo antes do commit, não para publicar o diagrama.
- **O drag da matriz muda P e I; a dispersão da T1 abre o mesmo modal por clique.** Arrastar no eixo de
  esforço não teria significado: esforço é estimativa, e a reclassificação incide sobre P × I.
- **Nenhum dado real.** Os CPFs são números de teste e os nomes são fictícios.
