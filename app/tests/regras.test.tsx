import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { BancoMock } from '../src/mock/db';
import { request } from '../src/mock/api';
import { pode } from '../src/mock/permissoes';
import { POLITICAS, POLITICA_PADRAO, politicaDe } from '../src/mock/politicas';
import { CampoPII } from '../src/ui/primitivos';
import T2 from '../src/screens/T2';
import T4 from '../src/screens/T4';
import T6 from '../src/screens/T6';
import { useSessao } from '../src/store/sessao';
import { sha256, hashCpf } from '../src/lib/sha256';
import type { Papel } from '../src/mock/types';

let banco: BancoMock;
beforeEach(() => {
  banco = new BancoMock('banco');
  cleanup();
});

const chamar = (papel: Papel, req: Partial<Parameters<typeof request>[1]> & { metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE'; caminho: string }) =>
  request(banco, { papel, ator: 'teste', ...req });

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
    expect(banco.cenario.solicitacoes.find((x) => x.id === 's1')!.status).toBe('recusada');
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
      const encerradas = b.cenario.solicitacoes.filter((s) => s.status === 'concluida' || s.status === 'recusada');
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
