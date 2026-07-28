import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { BancoMock } from '../src/mock/db';
import { request } from '../src/mock/api';
import { pode } from '../src/mock/permissoes';
import { CampoPII } from '../src/ui/primitivos';
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
      body: { nome: 'cpf_sha', tipoArmazenado: 'hash', categoria: 'anonimizado', sensivel: false, baseLegal: 'execucao_contrato' },
    });
    expect(res.status).toBe(422);
    expect((res.body as { erro: string }).erro).toContain('k-anonimato');
  });

  it('aceita anonimizado quando o armazenamento é agregado', () => {
    const res = chamar('engenharia', {
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: { nome: 'cesta_media', tipoArmazenado: 'agregado', categoria: 'anonimizado', sensivel: false, baseLegal: 'execucao_contrato' },
    });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Regra 3 — revelar exige finalidade, justificativa e registro ANTES da resposta', () => {
  const corpo = { titularId: 't1', campo: 'cpf', justificativa: 'Confirmação de identidade para o protocolo 2026-0731' };

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
      body: { titularId: 't1', campo: 'biometria', justificativa: 'Verificação de identidade solicitada pelo titular' },
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
      body: { nome: 'perfil', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, baseLegal: 'execucao_contrato', internacional: true, mecanismo: 'nao_aplicavel' },
    });
    expect(res.status).toBe(422);
    expect((res.body as { erro: string }).erro).toContain('Art. 33');
  });

  it('aceita com cláusulas-padrão da ANPD', () => {
    const res = chamar('engenharia', {
      metodo: 'POST', caminho: '/v1/catalog/validar',
      body: { nome: 'perfil', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, baseLegal: 'execucao_contrato', internacional: true, mecanismo: 'clausulas_padrao_anpd' },
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
    useSessao.setState({ papel: 'dpo', banco: new BancoMock('banco'), versao: 0, avisos: [] });
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

    const res = chamar('dpo', { metodo: 'POST', caminho: '/v1/titulares/buscar', body: { cpfHash: h } });
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
