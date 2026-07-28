# Achados — checklist

41 achados: **3 críticos · 6 altos · 23 médios · 9 baixos**. A coluna PR remete a `IMPLEMENTACAO.md`.
Evidência completa de cada item em `Validacao UX e LGPD.dc.html`.

## Transversais

| # | Sev. | Tela | Achado | Arquivo | PR |
|---|---|---|---|---|---|
| C-01 | Crítico | T2 · T4 · API | Busca por CPF não checa papel nem registra a consulta | `mock/api.ts` (`POST titulares`), `screens/T2.tsx` | 1 |
| C-02 | Crítico | T6 · API | Guarda de escrita abre exceção para as rotas `audit` | `mock/api.ts` (guarda de topo) | 1 |
| C-03 | Alto | T4 | Finalidade exigida mas não confrontada com o catálogo | `mock/api.ts`, `ui/primitivos.tsx` | 2 |
| C-04 | Alto | T4 · T5 | Justificativa livre entra crua no log imutável | `mock/api.ts`, `ui/reclassificar.tsx` | 2 |
| C-05 | Médio | T4 | Re-mascaramento em 60 s é contador de cliente | `ui/primitivos.tsx` | 2 |
| C-06 | Médio | T6 | Exportar o audit trail não é registrado nem gated | `screens/T6.tsx` | 3 |
| C-07 | Alto | — | Não existe tela de incidente de segurança (Art. 48) | novo `screens/T9.tsx` | 4 |
| C-08 | Médio | T2 · T4 | Consentimento sem prova nem revogação operável | `mock/types.ts`, `mock/api.ts` | 4 |
| C-09 | Médio | casca | Menu não reflete o papel; item “desabilitado” navega | `App.tsx` | 6 |
| C-10 | Médio | casca | Recusa e confirmação no mesmo canal, longe da ação | `App.tsx`, telas | 5 |
| C-11 | Médio | CSS | Informação essencial em 10,5–11,5 px | `ui/estilos.css`, SVG de T1/T5/T7 | 6 |
| C-12 | Médio | T1 · T2 · T5 · T6 | Conteúdo indispensável só no `title` | telas | 6 |
| C-13 | Médio | todas | Sem estados de carregando, erro e vazio | `store/sessao.ts`, telas | 6 |
| C-14 | Médio | CSS | Nenhum ponto de quebra de largura | `ui/estilos.css` | 6 |
| C-15 | Baixo | T2 · T4 · T6 · T8 | Controles inertes sem distinção dos reais | telas | 5 |
| C-16 | Baixo | todas | Voz de ensaio no cromo do produto | telas | 5 |

## Por tela

| # | Sev. | Achado | Arquivo | PR |
|---|---|---|---|---|
| T1-01 | Alto | Dois mapas com eixos diferentes abrem o mesmo modal | `screens/T1.tsx` | 5 |
| T1-02 | Médio | Violação simulada entra no gráfico do comitê sem estado próprio | `screens/T1.tsx` | 5 |
| T1-03 | Médio | Bolha é botão pela metade (só Enter, nome acessível ruim) | `screens/T1.tsx` | 6 |
| T2-01 | Médio | CPF digitado permanece na sessão após a busca | `screens/T2.tsx` | 1 |
| T2-02 | Médio | Linhagem abre fora do campo de visão, sem mover foco | `screens/T2.tsx` | 5 |
| T2-03 | Baixo | Filtros sem estado vazio e sem limpar | `screens/T2.tsx` | 5 |
| T3-01 | Médio | Stepper mostra progresso que ninguém calcula | `screens/T3.tsx` | 5 |
| T3-02 | Médio | “Anexar ao PR” só baixa arquivo | `screens/T3.tsx` | 5 |
| T3-03 | Baixo | “Testar combinação” só fala quando recusa | `screens/T3.tsx` | 5 |
| T4-01 | Crítico | Fila não selecionável; contexto pode apontar para outra pessoa | `screens/T4.tsx` | 2 |
| T4-02 | Alto | Não existe o ato de concluir a solicitação | `mock/api.ts`, `screens/T4.tsx` | 2 |
| T4-03 | Médio | Revisão de decisão automatizada não deixa prova (Art. 20) | `screens/T4.tsx` | 2 |
| T4-04 | Médio | Abas com papel ARIA sem o padrão ARIA | `screens/T4.tsx` | 2 |
| T4-05 | Baixo | “Atendidas no SLA” não mede SLA | `screens/T4.tsx` | 2 |
| T5-01 | Alto | Reclassificar só existe no arrasto do mouse | `screens/T5.tsx` | 3 |
| T5-02 | Médio | Histórico “imutável” some ao trocar de cenário | `store/sessao.ts`, `screens/T5.tsx` | 3 |
| T5-03 | Baixo | Célula RACI é botão que só serve para recusar | `screens/T5.tsx` | 5 |
| T6-01 | Médio | Verificar integridade não registra quem verificou | `mock/api.ts` | 3 |
| T6-02 | Médio | Botão de escrita renderizado para papel de leitura | `screens/T6.tsx` | 1 |
| T6-03 | Baixo | Filtro pode esconder o bloco divergente; gate sem efeito | `screens/T6.tsx` | 3 |
| T7-01 | Médio | Tela informa muito bem e não deixa fazer nada | `screens/T7.tsx` | 5 |
| T7-02 | Baixo | Lista de cripto-shredding mistura campos e chaves | `screens/T7.tsx` | 5 |
| T8-01 | Médio | O editor quase não edita | `screens/T8.tsx` | 5 |
| T8-02 | Médio | Balanceamento entrega veredito sem guardar o raciocínio | `screens/T8.tsx`, `mock/api.ts` | 5 |
| T8-03 | Baixo | A tela pré-seleciona o campo que ela mesma vai recusar | `screens/T8.tsx` | 5 |

## O que não mudar

Nove decisões que sustentam o projeto e devem sobreviver a qualquer refatoração:

1. A regra mora em `mock/api.ts`, não na tela.
2. Mascarado é o padrão, inclusive para o DPO — sem interruptor de sessão.
3. Ausência em vez de desabilitado: `Permitido` devolve `null`.
4. Gravar antes de responder; falha de log ⇒ 503 e nenhum valor sai.
5. Dado sensível sem caminho de revelação em tela alguma (Art. 11).
6. 404 no lugar de 403 fora de escopo; `totalItems` omitido para papéis não confiáveis.
7. Audit trail append-only com hash encadeado e adulteração detectável.
8. Erro que ensina: a recusa cita o artigo e o motivo, no ponto do erro.
9. Vocabulário controlado espelhando os enums do `db/schema.sql`.
