# Wireframes — as 8 telas

> O protótipo navegável está em [`prototipo/index.html`](../prototipo/index.html) — abra no navegador.
> Este documento é a especificação anotada: o que cada tela mostra, para quem, com qual controle de
> privacidade embutido e a partir de qual artefato.

---

## Sistema visual

| Decisão | Escolha | Por quê |
|---|---|---|
| Acento | petróleo `#0B5F66` (claro) / `#46ABB1` (escuro) | Um acento só. Semânticas (ok/alerta/crítico) ficam livres para significar estado, não marca. |
| Neutros | slate com viés ciano | Cinza puro lê como não escolhido; o viés amarra os neutros ao acento. |
| Dado sensível | roxo `#6C3A8C` **com hachura + cadeado** | Cor sozinha não é acessível nem suficiente: o padrão hachurado sobrevive a daltonismo e a impressão em preto e branco. |
| Títulos | serifa (Iowan / Palatino / Georgia) | Registro de peça jurídica — é o que a tela produz (parecer, LIA, RIPD). |
| Chrome e dados | sans do sistema | Densidade e legibilidade em tabela. |
| Hashes, IDs, campos | mono | São identificadores, não prosa: precisam de largura fixa para comparar. |
| Tema | claro e escuro, ambos desenhados | `prefers-color-scheme` + override por `data-theme`. |

Estrutura de navegação em dois grupos, porque a diferença é real: **esteira de entrega** (T1–T3, vivem
no fluxo do pull request) e **operação e prova** (T4–T8, rodam depois do merge).

---

## Três públicos, uma interface

O seletor no topo troca o papel e isso muda o que a tela **oferece**, não só o que ela explica:

| Papel | O que ganha | O que **não** é renderizado |
|---|---|---|
| **Engenharia** | Achado do gate com arquivo e linha, correção sugerida, evidência para o RIPD | Botões de aprovação do DPO |
| **DPO** | Aprovação de RIPD, revelação de dado com finalidade, assinatura de LIA | Detalhe de implementação do gate |
| **Produto** | Volume, prazo, custo de retenção, mapa de esforço × risco | **Nenhum botão "revelar"** — não fica escondido, não existe no DOM |

Cada tela carrega uma faixa contextual dizendo o que aquele papel faz ali. Não é ajuda genérica: muda
o ponto de entrada da leitura.

---

## T1 · Painel de governança

**Público primário:** todos. É a tela de reunião.
**Opera:** `metrics-collector.py`, `privacy-ci-gate.yml`, `architecture-review.yml`, `risk-matrix.csv`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◆metrics-collector.py ◆privacy-ci-gate.yml ◆architecture-review.yml      │
│ Painel de governança                                                     │
│ ▏ ENGENHARIA · comece pelos PRs bloqueados…                              │
├────────────┬────────────┬────────────┬────────────────────────────────────┤
│ ROPA 85,7% │ SLA 34h    │ logs 92%   │ RIPD pendentes 3                  │
│ ▁▂▃ ↑7,1pp │ ▁▂▃ ↓7,5h  │ ▁▂▃ ↑4pp   │ ▁▂▃ ↓3                            │
├────────────────────────┬──────────────────────────────────────────────────┤
│ Scorecard NIST         │ Mapa de calor: esforço (x) × score P×I (y)       │
│ Governar    ▰▰▰▱▱ 3.0↑ │        ┌─ zona "alto impacto, baixo esforço" ─┐  │
│ Identificar ▰▰▰▰▱ 4.0↑ │   25 ─ │              (R1)                    │  │
│ Controlar   ▰▰▰▱▱ 3.0– │   15 ─ │ (R5)                    (R2)(R9)(R8) │  │
│ Comunicar   ▰▰▱▱▱ 2.0– │    5 ─ └──────(R10)───────────────────────────┘  │
│ Proteger    ▰▰▰▱▱ 3.0↑ │        0.5sp   1sp    1.5sp    2sp               │
├────────────┬───────────┴──────────┬───────────────────────────────────────┤
│ bloqueados │ com aviso            │ limpos                                │
│     2      │     1                │    14                                 │
├────────────┴──────────────────────┴───────────────────────────────────────┤
│ O que a esteira barrou                                                    │
│ PR │ repo │ regra │ o que aconteceu │ como resolver │ →                    │
└──────────────────────────────────────────────────────────────────────────┘
```

**Decisões:**
- O erro do workflow aparece **traduzido**, com a linha de origem e a correção. O log cru fica um clique adiante — quem lê a tela precisa da ação, não do `exit code 1`.
- O scorecard só é útil com evidência: cada domínio expande mostrando o que sustenta a nota. Nota sem lastro é slide.
- A bolha maior sinaliza risco não mitigado; a posição em x é estimativa de esforço, e é nesse eixo que o algoritmo desloca bolhas sobrepostas — nunca no eixo do score, que é o número que a decisão usa.
- Métricas vêm de **snapshot imutável** (`metric_snapshot`), não de query ao vivo: o número apresentado no comitê de julho continua reproduzível em outubro.

---

## T2 · Catálogo de dados (ROPA vivo)

**Público primário:** engenharia e DPO.
**Opera:** `.privacy/data-inventory.*.yaml`, tabela `linhagem`

```
┌───────────────────┬──────────────────────────────────────────────────────┐
│ Sistemas          │ Filtros: base legal │ sensível │ transferência │ ret. │
│ ▸ credit-scoring  ├──────────────────────────────────────────────────────┤
│   · clientes    4 │ Campo │ Guarda │ Finalidade │ Base legal │ Ret. │ Dest│
│   · decisoes_ia 1 │ cpf              🔒 hash      …  execucao_contrato    │
│ ▸ onboarding      │ historico_compras 🎭 hmac     …  legitimo_interesse   │
│   · cadastros   2 │                                  └ LIA-SCORING-001    │
│ ▸ analytics       │ biometria_facial 🔐 [🔒sensível]  consentimento       │
│   ⚠ sem inventário│──────────────────────────────────────────────────────│
├───────────────────┤ 🔒 hash · 🎭 pseudônimo · 📷 bruto                    │
│ Novo inventário   │ nenhum valor de titular é exibido nesta tela          │
│ ┌ drag & drop ─┐  ├──────────────────────────────────────────────────────┤
│ │ .yaml        │  │ Fluxo: Formulário→API→PostgreSQL→[OpenAI]→Lake→Expurgo│
│ └──────────────┘  │                      ▲ destaque em destino externo    │
│ diff: +historico  │                                                       │
└───────────────────┴──────────────────────────────────────────────────────┘
```

**Decisões:**
- O catálogo descreve **campos, não conteúdo**. Não há um só valor de titular aqui — e a tela diz isso em voz alta, para que ninguém peça "só um preview dos dados".
- Sistema sem inventário aparece em vermelho na árvore. A ausência é informação: é o que a fiscalização pergunta primeiro.
- O upload valida contra schema e mostra **diff contra a versão anterior**. Campo removido (`− cep · proxy discriminatório`) é tão relevante quanto campo adicionado.
- O ícone de armazenamento carrega a doutrina: `hash` nunca aparece como "anonimizado", porque hash de CPF reverte por força bruta. O banco recusa essa combinação (`campo_anonimizado_exige_agregacao`).
- Destino internacional recebe 🌎 — é o gatilho de revisão do Art. 33.

---

## T3 · RIPD e LINDDUN

**Público primário:** engenharia preenche, DPO aprova.
**Opera:** `ripd-triage.sh`, `threat-model.md`, `parecer-tecnico.md`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ⛔ Merge bloqueado — PR #1234 · credit-scoring                            │
│    [T1 dado sensível] [T3 decisão automatizada] [T6 …] [T8 …]  RIPD-…-014 │
├──────────────────────────────────────────┬───────────────────────────────┤
│ Parecer técnico                          │ Checklist LINDDUN             │
│ ① Contexto e escopo         [textarea]   │ Location       ≡ Identifiab. ○ │
│ ② Dados tratados   ← do catálogo, tabela │ Inference      ≡ Detectab.   ● │
│ ③ Fluxo de dados   [editor mermaid]      │ Disclosure                   ● │
│ ④ Base legal por operação  ← exige LIA   │ Discrimination ≡ Non-compl.  ● │
│ ⑤ Matriz de riscos ← alimenta a T5       │ Unauthorized                 ● │
│ ⑥ Recomendações P0/P1/P2 · dono · prazo  │ Non-repudiation              ● │
│                                          ├───────────────────────────────┤
│ [Gerar RIPD.md e anexar ao PR]           │ Mitigações geradas            │
│ [Aprovar como DPO]  ← só papel DPO       │ • Disclosure — DTO por escopo │
└──────────────────────────────────────────┴───────────────────────────────┘
```

**Decisões:**
- A seção 2 é **importada do catálogo**, não redigitada. Parecer que diverge do YAML é parecer que envelhece no dia seguinte.
- Ativar uma categoria LINDDUN **gera o item de mitigação** correspondente — o checklist produz trabalho, não confere caixinhas.
- Os seis rótulos são os que este time usa no `threat-model.md`. Eles não são o LINDDUN canônico (Linkability, Identifiability, Non-repudiation, Detectability, Disclosure, Unawareness, Non-compliance), então a tela mostra a equivalência sob cada nome e o banco grava a categoria canônica. Assim o modelo continua comparável fora de casa sem obrigar o time a trocar o vocabulário que já usa.
- Legítimo interesse na seção 4 só é aceito com LIA **vigente** vinculada — a mesma regra que o trigger `campo_exige_lia_vigente` aplica no banco. A tela não é mais permissiva que a persistência.
- O botão de aprovação não é desabilitado para engenharia: ele não é renderizado.

---

## T4 · Direitos do titular

**Público primário:** DPO.
**Opera:** `pseudonymizer.ts`, `privacy-redactor.ts`, Art. 18 e Art. 20

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 27 solicitações │ 34h médio │ 100% no SLA │ ⚠ 1 a menos de 24h do prazo   │
├──────────────────────────────────────────────────────────────────────────┤
│ Protocolo │ Direito │ Titular │ Sistemas │ SLA │ Status                   │
│ 2026-0731 │ Acesso  │ •••.•••.•••-•• [revelar] │ ▰▰▰▰▱ 3d 04h de 15 dias  │
│ 2026-0730 │ Elimin. │ •••.•••.•••-•• [revelar] │ ▰▰▰▰▰ 19h · DPO notificado│
├───────────────────────────────────┬──────────────────────────────────────┤
│ [Dados][Compartilh.][Revisão][Msg]│ Buscar titular                       │
│ ┌ Identificação ─┐ ┌ Crédito ────┐│ CPF [•••.•••.•••-••]                 │
│ │ Nome  •••••••• │ │ Renda R$••••││ [Identificar com autenticação forte] │
│ │ CPF   •••.•••… │ │ Score  •••  ││ ▏ a busca envia apenas o hash        │
│ └────────────────┘ └─────────────┘├──────────────────────────────────────┤
│ ┌ Biometria [🔒sensível] ────────┐ │ Distribuição do mês                  │
│ │ não exibida em nenhuma hipótese│ │ Acesso ▰▰▰▰▰ 11                      │
│ └────────────────────────────────┘ │ Eliminação ▰▰▰ 7                     │
└───────────────────────────────────┴──────────────────────────────────────┘
```

**Decisões — o coração do privacy-by-design da interface:**
1. **Tudo mascarado por padrão, inclusive para o DPO.** Não existe interruptor global de "mostrar tudo".
2. **Revelar exige finalidade e justificativa** (mínimo 20 caracteres) e vale para **um campo, por 60 segundos**, com contagem regressiva visível. Depois volta a mascarar sozinho.
3. **A tentativa é registrada antes da resposta.** Se a gravação do log falhar, a revelação falha.
4. **Dado sensível não é revelável em tela alguma.** A biometria mostra apenas a prova de que existe, a base legal e a data de destruição.
5. **A busca envia hash**, nunca o CPF digitado — sem PII em URL, histórico, `Referer` ou log de gateway.
6. **O canal titular↔DPO vive na plataforma.** E-mail não prova entrega nem controla quem leu. O banco recusa mensagem com CPF em claro (`mensagem_sem_cpf`).
7. **SLA duplo e honesto:** o cronômetro mostra a meta interna (5 dias) e o prazo legal (15 dias úteis, ou 5 para revisão de decisão). Fingir que o prazo legal é 5 dias seria confortável e falso.

---

## T5 · Riscos e RACI

**Público primário:** DPO e produto.
**Opera:** `docs/risk-matrix.csv`

```
┌──────────────────────────────────┬───────────────────────────────────────┐
│ Matriz 5×5   impacto ↑           │ R1 · Vazamento de CPF via prompt      │
│  5 │ R10 │R3 R8│ R2  │ (R1)│     │ Score        20 (P4 × I5)             │
│  4 │     │     │R6 R9│     │     │ Dano         Material — crédito negado│
│  3 │     │     │     │ R4  │ R5  │ Tratamento   Pseudonimização HMAC…    │
│  2 │     │     │     │ R7  │     │ Dono         @eng-maria · Engenharia  │
│  1 │     │     │     │     │     │ Prazo        15/08 · reavaliar 15/11  │
│    └─ 1 ── 2 ── 3 ── 4 ── 5 ─→ P │ [Ver RIPD-2026-014 →]                 │
│    verde ≤7 · âmbar 8-14 · vermelho ≥15                                   │
├──────────────────────────────────┼───────────────────────────────────────┤
│ arrastar ⇒ modal de justificativa│ Risco por domínio                     │
│                                  │ Engenharia [1 crítico] ▰▰▰▰▰ 44       │
└──────────────────────────────────┴───────────────────────────────────────┘
```

**Decisões:**
- Arrastar uma bolha abre modal com **justificativa obrigatória**; cancelar devolve o risco à posição anterior. O histórico (`risco_reclassificacao`) é append-only: o banco recusa `UPDATE` e `DELETE`.
- O RACI mostra um único **A** por processo — regra garantida por índice único parcial no banco, não por disciplina do preenchedor.
- O heatmap por domínio existe para responder uma pergunta política: onde a dívida está concentrada e quem precisa de orçamento.

---

## T6 · Expurgo e auditoria

**Público primário:** engenharia e auditoria.
**Opera:** `expurgo-permanente.py`, `audit_log` com hash encadeado

```
┌─────────────────┬────────────────────────────────────────────────────────┐
│ Julho 2026      │ Lotes de hoje              [Verificar integridade]     │
│ D S T Q Q S S   │ sistema·tabela │ método │ regs │ hash pré │ pós │ ✓     │
│ ░░▓▓▒▒▓▓        │ credit·decisoes_ia │ hard delete │ 8.120 │ a3f… │ 7e9…  │
│ ▓▓▒▒██▓▓ ← 26/07│ credit·historico   │ cripto-shred│ 6.301 │ b5c… │ 1e3…  │
│   falhou        │ [Gerar relatório de expurgo (PDF)] hash: c1d3e5f7…     │
├─────────────────┼────────────────────────────────────────────────────────┤
│ Volume/semana   │ Audit trail — append-only, cada linha sela a anterior   │
│ ▂▄▃▆▄           │ 09:12 Marcela CAMPO_REVELADO campo/cpf atendimento 4f2a│
│                 │ 08:47 Pedro   CAMPO_REVELADO campo/renda ✖ negado 1b93 │
└─────────────────┴────────────────────────────────────────────────────────┘
```

**Decisões:**
- O hash **pré e pós** é a prova. "Apagamos" sem par de hashes é declaração, não evidência.
- O botão "Verificar integridade" **recalcula a cadeia inteira** e compara. A função existe no banco (`verificar_integridade_audit`) e os testes provam que ela detecta adulteração feita com os gatilhos desligados — cenário de DBA comprometido.
- O acesso **negado** aparece no log com o mesmo destaque do concedido. Tentativa recusada é sinal de segurança, não ruído a esconder.
- O relatório em PDF sai com hash próprio, para que a auditoria de 2029 possa verificar o arquivo que recebeu em 2026.

---

## T7 · Chaves e criptografia

**Público primário:** engenharia e segurança.
**Opera:** `kms-rotation.yml`, `pseudonymizer.ts`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Rotação em curso — credito_pii                          v3 → v4 · 6 dias │
│ ①Gerar ✓ │ ②Parameter Store ✓ │ ③Canary 5% ✓ │ ④Recriptografar ▰▰▰▱ 63,4%│
│                                              │ ⑤Revogar antiga (agendada)│
├───────────────────────────────────┬──────────────────────────────────────┤
│ Chaves                            │ Quem depende de cada chave           │
│ alias/credit-pii-v3  ativa   10d ⚠│  [credit-pii-v3] ─┬─ clientes        │
│ alias/credit-pii-v4  canary  84d  │                   └─ decisoes_ia     │
│ alias/backup-rds-v1  ativa    5d ✖│  [onboarding-bio] ── cadastros        │
├───────────────────────────────────┼──────────────────────────────────────┤
│ Log de acesso às chaves           │ Cripto-shredding                     │
│ há 2h estagiario.dev biometria ✖  │ clientes      suportado              │
│ ▏ tentativa fora da VPN mirava    │ eventos_brutos não suportado         │
│   chave de dado sensível          │ backup RDS     não suportado → R10   │
└───────────────────────────────────┴──────────────────────────────────────┘
```

**Decisões:**
- A etapa 4 é a que trava deploy e por isso ganha barra de progresso com números absolutos, não só percentual.
- A árvore de dependências responde antes da pergunta: revogar esta chave derruba **o quê**.
- O quadro de cripto-shredding é o que conecta criptografia a direito do titular: onde não há suporte, a eliminação exige `hard delete` — e isso vira risco nomeado (R10), não nota de rodapé.

---

## T8 · Editor de LIA

**Público primário:** DPO redige, engenharia consome o resultado.
**Opera:** `LIA.md`, Art. 7º, IX

```
┌────────────────────────────────────────────┬─────────────────────────────┐
│ LIA-SCORING-001            vigente até 2027│ Conclusão                   │
│ ① Finalidade legítima                      │ ✓ Sustenta com mitigação    │
│    [categoria ▾] [expectativa do titular ▾]│ ▏ legítimo interesse não    │
│    [descrição……………………]                     │   sustenta dado sensível    │
│ ② Necessidade — alternativas menos invasivas├─────────────────────────────┤
│    Anonimização    …………………  [rejeitado]    │ Datasets vinculados         │
│    Pseudonimização …………………  [atendido]     │ clientes.historico_compras  │
│    Escopo menor    …………………  [atendido]     │ se vencer → campo perde     │
│ ③ Balanceamento  benefício × dano          │ base legal e o CI bloqueia  │
│    ┌───┬───┬───┐  Posição do risco          ├─────────────────────────────┤
│    │ ✓ │aqui│   │  ├────●──────┤            │ Ciclo de revisão            │
│    ├───┼───┼───┤  ▏Sustenta com mitigação   │ assinada 12/02 @dpo-marcela │
│    │   │   │ ✖ │   só se pseudonimização…   │ vence 01/02/2027 (189 dias) │
│ ④ Transparência e oposição                 │ aviso 60 dias antes         │
│ ⑤ Evidências [drag&drop] + hash            └─────────────────────────────┘
│ [Gerar LIA.md assinado]  sha256 7c1f0a9b…                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

**Decisões:**
- "Não aplicável" também exige justificativa. É a resposta que mais esconde falta de análise.
- O balanceamento é uma matriz de 3×3 com veredito **escrito**, não um número. Um score de 6/9 não diz a ninguém se pode seguir; "sustenta com mitigação, desde que a pseudonimização continue ativa" diz.
- O card de datasets vinculados mostra a **consequência do vencimento**: o campo perde base legal e o gate de CI passa a bloquear o repositório. A LIA deixa de ser papel quando vencer dói.
- O documento sai com timestamp, hash e assinatura. Sem assinatura o status não chega a `vigente` — restrição de banco, não convenção.

---

## O que a interface recusa a fazer

Tão importante quanto a lista de funcionalidades:

- **Não existe exportação de dados de titular em massa.** Portabilidade é por titular, com link assinado e expiração de 24 h.
- **Não existe "mostrar tudo" por sessão.** Cada revelação é individual, justificada e temporária.
- **Não existe edição do audit trail.** Nem para administrador — o `UPDATE` é recusado pelo banco.
- **Não existe contagem total para papéis não confiáveis.** Saber que a base tem 500 mil titulares já é informação demais (anti-enumeração).
- **Não existe campo livre que aceite CPF** nos canais de mensagem: a restrição está no banco, não só no formulário.
