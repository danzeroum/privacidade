import { useEffect, useRef, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './ui/estilos.css';
import { useSessao } from './store/sessao';
import { PAPEIS, TELAS_BLOQUEADAS } from './mock/permissoes';
import type { Papel } from './mock/types';
import { CENARIOS } from './mock/scenarios';
import { Modal, Nota } from './ui/primitivos';
import T0 from './screens/T0';
import T1 from './screens/T1';
import T2 from './screens/T2';
import T3 from './screens/T3';
import T4 from './screens/T4';
import T5 from './screens/T5';
import T6 from './screens/T6';
import T7 from './screens/T7';
import T8 from './screens/T8';
import T9 from './screens/T9';

export const TELAS = [
  // PR 9 — a fila é a entrada: o programa começa pelo que depende de você, e o
  // painel responde pelo estado do programa logo abaixo.
  { rota: '/t0', id: 'T0', nome: 'Minha fila', grupo: 'Trabalho' },
  { rota: '/t1', id: 'T1', nome: 'Painel de governança', grupo: 'Esteira de entrega' },
  { rota: '/t2', id: 'T2', nome: 'Catálogo de dados', grupo: 'Esteira de entrega' },
  { rota: '/t3', id: 'T3', nome: 'RIPD e LINDDUN', grupo: 'Esteira de entrega' },
  { rota: '/t4', id: 'T4', nome: 'Direitos do titular', grupo: 'Operação e prova' },
  { rota: '/t5', id: 'T5', nome: 'Riscos e RACI', grupo: 'Operação e prova' },
  { rota: '/t6', id: 'T6', nome: 'Expurgo e auditoria', grupo: 'Operação e prova' },
  { rota: '/t7', id: 'T7', nome: 'Chaves e criptografia', grupo: 'Operação e prova' },
  { rota: '/t8', id: 'T8', nome: 'Editor de LIA', grupo: 'Operação e prova' },
  { rota: '/t9', id: 'T9', nome: 'Incidentes', grupo: 'Operação e prova' },
];

export default function App() {
  return (
    <HashRouter>
      <Casca />
    </HashRouter>
  );
}

export function Casca() {
  const papel = useSessao((s) => s.papel);
  const setPapel = useSessao((s) => s.setPapel);
  const cenarioId = useSessao((s) => s.cenarioId);
  const setCenario = useSessao((s) => s.setCenario);
  const banco = useSessao((s) => s.banco);
  const avisos = useSessao((s) => s.avisos);
  const fecharAviso = useSessao((s) => s.fecharAviso);
  const avisar = useSessao((s) => s.avisar);
  const modoApresentacao = useSessao((s) => s.modoApresentacao);
  const setApresentacao = useSessao((s) => s.setApresentacao);
  const falhaDeTransporte = useSessao((s) => s.falhaDeTransporte);
  const setFalhaDeTransporte = useSessao((s) => s.setFalhaDeTransporte);
  const [explicando, setExplicando] = useState(false);
  const local = useLocation();

  /**
   * C-09 — tela que o papel não opera **sai do menu**.
   *
   * Antes, o item ficava com `aria-disabled="true"` e `pointer-events: none`:
   * anunciava um lugar que não existe para quem está ali, e o `NavLink` ainda
   * navegava por teclado, caindo na página de bloqueio sem ter parecido um
   * link. A página de bloqueio continua — para acesso por link direto, que é
   * legítimo e precisa de uma resposta clara.
   */
  const bloqueadas = TELAS_BLOQUEADAS[papel] ?? [];
  const visiveis = TELAS.filter((t) => !bloqueadas.includes(t.rota));
  const grupos = [...new Set(visiveis.map((t) => t.grupo))];

  /**
   * Trocar de papel muda o menu debaixo do cursor. Uma linha dizendo o que
   * entrou e o que saiu evita a pergunta "sumiu ou eu não achei?" — e é o
   * momento em que a fronteira fica mais fácil de entender.
   */
  const anterior = useRef<Papel | null>(null);
  useEffect(() => {
    const antes = anterior.current;
    anterior.current = papel;
    if (!antes || antes === papel) return;
    const rotasAntes = TELAS.filter((t) => !(TELAS_BLOQUEADAS[antes] ?? []).includes(t.rota)).map((t) => t.rota);
    const rotasAgora = visiveis.map((t) => t.rota);
    const nomeDe = (rota: string) => TELAS.find((t) => t.rota === rota)?.nome ?? rota;
    const entraram = rotasAgora.filter((r) => !rotasAntes.includes(r)).map(nomeDe);
    const sairam = rotasAntes.filter((r) => !rotasAgora.includes(r)).map(nomeDe);
    if (entraram.length === 0 && sairam.length === 0) return;
    avisar('info',
      [entraram.length ? `Entrou no menu: ${entraram.join(', ')}.` : '',
        sairam.length ? `Saiu: ${sairam.join(', ')}.` : ''].filter(Boolean).join(' '),
      'O menu reflete o que o papel opera. Acesso por link direto continua respondendo, com a página de bloqueio.');
  }, [papel, visiveis]);

  return (
    <div className="app">
      <nav className="rail" aria-label="Telas">
        <div className="brand">
          <span className="brand-name">Lastro</span>
          <span className="brand-sub">Governança · LGPD</span>
        </div>

        {grupos.map((g) => (
          <div key={g}>
            <div className="rail-group">{g}</div>
            {visiveis.filter((t) => t.grupo === g).map((t) => (
              <NavLink
                key={t.rota}
                to={t.rota}
                className={({ isActive }) => `nav ${isActive ? 'ativo' : ''}`}
              >
                <span className="nav-id">{t.id}</span> {t.nome}
              </NavLink>
            ))}
          </div>
        ))}

        <div className="rail-foot">
          Protótipo navegável · {banco.cenario.nome}<br />
          Dados de demonstração — nenhum titular real.
        </div>
      </nav>

      <div>
        <header className="topbar">
          <span className="topbar-label">Público</span>
          <div className="seg">
            {PAPEIS.map((p) => (
              <button
                key={p.id}
                aria-pressed={papel === p.id}
                title={p.resumo}
                onClick={() => setPapel(p.id)}
              >
                {p.rotulo}
              </button>
            ))}
          </div>

          <span className="topbar-label">Cenário</span>
          <select
            className="cenario"
            aria-label="Cenário de demonstração"
            value={cenarioId}
            onChange={(e) => setCenario(e.target.value)}
          >
            {Object.values(CENARIOS).map((c) => (
              <option key={c.id} value={c.id}>{c.nome} · {c.setor}</option>
            ))}
          </select>

          <span className="spacer" />
          {/* C-16 — o didático fica atrás deste interruptor; o operacional não. */}
          <label className="toggle" title="Mostra o texto que explica por que cada regra existe">
            <input
              type="checkbox"
              checked={modoApresentacao}
              onChange={(e) => setApresentacao(e.target.checked)}
            />
            <span className="track" /> modo apresentação
          </label>
          {/* C-13 — sem um jeito de provocar a falha, o estado de erro seria
              código que ninguém consegue ver. Fica no modo demonstração. */}
          {banco.modoDemo && (
            <label className="toggle" title="Simula uma resposta que não chega, para exercitar o estado de erro">
              <input
                type="checkbox"
                checked={falhaDeTransporte}
                onChange={(e) => setFalhaDeTransporte(e.target.checked)}
              />
              <span className="track" /> simular queda
            </label>
          )}
          <button className="shield" onClick={() => setExplicando(true)}>
            🛡 Dados mascarados
          </button>
          <button
            className="icon-btn"
            aria-label="Alternar tema"
            onClick={() => {
              const raiz = document.documentElement;
              raiz.dataset.theme = raiz.dataset.theme === 'dark' ? 'light' : 'dark';
            }}
          >
            ◐
          </button>
        </header>

        <main>
          {bloqueadas.includes(local.pathname) ? (
            <div className="bloqueio">
              <h1 style={{ fontSize: 26, marginBottom: 12 }}>Tela indisponível para o seu papel</h1>
              <Nota tom="crit">
                O papel selecionado não opera esta tela. Ela não está apenas escondida: o componente
                não é montado e nenhuma requisição parte desta sessão.
              </Nota>
            </div>
          ) : (
            <Routes>
              <Route path="/" element={<Navigate to="/t0" replace />} />
              <Route path="/t0" element={<T0 />} />
              <Route path="/t1" element={<T1 />} />
              <Route path="/t2" element={<T2 />} />
              <Route path="/t3" element={<T3 />} />
              <Route path="/t4" element={<T4 />} />
              <Route path="/t5" element={<T5 />} />
              <Route path="/t6" element={<T6 />} />
              <Route path="/t7" element={<T7 />} />
              <Route path="/t8" element={<T8 />} />
              <Route path="/t9" element={<T9 />} />
              <Route path="*" element={<Navigate to="/t0" replace />} />
            </Routes>
          )}
        </main>
      </div>

      {/* C-10 — este canal é de confirmação e informação. A recusa mora no
          controle que falhou, com `role="alert"`, e não aqui: `aria-live` é
          "polite" de propósito, porque nada aqui interrompe ninguém. */}
      <div className="avisos" role="status" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso ${a.tom}`}>
            <div style={{ flex: 1 }}>
              <b>{a.texto}</b>
              {a.regra && <span className="regra">{a.regra}</span>}
            </div>
            <button onClick={() => fecharAviso(a.id)} aria-label="Fechar aviso">✕</button>
          </div>
        ))}
      </div>

      {explicando && (
        <Modal
          titulo="Por que tudo começa mascarado"
          aoFechar={() => setExplicando(false)}
          rodape={<button className="btn primary" onClick={() => setExplicando(false)}>Entendi</button>}
        >
          <p style={{ margin: 0, color: 'var(--text-2)' }}>
            O mascaramento não é preferência de exibição — é o estado padrão do sistema. Não existe um
            botão que o desligue para a sessão inteira.
          </p>
          <dl className="kv">
            <dt>Padrão</dt><dd>Todo campo pessoal chega mascarado, inclusive para o DPO.</dd>
            <dt>Revelar</dt><dd>Exige finalidade declarada e justificativa; vale 60 s e para um campo só.</dd>
            <dt>Registro</dt><dd>A tentativa é gravada antes da resposta. Se o log falha, a revelação falha.</dd>
            <dt>Sensível</dt><dd>Não é revelável em tela alguma — nem com justificativa.</dd>
            <dt>Produto</dt><dd>O papel Produto não recebe a opção: o botão não é renderizado.</dd>
          </dl>
        </Modal>
      )}
    </div>
  );
}
