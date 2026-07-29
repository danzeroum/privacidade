import { useState } from 'react';
import { Cabecalho, Cartao, Nota, Permitido, Pill, Recusa, Tabela } from '../ui/primitivos';
import { useSessao } from '../store/sessao';
import { redigir, resumoDaRedacao } from '../lib/redator';
import { curto } from '../lib/sha256';
import { estadosDe, proximosDe } from '../mock/estados';
import type { Achado, EstadoAchado } from '../mock/types';

/**
 * A faixa de passos é **derivada da máquina**, não escrita à mão.
 *
 * A T9 declara os passos do incidente numa constante local, e é uma dívida:
 * estado novo em `estados.ts` some da faixa sem quebrar nada. Aqui a trilha sai
 * de `proximosDe`, caminhando de `aberto` até parar — o que produz o caminho
 * feliz. `reaberto` fica de fora por consequência da caminhada, e é exatamente
 * como deve aparecer: reincidência é desvio, não etapa prevista do plano.
 *
 * Há teste conferindo que a trilha mais os desvios cobrem todos os estados: um
 * estado novo que ninguém pôs na tela vira falha, não omissão silenciosa.
 */
export const trilhaDoAchado = (): EstadoAchado[] => {
  const passos: EstadoAchado[] = ['aberto'];
  for (;;) {
    const atual = passos[passos.length - 1];
    const proximo = proximosDe('achado', atual).find((e) => !passos.includes(e));
    if (!proximo) return passos;
    passos.push(proximo);
  }
};

export const DESVIOS: EstadoAchado[] = estadosDe('achado').filter((e) => !trilhaDoAchado().includes(e));

const ROTULO: Record<EstadoAchado, string> = {
  aberto: 'Aberto',
  causa_raiz: 'Causa raiz',
  plano: 'Plano',
  executado: 'Executado',
  verificado: 'Verificado',
  encerrado: 'Encerrado',
  reaberto: 'Reaberto',
};

const TOM: Record<Achado['criticidade'], 'ok' | 'warn' | 'crit' | 'neutral'> = {
  baixa: 'neutral', media: 'warn', alta: 'warn', critica: 'crit',
};

export default function T11() {
  const banco = useSessao((s) => s.banco);
  useSessao((s) => s.versao);

  const achados = banco.cenario.achados;
  const [selecionado, setSelecionado] = useState(achados[0]?.id ?? '');
  const achado = achados.find((a) => a.id === selecionado) ?? achados[0];

  if (!achado) {
    return (
      <>
        <Cabecalho fontes={['Art. 6º, X']} titulo="Achados e planos de ação" resumo="" nota={{}} />
        <Nota>Nenhum achado registrado neste cenário.</Nota>
      </>
    );
  }

  return (
    <>
      <Cabecalho
        fontes={['Art. 6º, X · responsabilização', 'audit_log · hash encadeado']}
        titulo="Achados e planos de ação"
        resumo="O ciclo do achado do jeito que a auditoria cobra: causa antes de plano, critério antes de execução, e encerramento só depois de alguém que não executou dizer que funcionou."
        nota={{
          engenharia: 'A causa raiz, o plano e a execução são seus. O que você executou, você não verifica — a rota recusa o mesmo nome dos dois lados.',
          dpo: 'Você opera o ciclo inteiro e costuma ser quem verifica. Verificar é dizer se o critério foi atingido; encerrar é o ato seguinte, e só existe se a resposta foi sim.',
          produto: 'Leitura. Nenhum controle de avanço é montado para o seu papel — não é botão desligado, é componente que não existe nesta sessão.',
          seguranca: 'Leitura. O achado tem dono declarado em engenharia e no DPO; permissão larga aqui escolheria o dono por omissão.',
          auditor: 'Leitura da cadeia de custódia e do trail. Cada evidência aponta para a anterior: a ordem em que apareceram é conferível.',
        }}
      />

      <FaixaDoAchado achado={achado} />

      {achados.length > 1 && (
        <div className="row" style={{ marginTop: 12 }}>
          {achados.map((a) => (
            <button
              key={a.id}
              className="reveal mono"
              aria-pressed={a.id === achado.id}
              onClick={() => setSelecionado(a.id)}
            >
              {a.id === achado.id ? '● ' : ''}{a.codigo} · {ROTULO[a.status].toLowerCase()}
            </button>
          ))}
        </div>
      )}

      <div className="grid g2" style={{ marginTop: 14 }}>
        <AnaliseEPlano achado={achado} />
        <PainelDoCiclo achado={achado} />
      </div>

      <div className="sec-title">Cadeia de custódia</div>
      <CadeiaDeCustodia achado={achado} />
    </>
  );
}

/** Onde o achado está no ciclo, com a reincidência à vista. */
function FaixaDoAchado({ achado }: { achado: Achado }) {
  const trilha = trilhaDoAchado();
  const desviado = DESVIOS.includes(achado.status);
  // Reaberto volta a `causa_raiz`: na faixa, o passo aceso é o que ele precisa
  // refazer, e não o desvio — quem olha quer saber o que fazer agora.
  const referencia: EstadoAchado = achado.status === 'reaberto' ? 'aberto' : achado.status;
  const indiceAtual = trilha.indexOf(referencia);

  return (
    <>
      <div className={`banner ${achado.criticidade === 'critica' ? 'crit' : ''}`} style={{ marginTop: 18 }}>
        <span className="mark">{achado.status === 'encerrado' ? '✓' : '⚑'}</span>
        <div>
          <h4>
            <span className="mono">{achado.codigo}</span> ·{' '}
            <Pill tom={TOM[achado.criticidade]}>criticidade {achado.criticidade}</Pill>
            {achado.reincidencias > 0 && <> <Pill tom="crit">{achado.reincidencias} reincidência(s)</Pill></>}
          </h4>
          <p>
            {achado.descricao} · origem {achado.origem} · estado{' '}
            <b>{ROTULO[achado.status].toLowerCase()}</b>
          </p>
        </div>
      </div>

      <div className="pipe" style={{ marginTop: 12 }}>
        {trilha.map((passo, i) => {
          const atual = !desviado && passo === achado.status;
          const feito = i < indiceAtual;
          return (
            <div
              key={passo}
              className="pipe-step"
              style={{ background: atual ? 'var(--accent-soft)' : feito ? 'var(--ok-soft)' : undefined }}
              aria-current={atual ? 'step' : undefined}
            >
              <b style={{ fontSize: 12.5 }}>{ROTULO[passo]}</b>
              <p className="hint" style={{ margin: '4px 0 0' }}>
                {atual ? 'estado atual' : feito ? 'concluído' : 'pendente'}
              </p>
            </div>
          );
        })}
      </div>

      {desviado && (
        <Nota tom="crit">
          <b>{ROTULO[achado.status]}</b> não é etapa do plano: é desvio. O achado voltou para a apuração
          da causa, com a criticidade elevada e a reincidência contada.
          {achado.motivoDaReabertura && <> Motivo registrado: <i>{achado.motivoDaReabertura}</i></>}
        </Nota>
      )}
    </>
  );
}

/** O que já está registrado. Campo vazio aparece como vazio, e não some. */
function AnaliseEPlano({ achado }: { achado: Achado }) {
  return (
    <Cartao titulo="Análise e plano">
      <dl className="kv">
        <dt>Causa raiz</dt>
        <dd>{achado.causaRaiz ?? <span className="hint">não registrada</span>}</dd>
        <dt>Plano</dt>
        <dd>{achado.plano ?? <span className="hint">não proposto</span>}</dd>
        <dt>Critério de eficácia</dt>
        <dd>{achado.criterioDeEficacia ?? <span className="hint">não declarado</span>}</dd>
        <dt>Executado por</dt>
        <dd>{achado.executadoPor ?? <span className="hint">—</span>}</dd>
        <dt>Verificado por</dt>
        <dd>
          {achado.verificadoPor
            ? <>{achado.verificadoPor}{achado.executadoPor && achado.verificadoPor !== achado.executadoPor && <span className="hint"> · independente de quem executou</span>}</>
            : <span className="hint">—</span>}
        </dd>
        <dt>Critério atingido</dt>
        <dd>
          {achado.eficaciaAtingida === undefined
            ? <span className="hint">a verificação ainda não concluiu</span>
            : achado.eficaciaAtingida
              ? <Pill tom="ok">sim</Pill>
              : <Pill tom="crit">não</Pill>}
        </dd>
      </dl>
      <Nota>
        O critério de eficácia é declarado no plano, <b>antes</b> de executar. Declarado depois, ele é
        escrito por quem já sabe o resultado — e passa a descrever o que aconteceu em vez de cobrar o
        que deveria acontecer.
      </Nota>
    </Cartao>
  );
}

/**
 * O avanço. A tela **não** move estado: cada botão manda `POST
 * /v1/estados/achado/{codigo}` com o destino, e quem decide se a transição é
 * legal é `estados.ts`, e se o conteúdo a sustenta é `api.ts`.
 *
 * Só o bloco da vez é montado, e todos vivem dentro de `Permitido`: o papel que
 * não gerencia achado não recebe controle desligado — não recebe controle.
 */
function PainelDoCiclo({ achado }: { achado: Achado }) {
  const chamar = useSessao((s) => s.chamar);
  useSessao((s) => s.versao);

  const [causaRaiz, setCausaRaiz] = useState('');
  const [plano, setPlano] = useState('');
  const [criterio, setCriterio] = useState('');
  const [executadoPor, setExecutadoPor] = useState('');
  const [verificadoPor, setVerificadoPor] = useState('');
  const [atingiu, setAtingiu] = useState<'' | 'sim' | 'nao'>('');
  const [evidencia, setEvidencia] = useState('');
  const [motivo, setMotivo] = useState('');

  const proximos = proximosDe('achado', achado.status);
  const mover = (body: Record<string, unknown>, ancora: string) =>
    chamar({ metodo: 'POST', caminho: `/v1/estados/achado/${achado.codigo}`, body }, ancora);

  const limpar = () => {
    setCausaRaiz(''); setPlano(''); setCriterio(''); setExecutadoPor('');
    setVerificadoPor(''); setAtingiu(''); setEvidencia(''); setMotivo('');
  };
  const enviar = (body: Record<string, unknown>, ancora: string) => {
    if (mover(body, ancora).status === 200) limpar();
  };

  const previaCausa = redigir(causaRaiz);

  return (
    <Cartao
      titulo="Avançar o ciclo"
      hint={`daqui o achado vai para: ${proximos.map((p) => ROTULO[p].toLowerCase()).join(' ou ') || 'nenhum estado'}`}
    >
      <Permitido
        acao="gerenciar_achado"
        alternativa={(
          <Nota>
            O achado é de engenharia e do DPO. O seu papel lê o ciclo, a cadeia de custódia e o trail —
            e nenhum controle de avanço é montado nesta sessão.
          </Nota>
        )}
      >
        {(achado.status === 'aberto' || achado.status === 'reaberto') && (
          <>
            <div className="field">
              <label htmlFor="ach-causa">
                Causa raiz (mínimo 20 caracteres)
                {achado.status === 'reaberto' && ' — a análise anterior não foi herdada'}
              </label>
              <textarea
                id="ach-causa"
                value={causaRaiz}
                onChange={(e) => setCausaRaiz(e.target.value)}
                placeholder="Ex.: o pipeline nasceu fora do inventário e ninguém declarou TTL."
              />
              <span className="hint">{causaRaiz.trim().length}/20</span>
            </div>
            {previaCausa.houveRemocao && (
              <Nota tom="warn">
                A causa raiz contém {resumoDaRedacao(previaCausa.achados)} — será gravada assim:
                {' '}<span className="mono">{previaCausa.texto}</span>
              </Nota>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                disabled={causaRaiz.trim().length < 20}
                onClick={() => enviar({ para: 'causa_raiz', causaRaiz }, 'ach-causa')}
              >
                Registrar causa raiz
              </button>
            </div>
            <Recusa ancora="ach-causa" />
            <Nota>
              Plano apoiado em sintoma corrige a ocorrência e deixa a causa de pé — que é como um achado
              volta com outro código seis meses depois.
            </Nota>
          </>
        )}

        {achado.status === 'causa_raiz' && (
          <>
            <div className="field">
              <label htmlFor="ach-plano">Plano (mínimo 20 caracteres)</label>
              <textarea
                id="ach-plano"
                value={plano}
                onChange={(e) => setPlano(e.target.value)}
                placeholder="Ex.: declarar o dataset no inventário com retenção de 180 dias e ligar o expurgo ao mesmo TTL."
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="ach-criterio">
                Critério de eficácia (mínimo 20 caracteres) — é contra ele que a verificação vai concluir
              </label>
              <textarea
                id="ach-criterio"
                value={criterio}
                onChange={(e) => setCriterio(e.target.value)}
                placeholder="Ex.: duas execuções consecutivas do expurgo removendo registros acima de 180 dias."
              />
              <span className="hint">{criterio.trim().length}/20</span>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                disabled={plano.trim().length < 20 || criterio.trim().length < 20}
                onClick={() => enviar({ para: 'plano', plano, criterioDeEficacia: criterio }, 'ach-plano')}
              >
                Propor plano
              </button>
            </div>
            <Recusa ancora="ach-plano" />
          </>
        )}

        {achado.status === 'plano' && (
          <>
            <div className="field">
              <label htmlFor="ach-executor">Quem executou</label>
              <input
                id="ach-executor"
                value={executadoPor}
                onChange={(e) => setExecutadoPor(e.target.value)}
                placeholder="@eng-rafael"
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="ach-evid-exec">Evidência da execução</label>
              <input
                id="ach-evid-exec"
                value={evidencia}
                onChange={(e) => setEvidencia(e.target.value)}
                placeholder="rotacao-2026-06.log"
              />
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                disabled={!executadoPor.trim() || !evidencia.trim()}
                onClick={() => enviar({ para: 'executado', executadoPor, evidencia }, 'ach-exec')}
              >
                Registrar execução
              </button>
            </div>
            <Recusa ancora="ach-exec" />
            <Nota>
              O nome de quem executou não é formalidade: é o fato contra o qual a rota afere a
              independência da verificação, no passo seguinte.
            </Nota>
          </>
        )}

        {achado.status === 'executado' && (
          <>
            <div className="field">
              <label htmlFor="ach-verificador">
                Quem verifica — precisa ser diferente de {achado.executadoPor ?? 'quem executou'}
              </label>
              <input
                id="ach-verificador"
                value={verificadoPor}
                onChange={(e) => setVerificadoPor(e.target.value)}
                placeholder="@dpo-marcela"
              />
            </div>
            <fieldset className="field" style={{ marginTop: 10 }}>
              <legend>O critério declarado no plano foi atingido?</legend>
              <p className="hint" style={{ marginTop: 0 }}>
                {achado.criterioDeEficacia ?? 'critério não declarado'}
              </p>
              <div className="row">
                <label className="check">
                  <input
                    type="radio"
                    name="ach-atingiu"
                    checked={atingiu === 'sim'}
                    onChange={() => setAtingiu('sim')}
                  /> sim
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name="ach-atingiu"
                    checked={atingiu === 'nao'}
                    onChange={() => setAtingiu('nao')}
                  /> não
                </label>
              </div>
            </fieldset>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="ach-evid-verif">Evidência da verificação</label>
              <input
                id="ach-evid-verif"
                value={evidencia}
                onChange={(e) => setEvidencia(e.target.value)}
                placeholder="amostra-100-consentimentos.csv"
              />
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                disabled={!verificadoPor.trim() || !atingiu || !evidencia.trim()}
                onClick={() => enviar({
                  para: 'verificado', verificadoPor, eficaciaAtingida: atingiu === 'sim', evidencia,
                }, 'ach-verif')}
              >
                Registrar verificação
              </button>
            </div>
            <Recusa ancora="ach-verif" />
            <Nota tom="warn">
              <b>Não há "encerrar" nesta etapa.</b> Executar não é comprovar que resolveu, e a rota
              devolve <span className="mono">409</span> para <span className="mono">executado → encerrado</span>:
              é sequência errada, não conteúdo faltando. Encerrar é ato de quem verifica.
            </Nota>
          </>
        )}

        {achado.status === 'verificado' && (
          <>
            <p style={{ fontSize: 13, marginTop: 0 }}>
              Verificado por <b>{achado.verificadoPor}</b> — critério{' '}
              <b>{achado.eficaciaAtingida ? 'atingido' : 'não atingido'}</b>.
            </p>

            {achado.eficaciaAtingida ? (
              <>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn primary" onClick={() => enviar({ para: 'encerrado' }, 'ach-encerrar')}>
                    Encerrar achado
                  </button>
                </div>
                <Recusa ancora="ach-encerrar" />
              </>
            ) : (
              <Nota tom="crit">
                A verificação concluiu que o critério <b>não</b> foi atingido, e por isso encerrar não é
                oferecido aqui. A sequência estaria certa — o que falta é conteúdo, e a rota devolve{' '}
                <span className="mono">422</span> a quem tentar por fora. O caminho é reabrir.
              </Nota>
            )}

            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="ach-motivo">Motivo da reabertura (mínimo 20 caracteres)</label>
              <textarea
                id="ach-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: a execução cobriu o app e deixou o checkout web de fora, que é onde entra a maior parte."
              />
              <span className="hint">{motivo.trim().length}/20</span>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                disabled={motivo.trim().length < 20}
                onClick={() => enviar({ para: 'reaberto', motivo }, 'ach-reabrir')}
              >
                Reabrir achado
              </button>
            </div>
            <Recusa ancora="ach-reabrir" />
            <Nota>
              Reabrir eleva a criticidade e conta reincidência. A causa, o plano e o critério anteriores
              não são herdados: reincidência que recomeça do plano antigo refaz o que já falhou.
            </Nota>
          </>
        )}

        {achado.status === 'encerrado' && (
          <Nota>
            Achado encerrado com verificação independente. Retomar é registro novo, não edição deste — a
            rota devolve <span className="mono">409</span> para qualquer transição a partir daqui.
          </Nota>
        )}
      </Permitido>
    </Cartao>
  );
}

/** As provas, na ordem em que entraram, cada uma apontando para a anterior. */
function CadeiaDeCustodia({ achado }: { achado: Achado }) {
  const banco = useSessao((s) => s.banco);
  const noTrail = new Set(
    banco.auditoria
      .filter((l) => l.recursoTipo === 'achado' && l.recursoId === achado.codigo)
      .flatMap((l) => l.campos)
      .filter((c) => c.startsWith('evidencia:'))
      .map((c) => c.slice('evidencia:'.length)),
  );

  return (
    <Cartao hint="cada evidência entra no trail antes de ser anexada ao achado">
      {achado.evidencias.length === 0 ? (
        <Nota>
          Nenhuma evidência ainda. Ela entra em duas etapas — execução e verificação —, e não em
          qualquer transição: cadeia que aceita anexo em todo passo é depósito, não cadeia.
        </Nota>
      ) : (
        <Tabela cabecalho={['Etapa', 'Arquivo', 'Quem', 'Aponta para', 'Hash']}>
          {achado.evidencias.map((e) => (
            <tr key={e.hash}>
              <td>{ROTULO[e.etapa]}</td>
              <td className="mono">{e.arquivo}</td>
              <td>{e.por}</td>
              <td className="hash">{e.hashAnterior ? curto(e.hashAnterior) : <span className="hint">primeira da cadeia</span>}</td>
              <td className="hash">
                {curto(e.hash)}
                {noTrail.has(e.hash) && <span className="hint"> · no trail</span>}
              </td>
            </tr>
          ))}
        </Tabela>
      )}
      <Nota>
        O hash da evidência é gravado no audit trail <b>antes</b> de o estado mudar. Se o registro
        falhar, a resposta falha com <span className="mono">503</span> e o achado fica sem o anexo e sem
        o estado novo — a alternativa seria um artefato carregando prova que o trail desconhece.
      </Nota>
    </Cartao>
  );
}
