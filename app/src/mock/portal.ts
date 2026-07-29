/**
 * O portal do titular — o lado de fora (Risco-001, o único P0 da auditoria).
 *
 * O balcão do DPO existia inteiro; a porta de entrada do titular não existia em
 * contrato algum. Pela régua do próprio checklist do repositório, *direito sem
 * endpoint com prazo, autenticação e log não existe no sistema* — e o contrato
 * enumerava dez direitos sem nenhuma rota que os exercesse.
 *
 * Este arquivo é uma **superfície separada**, e não mais um punhado de `case`
 * em `api.ts`. O motivo não é organização:
 *
 * - **Não há papel.** O titular não é ator da organização, e inventar um papel
 *   "titular" faria a matriz interna de permissões decidir sobre alguém que
 *   está do outro lado do balcão. O que autoriza aqui é a verificação.
 * - **A recusa é outra.** No console, fora de escopo responde 403 ou 404
 *   uniforme. Aqui responde **401 uniforme**: sem confirmação de identidade não
 *   há resposta, e a recusa precisa ser a mesma para "código errado", "fator
 *   errado" e "esse identificador não é de ninguém".
 * - **O nível vem do direito.** Nenhuma rota daqui lê `nivel_verificacao` do
 *   corpo. Se lesse, bastaria pedir eliminação com nível 1.
 *
 * Verificação e validação continuam separadas, como em `estados.ts`: aqui se
 * pergunta *a rota existe e a identidade está confirmada?*; o que o direito
 * exige de conteúdo é validação, e responde 422.
 */

import { BancoMock, FalhaDeAuditoria } from './db';
import { POLITICA_PADRAO_PORTAL, politicaDe } from './politicas';
import {
  DIREITOS, MS_POR_DIA, REGIME, eDireito, fatoresDe, nivelExigido, prazoDiasDe, prazoLimiteDe,
} from './direitos';
import { redigir } from '../lib/redator';
import { sha256 } from '../lib/sha256';
import type { Res } from './api';
import type {
  Direito, ItemDaCascata, ItemRetido, SessaoTitular, Solicitacao, Titular, VerificacaoTitular,
} from './types';

export interface ReqPortal {
  metodo: 'GET' | 'POST';
  caminho: string;
  /** O token de `POST /me/verificacao/{id}/codigo`. Vai no cabeçalho `X-Verificacao`. */
  sessao?: string;
  body?: Record<string, unknown>;
}

const ok = <T>(body: T, status = 200): Res<T> => ({ status, body });
const erro = (status: number, mensagem: string, regra?: string): Res<{ erro: string }> =>
  ({ status, body: { erro: mensagem }, regra });

/**
 * A recusa. Uma só, e por isso é uma constante e não uma função com parâmetros.
 *
 * Se houvesse `naoConfirmado('codigo errado')` e `naoConfirmado('sem cadastro')`,
 * alguém acabaria passando mensagens diferentes — e o par de respostas viraria
 * um oráculo de cadastro operável em lote, que é o defeito que a tela 11 do
 * portal existe para não ter. O corpo é literalmente o mesmo objeto, montado do
 * mesmo jeito, em todos os caminhos de falha.
 */
const RECUSA = {
  status: 401,
  body: { erro: 'Não foi possível confirmar sua identidade.' },
  regra: 'Sem confirmação, ninguém acessa nem apaga seus dados — nem nós. A recusa é a mesma para '
    + 'código errado, fator errado e identificador sem cadastro: duas recusas diferentes contariam '
    + 'quem está cadastrado.',
} as const;

const naoConfirmado = <T>(): Res<T> => ({
  status: RECUSA.status,
  body: { ...RECUSA.body } as unknown as T,
  regra: RECUSA.regra,
});

const MINUTOS = 60_000;
const VALIDADE_DA_VERIFICACAO = 15 * MINUTOS;
const VALIDADE_DA_SESSAO = 30 * MINUTOS;
const VALIDADE_DO_PACOTE = 24 * 60 * MINUTOS;
const DESCARTE_DO_DOCUMENTO_DIAS = 30;
const TENTATIVAS_POR_VERIFICACAO = 5;
const ALERTA_DE_PROPAGACAO_HORAS = 24;

const CAMINHO_DA_ANPD = 'Se a resposta não resolver, você pode reclamar à ANPD — gov.br/anpd. '
  + 'Pedir revisão aqui e procurar a autoridade não são caminhos excludentes.';

let sequencia = 0;
const novoId = (prefixo: string): string => {
  sequencia += 1;
  return `${prefixo}_${sha256(`${prefixo}|${sequencia}`).slice(0, 12)}`;
};

/** Seis dígitos. Sai pelo canal, nunca por uma resposta HTTP. */
const novoCodigo = (): string => {
  sequencia += 1;
  return String(parseInt(sha256(`codigo|${sequencia}`).slice(0, 8), 16) % 1_000_000).padStart(6, '0');
};

const iso = (ms: number): string => new Date(ms).toISOString();
const data = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────────────────────

export function requestPortal<T = unknown>(banco: BancoMock, req: ReqPortal): Res<T> {
  const partes = req.caminho.split('?')[0].replace(/^\/v1\//, '').split('/');
  const body = (req.body ?? {}) as Record<string, any>;
  const agora = Date.now();

  const politica = politicaDe(req.metodo, partes.join('/'), 'portal') ?? POLITICA_PADRAO_PORTAL;

  /**
   * A guarda de sessão sai antes do `switch`, e vale para todas menos as três
   * do começo do fluxo. Rota nova que ninguém declarou cai no padrão do portal,
   * que exige sessão: o esquecimento fecha, não abre.
   */
  const sessao = banco.sessaoTitular(req.sessao, agora);
  if (politica.exigeSessao !== false && !sessao) return naoConfirmado<T>();

  switch (`${req.metodo} ${partes[0]}`) {
    case 'GET me':
    case 'POST me':
      return rotasDoMe<T>(banco, req, partes, body, sessao, agora);

    case 'GET requests':
    case 'POST requests':
      return rotasDeSolicitacao<T>(banco, req, partes, body, sessao, agora);

    default:
      break;
  }
  return erro(404, `Rota não encontrada: ${req.metodo} ${req.caminho}`) as Res<T>;
}

// ── /me/* ────────────────────────────────────────────────────────────────────

function rotasDoMe<T>(
  banco: BancoMock, req: ReqPortal, partes: string[], body: Record<string, any>,
  sessao: SessaoTitular | null, agora: number,
): Res<T> {
  const alvo = partes[1];

  // 01 · o cardápio. Não pergunta nada antes de oferecer.
  if (req.metodo === 'GET' && alvo === 'direitos' && !partes[2]) {
    return ok({
      direitos: DIREITOS.map((d) => ({
        direito: d,
        rotulo: REGIME[d].rotulo,
        artigo: REGIME[d].artigo,
        nivel: REGIME[d].nivel,
        por_que_o_nivel: REGIME[d].porQueONivel,
        fatores: fatoresDe(d),
        prazo_dias: prazoDiasDe(d),
        fundamento_do_prazo: REGIME[d].fundamentoDoPrazo,
      })),
    }) as Res<T>;
  }

  if (req.metodo === 'POST' && alvo === 'verificacao' && !partes[2]) {
    return abrirVerificacao<T>(banco, body, agora);
  }
  if (req.metodo === 'POST' && alvo === 'verificacao' && partes[3] === 'codigo') {
    return confirmarVerificacao<T>(banco, partes[2], body, agora);
  }

  if (alvo === 'consentimentos') {
    if (req.metodo === 'GET' && !partes[2]) return consentimentosDoTitular<T>(banco, sessao!);
    if (req.metodo === 'POST' && partes[3] === 'revogacao') {
      return revogar<T>(banco, sessao!, partes[2], agora);
    }
    if (req.metodo === 'GET' && partes[3] === 'propagacao') {
      return propagacao<T>(banco, sessao!, partes[2], agora);
    }
  }

  if (alvo === 'decisoes' && partes[2]) {
    if (req.metodo === 'GET' && !partes[3]) return decisaoDoTitular<T>(banco, sessao!, partes[2]);
    if (req.metodo === 'POST' && partes[3] === 'revisao') {
      return pedirRevisao<T>(banco, sessao!, partes[2], body, agora);
    }
  }

  return erro(404, `Rota não encontrada: ${req.metodo} ${req.caminho}`) as Res<T>;
}

/**
 * 02 · abre a verificação no nível que o direito exige.
 *
 * Responde 201 **sempre**, e cria o registro mesmo quando o identificador não é
 * de ninguém: é o que permite que a confirmação recuse depois pelo mesmo
 * caminho. A tentativa não confirmada não vira cadastro — o registro morre com
 * a expiração.
 */
function abrirVerificacao<T>(banco: BancoMock, body: Record<string, any>, agora: number): Res<T> {
  const direito = body.direito;
  if (!eDireito(direito)) {
    return erro(422, 'Direito desconhecido.',
      `Os que o portal exerce são: ${DIREITOS.join(', ')}.`) as Res<T>;
  }
  const canal = body.canal;
  if (canal !== 'email' && canal !== 'sms') {
    return erro(422, 'Canal inválido.', 'O código sai por e-mail ou SMS — o canal que já é seu.') as Res<T>;
  }
  const identificadorHash = String(body.identificador_hash ?? '');
  if (identificadorHash.length < 8) {
    return erro(422, 'Identificador ausente.',
      'O e-mail ou telefone digitado não sai do navegador: o que chega aqui é o hash dele.') as Res<T>;
  }

  /**
   * O nível é derivado aqui, e `body.nivel_verificacao` é ignorado sem cerimônia.
   * Não há nem uma leitura desse campo neste arquivo — é a forma mais simples de
   * garantir que ninguém o "aproveite" numa refatoração distraída.
   */
  const nivel = nivelExigido(direito);
  const titular = banco.cenario.titulares.find((t) => casaComOIdentificador(t, identificadorHash));

  const verificacao: VerificacaoTitular = {
    id: novoId('ver'),
    direito,
    nivelExigido: nivel,
    canal,
    identificadorHash,
    codigo: novoCodigo(),
    titularId: titular?.id ?? null,
    criadaEmMs: agora,
    expiraEmMs: agora + VALIDADE_DA_VERIFICACAO,
    tentativas: 0,
  };
  banco.registrarVerificacao(verificacao);

  return ok({
    id: verificacao.id,
    nivel_exigido: nivel,
    fatores_exigidos: fatoresDe(direito),
    canal,
    expira_em: iso(verificacao.expiraEmMs),
    // Dito **antes** do envio, e não depois. Depende do direito, não do cadastro.
    ...(nivel === 3
      ? {
        destino_do_documento: `Uso único para conferir que é você. Não entra no seu cadastro e é `
          + `descartado em ${DESCARTE_DO_DOCUMENTO_DIAS} dias, com registro.`,
      }
      : {}),
  }, 201) as Res<T>;
}

const casaComOIdentificador = (t: Titular, hash: string): boolean =>
  sha256(t.segredos.email ?? '') === hash
  || (Boolean(t.segredos.telefone) && sha256(t.segredos.telefone) === hash);

/**
 * 02b · confirma, e emite a sessão.
 *
 * Todas as conferências viram **um** booleano antes de qualquer retorno. É
 * deliberado: com `return` no meio, cada conferência nova é uma chance de
 * alguém devolver uma mensagem própria "só para ajudar o usuário" — e a ajuda
 * de uma tela é o oráculo de outra.
 *
 * Falta de um fator exigido é 422, e é seguro que seja: o fator exigido deriva
 * do direito, que o cliente já sabe antes de chamar. Não diz nada sobre quem
 * está do outro lado.
 */
function confirmarVerificacao<T>(
  banco: BancoMock, id: string, body: Record<string, any>, agora: number,
): Res<T> {
  const v = banco.verificacao(id);
  const fatores = v ? fatoresDe(v.direito) : [];

  if (v && !v.confirmadaEmMs && v.expiraEmMs > agora) {
    if (fatores.includes('dado_cadastro') && !body.dado_cadastro_hash) {
      return erro(422, 'Falta o dado de cadastro que este pedido exige.',
        'Nível 2: código mais um dado que só você tem no cadastro.') as Res<T>;
    }
    if (fatores.includes('documento') && !body.documento_hash) {
      return erro(422, 'Falta o documento com foto que este pedido exige.',
        'Nível 3: o pedido é irreversível, e por isso a conferência é a mais forte.') as Res<T>;
    }
  }

  if (!v) return naoConfirmado<T>();
  v.tentativas += 1;

  const titular = v.titularId
    ? banco.cenario.titulares.find((t) => t.id === v.titularId) ?? null
    : null;
  const documento = String(body.documento_hash ?? '');

  const confere = v.expiraEmMs > agora
    && !v.confirmadaEmMs
    && v.tentativas <= TENTATIVAS_POR_VERIFICACAO
    && titular !== null
    && v.codigo === String(body.codigo ?? '')
    && (!fatores.includes('dado_cadastro') || titular.cpfHash === String(body.dado_cadastro_hash ?? ''))
    && (!fatores.includes('documento') || documento.length >= 16);

  if (!confere) {
    /**
     * A recusa é registrada — tentativa de confirmação é evento de segurança, e
     * enumeração em lote precisa deixar rastro. Mas a falha do registro **não**
     * muda a resposta: um 503 aqui seria distinguível do 401 por quem
     * conseguisse derrubar o trail, e nada de titular sai numa recusa. A regra
     * "gravar antes de responder" protege a *revelação* de dado, e aqui não há
     * dado a revelar.
     */
    try {
      banco.auditAppend({
        ator: 'portal', atorPapel: 'titular', acao: 'VERIFICACAO_RECUSADA',
        recursoTipo: 'verificacao', recursoId: v.id, campos: [v.direito, `nivel=${v.nivelExigido}`],
        resultado: 'negado',
      });
    } catch { /* a recusa é a mesma com ou sem trail — ver comentário acima */ }
    return naoConfirmado<T>();
  }

  const sessao: SessaoTitular = {
    token: novoId('sess'),
    verificacaoId: v.id,
    titularId: titular!.id,
    direito: v.direito,
    nivelAtingido: v.nivelExigido,
    expiraEmMs: agora + VALIDADE_DA_SESSAO,
  };

  if (v.nivelExigido === 3) {
    v.documentoImpressao = documento.slice(0, 12);
    v.documentoDescartaEmMs = agora + DESCARTE_DO_DOCUMENTO_DIAS * MS_POR_DIA;
  }

  try {
    banco.auditAppend({
      ator: 'portal', atorPapel: 'titular', acao: 'VERIFICACAO_CONFIRMADA',
      recursoTipo: 'verificacao', recursoId: v.id,
      campos: [
        v.direito, `nivel=${v.nivelExigido}`, `titular=${pseudonimo(titular!)}`,
        ...(v.documentoDescartaEmMs ? [`documento_descarta_em=${data(v.documentoDescartaEmMs)}`] : []),
      ],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a confirmação.';
    return erro(503, msg, 'Verificação que não fica registrada não sustenta o que vem depois dela.') as Res<T>;
  }

  v.confirmadaEmMs = agora;
  banco.abrirSessaoTitular(sessao);

  return ok({
    sessao: sessao.token,
    nivel_atingido: sessao.nivelAtingido,
    direito: sessao.direito,
    expira_em: iso(sessao.expiraEmMs),
    ...(v.documentoDescartaEmMs ? { documento_descartado_em: iso(v.documentoDescartaEmMs) } : {}),
  }) as Res<T>;
}

const pseudonimo = (t: Titular): string => `hmac:${t.cpfHash.slice(0, 4)}…${t.cpfHash.slice(-4)}`;

// ── /requests/* ──────────────────────────────────────────────────────────────

function rotasDeSolicitacao<T>(
  banco: BancoMock, req: ReqPortal, partes: string[], body: Record<string, any>,
  sessao: SessaoTitular | null, agora: number,
): Res<T> {
  if (req.metodo === 'POST' && !partes[1]) return abrirSolicitacao<T>(banco, sessao!, body, agora);

  const s = banco.cenario.solicitacoes.find((x) => x.protocolo === partes[1] || x.id === partes[1]);

  /**
   * Protocolo inexistente, de outra pessoa, ou acima do nível da sessão: a
   * mesma recusa. Um 404 para "não existe" e um 401 para "não é seu" diriam,
   * juntos, quais protocolos existem.
   */
  if (!s || s.titularId !== sessao!.titularId
    || sessao!.nivelAtingido < nivelExigido(s.direito)) {
    return naoConfirmado<T>();
  }

  if (req.metodo === 'GET' && !partes[2]) return ok(vistaDoTitular(s, agora)) as Res<T>;
  if (req.metodo === 'GET' && partes[2] === 'pacote') return pacote<T>(s, sessao!, agora);
  if (req.metodo === 'POST' && partes[2] === 'mensagens') return mensagem<T>(banco, s, body);

  return erro(404, `Rota não encontrada: ${req.metodo} ${req.caminho}`) as Res<T>;
}

/**
 * 03 e 04 · abre a solicitação.
 *
 * O prazo é calculado **aqui**, do direito, e gravado antes de o protocolo
 * existir. O texto livre é opcional e a tela diz isso: o direito não depende de
 * justificativa, e pedir uma produziria justificativa de fachada.
 */
function abrirSolicitacao<T>(
  banco: BancoMock, sessao: SessaoTitular, body: Record<string, any>, agora: number,
): Res<T> {
  const direito = body.direito;
  if (!eDireito(direito)) {
    return erro(422, 'Direito desconhecido.',
      `Os que o portal exerce são: ${DIREITOS.join(', ')}.`) as Res<T>;
  }

  const nivel = nivelExigido(direito);
  if (sessao.direito !== direito || sessao.nivelAtingido < nivel) {
    return erro(403, 'Esta confirmação não alcança este pedido.',
      `"${REGIME[direito].rotulo}" exige verificação de nível ${nivel}, e a sua foi de nível `
      + `${sessao.nivelAtingido} para outro pedido. O nível vem do direito, não do que se pede no corpo.`) as Res<T>;
  }

  const titular = banco.cenario.titulares.find((t) => t.id === sessao.titularId)!;
  const detalhe = body.texto ? redigir(String(body.texto)) : null;
  const prazoLimiteMs = prazoLimiteDe(direito, agora);
  const protocolo = banco.proximoProtocoloPortal();

  /**
   * Gravar, depois responder. Se o trail falha, **o protocolo não é criado** —
   * não existe solicitação sem registro de que ela nasceu, e o titular recebe
   * um erro em vez de um número que não se sustenta em auditoria.
   */
  try {
    banco.auditAppend({
      ator: 'portal', atorPapel: 'titular', acao: 'SOLICITACAO_ABERTA',
      recursoTipo: 'solicitacao', recursoId: protocolo, protocolo,
      justificativa: detalhe?.texto,
      campos: [direito, `nivel=${nivel}`, `prazo_limite=${data(prazoLimiteMs)}`, pseudonimo(titular)],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a abertura.';
    return erro(503, msg,
      'Sem registro não há protocolo: a ordem é gravar, depois responder (Art. 37).') as Res<T>;
  }

  const nova: Solicitacao = {
    id: novoId('sol'),
    protocolo,
    titularId: titular.id,
    titularPseudonimo: pseudonimo(titular),
    direito,
    status: 'recebida',
    // O derivado. `body.nivel_verificacao` não é lido em lugar nenhum deste arquivo.
    nivelVerificacao: nivel,
    origem: 'portal',
    detalhe: detalhe?.texto,
    sistemas: banco.cenario.sistemas.map((s) => s.slug),
    recebidaEm: data(agora),
    prazoLimiteMs,
    metaInternaMs: agora + Math.floor(prazoDiasDe(direito) / 2) * MS_POR_DIA,
    mensagens: [],
  };
  banco.cenario.solicitacoes.push(nova);

  return ok({
    protocolo,
    direito,
    nivel_verificacao: nivel,
    prazo_limite: iso(prazoLimiteMs),
    prazo_dias: prazoDiasDe(direito),
    fundamento_do_prazo: REGIME[direito].fundamentoDoPrazo,
    // As três etapas seguintes, ditas antes de o titular sair da tela.
    proximos_passos: [
      'Recebemos seu pedido e ele já está na fila do encarregado.',
      `Analisamos o que existe sobre você e o que a lei obriga a manter — até ${data(prazoLimiteMs)}.`,
      'Você recebe a resposta por aqui e pode conversar por esta mesma tela a qualquer momento.',
    ],
  }, 201) as Res<T>;
}

/**
 * 05 e 07 · o pedido visto por quem o abriu.
 *
 * A tela do atendimento parcial é a mais importante do portal, e é esta função
 * que a alimenta: separa apagado de retido, nomeia a lei de cada retenção e dá
 * a data de eliminação de cada resíduo. Havendo retenção ou recusa, o caminho
 * da ANPD sai **junto** — esconder a autoridade é o que transforma insatisfação
 * em denúncia.
 */
function vistaDoTitular(s: Solicitacao, agora: number) {
  const retidos = s.retidos ?? [];
  const houveNegativa = retidos.length > 0 || s.status === 'recusada_com_fundamento'
    || s.desfecho === 'atendido_parcialmente';
  return {
    protocolo: s.protocolo,
    direito: s.direito,
    rotulo: REGIME[s.direito].rotulo,
    estado: s.status,
    prazo_limite: iso(s.prazoLimiteMs),
    dias_restantes: Math.ceil((s.prazoLimiteMs - agora) / MS_POR_DIA),
    ...(s.desfecho ? { desfecho: s.desfecho } : {}),
    ...(s.fundamento ? { fundamento: s.fundamento } : {}),
    andamento: andamentoDe(s),
    apagados: s.apagados ?? [],
    retidos: retidos.map(paraOContrato),
    mensagens: s.mensagens,
    ...(houveNegativa ? { caminho_da_anpd: CAMINHO_DA_ANPD } : {}),
  };
}

/**
 * O item retido na grafia do contrato.
 *
 * O modelo interno é camelCase como o resto do mock; o contrato escreve
 * `base_legal` e `retencao_ate`. A conversão mora nesta função e em
 * `normalizarRetidos` (api.ts), uma em cada ponta — não espalhada pelas rotas.
 */
const paraOContrato = (r: ItemRetido) => ({
  item: r.item,
  base_legal: r.baseLegal,
  ...(r.artigo ? { artigo: r.artigo } : {}),
  retencao_ate: r.retencaoAte,
  ...(r.motivo ? { motivo: r.motivo } : {}),
});

const andamentoDe = (s: Solicitacao) => {
  const concluida = s.status === 'concluida' || s.status === 'recusada_com_fundamento';
  return [
    { etapa: 'Pedido recebido', quando: s.recebidaEm, concluida: true },
    { etapa: 'Em análise', quando: s.recebidaEm, concluida: s.status !== 'recebida' },
    {
      etapa: 'Resposta enviada',
      quando: s.concluidaEm ?? data(s.prazoLimiteMs),
      concluida,
    },
  ];
};

/** 06 · o pacote, por link assinado de 24 h — com a frase que justifica a validade curta. */
function pacote<T>(s: Solicitacao, sessao: SessaoTitular, agora: number): Res<T> {
  if (!s.desfecho) {
    return erro(409, 'A resposta ainda não ficou pronta.',
      `Seu pedido vence em ${data(s.prazoLimiteMs)}; não há pacote a assinar antes disso.`) as Res<T>;
  }
  const expiraEm = agora + VALIDADE_DO_PACOTE;
  const assinatura = sha256(`pacote|${s.protocolo}|${sessao.token}|${expiraEm}`).slice(0, 32);
  return ok({
    uri: `https://portal.lastro.exemplo/pacotes/${s.protocolo}/${assinatura}`,
    expira_em: iso(expiraEm),
    hash: assinatura,
    por_que_expira: 'O link vale 24 horas para não ficar circulando por aí. Vencido, você pede de '
      + 'novo aqui, sem custo e sem precisar explicar.',
    sumario: [
      `Pedido de "${REGIME[s.direito].rotulo}" — protocolo ${s.protocolo}.`,
      `${(s.apagados ?? []).length} item(ns) apagado(s).`,
      `${(s.retidos ?? []).length} item(ns) retido(s), cada um com a lei e a data de eliminação.`,
    ],
  }) as Res<T>;
}

/** 05b · a ponta do titular no mesmo canal da T4. */
function mensagem<T>(banco: BancoMock, s: Solicitacao, body: Record<string, any>): Res<T> {
  const corpo = String(body.corpo ?? '').trim();
  if (!corpo) return erro(422, 'A mensagem está vazia.') as Res<T>;
  if (/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(corpo)) {
    return erro(422, 'A mensagem contém CPF em texto claro.',
      'O canal entre você e o encarregado não transporta documento: use o número do protocolo.') as Res<T>;
  }
  // Redigido antes de entrar na conversa, como do lado de dentro (C-04).
  const redacao = redigir(corpo);
  s.mensagens.push({ remetente: 'titular', corpo: redacao.texto, quando: 'agora' });
  void banco;
  return ok({
    enviada: true,
    corpo_gravado: redacao.texto,
    houve_redacao: redacao.houveRemocao,
  }, 201) as Res<T>;
}

// ── consentimento ────────────────────────────────────────────────────────────

/**
 * 08 · minhas autorizações.
 *
 * O registro do cenário é agregado por campo (`titulares: number`) — a entidade
 * de consentimento por titular é o Risco-002, do bloco seguinte. O que dá para
 * fazer com honestidade hoje é o que esta função faz: cruzar os campos **deste**
 * titular cuja base é consentimento com o registro versionado do campo, e
 * derivar o estado individual das revogações que o portal registrou.
 */
function consentimentosDoTitular<T>(banco: BancoMock, sessao: SessaoTitular): Res<T> {
  if (sessao.nivelAtingido < nivelExigido('revogacao')) return naoConfirmado<T>();
  const titular = banco.cenario.titulares.find((t) => t.id === sessao.titularId)!;

  const consentimentos = titular.campos
    .filter((c) => c.baseLegal === 'consentimento' && c.campoCatalogoId)
    .map((c) => {
      const registro = banco.cenario.consentimentos.find((r) => r.campoId === c.campoCatalogoId);
      const revogacao = banco.revogacaoDe(titular.id, c.campoCatalogoId!);
      return {
        id: c.campoCatalogoId!,
        rotulo: c.rotulo,
        texto: registro?.texto ?? '—',
        versao: registro?.versao ?? '—',
        coletado_em: registro?.coletadoEm ?? '—',
        canal: registro?.canal ?? '—',
        hash: registro?.hash ?? '—',
        estado: revogacao ? 'revogado' : (registro?.estado ?? 'ativo'),
        ...(revogacao ? { revogado_em: iso(revogacao.revogadoEmMs) } : {}),
        o_que_voce_perde: oQueSePerde(banco, c.campoCatalogoId!, c.rotulo),
      };
    });

  return ok({ consentimentos }) as Res<T>;
}

/**
 * A consequência, dita **antes** de confirmar.
 *
 * Revogação sem consequência declarada é revogação de fachada: a pessoa
 * confirma, perde uma funcionalidade que não sabia que dependia daquilo, e
 * conclui que o botão a enganou.
 */
function oQueSePerde(banco: BancoMock, campoId: string, rotulo: string): string[] {
  const campo = banco.cenario.campos.find((c) => c.id === campoId);
  if (!campo) return [`${rotulo} deixa de ser usado.`];
  return [
    `${campo.finalidade} deixa de acontecer para você.`,
    ...campo.compartilhamentos.map((c) => `${c.destino} para de receber este dado.`),
    'O que já foi coletado entra na fila de eliminação, com prova de execução.',
  ];
}

/** 09 · retirar a autorização — e a cascata, registrada. */
function revogar<T>(banco: BancoMock, sessao: SessaoTitular, campoId: string, agora: number): Res<T> {
  if (sessao.direito !== 'revogacao' || sessao.nivelAtingido < nivelExigido('revogacao')) {
    return erro(403, 'Esta confirmação não alcança a retirada de autorização.',
      'Retirar uma autorização é o direito do Art. 18, VIII, e a verificação precisa ser dele.') as Res<T>;
  }
  const titular = banco.cenario.titulares.find((t) => t.id === sessao.titularId)!;
  const campoDoTitular = titular.campos.find(
    (c) => c.campoCatalogoId === campoId && c.baseLegal === 'consentimento',
  );
  // Campo que não é seu, ou que não é consentido: a mesma recusa de sempre.
  if (!campoDoTitular) return naoConfirmado<T>();

  if (banco.revogacaoDe(titular.id, campoId)) {
    return erro(409, 'Esta autorização já tinha sido retirada.',
      'Retirar de novo não muda nada; o andamento da primeira está em /propagacao.') as Res<T>;
  }

  const cascata = montarCascata(banco, campoId, agora);
  try {
    banco.auditAppend({
      ator: 'portal', atorPapel: 'titular', acao: 'CONSENTIMENTO_REVOGADO',
      recursoTipo: 'consentimento', recursoId: campoId,
      campos: [pseudonimo(titular), ...cascata.map((c) => `${c.tipo}:${c.alvo}`)],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a revogação.';
    return erro(503, msg,
      'Revogação sem registro não se prova depois — e é justamente a prova que o Art. 8º, §2º exige.') as Res<T>;
  }

  const revogacao = {
    id: novoId('rev'),
    titularId: titular.id,
    campoId,
    revogadoEmMs: agora,
    cascata,
  };
  banco.revogacoesTitular.push(revogacao);

  return ok({
    revogacao_id: revogacao.id,
    campo_id: campoId,
    revogado_em: iso(agora),
    cascata,
    propagacao: `/v1/me/consentimentos/${campoId}/propagacao`,
  }) as Res<T>;
}

/**
 * Três frentes, e não uma lista de sistemas.
 *
 * Revogar exige (i) parar o tratamento onde o dado mora, (ii) avisar quem o
 * recebeu e (iii) eliminar o que já foi coletado. A terceira nasce **pendente**
 * de propósito: o executor de expurgo é externo ao repositório e a plataforma
 * só registra a evidência pós-fato (Risco-006). Fingir que ela já concluiu
 * seria a mesma promessa sem instrumento que a auditoria enumerou — e é
 * exatamente por ficar pendente que o alerta de 24 h tem o que vigiar.
 */
function montarCascata(banco: BancoMock, campoId: string, agora: number): ItemDaCascata[] {
  const campo = banco.cenario.campos.find((c) => c.id === campoId);
  const sistema = banco.cenario.sistemas.find((s) => s.slug === campo?.sistema);
  const itens: ItemDaCascata[] = [];

  itens.push({
    alvo: sistema?.nome ?? campo?.sistema ?? 'sistema de origem',
    tipo: 'cessacao',
    efeito: `${campo?.finalidade ?? 'O tratamento'} para imediatamente.`,
    estado: 'propagado',
    iniciadaEmMs: agora,
    confirmadaEmMs: agora,
  });

  for (const c of campo?.compartilhamentos ?? []) {
    itens.push({
      alvo: c.destino,
      tipo: 'notificacao',
      efeito: `${c.destino} é avisado para parar de usar o dado que recebeu.`,
      estado: 'propagado',
      iniciadaEmMs: agora,
      confirmadaEmMs: agora,
    });
  }

  itens.push({
    alvo: 'Eliminação do que já foi coletado',
    tipo: 'expurgo',
    efeito: campo?.tipoArmazenado === 'criptografado'
      ? 'A chave que protegia esses dados é destruída — sem ela, o que sobrou não volta a ser legível.'
      : 'Os registros já coletados entram no próximo expurgo, com prova de execução.',
    estado: 'pendente',
    iniciadaEmMs: agora,
  });

  return itens;
}

/** 10 · onde a revogação já chegou. */
function propagacao<T>(
  banco: BancoMock, sessao: SessaoTitular, campoId: string, agora: number,
): Res<T> {
  const revogacao = banco.revogacaoDe(sessao.titularId, campoId);
  if (!revogacao) {
    return erro(404, 'Não há retirada de autorização para acompanhar aqui.') as Res<T>;
  }

  const itens = revogacao.cascata.map((c) => {
    const horas = (agora - c.iniciadaEmMs) / (60 * MINUTOS);
    return {
      ...c,
      ...(c.confirmadaEmMs ? { confirmado_em: iso(c.confirmadaEmMs) } : {}),
      ...(c.estado === 'pendente' ? { pendente_ha_horas: Number(horas.toFixed(1)) } : {}),
    };
  });
  const pendentes = revogacao.cascata.filter((c) => c.estado === 'pendente');
  const atrasado = pendentes.find(
    (c) => agora - c.iniciadaEmMs > ALERTA_DE_PROPAGACAO_HORAS * 60 * MINUTOS,
  );

  return ok({
    campo_id: campoId,
    itens,
    pendentes: pendentes.length,
    // Visível ao titular, e não só interno: quem esperou precisa saber que a
    // espera já é anormal — senão o alerta serve só a quem causou o atraso.
    alerta: Boolean(atrasado),
    ...(atrasado
      ? {
        alerta_desde: iso(atrasado.iniciadaEmMs + ALERTA_DE_PROPAGACAO_HORAS * 60 * MINUTOS),
        alerta_texto: `"${atrasado.alvo}" está pendente há mais de ${ALERTA_DE_PROPAGACAO_HORAS} h. `
          + 'Isso já virou um alerta interno, e você pode cobrar pelo canal do seu protocolo.',
      }
      : {}),
  }) as Res<T>;
}

// ── decisão automatizada ─────────────────────────────────────────────────────

/** 11 · os fatores da decisão (Art. 20, §1º), em linguagem de pessoa. */
function decisaoDoTitular<T>(banco: BancoMock, sessao: SessaoTitular, id: string): Res<T> {
  if (sessao.nivelAtingido < nivelExigido('revisao_decisao')) return naoConfirmado<T>();
  const titular = banco.cenario.titulares.find((t) => t.id === sessao.titularId);
  const decisao = titular?.decisao;
  // Decisão de outra pessoa responde igual a não confirmado.
  if (!decisao || decisao.id !== id) return naoConfirmado<T>();

  return ok({
    id: decisao.id,
    modelo: decisao.modelo,
    aprovado: decisao.aprovado,
    fatores: decisao.shap.map((f) => ({
      fator: f.feature,
      peso: Math.abs(f.impacto),
      sentido: f.impacto >= 0 ? 'a_favor' : 'contra',
    })),
    revisao: decisao.revisao
      ? {
        resultado: decisao.revisao.resultado,
        fundamento: decisao.revisao.fundamento,
        quando: decisao.revisao.quando,
      }
      : null,
  }) as Res<T>;
}

/**
 * 11b · contestar (Art. 20).
 *
 * Abre a solicitação com prazo de cinco dias e devolve o protocolo. O
 * `fundamento` é **opcional**: contestar não pode depender de o titular saber
 * argumentar contra um modelo cujos critérios ele acabou de conhecer.
 */
function pedirRevisao<T>(
  banco: BancoMock, sessao: SessaoTitular, id: string, body: Record<string, any>, agora: number,
): Res<T> {
  if (sessao.direito !== 'revisao_decisao') {
    return erro(403, 'Esta confirmação não alcança o pedido de revisão.',
      'Rever uma decisão automática é o direito do Art. 20, e a verificação precisa ser dele.') as Res<T>;
  }
  const titular = banco.cenario.titulares.find((t) => t.id === sessao.titularId)!;
  const decisao = titular.decisao;
  if (!decisao || decisao.id !== id) return naoConfirmado<T>();
  if (decisao.revisao) {
    return erro(409, 'Esta decisão já foi revisada por uma pessoa.',
      'A revisão é ato único e registrado; rever de novo é um pedido novo.') as Res<T>;
  }

  const fundamento = body.fundamento ? redigir(String(body.fundamento)).texto : undefined;
  const prazoLimiteMs = prazoLimiteDe('revisao_decisao', agora);
  const protocolo = banco.proximoProtocoloPortal();

  try {
    banco.auditAppend({
      ator: 'portal', atorPapel: 'titular', acao: 'REVISAO_SOLICITADA',
      recursoTipo: 'decisao_automatizada', recursoId: decisao.id, protocolo,
      justificativa: fundamento,
      campos: [pseudonimo(titular), `prazo_limite=${data(prazoLimiteMs)}`],
    });
  } catch (e) {
    const msg = e instanceof FalhaDeAuditoria ? e.message : 'Falha ao registrar a contestação.';
    return erro(503, msg, 'Sem registro não há protocolo.') as Res<T>;
  }

  banco.cenario.solicitacoes.push({
    id: novoId('sol'),
    protocolo,
    titularId: titular.id,
    titularPseudonimo: pseudonimo(titular),
    direito: 'revisao_decisao',
    status: 'recebida',
    nivelVerificacao: nivelExigido('revisao_decisao'),
    origem: 'portal',
    detalhe: fundamento,
    sistemas: banco.cenario.sistemas.map((s) => s.slug),
    recebidaEm: data(agora),
    prazoLimiteMs,
    metaInternaMs: agora + 2 * MS_POR_DIA,
    mensagens: [],
  });

  return ok({
    protocolo,
    direito: 'revisao_decisao' as Direito,
    nivel_verificacao: nivelExigido('revisao_decisao'),
    prazo_limite: iso(prazoLimiteMs),
    prazo_dias: prazoDiasDe('revisao_decisao'),
    fundamento_do_prazo: REGIME.revisao_decisao.fundamentoDoPrazo,
    proximos_passos: [
      'Sua contestação foi registrada com prova imutável.',
      `Uma pessoa — não o modelo — revê a decisão até ${data(prazoLimiteMs)}.`,
      'Você recebe o resultado e o fundamento por aqui, mesmo que a decisão seja mantida.',
    ],
  }, 201) as Res<T>;
}
