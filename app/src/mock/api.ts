import { BancoMock, FalhaDeAuditoria, LogImutavel } from './db';
import { pode } from './permissoes';
import { POLITICA_PADRAO, politicaDe } from './politicas';
import { redigir } from '../lib/redator';
import { sha256 } from '../lib/sha256';
import { BASES_PARA_SENSIVEL } from './types';
import type {
  BaseLegal, Campo, Categoria, DesfechoSolicitacao, Finalidade, Mecanismo, Papel,
  ResultadoRevisao, TipoArmazenado,
} from './types';

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
   * A guarda lê a política declarada da rota (`mock/politicas.ts`) em vez de
   * ser desviada por casos especiais. Antes, rotas com necessidade própria
   * saíam antes dela e o motivo ficava na ordem das linhas do `switch` — uma
   * lista de exceções, que cresce. Agora o motivo mora no dado, e a rota sem
   * política declarada é recusada por padrão.
   *
   * Duas consequências que valem nomear:
   *
   * `POST /v1/audit/verificar` é `leitura` porque recomputa hashes e compara,
   * sem mudar uma linha. Desde o PR 3 ela grava `INTEGRIDADE_VERIFICADA`
   * (T6-01) e **continua** leitura, com a ação própria `verificar_integridade`:
   * o registro é consequência do sistema, não escalada do ator. Se tivesse
   * virado escrita, o auditor externo perderia o ato que sustenta o parecer
   * dele. `POST /v1/audit/exportar` segue o mesmo raciocínio (C-06).
   *
   * `POST /v1/titulares/buscar` é `escrita` (grava no trail antes de responder)
   * com `foraDeEscopo: '404_uniforme'`, porque um 403 ali confirmaria que a
   * rota existe e que o pedido só falhou por permissão — o oráculo que a
   * Regra 5 fecha.
   */
  const politica = politicaDe(metodo, partes.join('/')) ?? POLITICA_PADRAO;

  const recusaDeEscopo = (): Res<T> => (politica.foraDeEscopo === '404_uniforme'
    ? erro(404, 'Não encontrado.',
      'Fora de escopo responde igual a inexistente — 403 confirmaria a existência.')
    : erro(403, 'Seu papel não alcança esta operação.',
      `Política da rota: ${politica.nota}`)) as Res<T>;

  if (politica.tipo === 'escrita' && !pode(papel, 'escrever')) {
    registrarRecusaNaGuarda(banco, req, politica.nota);
    return recusaDeEscopo();
  }
  if (politica.acao && !pode(papel, politica.acao)) {
    registrarRecusaNaGuarda(banco, req, politica.nota);
    return recusaDeEscopo();
  }

  /**
   * T6-01 — verificar deixa rastro de quem verificou.
   *
   * Sai antes do `switch` pelo mesmo motivo da busca: a política da rota já foi
   * lida acima, e o corpo aqui é a operação, não um desvio da guarda.
   *
   * O registro vem **antes** do resultado, como manda a Regra 3. Efeito
   * deliberado: duas verificações seguidas não devolvem o mesmo número de
   * blocos, porque a primeira entrou na cadeia. Quem verificou é fato
   * auditável — não é ruído a ser escondido.
   */
  if (metodo === 'POST' && raiz === 'audit' && partes[1] === 'verificar') {
    try {
      banco.auditAppend({
        ator, atorPapel: papel, acao: 'INTEGRIDADE_VERIFICADA',
        recursoTipo: 'audit_log', recursoId: 'cadeia',
      });
    } catch (e) {
      const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a verificação.';
      return erro(503, msg, 'Verificação que não fica registrada não sustenta parecer nenhum.') as Res<T>;
    }
    return ok(banco.auditVerificar()) as Res<T>;
  }

  /**
   * C-06 — exportar o trail é acesso a dado pessoal, e passa a ser tratado como
   * tal. Antes, `exportarCsv()` rodava inteiro no navegador: qualquer papel
   * levava o registro de acessos embora, sem deixar nada para trás.
   */
  if (metodo === 'POST' && raiz === 'audit' && partes[1] === 'exportar') {
    return exportarAuditoria<T>(banco, req);
  }

  if (metodo === 'POST' && raiz === 'titulares' && partes[1] === 'buscar') {
    return buscarTitular<T>(banco, req);
  }

  switch (`${metodo} ${raiz}`) {
    // ── REGRA 3 e 4 — revelação de PII ────────────────────────────────────
    case 'POST pseudonyms': {
      if (partes[1] !== 'resolve') break;
      const { titularId, campo, justificativa, protocolo } = body as {
        titularId: string; campo: string; justificativa: string; protocolo?: string;
      };

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

      /**
       * C-17 — fail-closed: campo exibível que não está no ROPA não é
       * revelável. Se existe caminho de leitura fora do inventário, o
       * inventário deixa de ser a fonte da verdade — que é o que o resto do
       * projeto inteiro sustenta.
       */
      const catalogado = meta.campoCatalogoId
        ? banco.cenario.campos.find((c) => c.id === meta.campoCatalogoId)
        : undefined;
      if (!catalogado) {
        registrarNegativa(banco, ator, papel, campo, 'campo fora do catálogo');
        return erro(422, `O campo ${meta.rotulo} não está no catálogo de dados.`,
          'C-17: campo sem entrada no ROPA não tem finalidade, base legal nem prazo declarados — e por isso não é revelável.') as Res<T>;
      }

      /**
       * C-03 — a finalidade declarada é confrontada com as finalidades
       * catalogadas do campo. Lista vazia significa não revelável, jamais
       * "qualquer uma": campo que nasce sem política não ganha política por
       * omissão.
       */
      if (!catalogado.finalidadesCompativeis.includes(req.purpose)) {
        registrarNegativa(banco, ator, papel, campo, `finalidade ${req.purpose} incompatível`);
        const registradas = catalogado.finalidadesCompativeis.length > 0
          ? `As registradas para ele são: ${catalogado.finalidadesCompativeis.join(', ')}.`
          : 'Ele não tem nenhuma finalidade de acesso registrada.';
        return erro(422,
          `A finalidade "${req.purpose}" não consta no catálogo para ${catalogado.nome}. ${registradas}`,
          'Art. 6º, I: a finalidade do acesso precisa ser uma das declaradas no inventário para aquele campo.') as Res<T>;
      }

      if (!justificativa || justificativa.trim().length < 20) {
        return erro(422, 'A justificativa precisa de ao menos 20 caracteres.',
          'Justificativa curta não sustenta o acesso em auditoria.') as Res<T>;
      }

      /**
       * T4-01 — sem protocolo não há revelação. É o que amarra o acesso ao
       * objeto de trabalho: sem ele, o registro diria quem acessou e por quê,
       * mas não sob qual atendimento — e um acesso sem atendimento é um acesso
       * sem pedido do titular.
       */
      if (!protocolo) {
        registrarNegativa(banco, ator, papel, campo, 'sem protocolo selecionado');
        return erro(422, 'Selecione a solicitação antes de revelar o dado.',
          'T4-01: a revelação acontece sob um protocolo, e é ele que entra no registro.') as Res<T>;
      }
      const solicitacao = banco.cenario.solicitacoes.find((s) => s.protocolo === protocolo);
      if (!solicitacao || solicitacao.titularId !== titularId) {
        registrarNegativa(banco, ator, papel, campo, 'protocolo de outro titular');
        return erro(422, 'O protocolo selecionado não pertence a este titular.',
          'T4-01: revelar sob o protocolo de outra pessoa é o defeito que esta verificação fecha.') as Res<T>;
      }

      // C-04 — a redação acontece antes do append, não na exibição: o trail é
      // imutável, e o que entra nele fica.
      const redacao = redigir(justificativa);

      // REGRA 3 — o log vem ANTES da resposta. Se a gravação falha, a resposta falha.
      try {
        banco.auditAppend({
          ator, atorPapel: papel, acao: 'CAMPO_REVELADO', recursoTipo: 'campo',
          recursoId: `${titularId}/${campo}`, finalidade: req.purpose,
          justificativa: redacao.texto, protocolo, campos: [campo],
        });
      } catch (e) {
        const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar o acesso.';
        return erro(503, msg, 'Sem registro não há revelação: a ordem é gravar, depois responder.') as Res<T>;
      }

      return ok({
        valor: titular.segredos[campo] ?? '—',
        expiraEmSegundos: 60,
        campos: [campo],
        justificativaGravada: redacao.texto,
        houveRedacao: redacao.houveRemocao,
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
        finalidadesCompativeis?: Finalidade[];
      };
      const erros: string[] = [];

      /**
       * C-03, segunda condição fail-closed. A revelação já recusa campo cuja
       * lista de finalidades não cobre o propósito declarado; se a validação do
       * inventário aceitasse campo sem a lista, todo campo novo nasceria sem
       * política e a recusa viraria letra morta na entrada.
       *
       * Lista ausente e lista vazia são coisas diferentes aqui: ausente é erro
       * de preenchimento e é recusada; vazia é declaração deliberada de "não
       * revelável" e passa, porque `includes` de lista vazia é sempre falso.
       */
      if (!Array.isArray(c.finalidadesCompativeis)) {
        erros.push('Campo sem finalidades compatíveis declaradas não entra no ROPA. Para um campo que não deve ser revelado, declare a lista vazia — ausência não é o mesmo que "nenhuma".');
      }

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
      // C-04 — o histórico de reclassificação é imutável pelas mesmas razões que
      // o trail. Redigir antes de guardar, não na hora de exibir.
      banco.reclassificacoes.push({
        codigo, de: { p: risco.probabilidade, i: risco.impacto }, para: { p: probabilidade, i: impacto },
        justificativa: redigir(justificativa).texto, ator, quando: new Date().toISOString(),
      });
      risco.probabilidade = probabilidade;
      risco.impacto = impacto;
      banco.auditAppend({ ator, atorPapel: papel, acao: 'RISCO_RECLASSIFICADO', recursoTipo: 'risco', recursoId: codigo });
      return ok({ codigo, probabilidade, impacto }) as Res<T>;
    }

    /**
     * T4-03 — revisão de decisão automatizada (Art. 20).
     *
     * O direito à revisão não é o direito de ver o seletor: é o direito à
     * decisão revista por alguém que responde por ela. Por isso a rota exige
     * fundamento, grava antes de responder e devolve a resposta ao titular pelo
     * mesmo ato — a devolutiva não fica dependendo de o DPO lembrar de escrever
     * depois.
     */
    case 'POST decisoes': {
      if (partes[2] !== 'revisar') break;
      const titular = banco.cenario.titulares.find((t) => t.decisao?.id === partes[1]);
      const decisao = titular?.decisao;
      if (!titular || !decisao) return erro(404, 'Não encontrado.') as Res<T>;
      if (decisao.revisao) {
        return erro(409, 'Esta decisão já foi revisada.',
          'A revisão é ato único e registrado: rever de novo é solicitação nova do titular.') as Res<T>;
      }

      const resultado = String(body.resultado ?? '') as ResultadoRevisao;
      if (!['mantida', 'revertida', 'ajustada'].includes(resultado)) {
        return erro(422, 'Resultado de revisão inválido.') as Res<T>;
      }
      // Manter o resultado do modelo também é decisão humana, e também precisa
      // de razão: sem ela a revisão é homologação com outro nome.
      if (String(body.fundamento ?? '').trim().length < 20) {
        return erro(422, 'A revisão exige fundamento de ao menos 20 caracteres.',
          'Art. 20, §1º: o titular pode pedir os critérios da decisão — fundamento vazio não é critério.') as Res<T>;
      }

      const fundamento = redigir(String(body.fundamento)).texto;
      const solicitacao = banco.cenario.solicitacoes.find(
        (s) => s.titularId === titular.id && s.direito === 'revisao_decisao',
      );
      try {
        banco.auditAppend({
          ator, atorPapel: papel, acao: 'DECISAO_REVISADA', recursoTipo: 'decisao_automatizada',
          recursoId: decisao.id, protocolo: solicitacao?.protocolo,
          justificativa: fundamento, campos: [resultado],
        });
      } catch (e) {
        const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a revisão.';
        return erro(503, msg, 'Sem prova no trail, a revisão não aconteceu.') as Res<T>;
      }

      decisao.revisao = { resultado, fundamento, revisadaPor: ator, quando: new Date().toISOString() };
      if (resultado === 'revertida') decisao.aprovado = !decisao.aprovado;
      // A devolutiva sai do mesmo ato — o titular não depende de uma segunda ação.
      solicitacao?.mensagens.push({
        remetente: 'dpo',
        corpo: `Revisão concluída: decisão ${resultado}. Fundamento: ${fundamento}`,
        quando: 'agora',
      });
      return ok({
        decisaoId: decisao.id, resultado, aprovado: decisao.aprovado,
        devolutivaEnviada: Boolean(solicitacao),
      }) as Res<T>;
    }

    /**
     * T4-02 — o ato que para o cronômetro. Sem ele, o SLA corre para sempre e
     * a fila nunca fecha: a tela media prazo de coisas que ninguém podia
     * terminar.
     */
    case 'POST requests': {
      if (partes[2] === 'concluir') {
        const s = banco.cenario.solicitacoes.find((x) => x.id === partes[1] || x.protocolo === partes[1]);
        if (!s) return erro(404, 'Não encontrado.') as Res<T>;
        if (s.status === 'concluida') {
          return erro(409, `O protocolo ${s.protocolo} já foi concluído.`) as Res<T>;
        }

        const desfecho = String(body.desfecho ?? '') as DesfechoSolicitacao;
        const evidencia = String(body.evidencia ?? '');
        if (!['atendido', 'atendido_parcialmente', 'recusado_com_fundamento'].includes(desfecho)) {
          return erro(422, 'Desfecho inválido.') as Res<T>;
        }
        // Recusar exige fundamento: negar um direito sem dizer por quê não é
        // decisão, é silêncio com aparência de decisão.
        if (desfecho === 'recusado_com_fundamento' && evidencia.trim().length < 20) {
          return erro(422, 'Recusa exige fundamento de ao menos 20 caracteres.',
            'Art. 18, §4º: a negativa é comunicada com a razão — sem ela o titular não tem o que contestar.') as Res<T>;
        }

        const fundamento = redigir(evidencia).texto;
        try {
          banco.auditAppend({
            ator, atorPapel: papel, acao: 'SOLICITACAO_CONCLUIDA', recursoTipo: 'solicitacao',
            recursoId: s.protocolo, protocolo: s.protocolo, justificativa: fundamento,
            campos: [desfecho],
          });
        } catch (e) {
          const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a conclusão.';
          return erro(503, msg, 'Sem registro não há conclusão.') as Res<T>;
        }

        const agora = Date.now();
        s.status = desfecho === 'recusado_com_fundamento' ? 'recusada' : 'concluida';
        s.desfecho = desfecho;
        s.fundamento = fundamento;
        s.concluidaEmMs = agora;
        s.concluidaEm = new Date(agora).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        return ok({ protocolo: s.protocolo, status: s.status, dentroDoPrazo: agora <= s.prazoLimiteMs }) as Res<T>;
      }
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

/**
 * C-06 — exportação do audit trail.
 *
 * Três decisões, todas do mesmo princípio de que o export é um ato e não um
 * download:
 *
 * 1. **Grava antes de gerar.** Se o registro falha, o arquivo não existe.
 * 2. **O registro guarda papel, filtro e contagem.** Exportar 4 linhas
 *    filtradas e exportar 900 são atos diferentes, e o trail precisa
 *    distinguir os dois — senão a evidência do export não sustenta pergunta
 *    nenhuma seis meses depois.
 * 3. **Mesma anti-enumeração das telas.** O papel sem `ver_total_itens` recebe
 *    as linhas do recorte e nenhuma contagem do universo: `totalNoTrail` é
 *    omitido, exatamente como `totalItems` no catálogo (Regra 6). Exportar não
 *    é porta lateral para o total que a tela nega.
 */
function exportarAuditoria<T>(banco: BancoMock, req: Req): Res<T> {
  const { papel, ator } = req;
  const filtro = String((req.body as { filtro?: string } | undefined)?.filtro ?? '').trim();
  const alvo = filtro
    ? banco.auditoria.filter((l) => [l.ator, l.acao, l.recursoId, l.finalidade ?? '']
      .join(' ').toLowerCase().includes(filtro.toLowerCase()))
    : banco.auditoria;

  try {
    banco.auditAppend({
      ator, atorPapel: papel, acao: 'AUDIT_EXPORTADO', recursoTipo: 'audit_log',
      recursoId: filtro ? `filtro:${filtro}` : 'trail_completo',
      campos: [`linhas=${alvo.length}`, `papel=${papel}`],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a exportação.';
    return erro(503, msg, 'Sem registro não há exportação: o export é um acesso como outro qualquer.') as Res<T>;
  }

  const linhas = alvo.map((l) => [
    l.id, l.ocorridoEm, l.ator, l.atorPapel, l.acao,
    `${l.recursoTipo}/${l.recursoId}`, l.finalidade ?? '-', l.protocolo ?? '-', l.resultado, l.hash,
  ].join(','));
  const corpo = ['id,ocorrido_em,ator,papel,acao,recurso,finalidade,protocolo,resultado,hash', ...linhas].join('\n');
  // O arquivo carrega o próprio hash: a auditoria de 2029 confere o CSV de 2026
  // sem depender de quem o guardou.
  const hashArquivo = sha256(corpo);
  const csv = `${corpo}\n# linhas=${alvo.length} exportadas por ${ator} (${papel})\n# sha256=${hashArquivo}`;

  const resposta: { csv: string; linhas: number; hashArquivo: string; totalNoTrail?: number } = {
    csv, linhas: alvo.length, hashArquivo,
  };
  // REGRA 6 — a contagem do universo só vai para papel confiável.
  if (pode(papel, 'ver_total_itens')) resposta.totalNoTrail = banco.auditoria.length;
  return ok(resposta) as Res<T>;
}

/** A guarda recusou o pedido: registra sem deixar a negativa derrubar a resposta. */
function registrarRecusaNaGuarda(banco: BancoMock, req: Req, politicaNota: string) {
  if (req.metodo === 'POST' && req.caminho.includes('titulares/buscar')) {
    const cpfHash = String((req.body as { cpfHash?: string } | undefined)?.cpfHash ?? '');
    registrarBuscaNegada(banco, req.ator, req.papel, cpfHash, 'papel sem a ação buscar_titular');
    return;
  }
  if (req.metodo === 'POST' && req.caminho.includes('pseudonyms/resolve')) {
    const campo = String((req.body as { campo?: string } | undefined)?.campo ?? '—');
    registrarNegativa(banco, req.ator, req.papel, campo, 'papel sem permissão de reidentificação');
    return;
  }
  void politicaNota;
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
