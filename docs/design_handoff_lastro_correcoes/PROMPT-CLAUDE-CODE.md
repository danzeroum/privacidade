# Brief para colar no Claude Code

Coloque esta pasta em `design_handoff_lastro_correcoes/` na raiz do repositório e cole o texto
abaixo na primeira mensagem.

---

Estou no repositório `privacidade` — arquitetura e protótipos de uma plataforma de governança de
privacidade (LGPD). O protótipo navegável fica em `app/` (React 18 + TypeScript + Vite + zustand +
react-router-dom, API mock em `app/src/mock/api.ts`, 26 testes em `app/tests/regras.test.tsx`).

Uma validação de UX e privacidade das 8 telas produziu 41 achados e um redesenho. Está tudo em
`design_handoff_lastro_correcoes/`:

- `README.md` — o desenho de cada tela, com layout, tokens, comportamento e estado
- `IMPLEMENTACAO.md` — o plano em 6 PRs, com arquivo, mudança e critério de aceite por item
- `ACHADOS.md` — os 41 achados como checklist, com severidade e arquivo
- `TOKENS.md` — tokens visuais e padrões de acessibilidade
- `Lastro Redesenho.dc.html` — as telas redesenhadas, navegáveis (abra no navegador; precisa do
  `support.js` ao lado). **É referência de design, não código para copiar.**
- `Validacao UX e LGPD.dc.html` — o relatório com a evidência de cada achado

Antes de escrever qualquer código, leia `IMPLEMENTACAO.md` e `ACHADOS.md` inteiros e me devolva o
plano do **PR 1** em detalhe — arquivos que vai tocar, ordem das mudanças e os testes que vai
escrever. Não comece a implementar sem esse aceite.

Três regras do projeto que não podem ser quebradas:

1. **A regra de privacidade mora em `app/src/mock/api.ts`, não na tela.** Toda correção de
   comportamento entra na camada de API e só depois na interface. Corrigir só a tela não fecha item.
2. **Ausência em vez de desabilitado.** O que um papel não opera não é renderizado — `Permitido`
   devolve `null`. Nada de `display:none` nem `disabled`.
3. **Gravar antes de responder.** Acesso a dado pessoal registra no audit trail antes da resposta; se
   a gravação falha, a resposta falha (503). A ordem importa e há teste para isso.

Trabalhe um PR por vez, na ordem de `IMPLEMENTACAO.md`. Ao fim de cada um: `npx tsc --noEmit`,
`npm test` (os 26 testes existentes precisam continuar passando, mais os novos do PR) e um resumo do
que mudou por achado. Se algum item do plano conflitar com o código real, me diga antes de decidir
sozinho.

---

## Ordem dos PRs, em uma linha cada

1. **Controle de acesso** — busca por CPF com papel e registro (C-01); rotas `audit` dentro da guarda
   de escrita (C-02); botão de escrita fora do papel de leitura (T6-02).
2. **Fluxo da T4** — fila selecionável e contexto único (T4-01); concluir atendimento (T4-02);
   finalidade confrontada com o catálogo (C-03); justificativa redigida (C-04); expiração por
   timestamp (C-05); revisão do Art. 20 com prova (T4-03); abas ARIA (T4-04); KPI de SLA (T4-05).
3. **Acessibilidade da ação e rastro** — reclassificar por teclado (T5-01); histórico e troca de
   cenário (T5-02); verificar e exportar registrando (T6-01, C-06); filtro versus cadeia (T6-03).
4. **Cobertura LGPD** — tela de incidentes, Art. 48 (C-07); registro de consentimento (C-08).
5. **Fidelidade e mensagens** — controles inertes (C-15); recusa ancorada (C-10); T1, T3, T7, T8.
6. **Legibilidade e larguras** — piso de 12,5 px (C-11); tooltips (C-12); breakpoints (C-14);
   estados de carregando/erro/vazio (C-13); menu por papel (C-09).
