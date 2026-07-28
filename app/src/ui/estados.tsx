import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSessao } from '../store/sessao';
import { pode, type Acao } from '../mock/permissoes';
import type { Req, Res } from '../mock/api';

/**
 * C-13 — os quatro estados de uma leitura, antes de existir backend.
 *
 * A API mock é síncrona e sempre responde, então nenhum dos quatro existia:
 * a tela ia direto do nada para a tabela preenchida. Isso é uma decisão de
 * desenho que **precede** o backend — quando ele chegar, o que muda é a origem
 * do dado, não a gramática da tela.
 *
 * Os quatro não são graus da mesma coisa:
 *
 * - **carregando** — a resposta ainda não voltou. Nunca some sozinha: ou vira
 *   pronto, ou vira erro.
 * - **erro** — a resposta não chegou. É recuperável por definição, e por isso
 *   traz a ação de repetir. **A tabela anterior sai da tela**: dado velho
 *   exibido como se fosse atual é pior do que tela vazia, porque ninguém
 *   desconfia dele.
 * - **vazio** — a resposta chegou e não tinha nada. É informação, não falha.
 * - **semPermissao** — não é estado de carregamento nem de erro: é **ausência**
 *   do controle. Nunca renderiza esqueleto nem mensagem de falha, porque não
 *   houve falha nenhuma; houve uma fronteira funcionando.
 */
export type EstadoRecurso = 'carregando' | 'pronto' | 'vazio' | 'erro' | 'sem_permissao';

export interface Recurso<T> {
  estado: EstadoRecurso;
  dados: T | null;
  mensagem?: string;
  regra?: string;
  repetir: () => void;
}

/**
 * Lê um recurso passando pelos quatro estados.
 *
 * `acao` declara a permissão que a leitura exige. Sem ela, o recurso não vai a
 * lugar nenhum: devolve `sem_permissao` sem chamar a API, porque pedir e tomar
 * 403 seria gastar uma ida para descobrir o que a tabela de permissões já sabe.
 */
export function useRecurso<T>(
  req: Omit<Req, 'papel' | 'ator'>,
  opts: { acao?: Acao; vazioSe?: (dados: T) => boolean } = {},
): Recurso<T> {
  const chamar = useSessao((s) => s.chamar);
  const papel = useSessao((s) => s.papel);
  const versao = useSessao((s) => s.versao);
  const banco = useSessao((s) => s.banco);
  // Entra na chave: sem isso, ligar a queda não refaz a leitura, e a tela
  // continua exibindo o resultado anterior como se o transporte estivesse de pé.
  const transporteCaido = useSessao((s) => s.falhaDeTransporte);
  const semPermissao = Boolean(opts.acao && !pode(papel, opts.acao));

  const [tentativa, setTentativa] = useState(0);
  const [recurso, setRecurso] = useState<Omit<Recurso<T>, 'repetir'>>({
    estado: semPermissao ? 'sem_permissao' : 'carregando', dados: null,
  });

  const chave = `${req.metodo} ${req.caminho} ${papel} ${versao} ${tentativa} ${transporteCaido}`;

  useEffect(() => {
    if (semPermissao) {
      setRecurso({ estado: 'sem_permissao', dados: null });
      return;
    }
    setRecurso({ estado: 'carregando', dados: null });

    const res: Res<T> = chamar<T>(req);
    if (res.status === 0) {
      // Transporte, não regra: a tabela anterior já saiu, e repetir é seguro.
      setRecurso({
        estado: 'erro', dados: null,
        mensagem: (res.body as { erro?: string })?.erro ?? 'A resposta não chegou.',
        regra: res.regra,
      });
      return;
    }
    if (res.status >= 400) {
      setRecurso({ estado: 'sem_permissao', dados: null });
      return;
    }
    const vazio = opts.vazioSe?.(res.body) ?? (Array.isArray(res.body) && res.body.length === 0);
    setRecurso({ estado: vazio ? 'vazio' : 'pronto', dados: res.body });
    // `chave` resume as dependências reais; `req` e `opts` são recriados a cada
    // render e disparariam o efeito para sempre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, semPermissao, banco]);

  const repetir = useCallback(() => setTentativa((t) => t + 1), []);
  return { ...recurso, repetir };
}

/**
 * Renderiza o estado certo. O conteúdo pronto é uma função para não ser montado
 * enquanto os dados não existem — e para o erro não ter como deixar a tabela
 * anterior na tela por acidente.
 */
export function Estados<T>({ recurso, vazio, ausente, rotulo, children }: {
  recurso: Recurso<T>;
  /** O que dizer quando a resposta chegou sem nada. */
  vazio: ReactNode;
  /** O que fica no lugar quando o papel não alcança. Ausência, não falha. */
  ausente?: ReactNode;
  /** Nome do que está sendo lido, para as mensagens. */
  rotulo: string;
  children: (dados: T) => ReactNode;
}) {
  if (recurso.estado === 'sem_permissao') return <>{ausente ?? null}</>;

  if (recurso.estado === 'carregando') {
    return (
      <div className="esqueleto" role="status" aria-live="polite" aria-busy="true">
        <span className="visually-hidden">Carregando {rotulo}…</span>
        <i /><i /><i />
      </div>
    );
  }

  if (recurso.estado === 'erro') {
    return (
      <div className="falha" role="alert">
        <b>Não foi possível carregar {rotulo}.</b>
        <p className="hint" style={{ margin: '6px 0 10px' }}>
          {recurso.mensagem} {recurso.regra}
        </p>
        <button className="btn" onClick={recurso.repetir}>Tentar de novo</button>
      </div>
    );
  }

  if (recurso.estado === 'vazio') return <div className="vazio" role="status">{vazio}</div>;

  return <>{recurso.dados !== null && children(recurso.dados)}</>;
}
