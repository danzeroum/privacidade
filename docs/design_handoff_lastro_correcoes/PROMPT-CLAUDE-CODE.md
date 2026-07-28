# Brief para colar no Claude Code

Abra o Claude Code na raiz do repositório `privacidade` e cole o texto entre as linhas.

---

Você vai implementar correções de UX e privacidade nos protótipos de tela deste repositório.

**Comece se localizando, nesta ordem:**

1. `docs/design_handoff_lastro_correcoes/README.md` — o que cada uma das 9 telas passa a ser:
   layout, tokens, comportamento e estado.
2. `docs/design_handoff_lastro_correcoes/IMPLEMENTACAO.md` — o plano em 6 PRs, com arquivo, mudança
   e critério de aceite por item. É o documento que guia o trabalho.
3. `docs/design_handoff_lastro_correcoes/ACHADOS.md` — os 41 achados como checklist, com severidade
   e arquivo de origem.
4. `docs/design_handoff_lastro_correcoes/TOKENS.md` — tokens visuais e padrões de acessibilidade.
5. `docs/design_handoff_lastro_correcoes/Lastro Redesenho.dc.html` — as telas redesenhadas,
   navegáveis (abra no navegador; o `support.js` ao lado é necessário). **É referência de design,
   não código para copiar** — recrie no ambiente que já existe em `app/`.
6. `docs/design_handoff_lastro_correcoes/Validacao UX e LGPD.dc.html` — o relatório com a evidência
   de cada achado, caso precise entender o porquê de alguma decisão.

**O código que você vai tocar** fica em `app/`: React 18 + TypeScript, Vite, zustand
(`app/src/store/sessao.ts`), react-router-dom em HashRouter (`app/src/App.tsx`), telas em
`app/src/screens/T1..T8.tsx`, primitivos em `app/src/ui/`, CSS com custom properties em
`app/src/ui/estilos.css`, API mock em `app/src/mock/api.ts` e 26 testes em
`app/tests/regras.test.tsx`. Rode `cd app && npm install` antes de começar.

**Três regras do projeto que não podem ser quebradas:**

1. **A regra de privacidade mora em `app/src/mock/api.ts`, não na tela.** Toda correção de
   comportamento entra na camada de API e só depois na interface. Corrigir só a tela não fecha item.
2. **Ausência em vez de desabilitado.** O que um papel não opera não é renderizado — `Permitido`
   devolve `null`. Nada de `display:none` nem `disabled` para esconder permissão.
3. **Gravar antes de responder.** Acesso a dado pessoal registra no audit trail antes da resposta; se
   a gravação falha, a resposta falha com 503. A ordem importa e existe teste para ela.

**Como quero que você trabalhe:**

- Leia `IMPLEMENTACAO.md` e `ACHADOS.md` inteiros antes de escrever qualquer código.
- Devolva primeiro o plano do **PR 1** (Controle de acesso — C-01, C-02, T6-02): arquivos que vai
  tocar, ordem das mudanças e os testes que vai escrever. Não implemente sem meu aceite.
- Depois do aceite, um PR por vez, na ordem do plano.
- Ao fim de cada PR: `npx tsc --noEmit`, `npm test` (os 26 existentes precisam continuar passando,
  mais os novos) e um resumo do que mudou, achado por achado.
- Se algum item do plano conflitar com o código real, me diga antes de decidir sozinho.

Comece agora pela leitura e me apresente o plano do PR 1.

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
