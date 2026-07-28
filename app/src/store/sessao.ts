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
  /**
   * T1-01 — o risco que a dispersão da T1 selecionou, para a T5 abrir nele.
   * Os dois mapas têm eixos diferentes; quem reclassifica é a matriz P × I.
   */
  riscoSelecionado: string | null;
  /** T1-02 — a simulação de violação é estado da sessão, não da tela. */
  simulandoViolacao: boolean;
  /**
   * C-10 — recusas ancoradas no controle que falhou, indexadas por âncora.
   *
   * O canal do canto passou a ser só de confirmação. Recusa longe da ação
   * obriga a pessoa a procurar o motivo do outro lado da tela, e a mensagem
   * some antes de ela achar.
   */
  recusas: Record<string, { texto: string; regra?: string; id: number }>;
  /**
   * C-16 — texto didático (o "por quê" do conceito) só aparece em modo
   * apresentação. O operacional — estado, prazo, recusa — nunca some.
   */
  modoApresentacao: boolean;
  /**
   * C-13 — interruptor da demonstração "o transporte falhou".
   *
   * A API mock é síncrona e sempre responde: sem isto, o estado de erro seria
   * um componente que ninguém consegue ver, e estado que não dá para exercitar
   * é estado que não existe. Ligado, `chamar` devolve status 0 antes de tocar
   * na API — falha de transporte, não recusa de regra. As duas são coisas
   * diferentes e a tela precisa distingui-las.
   */
  falhaDeTransporte: boolean;

  setPapel: (p: Papel) => void;
  setCenario: (id: string) => void;
  setProtocolo: (protocolo: string | null) => void;
  setRisco: (codigo: string | null) => void;
  setSimulacao: (ativa: boolean) => void;
  setApresentacao: (ativo: boolean) => void;
  setFalhaDeTransporte: (ativa: boolean) => void;
  /**
   * Chama a API mock já com o papel e o ator da sessão.
   *
   * `ancora` é o identificador do controle que originou a chamada: com ele, a
   * recusa é renderizada ao lado do botão em vez de ir para o canto da tela.
   */
  chamar: <T = unknown>(req: Omit<Req, 'papel' | 'ator'>, ancora?: string) => Res<T>;
  avisar: (tom: Aviso['tom'], texto: string, regra?: string) => void;
  fecharAviso: (id: number) => void;
  limparRecusa: (ancora: string) => void;
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
  riscoSelecionado: null,
  simulandoViolacao: false,
  recusas: {},
  modoApresentacao: true,
  falhaDeTransporte: false,

  setPapel: (papel) => set({ papel }),

  // O protocolo é de outro cenário: mantê-lo faria a revelação registrar um
  // atendimento que não existe mais. O banco, esse, volta como estava.
  setCenario: (cenarioId) =>
    set((s) => ({
      cenarioId, banco: bancoDe(cenarioId), versao: s.versao + 1,
      avisos: [], recusas: {}, protocoloSelecionado: null,
      riscoSelecionado: null, simulandoViolacao: false,
    })),

  setProtocolo: (protocoloSelecionado) => set({ protocoloSelecionado }),

  setRisco: (riscoSelecionado) => set({ riscoSelecionado }),

  setSimulacao: (simulandoViolacao) => set({ simulandoViolacao }),

  setApresentacao: (modoApresentacao) => set({ modoApresentacao }),

  setFalhaDeTransporte: (falhaDeTransporte) => set({ falhaDeTransporte }),

  chamar: <T,>(req: Omit<Req, 'papel' | 'ator'>, ancora?: string) => {
    const { banco, papel, falhaDeTransporte } = get();

    /**
     * C-13 — falha de transporte não é recusa. Status 0 significa "a resposta
     * não chegou": a tela mostra erro recuperável com ação de repetir, e não
     * uma mensagem de regra que ninguém violou.
     */
    if (falhaDeTransporte) {
      return { status: 0, body: { erro: 'A resposta não chegou.' } as T,
        regra: 'Falha de transporte — nada foi decidido, e repetir é seguro.' };
    }

    const res = request<T>(banco, { ...req, papel, ator: NOME_POR_PAPEL[papel] });

    // Só escrita invalida a tela. Bumpar a versão em GET criaria laço de render
    // em qualquer componente que leia durante a renderização.
    if (req.metodo !== 'GET') set((s) => ({ versao: s.versao + 1 }));

    if (res.status >= 400) {
      const texto = (res.body as { erro?: string })?.erro ?? 'Operação recusada.';
      // C-10 — com âncora, a recusa mora no controle. Sem âncora, cai no canal
      // do canto, que é o último recurso e não o primeiro.
      if (ancora) {
        set((s) => ({ recusas: { ...s.recusas, [ancora]: { texto, regra: res.regra, id: seqAviso++ } } }));
      } else {
        get().avisar('negado', texto, res.regra);
      }
    } else {
      if (ancora) get().limparRecusa(ancora);
      if (res.regra) get().avisar('ok', res.regra);
    }
    return res;
  },

  avisar: (tom, texto, regra) =>
    // No máximo três simultâneas: canal que empilha vira ruído, e ruído se
    // aprende a ignorar.
    set((s) => ({ avisos: [...s.avisos, { id: seqAviso++, tom, texto, regra }].slice(-3) })),

  fecharAviso: (id) => set((s) => ({ avisos: s.avisos.filter((a) => a.id !== id) })),

  limparRecusa: (ancora) => set((s) => {
    if (!s.recusas[ancora]) return {};
    const { [ancora]: _, ...resto } = s.recusas;
    return { recusas: resto };
  }),
}));

export const nomeDoPapel = (p: Papel) => NOME_POR_PAPEL[p];
