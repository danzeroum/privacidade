import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { BancoMock } from '../src/mock/db';
import { request } from '../src/mock/api';
import { pode } from '../src/mock/permissoes';
import { POLITICAS, POLITICA_PADRAO, politicaDe } from '../src/mock/politicas';
import {
  MAQUINAS, TRANSICOES_INCIDENTE, estadosDe, motivoDaRecusa, transicaoPermitida,
  type Artefato,
} from '../src/mock/estados';
import { CampoPII, Didatico, Explica } from '../src/ui/primitivos';
import { MemoryRouter } from 'react-router-dom';
import T2 from '../src/screens/T2';
import { Casca } from '../src/App';
import T1 from '../src/screens/T1';
import T3 from '../src/screens/T3';
import T5 from '../src/screens/T5';
import T7 from '../src/screens/T7';
import T8 from '../src/screens/T8';
import T4 from '../src/screens/T4';
import T6 from '../src/screens/T6';
import { useSessao, limparBancosDaSessao } from '../src/store/sessao';
import { sha256, hashCpf } from '../src/lib/sha256';
import type { EstadoIncidente, Papel } from '../src/mock/types';

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

    const comRazao = chamar('dpo', {
      metodo: 'POST', caminho: '/v1/requests/s1/concluir',
      body: { desfecho: 'recusado_com_fundamento', evidencia: 'Guarda fiscal obrigatória de 5 anos impede a eliminação agora.' },
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

    const completo = mover('ripd', ripd.id, {
      para: 'dispensado',
      justificativa: 'Tratamento não usa dado pessoal nesta versão.',
      gatilhoDeReabertura: 'Qualquer coleta de identificador direto reabre a triagem.',
    });
    expect(completo.status).toBe(200);
    expect(ripd.status).toBe('dispensado');
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

    const pulando = mover('achado', achado.id, { para: 'encerrado' });
    expect(pulando.status).toBe(409);
    expect(pulando.regra).toContain('verificação independente');
    expect(achado.status).toBe('executado');

    expect(mover('achado', achado.id, { para: 'verificado', verificadoPor: '@auditoria' }).status).toBe(200);

    const criticidadeAntes = achado.criticidade;
    expect(criticidadeAntes).toBe('alta');
    expect(mover('achado', achado.id, { para: 'reaberto' }).status).toBe(200);
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
      gatilhoDeReabertura: 'Coleta de identificador direto reabre.',
    });
    expect(banco.auditoria.at(-1)!.justificativa).not.toContain('529.982.247-25');
  });
});
