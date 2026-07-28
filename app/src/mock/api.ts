import { BancoMock, FalhaDeAuditoria, LogImutavel } from './db';
import { pode } from './permissoes';
import { POLITICA_PADRAO, politicaDe } from './politicas';
import { ARTEFATOS, estadosDe, motivoDaRecusa, transicaoPermitida } from './estados';
import type { Artefato, EstadoDe } from './estados';
import {
  CATEGORIAS, TABELAS, TABELAS_IDS, aplicar, gatilhoCritico, rotuloDoGatilho, ultimaDecisao, vigenteDe,
} from './decisoes';
import type { DecisaoRegistrada, TabelaId, Valor } from './decisoes';
import { contadoresDe, derivarFila, minhaFila } from './fila';
import { redigir } from '../lib/redator';
import { sha256 } from '../lib/sha256';
import { BASES_PARA_SENSIVEL } from './types';
import type {
  BaseLegal, Campo, Categoria, DecisaoIncidente, DesfechoSolicitacao, EstadoIncidente,
  Finalidade, Incidente, Mecanismo, Papel, ResultadoRevisao, TipoArmazenado,
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

      /**
       * C-08 — a revogação propaga até aqui. Campo cuja base legal é
       * consentimento e cujo registro foi revogado deixa de ser revelável: o
       * tratamento perdeu fundamento no instante da revogação, e continuar
       * mostrando o valor faria da revogação um rótulo.
       */
      if (catalogado.baseLegal === 'consentimento' && !consentimentoVigente(banco, catalogado.id)) {
        registrarNegativa(banco, ator, papel, campo, 'consentimento revogado');
        return erro(422, `O consentimento de ${catalogado.nome} foi revogado: o campo não é mais tratável.`,
          'Art. 8º, §5º e Art. 18, VIII: revogado o consentimento, cessa o tratamento que dependia dele.') as Res<T>;
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
        finalidadesCompativeis?: Finalidade[]; campoId?: string;
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

      /**
       * C-08 — mesma lógica que já vale para legítimo interesse sem LIA: a base
       * só é aceita com a prova viva. Consentimento declarado sem registro
       * vigente é afirmação sobre a vontade de alguém que ninguém consultou.
       */
      if (c.baseLegal === 'consentimento') {
        const registro = c.campoId ? consentimentoVigente(banco, c.campoId) : null;
        if (!registro) {
          erros.push('Base legal "consentimento" exige registro de consentimento vigente — com texto, versão, canal e hash. '
            + 'Sem ele, ou com ele revogado, o campo não entra no ROPA.');
        }
      }

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
        ripd.status = 'vigente';
        // Simula o webhook: o status check do PR volta a verde e o merge libera.
        for (const g of banco.cenario.gates) {
          if (g.ripdId === ripd.id) { g.conclusao = 'success'; g.bloqueouMerge = false; }
        }
        banco.auditAppend({ ator, atorPapel: papel, acao: 'RIPD_APROVADO', recursoTipo: 'ripd', recursoId: ripd.codigo });
        return ok({ status: ripd.status, prNumero: ripd.prNumero, checkRun: 'success' }) as Res<T>;
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
     * PR 7 — `POST /v1/estados/{artefato}/{id}` com `{ para, … }`.
     *
     * Uma rota para os oito artefatos. Não existe rota de transição por
     * artefato, e é isso que impede um caminho especial de nascer: quem
     * precisar mover qualquer coisa passa pela mesma porta e pela mesma tabela.
     */
    case 'POST estados': {
      const artefato = partes[1] as Artefato;
      if (!ARTEFATOS.includes(artefato)) {
        return erro(404, `Artefato desconhecido: ${partes[1]}.`) as Res<T>;
      }
      const alvo = alvoDaTransicao(banco, artefato, partes[2] ?? '', body);
      if (!alvo) return erro(404, 'Não encontrado.') as Res<T>;

      const para = String(body.para ?? '');
      if (!estadosDe(artefato).includes(para as never)) {
        return erro(422, `"${para}" não é estado de ${artefato}.`,
          `Os estados declarados são: ${estadosDe(artefato).join(', ')}.`) as Res<T>;
      }
      return transitar<T>(banco, req, alvo, para);
    }

    /**
     * PR 8 — as três tabelas de decisão (`MAPA-PROCESSOS.md §3`).
     *
     * Raiz própria e não `decisoes`, que já é a decisão automatizada do Art. 20
     * — duas coisas diferentes com o mesmo nome na URL é como um oráculo nasce
     * por descuido.
     */
    /**
     * PR 9 — T0 · a fila derivada.
     *
     * Sem parâmetro nenhum, e isso é desenho: a fila é **a sua**, definida pelo
     * papel da sessão. Um filtro aqui abriria caminho para consultar a fila de
     * outro papel por combinação, que é o oráculo que a `deOutrosPapeis` fecha
     * ao devolver contagem em vez de lista.
     *
     * Não grava no trail: nada de dado pessoal sai daqui — os itens carregam
     * código de artefato, e o protocolo é o código da solicitação, nunca o
     * titular.
     */
    case 'GET fila': {
      // Um segmento a mais é rota que não existe, e não um recorte silencioso:
      // `/v1/fila/dpo` precisa cair no 404 do fim, não devolver a fila de quem
      // perguntou como se o caminho tivesse sido entendido.
      if (partes[1]) break;
      const todos = derivarFila(banco.cenario, Date.now());
      return ok({
        itens: minhaFila(todos, papel),
        contadores: contadoresDe(todos, papel),
      }) as Res<T>;
    }

    case 'GET dmn':
      return ok(catalogoDmn()) as Res<T>;

    case 'POST dmn': {
      const tabela = partes[1] as TabelaId;
      if (!TABELAS_IDS.includes(tabela)) {
        return erro(404, `Tabela de decisão desconhecida: ${partes[1]}.`) as Res<T>;
      }
      if (partes[2] !== 'aplicar') break;
      return aplicarTabela<T>(banco, req, tabela, String(body.id ?? ''));
    }

    // ── C-07 — incidente de segurança (Art. 48) ───────────────────────────
    case 'GET incidentes':
      return ok(banco.cenario.incidentes) as Res<T>;

    case 'POST incidentes': {
      if (!partes[1]) return abrirIncidente<T>(banco, req);
      const inc = banco.cenario.incidentes.find((i) => i.id === partes[1]);
      if (!inc) return erro(404, 'Não encontrado.') as Res<T>;

      switch (partes[2]) {
        case 'conter': return conterIncidente<T>(banco, req, inc);
        case 'decisao': return decidirIncidente<T>(banco, req, inc);
        case 'comunicar': return efetivarIncidente<T>(banco, req, inc, 'comunicado');
        case 'registrar-nao-comunicacao': return efetivarIncidente<T>(banco, req, inc, 'nao_comunicado');
        case 'encerrar': return encerrarIncidente<T>(banco, req, inc);
        default: break;
      }
      break;
    }

    case 'GET risks':
      return ok(banco.cenario.riscos) as Res<T>;

    // ── T7-01 — a T7 informava muito bem e não deixava fazer nada ────────
    case 'POST kms': {
      const chave = banco.cenario.chaves.find((c) => c.alias === decodeURIComponent(partes[1] ?? ''));
      if (!chave) return erro(404, 'Não encontrado.') as Res<T>;

      if (partes[2] === 'agendar-rotacao') {
        if (chave.status === 'revogada') {
          return erro(409, `${chave.alias} está revogada: rotacionar uma chave morta não devolve acesso a nada.`) as Res<T>;
        }
        try {
          banco.auditAppend({
            ator, atorPapel: papel, acao: 'ROTACAO_AGENDADA', recursoTipo: 'chave_kms',
            recursoId: chave.alias, campos: [`em_dias=${chave.rotacaoEmDias ?? '-'}`],
          });
        } catch (e) {
          const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar o agendamento.';
          return erro(503, msg) as Res<T>;
        }
        chave.rotacaoEmDias = 1;
        return ok({ alias: chave.alias, rotacaoEmDias: chave.rotacaoEmDias }) as Res<T>;
      }

      if (partes[2] === 'promover-canary') {
        // A promoção é do pipeline, não do botão: só avança se a recriptografia
        // terminou. Promover no meio deixa registro ilegível com a chave nova.
        const recripto = banco.cenario.rotacao.etapas.find((e) => e.etapa === 'recriptografar');
        if (recripto && recripto.status !== 'concluida') {
          return erro(409, `A recriptografia está em ${recripto.progresso.toFixed(1)}%.`,
            'Promover canary antes do fim deixa registros ilegíveis: os dois aliases precisam continuar válidos até o último byte migrar.') as Res<T>;
        }
        const canary = banco.cenario.rotacao.etapas.find((e) => e.etapa === 'canary_5');
        try {
          banco.auditAppend({
            ator, atorPapel: papel, acao: 'CANARY_PROMOVIDO', recursoTipo: 'chave_kms', recursoId: chave.alias,
          });
        } catch (e) {
          const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a promoção.';
          return erro(503, msg) as Res<T>;
        }
        if (canary) { canary.status = 'concluida'; canary.progresso = 100; }
        chave.status = 'ativa';
        return ok({ alias: chave.alias, status: chave.status }) as Res<T>;
      }
      break;
    }

    // ── C-08 — consentimento como prova, e revogação que propaga ──────────
    case 'GET consentimentos':
      return ok(banco.cenario.consentimentos) as Res<T>;

    case 'POST consentimentos': {
      if (partes[2] !== 'revogar') break;
      return revogarConsentimento<T>(banco, req, partes[1]);
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
        s.status = desfecho === 'recusado_com_fundamento' ? 'recusada_com_fundamento' : 'concluida';
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
 * PR 7 — a rota única de transição.
 *
 * Um caminho para os oito artefatos, na ordem que o PR 4 fixou:
 *
 *   1. **sequência** — a tabela de `estados.ts` decide. Fora dela, 409.
 *   2. **conteúdo** — o que o MAPA exige *daquela* transição. Faltando, 422.
 *   3. **registro** — `auditAppend` antes de aplicar. Falhando, 503 e o estado
 *      não muda.
 *
 * A validação de conteúdo mora aqui e não em `estados.ts` de propósito: a
 * tabela não sabe o que é justificativa, dono ou gatilho, e não deve saber.
 */
type Alvo = { artefato: Artefato; id: string; estado: string; aplicar: () => void };

/** O que cada transição exige além de ser legal. Vazio = só a sequência. */
function exigenciasDe(
  artefato: Artefato, de: string, para: string, body: Record<string, any>,
): string | null {
  const texto = (chave: string) => String(body[chave] ?? '').trim();

  if (artefato === 'ripd' && para === 'dispensado') {
    if (texto('justificativa').length < 20) {
      return 'Dispensar o RIPD exige justificativa de ao menos 20 caracteres — dispensa sem registro é omissão, não decisão.';
    }
    if (!texto('gatilhoDeReabertura')) {
      return 'Dispensa exige gatilho de reabertura declarado: sem ele, a dispensa vale para sempre e ninguém revisita.';
    }
  }
  if (artefato === 'risco' && para === 'aceito') {
    if (!texto('donoDaAceitacao')) return 'Aceitar um risco exige dono declarado — risco aceito sem dono volta como surpresa.';
    if (!texto('prazoDeReavaliacao')) return 'Aceitar um risco exige prazo de reavaliação.';
    if (!texto('gatilhoDeReabertura')) return 'Aceitar um risco exige gatilho de reabertura.';
  }
  if (artefato === 'solicitacao' && para === 'recusada_com_fundamento' && texto('fundamento').length < 20) {
    return 'Recusar um direito exige fundamento legal de ao menos 20 caracteres (Art. 18, §4º).';
  }
  if (artefato === 'achado' && para === 'verificado' && !texto('verificadoPor')) {
    return 'A verificação de eficácia é independente: declare quem verificou.';
  }
  if (artefato === 'parecer' && para === 'devolvido' && texto('motivo').length < 20) {
    return 'Devolver o parecer exige motivo de ao menos 20 caracteres — devolução sem motivo é ida e volta sem aprendizado.';
  }
  if (de === para) return null;
  return null;
}

export function transitar<T>(
  banco: BancoMock, req: Req, alvo: Alvo, para: string,
): Res<T> {
  const body = (req.body ?? {}) as Record<string, any>;

  // 1 · sequência
  const fora = guardaDeSequencia<Artefato, T>(
    alvo.artefato, `${alvo.artefato} ${alvo.id}`,
    alvo.estado as never, para as never,
  );
  if (fora) return fora;

  // 2 · conteúdo
  const faltando = exigenciasDe(alvo.artefato, alvo.estado, para, body);
  if (faltando) {
    return erro(422, faltando,
      `A transição ${alvo.estado} → ${para} é legal; o que falta é o conteúdo que a sustenta.`) as Res<T>;
  }

  // 3 · registro antes de aplicar
  try {
    banco.auditAppend({
      ator: req.ator, atorPapel: req.papel, acao: 'ESTADO_TRANSICIONADO',
      recursoTipo: alvo.artefato, recursoId: alvo.id,
      justificativa: body.justificativa || body.fundamento || body.motivo
        ? redigir(String(body.justificativa ?? body.fundamento ?? body.motivo)).texto
        : undefined,
      campos: [`${alvo.estado}→${para}`],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a transição.';
    return erro(503, msg, 'Sem registro não há transição: a ordem é gravar, depois mover.') as Res<T>;
  }

  alvo.aplicar();
  return ok({ artefato: alvo.artefato, id: alvo.id, de: alvo.estado, para }) as Res<T>;
}

/**
 * Resolve o artefato pedido. É o único lugar que sabe onde cada estado está
 * guardado — e é o que permite a rota de transição ser genérica de verdade.
 */
function alvoDaTransicao(banco: BancoMock, artefato: Artefato, id: string, body: Record<string, any>): Alvo | null {
  const c = banco.cenario;
  switch (artefato) {
    case 'parecer': {
      const x = c.pareceres.find((p) => p.id === id || p.codigo === id);
      return x ? { artefato, id: x.codigo, estado: x.status, aplicar: () => {
        const para = String(body.para);
        if (para === 'devolvido') x.devolucoes += 1;
        x.status = para as typeof x.status;
      } } : null;
    }
    case 'ripd': {
      const x = c.ripds.find((r) => r.id === id || r.codigo === id);
      return x ? { artefato, id: x.codigo, estado: x.status, aplicar: () => { x.status = String(body.para) as typeof x.status; } } : null;
    }
    case 'lia': {
      const x = c.lias.find((l) => l.id === id || l.codigo === id);
      return x ? { artefato, id: x.codigo, estado: x.status, aplicar: () => { x.status = String(body.para) as typeof x.status; } } : null;
    }
    case 'risco': {
      const x = c.riscos.find((r) => r.codigo === id);
      return x ? { artefato, id: x.codigo, estado: x.status, aplicar: () => {
        const para = String(body.para);
        if (para === 'aceito') {
          x.donoDaAceitacao = String(body.donoDaAceitacao);
          x.prazoDeReavaliacao = String(body.prazoDeReavaliacao);
          x.gatilhoDeReabertura = String(body.gatilhoDeReabertura);
        }
        x.status = para as typeof x.status;
      } } : null;
    }
    case 'solicitacao': {
      const x = c.solicitacoes.find((s) => s.id === id || s.protocolo === id);
      return x ? { artefato, id: x.protocolo, estado: x.status, aplicar: () => { x.status = String(body.para) as typeof x.status; } } : null;
    }
    case 'achado': {
      const x = c.achados.find((a) => a.id === id || a.codigo === id);
      return x ? { artefato, id: x.codigo, estado: x.status, aplicar: () => {
        const para = String(body.para);
        if (para === 'reaberto') {
          // O MAPA é explícito: reaberto entra com criticidade elevada e conta
          // como reincidência. Achado que volta não volta igual.
          x.reincidencias += 1;
          x.criticidade = x.criticidade === 'critica' ? 'critica'
            : x.criticidade === 'alta' ? 'critica'
              : x.criticidade === 'media' ? 'alta' : 'media';
        }
        if (para === 'verificado') x.verificadoPor = String(body.verificadoPor);
        x.status = para as typeof x.status;
      } } : null;
    }
    case 'incidente': {
      const x = c.incidentes.find((i) => i.id === id);
      return x ? { artefato, id: x.id, estado: x.estado, aplicar: () => { x.estado = String(body.para) as typeof x.estado; } } : null;
    }
    case 'chave': {
      const x = c.chaves.find((k) => k.alias === decodeURIComponent(id));
      return x ? { artefato, id: x.alias, estado: x.status, aplicar: () => { x.status = String(body.para) as typeof x.status; } } : null;
    }
    default:
      return null;
  }
}

/**
 * PR 8 — D1, D2 e D3 aplicadas.
 *
 * Aqui mora a **validação**; a verificação está em `decisoes.ts`. A divisão tem
 * consequência prática: quando uma decisão sai errada, o 422 diz que a entrada
 * não podia vir daquele artefato, e não que a tabela está torta.
 *
 * A regra que sustenta a reprodutibilidade é uma só: **as entradas são lidas do
 * artefato, nunca digitadas**. Entrada digitada faz a decisão descrever um
 * mundo que o catálogo desconhece — o mesmo problema do escopo do incidente no
 * C-07 — e transforma "reproduzível" em promessa sem lastro.
 */
function catalogoDmn() {
  return {
    tabelas: TABELAS_IDS.map((id) => {
      const t = TABELAS[id];
      return {
        id: t.id, titulo: t.titulo, pergunta: t.pergunta, sobre: t.sobre,
        vigente: vigenteDe(id).versao,
        versoes: t.versoes.map((v) => ({
          versao: v.versao, vigenciaInicio: v.vigenciaInicio, nota: v.nota, regras: v.regras.length,
        })),
      };
    }),
  };
}

/** A categoria mais restritiva entre os campos do artefato — nunca a média. */
const categoriaMaisRestritiva = (campos: Campo[]): string | undefined =>
  campos.reduce<string | undefined>((pior, c) => (
    pior === undefined || CATEGORIAS.indexOf(c.categoria) > CATEGORIAS.indexOf(pior) ? c.categoria : pior
  ), undefined);

type AlvoDeDecisao = {
  rotulo: string;
  entradas: Record<string, Valor | undefined>;
  gravar: (d: DecisaoRegistrada) => void;
};

function alvoDaDecisao(banco: BancoMock, tabela: TabelaId, id: string): AlvoDeDecisao | null {
  const c = banco.cenario;

  if (tabela === 'd1' || tabela === 'd3') {
    const ripd = c.ripds.find((r) => r.id === id || r.codigo === id);
    if (!ripd) return null;
    const campos = ripd.camposIds
      .map((cid) => c.campos.find((x) => x.id === cid))
      .filter((x): x is Campo => Boolean(x));
    const gatilhos = ripd.triggers.map((t) => t.codigo);

    if (tabela === 'd1') {
      return {
        rotulo: ripd.codigo,
        entradas: {
          categoria: categoriaMaisRestritiva(campos),
          volumeTitulares: ripd.volumeTitulares,
          // Decisão automatizada e remessa internacional não são digitadas: uma
          // sai da triagem, a outra do inventário de compartilhamentos.
          decisaoAutomatizada: gatilhos.includes('T3'),
          transferenciaInternacional: campos.some((x) => x.compartilhamentos.some((s) => s.internacional)),
        },
        gravar: (d) => { ripd.decisoes = [...(ripd.decisoes ?? []), d]; },
      };
    }
    return {
      rotulo: ripd.codigo,
      entradas: {
        gatilhos,
        gatilhosCriticos: gatilhos.filter(gatilhoCritico).length,
        gatilhosTotal: gatilhos.length,
      },
      gravar: (d) => { ripd.decisoes = [...(ripd.decisoes ?? []), d]; },
    };
  }

  const risco = c.riscos.find((r) => r.codigo === id);
  if (!risco) return null;
  return {
    rotulo: risco.codigo,
    entradas: {
      probabilidade: risco.probabilidade,
      impacto: risco.impacto,
      score: risco.probabilidade * risco.impacto,
    },
    gravar: (d) => { risco.decisoes = [...(risco.decisoes ?? []), d]; },
  };
}

function aplicarTabela<T>(banco: BancoMock, req: Req, tabela: TabelaId, id: string): Res<T> {
  const body = (req.body ?? {}) as Record<string, any>;
  if (body.entradas !== undefined || body.saida !== undefined || body.versao !== undefined) {
    return erro(422, 'As entradas de uma decisão são lidas do artefato, nunca enviadas no pedido.',
      'Decisão com entrada digitada não é reproduzível: ela descreve o que quem clicou disse, não o que o artefato é.') as Res<T>;
  }

  const alvo = alvoDaDecisao(banco, tabela, id);
  if (!alvo) return erro(404, 'Não encontrado.') as Res<T>;

  // A versão aplicada é sempre a vigente. Pinar versão antiga por pedido seria
  // dar a quem clica a escolha de qual regra o julga.
  const decisao = aplicar(tabela, alvo.entradas);

  try {
    banco.auditAppend({
      ator: req.ator, atorPapel: req.papel, acao: 'DECISAO_APLICADA',
      recursoTipo: tabela, recursoId: alvo.rotulo,
      justificativa: decisao.frase,
      campos: [`${tabela}@${decisao.versao}`, ...Object.entries(decisao.saida).map(([k, v]) => `${k}=${v}`)],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a decisão.';
    return erro(503, msg, 'Sem registro não há decisão: a versão aplicada precisa estar selada antes de valer.') as Res<T>;
  }

  const registrada: DecisaoRegistrada = { ...decisao, quando: new Date().toISOString() };
  alvo.gravar(registrada);
  return ok(registrada) as Res<T>;
}

/**
 * C-07 — incidente de segurança (Art. 48).
 *
 * As cinco funções abaixo compartilham uma disciplina: **a sequência é
 * verificada antes do conteúdo**, e as duas falham com códigos diferentes.
 *
 * - **409** quando o passo está fora de ordem. É problema de sequência: o
 *   pedido pode estar impecável e ainda assim ser cedo demais.
 * - **422** quando o passo é legal mas o conteúdo não satisfaz o artigo —
 *   fundamento ausente, curto, decisão fora do vocabulário.
 *
 * Trocar os dois códigos é o defeito comum: devolver 422 para quem pulou a
 * contenção manda a pessoa reescrever um texto que já estava bom.
 */
/**
 * O guarda de sequência, único para os oito artefatos.
 *
 * Não existe versão por artefato: quem quiser mover qualquer coisa passa por
 * aqui, e quem decide é a tabela de `mock/estados.ts`. Um caminho especial
 * escrito à mão em qualquer rota quebraria o teste que percorre todos os pares
 * de estados de todas as máquinas.
 */
export function guardaDeSequencia<A extends Artefato, T>(
  artefato: A, id: string, de: EstadoDe<A>, para: EstadoDe<A>,
): Res<T> | null {
  if (transicaoPermitida(artefato, de, para)) return null;
  return erro(409, `${id} está em "${de}".`, motivoDaRecusa(artefato, de, para)) as Res<T>;
}

const guardaDeTransicao = <T>(inc: Incidente, para: EstadoIncidente): Res<T> | null =>
  guardaDeSequencia<'incidente', T>('incidente', `O incidente ${inc.id}`, inc.estado, para);

function abrirIncidente<T>(banco: BancoMock, req: Req): Res<T> {
  const { papel, ator } = req;
  const body = (req.body ?? {}) as Record<string, any>;
  const camposIds: string[] = Array.isArray(body.camposIds) ? body.camposIds.map(String) : [];

  if (camposIds.length === 0) {
    return erro(422, 'Um incidente sem escopo não é um incidente: informe os campos atingidos.',
      'Art. 48: a comunicação descreve a natureza dos dados afetados.') as Res<T>;
  }
  /**
   * O escopo é **lido do catálogo**, nunca digitado. Campo fora do ROPA não
   * entra no incidente pelo mesmo motivo do C-17: se o inventário não conhece
   * o dado, ninguém sabe a base legal, o prazo nem quem responde por ele — e a
   * comunicação ao titular sairia descrevendo um universo inventado.
   */
  const forasDoCatalogo = camposIds.filter((id) => !banco.cenario.campos.some((c) => c.id === id));
  if (forasDoCatalogo.length > 0) {
    return erro(422, `Fora do catálogo: ${forasDoCatalogo.join(', ')}.`,
      'O escopo do incidente é lido do inventário. Campo que o ROPA desconhece não tem base legal nem dono para responder por ele.') as Res<T>;
  }

  const id = `INC-${new Date().getFullYear()}-${String(banco.cenario.incidentes.length + 4).padStart(3, '0')}`;
  const incidente: Incidente = {
    id,
    estado: 'aberto',
    detectadoEm: new Date().toISOString(),
    origem: redigir(String(body.origem ?? 'registro manual')).texto,
    camposIds,
    titularesEstimados: Number(body.titularesEstimados ?? 0),
    riscoCodigo: body.riscoCodigo ? String(body.riscoCodigo) : undefined,
  };

  try {
    banco.auditAppend({
      ator, atorPapel: papel, acao: 'INCIDENTE_ABERTO', recursoTipo: 'incidente',
      recursoId: id, campos: camposIds,
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a abertura.';
    return erro(503, msg, 'Incidente que não entra no trail não existe para a fiscalização.') as Res<T>;
  }

  banco.cenario.incidentes.push(incidente);
  return ok(incidente, 201) as Res<T>;
}

function conterIncidente<T>(banco: BancoMock, req: Req, inc: Incidente): Res<T> {
  const recusa = guardaDeTransicao<T>(inc, 'contido');
  if (recusa) return recusa;

  const nota = redigir(String((req.body as { nota?: string } | undefined)?.nota ?? '')).texto;
  try {
    banco.auditAppend({
      ator: req.ator, atorPapel: req.papel, acao: 'INCIDENTE_CONTIDO', recursoTipo: 'incidente',
      recursoId: inc.id, justificativa: nota || undefined,
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a contenção.';
    return erro(503, msg, 'Sem registro não há contenção comprovável.') as Res<T>;
  }

  inc.estado = 'contido';
  inc.contidoPor = req.ator;
  return ok({ id: inc.id, estado: inc.estado }) as Res<T>;
}

function decidirIncidente<T>(banco: BancoMock, req: Req, inc: Incidente): Res<T> {
  // Verificação primeiro: a sequência não depende do que veio no corpo.
  const recusa = guardaDeTransicao<T>(inc, 'decidido');
  if (recusa) return recusa;

  const body = (req.body ?? {}) as Record<string, any>;
  const decisao = String(body.decisao ?? '') as DecisaoIncidente;
  if (!['comunicar_anpd_e_titulares', 'comunicar_anpd', 'nao_comunicar'].includes(decisao)) {
    return erro(422, 'Decisão fora do vocabulário controlado.',
      'As três saídas do Art. 48 são comunicar à ANPD e aos titulares, comunicar só à ANPD, ou não comunicar.') as Res<T>;
  }
  /**
   * Validação: o fundamento vale para as três decisões, e principalmente para
   * a de **não** comunicar — é essa que a fiscalização examina primeiro. Sem
   * razão registrada, não comunicar é indistinguível de não ter percebido.
   */
  if (String(body.fundamento ?? '').trim().length < 20) {
    return erro(422, 'A decisão exige fundamento de ao menos 20 caracteres.',
      'Art. 48: a decisão de não comunicar também é decisão, e é registrada com a razão.') as Res<T>;
  }

  const fundamento = redigir(String(body.fundamento)).texto;
  try {
    banco.auditAppend({
      ator: req.ator, atorPapel: req.papel, acao: 'INCIDENTE_DECIDIDO', recursoTipo: 'incidente',
      recursoId: inc.id, justificativa: fundamento, campos: [decisao],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a decisão.';
    return erro(503, msg, 'Sem registro não há decisão: a ordem é gravar, depois responder.') as Res<T>;
  }

  inc.estado = 'decidido';
  inc.decisao = decisao;
  inc.fundamento = fundamento;
  inc.decididoPor = req.ator;
  return ok({ id: inc.id, estado: inc.estado, decisao, fundamento }) as Res<T>;
}

function efetivarIncidente<T>(
  banco: BancoMock, req: Req, inc: Incidente, para: 'comunicado' | 'nao_comunicado',
): Res<T> {
  const recusa = guardaDeTransicao<T>(inc, para);
  if (recusa) return recusa;

  // A efetivação segue a decisão registrada. Comunicar um incidente decidido
  // como "não comunicar" seria a tela contradizendo o trail.
  const esperado = inc.decisao === 'nao_comunicar' ? 'nao_comunicado' : 'comunicado';
  if (para !== esperado) {
    return erro(409, `A decisão registrada foi "${inc.decisao}".`,
      'A comunicação executa o que foi decidido e registrado — divergir aqui faria o trail mentir.') as Res<T>;
  }

  try {
    banco.auditAppend({
      ator: req.ator, atorPapel: req.papel,
      acao: para === 'comunicado' ? 'INCIDENTE_COMUNICADO' : 'INCIDENTE_NAO_COMUNICADO',
      recursoTipo: 'incidente', recursoId: inc.id,
      justificativa: inc.fundamento, campos: [inc.decisao ?? '-'],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a comunicação.';
    return erro(503, msg) as Res<T>;
  }

  inc.estado = para;
  return ok({ id: inc.id, estado: inc.estado }) as Res<T>;
}

function encerrarIncidente<T>(banco: BancoMock, req: Req, inc: Incidente): Res<T> {
  const recusa = guardaDeTransicao<T>(inc, 'encerrado');
  if (recusa) return recusa;

  try {
    banco.auditAppend({
      ator: req.ator, atorPapel: req.papel, acao: 'INCIDENTE_ENCERRADO',
      recursoTipo: 'incidente', recursoId: inc.id,
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar o encerramento.';
    return erro(503, msg) as Res<T>;
  }

  inc.estado = 'encerrado';
  return ok({ id: inc.id, estado: inc.estado }) as Res<T>;
}

/**
 * C-08 — revogação de consentimento (Art. 18, VIII).
 *
 * Revogar não é apagar um registro: é um evento que **propaga**. O campo perde
 * a base legal, sai dos caminhos de revelação e o gate volta a bloquear o
 * repositório — exatamente como a LIA vencida. Revogação que só muda um rótulo
 * na tela é o teatro que este projeto existe para não fazer.
 */
function revogarConsentimento<T>(banco: BancoMock, req: Req, campoId: string): Res<T> {
  const registro = banco.cenario.consentimentos.find((c) => c.campoId === campoId);
  if (!registro) return erro(404, 'Não encontrado.') as Res<T>;
  if (registro.estado === 'revogado') {
    return erro(409, `O consentimento de ${campoId} já está revogado desde ${registro.revogadoEm}.`,
      'Revogar de novo não é revogação: seria ruído num registro que precisa contar uma história só.') as Res<T>;
  }

  const motivo = redigir(String((req.body as { motivo?: string } | undefined)?.motivo ?? '')).texto;
  const campo = banco.cenario.campos.find((c) => c.id === campoId);
  // O repositório do gate aparece ora nu (`fidelidade`), ora com organização
  // (`aurora/fidelidade`). Comparar a string inteira faria a propagação falhar
  // em silêncio — que é o pior modo de uma regra de privacidade falhar.
  const mesmoRepo = (a: string, b: string) => a.split('/').pop() === b.split('/').pop();
  const gates = banco.cenario.gates.filter((g) => campo && mesmoRepo(g.repositorio, campo.sistema));

  try {
    banco.auditAppend({
      ator: req.ator, atorPapel: req.papel, acao: 'CONSENTIMENTO_REVOGADO',
      recursoTipo: 'consentimento', recursoId: `${campoId}@${registro.versao}`,
      justificativa: motivo || undefined, campos: [campoId],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a revogação.';
    return erro(503, msg, 'Revogação sem registro não é oponível a ninguém.') as Res<T>;
  }

  registro.estado = 'revogado';
  registro.revogadoEm = new Date().toISOString();
  // A consequência sai do mesmo ato: o gate volta a bloquear o repositório do
  // campo, como já acontece com RIPD pendente.
  for (const g of gates) { g.conclusao = 'failure'; g.bloqueouMerge = true; }

  return ok({
    campoId, estado: registro.estado, gatesBloqueados: gates.length,
  }, 200) as Res<T>;
}

/** C-08 — o consentimento vigente de um campo, ou `null` se não houver base viva. */
const consentimentoVigente = (banco: BancoMock, campoId: string) =>
  banco.cenario.consentimentos.find((c) => c.campoId === campoId && c.estado === 'ativo') ?? null;

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
${r.triggers.map((t) => `| ${t.codigo} | ${rotuloDoGatilho(t.codigo)} | ${gatilhoCritico(t.codigo) ? '✅' : '⚠️'} | ${t.evidencias.join('; ')} |`).join('\n')}

## 1.1 Rito aplicado

${[ultimaDecisao(r.decisoes, 'd1'), ultimaDecisao(r.decisoes, 'd3')].filter(Boolean).map((d) => `- ${d!.frase} _(${d!.tabela}@${d!.versao})_`).join('\n')
  || '- Nenhuma tabela de decisão aplicada a este RIPD.'}

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
