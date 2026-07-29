import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { BancoMock } from '../src/mock/db';
import { CENARIOS } from '../src/mock/scenarios';
import { request } from '../src/mock/api';
import { ACOES, pode } from '../src/mock/permissoes';
import type { Acao } from '../src/mock/permissoes';
import { POLITICAS, POLITICA_PADRAO, politicaDe } from '../src/mock/politicas';
import {
  ARTEFATOS, MAQUINAS, TRANSICOES_INCIDENTE, estadosDe, motivoDaRecusa, proximosDe,
  transicaoPermitida, type Artefato,
} from '../src/mock/estados';
import {
  aplicarDmn, combinacoes, divergenciasBpmn, dominioDe, lerBpmn, lerDmn, lerEntrada, lerProcesso,
} from './conformidade';
import {
  CATEGORIAS, GATILHOS, TABELAS, TABELAS_IDS, aplicar, condicoesDe, nivelDoRisco,
  reproduzir, tomDoRisco, ultimaDecisao, vigenteDe,
} from '../src/mock/decisoes';
import { requestPortal } from '../src/mock/portal';
import { DIREITOS, REGIME, nivelExigido } from '../src/mock/direitos';
import { OPERACOES, RAIZES_DO_MOCK, ROTAS_APENAS_DEMO } from '../src/mock/rotas';
import { REGRAS, derivarFila, eDe, minhaFila } from '../src/mock/fila';
import type { ContadoresDaFila, ItemDaFila } from '../src/mock/fila';
import {
  CAPACIDADE_DIAS_MES, RESERVA_DEMANDA, assinaturaDoFeed, cargaDoAno, mesDe,
} from '../src/mock/calendario';
import type { Obrigacao } from '../src/mock/calendario';
import { PRINCIPIOS_PBD, avaliarPbd, vereditoPbd } from '../src/mock/pbd';
import type { MarcacaoPbd, VereditoPbd } from '../src/mock/pbd';
import { relatorio, rodarGate } from '../src/lib/gate-privacidade';
import { hashEncadeado } from '../src/lib/sha256';
import { CampoPII, Didatico, Explica } from '../src/ui/primitivos';
import { MemoryRouter } from 'react-router-dom';
import T2 from '../src/screens/T2';
import { Casca, TELAS } from '../src/App';
import ComoFunciona from '../src/screens/ComoFunciona';
import T0 from '../src/screens/T0';
import T1 from '../src/screens/T1';
import T10 from '../src/screens/T10';
import T3 from '../src/screens/T3';
import T5 from '../src/screens/T5';
import T7 from '../src/screens/T7';
import T8 from '../src/screens/T8';
import T4 from '../src/screens/T4';
import T6 from '../src/screens/T6';
import T11, { DESVIOS, trilhaDoAchado } from '../src/screens/T11';
import { useSessao, limparBancosDaSessao } from '../src/store/sessao';
import { sha256, hashCpf } from '../src/lib/sha256';
import type { DecisaoRegistrada, Direito, EstadoIncidente, Papel } from '../src/mock/types';

let banco: BancoMock;
beforeEach(() => {
  banco = new BancoMock('banco');
  cleanup();
});

const chamar = <T = unknown,>(papel: Papel, req: Partial<Parameters<typeof request>[1]> & { metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE'; caminho: string }) =>
  request<T>(banco, { papel, ator: 'teste', ...req });

// ─────────────────────────────────────────────────────────────────────────────
describe('Regra 1 — legítimo interesse não cobre dado sensível (Art. 11)', () => {
  it('recusa vincular campo sensível a uma LIA', () => {
    const sensivel = banco.cenario.campos.find((c) => c.sensivel)!;
    const res = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/lias/l1/campos', body: { campoId: sensivel.id },
    });
    expect(res.status).toBe(422);
    expect((res.body as { erro: string }).erro).toContain('sensível');
    expect(banco.cenario.lias[0].camposIds).not.toContain(sensivel.id);
  });

  it('aceita campo não sensível', () => {
    const comum = banco.cenario.campos.find((c) => !c.sensivel)!;
    expect(chamar('dpo', { metodo: 'POST', caminho: '/v1/lias/l1/campos', body: { campoId: comum.id } }).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Regra 2 — hash de CPF não é anonimização (Art. 12)', () => {
  it('recusa categoria anonimizado com armazenamento em hash', () => {
    const res = chamar('engenharia', {
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: { nome: 'cpf_sha', tipoArmazenado: 'hash', categoria: 'anonimizado', sensivel: false, baseLegal: 'execucao_contrato', finalidadesCompativeis: [] },
    });
    expect(res.status).toBe(422);
    expect((res.body as { erro: string }).erro).toContain('k-anonimato');
  });

  it('aceita anonimizado quando o armazenamento é agregado', () => {
    const res = chamar('engenharia', {
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: { nome: 'cesta_media', tipoArmazenado: 'agregado', categoria: 'anonimizado', sensivel: false, baseLegal: 'execucao_contrato', finalidadesCompativeis: [] },
    });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Regra 3 — revelar exige finalidade, justificativa e registro ANTES da resposta', () => {
  // Adaptação de contrato do PR 2 (T4-01): a revelação passou a exigir o
  // protocolo sob o qual acontece. O que estes testes provam continua igual.
  const corpo = { titularId: 't1', campo: 'cpf', protocolo: '2026-0731', justificativa: 'Confirmação de identidade para o protocolo 2026-0731' };

  it('recusa sem X-Purpose', () => {
    const res = chamar('dpo', { metodo: 'POST', caminho: '/v1/pseudonyms/resolve', body: corpo });
    expect(res.status).toBe(403);
  });

  it('recusa justificativa com menos de 20 caracteres', () => {
    const res = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/pseudonyms/resolve', purpose: 'atendimento',
      body: { ...corpo, justificativa: 'porque sim' },
    });
    expect(res.status).toBe(422);
  });

  it('grava o log antes de devolver o valor', () => {
    const antes = banco.auditoria.length;
    const res = chamar('dpo', { metodo: 'POST', caminho: '/v1/pseudonyms/resolve', purpose: 'atendimento', body: corpo });
    expect(res.status).toBe(200);
    expect((res.body as { valor: string }).valor).toBe('529.982.247-25');

    const registro = banco.auditoria.at(-1)!;
    expect(banco.auditoria.length).toBe(antes + 1);
    expect(registro.acao).toBe('CAMPO_REVELADO');
    expect(registro.finalidade).toBe('atendimento');
    expect(registro.campos).toEqual(['cpf']);
  });

  it('se o audit trail falha, a revelação falha e nenhum valor sai', () => {
    banco.simularFalhaDeLog = true;
    const res = chamar('dpo', { metodo: 'POST', caminho: '/v1/pseudonyms/resolve', purpose: 'atendimento', body: corpo });
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('529.982.247-25');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Regra 4 — dado sensível não é revelável em tela alguma', () => {
  it('a API recusa mesmo com finalidade e justificativa válidas', () => {
    const res = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/pseudonyms/resolve', purpose: 'atendimento',
      body: { titularId: 't1', campo: 'biometria', protocolo: '2026-0731', justificativa: 'Verificação de identidade solicitada pelo titular' },
    });
    expect(res.status).toBe(403);
    expect((res.body as { erro: string }).erro).toContain('sensível');
  });

  it('a interface não monta botão de revelar para campo sensível, nem para o DPO', () => {
    useSessao.setState({ papel: 'dpo' });
    render(<CampoPII titularId="t1" chave="biometria" rotulo="Biometria facial" mascara="🔒" sensivel />);
    expect(screen.queryByRole('button', { name: /revelar/i })).toBeNull();
    expect(screen.getByText(/não revelável/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Regra 5 — 404, nunca 403, para recurso fora do escopo', () => {
  it('devolve 404 para o papel Segurança, que não opera o portal', () => {
    const res = chamar('seguranca', { metodo: 'GET', caminho: '/v1/titulares/t1' });
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it('devolve 404 também para titular inexistente — respostas indistinguíveis', () => {
    const inexistente = chamar('dpo', { metodo: 'GET', caminho: '/v1/titulares/nao-existe' });
    const semEscopo = chamar('seguranca', { metodo: 'GET', caminho: '/v1/titulares/t1' });
    expect(inexistente.status).toBe(semEscopo.status);
    expect(inexistente.body).toEqual(semEscopo.body);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Regra 6 — totalItems omitido para papéis não confiáveis', () => {
  it('não devolve totalItems para Produto', () => {
    const res = chamar('produto', { metodo: 'GET', caminho: '/v1/catalog/fields' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('totalItems');
  });

  it('devolve totalItems para DPO', () => {
    const res = chamar('dpo', { metodo: 'GET', caminho: '/v1/catalog/fields' });
    expect(res.body).toHaveProperty('totalItems');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Regra 7 — audit trail append-only e cadeia verificável', () => {
  it('recusa UPDATE e DELETE com 409', () => {
    expect(chamar('dpo', { metodo: 'PATCH', caminho: '/v1/audit/1', body: { acao: 'X' } }).status).toBe(409);
    expect(chamar('dpo', { metodo: 'DELETE', caminho: '/v1/audit/1' }).status).toBe(409);
  });

  it('detecta adulteração feita direto no banco e aponta a primeira linha divergente', () => {
    expect(banco.auditVerificar().integro).toBe(true);
    banco.auditForjar(2);
    const v = banco.auditVerificar();
    expect(v.integro).toBe(false);
    expect(v.primeiraDivergencia).toBe(2);
  });

  it('cada linha sela a anterior: só o bloco gênese não tem predecessor', () => {
    const semAnterior = banco.auditoria.filter((l) => l.hashAnterior === null);
    expect(semAnterior).toHaveLength(1);
    expect(banco.auditoria[1].hashAnterior).toBe(banco.auditoria[0].hash);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Regra 8 — transferência internacional exige mecanismo (Art. 33)', () => {
  it('recusa destino internacional sem mecanismo', () => {
    const res = chamar('engenharia', {
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: { nome: 'perfil', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, baseLegal: 'execucao_contrato', internacional: true, mecanismo: 'nao_aplicavel', finalidadesCompativeis: ['auditoria'] },
    });
    expect(res.status).toBe(422);
    expect((res.body as { erro: string }).erro).toContain('Art. 33');
  });

  it('aceita com cláusulas-padrão da ANPD', () => {
    const res = chamar('engenharia', {
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: { nome: 'perfil', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, baseLegal: 'execucao_contrato', internacional: true, mecanismo: 'clausulas_padrao_anpd', finalidadesCompativeis: ['auditoria'] },
    });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Regra 9 — RIPD é gate de CI, não documento pós-fato', () => {
  it('só o DPO aprova, e a aprovação libera o status check do PR', () => {
    const bloqueadoAntes = banco.cenario.gates.filter((g) => g.bloqueouMerge).length;
    expect(bloqueadoAntes).toBeGreaterThan(0);

    expect(chamar('engenharia', { metodo: 'POST', caminho: '/v1/ripds/r1/aprovar' }).status).toBe(403);

    // P0 em aberto impede o fechamento.
    expect(chamar('dpo', { metodo: 'POST', caminho: '/v1/ripds/r1/aprovar' }).status).toBe(409);

    banco.cenario.ripds[0].recomendacoes.forEach((r) => { r.concluida = true; });
    const ok = chamar('dpo', { metodo: 'POST', caminho: '/v1/ripds/r1/aprovar' });

    expect(ok.status).toBe(200);
    expect((ok.body as { checkRun: string }).checkRun).toBe('success');
    expect(banco.cenario.gates.filter((g) => g.bloqueouMerge)).toHaveLength(0);
    expect(banco.auditoria.at(-1)!.acao).toBe('RIPD_APROVADO');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Privacy by default na interface', () => {
  it('o papel Produto não monta o botão de revelar — não é CSS, é ausência no DOM', () => {
    useSessao.setState({ papel: 'produto' });
    render(<CampoPII titularId="t1" chave="cpf" rotulo="CPF" mascara="•••.•••.•••-••" sensivel={false} />);
    expect(screen.queryByRole('button', { name: /revelar/i })).toBeNull();
    expect(pode('produto', 'revelar_pii')).toBe(false);
  });

  it('o DPO revela com justificativa e o valor volta a mascarar em 60 segundos', () => {
    vi.useFakeTimers();
    useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [], protocoloSelecionado: '2026-0731' });
    render(<CampoPII titularId="t1" chave="cpf" rotulo="CPF" mascara="•••.•••.•••-••" sensivel={false} />);

    fireEvent.click(screen.getByRole('button', { name: /revelar/i }));
    fireEvent.change(screen.getByLabelText(/finalidade/i), { target: { value: 'atendimento' } });
    fireEvent.change(screen.getByLabelText(/justificativa/i), {
      target: { value: 'Confirmação de identidade para o protocolo 2026-0731' },
    });
    fireEvent.click(screen.getByRole('button', { name: /revelar e registrar/i }));

    expect(screen.getByText('529.982.247-25')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(60_000); });

    expect(screen.queryByText('529.982.247-25')).toBeNull();
    expect(screen.getByText('•••.•••.•••-••')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('o CPF nunca sai do navegador: a busca viaja como hash', () => {
    const cpf = '529.982.247-25';
    const h = hashCpf(cpf);
    expect(h).not.toContain('529');
    expect(h).toBe(sha256('52998224725:lastro-busca-v1'));

    // Adaptação de contrato do PR 1 (C-01): a busca passou a exigir finalidade
    // declarada. O que este teste prova — que o documento viaja como hash —
    // continua igual.
    const res = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/titulares/buscar', purpose: 'atendimento', body: { cpfHash: h },
    });
    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBe('t1');
  });

  it('o canal titular↔DPO recusa CPF em texto claro', () => {
    const res = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/requests/s1/mensagens',
      body: { corpo: 'Confirmando o CPF 529.982.247-25 do titular.' },
    });
    expect(res.status).toBe(422);
  });

  it('auditor externo não recebe rota de escrita', () => {
    const res = chamar('auditor', { metodo: 'POST', caminho: '/v1/ripds/r1/aprovar' });
    expect(res.status).toBe(403);
    expect(pode('auditor', 'escrever')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Cenários', () => {
  it('os três cenários carregam com dado sensível, transferência internacional e PR bloqueado', () => {
    for (const id of ['banco', 'varejo', 'midia']) {
      const b = new BancoMock(id);
      expect(b.cenario.campos.some((c) => c.sensivel), `${id}: dado sensível`).toBe(true);
      expect(b.cenario.campos.some((c) => c.compartilhamentos.some((s) => s.internacional)), `${id}: transferência`).toBe(true);
      expect(b.cenario.gates.some((g) => g.bloqueouMerge), `${id}: PR bloqueado`).toBe(true);
      expect(b.cenario.riscos, `${id}: riscos`).toHaveLength(10);
      expect(b.auditVerificar().integro, `${id}: cadeia`).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PR 1 — Controle de acesso (C-01, C-02, T6-02)
// ═════════════════════════════════════════════════════════════════════════════

const HASH_EXISTENTE = hashCpf('529.982.247-25');
const HASH_INEXISTENTE = hashCpf('000.000.000-00');

describe('C-01 · Regra 5b — busca por hash não é oráculo de existência', () => {
  it('papel sem buscar_titular recebe 404, nunca 403', () => {
    const res = chamar('produto', {
      metodo: 'POST', caminho: '/v1/titulares/buscar', purpose: 'atendimento',
      body: { cpfHash: HASH_EXISTENTE },
    });
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(pode('produto', 'buscar_titular')).toBe(false);
  });

  it('as respostas são indistinguíveis: fora de escopo e sem resultado', () => {
    const foraDeEscopo = chamar('produto', {
      metodo: 'POST', caminho: '/v1/titulares/buscar', purpose: 'atendimento',
      body: { cpfHash: HASH_EXISTENTE },
    });
    const semResultado = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/titulares/buscar', purpose: 'atendimento',
      body: { cpfHash: HASH_INEXISTENTE },
    });
    expect(foraDeEscopo.status).toBe(semResultado.status);
    expect(foraDeEscopo.body).toEqual(semResultado.body);
  });

  it('busca sem finalidade declarada é recusada (Art. 37)', () => {
    const res = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/titulares/buscar', body: { cpfHash: HASH_EXISTENTE },
    });
    expect(res.status).toBe(403);
  });

  it('Regra 3b — a busca é registrada antes da resposta', () => {
    const antes = banco.auditoria.length;
    const res = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/titulares/buscar', purpose: 'atendimento',
      body: { cpfHash: HASH_EXISTENTE },
    });
    expect(res.status).toBe(200);

    const registro = banco.auditoria.at(-1)!;
    expect(banco.auditoria.length).toBe(antes + 1);
    expect(registro.acao).toBe('TITULAR_BUSCADO');
    expect(registro.finalidade).toBe('atendimento');
    // Só o prefixo do hash entra no registro — nem documento, nem hash inteiro.
    expect(registro.recursoId).toBe(HASH_EXISTENTE.slice(0, 8));
    expect(registro.recursoId.length).toBe(8);
  });

  it('sem registro não há busca', () => {
    banco.simularFalhaDeLog = true;
    const res = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/titulares/buscar', purpose: 'atendimento',
      body: { cpfHash: HASH_EXISTENTE },
    });
    expect(res.status).toBe(503);
    expect((res.body as { id?: string }).id).toBeUndefined();
  });

  it('a tentativa negada por papel também entra no trail', () => {
    const antes = banco.auditoria.length;
    chamar('produto', {
      metodo: 'POST', caminho: '/v1/titulares/buscar', purpose: 'atendimento',
      body: { cpfHash: HASH_EXISTENTE },
    });
    expect(banco.auditoria.length).toBe(antes + 1);
    expect(banco.auditoria.at(-1)!.resultado).toBe('negado');
  });

  it('busca em rajada é enumeração: a sexta recebe 429', () => {
    const buscar = (hash: string) => chamar('dpo', {
      metodo: 'POST', caminho: '/v1/titulares/buscar', purpose: 'atendimento', body: { cpfHash: hash },
    });
    for (let i = 0; i < 5; i++) expect(buscar(HASH_EXISTENTE).status).toBe(200);
    expect(buscar(HASH_EXISTENTE).status).toBe(429);
  });

  it('o 429 também é indistinguível entre hash existente e inexistente', () => {
    const buscar = (hash: string) => chamar('dpo', {
      metodo: 'POST', caminho: '/v1/titulares/buscar', purpose: 'atendimento', body: { cpfHash: hash },
    });
    for (let i = 0; i < 5; i++) buscar(HASH_EXISTENTE);
    // Se a cota fosse consumida depois do `find`, o limite viraria o oráculo
    // que o 404 acabou de fechar.
    const existente = buscar(HASH_EXISTENTE);
    const inexistente = buscar(HASH_INEXISTENTE);
    expect(existente.status).toBe(429);
    expect(inexistente.status).toBe(429);
    expect(existente.body).toEqual(inexistente.body);
  });

  it('T2 não monta o campo de CPF para papel sem a ação', () => {
    useSessao.setState({ papel: 'produto', banco: new BancoMock('banco'), versao: 0, avisos: [] });
    render(<T2 />);
    expect(screen.queryByLabelText(/^CPF$/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /calcular hash/i })).toBeNull();
  });

  it('T2 monta o campo de CPF para o DPO — contraprova', () => {
    useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [] });
    render(<T2 />);
    expect(screen.getByLabelText(/^CPF$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/finalidade da busca/i)).toBeInTheDocument();
  });

  it('T4 não monta o campo de CPF para papel sem a ação', () => {
    useSessao.setState({ papel: 'produto', banco: new BancoMock('banco'), versao: 0, avisos: [] });
    render(<T4 />);
    expect(screen.queryByLabelText(/^CPF$/i)).toBeNull();
  });
});

describe('C-02 · Regra 7b — a guarda de escrita cobre também as rotas de auditoria', () => {
  it('auditor externo não alcança PATCH nem DELETE do trail', () => {
    expect(chamar('auditor', { metodo: 'PATCH', caminho: '/v1/audit/1', body: {} }).status).toBe(403);
    expect(chamar('auditor', { metodo: 'DELETE', caminho: '/v1/audit/1' }).status).toBe(403);
  });

  it('auditor externo não alcança a rota de forjar', () => {
    const res = chamar('auditor', { metodo: 'POST', caminho: '/v1/audit/forjar', body: { id: 2 } });
    expect(res.status).toBe(403);
    expect(banco.auditVerificar().integro).toBe(true);
  });

  it('verificar integridade continua sendo leitura, inclusive para o auditor', () => {
    const res = chamar('auditor', { metodo: 'POST', caminho: '/v1/audit/verificar' });
    expect(res.status).toBe(200);
    expect((res.body as { integro: boolean }).integro).toBe(true);
  });

  it('forjar não existe fora do modo demonstração', () => {
    banco.modoDemo = false;
    const res = chamar('dpo', { metodo: 'POST', caminho: '/v1/audit/forjar', body: { id: 2 } });
    expect(res.status).toBe(404);
    expect(banco.auditVerificar().integro).toBe(true);
  });

  it('no modo demonstração, quem escreve ainda consegue forjar — e a cadeia acusa', () => {
    expect(banco.modoDemo).toBe(true);
    const res = chamar('dpo', { metodo: 'POST', caminho: '/v1/audit/forjar', body: { id: 2 } });
    expect(res.status).toBe(200);
    expect(banco.auditVerificar().integro).toBe(false);
  });
});

describe('T6-02 — os controles de ataque não são renderizados para papel de leitura', () => {
  it('auditor externo não recebe nenhum dos dois botões', () => {
    useSessao.setState({ papel: 'auditor', banco: new BancoMock('banco'), versao: 0, avisos: [] });
    render(<T6 />);
    expect(screen.queryByRole('button', { name: /tentar editar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /forjar/i })).toBeNull();
  });

  it('engenharia recebe os dois, agrupados no bloco de demonstração', () => {
    useSessao.setState({ papel: 'engenharia', banco: new BancoMock('banco'), versao: 0, avisos: [] });
    render(<T6 />);
    expect(screen.getByRole('button', { name: /tentar editar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /forjar/i })).toBeInTheDocument();
    expect(screen.getByText(/demonstração de ataque/i)).toBeInTheDocument();
  });

  it('fora do modo demonstração o bloco some mesmo para quem escreve', () => {
    const b = new BancoMock('banco');
    b.modoDemo = false;
    useSessao.setState({ papel: 'engenharia', banco: b, versao: 0, avisos: [] });
    render(<T6 />);
    expect(screen.queryByRole('button', { name: /forjar/i })).toBeNull();
  });
});

describe('C-02 · invariante da rota que sai antes da guarda', () => {
  it('quem tem buscar_titular também tem escrever — a rota não é um desvio da guarda', () => {
    // A busca é tratada antes da guarda genérica para poder responder 404
    // uniforme. Isso só é seguro enquanto `buscar_titular` for estritamente
    // mais restritiva que `escrever`. Se alguém conceder a busca a um papel de
    // leitura, este teste falha antes de a brecha chegar em produção.
    const papeis: Papel[] = ['engenharia', 'dpo', 'produto', 'seguranca', 'auditor'];
    for (const p of papeis) {
      if (pode(p, 'buscar_titular')) {
        expect(pode(p, 'escrever'), `${p} busca titular mas não escreve`).toBe(true);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PR 2 — Fluxo de atendimento e prova (C-03, C-04, C-05, C-17, T4-01…T4-05)
// ═════════════════════════════════════════════════════════════════════════════

const REVELA_CPF = {
  metodo: 'POST' as const, caminho: '/v1/pseudonyms/resolve', purpose: 'atendimento' as const,
  body: { titularId: 't1', campo: 'cpf', protocolo: '2026-0731', justificativa: 'Confirmação de identidade para o protocolo 2026-0731' },
};

describe('Política de resposta por rota (PR 1 → tabela declarativa)', () => {
  it('toda rota alcançável tem política declarada — o padrão fecha, não abre', () => {
    for (const p of POLITICAS) {
      expect(p.nota.length, `${p.metodo} ${p.caminho}`).toBeGreaterThan(0);
    }
    // Rota nunca declarada cai no padrão: escrita, 403.
    expect(politicaDe('POST', 'rota/inventada')).toBeNull();
    expect(POLITICA_PADRAO.tipo).toBe('escrita');
    expect(POLITICA_PADRAO.foraDeEscopo).toBe('403');
    const res = chamar('auditor', { metodo: 'POST', caminho: '/v1/rota/inventada' });
    expect(res.status).toBe(403);
  });

  it('só rotas que confirmam existência de titular respondem 404 uniforme', () => {
    for (const p of POLITICAS) {
      if (p.foraDeEscopo === '404_uniforme') {
        expect(p.caminho.source, `${p.metodo} ${p.caminho}`).toContain('titulares');
      }
    }
  });
});

describe('C-17 — campo revelável precisa estar no ROPA', () => {
  it('todo campo exibível de todo cenário aponta para uma entrada do catálogo', () => {
    for (const id of ['banco', 'varejo', 'midia']) {
      const b = new BancoMock(id);
      for (const t of b.cenario.titulares) {
        for (const c of t.campos) {
          const alvo = b.cenario.campos.find((x) => x.id === c.campoCatalogoId);
          expect(alvo, `${id}/${t.id}/${c.chave} sem entrada no ROPA`).toBeDefined();
        }
      }
    }
  });

  it('campo sem vínculo com o catálogo é recusado com 422, não revelado com aviso', () => {
    const alvo = banco.cenario.titulares.find((t) => t.id === 't1')!.campos.find((c) => c.chave === 'cpf')!;
    delete alvo.campoCatalogoId;
    const res = chamar('dpo', REVELA_CPF);
    expect(res.status).toBe(422);
    expect((res.body as { erro: string }).erro).toContain('catálogo');
    expect(JSON.stringify(res.body)).not.toContain('529.982.247-25');
  });

  it('validar inventário recusa campo sem finalidades declaradas — campo novo não nasce sem política', () => {
    const semLista = chamar('engenharia', {
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: { nome: 'apelido', tipoArmazenado: 'bruto', categoria: 'pessoal', sensivel: false, baseLegal: 'execucao_contrato' },
    });
    expect(semLista.status).toBe(422);
    expect((semLista.body as { erro: string }).erro).toContain('finalidades compatíveis');

    // Lista vazia é declaração válida de "não revelável" — diferente de ausente.
    const listaVazia = chamar('engenharia', {
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: { nome: 'apelido', tipoArmazenado: 'bruto', categoria: 'pessoal', sensivel: false, baseLegal: 'execucao_contrato', finalidadesCompativeis: [] },
    });
    expect(listaVazia.status).toBe(200);
  });
});

describe('C-03 — a finalidade é confrontada com o catálogo', () => {
  it('recusa finalidade que não consta para o campo, mesmo com justificativa boa', () => {
    // `b-cpf` aceita atendimento, cobranca e auditoria — nunca seguranca.
    const res = chamar('dpo', { ...REVELA_CPF, purpose: 'seguranca' });
    expect(res.status).toBe(422);
    expect((res.body as { erro: string }).erro).toContain('não consta no catálogo');
    expect(JSON.stringify(res.body)).not.toContain('529.982.247-25');
  });

  it('lista vazia significa não revelável, jamais "qualquer uma"', () => {
    const campo = banco.cenario.campos.find((c) => c.id === 'b-cpf')!;
    campo.finalidadesCompativeis = [];
    for (const purpose of ['atendimento', 'cobranca', 'auditoria', 'seguranca'] as const) {
      expect(chamar('dpo', { ...REVELA_CPF, purpose }).status, purpose).toBe(422);
    }
  });

  it('a recusa por finalidade incompatível é registrada como negada', () => {
    const antes = banco.auditoria.length;
    chamar('dpo', { ...REVELA_CPF, purpose: 'seguranca' });
    const registro = banco.auditoria.at(-1)!;
    expect(banco.auditoria.length).toBe(antes + 1);
    expect(registro.resultado).toBe('negado');
  });

  it('o formulário oferece só as finalidades do catálogo — não uma lista fixa da tela', () => {
    useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [], protocoloSelecionado: '2026-0731' });
    render(<CampoPII titularId="t1" chave="renda" rotulo="Renda declarada" mascara="R$ ••••,••" sensivel={false} />);
    fireEvent.click(screen.getByRole('button', { name: /revelar/i }));
    const opcoes = [...screen.getByLabelText(/finalidade/i).querySelectorAll('option')]
      .map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    // b-renda: cobranca e auditoria. Atendimento não está catalogado para ele.
    expect(opcoes).toEqual(['cobranca', 'auditoria']);
  });
});

describe('C-04 — justificativa é redigida antes de entrar no log imutável', () => {
  it('o CPF citado na justificativa não chega ao audit trail', () => {
    const res = chamar('dpo', {
      ...REVELA_CPF,
      body: { ...REVELA_CPF.body, justificativa: 'Titular confirmou o CPF 529.982.247-25 por telefone hoje' },
    });
    expect(res.status).toBe(200);
    const registro = banco.auditoria.at(-1)!;
    expect(registro.justificativa).not.toContain('529.982.247-25');
    expect(registro.justificativa).toContain('[CPF removido]');
  });

  it('o histórico de reclassificação de risco também é redigido', () => {
    const risco = banco.cenario.riscos[0];
    const res = chamar('dpo', {
      metodo: 'PATCH', caminho: `/v1/risks/${risco.codigo}`,
      body: { probabilidade: 2, impacto: 2, justificativa: 'Relato do titular ana.silva@exemplo.com sobre exposição indevida' },
    });
    expect(res.status).toBe(200);
    expect(banco.reclassificacoes.at(-1)!.justificativa).not.toContain('ana.silva@exemplo.com');
  });
});

describe('C-05 — o re-mascaramento é do relógio, não do contador da aba', () => {
  it('o valor some ao passar dos 60 segundos, mesmo sem os ticks intermediários', () => {
    vi.useFakeTimers();
    useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [], protocoloSelecionado: '2026-0731' });
    render(<CampoPII titularId="t1" chave="cpf" rotulo="CPF" mascara="•••.•••.•••-••" sensivel={false} />);
    fireEvent.click(screen.getByRole('button', { name: /revelar/i }));
    fireEvent.change(screen.getByLabelText(/finalidade/i), { target: { value: 'atendimento' } });
    fireEvent.change(screen.getByLabelText(/justificativa/i), {
      target: { value: 'Confirmação de identidade para o protocolo 2026-0731' },
    });
    fireEvent.click(screen.getByRole('button', { name: /revelar e registrar/i }));
    expect(screen.getByText('529.982.247-25')).toBeInTheDocument();

    // Aba inativa: o relógio anda, os timers não disparam na cadência normal.
    // O valor precisa sumir mesmo assim.
    act(() => { vi.setSystemTime(Date.now() + 61_000); vi.advanceTimersByTime(300); });
    expect(screen.queryByText('529.982.247-25')).toBeNull();
    vi.useRealTimers();
  });
});

describe('T4-01 — a revelação acontece sob um protocolo', () => {
  it('sem protocolo selecionado, a revelação é recusada com 422', () => {
    const res = chamar('dpo', { ...REVELA_CPF, body: { ...REVELA_CPF.body, protocolo: undefined } });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).not.toContain('529.982.247-25');
  });

  it('protocolo de outro titular é recusado — é o defeito de contexto trocado', () => {
    // 2026-0730 pertence a t2.
    const res = chamar('dpo', { ...REVELA_CPF, body: { ...REVELA_CPF.body, protocolo: '2026-0730' } });
    expect(res.status).toBe(422);
    expect((res.body as { erro: string }).erro).toContain('não pertence');
  });

  it('o protocolo entra no registro e é selado no hash da cadeia', () => {
    const res = chamar('dpo', REVELA_CPF);
    expect(res.status).toBe(200);
    const registro = banco.auditoria.at(-1)!;
    expect(registro.protocolo).toBe('2026-0731');

    // Trocar o protocolo sem recalcular o hash quebra a verificação: prova de
    // que o campo está no payload, e não apenas guardado ao lado dele.
    registro.protocolo = '2026-0730';
    expect(banco.auditVerificar().integro).toBe(false);
  });
});

describe('T4-02 — concluir o atendimento', () => {
  it('a conclusão para o cronômetro e registra antes de responder', () => {
    const antes = banco.auditoria.length;
    const res = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/requests/s1/concluir',
      body: { desfecho: 'atendido', evidencia: 'Relação de destinatários enviada ao titular.' },
    });
    expect(res.status).toBe(200);
    expect(banco.auditoria.length).toBe(antes + 1);
    expect(banco.auditoria.at(-1)!.acao).toBe('SOLICITACAO_CONCLUIDA');

    const s = banco.cenario.solicitacoes.find((x) => x.id === 's1')!;
    expect(s.status).toBe('concluida');
    expect(s.concluidaEmMs).toBeGreaterThan(0);
  });

  it('recusar sem fundamento é 422; com fundamento, muda o status para recusada', () => {
    const semRazao = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/requests/s1/concluir',
      body: { desfecho: 'recusado_com_fundamento', evidencia: 'não dá' },
    });
    expect(semRazao.status).toBe(422);
    expect(banco.cenario.solicitacoes.find((x) => x.id === 's1')!.status).toBe('em_analise');

    // PR 16 — fundamento continua obrigatório, e agora a recusa também nomeia o
    // que ficou: item, lei e data. Sem a lista, 422 mesmo com a razão escrita.
    const semRetidos = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/requests/s1/concluir',
      body: { desfecho: 'recusado_com_fundamento', evidencia: 'Guarda fiscal obrigatória de 5 anos impede a eliminação agora.' },
    });
    expect(semRetidos.status).toBe(422);

    const comRazao = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/requests/s1/concluir',
      body: {
        desfecho: 'recusado_com_fundamento',
        evidencia: 'Guarda fiscal obrigatória de 5 anos impede a eliminação agora.',
        retidos: [{
          item: 'Notas fiscais das suas compras', base_legal: 'obrigacao_legal',
          artigo: 'Art. 16, I', retencao_ate: '2031-07-29',
        }],
      },
    });
    expect(comRazao.status).toBe(200);
    // PR 7 — o estado passou a se chamar como no MAPA.
    expect(banco.cenario.solicitacoes.find((x) => x.id === 's1')!.status).toBe('recusada_com_fundamento');
  });

  it('se o audit trail falha, a solicitação continua aberta', () => {
    banco.simularFalhaDeLog = true;
    const res = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/requests/s1/concluir',
      body: { desfecho: 'atendido', evidencia: 'Pacote entregue.' },
    });
    expect(res.status).toBe(503);
    expect(banco.cenario.solicitacoes.find((x) => x.id === 's1')!.status).toBe('em_analise');
  });

  it('concluir é ato do DPO — engenharia escreve, mas não encerra', () => {
    expect(pode('engenharia', 'escrever')).toBe(true);
    expect(pode('engenharia', 'concluir_solicitacao')).toBe(false);
    const res = chamar('engenharia', {
      metodo: 'POST', caminho: '/v1/requests/s1/concluir',
      body: { desfecho: 'atendido', evidencia: 'Pacote entregue.' },
    });
    expect(res.status).toBe(403);
  });
});

describe('T4-03 — revisão de decisão automatizada deixa prova (Art. 20)', () => {
  it('exige fundamento, registra e devolve resposta ao titular no mesmo ato', () => {
    const curto = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/decisoes/dec_44ab10/revisar',
      body: { resultado: 'revertida', fundamento: 'ok' },
    });
    expect(curto.status).toBe(422);

    const s3 = banco.cenario.solicitacoes.find((x) => x.id === 's3')!;
    const mensagensAntes = s3.mensagens.length;
    const res = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/decisoes/dec_44ab10/revisar',
      body: { resultado: 'revertida', fundamento: 'Comprovante de renda apresentado não estava na base na hora da decisão.' },
    });
    expect(res.status).toBe(200);
    expect(banco.auditoria.at(-1)!.acao).toBe('DECISAO_REVISADA');
    expect(banco.auditoria.at(-1)!.protocolo).toBe('2026-0729');
    expect(s3.mensagens.length).toBe(mensagensAntes + 1);

    const decisao = banco.cenario.titulares.find((t) => t.id === 't3')!.decisao!;
    expect(decisao.revisao?.resultado).toBe('revertida');
    expect(decisao.aprovado).toBe(true); // era false, foi revertida de fato
  });

  it('manter o resultado também exige fundamento — homologar não é revisar', () => {
    const res = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/decisoes/dec_44ab10/revisar',
      body: { resultado: 'mantida', fundamento: '' },
    });
    expect(res.status).toBe(422);
  });

  it('rever decisão é ato do DPO; para os demais a rota recusa', () => {
    for (const p of ['engenharia', 'produto', 'seguranca', 'auditor'] as Papel[]) {
      expect(pode(p, 'revisar_decisao'), p).toBe(false);
      const res = chamar(p, {
        metodo: 'POST', caminho: '/v1/decisoes/dec_44ab10/revisar',
        body: { resultado: 'mantida', fundamento: 'Decisão conferida e mantida após análise dos fatores.' },
      });
      expect(res.status, p).toBe(403);
    }
  });
});

describe('T4-05 — "atendidas no SLA" mede SLA', () => {
  it('cada solicitação encerrada tem instante de conclusão comparável ao prazo', () => {
    for (const id of ['banco', 'varejo', 'midia']) {
      const b = new BancoMock(id);
      const encerradas = b.cenario.solicitacoes.filter((s) => s.status === 'concluida' || s.status === 'recusada_com_fundamento');
      expect(encerradas.length, id).toBeGreaterThan(0);
      for (const s of encerradas) {
        expect(s.concluidaEmMs, `${id}/${s.protocolo} sem instante de conclusão`).toBeDefined();
        // O rótulo exibido é derivado do instante: não dá para divergirem.
        expect(s.concluidaEm).toBe(new Date(s.concluidaEmMs!).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
      }
    }
  });

  it('a conclusão registrada pela rota fica dentro ou fora do prazo conforme o relógio', () => {
    const s2 = banco.cenario.solicitacoes.find((x) => x.id === 's2')!;
    chamar('dpo', {
      metodo: 'POST', caminho: '/v1/requests/s2/concluir',
      body: { desfecho: 'atendido', evidencia: 'Eliminação executada e verificada.' },
    });
    // s2 vence em 19 h: concluída agora, está no prazo.
    expect(s2.concluidaEmMs!).toBeLessThanOrEqual(s2.prazoLimiteMs);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PR 3 — Acessibilidade da ação (T5) e rastro da auditoria (T6)
// ═════════════════════════════════════════════════════════════════════════════

const PAPEIS_TODOS: Papel[] = ['engenharia', 'dpo', 'produto', 'seguranca', 'auditor'];

describe('T6-01 — verificar integridade deixa rastro de quem verificou', () => {
  it('grava INTEGRIDADE_VERIFICADA antes de devolver o resultado', () => {
    const antes = banco.auditoria.length;
    const res = chamar('auditor', { metodo: 'POST', caminho: '/v1/audit/verificar' });
    expect(res.status).toBe(200);
    expect(banco.auditoria.length).toBe(antes + 1);

    const registro = banco.auditoria.at(-1)!;
    expect(registro.acao).toBe('INTEGRIDADE_VERIFICADA');
    expect(registro.atorPapel).toBe('auditor');
    // O registro entrou na cadeia antes da leitura: o resultado já o conta.
    expect((res.body as { blocos: number }).blocos).toBe(antes + 1);
  });

  it('se o audit trail falha, a verificação falha e nenhum veredito sai', () => {
    banco.simularFalhaDeLog = true;
    const res = chamar('auditor', { metodo: 'POST', caminho: '/v1/audit/verificar' });
    expect(res.status).toBe(503);
    expect(res.body).not.toHaveProperty('integro');
  });

  it('verificar duas vezes devolve contagens diferentes — e a cadeia segue íntegra', () => {
    const primeira = chamar<{ blocos: number; integro: boolean }>('auditor', {
      metodo: 'POST', caminho: '/v1/audit/verificar',
    });
    const segunda = chamar<{ blocos: number; integro: boolean }>('auditor', {
      metodo: 'POST', caminho: '/v1/audit/verificar',
    });
    // Efeito deliberado do T6-01: a primeira verificação entrou na cadeia.
    expect(segunda.body.blocos).toBe(primeira.body.blocos + 1);
    expect(primeira.body.integro).toBe(true);
    expect(segunda.body.integro).toBe(true);
  });

  it('todos os cinco papéis verificam — o auditor externo inclusive', () => {
    for (const p of PAPEIS_TODOS) {
      expect(pode(p, 'verificar_integridade'), p).toBe(true);
      const b = new BancoMock('banco');
      expect(request(b, { papel: p, ator: 'teste', metodo: 'POST', caminho: '/v1/audit/verificar' }).status, p).toBe(200);
    }
  });

  it('verificar continua leitura: não exige escrever, e a política diz isso', () => {
    // Invariante: se alguém mover a rota para `escrita`, o auditor perde o ato
    // que sustenta o parecer dele — e este teste falha antes disso chegar longe.
    const politica = politicaDe('POST', 'audit/verificar')!;
    expect(politica.tipo).toBe('leitura');
    expect(politica.acao).toBe('verificar_integridade');
    expect(pode('auditor', 'escrever')).toBe(false);
  });

  it('o banco sabe dizer quem verificou por último, lido do próprio trail', () => {
    // A semente já traz uma verificação de Rita Nunes: o card nunca nasce vazio.
    expect(banco.ultimaVerificacao()?.ator).toBe('Rita Nunes');
    chamar('seguranca', { metodo: 'POST', caminho: '/v1/audit/verificar' });
    // Derivado do trail, não de um campo paralelo: a última passa a ser a nova.
    const ultima = banco.ultimaVerificacao()!;
    expect(ultima.ator).toBe('teste');
    expect(ultima.id).toBe(banco.auditoria.at(-1)!.id);
  });
});

describe('C-06 — exportar o audit trail é um acesso, e fica registrado', () => {
  it('papel sem exportar_auditoria recebe 403 e nenhum CSV', () => {
    expect(pode('engenharia', 'exportar_auditoria')).toBe(false);
    const res = chamar('engenharia', { metodo: 'POST', caminho: '/v1/audit/exportar' });
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('csv');
  });

  it('o registro entra antes de o arquivo existir, e a si mesmo não conta', () => {
    const antes = banco.auditoria.length;
    const res = chamar<{ csv: string; linhas: number }>('dpo', {
      metodo: 'POST', caminho: '/v1/audit/exportar',
    });
    expect(res.status).toBe(200);
    expect(banco.auditoria.length).toBe(antes + 1);
    // O CSV foi montado depois do append: a linha da própria exportação está nele.
    expect(res.body.linhas).toBe(antes + 1);
    expect(res.body.csv).toContain('AUDIT_EXPORTADO');
  });

  it('a exportação filtrada e a completa são atos distintos no trail', () => {
    chamar('dpo', { metodo: 'POST', caminho: '/v1/audit/exportar', body: { filtro: 'EXPURGO' } });
    const filtrada = banco.auditoria.at(-1)!;
    expect(filtrada.acao).toBe('AUDIT_EXPORTADO');
    expect(filtrada.recursoId).toBe('filtro:EXPURGO');
    expect(filtrada.campos.some((c) => c.startsWith('linhas='))).toBe(true);
    expect(filtrada.campos).toContain('papel=dpo');

    chamar('dpo', { metodo: 'POST', caminho: '/v1/audit/exportar' });
    expect(banco.auditoria.at(-1)!.recursoId).toBe('trail_completo');
  });

  it('se o audit trail falha, nada é exportado', () => {
    banco.simularFalhaDeLog = true;
    const res = chamar('dpo', { metodo: 'POST', caminho: '/v1/audit/exportar' });
    expect(res.status).toBe(503);
    expect(res.body).not.toHaveProperty('csv');
  });

  it('o CSV carrega o hash do próprio conteúdo no rodapé', () => {
    const res = chamar<{ csv: string; hashArquivo: string; linhas: number }>('dpo', {
      metodo: 'POST', caminho: '/v1/audit/exportar',
    });
    expect(res.status).toBe(200);
    expect(res.body.csv).toContain(`# sha256=${res.body.hashArquivo}`);
    // O hash é do conteúdo, não do arquivo com rodapé: quem confere em 2029
    // recalcula sobre as linhas e chega ao mesmo valor.
    const conteudo = res.body.csv.split('\n').filter((l) => !l.startsWith('#')).join('\n');
    expect(sha256(conteudo)).toBe(res.body.hashArquivo);
  });

  it('anti-enumeração vale no export: papel não confiável não recebe o total', () => {
    const doAuditor = chamar<{ totalNoTrail?: number; linhas: number }>('auditor', {
      metodo: 'POST', caminho: '/v1/audit/exportar', body: { filtro: 'EXPURGO' },
    });
    expect(doAuditor.status).toBe(200);
    expect(pode('auditor', 'ver_total_itens')).toBe(false);
    expect(doAuditor.body.totalNoTrail).toBeUndefined();
    expect(doAuditor.body.linhas).toBeGreaterThan(0);

    const doDpo = chamar<{ totalNoTrail?: number }>('dpo', { metodo: 'POST', caminho: '/v1/audit/exportar' });
    expect(doDpo.body.totalNoTrail).toBe(banco.auditoria.length);
  });
});

describe('T5-01 — reclassificar sem arrasto', () => {
  beforeEach(() => {
    limparBancosDaSessao();
    useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [] });
  });

  it('a matriz é grade com 25 células e um botão por risco', () => {
    render(<MemoryRouter><T5 /></MemoryRouter>);
    expect(screen.getAllByRole('gridcell')).toHaveLength(25);
    const b = useSessao.getState().banco;
    for (const r of b.cenario.riscos) {
      expect(screen.getByRole('button', { name: new RegExp(`^${r.codigo}:`) })).toBeInTheDocument();
    }
  });

  it('o nome acessível traz descrição, P, I e score — não só a letra', () => {
    render(<MemoryRouter><T5 /></MemoryRouter>);
    const b = useSessao.getState().banco;
    const r = b.cenario.riscos[0];
    const botao = screen.getByRole('button', { name: new RegExp(`^${r.codigo}:`) });
    expect(botao.getAttribute('aria-label')).toContain(r.descricao);
    expect(botao.getAttribute('aria-label')).toContain(`score ${r.probabilidade * r.impacto}`);
  });

  it('as setas ajustam sem aplicar: nada é gravado até a justificativa', () => {
    render(<MemoryRouter><T5 /></MemoryRouter>);
    const b = useSessao.getState().banco;
    const r = b.cenario.riscos[0];
    const antesP = r.probabilidade;
    const antesLog = b.auditoria.length;

    const botao = screen.getByRole('button', { name: new RegExp(`^${r.codigo}:`) });
    fireEvent.click(botao);
    fireEvent.keyDown(botao, { key: 'ArrowRight' });

    // A prévia aparece…
    expect(screen.getByText(/Registrar reclassificação/i)).toBeInTheDocument();
    // …e o risco não mudou, nem o trail.
    expect(b.cenario.riscos[0].probabilidade).toBe(antesP);
    expect(b.auditoria.length).toBe(antesLog);
    expect(b.reclassificacoes).toHaveLength(0);
  });

  it('aplicar pelo teclado passa pelo modal e exige justificativa', () => {
    render(<MemoryRouter><T5 /></MemoryRouter>);
    const b = useSessao.getState().banco;
    const r = b.cenario.riscos[0];
    const botao = screen.getByRole('button', { name: new RegExp(`^${r.codigo}:`) });
    fireEvent.click(botao);
    fireEvent.keyDown(botao, { key: 'ArrowUp' });
    fireEvent.click(screen.getByRole('button', { name: /Registrar reclassificação/i }));

    const confirmar = screen.getByRole('button', { name: /Registrar reclassificação/i });
    expect(confirmar).toBeDisabled();
    expect(b.reclassificacoes).toHaveLength(0);
  });

  it('quem não gerencia risco não recebe o controle de reclassificar', () => {
    useSessao.setState({ papel: 'produto' });
    render(<MemoryRouter><T5 /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /Reclassificar P × I/i })).toBeNull();
    expect(pode('produto', 'gerenciar_risco')).toBe(false);
  });
});

describe('T5-02 — cada cenário guarda o próprio histórico', () => {
  it('trocar de cenário e voltar reencontra as reclassificações', () => {
    limparBancosDaSessao();
    useSessao.setState({ papel: 'dpo', cenarioId: 'banco', versao: 0, avisos: [] });
    const { setCenario, chamar: chamarNaSessao } = useSessao.getState();

    setCenario('banco');
    const primeiro = useSessao.getState().banco;
    const risco = primeiro.cenario.riscos[0];
    chamarNaSessao({
      metodo: 'PATCH', caminho: `/v1/risks/${risco.codigo}`,
      body: { probabilidade: 2, impacto: 2, justificativa: 'Pseudonimização em produção reduz a exposição.' },
    });
    expect(primeiro.reclassificacoes).toHaveLength(1);

    setCenario('varejo');
    expect(useSessao.getState().banco.reclassificacoes).toHaveLength(0);

    setCenario('banco');
    expect(useSessao.getState().banco).toBe(primeiro);
    expect(useSessao.getState().banco.reclassificacoes).toHaveLength(1);
  });

  it('o trail de cada cenário também sobrevive à troca', () => {
    limparBancosDaSessao();
    useSessao.setState({ papel: 'auditor', cenarioId: 'banco', versao: 0, avisos: [] });
    const { setCenario, chamar: chamarNaSessao } = useSessao.getState();

    setCenario('banco');
    chamarNaSessao({ metodo: 'POST', caminho: '/v1/audit/verificar' });
    const comVerificacao = useSessao.getState().banco.auditoria.length;

    setCenario('midia');
    setCenario('banco');
    expect(useSessao.getState().banco.auditoria.length).toBe(comVerificacao);
    expect(useSessao.getState().banco.ultimaVerificacao()).not.toBeNull();
  });
});

describe('T5-03 — só é botão a célula que a ação alcança', () => {
  it('as letras do RACI não são mais botões', () => {
    limparBancosDaSessao();
    useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [] });
    render(<MemoryRouter><T5 /></MemoryRouter>);
    for (const letra of ['A', 'R', 'C', 'I']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${letra}$`) })).toBeNull();
    }
  });

  it('a demonstração da recusa é um controle só, e some para papel de leitura', () => {
    limparBancosDaSessao();
    useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [] });
    const { unmount } = render(<MemoryRouter><T5 /></MemoryRouter>);
    const doDpo = screen.getAllByRole('button', { name: /Tentar um segundo accountable/i });
    expect(doDpo.length).toBe(useSessao.getState().banco.cenario.raci.length);
    unmount();

    useSessao.setState({ papel: 'auditor' });
    render(<MemoryRouter><T5 /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /Tentar um segundo accountable/i })).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PR 4 — Lacunas de cobertura LGPD (C-07 incidente · C-08 consentimento)
// ═════════════════════════════════════════════════════════════════════════════

const FUNDAMENTO = 'Exposição confirmada de CPF e nome de 4.118 titulares por token válido.';

/** O incidente semeado nasce em `aberto`, para as transições serem exercitáveis. */
const incidenteDe = (b: BancoMock) => b.cenario.incidentes[0];

describe('C-07 · máquina de estados do incidente — verificação, não validação', () => {
  it('a tabela de transições é a do MAPA-PROCESSOS e nada além dela', () => {
    expect(TRANSICOES_INCIDENTE.aberto).toEqual(['contido']);
    expect(TRANSICOES_INCIDENTE.contido).toEqual(['decidido']);
    expect(TRANSICOES_INCIDENTE.decidido).toEqual(['comunicado', 'nao_comunicado']);
    expect(TRANSICOES_INCIDENTE.comunicado).toEqual(['encerrado']);
    expect(TRANSICOES_INCIDENTE.nao_comunicado).toEqual(['encerrado']);
    expect(TRANSICOES_INCIDENTE.encerrado).toEqual([]);
  });

  it('não existe atalho de estado nenhum para nenhum outro fora da tabela', () => {
    const todos: EstadoIncidente[] = ['aberto', 'contido', 'decidido', 'comunicado', 'nao_comunicado', 'encerrado'];
    for (const de of todos) {
      for (const para of todos) {
        expect(transicaoPermitida('incidente', de, para), `${de} → ${para}`)
          .toBe(TRANSICOES_INCIDENTE[de].includes(para));
      }
    }
  });

  it('pular a contenção é 409, não 422 — o problema é a sequência, não o conteúdo', () => {
    const inc = incidenteDe(banco);
    expect(inc.estado).toBe('aberto');
    const res = chamar('dpo', {
      metodo: 'POST', caminho: `/v1/incidentes/${inc.id}/decisao`,
      body: { decisao: 'comunicar_anpd', fundamento: FUNDAMENTO },
    });
    expect(res.status).toBe(409);
    expect(inc.estado).toBe('aberto');
    expect(inc.decisao).toBeUndefined();
  });

  it('comunicar sem decisão registrada é 409', () => {
    const inc = incidenteDe(banco);
    chamar('seguranca', { metodo: 'POST', caminho: `/v1/incidentes/${inc.id}/conter`, body: { nota: 'Token revogado.' } });
    expect(inc.estado).toBe('contido');
    const res = chamar('dpo', { metodo: 'POST', caminho: `/v1/incidentes/${inc.id}/comunicar` });
    expect(res.status).toBe(409);
  });

  it('encerrado não volta: reabrir é registro novo', () => {
    const inc = incidenteDe(banco);
    inc.estado = 'encerrado';
    const res = chamar('seguranca', { metodo: 'POST', caminho: `/v1/incidentes/${inc.id}/conter`, body: { nota: 'x' } });
    expect(res.status).toBe(409);
    expect((res.body as { erro: string }).erro).toContain('encerrado');
  });
});

describe('C-07 · decidir exige fundamento — inclusive para não comunicar (Art. 48)', () => {
  const conter = (b: BancoMock) => request(b, {
    papel: 'seguranca', ator: 'teste', metodo: 'POST',
    caminho: `/v1/incidentes/${incidenteDe(b).id}/conter`, body: { nota: 'Token revogado.' },
  });

  it('nao_comunicar sem fundamento é 422, e a decisão não persiste', () => {
    conter(banco);
    const inc = incidenteDe(banco);
    const antes = banco.auditoria.length;
    const res = chamar('dpo', {
      metodo: 'POST', caminho: `/v1/incidentes/${inc.id}/decisao`,
      body: { decisao: 'nao_comunicar' },
    });
    expect(res.status).toBe(422);
    expect(inc.estado).toBe('contido');
    expect(inc.decisao).toBeUndefined();
    expect(banco.auditoria.length).toBe(antes);
  });

  it('nao_comunicar com fundamento grava no trail antes de responder', () => {
    conter(banco);
    const inc = incidenteDe(banco);
    const antes = banco.auditoria.length;
    const res = chamar('dpo', {
      metodo: 'POST', caminho: `/v1/incidentes/${inc.id}/decisao`,
      body: { decisao: 'nao_comunicar', fundamento: 'Dados expostos eram pseudonimizados sem chave acessível ao atacante.' },
    });
    expect(res.status).toBe(200);
    expect(banco.auditoria.length).toBe(antes + 1);

    const registro = banco.auditoria.at(-1)!;
    expect(registro.acao).toBe('INCIDENTE_DECIDIDO');
    expect(registro.campos).toContain('nao_comunicar');
    expect(inc.estado).toBe('decidido');
    expect(inc.decisao).toBe('nao_comunicar');
  });

  it('o fundamento é redigido antes de entrar no registro imutável (C-04)', () => {
    conter(banco);
    const inc = incidenteDe(banco);
    chamar('dpo', {
      metodo: 'POST', caminho: `/v1/incidentes/${inc.id}/decisao`,
      body: { decisao: 'comunicar_anpd', fundamento: 'Titular 529.982.247-25 relatou uso indevido do cartão informado.' },
    });
    expect(banco.auditoria.at(-1)!.justificativa).not.toContain('529.982.247-25');
    expect(inc.fundamento).toContain('[CPF removido]');
  });

  it('se o audit trail falha ao decidir, a decisão não persiste', () => {
    conter(banco);
    const inc = incidenteDe(banco);
    banco.simularFalhaDeLog = true;
    const res = chamar('dpo', {
      metodo: 'POST', caminho: `/v1/incidentes/${inc.id}/decisao`,
      body: { decisao: 'comunicar_anpd_e_titulares', fundamento: FUNDAMENTO },
    });
    expect(res.status).toBe(503);
    expect(inc.estado).toBe('contido');
    expect(inc.decisao).toBeUndefined();
  });

  it('a comunicação segue a decisão registrada: não comunicar não vira comunicado', () => {
    conter(banco);
    const inc = incidenteDe(banco);
    chamar('dpo', {
      metodo: 'POST', caminho: `/v1/incidentes/${inc.id}/decisao`,
      body: { decisao: 'nao_comunicar', fundamento: 'Risco não relevante: dado agregado sem reidentificação viável.' },
    });
    const res = chamar('dpo', { metodo: 'POST', caminho: `/v1/incidentes/${inc.id}/comunicar` });
    expect(res.status).toBe(409);
    expect(chamar('dpo', { metodo: 'POST', caminho: `/v1/incidentes/${inc.id}/registrar-nao-comunicacao` }).status).toBe(200);
    expect(inc.estado).toBe('nao_comunicado');
  });

  it('decidir é do DPO; conter é de quem opera a resposta', () => {
    expect(pode('dpo', 'comunicar_incidente')).toBe(true);
    expect(pode('seguranca', 'comunicar_incidente')).toBe(false);
    expect(pode('seguranca', 'abrir_incidente')).toBe(true);
    expect(pode('engenharia', 'abrir_incidente')).toBe(true);
    expect(pode('auditor', 'abrir_incidente')).toBe(false);

    const inc = incidenteDe(banco);
    expect(chamar('seguranca', {
      metodo: 'POST', caminho: `/v1/incidentes/${inc.id}/decisao`,
      body: { decisao: 'comunicar_anpd', fundamento: FUNDAMENTO },
    }).status).toBe(403);
  });

  it('o escopo é lido do catálogo: campo fora do ROPA não abre incidente', () => {
    const res = chamar('seguranca', {
      metodo: 'POST', caminho: '/v1/incidentes',
      body: { origem: 'alerta de volume', camposIds: ['b-cpf', 'campo-inventado'], titularesEstimados: 10 },
    });
    expect(res.status).toBe(422);
    expect((res.body as { erro: string }).erro).toContain('catálogo');
  });
});

describe('C-08 · consentimento como prova, e revogação que propaga', () => {
  let varejo: BancoMock;
  const chamarV = <T = unknown,>(papel: Papel, req: Partial<Parameters<typeof request>[1]> & { metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE'; caminho: string }) =>
    request<T>(varejo, { papel, ator: 'teste', ...req });

  beforeEach(() => { varejo = new BancoMock('varejo'); });

  it('contraprova: campo com consentimento ativo e finalidade compatível revela', () => {
    const consent = varejo.cenario.consentimentos.find((c) => c.campoId === 'v-tel')!;
    expect(consent.estado).toBe('ativo');
    const res = chamarV('dpo', {
      metodo: 'POST', caminho: '/v1/pseudonyms/resolve', purpose: 'atendimento',
      body: { titularId: 't1', campo: 'telefone', protocolo: '2026-0731', justificativa: 'Contato para confirmar a solicitação do titular.' },
    });
    expect(res.status).toBe(200);
  });

  it('revogado, o mesmo campo deixa de ser revelável — 422 citando o artigo', () => {
    chamarV('dpo', {
      metodo: 'POST', caminho: '/v1/consentimentos/v-tel/revogar',
      body: { motivo: 'Titular pediu a revogação pelo canal do programa de fidelidade.' },
    });
    const res = chamarV('dpo', {
      metodo: 'POST', caminho: '/v1/pseudonyms/resolve', purpose: 'atendimento',
      body: { titularId: 't1', campo: 'telefone', protocolo: '2026-0731', justificativa: 'Contato para confirmar a solicitação do titular.' },
    });
    expect(res.status).toBe(422);
    expect(`${(res.body as { erro: string }).erro} ${res.regra ?? ''}`).toContain('Art. 8');
    expect(JSON.stringify(res.body)).not.toContain('98812');
  });

  it('a revogação fica registrada e aciona o gate do repositório do campo', () => {
    const antes = varejo.auditoria.length;
    const res = chamarV<{ gatesBloqueados: number }>('dpo', {
      metodo: 'POST', caminho: '/v1/consentimentos/v-tel/revogar',
      body: { motivo: 'Titular pediu a revogação pelo canal do programa de fidelidade.' },
    });
    expect(res.status).toBe(200);
    expect(varejo.auditoria.length).toBe(antes + 1);
    expect(varejo.auditoria.at(-1)!.acao).toBe('CONSENTIMENTO_REVOGADO');
    expect(res.body.gatesBloqueados).toBeGreaterThan(0);
    expect(varejo.cenario.gates.some((g) => g.bloqueouMerge)).toBe(true);
  });

  it('revogar duas vezes é 409: a segunda não é revogação, é ruído no trail', () => {
    const corpo = { motivo: 'Titular pediu a revogação pelo canal do programa de fidelidade.' };
    expect(chamarV('dpo', { metodo: 'POST', caminho: '/v1/consentimentos/v-tel/revogar', body: corpo }).status).toBe(200);
    expect(chamarV('dpo', { metodo: 'POST', caminho: '/v1/consentimentos/v-tel/revogar', body: corpo }).status).toBe(409);
  });

  it('validar inventário recusa baseLegal consentimento sem registro vigente', () => {
    const semRegistro = chamarV('engenharia', {
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: { nome: 'novo', tipoArmazenado: 'bruto', categoria: 'pessoal', sensivel: false, baseLegal: 'consentimento', finalidadesCompativeis: ['atendimento'] },
    });
    expect(semRegistro.status).toBe(422);
    expect((semRegistro.body as { erro: string }).erro).toContain('consentimento');

    const comRegistro = chamarV('engenharia', {
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: { campoId: 'v-tel', nome: 'telefone', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, baseLegal: 'consentimento', finalidadesCompativeis: ['atendimento'] },
    });
    expect(comRegistro.status).toBe(200);
  });

  it('revogado, o inventário volta a recusar o mesmo campo', () => {
    chamarV('dpo', {
      metodo: 'POST', caminho: '/v1/consentimentos/v-tel/revogar',
      body: { motivo: 'Titular pediu a revogação pelo canal do programa de fidelidade.' },
    });
    const res = chamarV('engenharia', {
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: { campoId: 'v-tel', nome: 'telefone', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, baseLegal: 'consentimento', finalidadesCompativeis: ['atendimento'] },
    });
    expect(res.status).toBe(422);
  });

  it('revogado, a tela deixa de oferecer o botão — e diz por quê', () => {
    limparBancosDaSessao();
    useSessao.setState({ papel: 'dpo', banco: varejo, versao: 0, avisos: [], protocoloSelecionado: '2026-0731' });
    const { unmount } = render(<CampoPII titularId="t1" chave="telefone" rotulo="Telefone" mascara="(••) •••••-••••" sensivel={false} />);
    expect(screen.getByRole('button', { name: /revelar/i })).toBeInTheDocument();
    unmount();

    chamarV('dpo', {
      metodo: 'POST', caminho: '/v1/consentimentos/v-tel/revogar',
      body: { motivo: 'Titular pediu a revogação pelo canal do programa de fidelidade.' },
    });
    useSessao.setState({ versao: 1 });
    render(<CampoPII titularId="t1" chave="telefone" rotulo="Telefone" mascara="(••) •••••-••••" sensivel={false} />);
    // Ausência em vez de desabilitado — e a razão fica visível no lugar.
    expect(screen.queryByRole('button', { name: /revelar/i })).toBeNull();
    expect(screen.getByText(/consentimento revogado/i)).toBeInTheDocument();
  });

  it('revogar é ato do DPO, e a rota recusa os demais', () => {
    for (const p of ['engenharia', 'produto', 'seguranca', 'auditor'] as Papel[]) {
      expect(pode(p, 'revogar_consentimento'), p).toBe(false);
      expect(chamarV(p, {
        metodo: 'POST', caminho: '/v1/consentimentos/v-tel/revogar', body: { motivo: 'x'.repeat(30) },
      }).status, p).toBe(403);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PR 5 — Fidelidade do protótipo e mensagens
// Unidade (store e primitivos) · integração (tela + API) · sistema (fluxo entre
// telas) · aceitação (os quatro critérios do pedido).
// ═════════════════════════════════════════════════════════════════════════════

const montar = (tela: React.ReactNode) => render(<MemoryRouter>{tela}</MemoryRouter>);

describe('C-10 · unidade — a recusa mora no controle, não no canto', () => {
  beforeEach(() => {
    limparBancosDaSessao();
    useSessao.setState({ papel: 'engenharia', banco: new BancoMock('banco'), versao: 0, avisos: [], recusas: {} });
  });

  it('chamada com âncora não polui o canal de confirmação', () => {
    const { chamar: chamarNaSessao } = useSessao.getState();
    chamarNaSessao({ metodo: 'POST', caminho: `/v1/ripds/r1/aprovar` }, 'ripd-aprovar');

    const { avisos, recusas } = useSessao.getState();
    expect(avisos).toHaveLength(0);
    expect(recusas['ripd-aprovar'].texto).toContain('DPO');
  });

  it('sem âncora, a recusa cai no canal do canto — o último recurso', () => {
    const { chamar: chamarNaSessao } = useSessao.getState();
    chamarNaSessao({ metodo: 'POST', caminho: `/v1/ripds/r1/aprovar` });
    expect(useSessao.getState().avisos.at(-1)?.tom).toBe('negado');
    expect(useSessao.getState().recusas).toEqual({});
  });

  it('a mesma ação bem-sucedida limpa a recusa anterior', () => {
    const b = useSessao.getState().banco;
    useSessao.setState({ papel: 'dpo', recusas: { 'ripd-aprovar': { texto: 'antiga', id: 0 } } });
    // Com a P0 aberta a aprovação ainda falha; a recusa só some quando o ato
    // que a produziu passa de verdade.
    b.cenario.ripds[0].recomendacoes.forEach((r) => { r.concluida = true; });
    useSessao.getState().chamar({ metodo: 'POST', caminho: `/v1/ripds/r1/aprovar` }, 'ripd-aprovar');
    expect(useSessao.getState().recusas['ripd-aprovar']).toBeUndefined();
  });

  it('o canal do canto guarda no máximo três avisos simultâneos', () => {
    const { avisar } = useSessao.getState();
    for (let i = 0; i < 6; i++) avisar('info', `aviso ${i}`);
    expect(useSessao.getState().avisos).toHaveLength(3);
    expect(useSessao.getState().avisos[0].texto).toBe('aviso 3');
  });
});

describe('C-16 · unidade — didático some, operacional permanece', () => {
  it('o texto didático não é renderizado fora do modo apresentação', () => {
    useSessao.setState({ modoApresentacao: true });
    const { unmount } = render(<Didatico><p>explicação do conceito</p></Didatico>);
    expect(screen.getByText('explicação do conceito')).toBeInTheDocument();
    unmount();

    useSessao.setState({ modoApresentacao: false });
    render(<Didatico><p>explicação do conceito</p></Didatico>);
    expect(screen.queryByText('explicação do conceito')).toBeNull();
  });

  it('a recusa e o estado continuam visíveis com o didático desligado', () => {
    limparBancosDaSessao();
    useSessao.setState({
      papel: 'engenharia', banco: new BancoMock('banco'), versao: 0,
      modoApresentacao: false, recusas: { 'ripd-aprovar': { texto: 'Somente o DPO aprova RIPD.', id: 1 } },
    });
    montar(<T3 />);
    const alertas = screen.getAllByRole('alert');
    expect(alertas.some((a) => /Somente o DPO aprova RIPD/.test(a.textContent ?? ''))).toBe(true);
    expect(screen.getByText(/recomendação P0 em aberto/)).toBeInTheDocument();
  });
});

describe('T3 · integração — o parecer diz a verdade sobre si mesmo', () => {
  beforeEach(() => {
    limparBancosDaSessao();
    useSessao.setState({
      papel: 'engenharia', banco: new BancoMock('banco'), versao: 0,
      avisos: [], recusas: {}, modoApresentacao: true,
    });
  });

  it('T3-01 · o stepper deriva do conteúdo: seção vazia não fica completa', () => {
    const b = useSessao.getState().banco;
    // A P0 aberta mantém a seção 5 pendente e o topo diz o que falta.
    expect(b.cenario.ripds[0].recomendacoes.some((r) => r.prioridade === 'P0' && !r.concluida)).toBe(true);
    montar(<T3 />);
    expect(screen.getByText(/recomendações P0 concluídas/i)).toBeInTheDocument();

    const passos = document.querySelectorAll('.step');
    expect(passos.length).toBe(5);
    expect([...passos].filter((p) => p.classList.contains('done')).length).toBe(4);
  });

  it('T3-01 · concluir a P0 fecha a seção e o aviso de pendência some', () => {
    const b = useSessao.getState().banco;
    b.cenario.ripds[0].recomendacoes.forEach((r) => { r.concluida = true; });
    montar(<T3 />);
    expect(screen.queryByText(/recomendações P0 concluídas/i)).toBeNull();
    expect([...document.querySelectorAll('.step')].every((p) => p.classList.contains('done'))).toBe(true);
  });

  it('T3-02 · baixar e anexar são dois controles distintos', () => {
    montar(<T3 />);
    expect(screen.getByRole('button', { name: /^Baixar RIPD\.md$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Anexar ao PR #/ })).toBeInTheDocument();
  });

  it('T3-02 · anexar exibe commit, autor e hora', () => {
    montar(<T3 />);
    fireEvent.click(screen.getByRole('button', { name: /Anexar ao PR #/ }));
    const confirmacao = screen.getAllByRole('status')
      .find((n) => /Anexado ao PR/.test(n.textContent ?? ''))!;
    expect(confirmacao).toBeDefined();
    expect(confirmacao).toHaveTextContent(/commit [0-9a-f]{7}/);
    expect(confirmacao).toHaveTextContent(/Maria Souza/);
  });

  it('T3-03 · a tela não abre disparando alerta, e a combinação válida confirma', () => {
    montar(<T3 />);
    // Nenhum alerta antes de a pessoa tocar em nada.
    expect(screen.queryByRole('alert')).toBeNull();
    const comum = useSessao.getState().banco.cenario.campos.find((c) => !c.sensivel)!;
    fireEvent.change(screen.getByLabelText('Campo'), { target: { value: comum.id } });
    fireEvent.change(screen.getByLabelText('Base legal'), { target: { value: 'execucao_contrato' } });

    const status = screen.getAllByRole('status').find((n) => /Combinação aceita/.test(n.textContent ?? ''))!;
    expect(status).toBeDefined();
    expect(status).toHaveTextContent(/execucao_contrato/);
    // Um só alerta por região: o aceite não é alerta.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('T3-03 · combinação inválida continua sendo alerta, e só ela', () => {
    montar(<T3 />);
    const sensivel = useSessao.getState().banco.cenario.campos.find((c) => c.sensivel)!;
    fireEvent.change(screen.getByLabelText('Campo'), { target: { value: sensivel.id } });
    fireEvent.change(screen.getByLabelText('Base legal'), { target: { value: 'legitimo_interesse' } });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(/Art\. 11/);
  });

  it('T3 · aceitação — P0 aberta: aprovar recusa no cartão do botão, não na faixa', () => {
    useSessao.setState({ papel: 'dpo' });
    montar(<T3 />);
    fireEvent.click(screen.getByRole('button', { name: /Aprovar como DPO/ }));

    const alerta = screen.getAllByRole('alert')
      .find((a) => /recomendação P0 em aberto/i.test(a.textContent ?? ''))!;
    expect(alerta).toBeDefined();
    // A recusa fica no mesmo cartão do botão que falhou.
    expect(alerta.closest('.card')).toBe(
      screen.getByRole('button', { name: /Aprovar como DPO/ }).closest('.card'),
    );
    // E não foi para o canal do canto.
    expect(useSessao.getState().avisos.filter((a) => a.tom === 'negado')).toHaveLength(0);
  });
});

describe('T8 · integração — o editor edita e o veredito guarda o raciocínio', () => {
  beforeEach(() => {
    limparBancosDaSessao();
    useSessao.setState({
      papel: 'dpo', banco: new BancoMock('banco'), versao: 0,
      avisos: [], recusas: {}, modoApresentacao: true,
    });
  });

  it('T8-03 · aceitação — campo sensível é inelegível com motivo, não selecionável', () => {
    montar(<T8 />);
    const seletor = screen.getByLabelText('Vincular outro campo') as HTMLSelectElement;
    const sensivel = useSessao.getState().banco.cenario.campos.find((c) => c.sensivel)!;
    const opcao = [...seletor.options].find((o) => o.value === sensivel.id)!;

    expect(opcao.disabled).toBe(true);
    expect(opcao.textContent).toContain('Art. 11');
    // E não é o que a tela pré-seleciona.
    expect(seletor.value).not.toBe(sensivel.id);
    expect(useSessao.getState().banco.cenario.campos.find((c) => c.id === seletor.value)?.sensivel).toBe(false);
  });

  it('T8-01 · o Passo 1 edita para quem assina e é leitura para os demais', () => {
    const { unmount } = montar(<T8 />);
    const desc = screen.getByLabelText('Descrição') as HTMLTextAreaElement;
    fireEvent.change(desc, { target: { value: 'Nova finalidade declarada pelo DPO.' } });
    expect((screen.getByLabelText('Descrição') as HTMLTextAreaElement).value)
      .toBe('Nova finalidade declarada pelo DPO.');
    unmount();

    useSessao.setState({ papel: 'engenharia' });
    montar(<T8 />);
    expect(screen.queryByLabelText('Descrição')).toBeNull();
    expect(screen.getByText(/somente leitura para o seu papel/)).toBeInTheDocument();
  });

  it('T8-02 · o passo 3 só fecha com as duas razões escritas', () => {
    montar(<T8 />);
    const passo3 = [...document.querySelectorAll('.step')][2];
    expect(passo3.classList.contains('done')).toBe(false);

    fireEvent.change(screen.getByLabelText(/Por que o benefício/), {
      target: { value: 'Reduz inadimplência em 18% na safra medida.' },
    });
    fireEvent.change(screen.getByLabelText(/Por que o dano/), {
      target: { value: 'Dado pseudonimizado, retenção de 180 dias e oposição em um clique.' },
    });
    expect([...document.querySelectorAll('.step')][2].classList.contains('done')).toBe(true);
  });
});

describe('T2 · integração — filtros e linhagem', () => {
  beforeEach(() => {
    limparBancosDaSessao();
    useSessao.setState({
      papel: 'engenharia', banco: new BancoMock('banco'), versao: 0,
      avisos: [], recusas: {}, modoApresentacao: true,
    });
  });

  it('T2-03 · aceitação — sem resultado, o estado vazio nomeia os filtros e oferece limpar', () => {
    montar(<T2 />);
    // `protecao_credito` existe no catálogo; combinada com retenção longa, não
    // sobra campo nenhum — que é o recorte vazio que este teste exercita.
    fireEvent.change(screen.getByLabelText('Base legal'), { target: { value: 'protecao_credito' } });
    fireEvent.change(screen.getByLabelText('Retenção'), { target: { value: 'Acima de 1 ano' } });

    const vazio = screen.getByText(/Nenhum campo com os filtros atuais/).closest('.vazio')!;
    expect(vazio).toHaveTextContent(/base legal = protecao_credito/);
    expect(vazio).toHaveTextContent(/retenção = Acima de 1 ano/);

    fireEvent.click(screen.getByRole('button', { name: /Limpar filtros/ }));
    expect(screen.queryByText(/Nenhum campo com os filtros atuais/)).toBeNull();
  });

  it('T2-02 · a linhagem abre como região focável e nomeada', () => {
    montar(<T2 />);
    const campo = useSessao.getState().banco.cenario.campos[0];
    fireEvent.click(screen.getByText(campo.nome).closest('tr')!);
    const regiao = screen.getByRole('region', { name: new RegExp(`Linhagem do campo ${campo.nome}`) });
    expect(regiao).toBeInTheDocument();
    expect(regiao.getAttribute('tabindex')).toBe('-1');
  });

  it('C-15 · a área de inventário recebe arquivo em vez de só anunciar', () => {
    montar(<T2 />);
    const area = screen.getByText(/Arraste o/).closest('.drop')!;
    fireEvent.click(area);
    expect(screen.getByRole('status')).toHaveTextContent(/data-inventory\.exemplo-1\.yaml/);
  });
});

describe('T1 · sistema — dois mapas, dois eixos, um caminho de reclassificação', () => {
  beforeEach(() => {
    limparBancosDaSessao();
    useSessao.setState({
      papel: 'dpo', banco: new BancoMock('banco'), versao: 0,
      avisos: [], recusas: {}, simulandoViolacao: false, riscoSelecionado: null, modoApresentacao: true,
    });
  });

  it('T1-01 · o mapa de esforço não abre o diálogo da matriz P × I', () => {
    montar(<T1 />);
    const bolha = document.querySelector('.bub')!;
    fireEvent.click(bolha);
    // Nenhum modal de reclassificação: este mapa não tem os eixos que ele ajusta.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: /Reclassificar na matriz P × I/ })).toBeInTheDocument();
  });

  it('T1-01 · o encaminhamento leva o risco escolhido para a T5', () => {
    montar(<T1 />);
    fireEvent.click(document.querySelector('.bub')!);
    fireEvent.click(screen.getByRole('link', { name: /Reclassificar na matriz P × I/ }));
    expect(useSessao.getState().riscoSelecionado).toBeTruthy();
  });

  it('T1-02 · aceitação — simulação mantém faixa fixa e bolha tracejada', () => {
    const { unmount } = montar(<T1 />);
    expect(screen.queryByText(/Simulação ativa/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Simular violação$/ }));

    expect(screen.getByText(/Simulação ativa — este painel não representa o cenário real/)).toBeInTheDocument();
    const fabricada = [...document.querySelectorAll('circle')].find((c) => c.getAttribute('stroke-dasharray'));
    expect(fabricada).toBeDefined();
    unmount();

    // T1-02 · o estado é da sessão: remontar a tela não apaga a marca.
    montar(<T1 />);
    expect(screen.getByText(/Simulação ativa/)).toBeInTheDocument();
    expect(useSessao.getState().simulandoViolacao).toBe(true);
  });

  it('T1-02 · o risco fabricado não é reclassificável', () => {
    useSessao.setState({ simulandoViolacao: true });
    montar(<T1 />);
    const r11 = [...document.querySelectorAll('.bub')]
      .find((g) => g.textContent?.includes('R11'))!;
    fireEvent.click(r11);
    expect(screen.getByText(/Risco fabricado pela simulação/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Reclassificar na matriz/ })).toBeNull();
  });
});

describe('T7 · integração — a tela deixa operar, e recusa o que o pipeline não permite', () => {
  beforeEach(() => {
    limparBancosDaSessao();
    useSessao.setState({
      papel: 'seguranca', banco: new BancoMock('banco'), versao: 0,
      avisos: [], recusas: {}, modoApresentacao: true,
    });
  });

  it('T7-01 · agendar rotação registra no trail antes de responder', () => {
    const b = useSessao.getState().banco;
    const antes = b.auditoria.length;
    montar(<T7 />);
    fireEvent.click(screen.getByRole('button', { name: /Agendar rotação/ }));
    expect(b.auditoria.length).toBe(antes + 1);
    expect(b.auditoria.at(-1)!.acao).toBe('ROTACAO_AGENDADA');
  });

  it('T7-01 · promover canary com recriptografia em curso recusa no controle', () => {
    montar(<T7 />);
    fireEvent.click(screen.getByRole('button', { name: /Promover canary/ }));
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent(/recriptografia está em/i);
    expect(useSessao.getState().avisos.filter((a) => a.tom === 'negado')).toHaveLength(0);
  });

  it('T7-01 · papel sem o pipeline não recebe os controles', () => {
    useSessao.setState({ papel: 'produto' });
    montar(<T7 />);
    expect(screen.queryByRole('button', { name: /Agendar rotação/ })).toBeNull();
  });

  it('T7-02 · as duas listas de cripto-shredding são cartões separados', () => {
    montar(<T7 />);
    expect(screen.getByText('Campos com cripto-shredding suportado')).toBeInTheDocument();
    expect(screen.getByText('Chaves sem suporte a shredding')).toBeInTheDocument();
  });
});

describe('C-15 · sistema — nenhum rótulo promete o que o clique não faz', () => {
  it('os controles inertes de T4 e T6 estão marcados e inoperantes', () => {
    limparBancosDaSessao();
    useSessao.setState({
      papel: 'dpo', banco: new BancoMock('banco'), versao: 0,
      avisos: [], recusas: {}, protocoloSelecionado: '2026-0731', modoApresentacao: true,
    });
    const { unmount } = montar(<T4 />);
    const json = screen.getByRole('button', { name: 'JSON' });
    expect(json).toBeDisabled();
    expect(json.closest('.inerte')).not.toBeNull();
    unmount();

    montar(<T6 />);
    const pdf = screen.getByRole('button', { name: /relatório de expurgo/i });
    expect(pdf).toBeDisabled();
    expect(pdf.closest('.inerte')).not.toBeNull();
  });
});

describe('CSS · invariante — nenhuma classe simples declarada duas vezes', () => {
  /**
   * O PR 3 introduziu `.stepper` para os botões −/+ da matriz, colidindo com o
   * `.stepper` que já era o contêiner de passos do parecer (T3) e da LIA (T8).
   * A segunda declaração venceu, os dois steppers colapsaram para 32 × 32 px e
   * as seções passaram a se sobrepor: o botão "Aprovar como DPO" ficou embaixo
   * de um `<h4>` e parou de receber clique.
   *
   * Nenhum teste de comportamento pega isso — jsdom não faz layout, e a suíte
   * inteira continuou verde. O que pega é esta invariante sobre a folha, e é
   * barata o suficiente para valer a pena numa folha escrita à mão.
   */
  it('a folha de estilo não redeclara a mesma classe em dois lugares', async () => {
    // Lido do disco, e não por `import ... ?raw`: sob vitest o CSS é stubado e
    // o import devolve string vazia — o teste passaria sem ler nada, que é pior
    // do que não existir. Descoberto injetando a colisão de propósito.
    // `import.meta.url` sob vitest não é `file:`; o caminho sai do cwd, que é
    // a raiz do app.
    const css = readFileSync('src/ui/estilos.css', 'utf8');
    expect(css.length, 'a folha precisa ter sido lida de verdade').toBeGreaterThan(1000);
    const simples = [...css.matchAll(/^(\.[a-z0-9-]+)\s*\{/gm)].map((m) => m[1]);
    const repetidas = simples.filter((c, i) => simples.indexOf(c) !== i);
    expect([...new Set(repetidas)]).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PR 6 — Legibilidade, larguras e estados
// ═════════════════════════════════════════════════════════════════════════════

describe('C-09 · sistema — o menu reflete o papel', () => {
  beforeEach(() => {
    limparBancosDaSessao();
    useSessao.setState({
      papel: 'engenharia', banco: new BancoMock('banco'), versao: 0,
      avisos: [], recusas: {}, modoApresentacao: true, falhaDeTransporte: false,
    });
  });

  it('aceitação — segurança não vê T4 no menu, e o link direto cai no bloqueio', () => {
    useSessao.setState({ papel: 'seguranca' });
    const { unmount } = render(<MemoryRouter initialEntries={['/t1']}><Casca /></MemoryRouter>);
    // A tela sai do menu inteiro, não fica cinza e clicável.
    const menu = screen.getByRole('navigation', { name: /Telas/i });
    expect(within(menu).queryByText('Direitos do titular')).toBeNull();
    expect(within(menu).getByText('Expurgo e auditoria')).toBeInTheDocument();
    unmount();

    // Link direto continua respondendo — e responde com a página de bloqueio.
    render(<MemoryRouter initialEntries={['/t4']}><Casca /></MemoryRouter>);
    expect(screen.getByText(/Tela indisponível para o seu papel/)).toBeInTheDocument();
  });

  it('o DPO vê a T4; ninguém perde tela sem motivo', () => {
    useSessao.setState({ papel: 'dpo' });
    render(<MemoryRouter initialEntries={['/t1']}><Casca /></MemoryRouter>);
    const menu = screen.getByRole('navigation', { name: /Telas/i });
    expect(within(menu).getByText('Direitos do titular')).toBeInTheDocument();
  });

  it('nenhum item de menu fica "desabilitado" navegando por baixo', () => {
    useSessao.setState({ papel: 'seguranca' });
    render(<MemoryRouter initialEntries={['/t1']}><Casca /></MemoryRouter>);
    const menu = screen.getByRole('navigation', { name: /Telas/i });
    expect(within(menu).queryByLabelText(/indisponível/i)).toBeNull();
    expect([...menu.querySelectorAll('[aria-disabled="true"]')]).toHaveLength(0);
  });

  it('trocar de papel diz em uma linha o que entrou e o que saiu', () => {
    const { rerender } = render(<MemoryRouter initialEntries={['/t1']}><Casca /></MemoryRouter>);
    act(() => { useSessao.setState({ papel: 'seguranca' }); });
    rerender(<MemoryRouter initialEntries={['/t1']}><Casca /></MemoryRouter>);
    const aviso = useSessao.getState().avisos.at(-1);
    expect(aviso?.texto).toMatch(/Saiu: Direitos do titular/);
  });
});

describe('C-11 · invariante — piso tipográfico', () => {
  const PISO_INTERFACE = 12.5;
  const PISO_GRAFICO = 11;

  it('nenhuma declaração de font-size na folha fica abaixo do piso', () => {
    const css = readFileSync('src/ui/estilos.css', 'utf8');
    expect(css.length).toBeGreaterThan(1000);
    /**
     * A isenção de 11px é do **seletor**, não do valor. A primeira versão deste
     * teste isentava o número onde quer que ele aparecesse, e deixou passar o
     * `?` do popover a 11px — só o navegador pegou, medindo o DOM. Aqui a única
     * regra que pode descer até 11 é `.chart text`, o rótulo de eixo.
     */
    const abaixo = [...css.matchAll(/([^\n{}]+)\{([^}]*)\}/g)].flatMap(([, seletor, corpo]) => {
      const m = corpo.match(/font-size:\s*([0-9.]+)px/);
      if (!m) return [];
      const px = Number(m[1]);
      const piso = seletor.includes('.chart text') ? PISO_GRAFICO : PISO_INTERFACE;
      return px < piso ? [`${seletor.trim()}: ${px}px`] : [];
    });
    expect(abaixo).toEqual([]);
  });

  it('nenhum fontSize embutido em SVG fica abaixo do piso de gráfico', () => {
    const { readdirSync } = require('fs') as typeof import('fs');
    const telas = readdirSync('src/screens').filter((f) => f.endsWith('.tsx'));
    const abaixo: string[] = [];
    for (const arquivo of [...telas.map((t) => `src/screens/${t}`), 'src/ui/primitivos.tsx']) {
      const fonte = readFileSync(arquivo, 'utf8');
      for (const m of fonte.matchAll(/fontSize=\{([0-9.]+)\}/g)) {
        if (Number(m[1]) < PISO_GRAFICO) abaixo.push(`${arquivo}: ${m[1]}`);
      }
      // `style={{ fontSize: N }}` também conta como texto de interface.
      for (const m of fonte.matchAll(/fontSize:\s*([0-9.]+)\b/g)) {
        if (Number(m[1]) < PISO_INTERFACE) abaixo.push(`${arquivo}: style ${m[1]}`);
      }
    }
    expect(abaixo).toEqual([]);
  });
});

describe('C-12 · unidade — um só padrão de popover, acionável por teclado', () => {
  it('abre por Enter, fecha por Esc, e mantém o title como redundância', async () => {
    render(<Explica rotulo="hash" titulo="Guarda: hash">Hash irreversível com sal.</Explica>);
    const alvo = screen.getByRole('button', { name: /hash/ });

    expect(alvo).toHaveAttribute('aria-expanded', 'false');
    expect(alvo).toHaveAttribute('title', 'Guarda: hash');
    expect(screen.queryByRole('note')).toBeNull();

    // Enter num `<button>` dispara o clique nativo — é o caminho de teclado.
    alvo.focus();
    fireEvent.keyDown(alvo, { key: 'Enter' });
    fireEvent.click(alvo);
    expect(alvo).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('note')).toHaveTextContent(/Hash irreversível com sal/);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('note')).toBeNull();
    expect(alvo).toHaveAttribute('aria-expanded', 'false');
  });

  it('integração — a guarda do catálogo explica por popover, não só por title', () => {
    limparBancosDaSessao();
    useSessao.setState({
      papel: 'engenharia', banco: new BancoMock('banco'), versao: 0,
      avisos: [], recusas: {}, falhaDeTransporte: false,
    });
    render(<MemoryRouter><T2 /></MemoryRouter>);
    // `name: /hash/` sozinho casaria também a área de soltar o YAML, cujo texto
    // menciona o hash do arquivo. O alvo é o rótulo exato da guarda.
    const alvo = screen.getByRole('button', { name: /^🔒 hash/ });
    fireEvent.click(alvo);
    expect(screen.getByRole('note')).toHaveTextContent(/não é anonimização|força bruta|sal/i);
  });
});

describe('C-13 · integração — os quatro estados', () => {
  beforeEach(() => {
    limparBancosDaSessao();
    useSessao.setState({
      papel: 'engenharia', banco: new BancoMock('banco'), versao: 0,
      avisos: [], recusas: {}, modoApresentacao: true, falhaDeTransporte: false,
    });
  });

  it('aceitação — erro de transporte em GET mostra erro com repetir, e a tabela sai da tela', () => {
    render(<MemoryRouter><T2 /></MemoryRouter>);
    const b = useSessao.getState().banco;
    const primeiro = b.cenario.campos[0];
    expect(screen.getByText(primeiro.nome)).toBeInTheDocument();

    // Só o interruptor, sem bumpar `versao`: a primeira versão deste teste
    // mudava os dois juntos e passava por causa do segundo, escondendo que
    // ligar a queda sozinha não refazia a leitura.
    act(() => { useSessao.setState({ falhaDeTransporte: true }); });

    const falha = screen.getAllByRole('alert').find((n) => /Não foi possível carregar/.test(n.textContent ?? ''))!;
    expect(falha).toBeDefined();
    expect(falha).toHaveTextContent(/repetir é seguro/i);
    expect(within(falha).getByRole('button', { name: /Tentar de novo/ })).toBeInTheDocument();
    // A tabela anterior não fica na tela como se fosse a atual.
    expect(screen.queryByText(primeiro.nome)).toBeNull();

    act(() => { useSessao.setState({ falhaDeTransporte: false }); });
    fireEvent.click(within(falha).getByRole('button', { name: /Tentar de novo/ }));
    expect(screen.getByText(primeiro.nome)).toBeInTheDocument();
  });

  it('o gráfico da T1 também passa pelos quatro estados', () => {
    useSessao.setState({ papel: 'dpo', falhaDeTransporte: true });
    render(<MemoryRouter><T1 /></MemoryRouter>);
    const falha = screen.getAllByRole('alert').find((n) => /o mapa de riscos/.test(n.textContent ?? ''))!;
    expect(falha).toBeDefined();
    expect(document.querySelector('.bub')).toBeNull();
  });

  it('a ação de escrita distingue transporte caído de recusa de regra', () => {
    render(<MemoryRouter><T2 /></MemoryRouter>);
    useSessao.setState({ falhaDeTransporte: true });
    fireEvent.click(screen.getByRole('button', { name: /^Validar$/ }));

    const falha = screen.getAllByRole('alert')
      .find((n) => /não chegou ao servidor/i.test(n.textContent ?? ''))!;
    expect(falha).toBeDefined();
    expect(falha).toHaveTextContent(/Nada foi gravado/);

    // Com o transporte de pé, a mesma ação volta a produzir recusa de regra —
    // que não oferece "tentar de novo", porque repetir daria o mesmo 422.
    act(() => { useSessao.setState({ falhaDeTransporte: false }); });
    fireEvent.click(screen.getByRole('button', { name: /^Validar$/ }));
    expect(screen.queryByText(/não chegou ao servidor/i)).toBeNull();
    expect(screen.getByText(/finalidades compatíveis/)).toBeInTheDocument();
  });

  it('sem permissão é ausência — nunca carregando nem erro', () => {
    limparBancosDaSessao();
    useSessao.setState({ papel: 'auditor', banco: new BancoMock('banco'), versao: 0, falhaDeTransporte: false });
    render(<MemoryRouter><T2 /></MemoryRouter>);
    // O auditor não escreve: o validador não é montado, e nenhum esqueleto ou
    // bloco de falha aparece no lugar dele.
    expect(screen.queryByRole('button', { name: /^Validar$/ })).toBeNull();
    expect(document.querySelector('.esqueleto')).toBeNull();
    expect(screen.queryByText(/Não foi possível carregar/)).toBeNull();
  });
});

describe('T1-03 · unidade — a bolha é botão inteiro', () => {
  beforeEach(() => {
    limparBancosDaSessao();
    useSessao.setState({
      papel: 'dpo', banco: new BancoMock('banco'), versao: 0,
      avisos: [], recusas: {}, simulandoViolacao: false, falhaDeTransporte: false,
    });
  });

  it('tem nome acessível próprio, e responde a Enter e a Espaço', () => {
    render(<MemoryRouter><T1 /></MemoryRouter>);
    const bolha = document.querySelector('.bub') as HTMLElement;
    expect(bolha.getAttribute('aria-label')).toMatch(/Score \d+, esforço/);
    expect(bolha.getAttribute('tabindex')).toBe('0');

    fireEvent.keyDown(bolha, { key: ' ' });
    expect(screen.getByRole('link', { name: /Reclassificar na matriz/ })).toBeInTheDocument();
  });

  it('o nome acessível não depende do <title>, que fica como redundância', () => {
    render(<MemoryRouter><T1 /></MemoryRouter>);
    const bolha = document.querySelector('.bub') as HTMLElement;
    expect(bolha.querySelector('title')).not.toBeNull();
    expect(bolha.getAttribute('aria-label')).not.toBe(bolha.querySelector('title')?.textContent);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PR 7 — Máquinas de estado dos oito artefatos
// ═════════════════════════════════════════════════════════════════════════════

describe('PR 7 · a tabela é a única autoridade sobre sequência', () => {
  const ARTEFATOS: Artefato[] = [
    'parecer', 'ripd', 'lia', 'risco', 'solicitacao', 'achado', 'incidente', 'chave',
  ];

  it('cada artefato do MAPA tem máquina declarada, e nenhuma a mais', () => {
    expect(Object.keys(MAQUINAS).sort()).toEqual([...ARTEFATOS].sort());
  });

  /**
   * O teste que sustenta a regra "toda transição percorre a tabela": para cada
   * artefato, **todos** os pares de estados são exercitados, e só os da tabela
   * passam. Um caminho especial escrito à mão em qualquer lugar quebra aqui.
   */
  it('para cada artefato, só os pares da tabela são permitidos', () => {
    for (const artefato of ARTEFATOS) {
      const estados = estadosDe(artefato) as string[];
      let permitidos = 0;
      for (const de of estados) {
        for (const para of estados) {
          const esperado = (MAQUINAS[artefato] as Record<string, string[]>)[de].includes(para);
          expect(
            transicaoPermitida(artefato as never, de as never, para as never),
            `${artefato}: ${de} → ${para}`,
          ).toBe(esperado);
          if (esperado) permitidos += 1;
        }
      }
      // Nenhuma máquina é vazia nem totalmente conectada: as duas coisas
      // significariam que a tabela não está dizendo nada.
      expect(permitidos, `${artefato}: transições declaradas`).toBeGreaterThan(0);
      expect(permitidos, `${artefato}: não é grafo completo`).toBeLessThan(estados.length ** 2);
    }
  });

  it('nenhum artefato inventou estado além do MAPA', () => {
    const doMapa: Record<Artefato, string[]> = {
      parecer: ['rascunho', 'emitido', 'homologado', 'vigente', 'devolvido'],
      ripd: ['triagem', 'dispensado', 'elaboracao', 'parecer_juridico', 'deliberado', 'vigente', 'em_revisao'],
      lia: ['rascunho', 'balanceamento', 'assinada', 'vigente', 'vencida'],
      risco: ['identificado', 'avaliado', 'em_tratamento', 'mitigado', 'aceito'],
      solicitacao: ['recebida', 'em_analise', 'concluida', 'recusada_com_fundamento'],
      achado: ['aberto', 'causa_raiz', 'plano', 'executado', 'verificado', 'encerrado', 'reaberto'],
      incidente: ['aberto', 'contido', 'decidido', 'comunicado', 'nao_comunicado', 'encerrado'],
      chave: ['nova', 'recriptografando', 'canary', 'ativa', 'revogada'],
    };
    for (const artefato of ARTEFATOS) {
      expect((estadosDe(artefato) as string[]).sort(), artefato).toEqual([...doMapa[artefato]].sort());
    }
  });

  it('nenhum estado aponta para fora da própria máquina', () => {
    for (const artefato of ARTEFATOS) {
      const estados = new Set(estadosDe(artefato) as string[]);
      for (const [de, destinos] of Object.entries(MAQUINAS[artefato] as Record<string, string[]>)) {
        for (const para of destinos) {
          expect(estados.has(para), `${artefato}: ${de} → ${para} sai da máquina`).toBe(true);
        }
      }
    }
  });

  it('as oito transições ilegais nomeadas no MAPA são recusadas', () => {
    const ilegais: [Artefato, string, string][] = [
      ['ripd', 'triagem', 'vigente'],
      ['lia', 'vencida', 'vigente'],
      ['solicitacao', 'recebida', 'concluida'],
      ['achado', 'executado', 'encerrado'],
      ['incidente', 'aberto', 'comunicado'],
      ['incidente', 'contido', 'comunicado'],
      ['chave', 'recriptografando', 'ativa'],
      ['parecer', 'rascunho', 'vigente'],
    ];
    for (const [artefato, de, para] of ilegais) {
      expect(transicaoPermitida(artefato as never, de as never, para as never), `${artefato}: ${de} → ${para}`).toBe(false);
      // A recusa ensina: nenhuma delas devolve mensagem genérica vazia.
      expect(motivoDaRecusa(artefato as never, de as never, para as never).length).toBeGreaterThan(30);
    }
  });

  it('as transições que o MAPA permite explicitamente passam', () => {
    const legais: [Artefato, string, string][] = [
      ['lia', 'vencida', 'balanceamento'],
      ['ripd', 'triagem', 'dispensado'],
      ['ripd', 'vigente', 'em_revisao'],
      ['achado', 'verificado', 'reaberto'],
      ['parecer', 'devolvido', 'emitido'],
      ['risco', 'em_tratamento', 'aceito'],
    ];
    for (const [artefato, de, para] of legais) {
      expect(transicaoPermitida(artefato as never, de as never, para as never), `${artefato}: ${de} → ${para}`).toBe(true);
    }
  });

  it('estados.ts é puro: não importa nada e não lê papel, banco nem conteúdo', () => {
    const fonte = readFileSync('src/mock/estados.ts', 'utf8');

    // Pureza pela dependência, que é o teste mais forte: um arquivo que não
    // importa nada não tem como consultar permissão, banco ou artigo.
    expect(fonte.match(/^\s*import\s/m), 'estados.ts não deve importar nada').toBeNull();

    /**
     * E pelos identificadores. Comentários e mensagens podem citar "fundamento"
     * — a mensagem de recusa do incidente cita, e deve citar. O que não pode é
     * o arquivo **ler** o fundamento; por isso a varredura descarta comentários
     * e literais de texto antes de procurar.
     */
    const soCodigo = fonte
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/'[^']*'/g, "''")
      .replace(/`[^`]*`/g, '``');
    // Identificadores, com fronteira de palavra: `recusada_com_fundamento` é
    // **nome de estado** do MAPA e contém a substring — casar por `includes`
    // acusaria a própria tabela de ler o que ela só nomeia.
    for (const proibido of ['papel', 'fundamento', 'justificativa', 'artigo']) {
      const usa = new RegExp(`\\b${proibido}\\b`).test(soCodigo);
      expect(usa, `estados.ts lê "${proibido}" — isso é validação, não verificação`).toBe(false);
    }
    for (const proibido of ['pode(', 'auditAppend', 'BancoMock', 'Art.']) {
      expect(soCodigo.includes(proibido), `estados.ts referencia "${proibido}"`).toBe(false);
    }
  });
});

describe('PR 7 · a rota de transição — sequência, conteúdo, registro', () => {
  const mover = (artefato: string, id: string, body: Record<string, unknown>) =>
    chamar('dpo', { metodo: 'POST', caminho: `/v1/estados/${artefato}/${id}`, body });

  it('aceitação — fora da tabela é 409; dentro dela sem conteúdo é 422', () => {
    // Sequência: o RIPD está em `vigente` (semeado); pular para `deliberado` é
    // problema de ordem, não de conteúdo.
    const ripd = banco.cenario.ripds[0];
    ripd.status = 'triagem';
    const fora = mover('ripd', ripd.id, { para: 'vigente' });
    expect(fora.status).toBe(409);
    expect(ripd.status).toBe('triagem');

    // Conteúdo: `triagem → dispensado` é legal, mas exige justificativa.
    const semRazao = mover('ripd', ripd.id, { para: 'dispensado' });
    expect(semRazao.status).toBe(422);
    expect(ripd.status).toBe('triagem');
  });

  it('aceitação — ripd dispensado exige justificativa e gatilho de reabertura', () => {
    const ripd = banco.cenario.ripds[0];
    ripd.status = 'triagem';

    const soJustificativa = mover('ripd', ripd.id, {
      para: 'dispensado', justificativa: 'Tratamento não usa dado pessoal nesta versão.',
    });
    expect(soJustificativa.status).toBe(422);
    expect((soJustificativa.body as { erro: string }).erro).toContain('gatilho de reabertura');

    // PR 11 — o gatilho passou de prosa a código do catálogo. A frase abaixo
    // era aceita antes e não disparava nada: era validada e descartada.
    const emProsa = mover('ripd', ripd.id, {
      para: 'dispensado',
      justificativa: 'Tratamento não usa dado pessoal nesta versão.',
      gatilhos: [{ codigo: 'Qualquer coleta de identificador direto', condicao: 'reabre a triagem' }],
    });
    expect(emProsa.status).toBe(422);
    expect((emProsa.body as { erro: string }).erro).toContain('não é gatilho do catálogo');

    const completo = mover('ripd', ripd.id, {
      para: 'dispensado',
      justificativa: 'Tratamento não usa dado pessoal nesta versão.',
      gatilhos: [{ codigo: 'T1', condicao: 'Qualquer coleta de identificador direto no diff.' }],
    });
    expect(completo.status).toBe(200);
    expect(ripd.status).toBe('dispensado');
    // A dispensa fica no artefato: validada e descartada, não sustentaria nada.
    expect(ripd.dispensas).toHaveLength(1);
    expect(ripd.dispensas![0].gatilhos[0].codigo).toBe('T1');
  });

  it('aceitação — lia: vencida → vigente é 409; vencida → balanceamento passa', () => {
    const lia = banco.cenario.lias[0];
    lia.status = 'vencida';

    const recarimbo = mover('lia', lia.id, { para: 'vigente' });
    expect(recarimbo.status).toBe(409);
    expect(recarimbo.regra).toContain('rebalanceamento');
    expect(lia.status).toBe('vencida');

    expect(mover('lia', lia.id, { para: 'balanceamento' }).status).toBe(200);
    expect(lia.status).toBe('balanceamento');
  });

  it('aceitação — risco aceito exige dono e prazo de reavaliação', () => {
    const risco = banco.cenario.riscos[0];
    risco.status = 'em_tratamento';

    const semDono = mover('risco', risco.codigo, { para: 'aceito', prazoDeReavaliacao: '90 dias' });
    expect(semDono.status).toBe(422);
    expect((semDono.body as { erro: string }).erro).toContain('dono');
    expect(risco.status).toBe('em_tratamento');

    const semPrazo = mover('risco', risco.codigo, { para: 'aceito', donoDaAceitacao: '@dpo-marcela' });
    expect(semPrazo.status).toBe(422);
    expect((semPrazo.body as { erro: string }).erro).toContain('prazo');

    const completo = mover('risco', risco.codigo, {
      para: 'aceito', donoDaAceitacao: '@dpo-marcela',
      prazoDeReavaliacao: '90 dias', gatilhoDeReabertura: 'Incidente que toque o campo reabre o risco.',
    });
    expect(completo.status).toBe(200);
    expect(risco.status).toBe('aceito');
    expect(risco.donoDaAceitacao).toBe('@dpo-marcela');
  });

  it('aceitação — achado: executado → encerrado é 409; reaberto eleva a criticidade', () => {
    const achado = banco.cenario.achados[0];
    achado.status = 'executado';
    achado.executadoPor = '@eng-rafael';

    const pulando = mover('achado', achado.id, { para: 'encerrado' });
    expect(pulando.status).toBe(409);
    expect(pulando.regra).toContain('verificação independente');
    expect(achado.status).toBe('executado');

    // PR 15 — verificar passou a exigir independência aferida contra o
    // artefato, veredito e evidência. A contraprova de que a exigência é real
    // vem no bloco do PR 15; aqui basta o caminho completo.
    expect(mover('achado', achado.id, {
      para: 'verificado', verificadoPor: '@auditoria', eficaciaAtingida: true, evidencia: 'conferencia.csv',
    }).status).toBe(200);

    const criticidadeAntes = achado.criticidade;
    expect(criticidadeAntes).toBe('alta');
    expect(mover('achado', achado.id, {
      para: 'reaberto', motivo: 'A conferência cobriu um ambiente só e o outro segue sem o controle.',
    }).status).toBe(200);
    expect(achado.criticidade).toBe('critica');
    expect(achado.reincidencias).toBe(1);
  });

  it('solicitacao: recebida → concluida é 409 — conclusão sem análise não prova nada', () => {
    const s = banco.cenario.solicitacoes[0];
    s.status = 'recebida';
    const res = mover('solicitacao', s.id, { para: 'concluida' });
    expect(res.status).toBe(409);
    expect(res.regra).toContain('sem análise');
    expect(s.status).toBe('recebida');
  });

  it('transição legal sem auditAppend possível devolve 503, e o estado não muda', () => {
    const lia = banco.cenario.lias[0];
    lia.status = 'vencida';
    banco.simularFalhaDeLog = true;

    const res = mover('lia', lia.id, { para: 'balanceamento' });
    expect(res.status).toBe(503);
    expect(lia.status).toBe('vencida');
  });

  it('a transição registra antes de aplicar, com o par de estados no trail', () => {
    const lia = banco.cenario.lias[0];
    lia.status = 'vencida';
    const antes = banco.auditoria.length;

    expect(mover('lia', lia.id, { para: 'balanceamento' }).status).toBe(200);
    expect(banco.auditoria.length).toBe(antes + 1);
    const registro = banco.auditoria.at(-1)!;
    expect(registro.acao).toBe('ESTADO_TRANSICIONADO');
    expect(registro.campos).toContain('vencida→balanceamento');
  });

  it('estado que não existe na máquina é 422, com a lista do que existe', () => {
    const res = mover('lia', banco.cenario.lias[0].id, { para: 'aposentada' });
    expect(res.status).toBe(422);
    expect(res.regra).toContain('rascunho');
  });

  it('artefato desconhecido é 404 — a rota não inventa máquina', () => {
    expect(mover('contrato', 'x1', { para: 'vigente' }).status).toBe(404);
  });

  it('a rota é escrita: papel de leitura não move artefato nenhum', () => {
    const lia = banco.cenario.lias[0];
    lia.status = 'vencida';
    const res = chamar('auditor', {
      metodo: 'POST', caminho: `/v1/estados/lia/${lia.id}`, body: { para: 'balanceamento' },
    });
    expect(res.status).toBe(403);
    expect(lia.status).toBe('vencida');
  });

  it('a redação do C-04 vale também aqui: PII no motivo não entra no trail', () => {
    const ripd = banco.cenario.ripds[0];
    ripd.status = 'triagem';
    mover('ripd', ripd.id, {
      para: 'dispensado',
      justificativa: 'Confirmado com o titular 529.982.247-25 que não há tratamento.',
      gatilhos: [{ codigo: 'T1', condicao: 'Coleta de identificador direto no diff.' }],
    });
    expect(banco.auditoria.at(-1)!.justificativa).not.toContain('529.982.247-25');
    // E a justificativa gravada no artefato também sai redigida.
    expect(banco.cenario.ripds[0].dispensas![0].justificativa).not.toContain('529.982.247-25');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PR 8 · D1, D2 e D3 como dados versionados', () => {
  it('entrada indefinida cai no cenário mais restritivo, não em erro', () => {
    // Categoria ausente com todo o resto no valor mais brando possível: se a
    // omissão caísse no permissivo, isto sairia como baixa complexidade.
    const d = aplicar('d1', {
      volumeTitulares: 10, decisaoAutomatizada: false, transferenciaInternacional: false,
    });
    expect(d.saida.complexidade).toBe('alta');
    expect(d.assumidas).toContain('categoria');
    expect(d.entradas.categoria).toBe('sensivel');
    // E a frase diz que assumiu, em vez de decidir calada.
    expect(d.frase).toContain('categoria não informado, assumido sensivel');
  });

  it('o restritivo de toda versão produz a saída mais restritiva da tabela', () => {
    // Invariante: o dia em que alguém subir um limiar e esquecer do restritivo,
    // "entrada ausente cai no pior caso" vira mentira em silêncio.
    const pior: Record<string, Record<string, string | number | boolean>> = {
      d1: { complexidade: 'alta', alcada: 'dpo_e_comite' },
      d2: { nivel: 'critico' },
      d3: { ripd: 'obrigatorio', analiseAlgoritmica: true },
    };
    for (const id of TABELAS_IDS) {
      for (const v of TABELAS[id].versoes) {
        const d = aplicar(id, {}, v.versao);
        expect(d.assumidas.sort(), `${id}@${v.versao}`).toEqual(Object.keys(v.restritivo).sort());
        for (const [campo, valor] of Object.entries(pior[id])) {
          expect(d.saida[campo], `${id}@${v.versao}: ${campo}`).toBe(valor);
        }
      }
    }
  });

  it('toda condição tem termo e todo valor de saída tem rótulo', () => {
    // A frase é derivada da regra. Condição sem termo cairia na chave canônica
    // — legível, mas feia de propósito: quem vê `volumeTitulares>=100000` na
    // tela sabe que faltou traduzir.
    for (const id of TABELAS_IDS) {
      for (const v of TABELAS[id].versoes) {
        for (const chave of condicoesDe(v)) {
          expect(v.termos[chave], `${id}@${v.versao}: condição "${chave}" sem termo`).toBeTruthy();
        }
        for (const r of v.regras) {
          for (const [campo, valor] of Object.entries(r.entao)) {
            expect(v.saidas[`${campo}=${valor}`], `${id}@${v.versao}: saída "${campo}=${valor}" sem rótulo`)
              .toBeTruthy();
          }
        }
      }
    }
  });

  it('toda tabela fecha com uma regra que casa com tudo', () => {
    for (const id of TABELAS_IDS) {
      for (const v of TABELAS[id].versoes) {
        const ultima = v.regras[v.regras.length - 1];
        expect(Object.keys(ultima.quando), `${id}@${v.versao}`).toHaveLength(0);
      }
    }
  });

  it('a D2 cobre as 25 células sem cair na regra de fechamento', () => {
    const ultima = vigenteDe('d2').regras.length - 1;
    for (let p = 1; p <= 5; p += 1) {
      for (let i = 1; i <= 5; i += 1) {
        const d = aplicar('d2', { probabilidade: p, impacto: i, score: p * i });
        expect(d.regra, `P${p} × I${i} caiu no fechamento — buraco na tabela`).toBeLessThan(ultima);
        expect(d.assumidas).toHaveLength(0);
      }
    }
  });

  it('gatilho de decisão automatizada na D3 exige RIPD e análise algorítmica', () => {
    const d = aplicar('d3', { gatilhos: ['T3', 'T6'], gatilhosCriticos: 1, gatilhosTotal: 2 });
    expect(d.saida.ripd).toBe('obrigatorio');
    expect(d.saida.analiseAlgoritmica).toBe(true);
    expect(d.frase).toContain('decisão automatizada (T3)');
    expect(d.frase).toContain('análise algorítmica exigida');

    // Contraprova: sem gatilho nenhum a triagem responde, e responde dispensa.
    const vazio = aplicar('d3', { gatilhos: [], gatilhosCriticos: 0, gatilhosTotal: 0 });
    expect(vazio.saida.ripd).toBe('dispensavel_com_justificativa');
    expect(vazio.assumidas).toHaveLength(0);
    // Lista **ausente** é outra coisa: a triagem não rodou, e aí é o pior caso.
    expect(aplicar('d3', {}).saida.ripd).toBe('obrigatorio');
  });

  it('score 15 na D2 é a mesma faixa da célula correspondente da grade da T5', () => {
    limparBancosDaSessao();
    useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [] });
    render(<MemoryRouter><T5 /></MemoryRouter>);

    // P 3 × I 5 = 15. A célula e a tabela não podem discordar.
    const celula = screen.getByLabelText(/Probabilidade 3, impacto 5, score 15/);
    expect(nivelDoRisco(3, 5)).toBe('critico');
    expect(celula.className).toContain(tomDoRisco(3, 5));
    expect(celula.className).toContain('crit');

    // E a fronteira: 14 não é a mesma faixa que 15.
    expect(tomDoRisco(3, 5)).not.toBe(tomDoRisco(2, 5));
  });

  it('alterar a D2 muda a cor da matriz sem tocar em T5.tsx', () => {
    const regra = vigenteDe('d2').regras[0].quando.score as { min: number };
    const original = regra.min;
    try {
      // Baixar o corte de crítico para 8 deve repintar a célula P 2 × I 4.
      expect(tomDoRisco(2, 4)).toBe('warn');
      regra.min = 8;
      limparBancosDaSessao();
      useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [] });
      render(<MemoryRouter><T5 /></MemoryRouter>);
      expect(tomDoRisco(2, 4)).toBe('crit');
      expect(screen.getByLabelText(/Probabilidade 2, impacto 4, score 8/).className).toContain('crit');
    } finally {
      regra.min = original;
    }
    expect(tomDoRisco(2, 4)).toBe('warn');
  });

  it('decisão gravada em d1@1 mantém a saída de d1@1 depois de publicada a d1@2', () => {
    const ripd = banco.cenario.ripds[0];
    const gravada = ultimaDecisao(ripd.decisoes, 'd1')!;
    expect(gravada.versao).toBe(1);
    expect(vigenteDe('d1').versao).toBe(2);

    // Reprodução: mesma entrada, mesma versão, mesma saída — meses depois.
    const conferencia = reproduzir(gravada);
    expect(conferencia.confere).toBe(true);
    expect(conferencia.saida).toEqual(gravada.saida);

    // A versão nova responde outra coisa para as mesmas entradas, e é
    // exatamente por isso que ela não pode reescrever a decisão antiga.
    const hoje = aplicar('d1', gravada.entradas);
    expect(hoje.versao).toBe(2);
    expect(hoje.saida.alcada).toBe('dpo_e_comite');
    expect(gravada.saida.alcada).toBe('dpo');
  });

  it('toda decisão semeada em todo cenário reproduz', () => {
    for (const id of ['banco', 'varejo', 'midia']) {
      const b = new BancoMock(id);
      const registros = [
        ...b.cenario.ripds.flatMap((r) => r.decisoes ?? []),
        ...b.cenario.riscos.flatMap((r) => r.decisoes ?? []),
      ];
      expect(registros.length, `${id}: nenhuma decisão semeada`).toBeGreaterThan(0);
      for (const reg of registros) {
        expect(reproduzir(reg).confere, `${id}: ${reg.tabela}@${reg.versao}`).toBe(true);
      }
    }
  });

  it('registro que aponta para versão fora do catálogo não reproduz — e diz por quê', () => {
    const reg = { ...aplicar('d1', {}), versao: 99, quando: '2026-01-01T00:00:00Z' };
    const r = reproduzir(reg);
    expect(r.confere).toBe(false);
    // Aplicar outra versão em silêncio seria responder por uma regra que não
    // foi a usada: pior que não conferir.
    expect(r.motivo).toContain('d1@99');
    expect(r.saida).toBeUndefined();
  });

  it('todo gatilho de todo cenário está no catálogo, e nenhum rótulo é repetido no dado', () => {
    for (const id of ['banco', 'varejo', 'midia']) {
      const b = new BancoMock(id);
      for (const r of b.cenario.ripds) {
        for (const t of r.triggers) {
          expect(GATILHOS[t.codigo], `${id}: gatilho ${t.codigo} fora do catálogo`).toBeDefined();
          expect(t.evidencias.length).toBeGreaterThan(0);
          // O cenário diz qual acionou; o que ele significa mora no catálogo.
          expect(Object.keys(t).sort()).toEqual(['codigo', 'evidencias']);
        }
      }
      for (const c of b.cenario.campos) {
        expect(CATEGORIAS, `${id}: categoria ${c.categoria}`).toContain(c.categoria);
      }
    }
  });

  it('decisoes.ts é puro: não importa nada, não lê papel, banco nem relógio', () => {
    const fonte = readFileSync('src/mock/decisoes.ts', 'utf8');
    expect(fonte.match(/^\s*import\s/m), 'decisoes.ts não deve importar nada').toBeNull();

    const soCodigo = fonte
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/'[^']*'/g, "''")
      .replace(/`[^`]*`/g, '``');
    for (const proibido of ['papel', 'ator', 'justificativa']) {
      expect(new RegExp(`\\b${proibido}\\b`).test(soCodigo), `decisoes.ts lê "${proibido}"`).toBe(false);
    }
    // Sem relógio: a versão vigente é a maior publicada, não a que a data
    // escolher. Decisão que muda de resposta em agosto não é reproduzível.
    for (const proibido of ['Date', 'BancoMock', 'auditAppend', 'pode(']) {
      expect(soCodigo.includes(proibido), `decisoes.ts referencia "${proibido}"`).toBe(false);
    }
  });
});

describe('PR 8 · a rota que aplica a tabela', () => {
  const aplicarVia = (papel: Papel, tabela: string, body: Record<string, unknown>) =>
    chamar<DecisaoRegistrada>(papel, { metodo: 'POST', caminho: `/v1/dmn/${tabela}/aplicar`, body });

  it('grava a versão aplicada no trail antes de responder', () => {
    const ripd = banco.cenario.ripds[0];
    const antes = banco.auditoria.length;
    const res = aplicarVia('dpo', 'd1', { id: ripd.id });

    expect(res.status).toBe(200);
    expect(banco.auditoria).toHaveLength(antes + 1);
    const linha = banco.auditoria.at(-1)!;
    expect(linha.acao).toBe('DECISAO_APLICADA');
    // A versão entra no payload do hash: versão fora da cadeia é versão
    // adulterável sem quebrar a prova.
    expect(linha.campos).toContain(`d1@${res.body.versao}`);
    expect(banco.auditVerificar().integro).toBe(true);
  });

  it('reaplicar acrescenta decisão nova e não apaga a anterior', () => {
    const ripd = banco.cenario.ripds[0];
    const antiga = ultimaDecisao(ripd.decisoes, 'd1')!;
    aplicarVia('dpo', 'd1', { id: ripd.id });

    const daD1 = (ripd.decisoes ?? []).filter((d) => d.tabela === 'd1');
    expect(daD1).toHaveLength(2);
    expect(daD1[0]).toEqual(antiga);
    expect(daD1[0].versao).toBe(1);
    expect(daD1[1].versao).toBe(2);
    expect(ultimaDecisao(ripd.decisoes, 'd1')!.versao).toBe(2);
  });

  it('as entradas vêm do artefato: mandar entradas no corpo é 422', () => {
    const ripd = banco.cenario.ripds[0];
    const res = aplicarVia('dpo', 'd1', {
      id: ripd.id, entradas: { categoria: 'anonimizado', volumeTitulares: 1 },
    });
    expect(res.status).toBe(422);
    expect(res.regra).toContain('não é reproduzível');
    expect((ripd.decisoes ?? []).filter((d) => d.tabela === 'd1')).toHaveLength(1);
  });

  it('a D1 lê categoria, volume, decisão automatizada e remessa do próprio artefato', () => {
    const ripd = banco.cenario.ripds[0];
    const res = aplicarVia('dpo', 'd1', { id: ripd.id });
    // b-cpf/b-renda/b-score são pessoais e b-hist é pseudonimizado: a mais
    // restritiva é `pessoal`, e é ela que vale — não a média nem a primeira.
    expect(res.body.entradas.categoria).toBe('pessoal');
    expect(res.body.entradas.volumeTitulares).toBe(ripd.volumeTitulares);
    // T3 na triagem e OpenAI no compartilhamento de b-hist.
    expect(res.body.entradas.decisaoAutomatizada).toBe(true);
    expect(res.body.entradas.transferenciaInternacional).toBe(true);
    expect(res.body.assumidas).toHaveLength(0);
  });

  it('se o log falhar, a decisão não é gravada e a resposta é 503', () => {
    const risco = banco.cenario.riscos.find((r) => !r.decisoes)!;
    banco.simularFalhaDeLog = true;
    const res = aplicarVia('dpo', 'd2', { id: risco.codigo });
    expect(res.status).toBe(503);
    expect(risco.decisoes).toBeUndefined();
  });

  it('tabela desconhecida é 404 e artefato inexistente também', () => {
    expect(aplicarVia('dpo', 'd9', { id: 'r1' }).status).toBe(404);
    expect(aplicarVia('dpo', 'd1', { id: 'RIPD-INEXISTENTE' }).status).toBe(404);
  });

  it('aplicar é escrita; ler o catálogo alcança quem audita', () => {
    expect(aplicarVia('auditor', 'd1', { id: 'r1' }).status).toBe(403);
    const catalogo = chamar<{ tabelas: { id: string; vigente: number; versoes: unknown[] }[] }>(
      'auditor', { metodo: 'GET', caminho: '/v1/dmn' },
    );
    expect(catalogo.status).toBe(200);
    expect(catalogo.body.tabelas.map((t) => t.id)).toEqual(['d1', 'd2', 'd3']);
    // Todas as versões publicadas ficam visíveis: quem confere uma decisão de
    // março precisa ler a tabela de março, não só a de hoje.
    expect(catalogo.body.tabelas.find((t) => t.id === 'd1')!.versoes).toHaveLength(2);
    expect(catalogo.body.tabelas.find((t) => t.id === 'd1')!.vigente).toBe(2);
  });
});

describe('PR 8 · a tela explica a decisão em uma frase', () => {
  beforeEach(() => {
    limparBancosDaSessao();
    useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [] });
  });

  it('a T3 mostra o rito citando as entradas, a versão e o que a vigente diria', () => {
    montar(<T3 />);
    const rito = screen.getByRole('heading', { name: 'Rito aplicado' }).closest('.card') as HTMLElement;

    // A frase cita as entradas que a produziram, não só o resultado — e a
    // gravada é a da d1@1, que ainda não somava a remessa internacional.
    expect(within(rito).getByText('D1 · alta complexidade: decisão automatizada → aprovação do DPO'))
      .toBeInTheDocument();
    expect(within(rito).getByText(/D3 · RIPD obrigatório: decisão automatizada \(T3\)/)).toBeInTheDocument();
    expect(within(rito).getByText('d1@1')).toBeInTheDocument();
    expect(within(rito).getAllByText(/reproduz a mesma saída/).length).toBeGreaterThan(0);

    // Versão vigente diferente da gravada: a tela mostra a prévia como prévia,
    // com a frase que a d1@2 daria para as **mesmas** entradas.
    expect(within(rito).getByText(
      /decisão automatizada \+ transferência internacional → aprovação do DPO e do comitê/,
    )).toBeInTheDocument();
    expect(within(rito).getByText(/Isto é prévia, não decisão/)).toBeInTheDocument();
    expect(within(rito).getByRole('button', { name: /Reaplicar com d1@2/ })).toBeInTheDocument();
  });

  it('reaplicar pela T3 registra e a tela passa a exibir a versão vigente', () => {
    montar(<T3 />);
    fireEvent.click(screen.getByRole('button', { name: /Reaplicar com d1@2/ }));
    const rito = screen.getByRole('heading', { name: 'Rito aplicado' }).closest('.card') as HTMLElement;
    expect(within(rito).getByText('d1@2')).toBeInTheDocument();
    expect(within(rito).queryByRole('button', { name: /Reaplicar com d1@2/ })).not.toBeInTheDocument();
    expect(useSessao.getState().banco.auditoria.at(-1)!.acao).toBe('DECISAO_APLICADA');
  });

  it('papel sem escrita não recebe o botão de aplicar — ausência, não desabilitado', () => {
    useSessao.setState({ papel: 'auditor' });
    montar(<T3 />);
    const rito = screen.getByRole('heading', { name: 'Rito aplicado' }).closest('.card') as HTMLElement;
    expect(within(rito).queryByRole('button', { name: /Reaplicar/ })).not.toBeInTheDocument();
    // A decisão continua legível: o auditor perde o ato, não a prova.
    expect(within(rito).getByText('d1@1')).toBeInTheDocument();
  });

  it('a T5 avisa quando a decisão gravada é anterior à reclassificação', () => {
    montar(<T5 />);
    // R2 vem com D2 gravada; reclassificar muda o P × I por baixo dela.
    fireEvent.click(screen.getByRole('button', { name: /^R2:/ }));
    expect(screen.getByText(/risco (alto|crítico|moderado|baixo):/)).toBeInTheDocument();

    const b = useSessao.getState().banco;
    request(b, {
      papel: 'dpo', ator: 'teste', metodo: 'PATCH', caminho: '/v1/risks/R2',
      body: { probabilidade: 1, impacto: 1, justificativa: 'Controle compensatório entrou em produção e foi verificado.' },
    });
    act(() => { useSessao.setState((s) => ({ versao: s.versao + 1 })); });

    expect(screen.getByText(/o risco hoje está em P 1 × I 1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aplicar D2 com o P × I atual/ })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PR 9 · a fila derivada — a tabela e a derivação', () => {
  const HOJE = Date.UTC(2026, 6, 28, 12, 0, 0);

  it('nenhuma regra inventa estado, tela ou par duplicado', () => {
    const rotas = new Set(TELAS.map((t) => t.rota));
    const vistos = new Set<string>();
    for (const r of REGRAS) {
      // A tabela não pode declarar estado que a máquina do PR 7 desconhece: a
      // fila derivaria de um estado que nenhum artefato alcança.
      expect(estadosDe(r.artefato) as string[], `${r.artefato}: ${r.estado}`).toContain(r.estado);
      expect(rotas, `${r.artefato} ${r.estado} aponta para ${r.tela}`).toContain(r.tela);
      const chave = `${r.artefato}:${r.estado}:${r.quando}`;
      expect(vistos.has(chave), `regra duplicada: ${chave}`).toBe(false);
      vistos.add(chave);
    }
  });

  it('nenhum item sai com marcador de substituição por preencher', () => {
    // `{codigo}` que sobra é dado que a tabela pediu e o artefato não tem.
    // Sem esta varredura, o defeito chega à tela como texto com chave crua.
    for (const id of ['banco', 'varejo', 'midia']) {
      for (const item of derivarFila(new BancoMock(id).cenario, HOJE)) {
        for (const campo of [item.travado, item.proximaAcao, item.proximo, item.prazo.texto]) {
          expect(campo, `${id} · ${item.id}: "${campo}"`).not.toMatch(/\{\w+\}/);
        }
        expect(item.travado.length, `${id} · ${item.id}`).toBeGreaterThan(20);
      }
    }
  });

  it('todo item de artefato aponta para um estado que a faixa de passos contém', () => {
    for (const item of derivarFila(new BancoMock('banco').cenario, HOJE)) {
      if (item.artefato === 'obrigacao') {
        // Obrigação não tem máquina de estados, e a faixa fica vazia em vez de
        // ganhar uma barra falsa só para o cartão ficar simétrico.
        expect(item.estados, item.id).toEqual([]);
        expect(item.estadoAtual).toBe(-1);
        continue;
      }
      expect(item.estadoAtual, `${item.id}`).toBeGreaterThanOrEqual(0);
      expect(item.estados.length).toBeGreaterThan(item.estadoAtual);
    }
  });

  it('nenhum dado pessoal na fila, em nenhum papel, em nenhum cenário', () => {
    // A regra é "código de artefato, nunca titular". O protocolo é o código da
    // solicitação; o pseudônimo, o id e o hash do titular não podem aparecer em
    // campo nenhum do item — nem no travado, nem no rito.
    for (const id of ['banco', 'varejo', 'midia']) {
      const b = new BancoMock(id);
      const proibidos = b.cenario.titulares.flatMap((t) => [t.id, t.cpfHash]);
      proibidos.push(...b.cenario.solicitacoes.map((s) => s.titularPseudonimo));
      // Só os campos que chegam a gente. `tela` e `estados` são vocabulário do
      // sistema — e `/t3` casaria com o id de titular `t3` por substring, que
      // seria falso positivo, não vazamento.
      const texto = derivarFila(b.cenario, HOJE)
        .map((i) => [i.id, i.tipo, i.travado, i.proximaAcao, i.proximo, i.prazo.texto, i.rito.texto].join(' | '))
        .join('\n');
      for (const p of proibidos) {
        expect(new RegExp(`\\b${p}\\b`).test(texto), `${id}: "${p}" vazou para a fila`).toBe(false);
      }
    }
  });

  it('trabalho em curso não vira item: risco em tratamento fica de fora', () => {
    const b = new BancoMock('banco');
    const emTratamento = b.cenario.riscos.filter((r) => r.status === 'em_tratamento');
    expect(emTratamento.length).toBeGreaterThan(0);
    const itens = derivarFila(b.cenario, HOJE);
    for (const r of emTratamento) {
      expect(itens.some((i) => i.id === r.codigo), `${r.codigo} não deveria estar na fila`).toBe(false);
    }
    // Contraprova: o identificado, que está parado, entra.
    const parado = b.cenario.riscos.find((r) => r.status === 'identificado')!;
    expect(itens.some((i) => i.id === parado.codigo)).toBe(true);
  });

  it('a solicitação vencida vem antes da chave que vence em 8 dias', () => {
    const b = new BancoMock('banco');
    const s = b.cenario.solicitacoes.find((x) => x.status === 'em_analise')!;
    s.prazoLimiteMs = HOJE - 2 * 86_400_000;
    const chave = b.cenario.chaves.find((k) => k.status === 'ativa')!;
    chave.rotacaoEmDias = 8;

    const fila = derivarFila(b.cenario, HOJE);
    const posVencida = fila.findIndex((i) => i.id === s.protocolo);
    const posChave = fila.findIndex((i) => i.id === chave.alias);
    expect(posVencida).toBeGreaterThanOrEqual(0);
    expect(posChave).toBeGreaterThan(posVencida);
    expect(fila[posVencida].prazo.urgencia).toBe('vencido');
    expect(fila[posChave].prazo.urgencia).toBe('30d');
    // E a vencida é a primeira da fila inteira: nada precede prazo estourado.
    expect(fila[0].id).toBe(s.protocolo);
  });

  it('dentro da faixa, o que não tem relógio vem antes do que tem', () => {
    const fila = derivarFila(new BancoMock('banco').cenario, HOJE);
    const trinta = fila.filter((i) => i.prazo.urgencia === '30d');
    const primeiroComRelogio = trinta.findIndex((i) => i.prazo.restanteMs !== null);
    expect(primeiroComRelogio).toBeGreaterThan(0);
    // Depois do primeiro com relógio, ninguém sem relógio aparece.
    expect(trinta.slice(primeiroComRelogio).every((i) => i.prazo.restanteMs !== null)).toBe(true);
    // E entre os que têm relógio, o de menos tempo vem primeiro.
    const comRelogio = trinta.slice(primeiroComRelogio).map((i) => i.prazo.restanteMs!);
    expect([...comRelogio].sort((a, b) => a - b)).toEqual(comRelogio);
  });

  it('prazo legal correndo vem antes de vencimento de artefato mais próximo', () => {
    const b = new BancoMock('banco');
    // Uma solicitação com três dias de folga e uma chave que vence amanhã: a
    // faixa é da natureza do prazo, não da distância dele.
    const chave = b.cenario.chaves.find((k) => k.status === 'ativa')!;
    chave.rotacaoEmDias = 1;
    const fila = derivarFila(b.cenario, HOJE);
    const solicitacao = fila.find((i) => i.artefato === 'solicitacao')!;
    const daChave = fila.find((i) => i.id === chave.alias)!;
    expect(fila.indexOf(solicitacao)).toBeLessThan(fila.indexOf(daChave));
    expect(solicitacao.prazo.urgencia).toBe('agora');
  });

  it('o rito cita a regra que produziu o item, com a versão quando existe', () => {
    const fila = derivarFila(new BancoMock('banco').cenario, HOJE);
    const doRipd = fila.find((i) => i.artefato === 'ripd')!;
    expect(doRipd.rito.fonte).toBe('d1@1');
    expect(doRipd.rito.texto).toContain('complexidade');

    const doRisco = fila.find((i) => i.artefato === 'risco')!;
    expect(doRisco.rito.fonte).toBe('d2@1');

    // Sem tabela de decisão aplicável, a fonte é a máquina de estados — que é,
    // literalmente, a regra que colocou o item aqui.
    const daChave = fila.find((i) => i.artefato === 'chave')!;
    expect(daChave.rito.fonte).toContain('estados.ts');
  });

  it('produto e auditor não alcançam ação nenhuma da tabela', () => {
    // Não é acidente da massa de dados: nenhuma das ações declaradas na tabela
    // pertence a esses dois papéis, e por isso a fila deles é sempre vazia.
    const acoes = [...new Set(REGRAS.map((r) => r.acao))];
    for (const papel of ['produto', 'auditor'] as Papel[]) {
      expect(acoes.filter((a) => pode(papel, a)), papel).toEqual([]);
    }
    for (const papel of ['engenharia', 'dpo', 'seguranca'] as Papel[]) {
      expect(acoes.filter((a) => pode(papel, a)).length, papel).toBeGreaterThan(0);
    }
  });
});

describe('PR 9 · a rota da fila', () => {
  it('devolve só o que o papel alcança, e o resto como contagem', () => {
    const todos = derivarFila(banco.cenario, Date.now());
    for (const papel of ['engenharia', 'dpo', 'produto', 'seguranca', 'auditor'] as Papel[]) {
      const res = chamar<{ itens: ItemDaFila[]; contadores: ContadoresDaFila }>(
        papel, { metodo: 'GET', caminho: '/v1/fila' },
      );
      expect(res.status, papel).toBe(200);
      const meus = res.body.itens;
      expect(meus.every((i) => eDe(i.titularidade, papel)), papel).toBe(true);
      expect(res.body.contadores.deOutrosPapeis, papel).toBe(todos.length - meus.length);
      // Contagem, nunca lista: o corpo não traz nada dos itens alheios.
      expect(Object.keys(res.body)).toEqual(['itens', 'contadores']);
    }
  });

  it('a fila do produto é vazia e o contador mostra que o trabalho existe', () => {
    const res = chamar<{ itens: ItemDaFila[]; contadores: ContadoresDaFila }>(
      'produto', { metodo: 'GET', caminho: '/v1/fila' },
    );
    expect(res.body.itens).toEqual([]);
    expect(res.body.contadores.deOutrosPapeis).toBeGreaterThan(0);
  });

  it('segmento a mais é rota inexistente, não recorte silencioso', () => {
    expect(chamar('dpo', { metodo: 'GET', caminho: '/v1/fila/engenharia' }).status).toBe(404);
  });

  it('ler a fila não grava no trail — nenhum dado pessoal sai daqui', () => {
    const antes = banco.auditoria.length;
    chamar('dpo', { metodo: 'GET', caminho: '/v1/fila' });
    expect(banco.auditoria).toHaveLength(antes);
  });

  it('cenário desconhecido falha em vez de cair no padrão', () => {
    // O fallback silencioso fazia um teste do PR 8 pedir 'streaming' e receber
    // o banco: passava por três cenários exercitando um só.
    expect(() => new BancoMock('streaming')).toThrow(/Cenário desconhecido/);
    expect(new BancoMock('midia').cenario.id).toBe('midia');
  });
});

describe('PR 9 · T0 na tela', () => {
  const montarT0 = (papel: Papel, cenario = 'banco') => {
    limparBancosDaSessao();
    useSessao.setState({ papel, banco: new BancoMock(cenario), versao: 0, avisos: [] });
    return render(<MemoryRouter><T0 /></MemoryRouter>);
  };

  it('mostra exatamente as quatro informações por item, e a faixa de estados', () => {
    montarT0('dpo');
    const itens = screen.getAllByRole('article');
    expect(itens.length).toBeGreaterThan(0);

    const primeiro = itens[0];
    // As quatro: prazo (na etiqueta de urgência), o que está travado, sua
    // próxima ação e quem vem depois.
    expect(within(primeiro).getByText('O que está travado')).toBeInTheDocument();
    expect(within(primeiro).getByText('Sua próxima ação')).toBeInTheDocument();
    expect(within(primeiro).getByText(/Para hoje ·|Prazo vencido ·|Próximos 30 dias ·/)).toBeInTheDocument();
    expect(within(primeiro).getByText(/depois de você|a conclusão para o cronômetro/)).toBeInTheDocument();
    // Nenhum terceiro rótulo de coluna: mais que quatro vira relatório.
    expect(within(primeiro).getAllByText(/^O que está travado$|^Sua próxima ação$/)).toHaveLength(2);

    // A faixa vem da máquina de estados, com o atual marcado.
    const faixa = within(primeiro).getByRole('list');
    expect(within(faixa).getAllByRole('listitem').length).toBeGreaterThan(2);
    expect(faixa.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('a ordem da tela é a ordem da consequência', () => {
    montarT0('dpo', 'midia');
    const etiquetas = screen.getAllByRole('article')
      .map((a) => within(a).getByText(/Prazo vencido ·|Para hoje ·|Próximos 30 dias ·/).textContent!);
    const faixa = (t: string) => (t.startsWith('Prazo vencido') ? 0 : t.startsWith('Para hoje') ? 1 : 2);
    const ordem = etiquetas.map(faixa);
    expect([...ordem].sort()).toEqual(ordem);
    expect(ordem[0], 'o cenário midia abre com a LIA vencida').toBe(0);
  });

  it('papel produto: fila vazia, sem protocolo e sem titular na tela', () => {
    const { container } = montarT0('produto');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText(/Nada pendente para o seu papel/)).toBeInTheDocument();

    const b = useSessao.getState().banco;
    const texto = container.textContent ?? '';
    for (const s of b.cenario.solicitacoes) {
      expect(texto.includes(s.protocolo), `protocolo ${s.protocolo} na tela do produto`).toBe(false);
      expect(texto.includes(s.titularPseudonimo)).toBe(false);
    }
    for (const t of b.cenario.titulares) expect(texto.includes(t.id)).toBe(false);
  });

  it('fila vazia é estado vazio: nem esqueleto, nem falha', () => {
    const { container } = montarT0('auditor');
    expect(container.querySelector('.esqueleto')).toBeNull();
    expect(container.querySelector('.falha')).toBeNull();
    expect(container.querySelector('.vazio')).not.toBeNull();
    // O contador continua dizendo que o trabalho existe.
    expect(screen.getByText('De outros papéis').parentElement!.textContent).toMatch(/\d/);
  });

  it('o item muda de dono com a pendência, e some quando a ação é concluída', () => {
    // PR 10 — `em_revisao` com P0 aberta é de engenharia; sem P0, é do DPO. É o
    // mesmo estado, e quem separa os dois é a condição declarada na regra.
    montarT0('engenharia');
    const b = useSessao.getState().banco;
    const ripd = b.cenario.ripds[0];
    expect(screen.getByText(ripd.codigo)).toBeInTheDocument();
    expect(screen.getByText(/Fechar as recomendações P0/)).toBeInTheDocument();

    cleanup();
    montarT0('dpo');
    useSessao.setState({ banco: b });
    act(() => { useSessao.setState((s) => ({ versao: s.versao + 1 })); });
    expect(screen.queryByText(ripd.codigo)).not.toBeInTheDocument();

    // Engenharia fecha a P0: o item atravessa para a fila do DPO.
    ripd.recomendacoes.forEach((r) => { r.concluida = true; });
    act(() => { useSessao.setState((s) => ({ versao: s.versao + 1 })); });
    expect(screen.getByText(ripd.codigo)).toBeInTheDocument();
    expect(screen.getByText('Aprovar o RIPD')).toBeInTheDocument();

    // E some de vez quando o DPO aprova, sem recarregar.
    const res = request(b, { papel: 'dpo', ator: 'teste', metodo: 'POST', caminho: `/v1/ripds/${ripd.id}/aprovar` });
    expect(res.status).toBe(200);
    expect(ripd.status).toBe('vigente');
    act(() => { useSessao.setState((s) => ({ versao: s.versao + 1 })); });
    expect(screen.queryByText(ripd.codigo)).not.toBeInTheDocument();
  });

  it('T0 é a entrada do trilho e abre na raiz', () => {
    limparBancosDaSessao();
    useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [] });
    render(<MemoryRouter initialEntries={['/']}><Casca /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Minha fila' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /T0 Minha fila/ })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PR 10 · o calendário como dado, e a promoção à fila', () => {
  const HOJE = Date.UTC(2026, 6, 28, 12, 0, 0);
  const emDias = (n: number) => new Date(HOJE + n * 86_400_000).toISOString().slice(0, 10);

  const obrigacao = (over: Partial<Obrigacao> = {}): Obrigacao => ({
    codigo: 'OBR-TESTE-01', titulo: 'Revalidar consentimento v3', curto: 'Consentimento',
    trilha: 'legal', tipo: 'prazo', vence: emDias(60), antecedenciaDias: 30,
    preparar: 'Campanha de revalidação aberta 30 dias antes',
    seFalhar: 'o campo perde base legal e o gate bloqueia dois repositórios',
    cargaDias: 6, responsavel: 'dpo', tela: '/t2', ...over,
  });

  it('obrigação fora da antecedência não está na fila; dentro, está', () => {
    const b = new BancoMock('banco');
    // 60 dias com antecedência de 30: existe no ano, não ocupa ninguém.
    b.cenario.obrigacoes = [obrigacao()];
    expect(derivarFila(b.cenario, HOJE).some((i) => i.artefato === 'obrigacao')).toBe(false);

    // 20 dias: entrou. Faixa "30d", com a consequência declarada no travado.
    b.cenario.obrigacoes = [obrigacao({ vence: emDias(20) })];
    const item = derivarFila(b.cenario, HOJE).find((i) => i.artefato === 'obrigacao')!;
    expect(item).toBeDefined();
    expect(item.prazo.urgencia).toBe('30d');
    expect(item.prazo.texto).toBe('em 20 dia(s)');
    expect(item.travado).toContain('Se passar: o campo perde base legal e o gate bloqueia');
    expect(item.proximaAcao).toBe('Campanha de revalidação aberta 30 dias antes');
    expect(item.rito.texto).toContain('antecedência de 30 dias');
    expect(item.rito.fonte).toBe('calendario.ts · legal');
  });

  it('a fronteira da antecedência é exata, e vencida não sai da fila', () => {
    const b = new BancoMock('banco');
    const daFila = (o: Obrigacao) => derivarFila({ ...b.cenario, obrigacoes: [o] }, HOJE)
      .filter((i) => i.artefato === 'obrigacao');

    expect(daFila(obrigacao({ vence: emDias(31) })), 'um dia fora').toHaveLength(0);
    expect(daFila(obrigacao({ vence: emDias(30) })), 'no limite').toHaveLength(1);
    // Prazo estourado não sai da fila por ter estourado — vira "vencido".
    const vencida = daFila(obrigacao({ vence: emDias(-3) }))[0];
    expect(vencida.prazo.urgencia).toBe('vencido');
    expect(vencida.prazo.texto).toBe('vencido há 3 dia(s)');
    // Cumprida sai, mesmo dentro da janela.
    expect(daFila(obrigacao({ vence: emDias(10), cumpridaEm: emDias(-1) }))).toHaveLength(0);
  });

  it('a obrigação só entra na fila de quem responde por ela', () => {
    const b = new BancoMock('banco');
    b.cenario.obrigacoes = [obrigacao({ vence: emDias(10), responsavel: 'seguranca' })];
    const todos = derivarFila(b.cenario, HOJE);
    const alcanca = (['engenharia', 'dpo', 'produto', 'seguranca', 'auditor'] as Papel[])
      .filter((p) => minhaFila(todos, p).some((i) => i.artefato === 'obrigacao'));
    // Declarado, não derivado: só quem foi nomeado, e mais ninguém.
    expect(alcanca).toEqual(['seguranca']);
  });

  it('a carga do mês é somada das obrigações, não digitada', () => {
    const b = new BancoMock('banco');
    const carga = cargaDoAno(b.cenario.obrigacoes);
    expect(carga).toHaveLength(12);
    for (const c of carga) {
      const somaDoMes = b.cenario.obrigacoes
        .filter((o) => mesDe(o) === c.mes).reduce((s, o) => s + o.cargaDias, 0);
      expect(c.provisionado, `mês ${c.mes}`).toBe(somaDoMes);
      expect(c.reservado).toBe(Math.round(CAPACIDADE_DIAS_MES * RESERVA_DEMANDA));
      expect(c.percentual).toBe(
        Math.min(100, Math.round(((somaDoMes + c.reservado) / CAPACIDADE_DIAS_MES) * 100)),
      );
    }
    // Mexer numa obrigação muda a barra do mês dela, e só dela.
    const antes = cargaDoAno(b.cenario.obrigacoes).map((c) => c.percentual);
    const alvo = b.cenario.obrigacoes[0];
    alvo.cargaDias += 30;
    const depois = cargaDoAno(b.cenario.obrigacoes).map((c) => c.percentual);
    const mudaram = depois.map((p, i) => (p === antes[i] ? null : i)).filter((i) => i !== null);
    expect(mudaram).toEqual([mesDe(alvo)]);
  });

  it('o mês sem obrigação nenhuma ainda carrega a reserva de demanda', () => {
    const vazio = cargaDoAno([])[0];
    expect(vazio.provisionado).toBe(0);
    expect(vazio.percentual).toBe(Math.round(RESERVA_DEMANDA * 100));
  });

  it('toda obrigação semeada declara consequência, antecedência e ação', () => {
    for (const id of ['banco', 'varejo', 'midia']) {
      const b = new BancoMock(id);
      expect(b.cenario.obrigacoes.length, id).toBe(22);
      const codigos = new Set<string>();
      for (const o of b.cenario.obrigacoes) {
        expect(o.seFalhar.length, `${o.codigo}: consequência`).toBeGreaterThan(20);
        expect(o.preparar.length, `${o.codigo}: preparar`).toBeGreaterThan(10);
        expect(o.antecedenciaDias, `${o.codigo}`).toBeGreaterThan(0);
        expect(o.responsavel, `${o.codigo}: sem responsável declarado`).toBeTruthy();
        expect(o.cargaDias, `${o.codigo}`).toBeGreaterThan(0);
        expect(o.vence, `${o.codigo}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(codigos.has(o.codigo), `código repetido: ${o.codigo}`).toBe(false);
        codigos.add(o.codigo);
      }
    }
  });
});

describe('PR 10 · o feed ICS', () => {
  const feed = (papel: Papel, token?: string) => {
    const t = token ?? assinaturaDoFeed(papel, sha256);
    return chamar<string>(papel, { metodo: 'GET', caminho: `/v1/calendario.ics?papel=${papel}&token=${t}` });
  };

  it('responde só as obrigações do papel pedido', () => {
    for (const papel of ['engenharia', 'dpo', 'seguranca'] as Papel[]) {
      const res = feed(papel);
      expect(res.status, papel).toBe(200);
      const uids = [...res.body.matchAll(/UID:(OBR-[^@]+)@lastro/g)].map((m) => m[1]);
      const esperados = banco.cenario.obrigacoes.filter((o) => o.responsavel === papel).map((o) => o.codigo);
      expect(uids.sort(), papel).toEqual(esperados.sort());
      expect(uids.length, `${papel}: feed vazio não prova nada`).toBeGreaterThan(0);
    }
    // Produto e auditor não respondem por obrigação nenhuma: feed sem eventos,
    // e não feed com as dos outros.
    for (const papel of ['produto', 'auditor'] as Papel[]) {
      expect(feed(papel).body).not.toContain('BEGIN:VEVENT');
    }
  });

  it('a assinatura é a credencial: a de outro papel não abre o feed', () => {
    expect(feed('dpo', assinaturaDoFeed('engenharia', sha256)).status).toBe(403);
    expect(feed('dpo', 'token-inventado').status).toBe(403);
    expect(chamar('dpo', { metodo: 'GET', caminho: '/v1/calendario.ics?papel=ninguem&token=x' }).status).toBe(403);
    // E a rota devolve a assinatura do papel da sessão, nunca a de outro.
    const minha = chamar<{ papel: string; caminho: string }>('dpo', { metodo: 'GET', caminho: '/v1/calendario/assinatura' });
    expect(minha.body.papel).toBe('dpo');
    expect(minha.body.caminho).toContain(assinaturaDoFeed('dpo', sha256));
  });

  it('nenhum dado pessoal no ICS de nenhum dos cinco papéis', () => {
    // Mesma varredura do PR 9, agora sobre o texto do feed.
    const proibidos = [
      ...banco.cenario.titulares.flatMap((t) => [t.id, t.cpfHash]),
      ...banco.cenario.solicitacoes.flatMap((s) => [s.protocolo, s.titularPseudonimo]),
      ...banco.cenario.incidentes.map((i) => i.id),
    ];
    for (const papel of ['engenharia', 'dpo', 'produto', 'seguranca', 'auditor'] as Papel[]) {
      const linhas = feed(papel).body.replace(/\r\n /g, '').split('\r\n');

      // O que vai para o cliente de calendário como texto: é aqui que um vazamento
      // apareceria. A `URL:` sai da varredura por substring e entra numa asserção
      // de forma — mais forte, porque `/t1` casaria com o id de titular `t1` por
      // acidente e esconderia o que a checagem devia provar.
      const texto = linhas.filter((l) => /^(SUMMARY|DESCRIPTION|CATEGORIES|UID|X-WR-)/.test(l)).join('\n');
      for (const p of proibidos) {
        expect(new RegExp(`\\b${p}\\b`).test(texto), `${papel}: "${p}" vazou para o ICS`).toBe(false);
      }
      for (const url of linhas.filter((l) => l.startsWith('URL:'))) {
        expect(url, `${papel}: URL com carga inesperada`)
          .toMatch(/^URL:https:\/\/lastro\.exemplo\/#\/t\d+\?obrigacao=OBR-[\w-]+$/);
      }

      // Nada por demanda sai: incidente, direito do titular e achado ficam dentro.
      expect(texto).not.toContain('ATTENDEE');
      expect(texto).not.toMatch(/ACH-|INC-/);
    }
  });

  it('o ICS é bem formado: escapado, dobrado e declarado somente leitura', () => {
    const texto = feed('dpo').body;
    expect(texto.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(texto.endsWith('END:VCALENDAR')).toBe(true);
    expect((texto.match(/BEGIN:VEVENT/g) ?? []).length).toBe((texto.match(/END:VEVENT/g) ?? []).length);
    // RFC 5545 §3.1: nenhuma linha passa de 75 octetos.
    for (const linha of texto.split('\r\n')) {
      expect(linha.length, `linha longa: ${linha.slice(0, 40)}…`).toBeLessThanOrEqual(75);
    }
    // §3.3.11: vírgula em TEXT vai escapada, senão o cliente lê dois valores.
    const comVirgula = banco.cenario.obrigacoes.find((o) => o.seFalhar.includes(','));
    if (comVirgula) expect(texto).toContain('\\,');
    // O feed diz de si mesmo que é somente leitura: quem consome precisa saber
    // antes de tentar mover a data no cliente. Desdobrado, porque a linha é
    // longa e a RFC manda dobrar.
    expect(texto.replace(/\r\n /g, '')).toContain('mover a data no cliente nao altera o prazo');
  });

  it('não existe rota de escrita no calendário vinda de fora', () => {
    // Direção única: o ICS entra na agenda de quem assina, e nada volta. Não há
    // rota que aceite escrita vinda do calendário externo — a única porta é a
    // prorrogação, que exige justificativa e sessão.
    expect(chamar('dpo', { metodo: 'POST', caminho: '/v1/calendario.ics' }).status).toBe(404);
    expect(chamar('dpo', { metodo: 'PATCH', caminho: '/v1/calendario' }).status).toBe(404);
    expect(chamar('dpo', { metodo: 'POST', caminho: '/v1/calendario' }).status).toBe(404);
  });
});

describe('PR 10 · prorrogar é ato registrado', () => {
  const alvo = () => banco.cenario.obrigacoes.find((o) => !o.cumpridaEm && o.responsavel === 'dpo')!;
  const prorrogar = (papel: Papel, body: Record<string, unknown>, codigo?: string) =>
    chamar<{ de: string; para: string }>(papel, {
      metodo: 'POST', caminho: `/v1/calendario/${codigo ?? alvo().codigo}/prorrogar`, body,
    });

  it('sem justificativa é 422, e a data não muda', () => {
    const o = alvo();
    const antes = o.vence;
    const res = prorrogar('dpo', { para: '2027-01-15', justificativa: 'urgente' });
    expect(res.status).toBe(422);
    expect(o.vence).toBe(antes);
    expect(o.prorrogacoes).toBeUndefined();
  });

  it('com justificativa grava no trail antes de a data nova valer', () => {
    const o = alvo();
    const de = o.vence;
    const nTrail = banco.auditoria.length;
    const res = prorrogar('dpo', {
      para: '2027-01-15',
      justificativa: 'Comitê remarcado por indisponibilidade do jurídico; a consequência foi absorvida no ciclo seguinte.',
    });

    expect(res.status).toBe(200);
    expect(banco.auditoria).toHaveLength(nTrail + 1);
    const linha = banco.auditoria.at(-1)!;
    expect(linha.acao).toBe('OBRIGACAO_PRORROGADA');
    // A data antiga e a nova entram no payload do hash, com a justificativa.
    expect(linha.campos).toEqual([de, '2027-01-15']);
    expect(linha.justificativa).toContain('Comitê remarcado');
    expect(banco.auditVerificar().integro).toBe(true);

    expect(o.vence).toBe('2027-01-15');
    expect(o.prorrogacoes).toHaveLength(1);
    expect(o.prorrogacoes![0].de).toBe(de);
  });

  it('se o log falhar, a data antiga continua valendo', () => {
    const o = alvo();
    const de = o.vence;
    banco.simularFalhaDeLog = true;
    const res = prorrogar('dpo', { para: '2027-02-01', justificativa: 'Justificativa suficientemente longa para passar.' });
    expect(res.status).toBe(503);
    expect(o.vence).toBe(de);
    expect(o.prorrogacoes).toBeUndefined();
  });

  it('prorrogar move para frente, e é de quem responde pela obrigação', () => {
    const o = alvo();
    const justificativa = 'Justificativa suficientemente longa para ser aceita pela rota.';
    expect(prorrogar('dpo', { para: o.vence, justificativa }).status).toBe(422);
    expect(prorrogar('dpo', { para: '2020-01-01', justificativa }).status).toBe(422);
    expect(prorrogar('dpo', { para: '15/01/2027', justificativa }).status).toBe(422);
    // Titularidade declarada: engenharia escreve, mas não responde por esta.
    expect(prorrogar('engenharia', { para: '2027-01-15', justificativa }).status).toBe(403);
    expect(prorrogar('dpo', { para: '2027-01-15', justificativa }, 'OBR-INEXISTENTE').status).toBe(404);
  });

  it('prorrogar tira o item da fila quando a data sai da antecedência', () => {
    const b = new BancoMock('banco');
    // A obrigação precisa ser do papel que prorroga: titularidade é declarada.
    const o = b.cenario.obrigacoes.find((x) => !x.cumpridaEm && x.responsavel === 'dpo')!;
    const agora = Date.now();
    o.vence = new Date(agora + 5 * 86_400_000).toISOString().slice(0, 10);
    o.antecedenciaDias = 30;
    expect(derivarFila(b.cenario, agora).some((i) => i.id === o.codigo)).toBe(true);

    // Derivação, não cópia: mover a data faz o item sair sozinho.
    const res = request(b, {
      papel: 'dpo', ator: 'teste', metodo: 'POST', caminho: `/v1/calendario/${o.codigo}/prorrogar`,
      body: {
        para: new Date(agora + 200 * 86_400_000).toISOString().slice(0, 10),
        justificativa: 'Realocada para o ciclo seguinte com aval do comitê e capacidade reservada.',
      },
    });
    expect(res.status).toBe(200);
    expect(derivarFila(b.cenario, agora).some((i) => i.id === o.codigo)).toBe(false);
  });
});

describe('PR 10 · as duas decisões do PR 9', () => {
  it('a condição declarada separa engenharia do DPO no mesmo estado', () => {
    const b = new BancoMock('banco');
    const ripd = b.cenario.ripds[0];
    expect(ripd.status).toBe('em_revisao');
    expect(ripd.recomendacoes.some((r) => r.prioridade === 'P0' && !r.concluida)).toBe(true);

    const comP0 = derivarFila(b.cenario, Date.now()).find((i) => i.id === ripd.codigo)!;
    expect(comP0.titularidade).toEqual({ tipo: 'derivada', acao: 'gerar_ripd' });
    expect(eDe(comP0.titularidade, 'engenharia')).toBe(true);
    expect(eDe(comP0.titularidade, 'dpo')).toBe(false);

    ripd.recomendacoes.forEach((r) => { r.concluida = true; });
    const semP0 = derivarFila(b.cenario, Date.now()).find((i) => i.id === ripd.codigo)!;
    expect(semP0.titularidade).toEqual({ tipo: 'derivada', acao: 'aprovar_ripd' });
    expect(semP0.proximaAcao).toBe('Aprovar o RIPD');
    // O mesmo estado: quem mudou foi a condição, não a máquina.
    expect(ripd.status).toBe('em_revisao');
  });

  it('condição indefinida não libera regra nenhuma', () => {
    // Só o RIPD define pendência. Uma regra `com_pendencia` sobre artefato que
    // não a define nunca casaria — e é isso que impede a condição de virar um
    // "talvez" que libera por omissão.
    for (const r of REGRAS.filter((x) => x.quando === 'com_pendencia' || x.quando === 'sem_pendencia')) {
      expect(r.artefato, `${r.artefato} não define pendência`).toBe('ripd');
    }
  });

  it('nenhum par (artefato, estado) mistura "sempre" com condição', () => {
    // Se misturasse, a regra condicional seria inalcançável: `sempre` casa antes.
    const porPar = new Map<string, string[]>();
    for (const r of REGRAS) {
      const par = `${r.artefato}:${r.estado}`;
      porPar.set(par, [...(porPar.get(par) ?? []), r.quando]);
    }
    for (const [par, quandos] of porPar) {
      if (quandos.length > 1) expect(quandos, par).not.toContain('sempre');
    }
  });

  it('o achado é de engenharia e do DPO — e de mais ninguém', () => {
    const b = new BancoMock('banco');
    const achado = b.cenario.achados[0];
    achado.status = 'causa_raiz';
    const todos = derivarFila(b.cenario, Date.now());
    const alcanca = (['engenharia', 'dpo', 'produto', 'seguranca', 'auditor'] as Papel[])
      .filter((p) => minhaFila(todos, p).some((i) => i.id === achado.codigo));
    expect(alcanca).toEqual(['engenharia', 'dpo']);
    expect(todos.find((i) => i.id === achado.codigo)!.titularidade)
      .toEqual({ tipo: 'derivada', acao: 'gerenciar_achado' });
  });

  it('todo estado aberto do achado tem regra, e o encerrado não tem', () => {
    const comRegra = REGRAS.filter((r) => r.artefato === 'achado').map((r) => r.estado).sort();
    expect(comRegra).toEqual(['aberto', 'causa_raiz', 'executado', 'plano', 'reaberto', 'verificado']);
    expect(comRegra).not.toContain('encerrado');
  });
});

describe('PR 10 · T10 na tela', () => {
  const montarT10 = (papel: Papel) => {
    limparBancosDaSessao();
    useSessao.setState({ papel, banco: new BancoMock('banco'), versao: 0, avisos: [] });
    return render(<MemoryRouter><T10 /></MemoryRouter>);
  };

  it('a grade tem doze meses e a barra é a carga recomputada', () => {
    const { container } = montarT10('dpo');
    const ano = screen.getByRole('list', { name: 'Os doze meses do ano' });
    expect(within(ano).getAllByRole('listitem')).toHaveLength(12);

    const carga = cargaDoAno(useSessao.getState().banco.cenario.obrigacoes);
    const barras = container.querySelectorAll('[role="meter"]');
    expect(barras).toHaveLength(12);
    barras.forEach((b, i) => {
      expect(Number(b.getAttribute('aria-valuenow')), `mês ${i}`).toBe(carga[i].percentual);
      // A largura desenhada é o mesmo número, não um valor à parte.
      expect((b.firstElementChild as HTMLElement).style.width).toBe(`${carga[i].percentual}%`);
    });
  });

  it('o cartão da obrigação não monta faixa de estados vazia', () => {
    limparBancosDaSessao();
    const b = new BancoMock('banco');
    const o = b.cenario.obrigacoes.find((x) => !x.cumpridaEm && x.responsavel === 'dpo')!;
    o.vence = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    o.antecedenciaDias = 30;
    useSessao.setState({ papel: 'dpo', banco: b, versao: 0, avisos: [] });
    render(<MemoryRouter><T0 /></MemoryRouter>);

    const cartao = screen.getByText(o.codigo).closest('article') as HTMLElement;
    // Lista rotulada e vazia é ruído para leitor de tela: não se monta.
    expect(within(cartao).queryByRole('list')).not.toBeInTheDocument();
    expect(within(cartao).getByText(new RegExp(`Se passar: ${o.seFalhar}`))).toBeInTheDocument();
  });

  it('cada obrigação mostra o que acontece se passar', () => {
    montarT10('dpo');
    const b = useSessao.getState().banco;
    for (const o of b.cenario.obrigacoes.slice(0, 4)) {
      expect(screen.getByText(o.seFalhar), o.codigo).toBeInTheDocument();
    }
  });

  it('prorrogar é ausência para quem não responde pela obrigação', () => {
    montarT10('auditor');
    expect(screen.queryAllByRole('button', { name: 'Prorrogar' })).toHaveLength(0);
    // A leitura do ano continua: o auditor perde o ato, não a informação.
    const ano = screen.getByRole('list', { name: 'Os doze meses do ano' });
    expect(within(ano).getAllByRole('listitem')).toHaveLength(12);

    cleanup();
    montarT10('dpo');
    expect(screen.getAllByRole('button', { name: 'Prorrogar' }).length).toBeGreaterThan(0);
  });

  it('a recusa da prorrogação fica no controle que falhou, não na faixa do topo', () => {
    montarT10('dpo');
    fireEvent.click(screen.getAllByRole('button', { name: 'Prorrogar' })[0]);
    fireEvent.change(screen.getByLabelText(/Justificativa/), { target: { value: 'curto' } });
    fireEvent.change(screen.getByLabelText(/Nova data/), { target: { value: '2027-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar prorrogação' }));

    const alerta = screen.getByRole('alert');
    expect(alerta.textContent).toContain('justificativa de ao menos 20 caracteres');
    // Um só alerta na região, e o modal continua aberto para corrigir.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByLabelText(/Justificativa/)).toBeInTheDocument();
  });

  it('o feed mostrado é o do papel da sessão, e o corpo não traz dado pessoal', () => {
    montarT10('dpo');
    expect(screen.getByText(new RegExp(assinaturaDoFeed('dpo', sha256)))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ver o feed de dpo/ }));
    const texto = screen.getByText(/BEGIN:VCALENDAR/).textContent ?? '';
    expect(texto).toContain('BEGIN:VEVENT');
    for (const s of useSessao.getState().banco.cenario.solicitacoes) {
      expect(texto.includes(s.protocolo)).toBe(false);
    }
  });

  it('T10 entra no trilho ao lado da fila, no grupo Trabalho', () => {
    limparBancosDaSessao();
    useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [] });
    render(<MemoryRouter initialEntries={['/t10']}><Casca /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Calendário do ano' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /T10 Calendário do ano/ })).toBeInTheDocument();
    expect(TELAS.filter((t) => t.grupo === 'Trabalho').map((t) => t.rota)).toEqual(['/t0', '/t10']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PR 11 · dispensa de RIPD com gatilho de reabertura', () => {
  const dispensar = (ripd: { id: string }, gatilhos: unknown[], papel: Papel = 'dpo') =>
    chamar(papel, {
      metodo: 'POST', caminho: `/v1/estados/ripd/${ripd.id}`,
      body: {
        para: 'dispensado',
        justificativa: 'Agregação com k mínimo de 50 e sem identificador direto nem indireto.',
        gatilhos,
      },
    });

  const emTriagem = () => {
    const r = banco.cenario.ripds[0];
    r.status = 'triagem';
    return r;
  };

  it('sem gatilho é 422; com gatilho do catálogo, o estado muda e o trail cresce', () => {
    const ripd = emTriagem();
    const antes = banco.auditoria.length;

    expect(dispensar(ripd, []).status).toBe(422);
    expect(ripd.status).toBe('triagem');
    expect(banco.auditoria).toHaveLength(antes);

    const ok = dispensar(ripd, [{ codigo: 'T5', condicao: 'Quebra do agregado abaixo de k=50.' }]);
    expect(ok.status).toBe(200);
    expect(ripd.status).toBe('dispensado');
    expect(banco.auditoria).toHaveLength(antes + 1);
    expect(banco.auditVerificar().integro).toBe(true);
  });

  it('o gatilho é código do catálogo, não prosa — e a condição precisa dizer algo', () => {
    const ripd = emTriagem();
    // A frase de antes do PR 11 era aceita e não disparava nada.
    expect(dispensar(ripd, [{ codigo: 'coleta de identificador', condicao: 'reabre a triagem' }]).status).toBe(422);
    expect(dispensar(ripd, [{ codigo: 'T5', condicao: 'muda' }]).status).toBe(422);
    expect(ripd.status).toBe('triagem');
  });

  it('a dispensa fica no artefato, append-only e com a justificativa redigida', () => {
    const ripd = emTriagem();
    dispensar(ripd, [{ codigo: 'T5', condicao: 'Quebra do agregado abaixo de k=50.' }]);
    expect(ripd.dispensas).toHaveLength(1);
    expect(ripd.dispensas![0].gatilhos[0].codigo).toBe('T5');
    expect(ripd.dispensas![0].disparos).toEqual([]);

    // Dispensar de novo depois de reabrir acrescenta, não reescreve.
    ripd.status = 'triagem';
    dispensar(ripd, [{ codigo: 'T7', condicao: 'Cruzamento com base que tenha identificador direto.' }]);
    expect(ripd.dispensas).toHaveLength(2);
    expect(ripd.dispensas![0].gatilhos[0].codigo).toBe('T5');
  });
});

describe('PR 11 · o gatilho dispara e reabre sem intervenção manual', () => {
  const dispensado = () => banco.cenario.ripds.find((r) => r.status === 'dispensado')!;
  const disparar = (codigo: string, evidencia: string, papel: Papel = 'engenharia') =>
    chamar<{ reabriu: boolean; motivo: string }>(papel, {
      metodo: 'POST', caminho: `/v1/ripds/${dispensado().id}/gatilho`, body: { codigo, evidencia },
    });

  it('gatilho declarado dispara e o RIPD volta a elaboracao, com o evento na cadeia', () => {
    const ripd = dispensado();
    expect(ripd.dispensas![0].gatilhos.map((g) => g.codigo)).toContain('T7');
    const antes = banco.auditoria.length;

    const res = disparar('T7', 'join entre o agregado e a base de assinantes em etl/audiencia.sql:88');
    expect(res.status).toBe(200);
    expect(res.body.reabriu).toBe(true);
    expect(ripd.status).toBe('elaboracao');

    // Dois eventos: o disparo e a transição. Ambos na cadeia, e a cadeia íntegra.
    expect(banco.auditoria).toHaveLength(antes + 2);
    expect(banco.auditoria.at(-2)!.acao).toBe('GATILHO_DISPARADO');
    expect(banco.auditoria.at(-2)!.campos).toContain('T7');
    expect(banco.auditoria.at(-1)!.acao).toBe('ESTADO_TRANSICIONADO');
    expect(banco.auditoria.at(-1)!.campos).toContain('dispensado→elaboracao');
    expect(banco.auditVerificar().integro).toBe(true);

    // E o disparo fica pendurado na dispensa, que continua no artefato.
    expect(ripd.dispensas![0].disparos).toHaveLength(1);
    expect(ripd.dispensas![0].disparos[0].reabriu).toBe(true);
  });

  it('gatilho crítico não declarado também reabre — a omissão não protege a dispensa', () => {
    const ripd = dispensado();
    expect(ripd.dispensas![0].gatilhos.map((g) => g.codigo)).not.toContain('T3');
    const res = disparar('T3', 'novo endpoint /audiencia/score retorna decisão automatizada por sessão');
    expect(res.status).toBe(200);
    expect(res.body.reabriu).toBe(true);
    expect(res.body.motivo).toContain('crítico');
    expect(ripd.status).toBe('elaboracao');
  });

  it('gatilho não crítico e não declarado fica como evidência, sem reabrir', () => {
    const ripd = dispensado();
    const res = disparar('T6', 'dependência nova de biblioteca de agregação em package.json');
    expect(res.status).toBe(200);
    expect(res.body.reabriu).toBe(false);
    expect(ripd.status).toBe('dispensado');
    // O fato aconteceu e fica registrado: não reabrir não é não acontecer.
    expect(ripd.dispensas![0].disparos).toHaveLength(1);
    expect(ripd.dispensas![0].disparos[0].reabriu).toBe(false);
    expect(banco.auditoria.at(-1)!.acao).toBe('GATILHO_DISPARADO');
  });

  it('disparo exige evidência, código do catálogo e um RIPD dispensado', () => {
    expect(disparar('T7', 'curto').status).toBe(422);
    expect(disparar('T99', 'evidência suficientemente longa para passar').status).toBe(422);
    // Um RIPD que não está dispensado não tem gatilho pendurado.
    const emRevisao = banco.cenario.ripds[0];
    expect(chamar('engenharia', {
      metodo: 'POST', caminho: `/v1/ripds/${emRevisao.id}/gatilho`,
      body: { codigo: 'T7', evidencia: 'evidência suficientemente longa para passar' },
    }).status).toBe(409);
  });

  it('se o log falhar, o gatilho não dispara e a dispensa continua de pé', () => {
    const ripd = dispensado();
    banco.simularFalhaDeLog = true;
    const res = disparar('T7', 'join entre o agregado e a base de assinantes');
    expect(res.status).toBe(503);
    expect(ripd.status).toBe('dispensado');
    expect(ripd.dispensas![0].disparos).toEqual([]);
  });

  it('disparar é da esteira: papel sem gerar_ripd não alcança a rota', () => {
    expect(disparar('T7', 'evidência suficientemente longa para passar', 'dpo').status).toBe(403);
    expect(disparar('T7', 'evidência suficientemente longa para passar', 'auditor').status).toBe(403);
  });
});

describe('PR 11 · os sete princípios — a regra', () => {
  const marcar = (over: Partial<Record<string, { marcado: boolean; evidencia: string }>> = {}) =>
    PRINCIPIOS_PBD.map((p) => ({
      chave: p.chave,
      marcado: over[p.chave]?.marcado ?? true,
      evidencia: over[p.chave]?.evidencia ?? `app/src/mock/${p.chave}.ts`,
    }));

  it('só passa com os sete evidenciados', () => {
    expect(vereditoPbd(marcar()).aprovado).toBe(true);
    expect(vereditoPbd(marcar()).evidenciados).toBe(7);
  });

  it('seis de sete mantém o vermelho e nomeia o que falta', () => {
    const v = vereditoPbd(marcar({ transparencia: { marcado: false, evidencia: '' } }));
    expect(v.aprovado).toBe(false);
    expect(v.evidenciados).toBe(6);
    expect(v.pendencias).toHaveLength(1);
    expect(v.pendencias[0].chave).toBe('transparencia');
    // Acionável: o gate diz a pergunta que o time precisa responder.
    expect(v.pendencias[0].motivo).toContain('em branco');
    expect(v.pendencias[0].pergunta.length).toBeGreaterThan(20);
  });

  it('marcado sem evidência é reprovação, e a mensagem é diferente do branco', () => {
    const semEvidencia = vereditoPbd(marcar({ padrao: { marcado: true, evidencia: '' } }));
    const emBranco = vereditoPbd(marcar({ padrao: { marcado: false, evidencia: '' } }));

    expect(semEvidencia.aprovado).toBe(false);
    expect(semEvidencia.pendencias[0].situacao).toBe('marcado_sem_evidencia');
    expect(semEvidencia.pendencias[0].motivo).toContain('não aponta evidência');
    expect(emBranco.pendencias[0].situacao).toBe('em_branco');
    // As duas reprovam, e dizem coisas diferentes: contar "quantos faltam"
    // esconderia justamente a afirmação que ninguém consegue conferir.
    expect(semEvidencia.pendencias[0].motivo).not.toBe(emBranco.pendencias[0].motivo);
  });

  it('princípio ausente da lista conta como em branco, não como aprovado', () => {
    const v = vereditoPbd([{ chave: 'proativo', marcado: true, evidencia: 'app/src/mock/politicas.ts' }]);
    expect(v.aprovado).toBe(false);
    expect(v.evidenciados).toBe(1);
    expect(v.pendencias).toHaveLength(6);
  });

  it('a rota devolve o veredito calculado pela mesma função', () => {
    const res = chamar<{ pbd: MarcacaoPbd[]; veredito: VereditoPbd }[]>('produto', { metodo: 'GET', caminho: '/v1/epicos' });
    expect(res.status).toBe(200);
    for (const e of res.body) expect(e.veredito).toEqual(vereditoPbd(e.pbd));
    // A massa traz de propósito o caso que um checklist ingênuo contaria como pronto.
    const situacoes = avaliarPbd(res.body[0].pbd).map((p) => p.situacao);
    expect(situacoes).toContain('marcado_sem_evidencia');
    expect(situacoes).toContain('em_branco');
    expect(res.body[0].veredito.aprovado).toBe(false);
  });
});

describe('PR 11 · o gate de privacidade — verificação: ele roda e falha certo?', () => {
  const raizes: string[] = [];
  const repo = (arquivos: Record<string, string>): string => {
    const raiz = mkdtempSync(join(tmpdir(), 'gate-'));
    raizes.push(raiz);
    for (const [rel, conteudo] of Object.entries(arquivos)) {
      const alvo = join(raiz, rel);
      mkdirSync(dirname(alvo), { recursive: true });
      writeFileSync(alvo, conteudo);
    }
    return raiz;
  };
  afterEach(() => {
    for (const r of raizes.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  const INVENTARIO = ['repositorio: teste', 'campos:', '  - nome: titular_hash', '  - nome: campo'].join('\n');
  const EPICO = ['pbd:', ...PRINCIPIOS_PBD.map((p) => `  - chave: ${p.chave}\n    evidencia: src/app.ts`)].join('\n');
  const BASE = {
    '.privacy/data-inventory.teste.yaml': INVENTARIO,
    '.privacy/epico.yml': EPICO,
    'src/app.ts': 'export const x = 1;\n',
  };

  it('repositório sem declaração reprova — ausência não é aprovação', () => {
    const r = rodarGate(repo({ 'src/app.ts': '' }));
    expect(r.aprovado).toBe(false);
    expect(r.achados[0].regra).toBe('declaracao/ausente');
  });

  it('repositório limpo passa, e a varredura leu alguma coisa', () => {
    const r = rodarGate(repo({ ...BASE, 'logs/app.log': 'ts=2026-01-01 campo=cpf titular_hash=hmac:9f4c\n' }));
    expect(r.achados, JSON.stringify(r.achados)).toEqual([]);
    expect(r.aprovado).toBe(true);
    // Zero arquivo varrido seria um gate que passa por não ter olhado.
    expect(r.arquivosVarridos).toBe(1);
  });

  it('CPF em log de exemplo reprova citando arquivo e linha', () => {
    const r = rodarGate(repo({
      ...BASE,
      'logs/cobranca.log': [
        'ts=2026-01-01 campo=cpf titular_hash=hmac:9f4c',
        'ts=2026-01-01 campo=cpf valor=347.912.884-42',
      ].join('\n'),
    }));
    expect(r.aprovado).toBe(false);
    const achado = r.achados.find((a) => a.regra === 'pii-em-log/cpf')!;
    expect(achado.arquivo).toBe(join('logs', 'cobranca.log'));
    expect(achado.linha).toBe(2);
    expect(achado.mensagem).toContain('347.912.884-42');
    expect(achado.comoCorrigir).toContain('redator');
  });

  it('e-mail e telefone em log também reprovam', () => {
    const r = rodarGate(repo({
      ...BASE,
      'logs/a.log': 'campo=email valor=marina.s@exemplo.com\ncampo=fone valor=(11) 98765-4321\n',
    }));
    const regras = r.achados.map((a) => a.regra);
    expect(regras).toContain('pii-em-log/email');
    expect(regras).toContain('pii-em-log/telefone');
  });

  it('campo fora do catálogo reprova, e campo declarado passa', () => {
    const r = rodarGate(repo({ ...BASE, 'logs/a.log': 'campo=x titular_hash=y renda=1200\n' }));
    const achado = r.achados.find((a) => a.regra === 'catalogo/campo-nao-declarado')!;
    expect(achado.mensagem).toContain('"renda"');
    expect(achado.comoCorrigir).toContain('categoria e base legal');
    // `campo` e `titular_hash` estão no inventário e não geram achado.
    expect(r.achados.filter((a) => a.regra === 'catalogo/campo-nao-declarado')).toHaveLength(1);
  });

  it('inventário ilegível reprova em vez de virar lista vazia', () => {
    const r = rodarGate(repo({ ...BASE, '.privacy/data-inventory.teste.yaml': 'campos: [\n  - : :\n' }));
    expect(r.aprovado).toBe(false);
    expect(r.achados.some((a) => a.regra === 'catalogo/ilegivel')).toBe(true);
  });

  it('seis de sete princípios evidenciados mantém o gate vermelho, nomeando o que falta', () => {
    const seisDeSete = ['pbd:', ...PRINCIPIOS_PBD.slice(0, 6)
      .map((p) => `  - chave: ${p.chave}\n    evidencia: src/app.ts`)].join('\n');
    const r = rodarGate(repo({ ...BASE, '.privacy/epico.yml': seisDeSete }));
    expect(r.aprovado).toBe(false);
    const pendencias = r.achados.filter((a) => a.regra.startsWith('pbd/'));
    expect(pendencias).toHaveLength(1);
    expect(pendencias[0].mensagem).toContain(PRINCIPIOS_PBD[6].pergunta);
  });

  it('marcado sem evidência reprova, e com mensagem própria', () => {
    const semEvidencia = ['pbd:', ...PRINCIPIOS_PBD.map((p, i) => (
      i === 3 ? `  - chave: ${p.chave}\n    evidencia: ''` : `  - chave: ${p.chave}\n    evidencia: src/app.ts`
    ))].join('\n');
    const r = rodarGate(repo({ ...BASE, '.privacy/epico.yml': semEvidencia }));
    expect(r.aprovado).toBe(false);
    const achado = r.achados.find((a) => a.regra === 'pbd/marcado_sem_evidencia')!;
    expect(achado.mensagem).toContain('não aponta evidência');
    expect(achado.comoCorrigir).toContain('desmarque');
  });

  it('evidência que aponta para arquivo inexistente é evidência que não existe', () => {
    const mentira = ['pbd:', ...PRINCIPIOS_PBD.map((p, i) => (
      i === 0 ? `  - chave: ${p.chave}\n    evidencia: src/nao-existe.ts` : `  - chave: ${p.chave}\n    evidencia: src/app.ts`
    ))].join('\n');
    const r = rodarGate(repo({ ...BASE, '.privacy/epico.yml': mentira }));
    expect(r.aprovado).toBe(false);
    const achado = r.achados.find((a) => a.regra === 'pbd/evidencia-inexistente')!;
    expect(achado.mensagem).toContain('src/nao-existe.ts');
  });

  it('todo achado bloqueante diz onde é e como corrigir', () => {
    const r = rodarGate(repo({
      ...BASE,
      'logs/a.log': 'campo=cpf valor=347.912.884-42 renda=1200\n',
      '.privacy/epico.yml': 'pbd: []',
    }));
    expect(r.achados.length).toBeGreaterThan(3);
    for (const a of r.achados) {
      expect(a.comoCorrigir.length, a.regra).toBeGreaterThan(20);
      expect(a.mensagem.length, a.regra).toBeGreaterThan(20);
      expect(a.regra, 'regra sem namespace não é acionável').toMatch(/\//);
    }
    // O relatório do CI cita arquivo e linha, não só o código de saída.
    expect(relatorio(r)).toContain('logs/a.log:1');
  });
});

describe('PR 11 · o gate de privacidade — validação: ele barra o que a LGPD exige?', () => {
  it('este repositório passa no próprio gate', () => {
    // O gate come a própria comida: se o repositório que prega o controle não
    // passa nele, o controle é decoração.
    const r = rodarGate(resolve('..'));
    expect(r.achados, relatorio(r)).toEqual([]);
    expect(r.arquivosVarridos, 'nenhum log varrido é gate que passa por não ter olhado').toBeGreaterThan(0);
  });

  it('o log de exemplo publicado registra o campo acessado, nunca o valor', () => {
    // Art. 37: o que sustenta o acesso em auditoria é finalidade, ator e campo —
    // não o dado. O exemplo do repositório precisa demonstrar isso.
    const log = readFileSync('../.privacy/exemplos/audit-trail.log', 'utf8');
    expect(log).toContain('campo=cpf');
    expect(log).toContain('purpose=');
    expect(log).toContain('titular_hash=hmac:');
    expect(log).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    // Inclusive a tentativa negada entra no registro.
    expect(log).toContain('result=negado');
  });

  it('o workflow do gate não tolera falha e roda nos dois gatilhos', () => {
    const yml = readFileSync('../.github/workflows/privacy-ci-gate.yml', 'utf8');
    // Mesma disciplina do C-18: a palavra que tornaria o gate decorativo não
    // aparece no arquivo, e uma varredura simples confirma a ausência.
    expect(yml).not.toContain('continue-on-error');
    expect(yml).toMatch(/on:\s*\n\s*push:/);
    expect(yml).toContain('pull_request');
    expect(yml).toContain('npm run gate:privacidade');
  });

  it('a regra de PbD do gate é a mesma da tela — não há segunda implementação', () => {
    const fonte = readFileSync('src/lib/gate-privacidade.ts', 'utf8');
    expect(fonte).toContain("from '../mock/pbd'");
    // Se o gate recalculasse a situação por conta própria, as duas divergiriam
    // e a que valeria seria a que ninguém está olhando.
    expect(fonte).not.toContain('marcado_sem_evidencia:');
    expect(fonte.match(/const MINIMO_EVIDENCIA/)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PR 12 · conformidade — o documento corresponde ao código?', () => {
  it('cada .bpmn cobre exatamente os estados e as transições da máquina', () => {
    for (const artefato of ARTEFATOS) {
      const leitura = lerBpmn(`${artefato}.bpmn`);
      const divergencias = divergenciasBpmn(leitura, MAQUINAS[artefato] as Record<string, string[]>);
      expect(divergencias, `${artefato}.bpmn:\n  ${divergencias.join('\n  ')}`).toEqual([]);
      // Documento vazio não confere nada: a leitura precisa ter achado algo.
      expect(leitura.estados.length, artefato).toBe(estadosDe(artefato).length);
      expect(leitura.arestas.length, artefato).toBeGreaterThan(0);
    }
  });

  it('a catraca vale nos dois sentidos: aresta a mais ou a menos reprova', () => {
    // É a prova de que o teste acima não passa por não estar olhando. Sem ela,
    // um comparador quebrado ficaria verde para sempre.
    const leitura = lerBpmn('incidente.bpmn');
    const original = MAQUINAS.incidente as Record<string, string[]>;

    const comArestaNova = { ...original, aberto: [...original.aberto, 'comunicado'] };
    expect(divergenciasBpmn(leitura, comArestaNova))
      .toContain('transição aberto→comunicado existe no runtime e não no .bpmn');

    const semAresta = { ...original, contido: [] };
    const d = divergenciasBpmn(leitura, semAresta);
    expect(d).toContain('transição contido→decidido existe no .bpmn e não no runtime');
    // Apagar a saída de `contido` o torna final no runtime, e o desenho não tem
    // evento de fim ali: a catraca acusa a assimetria pelos dois lados.
    expect(d).toContain('estado final "contido" não tem evento de fim no .bpmn');

    const comEstadoNovo = { ...original, arquivado: [] };
    expect(divergenciasBpmn(leitura, comEstadoNovo))
      .toContain('estado "arquivado" existe no runtime e não no .bpmn');
  });

  it('transição ilegal no .bpmn do incidente é ilegal em estados.ts, e vice-versa', () => {
    const arestas = new Set(lerBpmn('incidente.bpmn').arestas);
    const estados = estadosDe('incidente');
    for (const de of estados) {
      for (const para of estados) {
        expect(arestas.has(`${de}→${para}`), `incidente: ${de} → ${para}`)
          .toBe(transicaoPermitida('incidente', de, para));
      }
    }
    // E as nomeadas no MAPA seguem fora do desenho.
    expect(arestas.has('aberto→comunicado')).toBe(false);
    expect(arestas.has('contido→comunicado')).toBe(false);
  });

  it('todo .bpmn declara o estado inicial e os finais que o runtime tem', () => {
    for (const artefato of ARTEFATOS) {
      const leitura = lerBpmn(`${artefato}.bpmn`);
      expect(leitura.inicial, `${artefato}: estado inicial`).toBe(estadosDe(artefato)[0]);
      const finaisDoCodigo = (estadosDe(artefato) as string[])
        .filter((e) => proximosDe(artefato, e as never).length === 0);
      expect([...leitura.finais].sort(), artefato).toEqual([...finaisDoCodigo].sort());
    }
  });

  it('cada .dmn reproduz a saída de decisoes.ts para toda combinação de entrada', () => {
    let combinacoesConferidas = 0;
    for (const id of TABELAS_IDS) {
      for (const v of TABELAS[id].versoes) {
        const leitura = lerDmn(`${id}.v${v.versao}.dmn`);
        // Estrutura antes do conteúdo: campos, saídas e política de acerto.
        expect(leitura.hitPolicy, `${id}@${v.versao}`).toBe('FIRST');
        expect(leitura.campos.sort(), `${id}@${v.versao}: campos`).toEqual(Object.keys(v.restritivo).sort());
        expect(leitura.regras.length, `${id}@${v.versao}: regras`).toBe(v.regras.length);

        for (const entradas of combinacoes(dominioDe(leitura, v.restritivo))) {
          const doDoc = aplicarDmn(leitura, entradas);
          const doCodigo = aplicar(id, entradas, v.versao).saida;
          expect(doDoc, `${id}@${v.versao} · ${JSON.stringify(entradas)}`).toEqual(doCodigo);
          combinacoesConferidas += 1;
        }
      }
    }
    // Varredura que não varreu nada passaria calada.
    expect(combinacoesConferidas).toBeGreaterThan(200);
  });

  it('a D2 do .dmn dá a mesma faixa que a matriz da T5, célula a célula', () => {
    const leitura = lerDmn('d2.v1.dmn');
    for (let p = 1; p <= 5; p += 1) {
      for (let i = 1; i <= 5; i += 1) {
        const doDoc = aplicarDmn(leitura, { probabilidade: p, impacto: i, score: p * i });
        expect(doDoc!.nivel, `P${p} × I${i}`).toBe(nivelDoRisco(p, i));
      }
    }
  });

  it('regra a mais ou limiar mudado no .dmn quebra a conformidade', () => {
    // A contraprova do teste de varredura, no mesmo espírito da catraca do BPMN.
    const leitura = lerDmn('d2.v1.dmn');
    const adulterada = {
      ...leitura,
      regras: leitura.regras.map((r, i) => (i === 0 ? { ...r, quando: { score: { min: 8 } } } : r)),
    };
    const divergiu = combinacoes(dominioDe(leitura, TABELAS.d2.versoes[0].restritivo))
      .some((e) => JSON.stringify(aplicarDmn(adulterada, e)) !== JSON.stringify(aplicar('d2', e, 1).saida));
    expect(divergiu, 'o comparador precisa acusar o limiar trocado').toBe(true);
  });

  it('o vocabulário FEEL conferível é fechado — entrada estranha estoura', () => {
    expect(lerEntrada('-')).toBeNull();
    expect(lerEntrada('>= 15')).toEqual({ min: 15 });
    expect(lerEntrada('"sensivel"')).toEqual({ em: ['sensivel'] });
    expect(lerEntrada('"a","b"')).toEqual({ em: ['a', 'b'] });
    expect(lerEntrada('true')).toEqual({ em: [true] });
    expect(lerEntrada('list contains(?, "T3")')).toEqual({ contem: 'T3' });
    // Parser generoso conferiria o que não entende, e passaria a comparar duas
    // coisas diferentes achando que são a mesma.
    expect(() => lerEntrada('not(1..5)')).toThrow(/fora do vocabulário/);
  });

  it('os arquivos de processo não carregam dado de cenário', () => {
    const arquivos = [...ARTEFATOS.map((a) => `${a}.bpmn`),
      ...TABELAS_IDS.flatMap((id) => TABELAS[id].versoes.map((v) => `${id}.v${v.versao}.dmn`))];
    const banco = new BancoMock('banco');
    const proibidos = [
      ...banco.cenario.titulares.map((t) => t.cpfHash),
      ...banco.cenario.solicitacoes.flatMap((s) => [s.protocolo, s.titularPseudonimo]),
      ...banco.cenario.ripds.map((r) => r.codigo),
      ...banco.cenario.riscos.map((r) => r.descricao),
    ];
    for (const nome of arquivos) {
      const xml = readFileSync(join('..', 'docs', 'processos', nome), 'utf8');
      for (const p of proibidos) {
        expect(xml.includes(p), `${nome} carrega "${p}"`).toBe(false);
      }
      // A especificação descreve o processo, não uma instância dele.
      expect(xml).not.toMatch(/hmac:|cpf|\d{3}\.\d{3}\.\d{3}-\d{2}/i);
    }
  });
});

describe('PR 12 · validação — o processo desenhado é o que a LGPD exige?', () => {
  it('o incidente comunica só depois de conter e decidir com fundamento (Art. 48)', () => {
    const arestas = new Set(lerBpmn('incidente.bpmn').arestas);
    // O caminho legal é um só, e passa pela decisão registrada.
    expect(arestas.has('aberto→contido')).toBe(true);
    expect(arestas.has('contido→decidido')).toBe(true);
    expect(arestas.has('decidido→comunicado')).toBe(true);
    // E não comunicar é decisão declarada no desenho, não a ausência de uma.
    expect(arestas.has('decidido→nao_comunicado')).toBe(true);
    expect(lerProcesso('incidente.bpmn').documentElement.textContent)
      .toContain('inclusive para não comunicar');
  });

  it('a LIA vencida não volta a vigente sem rebalanceamento (Art. 7º, IX)', () => {
    const arestas = new Set(lerBpmn('lia.bpmn').arestas);
    expect(arestas.has('vencida→vigente')).toBe(false);
    expect(arestas.has('vencida→balanceamento')).toBe(true);
  });

  it('a solicitação não conclui sem análise, e a recusa é estado próprio (Art. 18, §4º)', () => {
    const arestas = new Set(lerBpmn('solicitacao.bpmn').arestas);
    expect(arestas.has('recebida→concluida')).toBe(false);
    expect(arestas.has('em_analise→recusada_com_fundamento')).toBe(true);
  });

  it('a dispensa de RIPD tem caminho de volta — não é beco sem saída', () => {
    const arestas = new Set(lerBpmn('ripd.bpmn').arestas);
    expect(arestas.has('triagem→dispensado')).toBe(true);
    // É a aresta que o gatilho de reabertura do PR 11 percorre.
    expect(arestas.has('dispensado→elaboracao')).toBe(true);
    expect(lerBpmn('ripd.bpmn').finais).not.toContain('dispensado');
  });

  it('cada .dmn declara vigência e o que a versão mudou', () => {
    for (const id of TABELAS_IDS) {
      for (const v of TABELAS[id].versoes) {
        const xml = readFileSync(join('..', 'docs', 'processos', `${id}.v${v.versao}.dmn`), 'utf8');
        expect(xml, `${id}@${v.versao}`).toContain(v.vigenciaInicio);
        expect(xml, `${id}@${v.versao}: nota da versão`).toContain(v.nota.slice(0, 40));
        // E diz o que não está na tabela: o restritivo é contrato de aplicar().
        expect(xml).toContain('entrada ausente cai no cenário mais restritivo');
      }
    }
  });
});

describe('PR 12 · a página "Como funciona" é referência, não operação', () => {
  it('não importa runtime: nenhum mock/* entra na página', () => {
    const fonte = readFileSync('src/screens/ComoFunciona.tsx', 'utf8');
    const imports = [...fonte.matchAll(/^import .*from '([^']+)';/gm)].map((m) => m[1]);
    // Página de referência que lê o banco vira tela de operação com outro nome,
    // e passa a poder mostrar dado de titular por acidente.
    expect(imports.filter((i) => i.includes('mock/')), imports.join(', ')).toEqual([]);
    expect(imports.filter((i) => i.includes('store/'))).toEqual([]);
    expect(imports.sort()).toEqual(['../ui/primitivos', 'react-router-dom']);
  });

  it('não renderiza dado de titular, e não tem como: ela não lê o banco', () => {
    limparBancosDaSessao();
    const b = new BancoMock('banco');
    useSessao.setState({ papel: 'dpo', banco: b, versao: 0, avisos: [] });
    const { container } = render(<MemoryRouter><ComoFunciona /></MemoryRouter>);
    const texto = container.textContent ?? '';

    expect(texto).not.toContain('hmac:');
    for (const s of b.cenario.solicitacoes) {
      expect(texto.includes(s.protocolo), `protocolo ${s.protocolo}`).toBe(false);
      expect(texto.includes(s.titularPseudonimo)).toBe(false);
    }
    for (const t of b.cenario.titulares) expect(texto.includes(t.cpfHash)).toBe(false);
    expect(texto).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
  });

  it('não tem controle operável: nenhum botão, campo ou seletor', () => {
    render(<MemoryRouter><ComoFunciona /></MemoryRouter>);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    // Links de navegação continuam, porque ler e ir para outro lugar não é operar.
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('não enumera estados nem regras — aponta para quem tem prova', () => {
    const fonte = readFileSync('src/screens/ComoFunciona.tsx', 'utf8');
    // Uma terceira cópia da lista de estados seria a única sem catraca, e por
    // isso a primeira a envelhecer.
    for (const estado of ['parecer_juridico', 'recusada_com_fundamento', 'recriptografando']) {
      expect(fonte.includes(estado), `a página enumera "${estado}"`).toBe(false);
    }
    expect(fonte).toContain('docs/processos/*.bpmn');
    expect(fonte).toContain('docs/processos/*.dmn');
  });

  it('fica fora do trilho de telas e é alcançável por link direto', () => {
    expect(TELAS.map((t) => t.rota)).not.toContain('/como-funciona');
    limparBancosDaSessao();
    useSessao.setState({ papel: 'auditor', banco: new BancoMock('banco'), versao: 0, avisos: [] });
    render(<MemoryRouter initialEntries={['/como-funciona']}><Casca /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Como funciona' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Como funciona/ })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PR 13 · declarado × derivado, travado como invariante', () => {
  const PAPEIS_TODOS: Papel[] = ['engenharia', 'dpo', 'produto', 'seguranca', 'auditor'];
  const cenarios = ['banco', 'varejo', 'midia'];

  it('item de artefato deriva o dono da Acao — e de nada mais', () => {
    // O lado derivado: quem vê o item é exatamente quem a tabela de permissões
    // alcança. Se algum dia entrar um campo de dono escrito à mão no caminho do
    // artefato, este teste acusa, porque os dois conjuntos deixam de coincidir.
    for (const id of cenarios) {
      const todos = derivarFila(new BancoMock(id).cenario, Date.now());
      const deArtefato = todos.filter((i) => i.artefato !== 'obrigacao');
      expect(deArtefato.length, id).toBeGreaterThan(0);

      for (const item of deArtefato) {
        expect(item.titularidade.tipo, `${id} · ${item.id}`).toBe('derivada');
        const acao = (item.titularidade as { acao: Acao }).acao;
        const veem = PAPEIS_TODOS.filter((p) => minhaFila(todos, p).some((i) => i === item));
        const podem = PAPEIS_TODOS.filter((p) => pode(p, acao));
        expect(veem, `${id} · ${item.id}: quem vê ≠ quem pode`).toEqual(podem);
      }
    }
  });

  it('a tabela de artefatos não tem campo de papel, dono ou responsável', () => {
    // Estruturalmente, e não só por tipo: um campo a mais aqui seria a porta de
    // entrada para o dono escrito à mão que a regra proíbe.
    const permitidos = ['artefato', 'estado', 'acao', 'quando', 'urgencia', 'tipo',
      'travado', 'proximaAcao', 'proximo', 'tela'];
    for (const r of REGRAS) {
      expect(Object.keys(r).sort(), `${r.artefato}:${r.estado}`).toEqual([...permitidos].sort());
    }
  });

  it('item de obrigação herda o responsável declarado, e só ele vê', () => {
    for (const id of cenarios) {
      const b = new BancoMock(id);
      // Traz todas para dentro da antecedência: o teste é de titularidade, não
      // de relógio, e uma varredura com uma obrigação só provaria pouco.
      b.cenario.obrigacoes.forEach((o) => { o.antecedenciaDias = 400; delete o.cumpridaEm; });
      const todos = derivarFila(b.cenario, Date.now());

      for (const o of b.cenario.obrigacoes) {
        const item = todos.find((i) => i.id === o.codigo)!;
        expect(item, `${id} · ${o.codigo} não foi promovida`).toBeDefined();
        expect(item.titularidade).toEqual({ tipo: 'declarada', responsavel: o.responsavel });
        const veem = PAPEIS_TODOS.filter((p) => minhaFila(todos, p).some((i) => i.id === o.codigo));
        expect(veem, `${id} · ${o.codigo}`).toEqual([o.responsavel]);
      }
    }
  });

  it('toda obrigação promovível declara responsável — nenhuma cai por omissão', () => {
    for (const id of cenarios) {
      for (const o of new BancoMock(id).cenario.obrigacoes) {
        expect(o.responsavel, `${id} · ${o.codigo}: responsável vazio`).toBeTruthy();
        expect(PAPEIS_TODOS, `${id} · ${o.codigo}: papel desconhecido`).toContain(o.responsavel);
      }
    }
  });

  it('as três de condução saíram de escrever para o dono nomeado', () => {
    const b = new BancoMock('banco');
    const de = (curto: string) => b.cenario.obrigacoes.find((o) => o.curto === curto)!;
    expect(de('Diagnóstico AS-IS').responsavel).toBe('engenharia');
    expect(de('Trilha técnica').responsavel).toBe('engenharia');
    expect(de('Tabletop').responsavel).toBe('seguranca');

    // O DPO deixa de vê-las na fila, e elas continuam no calendário do ano.
    b.cenario.obrigacoes.forEach((o) => { o.antecedenciaDias = 400; delete o.cumpridaEm; });
    const todos = derivarFila(b.cenario, Date.now());
    const naFilaDo = (papel: Papel) => minhaFila(todos, papel).map((i) => i.id);
    for (const curto of ['Diagnóstico AS-IS', 'Trilha técnica', 'Tabletop']) {
      expect(naFilaDo('dpo'), `${curto} ainda na fila do DPO`).not.toContain(de(curto).codigo);
    }
    expect(naFilaDo('engenharia')).toContain(de('Diagnóstico AS-IS').codigo);
    expect(naFilaDo('engenharia')).toContain(de('Trilha técnica').codigo);
    expect(naFilaDo('seguranca')).toContain(de('Tabletop').codigo);

    // Nenhuma sumiu do calendário: a titularidade mudou, o ano não.
    expect(cargaDoAno(b.cenario.obrigacoes).reduce((s, c) => s + c.obrigacoes.length, 0)).toBe(22);
  });

  it('a fila filtra pela abstração, não pelo papel concreto nem pela natureza', () => {
    // Aberto/fechado: uma terceira natureza de titularidade não tocaria em
    // `minhaFila` nem em `contadoresDe`. Substituição: as duas variantes
    // respondem à mesma pergunta, e o filtro não pergunta qual é qual.
    const fonte = readFileSync('src/mock/fila.ts', 'utf8');
    const filtro = fonte.slice(fonte.indexOf('export const minhaFila'));
    expect(filtro).toContain('eDe(i.titularidade, papel)');
    expect(filtro).not.toContain("tipo === 'declarada'");
    expect(filtro).not.toContain("tipo === 'derivada'");
    expect(filtro).not.toMatch(/'(dpo|engenharia|seguranca|produto|auditor)'/);

    // E `eDe` responde por qualquer variante sem o chamador saber qual é.
    expect(eDe({ tipo: 'derivada', acao: 'gerar_ripd' }, 'engenharia')).toBe(true);
    expect(eDe({ tipo: 'derivada', acao: 'gerar_ripd' }, 'dpo')).toBe(false);
    expect(eDe({ tipo: 'declarada', responsavel: 'seguranca' }, 'seguranca')).toBe(true);
    expect(eDe({ tipo: 'declarada', responsavel: 'seguranca' }, 'engenharia')).toBe(false);
  });

  it('nenhuma permissão declarada fica sem quem a exerça', () => {
    // `conduzir_ciclo` saiu porque perdeu o único usuário. Permissão que não
    // habilita nada sugere um recorte que o sistema não faz — e este invariante
    // é o que impede a próxima de ficar para trás.
    const fontes = ['src/mock/fila.ts', 'src/mock/politicas.ts', 'src/mock/api.ts',
      ...['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'].map((t) => `src/screens/${t}.tsx`)]
      .map((f) => readFileSync(f, 'utf8')).join('\n');

    for (const acao of ACOES) {
      expect(new RegExp(`'${acao}'|"${acao}"`).test(fontes), `a ação "${acao}" não é exercida em lugar nenhum`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PR 14 · verificação — o documento corresponde ao código?', () => {
  const MAPA = readFileSync(join('..', 'docs', 'design_handoff_lastro_correcoes', 'MAPA-PROCESSOS.md'), 'utf8');
  /**
   * O markdown é quebrado em 100 colunas, então frase se parte no meio. As
   * asserções de prosa rodam sobre o texto normalizado: reformatar o arquivo não
   * pode quebrar teste, senão o teste vira obstáculo à edição que ele protege.
   */
  const prosa = MAPA.replace(/^>\s?/gm, '').replace(/\s+/g, ' ');
  const README = readFileSync(join('..', 'docs', 'processos', 'README.md'), 'utf8');

  /** O que o MAPA escreve como código: crases e blocos cercados. */
  const codigoNoMapa = (): string[] => [
    ...[...MAPA.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]),
    ...[...MAPA.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]),
  ];

  it('nenhum identificador de estado é reenunciado no MAPA', () => {
    // A comparação é sobre **código** no markdown, e não sobre prosa: "plano",
    // "aberto" e "nova" são palavras comuns, e uma varredura por substring
    // acusaria o texto inteiro. O que não pode voltar é a tabela — e tabela de
    // estado se escreve em crase ou em bloco.
    const estados = new Set(ARTEFATOS.flatMap((a) => estadosDe(a) as string[]));
    const trechos = codigoNoMapa();
    for (const e of estados) {
      const reenunciado = trechos.filter((t) => new RegExp(`\\b${e}\\b`).test(t));
      expect(reenunciado, `o MAPA reenuncia o estado "${e}": ${reenunciado.join(' | ')}`).toEqual([]);
    }
    // E o §2 não tem mais bloco cercado nenhum: era onde as oito tabelas viviam.
    const secao2 = MAPA.slice(MAPA.indexOf('## 2 ·'), MAPA.indexOf('## 4 ·'));
    expect(secao2).not.toContain('```');
  });

  it('nenhum limiar de decisão é reenunciado no MAPA', () => {
    const limiares = new Set<string>();
    for (const id of TABELAS_IDS) {
      for (const v of TABELAS[id].versoes) {
        for (const r of v.regras) {
          for (const t of Object.values(r.quando)) {
            if ('min' in t) limiares.add(String(t.min));
            if ('max' in t) limiares.add(String(t.max));
          }
        }
      }
    }
    expect(limiares.size, 'sem limiar extraído a varredura não prova nada').toBeGreaterThan(3);
    const trechos = codigoNoMapa().join('\n');
    for (const n of limiares) {
      expect(new RegExp(`[<>=≥≤]\\s*${n}\\b`).test(trechos), `o MAPA reenuncia o limiar ${n}`).toBe(false);
    }
  });

  it('todo caminho que o MAPA cita em docs/processos existe', () => {
    const citados = [...MAPA.matchAll(/`(docs\/processos\/[^`]+)`/g)].map((m) => m[1]);
    expect(citados.length, 'o MAPA precisa apontar para onde a especificação foi').toBeGreaterThan(1);
    for (const c of citados) {
      const alvo = c.replace('*', '');
      // Glob aponta para o diretório; caminho literal, para o arquivo.
      const caminho = c.includes('*')
        ? join('..', 'docs', 'processos')
        : join('..', ...c.split('/'));
      expect(existsSync(caminho), `${c} não resolve`).toBe(true);
      expect(alvo.startsWith('docs/processos/')).toBe(true);
    }
  });

  it('todo ramo de 422 de exigenciasDe tem linha no README', () => {
    // A catraca do lado da prosa: o teste extrai os ramos do código, e uma
    // exigência nova sem enunciado vira lacuna apontada em vez de silêncio.
    const fonte = readFileSync('src/mock/api.ts', 'utf8');
    const corpo = fonte.slice(fonte.indexOf('function exigenciasDe'), fonte.indexOf('export function transitar'));
    const ramos = [...corpo.matchAll(/artefato === '(\w+)' && para === '(\w+)'/g)]
      .map((m) => ({ artefato: m[1], para: m[2] }));

    expect(ramos.length, 'nenhum ramo extraído: a varredura não está olhando o código certo')
      .toBeGreaterThanOrEqual(5);

    const tabela = README.slice(README.indexOf('## As exigências de conteúdo'));
    for (const r of ramos) {
      const linha = tabela.split('\n').find(
        (l) => l.startsWith('|') && l.includes(`\`${r.artefato}\``) && l.includes(r.para),
      );
      expect(linha, `sem linha no README para ${r.artefato} → ${r.para}`).toBeDefined();
      // Linha que só nomeia a transição não ajuda ninguém: precisa dizer o que
      // exige e por quê.
      expect(linha!.split('|').filter(Boolean).length, `${r.artefato} → ${r.para}: colunas`).toBe(4);
      expect(linha!.split('|')[4].trim().length, `${r.artefato} → ${r.para}: sem "por quê"`).toBeGreaterThan(40);
    }
  });

  it('o limite de seis estados saiu, e a saída está explicada', () => {
    // A regra não pode mais ser **enunciada**; falar dela para revogá-la é outra
    // coisa, e é o que a seção nova faz. O teste separa as duas: a forma
    // normativa original some, e qualquer menção sobra só dentro da revogação.
    expect(MAPA).not.toContain('**máximo 6 estados**');
    expect(MAPA).toContain('Sobre o antigo limite de seis estados');
    const revogacao = MAPA.slice(MAPA.indexOf('### Sobre o antigo limite'), MAPA.indexOf('## 3 ·'));
    const forasDaRevogacao = MAPA.split(/seis estados|6 estados/).length - 1
      - (revogacao.split(/seis estados|6 estados/).length - 1);
    expect(forasDaRevogacao, 'o limite ainda é enunciado fora da seção que o revoga').toBe(0);
    expect(revogacao.replace(/\s+/g, ' ')).toContain('A regra sai');
    // A explicação precisa cobrir as duas máquinas que a violavam.
    const secao = revogacao;
    expect(secao).toContain('RIPD tem sete');
    expect(secao).toContain('achado tem sete');
    // E o texto tem de bater com o código: exatamente duas máquinas com sete.
    const comSete = ARTEFATOS.filter((a) => estadosDe(a).length === 7);
    expect(comSete.sort()).toEqual(['achado', 'ripd']);
    expect(ARTEFATOS.filter((a) => estadosDe(a).length > 7)).toEqual([]);
    expect(secao.replace(/\s+/g, ' ')).toContain('seis das oito máquinas cabiam nele');
    expect(ARTEFATOS.filter((a) => estadosDe(a).length <= 6), 'cabiam no limite antigo').toHaveLength(6);
    expect(ARTEFATOS.filter((a) => estadosDe(a).length <= 5), 'cinco estados ou menos').toHaveLength(5);
  });

  it('o MAPA declara o próprio estatuto e traz a subseção que faltava', () => {
    expect(prosa).toContain('este mapa é **documento de intenção**');
    expect(MAPA).toContain('### Declarado × derivado — quem é dono');
    const sub = MAPA.slice(MAPA.indexOf('### Declarado × derivado'), MAPA.indexOf('## 5 ·'))
      .replace(/\s+/g, ' ');
    expect(sub).toContain('nunca de campo escrito à mão');
    expect(sub).toContain('`responsavel`');
    expect(sub).toContain('`escrever`');
  });
});

describe('PR 14 · validação — o que o documento enuncia é o que a LGPD exige?', () => {
  const README = readFileSync(join('..', 'docs', 'processos', 'README.md'), 'utf8');
  const tabela = README.slice(README.indexOf('## As exigências de conteúdo'));

  const semExigencia = (artefato: string, id: string, de: string, para: string) => {
    const b = new BancoMock('banco');
    const artefatos: Record<string, () => void> = {
      parecer: () => { b.cenario.pareceres[0].status = de as never; },
      ripd: () => { b.cenario.ripds[0].status = de as never; },
      risco: () => { b.cenario.riscos[0].status = de as never; },
      solicitacao: () => { b.cenario.solicitacoes[0].status = de as never; },
      achado: () => { b.cenario.achados[0].status = de as never; },
    };
    artefatos[artefato]();
    return request(b, { papel: 'dpo', ator: 'teste', metodo: 'POST', caminho: `/v1/estados/${artefato}/${id}`, body: { para } });
  };

  it('cada linha enunciada é de fato recusada com 422 pela rota', () => {
    // O enunciado e o comportamento têm de concordar em efeito, não só em
    // existência: uma linha que descreve exigência que a rota não aplica seria
    // documentação bonita e falsa.
    const casos: [string, string, string, string][] = [
      ['parecer', 'PT-2026-018', 'homologado', 'devolvido'],
      ['ripd', 'RIPD-2026-014', 'triagem', 'dispensado'],
      ['risco', 'R1', 'em_tratamento', 'aceito'],
      ['solicitacao', '2026-0731', 'em_analise', 'recusada_com_fundamento'],
      ['achado', 'ACH-2026-007', 'executado', 'verificado'],
    ];
    for (const [artefato, id, de, para] of casos) {
      const res = semExigencia(artefato, id, de, para);
      expect(res.status, `${artefato}: ${de} → ${para}`).toBe(422);
      // A transição era legal: o 422 é sobre conteúdo, não sobre sequência.
      expect(transicaoPermitida(artefato as never, de as never, para as never)).toBe(true);
    }
  });

  it('a recusa do direito do titular cita o artigo, no código e no documento', () => {
    const res = semExigencia('solicitacao', '2026-0731', 'em_analise', 'recusada_com_fundamento');
    expect((res.body as { erro: string }).erro).toContain('Art. 18, §4º');
    expect(tabela).toContain('Art. 18, §4º');
  });

  it('o README enuncia as duas exigências transversais que não são de transição', () => {
    // Gravar antes de aplicar e redigir antes de gravar valem para todas, e por
    // isso não cabem em nenhuma linha da tabela.
    expect(tabela).toContain('grava antes de aplicar');
    expect(tabela).toContain('`503`');
    expect(tabela).toContain('redator');

    // E as duas são comportamento, não promessa.
    const b = new BancoMock('banco');
    b.cenario.riscos[0].status = 'em_tratamento';
    b.simularFalhaDeLog = true;
    const res = request(b, {
      papel: 'dpo', ator: 'teste', metodo: 'POST', caminho: '/v1/estados/risco/R1',
      body: { para: 'aceito', donoDaAceitacao: '@dpo', prazoDeReavaliacao: '90 dias', gatilhoDeReabertura: 'Incidente reabre.' },
    });
    expect(res.status).toBe(503);
    expect(b.cenario.riscos[0].status).toBe('em_tratamento');
  });
});

describe('PR 15 · o ciclo do achado — verificação separada de validação', () => {
  let banco: BancoMock;
  const mover = (id: string, body: Record<string, unknown>, papel: Papel = 'dpo') => request(banco, {
    papel, ator: 'teste', metodo: 'POST', caminho: `/v1/estados/achado/${id}`, body,
  });

  beforeEach(() => {
    limparBancosDaSessao();
    banco = new BancoMock('banco');
  });

  /**
   * O achado deste bloco é o eixo do PR: mesmo estado de partida, mesma
   * sequência legal, e dois desfechos diferentes por causa do **conteúdo**.
   */
  it('executado → encerrado é 409 e verificado → encerrado com eficácia negada é 422', () => {
    const a = banco.cenario.achados.find((x) => x.codigo === 'ACH-2026-014')!;
    expect(a.status).toBe('executado');

    // Sequência errada: a máquina recusa antes de olhar qualquer conteúdo.
    const pulo = mover(a.codigo, { para: 'encerrado' });
    expect(pulo.status).toBe(409);
    expect(pulo.regra).toContain('verificação independente');

    // Sequência certa, conteúdo insuficiente: a rota deixa passar a ordem e
    // recusa a conclusão. Trocar este 422 por 409 mandaria a pessoa refazer o
    // caminho quando o caminho estava certo.
    const negado = banco.cenario.achados.find((x) => x.codigo === 'ACH-2026-002')!;
    expect(negado.status).toBe('verificado');
    expect(negado.eficaciaAtingida).toBe(false);
    const recusa = mover(negado.codigo, { para: 'encerrado' });
    expect(recusa.status).toBe(422);
    expect(recusa.body).toMatchObject({ erro: expect.stringContaining('não foi atingido') });
    expect(negado.status).toBe('verificado');

    // E o mesmo estado, com o veredito oposto, encerra.
    const atingido = banco.cenario.achados.find((x) => x.codigo === 'ACH-2026-003')!;
    expect(mover(atingido.codigo, { para: 'encerrado' }).status).toBe(200);
    expect(atingido.status).toBe('encerrado');
  });

  it('quem executou não verifica — e a rota afere isso contra o artefato', () => {
    const a = banco.cenario.achados.find((x) => x.codigo === 'ACH-2026-014')!;
    expect(a.executadoPor).toBe('@eng-rafael');

    const mesmoNome = mover(a.codigo, {
      para: 'verificado', verificadoPor: '@eng-rafael', eficaciaAtingida: true, evidencia: 'conferido.log',
    });
    expect(mesmoNome.status).toBe(422);
    expect(mesmoNome.body).toMatchObject({ erro: expect.stringContaining('independente') });
    expect(a.status).toBe('executado');

    // A independência é aferida contra o **artefato**, não contra o corpo: quem
    // pediu a transição não consegue mudar o executor no mesmo formulário.
    const mentindo = mover(a.codigo, {
      para: 'verificado', executadoPor: '@outra-pessoa',
      verificadoPor: '@eng-rafael', eficaciaAtingida: true, evidencia: 'conferido.log',
    });
    expect(mentindo.status).toBe(422);
    expect(a.status).toBe('executado');

    expect(mover(a.codigo, {
      para: 'verificado', verificadoPor: '@dpo-marcela', eficaciaAtingida: true, evidencia: 'conferido.log',
    }).status).toBe(200);
    expect(a.verificadoPor).toBe('@dpo-marcela');
  });

  it('verificar exige concluir contra o critério — não basta ter olhado', () => {
    const a = banco.cenario.achados.find((x) => x.codigo === 'ACH-2026-014')!;
    const semVeredito = mover(a.codigo, {
      para: 'verificado', verificadoPor: '@dpo-marcela', evidencia: 'conferido.log',
    });
    expect(semVeredito.status).toBe(422);
    expect(semVeredito.body).toMatchObject({ erro: expect.stringContaining('sim ou não') });

    // "sim" em texto não é veredito: booleano ausente cai na mesma recusa, e
    // não em `Boolean('nao') === true`, que é o defeito silencioso da coerção.
    expect(mover(a.codigo, {
      para: 'verificado', verificadoPor: '@dpo-marcela', eficaciaAtingida: 'nao', evidencia: 'x.log',
    }).status).toBe(422);
    expect(a.status).toBe('executado');
  });

  it('o critério de eficácia é exigido no plano, antes de existir resultado', () => {
    const a = banco.cenario.achados.find((x) => x.codigo === 'ACH-2026-007')!;
    expect(mover(a.codigo, {
      para: 'causa_raiz', causaRaiz: 'O redator não era aplicado na rota de cobrança e o log saía cru.',
    }).status).toBe(200);

    const semCriterio = mover(a.codigo, {
      para: 'plano', plano: 'Passar toda escrita de log pelo redator e barrar no gate de CI.',
    });
    expect(semCriterio.status).toBe(422);
    expect(semCriterio.body).toMatchObject({ erro: expect.stringContaining('critério de eficácia') });
    expect(a.status).toBe('causa_raiz');
    expect(a.plano).toBeUndefined();

    expect(mover(a.codigo, {
      para: 'plano', plano: 'Passar toda escrita de log pelo redator e barrar no gate de CI.',
      criterioDeEficacia: 'Trinta dias de log sem nenhuma ocorrência de CPF, conferidos pelo gate.',
    }).status).toBe(200);
    expect(a.criterioDeEficacia).toContain('Trinta dias');
  });

  it('executar exige executor declarado e evidência — relato não fecha achado', () => {
    const a = banco.cenario.achados.find((x) => x.codigo === 'ACH-2026-011')!;
    expect(a.status).toBe('plano');

    expect(mover(a.codigo, { para: 'executado', evidencia: 'expurgo.log' }).status).toBe(422);
    const semProva = mover(a.codigo, { para: 'executado', executadoPor: '@eng-rafael' });
    expect(semProva.status).toBe(422);
    expect(semProva.body).toMatchObject({ erro: expect.stringContaining('evidência') });
    expect(a.status).toBe('plano');

    expect(mover(a.codigo, {
      para: 'executado', executadoPor: '@eng-rafael', evidencia: 'expurgo-180d.log',
    }).status).toBe(200);
  });

  it('reabrir exige motivo, eleva criticidade e não herda a análise que falhou', () => {
    const a = banco.cenario.achados.find((x) => x.codigo === 'ACH-2026-002')!;
    expect(mover(a.codigo, { para: 'reaberto', motivo: 'curto' }).status).toBe(422);
    expect(a.status).toBe('verificado');

    const antes = { criticidade: a.criticidade, reincidencias: a.reincidencias };
    expect(mover(a.codigo, {
      para: 'reaberto',
      motivo: 'O checkout web seguiu sem versão registrada e é por onde entra a maior parte dos aceites.',
    }).status).toBe(200);

    expect(a.status).toBe('reaberto');
    expect(a.reincidencias).toBe(antes.reincidencias + 1);
    expect(a.criticidade).toBe('critica');
    expect(antes.criticidade).toBe('critica');

    // A análise anterior **não** volta preenchida: reincidência que recomeça do
    // plano antigo refaz exatamente o que já falhou uma vez.
    expect(a.causaRaiz).toBeUndefined();
    expect(a.plano).toBeUndefined();
    expect(a.criterioDeEficacia).toBeUndefined();
    expect(a.eficaciaAtingida).toBeUndefined();
    expect(a.verificadoPor).toBeUndefined();
    // As evidências ficam: elas são prova do que houve, não rascunho.
    expect(a.evidencias.length).toBe(2);
    expect(a.motivoDaReabertura).toContain('checkout web');

    // E a causa raiz nova é cobrada com mensagem própria da reincidência.
    const generico = mover(a.codigo, { para: 'causa_raiz', causaRaiz: 'idem' });
    expect(generico.status).toBe(422);
    expect(generico.body).toMatchObject({ erro: expect.stringContaining('Reincidência') });
  });

  it('a evidência entra no trail antes de ser anexada — falha de log não deixa anexo órfão', () => {
    const a = banco.cenario.achados.find((x) => x.codigo === 'ACH-2026-011')!;
    banco.simularFalhaDeLog = true;
    const res = mover(a.codigo, {
      para: 'executado', executadoPor: '@eng-rafael', evidencia: 'expurgo-180d.log',
    });
    expect(res.status).toBe(503);
    expect(a.status).toBe('plano');
    expect(a.evidencias).toHaveLength(0);
    expect(a.executadoPor).toBeUndefined();

    banco.simularFalhaDeLog = false;
    expect(mover(a.codigo, {
      para: 'executado', executadoPor: '@eng-rafael', evidencia: 'expurgo-180d.log',
    }).status).toBe(200);

    const prova = a.evidencias.at(-1)!;
    const linha = banco.auditoria.filter((l) => l.recursoId === a.codigo).at(-1)!;
    expect(linha.campos).toContain(`evidencia:${prova.hash}`);
    expect(linha.campos).toContain('plano→executado');
  });

  it('a cadeia de custódia encadeia, e a semente confere pela mesma função', () => {
    const a = banco.cenario.achados.find((x) => x.codigo === 'ACH-2026-002')!;
    expect(a.evidencias).toHaveLength(2);
    expect(a.evidencias[0].hashAnterior).toBeNull();
    expect(a.evidencias[1].hashAnterior).toBe(a.evidencias[0].hash);
    // Etapas distintas: prova de execução não é prova de eficácia.
    expect(a.evidencias.map((e) => e.etapa)).toEqual(['executado', 'verificado']);

    // A massa de demonstração é conferida pela regra do produto, e não por
    // números digitados ao lado dela.
    for (const c of Object.values(CENARIOS)) {
      for (const achado of c.achados) {
        let anterior: string | null = null;
        for (const e of achado.evidencias) {
          expect(e.hashAnterior, `${c.id}/${achado.codigo}`).toBe(anterior);
          expect(e.hash, `${c.id}/${achado.codigo}/${e.arquivo}`)
            .toBe(hashEncadeado(anterior, e.arquivo, e.etapa));
          anterior = e.hash;
        }
      }
    }
  });

  it('a evidência só entra nas duas etapas que produzem prova', () => {
    const a = banco.cenario.achados.find((x) => x.codigo === 'ACH-2026-007')!;
    expect(mover(a.codigo, {
      para: 'causa_raiz',
      causaRaiz: 'O redator não era aplicado na rota de cobrança e o log saía cru.',
      evidencia: 'tentativa-de-anexo.pdf',
    }).status).toBe(200);
    // Cadeia que aceita anexo em qualquer passo é depósito, não cadeia.
    expect(a.evidencias).toHaveLength(0);
  });
});

describe('PR 15 · T11 na tela — a fila chega em algum lugar que opera', () => {
  const montar = (papel: Papel, ajustar: (b: BancoMock) => void = () => {}) => {
    limparBancosDaSessao();
    const b = new BancoMock('banco');
    ajustar(b);
    useSessao.setState({ papel, banco: b, versao: 0, avisos: [], recusas: {} });
    return b;
  };

  it('a tela de destino opera a ação da regra — e não só existe', () => {
    /**
     * O PR 9 já conferia que a tela existe em `TELAS`, e por isso o defeito
     * passou: o achado apontava para a T6, que existe, mostra trail e expurgo e
     * **não tem nenhum controle de `gerenciar_achado`**. Item de fila que chega
     * numa tela sem o ato é fila que não fecha nada.
     *
     * A conferência é sobre a fonte da tela: a ação da regra tem de aparecer
     * nela, que é onde `Permitido` a consome.
     */
    for (const r of REGRAS) {
      const tela = TELAS.find((t) => t.rota === r.tela)!;
      const fonte = readFileSync(`src/screens/${tela.id}.tsx`, 'utf8');
      expect(fonte, `${r.tela} (${tela.nome}) não opera "${r.acao}", pedida por ${r.artefato} ${r.estado}`)
        .toContain(r.acao);
    }
    expect(REGRAS.filter((r) => r.artefato === 'achado').map((r) => r.tela))
      .toEqual(Array(6).fill('/t11'));
  });

  it('a faixa de passos é derivada da máquina, e nenhum estado fica de fora', () => {
    const trilha = trilhaDoAchado();
    expect(trilha).toEqual(['aberto', 'causa_raiz', 'plano', 'executado', 'verificado', 'encerrado']);
    // Cada passo da trilha é aresta legal — a faixa não desenha caminho que a
    // rota recusaria.
    trilha.slice(1).forEach((e, i) => {
      expect(proximosDe('achado', trilha[i]), `${trilha[i]}→${e}`).toContain(e);
    });
    // E a trilha mais os desvios cobrem a máquina inteira: estado novo em
    // `estados.ts` que ninguém pôs na tela vira falha, não omissão.
    expect([...trilha, ...DESVIOS].sort()).toEqual([...estadosDe('achado')].sort());
    expect(DESVIOS).toEqual(['reaberto']);
  });

  it('a tela não avança estado por conta própria — só existe a rota genérica', () => {
    const fonte = readFileSync('src/screens/T11.tsx', 'utf8');
    const caminhos = [...fonte.matchAll(/caminho: `([^`]+)`/g)].map((m) => m[1]);
    expect(caminhos).toEqual(['/v1/estados/achado/${achado.codigo}']);
    // Nenhuma atribuição de estado na tela: quem move o artefato é a rota.
    expect(fonte).not.toMatch(/\.status\s*=[^=]/);
    expect(fonte).not.toMatch(/MAQUINAS|transicaoPermitida/);
  });

  it('sem gerenciar_achado a tela é leitura — ausência, não controle desligado', () => {
    for (const papel of ['produto', 'seguranca', 'auditor'] as Papel[]) {
      cleanup();
      montar(papel);
      render(<MemoryRouter><T11 /></MemoryRouter>);
      for (const rotulo of [/Registrar causa raiz/, /Propor plano/, /Registrar execução/,
        /Registrar verificação/, /Encerrar achado/, /Reabrir achado/]) {
        expect(screen.queryByRole('button', { name: rotulo }), `${papel}: ${rotulo}`)
          .not.toBeInTheDocument();
      }
      // E não é `disabled` escondendo permissão: não há controle desligado na
      // região do ciclo.
      const cartao = screen.getByText('Próxima ação').nextElementSibling as HTMLElement;
      expect(cartao.className, `${papel}: âncora da seção`).toContain('card');
      expect(cartao.querySelectorAll('button, input, textarea, select')).toHaveLength(0);
      // A leitura permanece: o auditor perde o ato, não a informação.
      expect(within(cartao).getByText(/a tela é leitura/)).toBeInTheDocument();
    }
    cleanup();

    montar('engenharia');
    render(<MemoryRouter><T11 /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /Registrar causa raiz/ })).toBeInTheDocument();
  });

  it('em executado não existe "encerrar", e a tela diz que é 409 e por quê', () => {
    montar('dpo', (b) => { b.cenario.achados = [b.cenario.achados.find((a) => a.status === 'executado')!]; });
    render(<MemoryRouter><T11 /></MemoryRouter>);

    expect(screen.queryByRole('button', { name: /Encerrar achado/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Registrar verificação/ })).toBeInTheDocument();
    expect(screen.getByText(/executado → encerrado/)).toBeInTheDocument();
    expect(screen.getByText(/409/)).toBeInTheDocument();
  });

  it('em verificado, o veredito decide se "encerrar" existe — e o texto explica a diferença', () => {
    montar('dpo', (b) => { b.cenario.achados = [b.cenario.achados.find((a) => a.codigo === 'ACH-2026-002')!]; });
    render(<MemoryRouter><T11 /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /Encerrar achado/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reabrir achado/ })).toBeInTheDocument();
    expect(screen.getByText(/422/)).toBeInTheDocument();
    cleanup();

    montar('dpo', (b) => { b.cenario.achados = [b.cenario.achados.find((a) => a.codigo === 'ACH-2026-003')!]; });
    render(<MemoryRouter><T11 /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /Encerrar achado/ })).toBeInTheDocument();
  });

  it('o clique passa pela rota: log caindo, a tela não muda o estado', () => {
    const b = montar('engenharia', (x) => {
      x.cenario.achados = [x.cenario.achados.find((a) => a.status === 'aberto')!];
    });
    render(<MemoryRouter><T11 /></MemoryRouter>);

    const causa = screen.getByLabelText(/Causa raiz/);
    fireEvent.change(causa, { target: { value: 'O redator não era aplicado na rota de cobrança e o log saía cru.' } });
    b.simularFalhaDeLog = true;
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Registrar causa raiz/ })); });

    expect(screen.getByRole('alert').textContent).toMatch(/registr/i);
    expect(b.cenario.achados[0].status).toBe('aberto');
    expect(screen.getByRole('button', { name: /Registrar causa raiz/ })).toBeInTheDocument();

    b.simularFalhaDeLog = false;
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Registrar causa raiz/ })); });
    expect(b.cenario.achados[0].status).toBe('causa_raiz');
    expect(screen.getByRole('button', { name: /Propor plano/ })).toBeInTheDocument();
  });

  it('a cadeia de custódia mostra o encadeamento e marca o que está no trail', () => {
    montar('auditor', (b) => { b.cenario.achados = [b.cenario.achados.find((a) => a.codigo === 'ACH-2026-002')!]; });
    render(<MemoryRouter><T11 /></MemoryRouter>);

    expect(screen.getByText('consent-versao-migracao.sql')).toBeInTheDocument();
    expect(screen.getByText('primeira da cadeia')).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });
});

describe('PR 15 · validação — o §1 do MAPA descreve telas que existem?', () => {
  /**
   * A varredura do #17 é **verificação**: confere que o documento não reenuncia
   * o que o código já diz. Ela não olha para o §1, e por isso o §1 podia
   * envelhecer sozinho — foi assim que "estado do achado" ficou na coluna "o
   * que falta" depois de o achado ganhar máquina.
   *
   * Este teste é a outra metade: **validação**. A tabela nomeia telas; as telas
   * têm de existir, e com o mesmo número e o mesmo nome.
   */
  const mapa = readFileSync(join('..', 'docs', 'design_handoff_lastro_correcoes', 'MAPA-PROCESSOS.md'), 'utf8');
  const secao1 = mapa.slice(mapa.indexOf('## 1 ·'), mapa.indexOf('## 2 ·'));
  const linhasDeTela = secao1.split('\n').filter((l: string) => /\*\*T\d+ · /.test(l));

  it('toda tela nomeada na tabela existe, com o número e o nome do código', () => {
    expect(linhasDeTela.length, 'nenhuma linha de tela extraída').toBeGreaterThanOrEqual(4);
    for (const linha of linhasDeTela) {
      const [, id, nome] = linha.match(/\*\*(T\d+) · ([^*(]+)/)!;
      const tela = TELAS.find((t) => t.id === id);
      if (id === 'T12') {
        // A exceção é declarada na própria linha, e o teste cobra as duas
        // pontas: fora de `TELAS` no código, e dito na tabela.
        expect(tela, 'T12 entrou em TELAS — a linha do §1 diz que ela fica fora').toBeUndefined();
        expect(linha).toContain('fora');
        continue;
      }
      expect(tela, `o §1 nomeia ${id} e o código não tem essa tela`).toBeDefined();
      expect(tela!.nome, `${id}: nome divergente`).toBe(nome.trim().replace(/ de ação$/, ''));
    }
  });

  it('a contagem em prosa é a do trilho, não um número escrito à mão', () => {
    // Onze virou doze quando a T11 entrou. Sem isto, a frase envelhece calada —
    // e é a primeira coisa que alguém lê para saber o tamanho do produto.
    const porExtenso: Record<number, string> = {
      10: 'dez', 11: 'onze', 12: 'doze', 13: 'treze', 14: 'catorze',
    };
    expect(secao1, `o trilho tem ${TELAS.length} telas`)
      .toContain(`cinco fluxos com **${porExtenso[TELAS.length]}** no trilho`);
  });

  it('a coluna "o que falta" do PR-05 fechou, porque o achado ganhou tela', () => {
    const pr05 = secao1.split('\n').find((l: string) => l.includes('**PR-05**'))!;
    expect(pr05).toContain('T11');
    // A pendência que sobrava era esta, e ela é este PR.
    expect(pr05).not.toContain('estado do achado');
    expect(pr05.split('|').at(-2)!.trim()).toBe('—');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PR 16 · o portal do titular (Risco-001, P0)
//
// A ordem dos blocos é a da recomendação: primeiro os dois invariantes que
// sustentam tudo — o nível derivado no servidor e o 401 que não é oráculo —,
// depois as rotas. Invariante escrito depois da rota é invariante que descreve
// o que a rota faz; escrito antes, é invariante que decide o que ela pode fazer.
// ─────────────────────────────────────────────────────────────────────────────

/** Abre e confirma uma verificação, devolvendo o token de sessão do portal. */
function sessaoDoPortal(
  b: BancoMock, direito: Direito, indiceDoTitular = 0,
  ajuste: { codigoErrado?: boolean; semDocumento?: boolean; identificadorHash?: string } = {},
) {
  const titular = b.cenario.titulares[indiceDoTitular];
  const abertura = requestPortal<{ id: string; nivel_exigido: number }>(b, {
    metodo: 'POST',
    caminho: '/v1/me/verificacao',
    body: {
      direito,
      canal: 'email',
      identificador_hash: ajuste.identificadorHash ?? sha256(titular.segredos.email),
    },
  });
  const nivel = nivelExigido(direito);
  const fatores: Record<string, unknown> = {
    codigo: ajuste.codigoErrado ? '000000' : b.codigoDaVerificacao(abertura.body.id),
  };
  if (nivel === 2) fatores.dado_cadastro_hash = titular.cpfHash;
  if (nivel === 3 && !ajuste.semDocumento) fatores.documento_hash = sha256('documento-com-foto');
  const confirmacao = requestPortal<{ sessao: string; nivel_atingido: number }>(b, {
    metodo: 'POST',
    caminho: `/v1/me/verificacao/${abertura.body.id}/codigo`,
    body: fatores,
  });
  return { abertura, confirmacao, titular, token: confirmacao.body?.sessao };
}

describe('PR 16 · invariante — o nível de verificação é derivado do direito, no servidor', () => {
  it('a tabela declara os dez direitos, e só ela decide o nível', () => {
    expect(DIREITOS).toHaveLength(10);
    for (const d of DIREITOS) {
      expect(REGIME[d].nivel, `${d} sem nível declarado`).toBeGreaterThanOrEqual(1);
      expect(REGIME[d].nivel).toBeLessThanOrEqual(3);
    }
    // A escada da tela 02, item a item. Rebaixar qualquer um destes é editar
    // esta linha — que é onde o teste olha.
    expect(DIREITOS.filter((d) => REGIME[d].nivel === 3).sort())
      .toEqual(['anonimizacao', 'eliminacao', 'portabilidade']);
    expect(DIREITOS.filter((d) => REGIME[d].nivel === 1).sort())
      .toEqual(['compartilhamentos', 'confirmacao']);
  });

  it('pedir eliminação com nivel_verificacao 1 no corpo não reduz a exigência', () => {
    const abertura = requestPortal<{ id: string; nivel_exigido: number }>(banco, {
      metodo: 'POST',
      caminho: '/v1/me/verificacao',
      body: {
        direito: 'eliminacao',
        canal: 'email',
        identificador_hash: sha256(banco.cenario.titulares[0].segredos.email),
        // O parâmetro do cliente. Se fosse lido, a escada inteira seria sugestão.
        nivel_verificacao: 1,
      },
    });
    expect(abertura.status).toBe(201);
    expect(abertura.body.nivel_exigido).toBe(3);
  });

  it('sessão de nível 2 não abre solicitação de direito de nível 3', () => {
    // A sessão é do direito que a pediu: uma verificação de "acesso" (nível 2)
    // não vira crédito para eliminar.
    const { token } = sessaoDoPortal(banco, 'acesso');
    const res = requestPortal(banco, {
      metodo: 'POST', caminho: '/v1/requests', sessao: token,
      body: { direito: 'eliminacao', nivel_verificacao: 1 },
    });
    expect(res.status).toBe(403);
    expect(banco.cenario.solicitacoes.some((s) => s.direito === 'eliminacao' && s.origem === 'portal')).toBe(false);
  });

  it('a solicitação criada grava o nível derivado, e não o que veio no corpo', () => {
    const { token } = sessaoDoPortal(banco, 'eliminacao', 0);
    const res = requestPortal<{ protocolo: string; nivel_verificacao: number }>(banco, {
      metodo: 'POST', caminho: '/v1/requests', sessao: token,
      body: { direito: 'eliminacao', nivel_verificacao: 1 },
    });
    expect(res.status).toBe(201);
    expect(res.body.nivel_verificacao).toBe(3);
    const gravada = banco.cenario.solicitacoes.find((s) => s.protocolo === res.body.protocolo)!;
    expect(gravada.nivelVerificacao).toBe(3);
  });

  it('confirmar eliminação sem o documento não confirma a sessão', () => {
    const { confirmacao } = sessaoDoPortal(banco, 'eliminacao', 0, { semDocumento: true });
    expect(confirmacao.status).toBe(422);
    expect(confirmacao.body).not.toHaveProperty('sessao');
  });
});

describe('PR 16 · invariante — o 401 não diz se o cadastro existe', () => {
  const semCadastro = () => sha256('ninguem-com-esse-email@exemplo.com');

  it('código inválido responde igual para e-mail cadastrado e não cadastrado', () => {
    const cadastrado = sessaoDoPortal(banco, 'acesso', 0, { codigoErrado: true }).confirmacao;
    const inexistente = sessaoDoPortal(banco, 'acesso', 0, {
      codigoErrado: true, identificadorHash: semCadastro(),
    }).confirmacao;
    expect(cadastrado.status).toBe(401);
    expect(inexistente).toEqual(cadastrado);
  });

  it('nem o código certo confirma um e-mail que não está cadastrado — e a recusa é a mesma', () => {
    // O caso mais afiado: se a recusa por "código certo, cadastro inexistente"
    // fosse diferente da recusa por "código errado", o par de respostas viraria
    // um oráculo de cadastro operável em lote.
    const errado = sessaoDoPortal(banco, 'acesso', 0, { codigoErrado: true }).confirmacao;
    const certoSemCadastro = sessaoDoPortal(banco, 'acesso', 0, {
      identificadorHash: semCadastro(),
    }).confirmacao;
    expect(certoSemCadastro.status).toBe(401);
    expect(certoSemCadastro).toEqual(errado);
  });

  it('abrir a verificação responde 201 igual para os dois, e nunca devolve o código', () => {
    const corpo = (hash: string) => requestPortal<Record<string, unknown>>(banco, {
      metodo: 'POST',
      caminho: '/v1/me/verificacao',
      body: { direito: 'acesso', canal: 'email', identificador_hash: hash },
    });
    const a = corpo(sha256(banco.cenario.titulares[0].segredos.email));
    const b = corpo(semCadastro());
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    // O `id` é diferente por construção; todo o resto tem de ser igual.
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
    const { id: _a, expira_em: _ea, ...restoA } = a.body as Record<string, unknown>;
    const { id: _b, expira_em: _eb, ...restoB } = b.body as Record<string, unknown>;
    expect(restoA).toEqual(restoB);
    expect(JSON.stringify(a.body)).not.toContain(banco.codigoDaVerificacao(String(a.body.id)));
  });

  it('nenhum campo do titular sai antes da confirmação', () => {
    const protocolo = banco.cenario.solicitacoes[0].protocolo;
    const semSessao = requestPortal<Record<string, unknown>>(banco, {
      metodo: 'GET', caminho: `/v1/requests/${protocolo}`,
    });
    expect(semSessao.status).toBe(401);
    const corpo = JSON.stringify(semSessao.body);
    const titular = banco.cenario.titulares[0];
    for (const segredo of Object.values(titular.segredos)) {
      expect(corpo).not.toContain(segredo);
    }
    expect(Object.keys(semSessao.body)).toEqual(['erro']);
  });
});

describe('PR 16 · as doze rotas — verificação: existem e respondem o contrato?', () => {
  it('as doze do portal estão declaradas no contrato e têm política própria', () => {
    const portal = OPERACOES.filter((o) => o.superficie === 'portal');
    expect(portal).toHaveLength(12);
    for (const op of portal) {
      const caminho = op.contrato.replace(/\{[^}]+\}/g, 'x').replace(/^\//, '');
      const politica = POLITICAS.find((p) => p.superficie === 'portal'
        && p.metodo === op.metodo && p.caminho.test(caminho));
      expect(politica, `${op.metodo} ${op.contrato} sem política declarada em politicas.ts`).toBeTruthy();
    }
  });

  it('cada uma responde algo que não é o 404 terminal do dispatcher', () => {
    // Verificação, não validação: a pergunta é se a rota existe, não se o
    // titular consegue exercer o direito por ela.
    const { token } = sessaoDoPortal(banco, 'revogacao');
    const chamadas: [ 'GET' | 'POST', string ][] = [
      ['GET', '/v1/me/direitos'],
      ['POST', '/v1/me/verificacao'],
      ['POST', '/v1/me/verificacao/xx/codigo'],
      ['POST', '/v1/requests'],
      ['GET', '/v1/requests/xx'],
      ['POST', '/v1/requests/xx/mensagens'],
      ['GET', '/v1/requests/xx/pacote'],
      ['GET', '/v1/me/consentimentos'],
      ['POST', '/v1/me/consentimentos/xx/revogacao'],
      ['GET', '/v1/me/consentimentos/xx/propagacao'],
      ['GET', '/v1/me/decisoes/xx'],
      ['POST', '/v1/me/decisoes/xx/revisao'],
    ];
    expect(chamadas).toHaveLength(12);
    for (const [metodo, caminho] of chamadas) {
      const res = requestPortal<{ erro?: string }>(banco, { metodo, caminho, sessao: token, body: {} });
      expect(String(res.body?.erro ?? ''), `${metodo} ${caminho} caiu no 404 terminal`)
        .not.toContain('Rota não encontrada');
    }
  });

  it('GET /me/direitos devolve os dez, com nível e prazo, e nenhum dado de titular', () => {
    const res = requestPortal<{ direitos: any[] }>(banco, { metodo: 'GET', caminho: '/v1/me/direitos' });
    expect(res.status).toBe(200);
    expect(res.body.direitos).toHaveLength(10);
    expect(res.body.direitos.find((d) => d.direito === 'eliminacao').nivel).toBe(3);
    expect(res.body.direitos.find((d) => d.direito === 'revisao_decisao').prazo_dias).toBe(5);
    const corpo = JSON.stringify(res.body);
    for (const t of banco.cenario.titulares) {
      for (const segredo of Object.values(t.segredos)) expect(corpo).not.toContain(segredo);
    }
  });
});

describe('PR 16 · POST /requests — prazo derivado do direito, gravado antes da resposta', () => {
  const DIA = 24 * 60 * 60 * 1000;

  it('calcula 15 dias para o acesso e 5 para a revisão do Art. 20', () => {
    const antes = Date.now();
    const acesso = requestPortal<{ prazo_limite: string; prazo_dias: number }>(banco, {
      metodo: 'POST', caminho: '/v1/requests', sessao: sessaoDoPortal(banco, 'acesso').token,
      body: { direito: 'acesso' },
    });
    expect(acesso.status).toBe(201);
    expect(acesso.body.prazo_dias).toBe(15);
    expect(Date.parse(acesso.body.prazo_limite) - antes).toBeGreaterThanOrEqual(15 * DIA - 5000);
    expect(Date.parse(acesso.body.prazo_limite) - antes).toBeLessThan(15 * DIA + 5000);

    const decisao = banco.cenario.titulares[0].decisao!;
    const revisao = requestPortal<{ prazo_limite: string; prazo_dias: number }>(banco, {
      metodo: 'POST', caminho: `/v1/me/decisoes/${decisao.id}/revisao`,
      sessao: sessaoDoPortal(banco, 'revisao_decisao').token,
      body: { fundamento: 'Não reconheço a recusa; meu emprego é estável há sete anos.' },
    });
    expect(revisao.status).toBe(201);
    expect(revisao.body.prazo_dias).toBe(5);
    expect(Date.parse(revisao.body.prazo_limite) - antes).toBeLessThan(5 * DIA + 5000);
  });

  it('o prazo está gravado na solicitação antes de a resposta sair', () => {
    const res = requestPortal<{ protocolo: string; prazo_limite: string }>(banco, {
      metodo: 'POST', caminho: '/v1/requests', sessao: sessaoDoPortal(banco, 'acesso').token,
      body: { direito: 'acesso' },
    });
    const gravada = banco.cenario.solicitacoes.find((s) => s.protocolo === res.body.protocolo)!;
    expect(new Date(gravada.prazoLimiteMs).toISOString()).toBe(res.body.prazo_limite);
    // E a linha do trail saiu antes: ela já carrega o prazo.
    const linha = banco.auditoria.find((l) => l.acao === 'SOLICITACAO_ABERTA' && l.protocolo === res.body.protocolo)!;
    expect(linha.campos.some((c) => c.startsWith('prazo_limite='))).toBe(true);
  });

  it('o pedido não exige justificativa, e o texto livre passa pelo redator', () => {
    const semTexto = requestPortal(banco, {
      metodo: 'POST', caminho: '/v1/requests', sessao: sessaoDoPortal(banco, 'acesso').token,
      body: { direito: 'acesso' },
    });
    expect(semTexto.status).toBe(201);

    const comCpf = requestPortal<{ protocolo: string }>(banco, {
      metodo: 'POST', caminho: '/v1/requests', sessao: sessaoDoPortal(banco, 'acesso', 1).token,
      body: { direito: 'acesso', texto: 'Meu CPF é 529.982.247-25, confiram por favor.' },
    });
    expect(comCpf.status).toBe(201);
    const gravada = banco.cenario.solicitacoes.find((s) => s.protocolo === comCpf.body.protocolo)!;
    expect(gravada.detalhe).toContain('[CPF removido]');
    expect(gravada.detalhe).not.toContain('529.982.247-25');
    const linha = banco.auditoria.find((l) => l.protocolo === comCpf.body.protocolo)!;
    expect(linha.justificativa).not.toContain('529.982.247-25');
  });

  it('falha de log ao abrir derruba a solicitação inteira: 503 e nenhum protocolo criado', () => {
    const token = sessaoDoPortal(banco, 'acesso').token;
    const antes = banco.cenario.solicitacoes.length;
    banco.simularFalhaDeLog = true;
    const res = requestPortal<{ erro: string }>(banco, {
      metodo: 'POST', caminho: '/v1/requests', sessao: token, body: { direito: 'acesso' },
    });
    expect(res.status).toBe(503);
    expect(banco.cenario.solicitacoes).toHaveLength(antes);
    expect(banco.cenario.solicitacoes.some((s) => s.origem === 'portal')).toBe(false);
  });
});

describe('PR 16 · atendimento parcial — retidos[] com base legal e data, item a item', () => {
  const emAnalise = () => banco.cenario.solicitacoes.find((s) => s.status === 'em_analise')!;

  it('parcial sem retidos[] é recusado com 422', () => {
    const res = chamar('dpo', {
      metodo: 'POST', caminho: `/v1/requests/${emAnalise().id}/concluir`,
      body: { desfecho: 'atendido_parcialmente', evidencia: 'Parte dos dados fica retida por lei.' },
    });
    expect(res.status).toBe(422);
  });

  it('retido sem base legal, ou sem data, também é 422', () => {
    const semBase = chamar('dpo', {
      metodo: 'POST', caminho: `/v1/requests/${emAnalise().id}/concluir`,
      body: {
        desfecho: 'atendido_parcialmente', evidencia: 'Parte dos dados fica retida por lei.',
        retidos: [{ item: 'Notas fiscais', retencao_ate: '2031-07-29' }],
      },
    });
    expect(semBase.status).toBe(422);

    const semData = chamar('dpo', {
      metodo: 'POST', caminho: `/v1/requests/${emAnalise().id}/concluir`,
      body: {
        desfecho: 'atendido_parcialmente', evidencia: 'Parte dos dados fica retida por lei.',
        retidos: [{ item: 'Notas fiscais', base_legal: 'obrigacao_legal' }],
      },
    });
    expect(semData.status).toBe(422);
    expect(String(semData.body && (semData.body as any).erro)).toContain('data de eliminação');
  });

  it('concluído em parte, o titular vê o que foi apagado e o que ficou — com a lei e a data', () => {
    const alvo = banco.cenario.solicitacoes.find(
      (s) => s.status === 'em_analise' && s.titularId === banco.cenario.titulares[0].id,
    )!;
    const conclusao = chamar('dpo', {
      metodo: 'POST', caminho: `/v1/requests/${alvo.id}/concluir`,
      body: {
        desfecho: 'atendido_parcialmente',
        evidencia: 'Cadastro apagado; notas fiscais retidas por obrigação fiscal.',
        apagados: ['Perfil de navegação', 'Telefone de contato'],
        retidos: [{
          item: 'Notas fiscais das suas compras', base_legal: 'obrigacao_legal',
          artigo: 'Art. 16, I', retencao_ate: '2031-07-29',
          motivo: 'A legislação fiscal obriga a guardar a nota por cinco anos.',
        }],
      },
    });
    expect(conclusao.status).toBe(200);

    const { token } = sessaoDoPortal(banco, alvo.direito, 0);
    const vista = requestPortal<any>(banco, {
      metodo: 'GET', caminho: `/v1/requests/${alvo.protocolo}`, sessao: token,
    });
    expect(vista.status).toBe(200);
    expect(vista.body.apagados).toHaveLength(2);
    expect(vista.body.retidos).toEqual([expect.objectContaining({
      item: 'Notas fiscais das suas compras',
      base_legal: 'obrigacao_legal',
      retencao_ate: '2031-07-29',
    })]);
    // Recusa e retenção nunca aparecem sem o caminho da autoridade ao lado.
    expect(vista.body.caminho_da_anpd).toContain('ANPD');
  });
});

describe('PR 16 · revogação — cascata registrada, propagação consultável, alerta de 24 h', () => {
  let varejo: BancoMock;
  /** Beatriz tem telefone sob consentimento (v-tel), que não é sensível e é revelável. */
  const TITULAR = 2;
  const CAMPO = 'v-tel';

  const revogar = () => {
    const { token } = sessaoDoPortal(varejo, 'revogacao', TITULAR);
    return requestPortal<any>(varejo, {
      metodo: 'POST', caminho: `/v1/me/consentimentos/${CAMPO}/revogacao`, sessao: token,
    });
  };

  beforeEach(() => { varejo = new BancoMock('varejo'); });

  it('a cascata cobre os três sistemas: quem trata, quem recebeu e o que já foi coletado', () => {
    const res = revogar();
    expect(res.status).toBe(200);
    expect(res.body.cascata).toHaveLength(3);
    expect(res.body.cascata.map((c: any) => c.tipo).sort())
      .toEqual(['cessacao', 'expurgo', 'notificacao']);
    expect(res.body.cascata.find((c: any) => c.tipo === 'notificacao').alvo).toBe('Zenvia');
    // O expurgo nasce pendente: o executor é externo (Risco-006), e fingir que
    // concluiu seria a promessa sem instrumento que a auditoria enumerou.
    expect(res.body.cascata.find((c: any) => c.tipo === 'expurgo').estado).toBe('pendente');
    expect(varejo.auditoria.some((l) => l.acao === 'CONSENTIMENTO_REVOGADO')).toBe(true);
  });

  it('o tratamento a jusante é bloqueado com 422 — para quem revogou, e só para ele', () => {
    revogar();
    const revelar = (indice: number) => chamar('dpo', {
      metodo: 'POST', caminho: '/v1/pseudonyms/resolve', purpose: 'atendimento',
      body: {
        titularId: varejo.cenario.titulares[indice].id,
        campo: 'telefone',
        justificativa: 'Confirmação de contato para o atendimento do protocolo em curso.',
        protocolo: varejo.cenario.solicitacoes.find((s) => s.titularId === varejo.cenario.titulares[indice].id)?.protocolo,
      },
    });
    // O banco do `chamar` é o `banco` do beforeEach global; aqui a chamada
    // precisa ir ao cenário de varejo.
    const bloqueado = request(varejo, {
      papel: 'dpo', ator: 'teste', metodo: 'POST', caminho: '/v1/pseudonyms/resolve',
      purpose: 'atendimento',
      body: {
        titularId: varejo.cenario.titulares[TITULAR].id, campo: 'telefone',
        justificativa: 'Confirmação de contato para o atendimento do protocolo em curso.',
        protocolo: varejo.cenario.solicitacoes.find((s) => s.titularId === varejo.cenario.titulares[TITULAR].id)!.protocolo,
      },
    });
    expect(bloqueado.status).toBe(422);
    expect(String((bloqueado.body as any).erro)).toContain('retirou a autorização');
    void revelar;

    // Marina (t1) também tem v-tel e não revogou: a base legal dela continua de pé.
    const outra = request(varejo, {
      papel: 'dpo', ator: 'teste', metodo: 'POST', caminho: '/v1/pseudonyms/resolve',
      purpose: 'atendimento',
      body: {
        titularId: varejo.cenario.titulares[0].id, campo: 'telefone',
        justificativa: 'Confirmação de contato para o atendimento do protocolo em curso.',
        protocolo: varejo.cenario.solicitacoes.find((s) => s.titularId === varejo.cenario.titulares[0].id)!.protocolo,
      },
    });
    expect(outra.status).toBe(200);
  });

  it('a propagação é consultável, e revogar duas vezes é 409', () => {
    revogar();
    const { token } = sessaoDoPortal(varejo, 'revogacao', TITULAR);
    const p = requestPortal<any>(varejo, {
      metodo: 'GET', caminho: `/v1/me/consentimentos/${CAMPO}/propagacao`, sessao: token,
    });
    expect(p.status).toBe(200);
    expect(p.body.itens).toHaveLength(3);
    expect(p.body.pendentes).toBe(1);
    expect(p.body.alerta).toBe(false);

    const denovo = requestPortal(varejo, {
      metodo: 'POST', caminho: `/v1/me/consentimentos/${CAMPO}/revogacao`, sessao: token,
    });
    expect(denovo.status).toBe(409);
  });

  it('pendência acima de 24 h levanta alerta — e o alerta é visível ao titular', () => {
    revogar();
    const pendente = varejo.revogacoesTitular[0].cascata.find((c) => c.estado === 'pendente')!;
    pendente.iniciadaEmMs -= 25 * 60 * 60 * 1000;

    const { token } = sessaoDoPortal(varejo, 'revogacao', TITULAR);
    const p = requestPortal<any>(varejo, {
      metodo: 'GET', caminho: `/v1/me/consentimentos/${CAMPO}/propagacao`, sessao: token,
    });
    expect(p.body.alerta).toBe(true);
    expect(p.body.alerta_desde).toBeTruthy();
    expect(p.body.alerta_texto).toContain('24 h');
  });

  it('minhas autorizações mostram o texto na versão aceita, e o que se perde ao retirar', () => {
    const { token } = sessaoDoPortal(varejo, 'revogacao', TITULAR);
    const res = requestPortal<any>(varejo, {
      metodo: 'GET', caminho: '/v1/me/consentimentos', sessao: token,
    });
    expect(res.status).toBe(200);
    const tel = res.body.consentimentos.find((c: any) => c.id === CAMPO);
    expect(tel.versao).toBe('v2');
    expect(tel.canal).toBe('checkout web');
    expect(tel.estado).toBe('ativo');
    expect(tel.o_que_voce_perde.join(' ')).toContain('Zenvia');
  });
});

describe('PR 16 · invariante de paridade — contrato e mock, nos dois sentidos (Risco-034)', () => {
  const CONTRATO = (() => {
    const doc = parseYaml(readFileSync(join('..', 'api', 'openapi.yaml'), 'utf8')) as any;
    const ops: string[] = [];
    for (const [caminho, item] of Object.entries<any>(doc.paths)) {
      for (const m of ['get', 'post', 'patch', 'delete', 'put']) {
        if (item[m]) ops.push(`${m.toUpperCase()} ${caminho}`);
      }
    }
    return ops;
  })();

  it('toda operação do contrato está declarada em rotas.ts', () => {
    expect(CONTRATO.length).toBeGreaterThan(50);
    const declaradas = new Set(OPERACOES.map((o) => `${o.metodo} ${o.contrato}`));
    const orfas = CONTRATO.filter((c) => !declaradas.has(c));
    expect(orfas, 'operação no contrato sem linha em mock/rotas.ts').toEqual([]);
  });

  it('toda linha de rotas.ts existe no contrato — o mock nunca vai à frente dele', () => {
    const noContrato = new Set(CONTRATO);
    const orfas = OPERACOES
      .map((o) => `${o.metodo} ${o.contrato}`)
      .filter((c) => !noContrato.has(c));
    expect(orfas, 'rota declarada que o contrato não tem').toEqual([]);
    // E nenhuma linha duplicada: duas declarações da mesma operação escondem
    // divergência entre elas.
    expect(new Set(OPERACOES.map((o) => `${o.metodo} ${o.contrato}`)).size).toBe(OPERACOES.length);
  });

  it('a tabela não é decorativa: toda rota servida responde de verdade', () => {
    const servidas = OPERACOES.filter((o) => o.mock);
    expect(servidas.length).toBeGreaterThan(30);
    for (const op of servidas) {
      if (op.superficie === 'portal' && op.contrato !== '/requests/{id}/mensagens') continue;
      const res = request<{ erro?: string }>(banco, {
        metodo: op.metodo as 'GET' | 'POST' | 'PATCH' | 'DELETE',
        caminho: op.mock!,
        papel: op.papel ?? 'dpo',
        ator: 'teste',
        body: {},
      });
      expect(String(res.body?.erro ?? ''), `${op.metodo} ${op.mock} caiu no 404 terminal do switch`)
        .not.toContain('Rota não encontrada');
    }
  });

  it('quem não é servida diz por quê, e a única razão admitida é ingestão de CI', () => {
    const semMock = OPERACOES.filter((o) => !o.mock && o.superficie === 'console');
    for (const op of semMock) {
      expect(op.motivo, `${op.metodo} ${op.contrato} sem mock e sem motivo`).toBe('ingestao_ci');
    }
    // A lista é fechada. Crescer aqui é decisão visível no diff, não omissão.
    expect(semMock.map((o) => `${o.metodo} ${o.contrato}`).sort()).toEqual([
      'GET /threat-models/{repo}',
      'POST /catalog/inventories',
      'POST /gates/runs',
      'POST /kms/rotations/{id}/steps',
      'POST /metrics/snapshots',
      'POST /purge/runs',
      'POST /ripds/triage',
      'POST /telemetry/redaction',
      'PUT /threat-models/{repo}',
    ].sort());
  });

  it('toda raiz que o switch de api.ts atende está declarada — nada entra pela porta dos fundos', () => {
    const fonte = readFileSync(join('src', 'mock', 'api.ts'), 'utf8');
    const raizes = [...fonte.matchAll(/case '(GET|POST|PATCH|DELETE) ([a-z.]+)':/g)]
      .map((m) => `${m[1]} ${m[2]}`);
    expect(raizes.length, 'sem raiz extraída a varredura não prova nada').toBeGreaterThan(20);
    const naoDeclaradas = raizes.filter((r) => !RAIZES_DO_MOCK.has(r));
    expect(naoDeclaradas, 'raiz atendida pelo mock e ausente de mock/rotas.ts').toEqual([]);
  });

  it('a rota de forja fica fora do contrato — declarada, e sozinha', () => {
    expect(ROTAS_APENAS_DEMO).toHaveLength(1);
    expect(ROTAS_APENAS_DEMO[0].mock).toBe('/v1/audit/forjar');
    expect(CONTRATO.some((c) => c.includes('forjar'))).toBe(false);
    // E ela continua exigindo o modo demonstração.
    banco.modoDemo = false;
    expect(chamar('dpo', { metodo: 'POST', caminho: '/v1/audit/forjar', body: { id: 2 } }).status).toBe(404);
  });

  it('o contrato declara a superfície separada do portal e o esquema próprio do titular', () => {
    const doc = parseYaml(readFileSync(join('..', 'api', 'openapi.yaml'), 'utf8')) as any;
    expect(doc.components.securitySchemes.sessaoTitular).toBeTruthy();
    for (const op of OPERACOES.filter((o) => o.superficie === 'portal')) {
      const item = doc.paths[op.contrato];
      const operacao = item[op.metodo.toLowerCase()];
      const seguranca = operacao.security ?? doc.security;
      const esquemas = seguranca.flatMap((s: any) => Object.keys(s));

      if (op.contrato === '/requests/{id}/mensagens') {
        // A única das doze que vive nas duas superfícies: é a mesma conversa,
        // das duas pontas. Por isso aceita os dois esquemas, e não um servidor
        // só — e é justamente por aceitar os dois que precisa dizê-lo.
        expect(esquemas.sort()).toEqual(['oidc', 'sessaoTitular']);
        continue;
      }
      const servidor = operacao.servers ?? item.servers;
      expect(servidor?.[0]?.url, `${op.contrato} sem servidor de portal declarado`)
        .toContain('portal.lastro');
      // E nenhuma delas aceita o SSO interno: o console não entra pelo portal.
      expect(esquemas).not.toContain('oidc');
    }
  });

  it('nenhuma rota do portal empresta permissão da matriz interna', () => {
    for (const p of POLITICAS.filter((x) => x.superficie === 'portal')) {
      expect(p.acao, `${p.caminho} declara ação de papel interno`).toBeUndefined();
      expect(p.foraDeEscopo).toBe('401_uniforme');
    }
  });
});

describe('PR 16 · T4 na tela — o balcão consegue responder o que o portal mostra', () => {
  const montarT4 = () => {
    limparBancosDaSessao();
    useSessao.setState({
      papel: 'dpo', banco: new BancoMock('banco'), versao: 0,
      avisos: [], recusas: {}, protocoloSelecionado: '2026-0731',
    });
    return render(<MemoryRouter><T4 /></MemoryRouter>);
  };

  it('a lista de retidos só aparece quando o desfecho a exige', () => {
    montarT4();
    expect(screen.queryByText(/o que ficou retido/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/desfecho/i), { target: { value: 'atendido_parcialmente' } });
    expect(screen.getByText(/o que ficou retido/i)).toBeInTheDocument();
  });

  /**
   * O ponto do teste não é o formulário: é que a regra nova não pode existir
   * apenas como 422. Botão que só sabe recusar transforma a exigência em
   * obstáculo, e obstáculo é o que faz alguém procurar o caminho de fora.
   */
  it('sem item completo o botão não deixa concluir; com item completo, conclui', () => {
    montarT4();
    fireEvent.change(screen.getByLabelText(/desfecho/i), { target: { value: 'atendido_parcialmente' } });
    const concluir = screen.getByRole('button', { name: /registrar conclusão/i });
    expect(concluir).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '+ item retido' }));
    expect(concluir).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/item retido 1/i), { target: { value: 'Notas fiscais' } });
    expect(concluir).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/retenção até, item 1/i), { target: { value: '2031-07-29' } });
    expect(concluir).not.toBeDisabled();

    fireEvent.click(concluir);
    const s = useSessao.getState().banco.cenario.solicitacoes.find((x) => x.protocolo === '2026-0731')!;
    expect(s.desfecho).toBe('atendido_parcialmente');
    expect(s.retidos).toEqual([expect.objectContaining({
      item: 'Notas fiscais', baseLegal: 'obrigacao_legal', retencaoAte: '2031-07-29',
    })]);
  });
});
