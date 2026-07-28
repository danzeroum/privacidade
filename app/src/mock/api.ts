import { BancoMock, FalhaDeAuditoria, LogImutavel } from './db';
import { pode } from './permissoes';
import { BASES_PARA_SENSIVEL } from './types';
import type { BaseLegal, Campo, Categoria, Finalidade, Mecanismo, Papel, TipoArmazenado } from './types';

export interface Req {
  metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  caminho: string;
  papel: Papel;
  ator: string;
  purpose?: Finalidade;
  body?: Record<string, unknown>;
}

export interface Res<T = unknown> {
  status: number;
  body: T;
  /** Regra explicada em linguagem de gente, para o snackbar da UI. */
  regra?: string;
}

const ok = <T>(body: T, status = 200): Res<T> => ({ status, body });
const erro = (status: number, mensagem: string, regra?: string): Res<{ erro: string }> =>
  ({ status, body: { erro: mensagem }, regra });

/**
 * As nove regras de privacidade estão implementadas aqui, e não na interface.
 * A tela pode ser reescrita à vontade: o comportamento continua o mesmo, porque
 * quem recusa é esta camada.
 */
export function request<T = unknown>(banco: BancoMock, req: Req): Res<T> {
  const { metodo, caminho, papel, ator } = req;
  const partes = caminho.replace(/^\/v1\//, '').split('/');
  const raiz = partes[0];
  const body = (req.body ?? {}) as Record<string, any>;

  /**
   * Verificar a integridade da cadeia é leitura: recomputa hashes e compara,
   * sem mudar uma linha. Por isso sai antes da guarda de escrita — é
   * justamente o que o auditor externo veio fazer, e prendê-lo a `escrever`
   * tiraria dele o único ato que sustenta o parecer.
   *
   * Decisão registrada para o PR 3: quando `verificar` passar a gravar
   * `INTEGRIDADE_VERIFICADA` no trail (T6-01), o registro é consequência do
   * sistema, não escalada do ator — a rota ganha a ação própria
   * `verificar_integridade`, concedida a todos os papéis de leitura, e **não**
   * volta para dentro de `escrever`.
   */
  if (raiz === 'audit' && partes[1] === 'verificar') {
    return ok(banco.auditVerificar()) as Res<T>;
  }

  /**
   * A busca por titular também sai antes da guarda genérica, por outro motivo:
   * ela precisa responder **404 uniforme** a quem está fora de escopo. Caindo
   * na guarda, um papel sem `escrever` receberia 403 — e o 403 confirmaria que
   * a rota existe e que o pedido só falhou por permissão, reabrindo pela porta
   * da guarda o oráculo que a Regra 5 fecha.
   *
   * Isto não é uma exceção como a que existia em `audit` (C-02): `buscar_titular`
   * é estritamente mais restritiva que `escrever` — só o DPO a tem, e o DPO
   * escreve. Nada alcança esta rota que não alcançaria a guarda.
   */
  if (metodo === 'POST' && raiz === 'titulares' && partes[1] === 'buscar') {
    return buscarTitular<T>(banco, req);
  }

  // Papel sem `escrever` não alcança rota de escrita — inclusive as de auditoria.
  // A exceção que existia aqui para `audit` deixava PATCH /v1/audit/{id} e
  // POST /v1/audit/forjar ao alcance do auditor externo, invertendo o princípio
  // do projeto: quem protegia era a interface (C-02).
  if (metodo !== 'GET' && !pode(papel, 'escrever')) {
    return erro(403, 'Seu papel tem acesso somente de leitura.',
      'Papel sem a ação "escrever" não recebe rota de escrita — nem as de auditoria.') as Res<T>;
  }

  switch (`${metodo} ${raiz}`) {
    // ── REGRA 3 e 4 — revelação de PII ────────────────────────────────────
    case 'POST pseudonyms': {
      if (partes[1] !== 'resolve') break;
      const { titularId, campo, justificativa } = body as { titularId: string; campo: string; justificativa: string };

      if (!pode(papel, 'revelar_pii')) {
        registrarNegativa(banco, ator, papel, campo, 'papel sem permissão de reidentificação');
        return erro(403, 'Seu papel não reidentifica dado pessoal.',
          'Só o DPO tem a ação revelar_pii — e na interface o botão sequer é renderizado.') as Res<T>;
      }
      if (!req.purpose) {
        registrarNegativa(banco, ator, papel, campo, 'sem X-Purpose');
        return erro(403, 'Finalidade não declarada no cabeçalho X-Purpose.',
          'Art. 37: acesso a dado pessoal exige finalidade registrada.') as Res<T>;
      }
      const titular = banco.cenario.titulares.find((t) => t.id === titularId);
      if (!titular) return erro(404, 'Não encontrado.') as Res<T>;

      const meta = titular.campos.find((c) => c.chave === campo);
      if (!meta) return erro(404, 'Não encontrado.') as Res<T>;

      // REGRA 4 — dado sensível não é revelável em tela alguma.
      if (meta.sensivel) {
        registrarNegativa(banco, ator, papel, campo, 'campo sensível');
        return erro(403, `${meta.rotulo} é dado sensível e não é revelável em nenhuma tela.`,
          'Art. 11: dado sensível só existe como prova de que existe, a base legal e a data de destruição.') as Res<T>;
      }
      if (!justificativa || justificativa.trim().length < 20) {
        return erro(422, 'A justificativa precisa de ao menos 20 caracteres.',
          'Justificativa curta não sustenta o acesso em auditoria.') as Res<T>;
      }

      // REGRA 3 — o log vem ANTES da resposta. Se a gravação falha, a resposta falha.
      try {
        banco.auditAppend({
          ator, atorPapel: papel, acao: 'CAMPO_REVELADO', recursoTipo: 'campo',
          recursoId: `${titularId}/${campo}`, finalidade: req.purpose, justificativa, campos: [campo],
        });
      } catch (e) {
        const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar o acesso.';
        return erro(503, msg, 'Sem registro não há revelação: a ordem é gravar, depois responder.') as Res<T>;
      }

      return ok({
        valor: titular.segredos[campo] ?? '—',
        expiraEmSegundos: 60,
        campos: [campo],
      }) as Res<T>;
    }

    // ── REGRA 5 e 6 — escopo e anti-enumeração ────────────────────────────
    case 'GET titulares': {
      const id = partes[1];
      const titular = banco.cenario.titulares.find((t) => t.id === id);
      // REGRA 5 — 404, nunca 403. Um 403 confirmaria que o recurso existe.
      if (!titular || !pode(papel, 'ver_portal_titular')) {
        return erro(404, 'Não encontrado.',
          'Recurso fora do escopo do ator responde 404, não 403 — 403 seria oráculo de existência.') as Res<T>;
      }
      return ok({
        id: titular.id,
        campos: titular.campos,
        compartilhamentos: titular.compartilhamentos,
        decisao: titular.decisao,
      }) as Res<T>;
    }

    case 'GET catalog': {
      const campos = banco.cenario.campos;
      const corpo: { data: Campo[]; hasMore: boolean; totalItems?: number } = { data: campos, hasMore: false };
      // REGRA 6 — totalItems só para papéis confiáveis.
      if (pode(papel, 'ver_total_itens')) corpo.totalItems = campos.length;
      return ok(corpo) as Res<T>;
    }

    // ── REGRA 2 e 8 — validação do inventário ─────────────────────────────
    case 'POST catalog': {
      if (partes[1] !== 'validar') break;
      const c = body as {
        nome: string; tipoArmazenado: TipoArmazenado; categoria: Categoria;
        sensivel: boolean; baseLegal: BaseLegal; internacional?: boolean; mecanismo?: Mecanismo;
      };
      const erros: string[] = [];

      // REGRA 2 — hash de CPF não é anonimização (Art. 12).
      if (c.categoria === 'anonimizado' && c.tipoArmazenado !== 'agregado') {
        erros.push('Categoria "anonimizado" exige agregação com k-anonimato. Hash reverte por força bruta — o espaço de CPFs cabe em horas de GPU.');
      }
      // Art. 11 — dado sensível tem rol fechado de bases legais.
      if (c.sensivel && !BASES_PARA_SENSIVEL.includes(c.baseLegal)) {
        erros.push(`Base legal "${c.baseLegal}" não sustenta dado sensível (Art. 11).`);
      }
      // REGRA 8 — transferência internacional exige mecanismo (Art. 33).
      if (c.internacional && (!c.mecanismo || c.mecanismo === 'nao_aplicavel')) {
        erros.push('Transferência internacional sem mecanismo declarado do Art. 33 (SCC, adequação, normas corporativas ou consentimento específico).');
      }
      if (!c.baseLegal) erros.push('Campo sem base legal não entra no ROPA.');

      return (erros.length
        ? erro(422, erros.join(' '), 'O inventário é recusado inteiro: um campo inválido invalida a versão.')
        : ok({ valido: true })) as Res<T>;
    }

    // ── REGRA 9 — RIPD como gate ──────────────────────────────────────────
    case 'GET gates':
      return ok(banco.cenario.gates) as Res<T>;

    case 'POST ripds': {
      const id = partes[1];
      const acao = partes[2];
      const ripd = banco.cenario.ripds.find((r) => r.id === id);
      if (!ripd) return erro(404, 'Não encontrado.') as Res<T>;

      if (acao === 'aprovar') {
        if (!pode(papel, 'aprovar_ripd')) {
          return erro(403, 'Somente o DPO aprova RIPD.',
            'Na interface o botão de aprovação não é renderizado para outros papéis.') as Res<T>;
        }
        const pendentesP0 = ripd.recomendacoes.filter((r) => r.prioridade === 'P0' && !r.concluida);
        if (pendentesP0.length > 0) {
          return erro(409, `Há ${pendentesP0.length} recomendação P0 em aberto: "${pendentesP0[0].descricao}".`,
            'RIPD não fecha com P0 pendente — seria aprovar o risco, não o tratamento.') as Res<T>;
        }
        ripd.status = 'aprovado';
        // Simula o webhook: o status check do PR volta a verde e o merge libera.
        for (const g of banco.cenario.gates) {
          if (g.ripdId === ripd.id) { g.conclusao = 'success'; g.bloqueouMerge = false; }
        }
        banco.auditAppend({ ator, atorPapel: papel, acao: 'RIPD_APROVADO', recursoTipo: 'ripd', recursoId: ripd.codigo });
        return ok({ status: 'aprovado', prNumero: ripd.prNumero, checkRun: 'success' }) as Res<T>;
      }

      if (acao === 'render') {
        if (!pode(papel, 'gerar_ripd')) {
          return erro(403, 'Somente engenharia gera o RIPD.md.') as Res<T>;
        }
        banco.auditAppend({ ator, atorPapel: papel, acao: 'RIPD_RENDERIZADO', recursoTipo: 'ripd', recursoId: ripd.codigo });
        return ok({ markdown: renderRipd(banco, ripd.id) }) as Res<T>;
      }
      break;
    }

    // ── REGRA 1 — legítimo interesse não cobre dado sensível ──────────────
    case 'POST lias': {
      const id = partes[1];
      const acao = partes[2];
      const lia = banco.cenario.lias.find((l) => l.id === id);
      if (!lia) return erro(404, 'Não encontrado.') as Res<T>;

      if (acao === 'campos') {
        const campoId = String(body.campoId ?? '');
        const campo = banco.cenario.campos.find((c) => c.id === campoId);
        if (!campo) return erro(404, 'Não encontrado.') as Res<T>;
        if (campo.sensivel) {
          return erro(422, `O campo ${campo.nome} é sensível e não pode ser coberto por legítimo interesse.`,
            'Art. 11: dado sensível tem rol fechado de bases legais, e legítimo interesse não está nele.') as Res<T>;
        }
        if (!lia.camposIds.includes(campoId)) lia.camposIds.push(campoId);
        return ok({ camposIds: lia.camposIds }) as Res<T>;
      }

      if (acao === 'assinar') {
        if (!pode(papel, 'assinar_lia')) {
          return erro(403, 'Somente o DPO assina a LIA.') as Res<T>;
        }
        const semJustificativa = lia.alternativas.filter((a) => a.justificativa.trim().length < 20);
        if (semJustificativa.length > 0) {
          return erro(409, `A alternativa "${semJustificativa[0].alternativa}" está sem justificativa suficiente.`,
            '"Não aplicável" também exige justificativa — é a resposta que mais esconde falta de análise.') as Res<T>;
        }
        lia.status = 'vigente';
        lia.assinaturaDpo = `sig:${ator}`;
        banco.auditAppend({ ator, atorPapel: papel, acao: 'LIA_ASSINADA', recursoTipo: 'lia', recursoId: lia.codigo });
        return ok({ status: 'vigente', markdown: renderLia(banco, lia.id) }) as Res<T>;
      }
      break;
    }

    // ── REGRA 7 — audit trail append-only ─────────────────────────────────
    case 'GET audit':
      if (partes[1] === 'verificar') return ok(banco.auditVerificar()) as Res<T>;
      return ok(banco.auditoria) as Res<T>;

    case 'PATCH audit':
    case 'DELETE audit': {
      try {
        if (metodo === 'PATCH') banco.auditAtualizar();
        else banco.auditRemover();
      } catch (e) {
        const msg = e instanceof LogImutavel ? e.message : 'Operação recusada.';
        return erro(409, msg, 'O log é append-only no banco, não por convenção da aplicação.') as Res<T>;
      }
      break;
    }

    case 'POST audit': {
      // `verificar` já foi atendido antes da guarda de escrita, como leitura.
      if (partes[1] === 'forjar') {
        // Simula um DBA comprometido editando o log direto. Duas condições, não
        // uma: fora do modo demonstração a rota não existe, e mesmo dentro dele
        // continua exigindo `escrever` — checado aqui além da guarda de topo,
        // para que reintroduzir uma exceção lá não reabra esta porta.
        if (!banco.modoDemo) {
          return erro(404, 'Rota não encontrada.',
            'A simulação de ataque só existe no modo demonstração.') as Res<T>;
        }
        if (!pode(papel, 'escrever')) {
          return erro(403, 'Seu papel tem acesso somente de leitura.') as Res<T>;
        }
        banco.auditForjar(Number(body.id ?? 2));
        return ok(banco.auditVerificar()) as Res<T>;
      }
      break;
    }

    case 'POST purge': {
      if (partes[2] !== 'verificar') break;
      const run = banco.cenario.expurgos.find((r) => r.id === partes[1]);
      if (!run) return erro(404, 'Não encontrado.') as Res<T>;
      run.entradas.forEach((e) => { e.verificado = true; });
      banco.auditAppend({ ator, atorPapel: papel, acao: 'INTEGRIDADE_VERIFICADA', recursoTipo: 'expurgo_run', recursoId: run.id });
      return ok({ integro: true, lotes: run.entradas.length }) as Res<T>;
    }

    case 'GET kms':
      return ok({ chaves: banco.cenario.chaves, rotacao: banco.cenario.rotacao, acessos: banco.cenario.acessosKms }) as Res<T>;

    case 'PATCH risks': {
      if (!pode(papel, 'gerenciar_risco')) {
        return erro(403, 'Somente o DPO reclassifica risco.') as Res<T>;
      }
      const codigo = partes[1];
      const risco = banco.cenario.riscos.find((r) => r.codigo === codigo);
      if (!risco) return erro(404, 'Não encontrado.') as Res<T>;
      const { probabilidade, impacto, justificativa } = body as { probabilidade: number; impacto: number; justificativa: string };
      if (!justificativa || justificativa.trim().length < 20) {
        return erro(422, 'A reclassificação exige justificativa de ao menos 20 caracteres.',
          'O histórico é imutável: a justificativa fica anexada para sempre.') as Res<T>;
      }
      banco.reclassificacoes.push({
        codigo, de: { p: risco.probabilidade, i: risco.impacto }, para: { p: probabilidade, i: impacto },
        justificativa, ator, quando: new Date().toISOString(),
      });
      risco.probabilidade = probabilidade;
      risco.impacto = impacto;
      banco.auditAppend({ ator, atorPapel: papel, acao: 'RISCO_RECLASSIFICADO', recursoTipo: 'risco', recursoId: codigo });
      return ok({ codigo, probabilidade, impacto }) as Res<T>;
    }

    case 'POST requests': {
      if (partes[2] !== 'mensagens') break;
      const s = banco.cenario.solicitacoes.find((x) => x.id === partes[1]);
      if (!s) return erro(404, 'Não encontrado.') as Res<T>;
      const corpo = String(body.corpo ?? '');
      // O canal recusa CPF em claro — a mesma restrição existe no banco.
      if (/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(corpo)) {
        return erro(422, 'A mensagem contém CPF em texto claro.',
          'O canal entre titular e DPO não transporta documento: use o protocolo.') as Res<T>;
      }
      s.mensagens.push({ remetente: 'dpo', corpo, quando: 'agora' });
      return ok({ enviada: true }) as Res<T>;
    }

    case 'GET requests':
      return ok(banco.cenario.solicitacoes) as Res<T>;

    case 'GET metrics':
      return ok({ metricas: banco.cenario.metricas, maturidade: banco.cenario.maturidade }) as Res<T>;

    default:
      break;
  }

  return erro(404, `Rota não encontrada: ${metodo} ${caminho}`) as Res<T>;
}

/**
 * REGRA 5b — a busca por hash é o mesmo oráculo de existência que o
 * `GET /titulares/{id}` evita, entrando pelo POST (C-01).
 *
 * Ordem deliberada: permissão → finalidade → cota → registro → resposta.
 * A cota vem antes do `find` para que o 429 seja idêntico para hash existente
 * e inexistente; se dependesse do resultado, o limite viraria o oráculo que o
 * 404 acabou de fechar.
 *
 * Exige finalidade, não justificativa: a busca é passo intermediário. A
 * revelação, que é o acesso ao valor, continua exigindo as duas. Pedir prosa a
 * cada busca só produziria justificativa de fachada — o que sustenta esta
 * consulta em auditoria é a finalidade declarada mais o hash truncado no
 * registro.
 */
function buscarTitular<T>(banco: BancoMock, req: Req): Res<T> {
  const { papel, ator } = req;
  // A busca chega com hash. O CPF digitado nunca saiu do navegador.
  const cpfHash = String((req.body as { cpfHash?: string } | undefined)?.cpfHash ?? '');
  const naoEncontrado = erro(404, 'Não encontrado.',
    'Busca fora do escopo do ator responde igual a busca sem resultado — 403 confirmaria a existência.');

  if (!pode(papel, 'buscar_titular')) {
    registrarBuscaNegada(banco, ator, papel, cpfHash, 'papel sem a ação buscar_titular');
    return naoEncontrado as Res<T>;
  }
  if (!req.purpose) {
    registrarBuscaNegada(banco, ator, papel, cpfHash, 'sem X-Purpose');
    return erro(403, 'Finalidade não declarada no cabeçalho X-Purpose.',
      'Art. 37: localizar um titular é operação de tratamento e exige finalidade registrada.') as Res<T>;
  }
  if (!banco.consumirCotaDeBusca(ator)) {
    registrarBuscaNegada(banco, ator, papel, cpfHash, 'limite de taxa excedido');
    return erro(429, 'Limite de 5 buscas por minuto atingido.',
      'Busca em rajada é enumeração, não atendimento.') as Res<T>;
  }

  // Grava antes de responder. Falha de gravação derruba a busca inteira.
  try {
    banco.auditAppend({
      ator, atorPapel: papel, acao: 'TITULAR_BUSCADO', recursoTipo: 'titular',
      recursoId: cpfHash.slice(0, 8), finalidade: req.purpose, campos: ['cpf_hash'],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a busca.';
    return erro(503, msg, 'Sem registro não há busca: a ordem é gravar, depois responder.') as Res<T>;
  }

  const titular = banco.cenario.titulares.find((t) => t.cpfHash === cpfHash);
  if (!titular) return naoEncontrado as Res<T>;
  return ok({ id: titular.id, pseudonimo: `hmac:${cpfHash.slice(0, 4)}…${cpfHash.slice(-4)}` }) as Res<T>;
}

/** A tentativa recusada também entra no trail — negativa sem rastro não é controle. */
function registrarBuscaNegada(banco: BancoMock, ator: string, papel: Papel, cpfHash: string, motivo: string) {
  try {
    banco.auditAppend({
      ator, atorPapel: papel, acao: 'TITULAR_BUSCADO', recursoTipo: 'titular',
      recursoId: (cpfHash ?? '').slice(0, 8), resultado: 'negado', campos: ['cpf_hash'],
      justificativa: motivo,
    });
  } catch { /* a negativa não pode derrubar a resposta de negativa */ }
}

function registrarNegativa(banco: BancoMock, ator: string, papel: Papel, campo: string, motivo: string) {
  try {
    banco.auditAppend({
      ator, atorPapel: papel, acao: 'CAMPO_REVELADO', recursoTipo: 'campo',
      recursoId: campo, resultado: 'negado', campos: [campo], justificativa: motivo,
    });
  } catch { /* a negativa não pode derrubar a resposta de negativa */ }
}

// ── geradores de documento ───────────────────────────────────────────────────

export function renderRipd(banco: BancoMock, ripdId: string): string {
  const r = banco.cenario.ripds.find((x) => x.id === ripdId);
  if (!r) return '';
  const campos = r.camposIds
    .map((id) => banco.cenario.campos.find((c) => c.id === id))
    .filter((c): c is Campo => Boolean(c));

  return `# RIPD — Relatório de Impacto à Proteção de Dados

**Código:** ${r.codigo}
**Projeto:** ${r.titulo}
**PR:** #${r.prNumero} · \`${r.headSha}\`
**Status:** ${r.status}

## 1. Triggers acionados

| Trigger | Critério | Crítico | Evidência |
|---|---|---|---|
${r.triggers.map((t) => `| ${t.codigo} | ${t.categoria} | ${t.critico ? '✅' : '⚠️'} | ${t.evidencias.join('; ')} |`).join('\n')}

## 2. Contexto e escopo

${r.contexto}

**Fora de escopo:** ${r.foraDeEscopo}

## 3. Dados tratados

| Campo | Categoria | Base legal | Retenção |
|---|---|---|---|
${campos.map((c) => `| \`${c.nome}\` | ${c.categoria}${c.sensivel ? ' 🔒' : ''} | ${c.baseLegal}${c.liaCodigo ? ` (${c.liaCodigo})` : ''} | ${c.retencao} |`).join('\n')}

## 4. Fluxo de dados

\`\`\`mermaid
${r.fluxoMermaid}
\`\`\`

## 5. Base legal por operação

| Operação | Finalidade | Base legal | LIA |
|---|---|---|---|
${r.operacoes.map((o) => `| \`${o.operacao}\` | ${o.finalidade} | ${o.baseLegal} | ${o.liaCodigo ?? '—'} |`).join('\n')}

## 6. LINDDUN

| Categoria | Equivalente canônico | Ativa | Mitigação |
|---|---|---|---|
${r.linddun.map((l) => `| ${l.rotulo} | ${l.canonico} | ${l.ativo ? '✅' : '—'} | ${l.ativo ? l.mitigacao : '—'} |`).join('\n')}

## 7. Recomendações

| | Recomendação | Dono | Prazo | Status |
|---|---|---|---|---|
${r.recomendacoes.map((x) => `| ${x.prioridade} | ${x.descricao} | ${x.dono} | ${x.prazo} | ${x.concluida ? 'concluída' : 'aberta'} |`).join('\n')}

## 8. Aprovação

> DPO: ______________________  Data: ___/___/______
>
> Sem aprovação registrada, o status check do PR permanece bloqueado.

---
_Gerado pela plataforma Lastro a partir do template \`parecer-tecnico.md\`._
`;
}

export function renderLia(banco: BancoMock, liaId: string): string {
  const l = banco.cenario.lias.find((x) => x.id === liaId);
  if (!l) return '';
  const veredito = vereditoBalanceamento(l.beneficio, l.danoTitular);
  return `# LIA — Legitimate Interest Assessment

**Código:** ${l.codigo}
**Título:** ${l.titulo}
**Status:** ${l.status} · vigência até ${l.vigenciaFim}
**Hash do documento:** \`${l.documentoHash ?? '—'}\`
**Assinatura:** ${l.assinaturaDpo ?? 'pendente'}

## Passo 1 — Finalidade legítima

Categoria: ${l.categoria}
Expectativa do titular: ${l.expectativa}

${l.finalidade}

## Passo 2 — Necessidade

| Alternativa | Situação | Justificativa |
|---|---|---|
${l.alternativas.map((a) => `| ${a.alternativa} | ${a.situacao} | ${a.justificativa} |`).join('\n')}

## Passo 3 — Balanceamento

Benefício para o controlador: ${l.beneficio}/3 · Dano ao titular: ${l.danoTitular}/3

**Veredito:** ${veredito.titulo} — ${veredito.texto}

## Evidências

| Arquivo | Tipo | Hash |
|---|---|---|
${l.evidencias.map((e) => `| \`${e.arquivo}\` | ${e.tipo} | \`${e.hash}\` |`).join('\n')}

---
_Legítimo interesse não sustenta dado sensível (Art. 11). Se um campo sensível for vinculado a esta LIA, o catálogo recusa a gravação._
`;
}

export function vereditoBalanceamento(beneficio: number, dano: number) {
  const dif = beneficio - dano;
  if (dif >= 2) {
    return { chave: 'sustenta' as const, titulo: 'Sustenta',
      texto: 'O benefício supera o impacto com folga. Mantenha a transparência e o canal de oposição.' };
  }
  if (dif >= 0) {
    return { chave: 'mitigacao' as const, titulo: 'Sustenta com mitigação',
      texto: 'Só enquanto pseudonimização, retenção curta e oposição em um clique continuarem ativas.' };
  }
  return { chave: 'nao' as const, titulo: 'Não sustenta',
    texto: 'O dano ao titular supera o benefício. Reduza escopo, encurte a retenção ou troque a base legal.' };
}
