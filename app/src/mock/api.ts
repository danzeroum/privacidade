import { BancoMock, FalhaDeAuditoria, LogImutavel } from './db';
import { pode } from './permissoes';
import { POLITICA_PADRAO, politicaDe } from './politicas';
import { ACESSO_SEM_FINALIDADE, campoAlcancado, recusaDeFinalidade } from './finalidade';
import { TENTATIVAS_MAXIMAS, motivoDaFaltaDeStepUp } from './stepup';
import type { FatorDeStepUp } from './stepup';
import { ARTEFATOS, estadosDe, motivoDaRecusa, transicaoPermitida } from './estados';
import type { Artefato, EstadoDe } from './estados';
import {
  CATEGORIAS, TABELAS, TABELAS_IDS, aplicar, gatilhoCritico, rotuloDoGatilho, ultimaDecisao, vigenteDe,
} from './decisoes';
import { GATILHOS } from './decisoes';
import { vereditoPbd } from './pbd';
import type { DecisaoRegistrada, TabelaId, Valor } from './decisoes';
import { contadoresDe, derivarFila, minhaFila } from './fila';
import {
  VALIDADE_DO_FEED_MS, cargaDoAno, diasAte, naAntecedencia, papelDoTokenDeFeed, paraIcs, tokenDoFeed,
} from './calendario';
import { executarExpurgo, retencaoAteDoCampo, varrerVencimentos } from './expurgo';
import { codigoDoAchado, diasDeAtraso } from './retencao';
import { motivoDaCessacao, temProvaVersionada, titularesAtivos } from './consentimento';
import { redigir } from '../lib/redator';
import { hashEncadeado, sha256 } from '../lib/sha256';
import { BASES_LEGAIS, BASES_PARA_SENSIVEL } from './types';
import type {
  BaseLegal, Campo, Categoria, DecisaoIncidente, DesfechoSolicitacao, EstadoIncidente,
  Finalidade, GatilhoDeReabertura, Incidente, ItemRetido, Mecanismo, Papel, ResultadoRevisao,
  TipoArmazenado,
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
  /**
   * PR 10 — a query entra aqui e em nenhum outro lugar.
   *
   * O feed ICS precisa dela porque é lido por um cliente sem sessão, e a URL é a
   * credencial. Toda outra rota continua sem parâmetro: o caminho é separado da
   * query **antes** de virar segmentos, para que `?papel=x` não possa aparecer
   * colado num segmento e passar despercebido pela tabela de políticas.
   */
  const [semQuery, queryBruta = ''] = caminho.split('?');
  const query: Record<string, string> = {};
  for (const par of queryBruta.split('&').filter(Boolean)) {
    const [k, v = ''] = par.split('=');
    query[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  const partes = semQuery.replace(/^\/v1\//, '').split('/');
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
  const politicaDeclarada = politicaDe(metodo, partes.join('/'));
  const politica = politicaDeclarada ?? POLITICA_PADRAO;

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
   * Risco-011 — a finalidade, cobrada pela guarda e não por cada rota.
   *
   * Vem **depois** das duas guardas de papel de propósito. Antes delas, uma
   * recusa por finalidade em `GET titulares/{id}` diria "a rota existe e o seu
   * papel alcança, faltou o cabeçalho" para quem sequer podia chegar ali — e o
   * `404_uniforme` que a Regra 5 sustenta perderia o sentido.
   *
   * Duas coisas conferidas por uma função só (`mock/finalidade.ts`): que a
   * finalidade foi declarada, e que ela consta no catálogo do campo alcançado.
   * A segunda morava dentro de `POST /pseudonyms/resolve`; regra dentro de rota
   * é regra que a próxima rota não herda.
   */
  /**
   * `politicaDeclarada` e não `politica`: caminho sem política é caminho que
   * **não existe**, e a resposta certa para ele é o 404 do fim do `switch`.
   * Cobrar finalidade antes disso responderia "declare a finalidade" para
   * `GET /v1/fila/dpo`, dizendo que o endereço foi entendido — o recorte
   * silencioso que o PR 9 fechou, de volta por outra porta.
   *
   * O fecho não se perde: `POLITICA_PADRAO` continua tratando rota não
   * declarada como escrita, e um invariante do PR 5 cobra que **toda** operação
   * servida pelo dispatcher tenha política própria — nenhuma cai no padrão.
   */
  if (politicaDeclarada?.finalidade === 'exigida') {
    const recusa = recusaDeFinalidade(req.purpose, campoAlcancado(banco, body, partes));
    if (recusa) {
      // A promessa do `openapi.yaml:20` passa a ter contraparte executável: a
      // ausência **grava** no trail. Registro de negativa não pode depender da
      // finalidade que acabou de faltar, por isso a ação fica fora de ACOES_PII.
      try {
        banco.auditAppend({
          ator, atorPapel: papel, acao: ACESSO_SEM_FINALIDADE,
          recursoTipo: 'rota', recursoId: `${metodo} ${partes.join('/')}`,
          resultado: 'negado', justificativa: recusa.motivoNoTrail,
        });
      } catch { /* a negativa não pode derrubar a resposta de negativa */ }
      return erro(recusa.status, recusa.mensagem, recusa.regra) as Res<T>;
    }
  }

  /**
   * Risco-011 — o step-up, derivado da operação.
   *
   * A janela vem de `politicas.ts`, no servidor. Se viesse do pedido, quem
   * executa a operação escolheria o rigor da própria confirmação — que é
   * alegar, não provar. Mesma regra do nível de verificação do portal, que vem
   * do direito e nunca do cliente.
   */
  if (politicaDeclarada?.stepUp) {
    const falta = motivoDaFaltaDeStepUp(banco.stepUpDe(ator), Date.now(), politicaDeclarada.stepUp.janelaMin);
    if (falta) {
      try {
        banco.auditAppend({
          ator, atorPapel: papel, acao: 'STEP_UP_EXIGIDO',
          recursoTipo: 'rota', recursoId: `${metodo} ${partes.join('/')}`,
          resultado: 'negado', justificativa: falta,
        });
      } catch { /* idem */ }
      return erro(403, falta,
        'Operação sensível exige confirmação de identidade recente. A janela é derivada da operação '
        + 'no servidor — quem executa não escolhe o próprio rigor.') as Res<T>;
    }
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
    /**
     * Risco-011 — o step-up, em duas etapas como no portal.
     *
     * Duas rotas e não uma: com uma só, "confirmar identidade" seria uma
     * chamada que confirma a si mesma, e o fator viraria enfeite. Com desafio e
     * código, o que fica instrumentado é a mecânica — abrir, responder no
     * prazo, com número limitado de tentativas.
     *
     * O código **não sai na resposta**: vai pelo canal, como no portal. Aqui não
     * há canal, e é por isso que `banco.codigoDoDesafio()` existe para o demo e
     * para o teste — não para um cliente.
     */
    case 'POST step-up': {
      if (!partes[1]) {
        const fator = String(body.fator ?? 'totp') as FatorDeStepUp;
        if (fator !== 'totp' && fator !== 'webauthn') {
          return erro(422, 'Fator desconhecido. Os aceitos são: totp, webauthn.',
            'O fator é simulado neste protótipo, e o vocabulário é o real de propósito: '
            + 'o que está instrumentado é a janela e a derivação, não a criptografia do fator.') as Res<T>;
        }
        const d = banco.abrirDesafioDeStepUp(ator, fator);
        return ok({ id: d.id, fator: d.fator, expiraEmMs: d.expiraEmMs }, 201) as Res<T>;
      }

      if (partes[2] !== 'confirmar') break;

      /**
       * A recusa é uma só, como a do portal: código errado, desafio vencido,
       * tentativas esgotadas, id inventado e desafio de outro ator respondem
       * igual. Diferenciar transformaria a rota num oráculo de desafios vivos.
       */
      const naoConfirmado = () => erro(401, 'Não foi possível confirmar a identidade.',
        'A recusa é idêntica para código errado, desafio vencido e desafio de outra pessoa: '
        + 'mensagens diferentes seriam um oráculo sobre desafios em aberto.') as Res<T>;

      const desafio = banco.desafioDeStepUp(String(partes[1]));
      const agora = Date.now();
      if (!desafio || desafio.ator !== ator || desafio.expiraEmMs <= agora
        || desafio.tentativas >= TENTATIVAS_MAXIMAS) return naoConfirmado();

      desafio.tentativas += 1;
      if (desafio.codigo !== String(body.codigo ?? '')) return naoConfirmado();

      const sessao = banco.confirmarStepUp(ator, desafio.fator, agora);
      try {
        banco.auditAppend({
          ator, atorPapel: papel, acao: 'STEP_UP_CONFIRMADO',
          recursoTipo: 'sessao', recursoId: desafio.id, campos: [desafio.fator],
        });
      } catch (e) {
        const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a confirmação.';
        return erro(503, msg, 'Confirmação que não fica registrada não sustenta operação nenhuma.') as Res<T>;
      }
      return ok({ confirmadoEmMs: sessao.confirmadoEmMs, fator: sessao.fator }) as Res<T>;
    }

    // ── REGRA 3 e 4 — revelação de PII ────────────────────────────────────
    case 'POST pseudonyms': {
      if (partes[1] !== 'resolve') break;
      const { titularId, campo, justificativa, protocolo } = body as {
        titularId: string; campo: string; justificativa: string; protocolo?: string;
      };

      // A finalidade — declarada e compatível — já foi conferida pela guarda do
      // dispatcher, por uma função só (`mock/finalidade.ts`). Ela morava aqui, e
      // era por isso que as outras onze rotas que tocam titular não a herdavam.
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
       * C-08 — a revogação propaga até aqui. Campo cuja base legal é
       * consentimento e cujo registro foi revogado deixa de ser revelável: o
       * tratamento perdeu fundamento no instante da revogação, e continuar
       * mostrando o valor faria da revogação um rótulo.
       */
      /**
       * Duas perguntas diferentes, e por isso duas checagens.
       *
       * A primeira é sobre o **campo**: existe texto de consentimento publicado
       * que sustente a base legal declarada no ROPA? Sem ele, a base é uma
       * afirmação sobre a vontade de alguém que ninguém consultou — e nenhum
       * titular é tratável, independentemente de quem aceitou o quê.
       */
      if (catalogado.baseLegal === 'consentimento'
        && !temProvaVersionada(banco.cenario.consentimentoTextos, catalogado.id)) {
        registrarNegativa(banco, ator, papel, campo, 'campo sem texto de consentimento vigente');
        return erro(422, `${catalogado.nome} declara base legal "consentimento" sem texto publicado vigente.`,
          'Art. 8º, §1º: o consentimento se prova pelo texto que a pessoa aceitou, versionado — e sem ele não há base.') as Res<T>;
      }

      /**
       * A segunda é sobre **esta pessoa**: o aceite dela está vivo? Revogado e
       * expirado cessam o tratamento do mesmo jeito e dizem coisas diferentes —
       * um 422 que não os distingue manda o titular reclamar de uma retirada
       * que ele não fez, ou aceitar como escolha dele um vencimento que foi da
       * empresa.
       */
      if (catalogado.baseLegal === 'consentimento') {
        const consentimento = banco.consentimentoDe(titularId, catalogado.id);
        if (!consentimento) {
          registrarNegativa(banco, ator, papel, campo, 'sem aceite deste titular');
          return erro(422, `Não há consentimento deste titular para ${catalogado.nome}.`,
            'Art. 7º, I: sem aceite não há base legal, e ausência de fato não é o mesmo que aceite vencido.') as Res<T>;
        }
        if (consentimento.estado !== 'ativo') {
          registrarNegativa(banco, ator, papel, campo, `consentimento ${consentimento.estado}`);
          return erro(422, motivoDaCessacao(consentimento.estado, catalogado.nome, consentimento.expiraEm),
            consentimento.estado === 'revogado'
              ? 'Art. 8º, §5º e Art. 18, VIII: revogado o consentimento, cessa o tratamento que dependia dele.'
              : 'Art. 8º, §5º: consentimento tem prazo, e vencido ele não sustenta tratamento — renovar é ato do titular.') as Res<T>;
        }
      }

      /**
       * Art. 18, §2º — a oposição acolhida cessa o tratamento **deste** titular.
       *
       * É o par exato da revogação de consentimento logo acima, e pelo mesmo
       * motivo: se a oposição mudasse um estado que nenhuma leitura consulta, a
       * salvaguarda que a LIA publica seria decorativa — e é justamente a
       * existência dessa salvaguarda que sustenta o balanceamento do Art. 10,
       * §3º. Só `acolhida` barra; recusada com fundamento, o tratamento volta.
       */
      if (catalogado.baseLegal === 'legitimo_interesse'
        && banco.oposicaoVigenteSobre(titularId, catalogado.id)) {
        registrarNegativa(banco, ator, papel, campo, 'oposicao acolhida');
        return erro(422, `Este titular se opôs ao tratamento de ${catalogado.nome} por legítimo interesse.`,
          'Art. 18, §2º: acolhida a oposição, o tratamento cessa até que uma razão legítima prevalecente '
          + 'seja escrita e comunicada — a recusa fundamentada da solicitação é o caminho para retomá-lo.') as Res<T>;
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
          // Art. 37: o registro do acesso diz sob qual base legal ele aconteceu,
          // e a base vem do catálogo — não de quem revela. Quem escolhe a própria
          // base legal no momento do acesso não está registrando, está alegando.
          baseLegal: catalogado.baseLegal,
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
        const registro = c.campoId
          ? temProvaVersionada(banco.cenario.consentimentoTextos, c.campoId)
          : false;
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

      /**
       * PR 11 — o gatilho dispara e o RIPD volta sozinho para elaboração.
       *
       * "Sem intervenção manual" é o ponto: quem chama isto é a triagem do CI,
       * que já fala o vocabulário do catálogo. A reabertura passa pelo mesmo
       * `transitar` de qualquer transição — mesma máquina, mesmo registro antes
       * de aplicar —, e não por um atalho que mexe no status direto.
       */
      if (acao === 'gatilho') {
        const codigo = String(body.codigo ?? '');
        if (!GATILHOS[codigo]) {
          return erro(422, `"${codigo}" não é gatilho do catálogo.`,
            `Os declarados são: ${Object.keys(GATILHOS).join(', ')}.`) as Res<T>;
        }
        const evidencia = String(body.evidencia ?? '').trim();
        if (evidencia.length < 10) {
          return erro(422, 'Disparar um gatilho exige evidência.',
            'Gatilho sem evidência é boato: o que reabre um RIPD precisa ser conferível no diff.') as Res<T>;
        }
        const dispensa = (ripd.dispensas ?? []).at(-1);
        if (ripd.status !== 'dispensado' || !dispensa) {
          return erro(409, `${ripd.codigo} não está dispensado.`,
            'Gatilho de reabertura é o que fica pendurado numa dispensa; fora dela não há o que reabrir.') as Res<T>;
        }

        /**
         * Reabre se o gatilho foi declarado **ou** se é crítico.
         *
         * A segunda metade é a que fecha a porta: um gatilho crítico que a
         * dispensa não previu quebra a premissa dela — a de que nada crítico
         * havia. Exigir declaração prévia faria a omissão proteger a dispensa.
         */
        const declarado = dispensa.gatilhos.some((g) => g.codigo === codigo);
        const reabre = declarado || gatilhoCritico(codigo);

        try {
          banco.auditAppend({
            ator, atorPapel: papel, acao: 'GATILHO_DISPARADO',
            recursoTipo: 'ripd', recursoId: ripd.codigo,
            justificativa: redigir(evidencia).texto,
            campos: [codigo, declarado ? 'declarado' : 'nao_declarado', reabre ? 'reabre' : 'nao_reabre'],
          });
        } catch (e) {
          const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar o disparo.';
          return erro(503, msg, 'Sem registro não há disparo: a dispensa continua como estava.') as Res<T>;
        }

        dispensa.disparos.push({
          codigo, evidencia: redigir(evidencia).texto, quando: new Date().toISOString(), reabriu: reabre,
        });
        if (!reabre) {
          return ok({
            codigo, reabriu: false, status: ripd.status,
            motivo: `${codigo} (${rotuloDoGatilho(codigo)}) não é crítico e não estava entre os declarados: `
              + 'fica registrado como evidência e a dispensa segue de pé.',
          }) as Res<T>;
        }

        const alvo = alvoDaTransicao(banco, 'ripd', ripd.id, { para: 'elaboracao' });
        const res = transitar<{ para: string }>(banco, { ...req, body: { para: 'elaboracao' } }, alvo!, 'elaboracao');
        if (res.status !== 200) return res as Res<T>;
        return ok({
          codigo, reabriu: true, status: ripd.status,
          motivo: declarado
            ? `${codigo} (${rotuloDoGatilho(codigo)}) estava declarado na dispensa.`
            : `${codigo} (${rotuloDoGatilho(codigo)}) é gatilho crítico: a dispensa não o previu, e é justamente por isso que reabre.`,
        }) as Res<T>;
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

    /**
     * O executor do ciclo de vida (Risco-006).
     *
     * A plataforma registrava pós-fato o que um executor externo dizia ter
     * feito. Agora ela executa, e a prova nasce do ato: cada lote grava antes
     * de eliminar, e a falha de log derruba a execução inteira.
     */
    case 'POST purge': {
      if (partes[1] === 'executar') {
        const hojeIso = String(body.data_referencia ?? new Date().toISOString().slice(0, 10));
        const limite = Number(body.limite ?? 0) || undefined;
        // Presente, é eliminação pedida por um titular; ausente, é a varredura
        // do dia. É a distinção que decide se a obrigação legal recusa ou não.
        const camposIds = Array.isArray(body.campos_ids) ? body.campos_ids.map(String) : undefined;
        let resultado;
        try {
          resultado = executarExpurgo(banco, { hojeIso, ator, limite, camposIds });
        } catch (e) {
          const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar o expurgo.';
          return erro(503, msg,
            'Nada é eliminado sem par pré/pós no trail: a execução inteira foi desfeita.') as Res<T>;
        }
        // A varredura vem depois da execução: o que sobrou vencido é o que
        // vira achado, e não o que estava vencido antes de o motor rodar.
        const achados = varrerVencimentos(banco, hojeIso).map((a) => a.codigo);
        return ok({
          data_referencia: resultado.dataReferencia,
          registros_total: resultado.registrosTotal,
          lotes: resultado.entradas.length,
          lotes_ignorados: resultado.lotesIgnorados,
          entradas: resultado.entradas.map((e) => ({
            campo_id: e.campoId, tabela: e.tabela, metodo: e.metodo, lote_chave: e.loteChave,
            registros: e.registros, restante_antes: e.restanteAntes, restante_depois: e.restanteDepois,
            hash_pre: e.hashPre, hash_pos: e.hashPos,
          })),
          recusados: resultado.recusados.map((r) => ({
            campo_id: r.campoId, norma: r.norma, retencao_ate: r.retencaoAte, motivo: r.motivo,
          })),
          achados,
        }) as Res<T>;
      }
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
    /**
     * PR 10 — T10 · o calendário do ano.
     *
     * Leitura ampla: as obrigações não carregam dado pessoal e o programa inteiro
     * precisa enxergar o que está provisionado. O recorte "só as minhas" é da
     * tela, não da rota — quem audita precisa ver o ano todo.
     */
    /**
     * PR 11 — os épicos com o checklist de PbD.
     *
     * O veredito vem junto e é calculado por `mock/pbd.ts` — a **mesma** função
     * que o gate de CI usa sobre o `.privacy/epico.yml`. A tela não reimplementa
     * a regra: se reimplementasse, a que vale seria a que ninguém está olhando.
     */
    case 'GET epicos':
      return ok(banco.cenario.epicos.map((e) => ({
        ...e, veredito: vereditoPbd(e.pbd),
      }))) as Res<T>;

    case 'GET calendario': {
      if (partes[1] === 'assinatura') {
        // A URL do feed **do próprio papel**, e de mais nenhum: o token é a
        // credencial, e mintar a de outro exigiria o segredo da instância.
        const expira = Date.now() + VALIDADE_DO_FEED_MS;
        const token = tokenDoFeed(banco.segredoDoFeed, papel, expira, sha256);
        return ok({
          papel,
          token,
          expiraEmMs: expira,
          // No caminho, não na query: é onde credencial menos vaza por `Referer`
          // e por log de proxy. Menos superfície, não sigilo.
          caminho: `/v1/calendario/${token}.ics`,
        }) as Res<T>;
      }

      /**
       * O feed, somente leitura, com o token no caminho.
       *
       * Fica dentro de `GET calendario` porque o caminho passou a ser
       * `/v1/calendario/{token}.ics` — antes era a raiz `calendario.ics`, com o
       * papel e o token na query string.
       */
      if (partes[1]?.endsWith('.ics')) {
        const alvo = papelDoTokenDeFeed(
          banco.segredoDoFeed, partes[1].replace(/\.ics$/, ''), Date.now(), sha256,
        );
        if (!alvo || !PAPEIS_VALIDOS.includes(alvo)) {
          return erro(403, 'Token de feed inválido ou vencido.',
            'A URL do ICS é a credencial: cada papel assina a própria, ela vence, e o segredo não '
            + 'sai da plataforma — nem no bundle.') as Res<T>;
        }
        const minhas = banco.cenario.obrigacoes.filter((o) => o.responsavel === alvo);
        return ok(paraIcs(minhas, alvo, 'https://lastro.exemplo/')) as Res<T>;
      }

      if (partes[1]) break;
      const agora = Date.now();
      return ok({
        obrigacoes: banco.cenario.obrigacoes,
        carga: cargaDoAno(banco.cenario.obrigacoes),
        naAntecedencia: banco.cenario.obrigacoes
          .filter((o) => naAntecedencia(o, agora)).map((o) => o.codigo),
      }) as Res<T>;
    }

    case 'POST calendario': {
      if (partes[2] !== 'prorrogar') break;
      return prorrogarObrigacao<T>(banco, req, partes[1] ?? '');
    }

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
    /**
     * O console vê o mesmo que o banco: texto vigente por campo, com a contagem
     * de titulares **somada** da entidade. Não existe mais um campo `titulares`
     * para divergir do que ele conta.
     */
    case 'GET consentimentos': {
      const hoje = new Date().toISOString().slice(0, 10);
      return ok(banco.cenario.consentimentoTextos.map((t) => ({
        campoId: t.campoId,
        versao: t.versao,
        texto: t.texto,
        hash: t.hash,
        publicadoEm: t.publicadoEm,
        validade: t.validade,
        canal: banco.cenario.consentimentos.find((c) => c.textoId === t.id)?.canal ?? '—',
        coletadoEm: banco.cenario.consentimentos.find((c) => c.textoId === t.id)?.coletadoEm ?? '—',
        aceites: banco.cenario.consentimentos.filter((c) => c.textoId === t.id).length,
        titularesAtivos: titularesAtivos(
          banco.cenario.consentimentoTextos, banco.cenario.consentimentos,
          banco.revogacoesTitular.map((r) => ({
            id: r.id, consentimentoId: r.consentimentoId, revogadoEmMs: r.revogadoEmMs, canal: r.canal,
          })),
          t.campoId, hoje,
        ),
        vigente: banco.textoVigenteDe(t.campoId)?.id === t.id,
      }))) as Res<T>;
    }

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

        /**
         * Parcial e recusa exigem `retidos[]` item a item, com base legal e data.
         *
         * "Parte foi retida por obrigação legal" é a frase que o titular recebe
         * hoje e não tem como contestar: não diz o quê, nem por qual lei, nem
         * até quando. A tela 07 do portal é a mais importante justamente porque
         * separa apagado de retido — e ela só tem o que mostrar se a conclusão
         * for obrigada a produzir a lista aqui.
         */
        const retidos = normalizarRetidos(body.retidos);
        if (desfecho !== 'atendido') {
          const problema = problemaNosRetidos(retidos);
          if (problema) {
            return erro(422, problema,
              'Art. 18, §4º c/c Art. 16: reter é decisão que se justifica item a item, com a lei que a '
              + 'sustenta e a data em que o resíduo é eliminado.') as Res<T>;
          }
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
        s.apagados = Array.isArray(body.apagados) ? body.apagados.map(String) : [];
        s.retidos = retidos;

        /**
         * A oposição foi acolhida no instante em que chegou, e a análise só
         * pode fazer uma coisa com isso: mantê-la, ou derrubá-la **por escrito**.
         *
         * Recusar com fundamento é a única forma de o tratamento voltar, e o
         * fundamento já foi exigido e redigido acima. Sem esta linha o
         * controlador não teria como demonstrar razão legítima prevalecente
         * (Art. 10, §3º) e a oposição seria irreversível — o que a lei não diz.
         */
        if (s.direito === 'oposicao' && desfecho === 'recusado_com_fundamento') {
          const oposicao = banco.oposicoesTitular.find((o) => o.protocolo === s.protocolo);
          if (oposicao) { oposicao.estado = 'recusada'; oposicao.decididaEmMs = agora; }
        }
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

    /**
     * A T6 · ciclo de vida do dado. Três estados, e a linha vermelha é o ponto:
     * vencido sem expurgo é achado, não pendência silenciosa.
     */
    case 'GET retencao': {
      if (partes[1]) break;
      const hoje = new Date().toISOString().slice(0, 10);
      return ok({
        hoje,
        campos: banco.cenario.campos.map((c) => {
          const ate = retencaoAteDoCampo(c);
          const atraso = diasDeAtraso(ate, hoje);
          const codigo = codigoDoAchado(c.dataset, c.nome);
          const achado = banco.cenario.achados.find((a) => a.codigo === codigo);
          const ultimoLote = [...banco.auditoria].reverse()
            .find((l) => l.acao === 'EXPURGO_LOTE' && l.recursoId === c.id);
          return {
            campo: `${c.dataset}.${c.nome}`,
            retencao: c.retencao,
            retencao_iso: c.retencaoIso ?? null,
            fato_gerador: c.fatoGerador ?? null,
            retencao_ate: ate,
            registros: c.registrosEstimados ?? 0,
            atraso_dias: atraso,
            prova_pre_pos: ultimoLote?.campos.find((x) => x.startsWith('pre='))?.slice(4) ?? null,
            /**
             * A ordem importa. Um campo com prova de expurgo e nada restante
             * está **comprovado**, mesmo que a data já tenha passado — foi
             * justamente por ter passado que ele foi expurgado. Checar o atraso
             * primeiro deixaria a linha vermelha para sempre, e a tela diria
             * que o motor não rodou logo depois de ele rodar.
             */
            estado: !ate ? 'sem_prazo'
              : (ultimoLote && (c.registrosEstimados ?? 0) === 0) ? 'expurgo_comprovado'
                : atraso > 0 ? 'vencido_sem_expurgo'
                  : 'a_vencer',
            achado: achado?.codigo ?? null,
          };
        }),
      }) as Res<T>;
    }

    case 'GET metrics':
      return ok({ metricas: banco.cenario.metricas, maturidade: banco.cenario.maturidade }) as Res<T>;

    default:
      break;
  }

  return erro(404, `Rota não encontrada: ${metodo} ${caminho}`) as Res<T>;
}

/**
 * Aceita as duas grafias do item retido.
 *
 * O contrato escreve `base_legal`/`retencao_ate`, o modelo interno escreve
 * `baseLegal`/`retencaoAte`, e a fronteira entre os dois é aqui — em um lugar
 * só. Espalhar a conversão pelas rotas é como um campo acaba gravado com a
 * grafia errada e some da tela sem ninguém errar nada visível.
 */
function normalizarRetidos(bruto: unknown): ItemRetido[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      item: String(o.item ?? ''),
      baseLegal: (o.baseLegal ?? o.base_legal) as BaseLegal,
      artigo: o.artigo ? String(o.artigo) : undefined,
      retencaoAte: String(o.retencaoAte ?? o.retencao_ate ?? ''),
      motivo: o.motivo ? String(o.motivo) : undefined,
    };
  });
}

/** A primeira coisa errada com a lista, em linguagem de gente — ou `null`. */
function problemaNosRetidos(retidos: ItemRetido[]): string | null {
  if (retidos.length === 0) {
    return 'Atendimento parcial e recusa exigem a lista do que ficou retido.';
  }
  for (const r of retidos) {
    if (!r.item.trim()) return 'Cada item retido precisa dizer o que é, em linguagem de pessoa.';
    if (!BASES_LEGAIS.includes(r.baseLegal)) {
      return `"${r.item}" está sem base legal válida — reter sem nomear a lei não é resposta.`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.retencaoAte)) {
      return `"${r.item}" está sem data de eliminação (AAAA-MM-DD). Prazo é data, nunca "conforme a lei".`;
    }
  }
  return null;
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
type Alvo = {
  artefato: Artefato;
  id: string;
  estado: string;
  /**
   * PR 15 — os fatos que o **artefato** já carrega, lidos para a validação.
   *
   * Sem isto, a única coisa que a rota consegue conferir é o que quem pediu a
   * transição digitou — e uma exigência conferida contra o próprio corpo do
   * pedido não é exigência. É a decisão do PR 8 outra vez: entrada de regra se
   * lê do artefato.
   */
  fatos?: Record<string, unknown>;
  /**
   * A prova que entra no registro **antes** da resposta, quando a transição
   * carrega evidência. O hash é calculado aqui e gravado no trail por
   * `transitar`; só depois `aplicar` o anexa ao artefato.
   */
  prova?: { arquivo: string; hash: string };
  aplicar: () => void;
};

/** O que cada transição exige além de ser legal. Vazio = só a sequência. */
function exigenciasDe(
  artefato: Artefato, de: string, para: string, body: Record<string, any>,
  fatos: Record<string, any> = {},
): string | null {
  const texto = (chave: string) => String(body[chave] ?? '').trim();

  if (artefato === 'ripd' && para === 'dispensado') {
    if (texto('justificativa').length < 20) {
      return 'Dispensar o RIPD exige justificativa de ao menos 20 caracteres — dispensa sem registro é omissão, não decisão.';
    }
    /**
     * PR 11 — o gatilho passou de prosa a **código do catálogo**.
     *
     * Antes bastava uma frase, que era validada e descartada: nada ficava no
     * artefato e nada podia disparar. Uma dispensa com gatilho que ninguém
     * consegue acionar é dispensa permanente com outro nome.
     */
    const gatilhos = Array.isArray(body.gatilhos) ? body.gatilhos : [];
    if (gatilhos.length === 0) {
      return 'Dispensa exige ao menos um gatilho de reabertura: sem ele, a dispensa vale para sempre e ninguém revisita.';
    }
    for (const g of gatilhos) {
      const codigo = String(g?.codigo ?? '');
      if (!GATILHOS[codigo]) {
        return `"${codigo}" não é gatilho do catálogo. Os declarados são: ${Object.keys(GATILHOS).join(', ')}.`;
      }
      if (String(g?.condicao ?? '').trim().length < 10) {
        return `O gatilho ${codigo} precisa dizer o que, neste sistema, o faria disparar.`;
      }
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
  /**
   * PR 15 — o ciclo do achado, exigência por exigência.
   *
   * A separação que este bloco existe para manter: **sequência** é a máquina de
   * estados (`executado → encerrado` é 409 e nem chega aqui); **conteúdo** é o
   * que estas linhas conferem. A confusão entre as duas é o que produz o
   * defeito de encerrar um achado cuja verificação concluiu que não resolveu —
   * a ordem estava certa, a conclusão é que não sustentava o encerramento.
   */
  if (artefato === 'achado' && para === 'causa_raiz') {
    if (texto('causaRaiz').length < 20) {
      return de === 'reaberto'
        ? 'Reincidência exige causa raiz **nova**, de ao menos 20 caracteres: reabrir com a análise antiga refaz o plano que já falhou uma vez.'
        : 'A causa raiz exige ao menos 20 caracteres — plano apoiado em sintoma corrige a ocorrência e deixa a causa de pé.';
    }
  }
  if (artefato === 'achado' && para === 'plano') {
    if (texto('plano').length < 20) {
      return 'O plano exige ao menos 20 caracteres — "corrigir o log" não diz a ninguém o que será feito.';
    }
    if (texto('criterioDeEficacia').length < 20) {
      return 'O plano exige critério de eficácia verificável, declarado antes de executar: sem ele, quem verifica não tem contra o que conferir e "verificado" vira opinião.';
    }
  }
  if (artefato === 'achado' && para === 'executado') {
    if (!texto('executadoPor')) {
      return 'Declare quem executou — sem executor declarado não há de quem a verificação seja independente.';
    }
    if (!texto('evidencia')) {
      return 'Executar exige evidência anexada: execução sem prova é relato, e relato não fecha achado de auditoria.';
    }
  }
  if (artefato === 'achado' && para === 'verificado') {
    if (!texto('verificadoPor')) {
      return 'A verificação de eficácia é independente: declare quem verificou.';
    }
    if (texto('verificadoPor') === String(fatos.executadoPor ?? '')) {
      return `${texto('verificadoPor')} executou este plano. Verificar o próprio trabalho não é verificação independente — a rota recusa o mesmo nome dos dois lados.`;
    }
    if (typeof body.eficaciaAtingida !== 'boolean') {
      return 'A verificação conclui contra o critério declarado no plano: o critério foi atingido, sim ou não. Verificar sem concluir deixa o encerramento sem base.';
    }
    if (!texto('evidencia')) {
      return 'A verificação exige evidência própria — a do executor prova que algo foi feito, não que o critério foi atingido.';
    }
  }
  if (artefato === 'achado' && para === 'encerrado') {
    if (fatos.eficaciaAtingida !== true) {
      return 'A verificação concluiu que o critério de eficácia não foi atingido. O caminho daqui é reabrir, não encerrar: encerrar agora registraria como resolvido o que a própria verificação disse que não resolveu.';
    }
  }
  if (artefato === 'achado' && para === 'reaberto') {
    if (texto('motivo').length < 20) {
      return 'Reabrir exige motivo de ao menos 20 caracteres — a reabertura eleva a criticidade e conta reincidência, e quem receber o achado depois precisa saber por quê.';
    }
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
  const faltando = exigenciasDe(alvo.artefato, alvo.estado, para, body, alvo.fatos ?? {});
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
      /**
       * PR 15 — a prova entra **aqui**, no mesmo bloco da transição, e não
       * depois. Se `auditAppend` falhar, o 503 abaixo devolve um achado sem
       * evidência anexada e sem estado novo: a alternativa seria um artefato
       * carregando um anexo que o trail não conhece.
       */
      campos: [`${alvo.estado}→${para}`, ...(alvo.prova ? [`evidencia:${alvo.prova.hash}`] : [])],
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
      return x ? { artefato, id: x.codigo, estado: x.status, aplicar: () => {
        const para = String(body.para);
        if (para === 'dispensado') {
          // A dispensa fica no artefato, append-only. Validada e descartada,
          // como era antes, ela não sustentaria a reabertura nem a auditoria.
          x.dispensas = [...(x.dispensas ?? []), {
            justificativa: redigir(String(body.justificativa)).texto,
            gatilhos: (body.gatilhos as GatilhoDeReabertura[]).map((g) => ({
              codigo: String(g.codigo), condicao: String(g.condicao),
            })),
            por: String(body.por ?? '—'),
            quando: new Date().toISOString(),
            disparos: [],
          }];
        }
        x.status = para as typeof x.status;
      } } : null;
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
      if (!x) return null;
      const para = String(body.para ?? '');
      const anterior = x.evidencias.at(-1)?.hash ?? null;
      const arquivo = String(body.evidencia ?? '').trim();
      // A cadeia de custódia só existe nas duas etapas que produzem prova.
      // Anexar em qualquer transição transformaria a cadeia num depósito.
      const prova = arquivo && (para === 'executado' || para === 'verificado')
        ? { arquivo, hash: hashEncadeado(anterior, arquivo, para) }
        : undefined;
      return { artefato, id: x.codigo, estado: x.status, prova, fatos: {
        executadoPor: x.executadoPor,
        eficaciaAtingida: x.eficaciaAtingida,
        criterioDeEficacia: x.criterioDeEficacia,
      }, aplicar: () => {
        if (para === 'causa_raiz') x.causaRaiz = redigir(String(body.causaRaiz)).texto;
        if (para === 'plano') {
          x.plano = redigir(String(body.plano)).texto;
          x.criterioDeEficacia = redigir(String(body.criterioDeEficacia)).texto;
        }
        if (para === 'executado') x.executadoPor = String(body.executadoPor);
        if (para === 'verificado') {
          x.verificadoPor = String(body.verificadoPor);
          x.eficaciaAtingida = Boolean(body.eficaciaAtingida);
        }
        if (para === 'reaberto') {
          // O MAPA é explícito: reaberto entra com criticidade elevada e conta
          // como reincidência. Achado que volta não volta igual.
          x.reincidencias += 1;
          x.criticidade = x.criticidade === 'critica' ? 'critica'
            : x.criticidade === 'alta' ? 'critica'
              : x.criticidade === 'media' ? 'alta' : 'media';
          x.motivoDaReabertura = redigir(String(body.motivo)).texto;
          /**
           * A reabertura **não herda** a análise anterior. Se herdasse, a fila
           * mandaria reapurar a causa e a tela mostraria a causa antiga já
           * preenchida — que é o convite a apertar "avançar" sobre o raciocínio
           * que acabou de falhar. As evidências ficam: são prova do que houve.
           */
          x.causaRaiz = undefined;
          x.plano = undefined;
          x.criterioDeEficacia = undefined;
          x.executadoPor = undefined;
          x.verificadoPor = undefined;
          x.eficaciaAtingida = undefined;
        }
        if (prova) {
          x.evidencias = [...x.evidencias, {
            arquivo: prova.arquivo, hash: prova.hash, hashAnterior: anterior,
            por: String(body.executadoPor ?? body.verificadoPor ?? '—'),
            quando: new Date().toISOString(), etapa: para as typeof x.status,
          }];
        }
        x.status = para as typeof x.status;
      } };
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
const PAPEIS_VALIDOS = ['engenharia', 'dpo', 'produto', 'seguranca', 'auditor'];

/**
 * PR 10 — prorrogar é ato registrado, não arrastar o mouse.
 *
 * Mesma disciplina da reclassificação de risco: justificativa obrigatória,
 * redigida antes de guardar, gravada no trail **antes** de a data nova valer. É
 * o que impede prazo legal de virar negociável — e é a razão de o feed ICS ser
 * somente leitura, porque mover a data no Teams não tem por onde voltar.
 */
function prorrogarObrigacao<T>(banco: BancoMock, req: Req, codigo: string): Res<T> {
  const body = (req.body ?? {}) as Record<string, any>;
  const o = banco.cenario.obrigacoes.find((x) => x.codigo === codigo);
  if (!o) return erro(404, 'Não encontrado.') as Res<T>;

  if (req.papel !== o.responsavel) {
    // Titularidade declarada: quem prorroga é quem responde, e não quem tem uma
    // permissão larga o bastante para alcançar.
    return erro(403, `Prorrogar ${o.codigo} é de ${o.responsavel}, que responde por ela.`,
      'Na interface o controle não é renderizado para quem não responde pela obrigação.') as Res<T>;
  }

  const justificativa = String(body.justificativa ?? '').trim();
  if (justificativa.length < 20) {
    return erro(422, 'Prorrogar exige justificativa de ao menos 20 caracteres.',
      'Sem ela o prazo legal vira negociável no arrastar do mouse — e o histórico não explica por quê.') as Res<T>;
  }

  const para = String(body.para ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(para)) {
    return erro(422, 'Data nova inválida: use AAAA-MM-DD.') as Res<T>;
  }
  if (para <= o.vence) {
    return erro(422, `Prorrogar move a data para frente: ${para} não é depois de ${o.vence}.`,
      'Antecipar é outro ato, e não se chama prorrogação.') as Res<T>;
  }

  const redigida = redigir(justificativa).texto;
  try {
    banco.auditAppend({
      ator: req.ator, atorPapel: req.papel, acao: 'OBRIGACAO_PRORROGADA',
      recursoTipo: 'obrigacao', recursoId: o.codigo,
      justificativa: redigida,
      // A data antiga e a nova entram no payload do hash: prorrogação fora da
      // cadeia seria prorrogação adulterável sem quebrar a prova.
      campos: [o.vence, para],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a prorrogação.';
    return erro(503, msg, 'Sem registro não há prorrogação: a data antiga continua valendo.') as Res<T>;
  }

  const de = o.vence;
  o.prorrogacoes = [...(o.prorrogacoes ?? []), {
    de, para, justificativa: redigida, ator: req.ator, quando: new Date().toISOString(),
  }];
  o.vence = para;
  return ok({ codigo: o.codigo, de, para, diasAte: diasAte(o, Date.now()) }) as Res<T>;
}

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
  const texto = banco.textoVigenteDe(campoId);
  if (!texto) return erro(404, 'Não encontrado.') as Res<T>;

  const hoje = new Date().toISOString().slice(0, 10);
  /**
   * Sob a entidade, a revogação do balcão é o que ela sempre disse ser: revoga
   * **cada aceite vivo** daquele campo, um fato por pessoa. Antes ela virava um
   * único rótulo, e por isso conseguia cessar o tratamento de trinta mil
   * titulares sem que nenhum deles tivesse pedido.
   */
  const vivos = banco.cenario.consentimentos
    .filter((c) => banco.cenario.consentimentoTextos.some(
      (t) => t.id === c.textoId && t.campoId === campoId,
    ))
    .map((c) => banco.consentimentoDe(c.titularId, campoId, hoje))
    .filter((x): x is NonNullable<typeof x> => Boolean(x) && x!.estado === 'ativo');

  if (vivos.length === 0) {
    return erro(409, `Não há consentimento ativo de ${campoId} para revogar.`,
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
      recursoTipo: 'consentimento', recursoId: `${campoId}@${texto.versao}`,
      justificativa: motivo || undefined, campos: [campoId, `aceites=${vivos.length}`],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a revogação.';
    return erro(503, msg, 'Revogação sem registro não é oponível a ninguém.') as Res<T>;
  }

  /**
   * Um fato novo por aceite. O aceite em si não é tocado — é ele que prova que
   * houve consentimento enquanto houve tratamento, e o Art. 8º, §2º cobra essa
   * prova inclusive depois da revogação.
   */
  const agora = Date.now();
  for (const v of vivos) {
    banco.revogacoesTitular.push({
      id: `rev_${sha256(`${v.aceite.id}|${agora}`).slice(0, 10)}`,
      consentimentoId: v.aceite.id,
      titularId: v.aceite.titularId,
      campoId,
      canal: 'balcao',
      revogadoEmMs: agora,
      cascata: [],
    });
  }

  // A consequência sai do mesmo ato: o gate volta a bloquear o repositório do
  // campo, como já acontece com RIPD pendente.
  for (const g of gates) { g.conclusao = 'failure'; g.bloqueouMerge = true; }

  return ok({
    campoId, estado: 'revogado', aceitesRevogados: vivos.length, gatesBloqueados: gates.length,
  }, 200) as Res<T>;
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
