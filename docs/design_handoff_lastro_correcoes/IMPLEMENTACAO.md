# Plano de implementação

Seis pull requests, na ordem em que devem entrar. Cada item traz **arquivo**, **o que está lá hoje**,
**o que passa a valer** e **como provar** — no estilo dos testes que já existem em
`app/tests/regras.test.tsx`, que provam regra sem montar componente.

Convenção do repositório que vale para tudo abaixo: **a regra mora em `app/src/mock/api.ts`**. A tela
não oferece o caminho; a API recusa. Corrigir só a tela não fecha nenhum item.

---

## PR 1 — Fechar as duas contradições de controle de acesso

> Bloqueia qualquer demonstração externa. São os dois pontos em que o código contradiz a tese do
> projeto.

### 1.1 · C-01 — busca por CPF sem papel e sem registro

**Arquivos:** `app/src/mock/api.ts`, `app/src/mock/permissoes.ts`, `app/src/screens/T2.tsx`

Hoje `case 'POST titulares'` (ramo `buscar`) resolve o hash do CPF para id + pseudônimo **sem**
`pode(papel, …)` e **sem** `banco.auditAppend`. O cartão "Buscar titular por CPF" da T2 é renderizado
para todos os papéis, então Produto e Auditor externo confirmam a existência de um titular a partir
do CPF, sem deixar rastro. É o oráculo de existência que a Regra 5 evita no `GET /titulares/{id}`,
entrando pelo POST.

Passa a valer:

1. Nova ação `buscar_titular` em `Acao`, concedida apenas a `dpo` (e a `engenharia` se o time
   entender que o balcão técnico precisa — decisão de produto, mas explícita).
2. A rota registra **antes de responder**, como a revelação: `acao: 'TITULAR_BUSCADO'`,
   `recursoId: cpfHash.slice(0, 8)`, com a finalidade declarada. Falha de gravação ⇒ 503 e nenhuma
   resposta.
3. Papel sem a ação recebe **404 genérico**, nunca 403 — a mesma doutrina da Regra 5.
4. O cartão da T2 vai para dentro de `<Permitido acao="buscar_titular">`, com `alternativa` explicando
   a indisponibilidade.
5. Limite de taxa por ator (ex.: 5 buscas/minuto) devolvendo 429 — busca em rajada é enumeração.

Prova:

```ts
it('Regra 5b · busca por hash fora do escopo responde 404 e não vaza existência', () => {
  const res = request(banco, { metodo: 'POST', caminho: '/v1/titulares/buscar',
    papel: 'produto', ator: 'Pedro Lima', body: { cpfHash: HASH_EXISTENTE } });
  expect(res.status).toBe(404);
});

it('Regra 3b · busca registrada antes da resposta', () => {
  const antes = banco.auditoria.length;
  request(banco, { metodo: 'POST', caminho: '/v1/titulares/buscar', papel: 'dpo',
    ator: 'Marcela Dias', purpose: 'atendimento', body: { cpfHash: HASH_EXISTENTE } });
  expect(banco.auditoria.length).toBe(antes + 1);
  expect(banco.auditoria.at(-1).acao).toBe('TITULAR_BUSCADO');
});

it('sem registro não há busca', () => {
  banco.simularFalhaDeLog = true;
  const res = request(banco, { /* mesma chamada */ });
  expect(res.status).toBe(503);
  expect(res.body.id).toBeUndefined();
});
```

E no DOM: montando a T2 com `papel: 'produto'`, `screen.queryByLabelText(/CPF/i)` deve ser `null`.

### 1.2 · C-02 — rotas de auditoria escapam da guarda de escrita

**Arquivo:** `app/src/mock/api.ts`

A guarda de topo é:

```ts
if (metodo !== 'GET' && !pode(papel, 'escrever') && raiz !== 'audit') { … 403 … }
```

A exceção `raiz !== 'audit'` deixa `PATCH /v1/audit/1` e `POST /v1/audit/forjar` alcançáveis por
papel sem `escrever` — inclusive o Auditor externo. O comentário imediatamente acima afirma o
contrário. Hoje quem protege é a interface (o botão de forjar está atrás de `Permitido`), que é a
inversão exata do princípio do projeto.

Passa a valer:

1. Remover a exceção. A guarda cobre `audit` como cobre tudo.
2. `POST /v1/audit/verificar` continua acessível a quem lê — é verificação, não escrita; mova o ramo
   para antes da guarda ou trate `verificar` como leitura explicitamente.
3. `POST /v1/audit/forjar` sai do roteador de produção e passa a depender de uma flag de cenário
   (`banco.modoDemo === true`), retornando 404 fora dela.

Prova:

```ts
it('Regra 7b · auditor externo não alcança rota de escrita de auditoria', () => {
  expect(request(banco, { metodo: 'PATCH', caminho: '/v1/audit/1', papel: 'auditor',
    ator: 'Auditoria Externa', body: {} }).status).toBe(403);
  expect(request(banco, { metodo: 'POST', caminho: '/v1/audit/forjar', papel: 'auditor',
    ator: 'Auditoria Externa', body: { id: 2 } }).status).toBe(403);
});

it('forjar não existe fora do modo demonstração', () => {
  banco.modoDemo = false;
  expect(request(banco, { metodo: 'POST', caminho: '/v1/audit/forjar', papel: 'dpo',
    ator: 'Marcela Dias', body: { id: 2 } }).status).toBe(404);
});
```

### 1.3 · T6-02 — botão de escrita renderizado para papel de leitura

**Arquivo:** `app/src/screens/T6.tsx`

`Tentar editar uma linha` está fora de `<Permitido>` e dispara um `PATCH` real para qualquer papel.
Agrupe os dois botões vermelhos em um bloco "Demonstração de ataque" dentro de
`<Permitido acao="escrever">`, condicionado também ao modo demonstração.

---

## PR 2 — Devolver o fluxo da T4

### 2.1 · T4-01 — fila selecionável e contexto único (crítico)

**Arquivo:** `app/src/screens/T4.tsx`, `app/src/store/sessao.ts`

Hoje: `const foco = solicitacoes[0]` e
`titular = titulares.find(t => t.id === (identificado ?? foco.titularId))`. Buscar um titular troca os
dados exibidos enquanto o cabeçalho continua anunciando o protocolo da primeira solicitação — dá para
revelar um campo, com finalidade e justificativa gravadas, sob o protocolo de outra pessoa.

Passa a valer:

1. `protocoloSelecionado` no store; a linha da fila é `<tr onClick>` + `<button>` acessível na
   primeira célula, com estado visual (`background: var(--accent-soft)`).
2. `titular` deriva **sempre** do protocolo selecionado. A busca por CPF **localiza a solicitação**
   (seleciona a linha) em vez de substituir o titular.
3. Faixa de contexto persistente com protocolo + titular + direito.
4. O modal de revelação repete o protocolo antes de confirmar, e o registro grava `protocolo` junto
   com `titularId` e `campo`.
5. Enviar mensagem usa o protocolo selecionado.

Prova: com `protocoloSelecionado = 'P-2026-0729'`, o registro gerado pela revelação deve conter esse
protocolo e o `titularId` correspondente — nunca a combinação `solicitacoes[0].protocolo` +
`titularBuscado`.

### 2.2 · T4-02 — concluir o atendimento

**Arquivos:** `app/src/mock/api.ts`, `app/src/screens/T4.tsx`, `app/src/mock/permissoes.ts`

Não existe rota nem ação que faça o prazo parar. Acrescente
`POST /v1/requests/{id}/concluir` com corpo `{ desfecho, evidencia }`, `desfecho ∈ { atendido,
atendido_parcialmente, recusado_com_fundamento }`, exigindo a nova ação `concluir_solicitacao`,
registrando no trail e mudando `solicitacao.status`. Recusa sem fundamento ⇒ 422.

### 2.3 · C-03 — finalidade confrontada com o catálogo

**Arquivos:** `app/src/mock/api.ts`, `app/src/ui/primitivos.tsx`

`POST /v1/pseudonyms/resolve` só verifica que `purpose` existe. Passe a comparar com as finalidades
catalogadas do campo (`campo.finalidade` no inventário) e recuse com **422** quando incompatível,
citando campo e finalidade registrada. No `CampoPII`, a lista de opções deixa de ser a constante
`FINALIDADES` e passa a vir do catálogo do campo; as incompatíveis aparecem nomeadas, fora do select.

```ts
it('Regra 3c · finalidade incompatível com o catálogo é recusada', () => {
  const res = request(banco, { metodo: 'POST', caminho: '/v1/pseudonyms/resolve', papel: 'dpo',
    ator: 'Marcela Dias', purpose: 'marketing',
    body: { titularId: 'T-4471', campo: 'cpf', justificativa: 'x'.repeat(24) } });
  expect(res.status).toBe(422);
});
```

### 2.4 · C-04 — redigir a justificativa antes do append

**Arquivos:** `app/src/mock/api.ts`, `app/src/ui/reclassificar.tsx`, `app/src/ui/primitivos.tsx`

O redator só roda no canal com o titular. Extraia a função de redação para
`app/src/lib/redator.ts` e aplique a **toda** entrada de texto livre que vá para o trail
(justificativa de revelação, de reclassificação, fundamento de revisão e de incidente). Na interface,
mostre o texto que será gravado quando houver remoção. Troque parte do campo livre por estrutura:
protocolo (derivado) + motivo (enum) + observação curta.

```ts
it('justificativa com CPF é gravada redigida', () => {
  request(banco, { /* revelação com justificativa contendo 347.912.884-42 */ });
  expect(banco.auditoria.at(-1).justificativa).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
});
```

### 2.5 · C-05 — expiração por timestamp

**Arquivo:** `app/src/ui/primitivos.tsx`

Troque o decremento por `setInterval` por `expiraEm = Date.now() + 60_000` e recalcule o restante a
cada tick; aba inativa deixa de esticar a janela. Ajuste o texto para não prometer mais do que o
mecanismo entrega (o valor já foi entregue ao cliente; o re-mascaramento é de exibição).

### 2.6 · T4-03 — revisão de decisão com prova (Art. 20)

Nova ação `revisar_decisao` (DPO), rota `POST /v1/decisoes/{id}/revisar` com
`{ decisao, fundamento }` (mínimo 20 caracteres, redigido), registro no trail e devolutiva ao titular
a partir do mesmo ato. O seletor sai de trás de `revelar_pii`.

### 2.7 · T4-04 e T4-05 — abas e indicador

- Abas: `role="tab"` com `id`/`aria-controls`, painéis `role="tabpanel"` + `aria-labelledby`,
  `tabIndex` gerenciado (0 na ativa, −1 nas demais) e navegação ←/→/Home/End.
- "Atendidas no SLA": comparar conclusão com prazo-limite, em vez de
  `prazoLimiteMs > Date.now() - 30 * DIA`, e exibir a janela considerada no rodapé.

---

## PR 3 — Acessibilidade da ação (T5) e rastro da auditoria (T6)

### 3.1 · T5-01 — reclassificar sem arrasto

**Arquivo:** `app/src/screens/T5.tsx`

O `onPointerDown/Move/Up` é o único caminho: a bolha não é focável, não responde a teclado e o SVG
não tem `touch-action: none`. Substitua a matriz SVG por **grade HTML 5 × 5** (cada risco é um
`<button>`), mantenha o arrasto como atalho opcional e acrescente:

- botão "Reclassificar P × I" na ficha lateral, abrindo o `ModalReclassificar` que já existe;
- setas ajustando P e I quando um risco está focado;
- prévia do score resultante durante o ajuste (T5-02 do relatório de comportamento de arrasto);
- `touch-action: none` no contêiner.

### 3.2 · T5-02 — histórico e troca de cenário

`setCenario` recria o `BancoMock` e apaga as reclassificações que a tela chama de imutáveis.
Confirme antes ("você vai descartar N registros desta demonstração") ou mantenha um banco por
cenário. O card "Reclassificações registradas" continua na tela.

### 3.3 · T6-01 e C-06 — verificar e exportar deixam rastro

- `POST /v1/audit/verificar` passa a chamar `auditAppend` (`INTEGRIDADE_VERIFICADA`), como já faz
  `POST /v1/purge/{id}/verificar`. O card exibe "última verificação X por Y".
- Nova rota `POST /v1/audit/exportar` exigindo `exportar_auditoria`: registra **antes** de gerar,
  devolve o CSV com o hash do arquivo carimbado no rodapé. O botão sai de trás de `<Permitido>`.

### 3.4 · T6-03 — filtro versus cadeia quebrada

A marcação de divergência é aplicada sobre a lista filtrada. Quando `primeiraDivergencia` não estiver
no recorte, mostre aviso com atalho para limpar o filtro. Remova o `<Permitido>` cujos dois ramos
renderizam o mesmo botão.

---

## PR 4 — Lacunas de cobertura LGPD

### 4.1 · C-07 — tela de incidentes (Art. 48)

Nova rota `/t9` e tela `app/src/screens/T9.tsx`, com modelo em `app/src/mock/types.ts`:

```ts
export interface Incidente {
  id: string;                       // INC-2026-003
  detectadoEm: string;              // ISO
  origem: string;                   // alerta de volume · API de cobrança
  camposIds: string[];              // escopo lido do catálogo
  titularesEstimados: number;
  riscoCodigo?: string;             // R09
  ripdId?: string;
  decisao?: 'comunicar_anpd_e_titulares' | 'comunicar_anpd' | 'nao_comunicar';
  fundamento?: string;              // ≥ 20 caracteres, redigido
  eventos: { quando: string; texto: string; hash: string }[];
}
```

Rotas: `GET /v1/incidentes`, `POST /v1/incidentes`, `POST /v1/incidentes/{id}/decisao`
(ação `comunicar_incidente`, fundamento obrigatório, registro antes da resposta — **inclusive** para
a decisão de não comunicar). O prazo corre à vista, a partir de `detectadoEm`.

### 4.2 · C-08 — registro de consentimento

```ts
export interface Consentimento {
  campoId: string;
  versao: string;                   // v3
  texto: string;
  coletadoEm: string;
  canal: string;                    // app iOS
  hash: string;
  estado: 'ativo' | 'revogado' | 'expirado';
  revogadoEm?: string;
}
```

O validador do inventário (`POST /v1/catalog/validar`) passa a recusar `baseLegal: 'consentimento'`
sem registro vigente — mesma lógica que já existe para legítimo interesse sem LIA. Revogar bloqueia
o tratamento e aciona o gate; o direito de revogação (Art. 18, VIII) ganha rota na T4.

---

## PR 5 — Fidelidade do protótipo e mensagens

- **C-15:** marcar visualmente os controles não implementados (portabilidade JSON/CSV/PDF na T4,
  relatório PDF na T6) ou removê-los; fazer a área de arrastar YAML da T2 receber arquivo, como a da
  T8 já faz; tornar editáveis os selects do Passo 1 da LIA ou marcá-los como leitura (T8-01).
- **C-10:** recusa ancorada no controle, com `role="alert"`; o canal do canto fica só para
  confirmação e informação, no máximo três simultâneas.
- **T3-01/02/03:** `feito` derivado do conteúdo; separar "baixar" de "anexar ao PR" e mostrar o
  resultado do anexo; confirmar também a combinação válida em "Testar combinação".
- **T1-02:** estado persistente de simulação, com faixa fixa e bolha tracejada.
- **T8-02/03/04:** justificativa por eixo no balanceamento, veredito vinculado às mitigações, opções
  inelegíveis desabilitadas com motivo, ação de renovar LIA vencida.
- **T7-01/02:** ações reais na T7 e separação das duas listas de cripto-shredding.
- **C-16:** dois níveis de texto — operacional permanente e didático em modo apresentação.

---

## PR 6 — Legibilidade, larguras e estados

- **C-11:** piso de **12,5 px** para texto de interface e **11 px** para rótulo de gráfico. Em
  `estilos.css`, subir `.hint`, `.hash`, `.kpi-label`, `.kpi-foot`, `.rail-group`, `.topbar-label`,
  `th`, `.pill`, `.countdown`, `.msg .who`, `.ck-just`, `.step-desc`, `table.dense` e os
  `fontSize={9…10}` embutidos nos SVG de T1, T5 e T7.
- **C-12:** substituir `title` por popover acionável por foco e clique (um único padrão) onde o
  conteúdo explica regra — `EXPLICA[tipoArmazenado]` na T2, descrição do risco em T1/T5, mecanismo do
  Art. 33, nome da tabela na T6.
- **C-14:** breakpoints reais. O CSS só tem `prefers-color-scheme` e `prefers-reduced-motion`;
  colapsar o trilho abaixo de ~1200 px e priorizar colunas por papel nas tabelas densas.
- **C-13:** desenhar e implementar os quatro estados (vazio, carregando, erro recuperável, sem
  permissão) para tabela, gráfico e ação de escrita — decisão de desenho que precede o backend.
- **C-09:** telas fora do papel saem do menu; a página de bloqueio fica só para acesso por link
  direto. Ao trocar de papel, informar em uma linha o que entrou e o que saiu.

---

## Ordem, risco e verificação

| PR | Achados | Risco de regressão | Verificação mínima |
|---|---|---|---|
| 1 | C-01, C-02, T6-02 | baixo | 4 testes novos em `regras.test.tsx`; nenhum dos 26 existentes muda |
| 2 | T4-01…05, C-03, C-04, C-05 | médio — mexe no rito de revelação | 6 testes novos; conferir que a Regra 3 continua gravando antes de responder |
| 3 | T5-01, T5-02, T6-01, T6-03, C-06 | médio — troca de SVG por grade | teste de teclado (`userEvent.keyboard`) e 2 testes de registro |
| 4 | C-07, C-08 | baixo — código novo | testes de decisão de incidente e de consentimento revogado bloqueando o gate |
| 5 | C-10, C-15, C-16, T1-02, T3-*, T7-*, T8-* | baixo | inspeção visual contra `Lastro Redesenho.dc.html` |
| 6 | C-09, C-11, C-12, C-13, C-14 | baixo | conferir que nenhum texto de interface fica abaixo de 12,5 px |

Ao terminar, rode `npm test` e `tsc`, e confira o protótipo estático `prototipo/index.html`: os itens
de tipografia, ARIA e layout (C-09, C-11, C-12, C-14) valem para ele também.
