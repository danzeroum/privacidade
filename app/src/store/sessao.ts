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

export const useSessao = create<Estado>((set, get) => ({
  papel: 'engenharia',
  cenarioId: CENARIO_PADRAO,
  banco: new BancoMock(CENARIO_PADRAO),
  versao: 0,
  avisos: [],
  protocoloSelecionado: null,

  setPapel: (papel) => set({ papel }),

  // O protocolo é de outro cenário: mantê-lo faria a revelação registrar um
  // atendimento que não existe mais.
  setCenario: (cenarioId) =>
    set({ cenarioId, banco: new BancoMock(cenarioId), versao: 0, avisos: [], protocoloSelecionado: null }),

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
