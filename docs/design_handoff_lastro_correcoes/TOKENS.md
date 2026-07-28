# Tokens, tipografia e padrões

Nada de cor nova. O redesenho usa exatamente as custom properties já declaradas em
`app/src/ui/estilos.css` — o que muda são **valores de tipografia** e alguns **padrões de
acessibilidade**.

## Cores (tema claro — `:root`)

| Token | Hex | Uso no redesenho |
|---|---|---|
| `--bg` | `#E9EDEE` | fundo da aplicação |
| `--surface` | `#FFFFFF` | cards, trilho, modais |
| `--surface-2` | `#F2F6F6` | cards aninhados, blocos de evidência, rodapé de modal |
| `--surface-3` | `#E4EAEB` | trilho de barras e medidores |
| `--line` | `#D2DCDD` | bordas e divisórias |
| `--line-strong` | `#B6C4C6` | borda tracejada de campo mascarado e de área de arrastar |
| `--text` | `#0E1719` | texto principal |
| `--text-2` | `#495A5D` | texto secundário, descrições |
| `--text-3` | `#6E8184` | rótulos, hashes, metadados |
| `--accent` | `#0B5F66` | ação primária, item de menu ativo, aba ativa |
| `--accent-2` | `#0F7E86` | hover de ação primária e anel de foco |
| `--accent-soft` | `#DCEAEA` | fundo do item ativo, faixa de contexto da T4 |
| `--ok` / `--ok-soft` | `#2F6E45` / `#DDEBE0` | confirmações, células de score < 8 |
| `--warn` / `--warn-soft` | `#8E5C08` / `#F3E7CE` | atenção, contagem regressiva, score 8–14 |
| `--crit` / `--crit-soft` | `#9E1F26` / `#F5DEDF` | recusa, incidente, score ≥ 15 |
| `--sens` / `--sens-soft` | `#6C3A8C` / `#EBDFF3` | dado sensível (com hachura a 135°) |

Tema escuro: mantenha o bloco existente. Todos os pares foram usados por token, não por hex fixo —
o redesenho funciona nos dois temas sem ajuste.

## Tipografia

Pilhas inalteradas: `--font-display` (Iowan Old Style / Palatino / Georgia, serifada) para títulos e
números grandes; `--font-ui` (system-ui) para interface; `--font-mono` (ui-monospace) para
identificadores, hashes e código.

**Mudança (C-11): piso de 12,5 px para texto de interface; 11 px só para rótulo de eixo de gráfico.**

| Elemento | Hoje | Passa a ser |
|---|---|---|
| `.hint`, `.kpi-label`, `.kpi-foot`, `.rail-foot` | 11,5 px | **12,5 px** |
| `.hash`, `.aviso .regra`, `table.dense` | 11,5–12 px | **12,5 px** |
| `th`, `.rail-group`, `.sec-title`, `.topbar-label` | 10,5–11 px | **12,5 px** |
| `.pill`, `.letter`, `.bal-cell`, `.nav-id` | 11 px | **12,5 px** |
| `.countdown`, `.msg .who` | 10,5 px | **12,5 px** |
| `.doc`, `.mermaid-src` | 11–11,5 px | **12,5 px** |
| `fontSize` embutido nos SVG (T1, T5, T7) | 9–10 px | **11 px** (rótulo de eixo) |
| corpo | 14 px | 14 px (inalterado) |
| `.head h1` | 30 px | 30 px (inalterado) |

Escala em uso no redesenho: 12,5 · 13 · 13,5 · 14,5 · 15,5 · 16 · 21 · 24 · 30 · 32.

## Espaçamento, raio e sombra

- Espaçamento: 2 · 4 · 6 · 8 · 10 · 12 · 14 · 18 · 20 · 24 px. Cards `16px 18px`; grades com `gap: 14px`.
- Raio: `--r: 4px` (controles, campos, pills quadrados) · `--r-lg: 8px` (cards, modais, faixas) ·
  `999px` (pills).
- Sombra: `--shadow` só em modal e no botão ativo do segmento de papéis.
- Larguras: trilho `flex: 0 1 236px` (mín. 212 px), conteúdo `flex: 1 1 620px`, `max-width: 1420px`.
  Grades responsivas por `repeat(auto-fit, minmax(210…340px, 1fr))` — sem depender de `@media`.
  Tabelas densas vão dentro de contêiner com `overflow-x: auto` e `min-width` explícito.

## Padrões de acessibilidade adotados

1. **Ausência, não desabilitado.** O controle que o papel não opera não é renderizado — inclusive no
   menu (C-09).
2. **Toda ação consequente tem caminho de teclado.** A matriz de risco é grade de `<button>`;
   reclassificar tem botão explícito além do arrasto (T5-01).
3. **Abas seguem o padrão ARIA inteiro**: `role="tab"` com `id` + `aria-controls`, painel com
   `role="tabpanel"` + `aria-labelledby`, `tabIndex` gerenciado, setas ←/→ circulares e Home/End
   (T4-04).
4. **Recusa é `role="alert"` ancorado no controle.** Confirmação é `role="status"` na faixa do topo
   (C-10).
5. **`title` deixa de carregar conteúdo essencial.** O que explica regra vira texto visível ou
   popover acionável por foco e clique (C-12).
6. **Alvos de toque de 32 px** nos steppers de P e I; `touch-action: none` no contêiner da matriz.
7. `:focus-visible` global com `outline: 2px solid var(--accent-2)` e `prefers-reduced-motion`
   continuam como já estão — não mexa.

## Conteúdo

Dois níveis de texto (C-16):

- **Operacional** — permanente, neutro, descreve o que a tela faz.
- **Didático** — a voz de ensaio do protótipo (“Nota sem lastro é slide.”), visível apenas em **modo
  apresentação** ou na primeira visita.

Datas em `pt-BR`, números com `toLocaleString('pt-BR')` e `font-variant-numeric: tabular-nums` em
qualquer valor que apareça em coluna.
