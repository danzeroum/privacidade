# Handoff: correções de UX e LGPD nas 8 telas do Lastro (+ tela nova de Incidentes)

Pacote para implementação com Claude Code no repositório `danzeroum/privacidade`
(base lida: `main @ 0cc6bcd`, protótipo navegável em `app/`).

---

## Visão geral

Uma validação das 8 telas do protótipo (`app/src/screens/T1..T8.tsx`) contra duas rubricas — UX
(usabilidade heurística, design centrado no usuário, prototipação, arquitetura de informação) e
privacidade (7 princípios de Privacy by Design, bases legais da LGPD, dado pessoal × sensível,
incidentes) — produziu **41 achados**: 3 críticos, 6 altos, 23 médios, 9 baixos.

Este pacote traz:

1. **O relatório completo** com evidência por achado — `Validacao UX e LGPD.dc.html`.
2. **As telas redesenhadas** com todas as correções aplicadas — `Lastro Redesenho.dc.html`.
3. **O plano de implementação** contra os arquivos reais do repositório — `IMPLEMENTACAO.md`.
4. **A lista de achados como checklist** — `ACHADOS.md`.
5. **Os tokens e regras visuais** — `TOKENS.md`.
6. **Um brief pronto para colar no Claude Code** — `PROMPT-CLAUDE-CODE.md`.

O trabalho se divide em 6 pull requests sugeridos, descritos em `IMPLEMENTACAO.md`, do bloqueador
de segurança até o passe de legibilidade.

---

## Sobre os arquivos de design

Os arquivos `.dc.html` deste pacote são **referências de design criadas em HTML** — protótipos que
mostram a aparência e o comportamento pretendidos. **Não são código de produção para copiar.**

A tarefa é **recriar esses desenhos dentro do ambiente já existente do repositório**: React 18 +
TypeScript, `react-router-dom` (HashRouter), `zustand`, Vite, CSS em `app/src/ui/estilos.css` com
tokens em custom properties. Use os componentes que já existem (`Cartao`, `Pill`, `Nota`, `Kpi`,
`Permitido`, `Modal`, `CampoPII`, `Tabela`, `Cabecalho`) e as classes já definidas no CSS — o
redesenho foi feito com os mesmos tokens justamente para caber sem reescrever o sistema visual.

Para abrir os arquivos de referência: eles precisam do `support.js` que acompanha o pacote, no mesmo
diretório. Abra o `.html` direto no navegador.

**Regra de ouro do repositório, que continua valendo:** a regra de privacidade mora em
`app/src/mock/api.ts`, não na tela. Toda correção de comportamento abaixo é implementada na camada
de API **e** refletida na interface — nunca só na interface.

---

## Fidelidade

**Alta fidelidade.** Cores, tipografia, espaçamento e estados são finais e usam os tokens que já
existem em `app/src/ui/estilos.css`. Recrie a UI fielmente, reaproveitando as classes existentes.

Duas exceções conscientes, descritas em `TOKENS.md`:

- **Piso tipográfico de 12,5 px** para texto de interface (hoje há muito 10,5–11,5 px). Isso muda
  valores em `estilos.css`, não a estrutura.
- **Matriz de risco da T5 vira grade HTML** (era SVG com arrasto). É mudança estrutural deliberada:
  a ação precisa existir para teclado e toque.

---

## Telas

Cada tela abaixo existe no arquivo de referência `Lastro Redesenho.dc.html`, navegável pelo trilho
lateral. O seletor **Público** (topo) troca o papel e muda o que é renderizado; o seletor **Cenário**
troca a massa de demonstração.

### Casca (trilho + topo)

- **Layout:** flex com quebra — trilho `flex: 0 1 236px` (mínimo 212 px), conteúdo `flex: 1 1 620px`.
  Sem breakpoints de largura: o layout colapsa por conta própria (corrige C-14, que apontava a
  ausência de qualquer `@media` de largura no CSS atual).
- **Trilho:** fundo `#FFFFFF`, borda direita `1px solid #D2DCDD`, padding `18px 12px 22px`.
  Marca em serifada 21 px. Grupos "Esteira de entrega" e "Operação e prova" em 12,5 px, maiúsculas,
  `letter-spacing: .12em`, cor `#6E8184`.
- **Item de menu:** `padding: 8px 10px`, `border-radius: 4px`, 13,5 px. Ativo: fundo `#DCEAEA`,
  texto `#0E1719`, peso 600, id em mono `#0B5F66`. **As telas que o papel não opera não aparecem no
  menu** (corrige C-09 — hoje ficam visíveis com `aria-disabled` e ainda assim navegam). O rodapé do
  trilho informa quantas telas ficaram de fora.
- **Topo:** sticky, fundo translúcido `#FFFFFFCC` com `backdrop-filter: blur(8px)`, borda inferior
  `#D2DCDD`. Segmento de papéis (5 botões), seletor de cenário, botão "Modo apresentação"
  (pill `#DCEAEA`, borda `#0B5F6659`, texto `#0B5F66`) e o selo "Dados mascarados por padrão".
- **Faixa de confirmação:** abaixo do topo, `role="status"`, fundo `#DDEBE0`, borda esquerda 3 px
  `#2F6E45`. **Só confirmações.** Recusas aparecem ancoradas no controle que falhou, com
  `role="alert"` (corrige C-10).

### T1 · Painel de governança

- **Tarefa:** entender em 30 s o que a esteira barrou e onde o risco está concentrado.
- **Layout:** cabeçalho + 4 KPIs em `repeat(auto-fit, minmax(210px, 1fr))` + duas colunas
  `repeat(auto-fit, minmax(340px, 1fr))`.
- **KPI:** card branco, borda `#D2DCDD`, raio 8 px, padding `16px 18px`; rótulo 12,5 px `#495A5D`;
  valor em serifada 32 px `tabular-nums`; barra de 4 px; rodapé 12,5 px `#6E8184`.
- **Correções:** a dispersão esforço × score deixou de ser o gesto de reclassificar (T1-01) — virou
  lista ordenada por retorno, navegável por teclado e legível na impressão (T1-03, C-11), com botão
  "Selecionar" que leva o risco para a T5. A simulação de violação passou a ter **estado próprio**:
  faixa listrada fixa "Modo demonstração ativo" enquanto durar (T1-02). Texto didático só aparece em
  modo apresentação (C-16). O link do achado cita o PR de origem (`Abrir RIPD do PR #4821`).

### T2 · Catálogo e consentimentos

- **Tarefa:** responder o que existe, para quê, sob qual base legal e por quanto tempo.
- **Correções:** o cartão **Buscar titular** só é renderizado para papéis com a ação
  `buscar_titular`; para os demais aparece a explicação de indisponibilidade (C-01 — hoje o cartão
  aparece para todos e a rota não checa papel nem registra). Quando disponível: `autocomplete="off"`,
  `inputMode="numeric"`, campo limpo após o cálculo do hash, só os 8 primeiros caracteres exibidos.
- **Registro de consentimento** (novo card): texto consentido versionado, momento, canal, hash,
  estado (ativo/revogado) e volume de revogações — é o que dá prova à base legal "consentimento"
  (C-08).
- **Tabela de campos:** a explicação de cada forma de guarda saiu do `title` e virou segunda linha da
  célula, em 12,5 px `#6E8184` (C-12). Resumo de filtros ativos + ação "limpar" no cabeçalho do card
  (T2-03).

### T3 · RIPD e LINDDUN

- **Correções:** o stepper mostra progresso **derivado do conteúdo** — "3 de 5 seções completas", com
  o motivo do incompleto em cada passo (T3-01). "Gerar RIPD.md e anexar ao PR" virou duas ações
  separadas, com o resultado do anexo (commit, autor, hora) visível (T3-02). "Testar combinação"
  também confirma o caso válido, com a mesma densidade da recusa (T3-03). A recusa da aprovação
  aparece no próprio cartão do botão, não no canto da tela (C-10).

### T4 · Direitos do titular — a tela mais alterada

- **Tarefa:** atender uma solicitação do Art. 18 dentro do prazo, com prova.
- **Fila selecionável:** cada linha é o objeto de trabalho. Selecionar define **protocolo e titular
  juntos**; a linha ativa recebe fundo `#DCEAEA` (T4-01 — hoje `foco = solicitacoes[0]` é fixo e a
  busca por CPF troca o titular por baixo do contexto).
- **Faixa de contexto:** protocolo, titular e direito lado a lado, sempre visíveis, em card
  `#DCEAEA` com borda `#0B5F6640`.
- **Rito de revelação (modal):** repete o protocolo no topo; a lista de **finalidades vem do
  catálogo do campo** e as incompatíveis são nomeadas com o motivo (C-03); o motivo é um enum, não
  texto livre; a observação passa pelo redator antes de gravar, com pré-visualização do texto
  redigido em `role="alert"` (C-04); confirmação desabilitada até finalidade + motivo. Após
  confirmar: valor visível com contagem regressiva calculada por **timestamp** (C-05) e o número do
  registro gravado antes da resposta.
- **Conclusão do atendimento** (novo): desfecho (atendido / parcialmente / recusado com fundamento),
  evidência e registro — é o ato que para o cronômetro (T4-02).
- **Abas:** padrão ARIA completo — `role="tab"` com `id` e `aria-controls`, painéis com
  `role="tabpanel"` e `aria-labelledby`, `tabIndex` gerenciado, navegação por ←/→/Home/End (T4-04).
- **Revisão de decisão (Art. 20):** decisão + fundamento obrigatório + registro, atrás da ação
  própria `revisar_decisao` (T4-03). Portabilidade marcada como não implementada (C-15).
- **KPI de SLA:** rótulo corresponde ao cálculo — conclusão comparada ao prazo-limite (T4-05).

### T5 · Riscos e RACI

- **Matriz 5 × 5 como grade HTML:** `grid-template-columns: repeat(5, minmax(0,1fr))`, células de
  altura mínima 58 px, fundo por faixa de score (`#DDEBE0` < 8, `#F3E7CE` 8–14, `#F5DEDF` ≥ 15).
  Cada risco é um `<button>` pill colorido por tipo de dano, com borda `2px solid #0E1719` quando
  selecionado. `touch-action: none` no contêiner.
- **Reclassificar por teclado:** botão explícito "Reclassificar P × I" na ficha lateral abre o painel
  com steppers −/+ de 32 px para P e I, prévia textual da mudança de score e justificativa de 20
  caracteres com contador (T5-01).
- **Histórico:** card "Reclassificações registradas" alimentado pelas mudanças da sessão; trocar de
  cenário abre confirmação dizendo quantos registros serão descartados (T5-02).
- **RACI:** a célula deixou de ser um botão que só recusa; a ação legítima é "Transferir accountable"
  com justificativa (T5-03).

### T6 · Expurgo e auditoria

- **Correções:** "Verificar integridade" registra quem verificou e quando, e o card passa a exibir
  "última verificação X por Y" (T6-01). A exportação do trail exige a ação `exportar_auditoria`,
  é registrada antes de gerar e sai com hash carimbado (C-06). Os botões de ataque foram agrupados em
  um bloco tracejado "Demonstração de ataque", visível só para papéis que escrevem (T6-02) — e as
  rotas `audit` deixam de escapar da guarda de escrita (C-02). O filtro avisa quando o recorte pode
  estar escondendo o bloco divergente (T6-03).

### T7 · Chaves e criptografia

- **Correções:** a tela ganhou as ações que ela já justificava — "Agendar rotação", "Promover canary"
  e "Abrir incidente a partir desta pendência" (T7-01). A lista de cripto-shredding foi separada em
  duas seções: campos com suporte e chaves sem suporte (T7-02).

### T8 · Editor de LIA

- **Correções:** o Passo 3 exige **uma linha de justificativa por eixo** e o veredito cita a
  mitigação que o sustenta, com a regra de que a queda de uma mitigação devolve a LIA para revisão
  (T8-02). A lista "vincular campo" ordena por elegibilidade e marca os inelegíveis com o motivo,
  desabilitados (T8-03). A LIA vencida ganhou a ação "Abrir renovação" (T8-04) e o Passo 1 passa a
  ser realmente editável (T8-01).

### T9 · Incidentes — tela nova

- **Por quê:** o programa cobre catálogo → RIPD → direitos → risco → expurgo → chaves → LIA e para
  onde o dia ruim começa. Não havia registro de incidente nem comunicação à ANPD e ao titular
  (C-07, Art. 48).
- **Blocos:** faixa com identificador, tempo desde a detecção, estado da decisão e origem; **escopo
  lido do catálogo** (campos atingidos, categoria, titulares estimados, risco e RIPD relacionados);
  **decisão de comunicação** com fundamento obrigatório de 20 caracteres e registro — inclusive a
  decisão de *não* comunicar; **linha do tempo** com hash por evento.

---

## Interações e comportamento

- **Troca de papel:** re-renderiza a casca; se a tela atual não é operada pelo novo papel, volta para
  a T1. Nenhum controle é desabilitado — ele deixa de ser renderizado.
- **Seleção na fila (T4):** define protocolo + titular, limpa qualquer valor revelado e fecha o
  painel de conclusão.
- **Revelação:** abrir modal → escolher finalidade (do catálogo) e motivo → observação redigida →
  registrar antes de responder → valor visível por 60 s, expirando por timestamp.
- **Reclassificação (T5):** selecionar risco → "Reclassificar P × I" → steppers → justificativa ≥ 20
  → registrar. Enter/Espaço funcionam em todos os controles.
- **Abas (T4):** clique, ←/→ circulares, Home/End; foco segue a aba ativa.
- **Troca de cenário:** com registros na sessão, confirma antes de descartar.
- **Transições:** só as que já existem no CSS (`.12s` em fundo e borda). `prefers-reduced-motion`
  continua respeitado.
- **Estados a desenhar antes do backend (C-13):** vazio, carregando, erro recuperável e sem
  permissão — para tabela, gráfico e ação de escrita. Hoje a API mock é síncrona e nenhum deles
  existe.

## Estado

Mantenha o `zustand` (`app/src/store/sessao.ts`). Acrescente ao estado da sessão:

| Estado | Onde | Para quê |
|---|---|---|
| `protocoloSelecionado` | T4 | objeto de trabalho da tela (substitui `solicitacoes[0]`) |
| `revelado: { chave, expiraEm }` | T4 | expiração por timestamp, não por contador |
| `conclusoes: Record<protocolo, desfecho>` | T4 | fecha o cronômetro do SLA |
| `reclassificacoes: []` | T5 | histórico visível da sessão |
| `confirmandoCenario` | casca | confirmação antes de descartar registros |
| `verificacaoAudit: { quando, ator }` | T6 | "última verificação" no card |
| `incidente: { decisao, fundamento }` | T9 | decisão de comunicação registrada |

Regra que não muda: só escrita invalida a tela (`versao`), nunca `GET` — foi o laço de render já
corrigido no repositório.

## Tokens

Todos em `TOKENS.md`. Nada de cor nova: o redesenho usa exatamente as custom properties de
`app/src/ui/estilos.css`.

## Assets

Nenhum. Sem imagens, sem ícones importados, sem fontes externas — a tipografia usa as pilhas de
sistema já declaradas (`--font-display`, `--font-ui`, `--font-mono`).

## Arquivos deste pacote

| Arquivo | O que é |
|---|---|
| `README.md` | este documento |
| `PORTAL-DO-TITULAR.md` | o lado de fora: 11 telas, verificação escalonada, 12 rotas novas (fecha o P0) |
| `MAPA-PROCESSOS.md` | processos → estados → telas; as duas naturezas de trabalho |
| `Portal do Titular.dc.html` | protótipo do portal do titular (referência de design, navegável) |
| `IMPLEMENTACAO.md` | plano por PR, com arquivo, mudança e critério de aceite |
| `ACHADOS.md` | os 41 achados como checklist |
| `TOKENS.md` | tokens, tipografia e padrões de acessibilidade |
| `PROMPT-CLAUDE-CODE.md` | brief pronto para colar |
| `Lastro Redesenho.dc.html` | telas redesenhadas (referência de design, navegável) |
| `Validacao UX e LGPD.dc.html` | relatório de validação com a evidência de cada achado |
| `support.js` | runtime necessário para abrir os dois HTML acima |
