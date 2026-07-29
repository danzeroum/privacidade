import { sha256 } from '../lib/sha256';
import { CENARIOS } from './scenarios';
import { estadoDe, expiraEm } from './consentimento';
import type { Consentimento, TextoDeConsentimento } from './consentimento';
import type { Fornecedor } from './fornecedor';
import type {
  AuditLinha, BaseLegal, Cenario, Finalidade, Papel, Reclassificacao,
  OposicaoTitular, RevogacaoTitular, SessaoTitular, VerificacaoTitular,
} from './types';

export interface EntradaAudit {
  ator: string;
  atorPapel: Papel | 'system' | 'titular';
  acao: string;
  recursoTipo: string;
  recursoId: string;
  finalidade?: Finalidade;
  /** Risco-004 — a base legal que autorizou o tratamento. Entra no payload do hash. */
  baseLegal?: BaseLegal;
  justificativa?: string;
  /** T4-01 — o protocolo sob o qual o acesso aconteceu. Entra no payload do hash. */
  protocolo?: string;
  campos?: string[];
  resultado?: 'sucesso' | 'negado' | 'erro';
}

/** Ações que tocam dado pessoal: sem finalidade e justificativa, não entram no log (Art. 37). */
const ACOES_PII = ['CAMPO_REVELADO', 'TITULAR_CONSULTADO', 'PSEUDONIMO_RESOLVIDO'];

/**
 * Ações que exigem finalidade, mas não prosa. Localizar um titular é passo
 * intermediário: o que sustenta a operação em auditoria é a finalidade
 * declarada mais o identificador truncado. Exigir justificativa de 20
 * caracteres a cada busca só produziria texto de fachada.
 */
const ACOES_COM_FINALIDADE = ['TITULAR_BUSCADO'];

export class FalhaDeAuditoria extends Error {}
export class LogImutavel extends Error {}

/**
 * Banco em memória. Não é um PostgreSQL — é uma reprodução fiel das restrições
 * que o `db/schema.sql` impõe, para que o protótipo demonstre o comportamento
 * e não apenas a aparência.
 */
export class BancoMock {
  cenario: Cenario;
  auditoria: AuditLinha[] = [];
  reclassificacoes: Reclassificacao[] = [];
  /** Interruptor da demonstração "se o log falhar, a resposta falha". */
  simularFalhaDeLog = false;

  /**
   * Modo demonstração. As rotas que simulam ataque (`POST /v1/audit/forjar`)
   * só existem com ele ligado — e ainda assim exigem a ação `escrever`. Uma
   * rota de ataque presa a uma condição só é uma condição a menos do que ela
   * precisa.
   */
  modoDemo = true;

  private proximoId = 1;

  /** Carimbos de busca por ator, para o limite de taxa. Busca em rajada é enumeração. */
  private buscasPorAtor = new Map<string, number[]>();

  // ── Portal do titular ────────────────────────────────────────────────────

  /**
   * Verificações em curso, cadastradas ou não.
   *
   * `private` de propósito: o único caminho para o código é `codigoDaVerificacao`,
   * que existe para o teste e para a demonstração — na vida real o código sai
   * pelo canal e nunca por uma leitura de memória. Deixá-lo acessível pela
   * estrutura convidaria alguma tela a "só conferir" e o segredo viraria dado.
   */
  private verificacoes = new Map<string, VerificacaoTitular>();

  private sessoesTitular = new Map<string, SessaoTitular>();

  /** Revogações por titular, com a cascata de cada uma. */
  revogacoesTitular: RevogacaoTitular[] = [];

  /** Oposições por titular (Art. 18, §2º), uma por LIA. */
  oposicoesTitular: OposicaoTitular[] = [];

  /**
   * As chaves de lote já executadas — o `UNIQUE (lote_chave)` do schema, em
   * memória. É o que faz a segunda execução do mesmo dia ser no-op.
   */
  lotesDeExpurgo = new Set<string>();

  private proximoIdPortal = 1;

  /** Identificador sequencial do portal. Separado do `proximoId` do trail de propósito. */
  proximoProtocoloPortal(): string {
    return `P-${String(this.proximoIdPortal++).padStart(4, '0')}`;
  }

  registrarVerificacao(v: VerificacaoTitular): void {
    this.verificacoes.set(v.id, v);
  }

  verificacao(id: string): VerificacaoTitular | undefined {
    return this.verificacoes.get(id);
  }

  /**
   * O código, para teste e demonstração — nunca para uma resposta HTTP.
   *
   * Devolve string vazia para verificação inexistente, e não `undefined`: quem
   * chamar com id inventado recebe algo que nunca confere, em vez de um erro
   * que diferencia "não existe" de "não confere".
   */
  codigoDaVerificacao(id: string): string {
    return this.verificacoes.get(id)?.codigo ?? '';
  }

  abrirSessaoTitular(s: SessaoTitular): void {
    this.sessoesTitular.set(s.token, s);
  }

  sessaoTitular(token: string | undefined, agoraMs = Date.now()): SessaoTitular | null {
    if (!token) return null;
    const s = this.sessoesTitular.get(token);
    if (!s || s.expiraEmMs <= agoraMs) return null;
    return s;
  }

  /** A revogação deste titular para este campo, se houver. */
  revogacaoDe(titularId: string, campoId: string): RevogacaoTitular | undefined {
    return this.revogacoesTitular.find((r) => r.titularId === titularId && r.campoId === campoId);
  }

  // ── fornecedor como entidade (Risco-008) ─────────────────────────────────

  /** O parceiro por chave. Sem entidade, o mesmo nome era uma string por linha. */
  fornecedor(id: string): Fornecedor | undefined {
    return this.cenario.fornecedores.find((f) => f.id === id);
  }

  /** O nome para exibir. Nunca o id: chave é para juntar, não para ler. */
  nomeDoFornecedor(id: string): string {
    return this.fornecedor(id)?.nome ?? id;
  }

  // ── consentimento como entidade (Risco-002) ──────────────────────────────

  /** O texto vigente de um campo: a última versão publicada. Derivado, não marcado. */
  textoVigenteDe(campoId: string): TextoDeConsentimento | undefined {
    return [...this.cenario.consentimentoTextos]
      .filter((t) => t.campoId === campoId && t.vigente)
      .sort((a, b) => a.publicadoEm.localeCompare(b.publicadoEm))
      .at(-1);
  }

  /** O aceite **deste** titular para **este** campo, qualquer que seja a versão. */
  aceiteDe(titularId: string, campoId: string): Consentimento | undefined {
    const textos = new Set(
      this.cenario.consentimentoTextos.filter((t) => t.campoId === campoId).map((t) => t.id),
    );
    return this.cenario.consentimentos.find(
      (c) => c.titularId === titularId && textos.has(c.textoId),
    );
  }

  /**
   * O estado do consentimento de um titular sobre um campo, derivado dos fatos.
   *
   * Devolve `null` quando não há aceite nenhum — que é diferente de revogado e
   * de expirado, e por isso não vira um quarto valor do enum: ausência de fato
   * não é estado do fato.
   */
  consentimentoDe(titularId: string, campoId: string, hojeIso = new Date().toISOString().slice(0, 10)) {
    const aceite = this.aceiteDe(titularId, campoId);
    if (!aceite) return null;
    const texto = this.cenario.consentimentoTextos.find((t) => t.id === aceite.textoId);
    if (!texto) return null;
    const revogacao = this.revogacoesTitular.find((r) => r.consentimentoId === aceite.id);
    return {
      aceite,
      texto,
      revogacao,
      estado: estadoDe(texto, aceite, revogacao && {
        id: revogacao.id, consentimentoId: revogacao.consentimentoId,
        revogadoEmMs: revogacao.revogadoEmMs, canal: revogacao.canal,
      }, hojeIso),
      expiraEm: expiraEm(texto, aceite),
    };
  }

  /** A oposição deste titular a esta LIA, se houver — acolhida ou já recusada. */
  oposicaoALia(titularId: string, liaCodigo: string): OposicaoTitular | undefined {
    return this.oposicoesTitular.find((o) => o.titularId === titularId && o.liaCodigo === liaCodigo);
  }

  /**
   * Este campo está sob oposição **acolhida** deste titular?
   *
   * É a pergunta que a revelação faz antes de devolver um valor. Só `acolhida`
   * bloqueia: a oposição recusada com fundamento continua registrada — o
   * pedido aconteceu — e deixa de barrar o tratamento.
   */
  oposicaoVigenteSobre(titularId: string, campoId: string): OposicaoTitular | undefined {
    return this.oposicoesTitular.find(
      (o) => o.titularId === titularId && o.estado === 'acolhida' && o.camposIds.includes(campoId),
    );
  }

  constructor(cenarioId: string) {
    /**
     * Id desconhecido **falha**, não cai no cenário padrão.
     *
     * O `?? CENARIOS.banco` que estava aqui era conveniente e mentiroso: um teste
     * do PR 8 pedia 'streaming' — o id real é 'midia' — e recebia o banco de
     * volta, passando por três cenários enquanto exercitava um só. Fallback
     * silencioso em construtor é o mesmo defeito do fallback silencioso de
     * versão de tabela: responde por algo que não foi o pedido.
     */
    const cenario = CENARIOS[cenarioId];
    if (!cenario) {
      throw new Error(`Cenário desconhecido: "${cenarioId}". Os declarados são ${Object.keys(CENARIOS).join(', ')}.`);
    }
    this.cenario = estruturaClonada(cenario);
    this.semear();
  }

  // ── auditoria ────────────────────────────────────────────────────────────
  /**
   * O selo da justificativa entra na cadeia; o texto, não.
   *
   * É a fronteira entre dois riscos que se atropelariam. A cadeia precisa
   * cobrir a justificativa — é o campo mais exposto do trail, e sem ele um
   * texto adulterado passa sem detecção. E o trail precisa poder **expurgar** a
   * justificativa, que é dado pessoal do operador e não tinha prazo nenhum até
   * aqui. Selar o hash resolve os dois: adulterar o texto continua detectável,
   * e apagá-lo preserva a cadeia.
   *
   * Esta função recebe o selo pronto e **não vê o texto**, de propósito: quando
   * ela mesma hasheava a justificativa, nada impedia o campo do selo de guardar
   * uma cópia do texto ao lado — que foi exatamente o que aconteceu, e o que
   * deixou o expurgo dos 30 dias limpar uma coluna e esquecer a outra. Fronteira
   * que depende de convenção é fronteira que uma refatoração distraída atravessa.
   *
   * A mesma regra está no trigger `audit_log_encadeia()` de `db/schema.sql`, na
   * mesma ordem de campos, e é provada lá: `db/tests.sql` expurga a PII do trail
   * e confere que a verificação de integridade continua fechando.
   */
  private calcularHash(l: Omit<AuditLinha, 'hash'>): string {
    return sha256([
      l.hashAnterior ?? 'genesis',
      l.ocorridoEm, l.ator, l.acao, l.recursoTipo, l.recursoId,
      l.finalidade ?? '-', l.baseLegal ?? '-', l.protocolo ?? '-',
      l.campos.join(','), l.resultado,
      l.justificativaHash,
    ].join('|'));
  }

  /**
   * Expurga a PII do operador das linhas vencidas, preservando a cadeia.
   *
   * Idempotente: a linha já expurgada carrega `piiExpurgadaEm` e não volta.
   * `hoje` é parâmetro porque simular a passagem do tempo editando o carimbo
   * das linhas seria editar dado selado — e dado selado editado não é
   * simulação, é adulteração com outro nome.
   */
  expurgarPiiDoTrail(hojeMs: number, limite = 5_000): number {
    let n = 0;
    for (const l of this.auditoria) {
      if (n >= limite) break;
      if (l.piiExpurgadaEm) continue;
      const vence = Date.parse(l.ocorridoEm) + 30 * 24 * 60 * 60 * 1000;
      if (vence > hojeMs) continue;
      if (!l.justificativa && !l.ip && !l.userAgent) continue;
      l.justificativa = undefined;
      l.ip = undefined;
      l.userAgent = undefined;
      l.piiExpurgadaEm = new Date(hojeMs).toISOString();
      n += 1;
    }
    return n;
  }

  auditAppend(e: EntradaAudit): AuditLinha {
    if (this.simularFalhaDeLog) {
      throw new FalhaDeAuditoria('O audit trail está indisponível. A operação foi abortada.');
    }
    if (ACOES_PII.includes(e.acao) && e.resultado !== 'negado') {
      if (!e.finalidade || !e.justificativa || e.justificativa.trim().length < 20) {
        throw new FalhaDeAuditoria(
          'Acesso a dado pessoal exige finalidade declarada e justificativa de ao menos 20 caracteres (Art. 37).',
        );
      }
    }
    if (ACOES_COM_FINALIDADE.includes(e.acao) && e.resultado !== 'negado' && !e.finalidade) {
      throw new FalhaDeAuditoria('Esta operação de tratamento exige finalidade declarada (Art. 37).');
    }
    const anterior = this.auditoria.at(-1) ?? null;
    const parcial: Omit<AuditLinha, 'hash'> = {
      id: this.proximoId++,
      ocorridoEm: new Date().toISOString(),
      ator: e.ator,
      atorPapel: e.atorPapel,
      acao: e.acao,
      recursoTipo: e.recursoTipo,
      recursoId: e.recursoId,
      finalidade: e.finalidade,
      baseLegal: e.baseLegal,
      justificativa: e.justificativa,
      protocolo: e.protocolo,
      campos: e.campos ?? [],
      resultado: e.resultado ?? 'sucesso',
      hashAnterior: anterior ? anterior.hash : null,
      // O selo é calculado aqui, uma vez, e sobrevive ao expurgo do texto.
      justificativaHash: sha256(e.justificativa ?? ''),
    };
    const linha: AuditLinha = { ...parcial, hash: this.calcularHash(parcial) };
    this.auditoria.push(linha);
    return linha;
  }

  /**
   * Consome uma vaga da janela de busca do ator. Devolve `false` quando o
   * limite estourou — e o chamador responde 429 **antes** de olhar se o
   * titular existe, para que o limite não vire o oráculo que o 404 evitou.
   */
  consumirCotaDeBusca(ator: string, limite = 5, janelaMs = 60_000): boolean {
    const agora = Date.now();
    const recentes = (this.buscasPorAtor.get(ator) ?? []).filter((t) => agora - t < janelaMs);
    if (recentes.length >= limite) {
      this.buscasPorAtor.set(ator, recentes);
      return false;
    }
    recentes.push(agora);
    this.buscasPorAtor.set(ator, recentes);
    return true;
  }

  /**
   * T6-01 — quem verificou por último, lido do próprio trail e não de um campo
   * paralelo. Campo paralelo diverge do registro; derivar não diverge.
   */
  ultimaVerificacao(): AuditLinha | null {
    return [...this.auditoria].reverse().find((l) => l.acao === 'INTEGRIDADE_VERIFICADA') ?? null;
  }

  /** Append-only de verdade: nem administrador edita. */
  auditAtualizar(): never { throw new LogImutavel('Tabela audit_log é append-only: UPDATE não é permitido.'); }
  auditRemover(): never { throw new LogImutavel('Tabela audit_log é append-only: DELETE não é permitido.'); }

  /** Demonstração: adultera o conteúdo sem recalcular o hash, como faria um DBA comprometido. */
  auditForjar(id: number, novaAcao = 'ADULTERADO'): void {
    const alvo = this.auditoria.find((l) => l.id === id);
    if (alvo) alvo.acao = novaAcao;
  }

  /**
   * Duas conferências, não uma — e a segunda é o que fecha o Risco-004.
   *
   * A primeira é a cadeia: recompõe o payload de cada linha e confere o hash. A
   * segunda é o **selo contra o texto**: enquanto a justificativa existe, o
   * sha256 dela tem de bater com o selo gravado. Sem a segunda havia um buraco
   * exato — quem trocasse só o texto, deixando o selo intacto, passava, porque a
   * cadeia consome o selo e não o texto. O campo mais aberto do trail era o
   * único que se podia reescrever sem deixar rastro.
   *
   * Depois do expurgo controlado o texto não existe mais, e é `piiExpurgadaEm`
   * que diz isso. Aí só a cadeia responde — que é precisamente o desenho: o selo
   * sobrevive ao texto e continua provando o que o texto dizia.
   */
  auditVerificar(): {
    blocos: number; integro: boolean; primeiraDivergencia: number | null; motivo: string | null;
  } {
    let anterior: string | null = null;
    let divergencia: number | null = null;
    let motivo: string | null = null;
    for (const l of this.auditoria) {
      const esperado = this.calcularHash({
        id: l.id, ocorridoEm: l.ocorridoEm, ator: l.ator, atorPapel: l.atorPapel,
        acao: l.acao, recursoTipo: l.recursoTipo, recursoId: l.recursoId,
        finalidade: l.finalidade, baseLegal: l.baseLegal, protocolo: l.protocolo,
        // O selo lido da linha, não recalculado do texto: é exatamente por isso
        // que a verificação continua fechando depois do expurgo da justificativa.
        justificativaHash: l.justificativaHash,
        campos: l.campos, resultado: l.resultado, hashAnterior: anterior,
      });
      const seloConfere = l.piiExpurgadaEm !== undefined
        || sha256(l.justificativa ?? '') === l.justificativaHash;
      if ((esperado !== l.hash || !seloConfere) && divergencia === null) {
        divergencia = l.id;
        motivo = esperado !== l.hash
          ? (seloConfere ? 'cadeia' : 'cadeia e selo da justificativa')
          : 'texto da justificativa não corresponde ao selo';
      }
      anterior = l.hash;
    }
    return {
      blocos: this.auditoria.length, integro: divergencia === null,
      primeiraDivergencia: divergencia, motivo,
    };
  }

  // ── semente ──────────────────────────────────────────────────────────────
  private semear() {
    this.auditAppend({ ator: 'airflow-svc', atorPapel: 'system', acao: 'EXPURGO_EXECUTADO', recursoTipo: 'expurgo_run', recursoId: 'e1' });
    this.auditAppend({ ator: 'Maria Souza', atorPapel: 'engenharia', acao: 'RIPD_SUBMETIDO', recursoTipo: 'ripd', recursoId: this.cenario.ripds[0]?.codigo ?? '—' });
    this.auditAppend({
      ator: 'Marcela Dias', atorPapel: 'dpo', acao: 'TITULAR_CONSULTADO', recursoTipo: 'solicitacao', recursoId: '2026-0731',
      finalidade: 'atendimento', justificativa: 'Atendimento ao protocolo 2026-0731 (direito de acesso)', campos: ['protocolo'],
    });
    this.auditAppend({ ator: 'Rita Nunes', atorPapel: 'seguranca', acao: 'INTEGRIDADE_VERIFICADA', recursoTipo: 'expurgo_run', recursoId: 'e1' });
  }
}

/** Clone profundo simples — a massa é JSON puro, sem Date nem Map. */
function estruturaClonada<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}
