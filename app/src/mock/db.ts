import { sha256 } from '../lib/sha256';
import { CENARIOS } from './scenarios';
import type { AuditLinha, Cenario, Finalidade, Papel, Reclassificacao } from './types';

export interface EntradaAudit {
  ator: string;
  atorPapel: Papel | 'system';
  acao: string;
  recursoTipo: string;
  recursoId: string;
  finalidade?: Finalidade;
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

  constructor(cenarioId: string) {
    this.cenario = estruturaClonada(CENARIOS[cenarioId] ?? CENARIOS.banco);
    this.semear();
  }

  // ── auditoria ────────────────────────────────────────────────────────────
  private calcularHash(l: Omit<AuditLinha, 'hash'>): string {
    return sha256([
      l.hashAnterior ?? 'genesis',
      l.ocorridoEm, l.ator, l.acao, l.recursoTipo, l.recursoId,
      l.finalidade ?? '-', l.protocolo ?? '-', l.campos.join(','), l.resultado,
    ].join('|'));
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
      justificativa: e.justificativa,
      protocolo: e.protocolo,
      campos: e.campos ?? [],
      resultado: e.resultado ?? 'sucesso',
      hashAnterior: anterior ? anterior.hash : null,
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

  auditVerificar(): { blocos: number; integro: boolean; primeiraDivergencia: number | null } {
    let anterior: string | null = null;
    let divergencia: number | null = null;
    for (const l of this.auditoria) {
      const esperado = this.calcularHash({
        id: l.id, ocorridoEm: l.ocorridoEm, ator: l.ator, atorPapel: l.atorPapel,
        acao: l.acao, recursoTipo: l.recursoTipo, recursoId: l.recursoId,
        finalidade: l.finalidade, justificativa: l.justificativa, protocolo: l.protocolo,
        campos: l.campos, resultado: l.resultado, hashAnterior: anterior,
      });
      if (esperado !== l.hash && divergencia === null) divergencia = l.id;
      anterior = l.hash;
    }
    return { blocos: this.auditoria.length, integro: divergencia === null, primeiraDivergencia: divergencia };
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
