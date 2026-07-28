import { create } from 'zustand';
import { BancoMock } from '../mock/db';
import { request, type Req, type Res } from '../mock/api';
import { CENARIO_PADRAO } from '../mock/scenarios';
import type { Papel } from '../mock/types';

export interface Aviso {
  id: number;
  tom: 'ok' | 'negado' | 'info';
  texto: string;
  regra?: string;
}

const NOME_POR_PAPEL: Record<Papel, string> = {
  engenharia: 'Maria Souza',
  dpo: 'Marcela Dias',
  produto: 'Pedro Lima',
  seguranca: 'Rita Nunes',
  auditor: 'Auditoria Externa',
};

interface Estado {
  papel: Papel;
  cenarioId: string;
  banco: BancoMock;
  /** Contador de escrita: o banco é mutável, então a UI precisa de um sinal para redesenhar. */
  versao: number;
  avisos: Aviso[];
  /**
   * T4-01 — o protocolo sob o qual a sessão está trabalhando.
   *
   * Mora aqui e não na T4 porque quem precisa dele é o diálogo de revelação, em
   * `ui/primitivos.tsx`, que não conhece a fila. Sem esse carregador, a
   * revelação acontecia sem protocolo e o registro no trail não dizia a serviço
   * de qual atendimento o dado foi aberto.
   */
  protocoloSelecionado: string | null;

  setPapel: (p: Papel) => void;
  setCenario: (id: string) => void;
  setProtocolo: (protocolo: string | null) => void;
  /** Chama a API mock já com o papel e o ator da sessão, e publica o aviso resultante. */
  chamar: <T = unknown>(req: Omit<Req, 'papel' | 'ator'>) => Res<T>;
  avisar: (tom: Aviso['tom'], texto: string, regra?: string) => void;
  fecharAviso: (id: number) => void;
}

let seqAviso = 1;

/**
 * T5-02 — um banco por cenário, criado na primeira visita e mantido depois.
 *
 * Antes, `setCenario` recriava o `BancoMock` e apagava as reclassificações que
 * a própria tela chama de imutáveis: o card dizia uma coisa e a barra superior
 * fazia outra. A alternativa mais barata seria confirmar antes de descartar,
 * mas ela ensina exatamente o contrário do que o produto defende — que registro
 * imutável some se você clicar em OK. Aqui nada é descartável, nem com
 * confirmação: trocar de cenário e voltar reencontra o histórico e o trail
 * daquele cenário.
 *
 * O custo é segurar N bancos vivos. São três cenários de dado sintético; com
 * dado real esta não seria a escolha.
 */
const BANCOS = new Map<string, BancoMock>();
const bancoDe = (id: string): BancoMock => {
  const existente = BANCOS.get(id);
  if (existente) return existente;
  const novo = new BancoMock(id);
  BANCOS.set(id, novo);
  return novo;
};

/** Só para os testes: cada caso começa com bancos limpos. */
export const limparBancosDaSessao = () => BANCOS.clear();

export const useSessao = create<Estado>((set, get) => ({
  papel: 'engenharia',
  cenarioId: CENARIO_PADRAO,
  banco: bancoDe(CENARIO_PADRAO),
  versao: 0,
  avisos: [],
  protocoloSelecionado: null,

  setPapel: (papel) => set({ papel }),

  // O protocolo é de outro cenário: mantê-lo faria a revelação registrar um
  // atendimento que não existe mais. O banco, esse, volta como estava.
  setCenario: (cenarioId) =>
    set((s) => ({
      cenarioId, banco: bancoDe(cenarioId), versao: s.versao + 1,
      avisos: [], protocoloSelecionado: null,
    })),

  setProtocolo: (protocoloSelecionado) => set({ protocoloSelecionado }),

  chamar: <T,>(req: Omit<Req, 'papel' | 'ator'>) => {
    const { banco, papel } = get();
    const res = request<T>(banco, { ...req, papel, ator: NOME_POR_PAPEL[papel] });

    // Só escrita invalida a tela. Bumpar a versão em GET criaria laço de render
    // em qualquer componente que leia durante a renderização.
    if (req.metodo !== 'GET') set((s) => ({ versao: s.versao + 1 }));

    if (res.status >= 400) {
      const corpo = res.body as { erro?: string };
      get().avisar('negado', corpo?.erro ?? 'Operação recusada.', res.regra);
    } else if (res.regra) {
      get().avisar('ok', res.regra);
    }
    return res;
  },

  avisar: (tom, texto, regra) =>
    set((s) => ({ avisos: [...s.avisos, { id: seqAviso++, tom, texto, regra }] })),

  fecharAviso: (id) => set((s) => ({ avisos: s.avisos.filter((a) => a.id !== id) })),
}));

export const nomeDoPapel = (p: Papel) => NOME_POR_PAPEL[p];
