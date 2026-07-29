import { sha256, hashCpf, hashEncadeado } from '../lib/sha256';
import { aplicar } from './decisoes';
import type { Obrigacao, Trilha, TipoObrigacao } from './calendario';
import type { Epico, Papel, Ripd } from './types';

import type { Decisao, DecisaoRegistrada, TabelaId, Valor } from './decisoes';
import type {
  Achado, Campo, Cenario, Incidente, LinddunItem, Parecer, Maturidade, Risco, Solicitacao, Titular,
} from './types';

/**
 * PR 8 — decisão semeada é **aplicação passada da tabela**, não texto escrito à
 * mão. A saída sai de `aplicar()` com a versão que era vigente na data, e por
 * isso o `reproduzir()` da semente confere como o de qualquer decisão gravada
 * pela rota. Redigitar a saída aqui produziria exatamente a prova que este PR
 * existe para não aceitar.
 */
const gravada = (d: Decisao, quando: string): DecisaoRegistrada => ({ ...d, quando });

const decidido = (
  tabela: TabelaId, entradas: Record<string, Valor | undefined>, versao: number, quando: string,
): DecisaoRegistrada => gravada(aplicar(tabela, entradas, versao), quando);

/** A D2 aplicada ao risco com o P × I que ele tinha quando foi avaliado. */
const comD2 = (r: Risco): Risco => ({
  ...r,
  decisoes: [decidido('d2', {
    probabilidade: r.probabilidade, impacto: r.impacto, score: r.probabilidade * r.impacto,
  }, 1, '2026-06-02T09:15:00Z')],
});

const DIA = 86_400_000;
const HORA = 3_600_000;

/**
 * Os seis rótulos LINDDUN que o template `.privacy/threat-model.md` desta
 * organização usa. Não são as sete categorias canônicas — a equivalência fica
 * explícita ao lado de cada um para que o modelo continue comparável fora de casa.
 */
export const LINDDUN_BASE: LinddunItem[] = [
  { chave: 'location', rotulo: 'Location', canonico: 'Identifiability por geolocalização', ativo: false,
    mitigacao: 'Truncar coordenadas para o centroide do município antes de qualquer persistência.' },
  { chave: 'inference', rotulo: 'Inference', canonico: 'Detectability', ativo: true,
    mitigacao: 'Remover features proxy (CEP, nome da mãe, canal de atendimento) do conjunto de treino.' },
  { chave: 'disclosure', rotulo: 'Disclosure', canonico: 'Disclosure of information', ativo: true,
    mitigacao: 'DTO por escopo com allowlist de campos; nenhuma entidade do ORM é serializada direta.' },
  { chave: 'discrimination', rotulo: 'Discrimination', canonico: 'Non-compliance (Art. 6º, IX)', ativo: true,
    mitigacao: 'Teste de disparate impact com limiar 0,8–1,2 bloqueando o release do modelo.' },
  { chave: 'unauthorized', rotulo: 'Unauthorized', canonico: 'Linkability + Identifiability', ativo: true,
    mitigacao: 'Autorização por objeto com checagem de posse; 404 uniforme em vez de 403.' },
  { chave: 'nonrepudiation', rotulo: 'Non-repudiation', canonico: 'Non-repudiation', ativo: true,
    mitigacao: 'audit_log append-only com hash encadeado e finalidade obrigatória por acesso.' },
];

const RACI = [
  { processo: 'Definição de base legal', letras: { DPO: 'A', Jurídico: 'C', Segurança: 'I', Engenharia: 'I', Produto: 'C', Dados: 'I' } },
  { processo: 'LINDDUN / threat model', letras: { DPO: 'C', Jurídico: 'I', Segurança: 'C', Engenharia: 'A', Produto: 'I', Dados: 'I' } },
  { processo: 'LIA', letras: { DPO: 'A', Jurídico: 'C', Segurança: 'I', Engenharia: 'I', Produto: 'C', Dados: 'I' } },
  { processo: 'SCC / DPA com terceiros', letras: { DPO: 'C', Jurídico: 'A', Segurança: 'C', Engenharia: 'I', Produto: 'I', Dados: 'I' } },
  { processo: 'Controle técnico', letras: { DPO: 'I', Jurídico: 'I', Segurança: 'C', Engenharia: 'A', Produto: 'I', Dados: 'C' } },
  { processo: 'Resposta a incidente', letras: { DPO: 'C', Jurídico: 'C', Segurança: 'A', Engenharia: 'C', Produto: 'I', Dados: 'I' } },
  { processo: 'Atendimento a titular', letras: { DPO: 'A', Jurídico: 'I', Segurança: 'I', Engenharia: 'C', Produto: 'I', Dados: 'C' } },
] as Cenario['raci'];

const maturidade = (g: number, i: number, c: number, co: number, p: number): Maturidade[] => [
  { dominio: 'Governar', score: g, anterior: g - 1, evidencias: ['RACI publicado e revisado no comitê', 'Ata mensal com decisões rastreadas'] },
  { dominio: 'Identificar', score: i, anterior: i - 1, evidencias: ['ROPA gerado do catálogo', 'Linhagem registrada nos pipelines'] },
  { dominio: 'Controlar', score: c, anterior: c, evidencias: ['TTL definido na maioria dos datasets', 'RLS ainda pendente no banco core'] },
  { dominio: 'Comunicar', score: co, anterior: co, evidencias: ['Portal de direitos em produção', 'Aviso de privacidade sem versionamento'] },
  { dominio: 'Proteger', score: p, anterior: p - 1, evidencias: ['Envelope encryption com DEK por registro', 'Rotação trimestral automatizada'] },
];

/** Os dez riscos variam de setor apenas nos dois primeiros; o resto é dívida comum. */
const riscosComuns = (r1: Risco, r2: Risco): Risco[] => [
  // R1 entra sem decisão de propósito: é o risco que a T5 abre selecionado, e o
  // estado "nenhuma D2 aplicada" precisa existir na tela como existe no dado.
  r1, comD2(r2),
  ...([
  { codigo: 'R3', descricao: 'Transferência internacional sem mecanismo do Art. 33', probabilidade: 2, impacto: 5, dano: 'perda_de_controle', danoTexto: 'Dado sai do país sem SCC nem decisão de adequação', tratamento: 'Contrato DPA + cláusulas-padrão da ANPD', tipo: 'mitigar', esforcoSprints: 0.25, dono: '@juridico-ana', dominio: 'Jurídico', prazo: '08/08', reavaliacao: '08/11', status: 'mitigado' },
  { codigo: 'R4', descricao: 'Retenção além do necessário', probabilidade: 4, impacto: 3, dano: 'perda_de_controle', danoTexto: 'Acúmulo de dado pessoal sem finalidade ativa', tratamento: 'TTL policies + job de expurgo diário', tipo: 'mitigar', esforcoSprints: 1, dono: '@sre-carlos', dominio: 'SRE', prazo: '15/08', reavaliacao: '15/11', status: 'mitigado' },
  { codigo: 'R5', descricao: 'PII em log de produção', probabilidade: 5, impacto: 3, dano: 'perda_de_controle', danoTexto: 'Exposição do titular em qualquer incidente de log', tratamento: 'Middleware de redação + redator no coletor', tipo: 'mitigar', esforcoSprints: 0.5, dono: '@sre-lucas', dominio: 'SRE', prazo: '01/08', reavaliacao: '01/11', status: 'mitigado' },
  { codigo: 'R6', descricao: 'Tracking de terceiro ligado por padrão', probabilidade: 3, impacto: 4, dano: 'perda_de_controle', danoTexto: 'Rastreamento sem consentimento livre e informado', tratamento: 'Feature flag default false + gate no CI', tipo: 'mitigar', esforcoSprints: 1, dono: '@eng-pedro', dominio: 'Engenharia', prazo: '22/08', reavaliacao: '22/11', status: 'em_tratamento' },
  { codigo: 'R7', descricao: 'Legítimo interesse sem LIA documentada', probabilidade: 4, impacto: 2, dano: 'perda_de_controle', danoTexto: 'Tratamento sem balanceamento demonstrável', tratamento: 'Preencher e assinar a LIA vinculada', tipo: 'mitigar', esforcoSprints: 0.5, dono: '@dpo-marcela', dominio: 'DPO', prazo: '15/08', reavaliacao: '15/11', status: 'mitigado' },
  { codigo: 'R8', descricao: 'Ausência de RLS no banco principal', probabilidade: 2, impacto: 5, dano: 'material', danoTexto: 'Conta comprometida acessa a base inteira', tratamento: 'RLS por tenant + RBAC por finalidade', tipo: 'mitigar', esforcoSprints: 2, dono: '@seg-rita', dominio: 'Segurança', prazo: '29/08', reavaliacao: '29/11', status: 'em_tratamento' },
  { codigo: 'R9', descricao: 'Revogação sem cascata de eliminação', probabilidade: 3, impacto: 4, dano: 'perda_de_controle', danoTexto: 'Titular revoga e o dado permanece nos sistemas a jusante', tratamento: 'Job de eliminação por escopo + webhook a parceiros', tipo: 'mitigar', esforcoSprints: 2, dono: '@eng-maria', dominio: 'Engenharia', prazo: '22/08', reavaliacao: '22/11', status: 'identificado' },
  { codigo: 'R10', descricao: 'Backup sem criptografia gerenciada', probabilidade: 1, impacto: 5, dano: 'perda_de_controle', danoTexto: 'Restauração devolve dado já eliminado', tratamento: 'Habilitar SSE-KMS nos snapshots', tipo: 'mitigar', esforcoSprints: 1, dono: '@sre-carlos', dominio: 'SRE', prazo: '08/08', reavaliacao: '08/11', status: 'mitigado' },
  ] as Risco[]).map(comD2),
];

/**
 * PR 10 — o ano provisionado, o mesmo para os três cenários: o ciclo do programa
 * não muda de setor.
 *
 * As datas são fixadas no **ano corrente** para que a grade de doze meses sempre
 * faça sentido, e o que já passou nasce cumprido — o calendário de um programa
 * em andamento tem primeiro semestre executado. Derivar "cumprida" da data seria
 * outra coisa e seria errada: passar do prazo não cumpre obrigação nenhuma.
 */
const ANO = new Date().getFullYear();

const obr = (
  n: number, mes: number, dia: number, trilha: Trilha, tipo: TipoObrigacao,
  curto: string, titulo: string, antecedenciaDias: number, cargaDias: number,
  responsavel: Papel, tela: string, preparar: string, seFalhar: string,
): Obrigacao => {
  const vence = `${ANO}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const passou = new Date(`${vence}T12:00:00Z`).getTime() < Date.now();
  return {
    codigo: `OBR-${ANO}-${String(n).padStart(2, '0')}`,
    titulo, curto, trilha, tipo, vence, antecedenciaDias, preparar, seFalhar,
    cargaDias, responsavel, tela,
    ...(passou ? { cumpridaEm: vence } : {}),
  };
};

const agendaPadrao = (): Obrigacao[] => [
  obr(1, 0, 20, 'ciclo', 'compromisso', 'Indicadores Q4', 'Revisão trimestral de indicadores (Q4 anterior)', 5, 5, 'dpo', '/t1',
    'Material do comitê fechado 5 dias antes', 'o comitê decide sem número novo — a decisão vira opinião'),
  obr(2, 1, 18, 'vencimento', 'prazo', 'Reavaliar R2', 'Reavaliação de R2 · decisão automatizada', 15, 3, 'dpo', '/t5',
    'Aviso ao dono do risco 15 dias antes', 'risco aceito segue vigente sem revisão — reincidência em auditoria'),
  obr(3, 2, 10, 'legal', 'prazo', 'Consentimento v3', 'Revalidar consentimento v3 · biometria facial', 60, 6, 'dpo', '/t2',
    'Campanha de revalidação aberta 60 dias antes', 'o campo perde base legal e o gate bloqueia dois repositórios'),
  obr(4, 2, 24, 'capacitacao', 'compromisso', 'Trilha técnica', 'Treinamento das squads — minimização, log e retenção', 30, 8, 'engenharia', '/t1',
    'Turmas abertas 30 dias antes', 'achados de gate voltam a subir; é o indicador que mede'),
  obr(5, 3, 20, 'ciclo', 'compromisso', 'Indicadores Q1', 'Revisão trimestral de indicadores (Q1)', 5, 5, 'dpo', '/t1',
    'Material do comitê fechado 5 dias antes', 'perde-se a chance de corrigir o roadmap no meio do ciclo'),
  obr(6, 3, 28, 'vencimento', 'prazo', 'RIPD do ano anterior', 'Revisão anual do RIPD do ciclo anterior', 30, 6, 'engenharia', '/t3',
    'Revisão abre 30 dias antes', 'RIPD desatualizado não sustenta o tratamento em fiscalização'),
  obr(7, 4, 15, 'vencimento', 'prazo', 'Rotação de chave', 'Rotação anual da chave de PII de cobrança', 20, 5, 'engenharia', '/t7',
    'Janela de canary agendada 20 dias antes', 'chave vencida não quebra nada: para de proteger em silêncio'),
  obr(8, 4, 26, 'auditoria', 'compromisso', 'Tabletop', 'Teste do plano de resposta a incidente (tabletop)', 10, 4, 'seguranca', '/t9',
    'Cenário escrito 10 dias antes', 'o plano só é testado no dia do incidente real'),
  obr(9, 5, 12, 'legal', 'prazo', 'LIA vence', 'Vencimento da LIA vinculada ao legítimo interesse', 60, 6, 'dpo', '/t8',
    'Renovação aberta 60 dias antes', 'campos vinculados perdem base legal e o gate bloqueia'),
  obr(10, 5, 25, 'auditoria', 'compromisso', 'Auditoria interna', 'Auditoria interna semestral do programa', 15, 10, 'dpo', '/t6',
    'Pacote de evidências pronto 15 dias antes', 'achado velho reaparece como reincidência'),
  obr(11, 6, 17, 'ciclo', 'compromisso', 'Indicadores Q2', 'Revisão trimestral de indicadores (Q2)', 5, 5, 'dpo', '/t1',
    'Material do comitê fechado 5 dias antes', 'sem leitura de meio de ano o ciclo fecha no escuro'),
  obr(12, 6, 31, 'ciclo', 'compromisso', 'Diagnóstico AS-IS', 'Diagnóstico AS-IS do ciclo (20 dias úteis)', 15, 20, 'engenharia', '/t1',
    'Entrevistas agendadas 15 dias antes', 'o roadmap do ano seguinte nasce sem linha de base'),
  obr(13, 7, 14, 'ciclo', 'compromisso', 'Matriz e roadmap', 'Matriz de riscos consolidada e roadmap ao comitê', 5, 12, 'dpo', '/t5',
    'Pauta distribuída 5 dias antes', 'riscos altos entram no ano sem dono nem orçamento'),
  obr(14, 7, 27, 'ciclo', 'compromisso', 'Políticas', 'Revisão de políticas, procedimentos e templates', 20, 8, 'dpo', '/t1',
    'Minuta ao jurídico 20 dias antes', 'template que ninguém consegue preencher continua em vigor'),
  obr(15, 8, 16, 'vencimento', 'prazo', 'Rotação biometria', 'Rotação da chave de biometria', 20, 5, 'seguranca', '/t7',
    'Janela de canary agendada 20 dias antes', 'a chave da biometria é a que sustenta o cripto-shredding'),
  obr(16, 8, 29, 'capacitacao', 'compromisso', 'Alta direção', 'Sessão de privacidade com a alta direção', 30, 4, 'dpo', '/t1',
    'Convite enviado 30 dias antes', 'o aceite de risco continua sendo assinado sem contexto'),
  obr(17, 9, 19, 'ciclo', 'compromisso', 'Indicadores Q3', 'Revisão trimestral de indicadores (Q3)', 5, 5, 'dpo', '/t1',
    'Material do comitê fechado 5 dias antes', 'desvio do trimestre chega junto com o fechamento'),
  obr(18, 9, 30, 'ciclo', 'compromisso', 'Orçamento', 'Aprovação de roadmap e orçamento do próximo ciclo', 15, 10, 'dpo', '/t1',
    'Proposta entregue 15 dias antes', 'o programa começa o ano seguinte sem pessoas nem ferramenta'),
  obr(19, 10, 13, 'vencimento', 'prazo', 'RIPD do ciclo', 'Revisão anual do RIPD do ciclo corrente', 30, 6, 'engenharia', '/t3',
    'Revisão abre 30 dias antes', 'o RIPD do modelo envelhece com o modelo mudando'),
  obr(20, 10, 24, 'auditoria', 'compromisso', 'Auditoria externa', 'Janela de auditoria externa', 20, 15, 'dpo', '/t6',
    'Dossiê pronto 20 dias antes', 'evidência montada às pressas não sustenta o encerramento'),
  obr(21, 11, 11, 'legal', 'prazo', 'Expurgo anual', 'Expurgo anual verificado + relatório com hash', 10, 8, 'engenharia', '/t6',
    'Simulação do expurgo 10 dias antes', 'dado que devia ter sido eliminado entra no ano seguinte'),
  obr(22, 11, 19, 'ciclo', 'compromisso', 'Fechamento', 'Fechamento de indicadores e maturidade do ciclo', 10, 8, 'dpo', '/t1',
    'Consolidação iniciada 10 dias antes', 'sem fechamento não há comparação entre ciclos'),
];

const expurgoPadrao = (sistema: string, tabelas: [string, ExpurgoMetodo, number][]) => {
  const entradas = tabelas.map(([tabela, metodo, registros], i) => ({
    sistema, tabela, metodo, registros,
    hashPre: sha256(`${sistema}:${tabela}:pre:${i}`).slice(0, 16),
    hashPos: sha256(`${sistema}:${tabela}:pos:${i}`).slice(0, 16),
    verificado: i < tabelas.length - 1,
  }));
  return entradas;
};
type ExpurgoMetodo = 'hard_delete' | 'crypto_shredding' | 'anonimizacao' | 'compactacao_log';

const metricas = (ropa: number, sla: number, logs: number, ripd: number): Cenario['metricas'] => [
  { chave: 'ropa', rotulo: 'Cobertura do ROPA', valor: ropa, anterior: ropa - 7.1, unidade: 'percentual', meta: 90, melhorQuandoSobe: true, serie: [ropa - 14, ropa - 11, ropa - 7.1, ropa - 3, ropa] },
  { chave: 'sla', rotulo: 'SLA médio de titulares', valor: sla, anterior: sla + 7.5, unidade: 'horas', meta: 120, melhorQuandoSobe: false, serie: [sla + 18, sla + 12, sla + 7.5, sla + 2, sla] },
  { chave: 'logs', rotulo: 'Serviços com log sem PII', valor: logs, anterior: logs - 4, unidade: 'percentual', meta: 95, melhorQuandoSobe: true, serie: [logs - 12, logs - 9, logs - 4, logs - 1, logs] },
  { chave: 'ripd', rotulo: 'RIPD pendentes', valor: ripd, anterior: ripd + 3, unidade: 'contagem', meta: 5, melhorQuandoSobe: false, serie: [ripd + 5, ripd + 4, ripd + 3, ripd + 1, ripd] },
];

/**
 * T4-05 — o rótulo de conclusão é derivado do instante, nunca digitado ao lado
 * dele. Data escrita à mão ao lado de um carimbo relativo é exatamente como
 * "atendidas no SLA" passou a medir outra coisa.
 */
const emDia = (ms: number) => new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });


/**
 * C-07 — o incidente nasce em `aberto` para a máquina de estados ser
 * exercitável no protótipo. `camposIds` aponta para o catálogo: escopo de
 * incidente é lido do inventário, nunca digitado.
 */
const incidentePadrao = (camposIds: string[], riscoCodigo: string, ripdId: string): Incidente[] => [{
  id: 'INC-2026-003',
  estado: 'aberto',
  detectadoEm: new Date(Date.now() - 6 * HORA - 12 * 60_000).toISOString(),
  origem: 'alerta de volume · API de cobrança',
  camposIds,
  titularesEstimados: 4118,
  riscoCodigo,
  ripdId,
}];

/**
 * PR 7 — parecer e achado ganham identidade para as máquinas deles serem
 * exercitáveis. Nascem no primeiro estado, como o incidente.
 */
/**
 * PR 11 — um RIPD dispensado por cenário, para a dispensa ser demonstrável.
 *
 * Nasce com o gatilho declarado e sem disparo. É o segundo RIPD do cenário: o
 * primeiro está em revisão e é o que a T3 abre. Dispensa não gera item de fila
 * — é justamente o estado que não pede ação de ninguém, e é isso que faz o
 * gatilho ser a única coisa que a reabre.
 */
const ripdDispensadoPadrao = (codigo: string, sistema: string, prNumero: number): Ripd => ({
  id: 'r2', codigo, titulo: 'Relatório de sessão agregado por região', sistema, prNumero,
  headSha: 'f0e9d8c',
  contexto: 'Painel interno com contagem de sessões por região, sem identificador de titular.',
  foraDeEscopo: 'Qualquer quebra por titular, por dispositivo ou por faixa etária.',
  fluxoMermaid: 'graph LR\n  A[Eventos] --> B(Agregador k>=50)\n  B --> C[Painel]',
  camposIds: [], operacoes: [], recomendacoes: [], triggers: [],
  volumeTitulares: 0, status: 'dispensado', linddun: LINDDUN_BASE.map((l) => ({ ...l })),
  dispensas: [{
    justificativa: 'Agregação com k mínimo de 50 por região, sem identificador direto nem indireto; '
      + 'nenhum gatilho crítico da triagem foi acionado no diff.',
    gatilhos: [
      { codigo: 'T5', condicao: 'Quebra do agregado abaixo de k=50, que volta a permitir singularização.' },
      { codigo: 'T7', condicao: 'Cruzamento do agregado com qualquer base que tenha identificador.' },
    ],
    por: '@eng-maria', quando: '2026-05-04T10:12:00Z', disparos: [],
  }],
});

/**
 * PR 11 — o épico com o checklist de PbD.
 *
 * As marcações espelham o `.privacy/epico.yml` do repositório, e a regra que as
 * avalia é a mesma que o gate de CI usa. Um dos sete entra **marcado e sem
 * evidência** de propósito: é o caso que o produto precisa saber exibir, porque
 * é o que um checklist ingênuo contaria como pronto.
 */
const epicosPadrao = (repositorio: string, prNumero: number): Epico[] => [{
  id: 'e1', codigo: 'EPIC-2026-114', repositorio, prNumero,
  titulo: 'Coleta de evento de sessão para o painel de audiência',
  pbd: [
    { chave: 'proativo', marcado: true, evidencia: 'gate de CI barra o merge antes do deploy' },
    { chave: 'padrao', marcado: true, evidencia: 'app/src/ui/primitivos.tsx · CampoPII nasce mascarado' },
    { chave: 'embutida', marcado: true, evidencia: 'app/src/mock/estados.ts · sequência na API' },
    { chave: 'soma_positiva', marcado: true, evidencia: '' },
    { chave: 'ciclo_de_vida', marcado: true, evidencia: 'db/schema.sql · TTL e cripto-shredding' },
    { chave: 'transparencia', marcado: true, evidencia: 'app/src/mock/db.ts · cadeia verificável' },
    { chave: 'centrado_no_titular', marcado: false, evidencia: '' },
  ],
}];

const pareceresPadrao = (): Parecer[] => [
  { id: 'p1', codigo: 'PT-2026-018', ripdId: 'r1', status: 'rascunho', autor: '@eng-maria', devolucoes: 0 },
];

/**
 * PR 15 — a cadeia de custódia da semente é construída pela **mesma** função
 * que a rota usa. Digitar hashes aqui produziria uma massa que não confere pela
 * regra do produto: a T11 mostraria "cadeia íntegra" sobre números inventados.
 */
const custodia = (
  passos: { arquivo: string; por: string; etapa: Achado['status']; quando: string }[],
): Achado['evidencias'] => {
  const cadeia: Achado['evidencias'] = [];
  for (const p of passos) {
    const hashAnterior = cadeia.at(-1)?.hash ?? null;
    cadeia.push({ ...p, hashAnterior, hash: hashEncadeado(hashAnterior, p.arquivo, p.etapa) });
  }
  return cadeia;
};

/**
 * Cinco achados, um por posição do ciclo — porque uma tela que opera estados
 * com um único artefato semeado só é demonstrável depois de alguém a operar
 * inteira. E os dois `verificado` existem para a diferença que a T11 explica:
 * mesmo estado, veredito oposto, encerramento permitido num e recusado no outro.
 */
const achadosPadrao = (): Achado[] => [
  { id: 'a1', codigo: 'ACH-2026-007', descricao: 'Log de aplicação com CPF em texto claro',
    origem: 'auditoria interna · trimestre 2', status: 'aberto', criticidade: 'alta',
    reincidencias: 0, evidencias: [] },
  { id: 'a2', codigo: 'ACH-2026-011', descricao: 'Retenção de base de marketing sem prazo declarado',
    origem: 'auditoria interna · trimestre 2', status: 'plano', criticidade: 'media', reincidencias: 0,
    causaRaiz: 'O pipeline de exportação nasceu fora do inventário e ninguém declarou TTL: o dado fica porque nada o remove.',
    plano: 'Declarar o dataset no inventário com retenção de 180 dias e ligar o expurgo agendado ao mesmo TTL.',
    criterioDeEficacia: 'Duas execuções consecutivas do expurgo removendo registros acima de 180 dias, com hash pré e pós conferido.',
    evidencias: [] },
  { id: 'a3', codigo: 'ACH-2026-014', descricao: 'Chave de criptografia sem rotação há 14 meses',
    origem: 'auditoria externa · relatório anual', status: 'executado', criticidade: 'alta', reincidencias: 0,
    causaRaiz: 'A rotação era procedimento manual sem dono declarado, e o alerta de prazo apontava para uma lista que ninguém lê.',
    plano: 'Automatizar a rotação com janela de canary e alarmar o vencimento na fila de quem opera a chave.',
    criterioDeEficacia: 'Uma rotação completa executada pelo agendamento, sem intervenção manual, com o canary aprovado.',
    executadoPor: '@eng-rafael',
    evidencias: custodia([
      { arquivo: 'rotacao-2026-06.log', por: '@eng-rafael', etapa: 'executado', quando: '2026-06-18T14:02:00Z' },
    ]) },
  { id: 'a4', codigo: 'ACH-2026-002', descricao: 'Consentimento coletado sem versão de texto registrada',
    origem: 'auditoria interna · trimestre 1', status: 'verificado', criticidade: 'critica', reincidencias: 1,
    causaRaiz: 'O formulário grava o aceite e descarta a versão do texto exibido, então revogação e prova ficam sem lastro.',
    plano: 'Persistir versão e hash do texto no ato do aceite e expor os dois na trilha do titular.',
    criterioDeEficacia: 'Amostra de 100 consentimentos novos, todos com versão e hash conferindo com o texto publicado.',
    executadoPor: '@eng-maria', verificadoPor: '@dpo-marcela', eficaciaAtingida: false,
    motivoDaReabertura: 'A primeira execução cobriu o app e deixou o checkout web sem versão registrada, que é onde entra a maior parte.',
    evidencias: custodia([
      { arquivo: 'consent-versao-migracao.sql', por: '@eng-maria', etapa: 'executado', quando: '2026-05-04T11:20:00Z' },
      { arquivo: 'amostra-100-consentimentos.csv', por: '@dpo-marcela', etapa: 'verificado', quando: '2026-05-21T09:40:00Z' },
    ]) },
  { id: 'a5', codigo: 'ACH-2026-003', descricao: 'Acesso a dado pessoal sem finalidade declarada na rota de suporte',
    origem: 'auditoria interna · trimestre 1', status: 'verificado', criticidade: 'media', reincidencias: 0,
    causaRaiz: 'A rota de suporte lia o cadastro completo sem exigir finalidade, e o trail registrava o acesso sem dizer para quê.',
    plano: 'Exigir finalidade e justificativa na revelação, com o registro gravado antes da resposta.',
    criterioDeEficacia: 'Nenhum acesso a campo pessoal no trail dos últimos 30 dias sem finalidade compatível declarada.',
    executadoPor: '@eng-rafael', verificadoPor: '@auditor-externo', eficaciaAtingida: true,
    evidencias: custodia([
      { arquivo: 'suporte-finalidade.patch', por: '@eng-rafael', etapa: 'executado', quando: '2026-04-09T16:15:00Z' },
      { arquivo: 'trail-30d-sem-finalidade.csv', por: '@auditor-externo', etapa: 'verificado', quando: '2026-04-30T10:05:00Z' },
    ]) },
];

const solicitacoesPadrao = (titularIds: string[], sistemas: string[]): Solicitacao[] => {
  const agora = Date.now();
  // Mesmo instante de conclusão, prazos diferentes: s4 fecha três dias antes do
  // seu prazo, s5 fecha dois dias depois do dela. Um indicador que só sabe
  // mostrar 100% não é indicador.
  const fimS4 = agora - 8 * DIA; // prazo era agora - 5 dias → no prazo
  const fimS5 = agora - 8 * DIA; // prazo era agora - 10 dias → fora do prazo
  return [
    { id: 's1', protocolo: '2026-0731', titularId: titularIds[0], titularPseudonimo: 'hmac:9f4c…a71b', direito: 'acesso', status: 'em_analise', nivelVerificacao: 2, sistemas, recebidaEm: '18/07', prazoLimiteMs: agora + 3 * DIA + 4 * HORA, metaInternaMs: agora - 6 * HORA,
      mensagens: [
        { remetente: 'titular', corpo: 'Quero saber quais empresas receberam meus dados e por qual finalidade.', quando: '18/07 14:02' },
        { remetente: 'dpo', corpo: 'Recebido. Estou reunindo a linhagem completa; retorno até 31/07 com a relação de destinatários.', quando: '19/07 09:40' },
      ] },
    { id: 's2', protocolo: '2026-0730', titularId: titularIds[1], titularPseudonimo: 'hmac:3b81…cc02', direito: 'eliminacao', status: 'em_analise', nivelVerificacao: 3, sistemas: [sistemas[0]], recebidaEm: '14/07', prazoLimiteMs: agora + 19 * HORA, metaInternaMs: agora - 2 * DIA, mensagens: [] },
    { id: 's3', protocolo: '2026-0729', titularId: titularIds[2], titularPseudonimo: 'hmac:d20e…8f13', direito: 'revisao_decisao', status: 'em_analise', nivelVerificacao: 2, sistemas: [sistemas[0]], recebidaEm: '26/07', prazoLimiteMs: agora + 3 * DIA, metaInternaMs: agora + 2 * DIA, mensagens: [] },
    { id: 's4', protocolo: '2026-0721', titularId: titularIds[0], titularPseudonimo: 'hmac:9f4c…a71b', direito: 'portabilidade', status: 'concluida', nivelVerificacao: 2, sistemas, recebidaEm: '08/07', prazoLimiteMs: agora - 5 * DIA, metaInternaMs: agora - 9 * DIA, concluidaEm: emDia(fimS4), concluidaEmMs: fimS4, desfecho: 'atendido', mensagens: [] },
    { id: 's5', protocolo: '2026-0718', titularId: titularIds[1], titularPseudonimo: 'hmac:3b81…cc02', direito: 'correcao', status: 'concluida', nivelVerificacao: 2, sistemas: [sistemas[0]], recebidaEm: '03/07', prazoLimiteMs: agora - 10 * DIA, metaInternaMs: agora - 14 * DIA, concluidaEm: emDia(fimS5), concluidaEmMs: fimS5, desfecho: 'atendido_parcialmente', mensagens: [] },
  ];
};

/**
 * C-17 — cada campo exibível carrega `campoCatalogoId`, o vínculo com o ROPA.
 * `chave` continua sendo o rótulo de exibição e `Campo.nome` o nome técnico:
 * renomear um para casar com o outro seria consertar pelo lado errado. O que
 * liga os dois é o identificador, declarado aqui.
 */
const titular = (
  id: string, prefixo: 'b' | 'v' | 'm', cpf: string, nome: string, email: string,
  extras: { chave: string; rotulo: string; grupo: string; valor: string; mascara: string; catalogo: string; baseLegal: Titular['campos'][number]['baseLegal'] }[],
  sensiveis: { chave: string; rotulo: string; grupo: string; catalogo: string; baseLegal: Titular['campos'][number]['baseLegal'] }[],
  compart: Titular['compartilhamentos'],
  decisao?: Titular['decisao'],
): Titular => ({
  id,
  cpfHash: hashCpf(cpf),
  segredos: { cpf, nome, email, ...Object.fromEntries(extras.map((e) => [e.chave, e.valor])) },
  campos: [
    { chave: 'nome', rotulo: 'Nome', grupo: 'Identificação', sensivel: false, mascara: '•••••• •••••••', baseLegal: 'execucao_contrato', campoCatalogoId: `${prefixo}-nome` },
    { chave: 'cpf', rotulo: 'CPF', grupo: 'Identificação', sensivel: false, mascara: '•••.•••.•••-••', baseLegal: 'execucao_contrato', campoCatalogoId: `${prefixo}-cpf` },
    { chave: 'email', rotulo: 'E-mail', grupo: 'Identificação', sensivel: false, mascara: '•••••@••••••.•••', baseLegal: 'execucao_contrato', campoCatalogoId: `${prefixo}-email` },
    ...extras.map((e) => ({ chave: e.chave, rotulo: e.rotulo, grupo: e.grupo, sensivel: false, mascara: e.mascara, baseLegal: e.baseLegal, campoCatalogoId: e.catalogo })),
    ...sensiveis.map((s) => ({ chave: s.chave, rotulo: s.rotulo, grupo: s.grupo, sensivel: true, mascara: '🔒 não revelável', baseLegal: s.baseLegal, campoCatalogoId: s.catalogo })),
  ],
  compartilhamentos: compart,
  decisao,
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO 1 — Banco: crédito com IA
// ─────────────────────────────────────────────────────────────────────────────

const camposBanco: Campo[] = [
  // C-17 — campos que a T4 exibe precisam existir no ROPA. Sem entrada aqui,
  // a revelação é recusada: caminho de leitura fora do inventário faz o
  // inventário deixar de ser a fonte da verdade.
  { id: 'b-nome', sistema: 'credit-scoring', dataset: 'clientes', nome: 'nome_completo', tipoArmazenado: 'criptografado', categoria: 'pessoal', sensivel: false, finalidade: 'Identificação do titular no atendimento', finalidadesCompativeis: ['atendimento', 'cobranca', 'auditoria'], baseLegal: 'execucao_contrato', retencao: '5 anos', retencaoDias: 1825, origem: 'formulário web', compartilhamentos: [],
    linhagem: [{ etapa: 'Formulário', detalhe: 'coleta com máscara' }, { etapa: 'PostgreSQL', detalhe: 'envelope encryption' }, { etapa: 'Expurgo', detalhe: '5 anos' }] },
  { id: 'b-cpf', sistema: 'credit-scoring', dataset: 'clientes', nome: 'cpf', tipoArmazenado: 'hash', categoria: 'pessoal', sensivel: false, finalidade: 'Identificação para emissão de nota fiscal', finalidadesCompativeis: ['atendimento', 'cobranca', 'auditoria'], baseLegal: 'execucao_contrato', retencao: '5 anos', retencaoDias: 1825, origem: 'formulário web', compartilhamentos: [],
    linhagem: [{ etapa: 'Formulário', detalhe: 'coleta com máscara' }, { etapa: 'API', detalhe: 'POST, nunca na URL' }, { etapa: 'PostgreSQL', detalhe: 'hash SHA-256 + sal' }, { etapa: 'Expurgo', detalhe: '5 anos, hash pré/pós' }] },
  { id: 'b-renda', sistema: 'credit-scoring', dataset: 'clientes', nome: 'renda', tipoArmazenado: 'criptografado', categoria: 'pessoal', sensivel: false, finalidade: 'Análise de capacidade de pagamento', finalidadesCompativeis: ['cobranca', 'auditoria'], baseLegal: 'execucao_contrato', retencao: '2 anos', retencaoDias: 730, origem: 'formulário web', compartilhamentos: [],
    linhagem: [{ etapa: 'Formulário', detalhe: 'campo obrigatório' }, { etapa: 'API', detalhe: 'DTO por escopo' }, { etapa: 'PostgreSQL', detalhe: 'envelope encryption' }, { etapa: 'Expurgo', detalhe: '2 anos' }] },
  { id: 'b-score', sistema: 'credit-scoring', dataset: 'clientes', nome: 'score_serasa', tipoArmazenado: 'criptografado', categoria: 'pessoal', sensivel: false, finalidade: 'Risco de inadimplência', finalidadesCompativeis: ['cobranca', 'auditoria'], baseLegal: 'protecao_credito', retencao: '90 dias', retencaoDias: 90, origem: 'API Serasa',
    compartilhamentos: [{ destino: 'Serasa', finalidade: 'Consulta de score', internacional: false, mecanismo: 'nao_aplicavel' }],
    linhagem: [{ etapa: 'Serasa', detalhe: 'consulta autorizada', externo: true }, { etapa: 'API', detalhe: 'cache de 24h' }, { etapa: 'PostgreSQL', detalhe: 'envelope encryption' }, { etapa: 'Expurgo', detalhe: '90 dias' }] },
  { id: 'b-hist', sistema: 'credit-scoring', dataset: 'clientes', nome: 'historico_compras', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, finalidade: 'Enriquecimento do modelo de scoring', finalidadesCompativeis: ['auditoria'], baseLegal: 'legitimo_interesse', liaCodigo: 'LIA-SCORING-001', retencao: '180 dias', retencaoDias: 180, origem: 'eventos de transação',
    compartilhamentos: [{ destino: 'OpenAI', finalidade: 'Enriquecimento textual do modelo', internacional: true, pais: 'EUA', mecanismo: 'clausulas_padrao_anpd', evidencia: 'dpa/openai-scc.pdf' }],
    linhagem: [{ etapa: 'Transações', detalhe: 'eventos agregados' }, { etapa: 'Pseudonimizador', detalhe: 'HMAC + KMS' }, { etapa: 'OpenAI', detalhe: 'EUA · SCC ANPD', externo: true }, { etapa: 'Decisão', detalhe: 'SHAP registrado' }, { etapa: 'Expurgo', detalhe: '180 dias' }] },
  { id: 'b-shap', sistema: 'credit-scoring', dataset: 'decisoes_ia', nome: 'shap_values', tipoArmazenado: 'agregado', categoria: 'anonimizado', sensivel: false, finalidade: 'Explicabilidade da decisão (Art. 20)', finalidadesCompativeis: ['auditoria'], baseLegal: 'protecao_credito', retencao: '90 dias', retencaoDias: 90, origem: 'modelo de scoring', compartilhamentos: [],
    linhagem: [{ etapa: 'Modelo', detalhe: 'saída agregada' }, { etapa: 'PostgreSQL', detalhe: 'sem identificador direto' }, { etapa: 'Expurgo', detalhe: '90 dias' }] },
  { id: 'b-bio', sistema: 'onboarding', dataset: 'cadastros', nome: 'biometria_facial', tipoArmazenado: 'criptografado', categoria: 'sensivel', sensivel: true, finalidade: 'Prova de vida no onboarding', finalidadesCompativeis: [], baseLegal: 'consentimento', retencao: '30 dias', retencaoDias: 30, origem: 'app mobile', compartilhamentos: [],
    linhagem: [{ etapa: 'App', detalhe: 'captura com consentimento destacado' }, { etapa: 'KMS', detalhe: 'DEK por titular' }, { etapa: 'Cripto-shredding', detalhe: '30 dias' }] },
  { id: 'b-email', sistema: 'onboarding', dataset: 'cadastros', nome: 'email', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, finalidade: 'Comunicação transacional', finalidadesCompativeis: ['atendimento'], baseLegal: 'execucao_contrato', retencao: 'até revogação', retencaoDias: null, origem: 'formulário web',
    compartilhamentos: [{ destino: 'SendGrid', finalidade: 'Entrega de e-mail transacional', internacional: true, pais: 'EUA', mecanismo: 'clausulas_padrao_anpd', evidencia: 'dpa/sendgrid-scc.pdf' }],
    linhagem: [{ etapa: 'Formulário', detalhe: 'dupla confirmação' }, { etapa: 'SendGrid', detalhe: 'EUA · SCC ANPD', externo: true }, { etapa: 'Expurgo', detalhe: 'na revogação' }] },
];

const banco: Cenario = {
  id: 'banco',
  nome: 'Crédito IA S.A.',
  setor: 'Serviços financeiros',
  descricao: 'Concessão de crédito com decisão automatizada e enriquecimento por LLM externo. O risco dominante é o Art. 20: decisão sem revisão humana e discriminação algorítmica.',
  sistemas: [
    { slug: 'credit-scoring', nome: 'Scoring de crédito', repositorio: 'danzeroum/credit-scoring', timeDono: '@squad-credito', temInventario: true },
    { slug: 'onboarding', nome: 'Onboarding e cadastro', repositorio: 'danzeroum/onboarding', timeDono: '@squad-growth', temInventario: true },
    { slug: 'analytics', nome: 'Pipeline analítico', repositorio: 'danzeroum/analytics', timeDono: '@squad-dados', temInventario: false },
  ],
  campos: camposBanco,
  obrigacoes: agendaPadrao(),
  epicos: epicosPadrao('danzeroum/credit-scoring', 1234),
  pareceres: pareceresPadrao(),
  achados: achadosPadrao(),
  incidentes: incidentePadrao(['b-cpf', 'b-nome', 'b-hist'], 'R09', 'r1'),
  consentimentos: [
    { campoId: 'b-bio', versao: 'v3', texto: 'Autorizo o uso da minha imagem facial para verificação de identidade na abertura de conta.',
      coletadoEm: '14/03/2026', canal: 'app iOS', hash: sha256('consent-b-bio-v3').slice(0, 16),
      estado: 'ativo', titulares: 8412 },
  ],
  gates: [
    { id: 'g1', workflow: 'privacy-ci-gate', repositorio: 'credit-scoring', prNumero: 1234, prTitulo: 'feat: scoring v2 com LLM', prAutor: '@maria.silva', headSha: 'a1b2c3d', conclusao: 'failure', bloqueouMerge: true, runUrl: 'https://github.com/danzeroum/credit-scoring/actions/runs/1234', quando: 'há 4 h', ripdId: 'r1',
      findings: [
        { regra: 'pii_em_log', arquivo: 'src/models/credit_model.py', linha: 38, severidade: 'critica', mensagemBruta: "Error: Process completed with exit code 1. grep matched '(cpf|cnpj|cartao|email).*logger'", mensagemHumana: 'Este PR envia CPF para o log da aplicação. Log é banco de dados pessoal: entra no ROPA e fica visível para todo mundo com acesso ao Kibana.', comoCorrigir: 'Passe a chamada pelo privacy-redactor.ts ou logue o UUID do cliente.' },
        { regra: 'schema_sem_base_legal', arquivo: '.privacy/data-inventory.product.yaml', linha: 52, severidade: 'alta', mensagemBruta: "ValidationError: field 'historico_compras' missing required property 'base_legal'", mensagemHumana: 'O campo historico_compras entrou no catálogo sem base legal — não aparece no ROPA e a auditoria não consegue justificar o tratamento.', comoCorrigir: 'Declare base_legal no YAML. Se for legítimo interesse, vincule uma LIA vigente.' },
      ] },
    { id: 'g2', workflow: 'architecture-review', repositorio: 'credit-scoring', prNumero: 1234, prTitulo: 'feat: scoring v2 com LLM', prAutor: '@maria.silva', headSha: 'a1b2c3d', conclusao: 'action_required', bloqueouMerge: true, runUrl: 'https://github.com/danzeroum/credit-scoring/actions/runs/1235', quando: 'há 4 h', ripdId: 'r1', findings: [] },
    { id: 'g3', workflow: 'privacy-ci-gate', repositorio: 'onboarding', prNumero: 88, prTitulo: 'fix: máscara no formulário de cadastro', prAutor: '@pedro.lima', headSha: 'f7e6d5c', conclusao: 'success', bloqueouMerge: false, runUrl: '#', quando: 'há 9 h', findings: [] },
    { id: 'g4', workflow: 'privacy-ci-gate', repositorio: 'analytics', prNumero: 307, prTitulo: 'chore: nova coluna em fact_eventos', prAutor: '@squad-dados', headSha: 'c4d5e6f', conclusao: 'neutral', bloqueouMerge: false, runUrl: '#', quando: 'há 6 h',
      findings: [{ regra: 'linddun_ausente', arquivo: '.privacy/threat-model.md', severidade: 'baixa', mensagemBruta: 'Warning: threat-model.md not updated for changed paths', mensagemHumana: 'A nova coluna mudou o fluxo de dados, mas o threat model continua na versão anterior.', comoCorrigir: 'Revise as categorias LINDDUN e gere o diagrama atualizado.' }] },
  ],
  ripds: [{
    id: 'r1', codigo: 'RIPD-2026-014', titulo: 'Scoring de crédito v2 com LLM externo', sistema: 'credit-scoring', prNumero: 1234, headSha: 'a1b2c3d',
    contexto: 'API de scoring v2.3.1, frontend web v1.8.0, DAG-credit-v3 e serviço de decisão via OpenAI gpt-4o.',
    foraDeEscopo: 'App mobile v1.2.0 (não integra scoring) e CRM de cobrança (ROPA próprio).',
    fluxoMermaid: 'graph LR\n  A[Proposta] --> B(Pseudonimizador)\n  B --> C[gpt-4o]\n  C --> D[Decisão]\n  D --> E[Revisão humana]',
    camposIds: ['b-cpf', 'b-renda', 'b-score', 'b-hist'],
    operacoes: [
      { operacao: 'POST /auth/cadastrar', finalidade: 'Criar conta', baseLegal: 'execucao_contrato' },
      { operacao: 'POST /creditos/avaliar', finalidade: 'Decidir concessão', baseLegal: 'protecao_credito' },
      { operacao: 'DAG credit-v3', finalidade: 'Enriquecer modelo', baseLegal: 'legitimo_interesse', liaCodigo: 'LIA-SCORING-001' },
      { operacao: 'GET /me/dados', finalidade: 'Direito de acesso', baseLegal: 'obrigacao_legal' },
    ],
    recomendacoes: [
      { prioridade: 'P0', descricao: 'Pseudonimizar CPF antes do LLM', dono: '@eng-maria', prazo: '04/08', concluida: true },
      { prioridade: 'P0', descricao: 'Publicar endpoint de revisão de decisão', dono: '@eng-maria', prazo: '11/08', concluida: false },
      { prioridade: 'P0', descricao: 'Assinar SCC da ANPD com a OpenAI', dono: '@juridico-ana', prazo: '04/08', concluida: true },
      { prioridade: 'P1', descricao: 'Teste de disparate impact no pipeline do modelo', dono: '@ml-joao', prazo: '18/08', concluida: false },
    ],
    triggers: [
      { codigo: 'T1', evidencias: ['CPF interpolado no prompt (credit_model.py:38)'] },
      { codigo: 'T3', evidencias: ['/creditos/avaliar retorna aprovado/reprovado'] },
      { codigo: 'T6', evidencias: ['dependência openai, modelo gpt-4o'] },
      { codigo: 'T8', evidencias: ['processamento em us-east-1'] },
    ],
    volumeTitulares: 1_200_000,
    status: 'em_revisao',
    // Gravada em março, quando d1@1 era a vigente. A publicação de d1@2 em julho
    // não mexe nesta linha: a decisão continua dizendo por qual regra foi tomada,
    // e é a T3 que mostra o que a versão de hoje responderia.
    decisoes: [
      decidido('d1', {
        categoria: 'pessoal', volumeTitulares: 1_200_000,
        decisaoAutomatizada: true, transferenciaInternacional: true,
      }, 1, '2026-03-12T14:02:00Z'),
      decidido('d3', {
        gatilhos: ['T1', 'T3', 'T6', 'T8'], gatilhosCriticos: 2, gatilhosTotal: 4,
      }, 1, '2026-03-12T14:02:10Z'),
    ],
    linddun: LINDDUN_BASE.map((l) => ({ ...l })),
  },
  ripdDispensadoPadrao('RIPD-2026-021', 'analytics', 1240)],
  riscos: riscosComuns(
    { codigo: 'R1', descricao: 'Vazamento de CPF via prompt do LLM', probabilidade: 4, impacto: 5, dano: 'material', danoTexto: 'Crédito negado indevidamente e exposição do documento fora do perímetro', tratamento: 'Pseudonimização HMAC pré-prompt + SCC com a OpenAI', tipo: 'mitigar', esforcoSprints: 1, dono: '@eng-maria', dominio: 'Engenharia', prazo: '15/08', reavaliacao: '15/11', status: 'em_tratamento', ripdCodigo: 'RIPD-2026-014' },
    { codigo: 'R2', descricao: 'Decisão automatizada sem canal de revisão', probabilidade: 3, impacto: 5, dano: 'discriminacao', danoTexto: 'Discriminação algorítmica sem via de contestação (Art. 20)', tratamento: 'Endpoint /revisao + teste de disparidade no CI', tipo: 'mitigar', esforcoSprints: 2, dono: '@dpo-marcela', dominio: 'DPO', prazo: '29/08', reavaliacao: '29/11', status: 'em_tratamento', ripdCodigo: 'RIPD-2026-014' },
  ),
  lias: [{
    id: 'l1', codigo: 'LIA-SCORING-001', titulo: 'Enriquecimento do modelo de scoring com histórico de compras',
    finalidade: 'Elevar a acurácia do scoring para reduzir recusa indevida de crédito a titulares com histórico de pagamento consistente.',
    categoria: 'Análise de crédito', beneficio: 3, danoTitular: 2, expectativa: 'media',
    alternativas: [
      { alternativa: 'Anonimização', situacao: 'rejeitado', justificativa: 'A agregação com k-anonimato destrói o sinal individual: queda de 31 p.p. de AUC no teste de jul/2026.' },
      { alternativa: 'Pseudonimização', situacao: 'atendido', justificativa: 'CPF vira token HMAC-SHA256 com chave no KMS antes de qualquer uso analítico ou envio ao LLM.' },
      { alternativa: 'Escopo menor', situacao: 'atendido', justificativa: 'Removidas as features cep, nome_mae e canal_atendimento por serem proxies discriminatórios.' },
      { alternativa: 'Retenção menor', situacao: 'atendido', justificativa: 'Janela reduzida de 24 para 6 meses de histórico, com perda de apenas 1,2 p.p. de AUC.' },
      { alternativa: 'Agregação', situacao: 'nao_aplicavel', justificativa: 'A decisão é individual por titular; dado agregado não sustenta a finalidade.' },
      { alternativa: 'Consentimento', situacao: 'rejeitado', justificativa: 'Condicionaria a análise de crédito à aceitação, tornando o consentimento não livre.' },
    ],
    evidencias: [
      { arquivo: 'lia-001-log.txt', tipo: 'log redigido', hash: sha256('lia-001-log').slice(0, 16) },
      { arquivo: 'lia-001-ttl.sql', tipo: 'política de retenção', hash: sha256('lia-001-ttl').slice(0, 16) },
    ],
    camposIds: ['b-hist'], status: 'vigente', vigenciaFim: '01/02/2027', diasParaVencer: 189,
    assinaturaDpo: 'sig:sha256:7c1f0a9b…:oidc|marcela', documentoHash: sha256('LIA-SCORING-001').slice(0, 24),
  }],
  titulares: [
    titular('t1', 'b', '529.982.247-25', 'Ana Beatriz Silva', 'ana.silva@exemplo.com',
      [{ chave: 'renda', rotulo: 'Renda declarada', grupo: 'Crédito', catalogo: 'b-renda', valor: 'R$ 3.500,00', mascara: 'R$ ••••,••', baseLegal: 'execucao_contrato' },
       { chave: 'score', rotulo: 'Score', grupo: 'Crédito', catalogo: 'b-score', valor: '620', mascara: '•••', baseLegal: 'protecao_credito' }],
      [{ chave: 'biometria', rotulo: 'Biometria facial', grupo: 'Onboarding', catalogo: 'b-bio', baseLegal: 'consentimento' }],
      [{ destino: 'OpenAI', finalidade: 'Enriquecimento do modelo', baseLegal: 'legitimo_interesse', internacional: true, mecanismo: 'clausulas_padrao_anpd', ultimaRemessa: '27/07' },
       { destino: 'Serasa', finalidade: 'Consulta de score', baseLegal: 'protecao_credito', internacional: false, mecanismo: 'nao_aplicavel', ultimaRemessa: '26/07' },
       { destino: 'SendGrid', finalidade: 'E-mail transacional', baseLegal: 'execucao_contrato', internacional: true, mecanismo: 'clausulas_padrao_anpd', ultimaRemessa: '28/07' }],
      { id: 'dec_9f21c7', modelo: 'credit-scoring v2.3.1', aprovado: false, shap: [{ feature: 'tempo_emprego', impacto: -0.34 }, { feature: 'score_serasa', impacto: -0.21 }, { feature: 'renda', impacto: 0.12 }] }),
    titular('t2', 'b', '843.117.902-08', 'Carlos Menezes', 'carlos.m@exemplo.com',
      [{ chave: 'renda', rotulo: 'Renda declarada', grupo: 'Crédito', catalogo: 'b-renda', valor: 'R$ 7.200,00', mascara: 'R$ ••••,••', baseLegal: 'execucao_contrato' }],
      [{ chave: 'biometria', rotulo: 'Biometria facial', grupo: 'Onboarding', catalogo: 'b-bio', baseLegal: 'consentimento' }],
      [{ destino: 'Serasa', finalidade: 'Consulta de score', baseLegal: 'protecao_credito', internacional: false, mecanismo: 'nao_aplicavel', ultimaRemessa: '20/07' }]),
    titular('t3', 'b', '311.408.775-31', 'Joana Prado', 'joana.p@exemplo.com',
      [{ chave: 'score', rotulo: 'Score', grupo: 'Crédito', catalogo: 'b-score', valor: '548', mascara: '•••', baseLegal: 'protecao_credito' }], [],
      [{ destino: 'OpenAI', finalidade: 'Enriquecimento do modelo', baseLegal: 'legitimo_interesse', internacional: true, mecanismo: 'clausulas_padrao_anpd', ultimaRemessa: '25/07' }],
      { id: 'dec_44ab10', modelo: 'credit-scoring v2.3.1', aprovado: false, shap: [{ feature: 'score_serasa', impacto: -0.41 }, { feature: 'renda', impacto: -0.09 }] }),
  ],
  solicitacoes: solicitacoesPadrao(['t1', 't2', 't3'], ['credit-scoring', 'onboarding', 'analytics']),
  expurgos: [
    { id: 'e1', data: 'hoje', origem: 'cron', status: 'concluido', entradas: expurgoPadrao('credit-scoring', [['decisoes_ia', 'hard_delete', 8120], ['historico_compras', 'crypto_shredding', 6301], ['cadastros.biometria', 'crypto_shredding', 411], ['eventos_brutos', 'compactacao_log', 3600]]) },
    { id: 'e2', data: 'ontem', origem: 'cron', status: 'concluido', entradas: expurgoPadrao('credit-scoring', [['decisoes_ia', 'hard_delete', 9902], ['cadastros', 'anonimizacao', 7208]]) },
  ],
  chaves: [
    { alias: 'alias/credit-pii-v3', finalidade: 'credito_pii', status: 'ativa', criadaHaDias: 80, rotacaoEmDias: 10, criptoShredding: true, dependencias: ['clientes', 'decisoes_ia'] },
    { alias: 'alias/credit-pii-v4', finalidade: 'credito_pii_next', status: 'canary', criadaHaDias: 6, rotacaoEmDias: 84, criptoShredding: true, dependencias: [] },
    { alias: 'alias/onboarding-bio-v2', finalidade: 'biometria', status: 'ativa', criadaHaDias: 40, rotacaoEmDias: 50, criptoShredding: true, dependencias: ['cadastros'] },
    { alias: 'alias/backup-rds-v1', finalidade: 'backup', status: 'ativa', criadaHaDias: 200, rotacaoEmDias: 5, criptoShredding: false, dependencias: ['snapshots'] },
    { alias: 'alias/credit-pii-v2', finalidade: 'credito_pii_legado', status: 'revogada', criadaHaDias: 400, rotacaoEmDias: null, criptoShredding: true, dependencias: [] },
  ],
  rotacao: {
    chaveNova: 'alias/credit-pii-v4', chaveAntiga: 'alias/credit-pii-v3',
    etapas: [
      { etapa: 'gerar', rotulo: 'Gerar chave', status: 'concluida', progresso: 100, detalhe: 'v4 criada em us-east-1' },
      { etapa: 'parameter_store', rotulo: 'Parameter Store', status: 'concluida', progresso: 100, detalhe: 'SecureString atualizada' },
      { etapa: 'canary_5', rotulo: 'Canary 5%', status: 'concluida', progresso: 100, detalhe: '48 h sem erro de decrypt' },
      { etapa: 'recriptografar', rotulo: 'Recriptografar', status: 'executando', progresso: 63.4, detalhe: '1.187.402 de 1.873.900 registros' },
      { etapa: 'revogar_antiga', rotulo: 'Revogar antiga', status: 'pendente', progresso: 0, detalhe: '30 dias após a re-encriptação' },
    ],
  },
  acessosKms: [
    { quando: 'há 20 min', principal: 'role/scoring-svc', operacao: 'Decrypt', finalidade: 'credito_pii', origemIp: '10.4.2.11', autorizado: true },
    { quando: 'há 35 min', principal: 'role/scoring-svc', operacao: 'GenerateDataKey', finalidade: 'credito_pii', origemIp: '10.4.2.11', autorizado: true },
    { quando: 'há 2 h', principal: 'user/estagiario.dev', operacao: 'Decrypt', finalidade: 'biometria', origemIp: '189.22.7.90', autorizado: false, motivo: 'fora da VPN e sem escopo para dado sensível' },
    { quando: 'há 5 h', principal: 'role/rds-backup', operacao: 'Encrypt', finalidade: 'backup', origemIp: '10.4.9.3', autorizado: true },
  ],
  metricas: metricas(85.7, 34, 92, 3),
  maturidade: maturidade(3, 4, 3, 2, 3),
  raci: RACI,
};

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO 2 — Varejo: recomendação e fidelidade
// ─────────────────────────────────────────────────────────────────────────────

const camposVarejo: Campo[] = [
  { id: 'v-nome', sistema: 'checkout', dataset: 'pedidos', nome: 'nome_completo', tipoArmazenado: 'criptografado', categoria: 'pessoal', sensivel: false, finalidade: 'Identificação do cliente no pedido', finalidadesCompativeis: ['atendimento', 'auditoria'], baseLegal: 'execucao_contrato', retencao: '5 anos', retencaoDias: 1825, origem: 'checkout', compartilhamentos: [],
    linhagem: [{ etapa: 'Checkout', detalhe: 'nome na nota' }, { etapa: 'Expurgo', detalhe: '5 anos' }] },
  { id: 'v-email', sistema: 'fidelidade', dataset: 'membros', nome: 'email', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, finalidade: 'Comunicação do programa de fidelidade', finalidadesCompativeis: ['atendimento'], baseLegal: 'consentimento', retencao: 'até revogação', retencaoDias: null, origem: 'adesão ao programa', compartilhamentos: [],
    linhagem: [{ etapa: 'Adesão', detalhe: 'consentimento granular' }, { etapa: 'Expurgo', detalhe: 'na revogação' }] },
  { id: 'v-cpf', sistema: 'checkout', dataset: 'pedidos', nome: 'cpf', tipoArmazenado: 'hash', categoria: 'pessoal', sensivel: false, finalidade: 'CPF na nota fiscal', finalidadesCompativeis: ['atendimento', 'auditoria'], baseLegal: 'obrigacao_legal', retencao: '5 anos', retencaoDias: 1825, origem: 'checkout', compartilhamentos: [],
    linhagem: [{ etapa: 'Checkout', detalhe: 'opcional na nota' }, { etapa: 'SEFAZ', detalhe: 'obrigação fiscal', externo: true }, { etapa: 'Expurgo', detalhe: '5 anos' }] },
  { id: 'v-endereco', sistema: 'checkout', dataset: 'pedidos', nome: 'endereco_entrega', tipoArmazenado: 'criptografado', categoria: 'pessoal', sensivel: false, finalidade: 'Entrega do pedido', finalidadesCompativeis: ['atendimento'], baseLegal: 'execucao_contrato', retencao: '18 meses', retencaoDias: 540, origem: 'checkout',
    compartilhamentos: [{ destino: 'Transportadora Norte', finalidade: 'Entrega', internacional: false, mecanismo: 'nao_aplicavel' }],
    linhagem: [{ etapa: 'Checkout', detalhe: 'endereço do pedido' }, { etapa: 'Transportadora', detalhe: 'payload mínimo', externo: true }, { etapa: 'Expurgo', detalhe: '18 meses' }] },
  { id: 'v-navegacao', sistema: 'recomendacao', dataset: 'eventos', nome: 'perfil_navegacao', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, finalidade: 'Recomendação de produtos', finalidadesCompativeis: ['auditoria'], baseLegal: 'legitimo_interesse', liaCodigo: 'LIA-RECO-002', retencao: '120 dias', retencaoDias: 120, origem: 'clickstream',
    compartilhamentos: [{ destino: 'Meta Ads', finalidade: 'Público semelhante', internacional: true, pais: 'EUA', mecanismo: 'clausulas_padrao_anpd', evidencia: 'dpa/meta-scc.pdf' }],
    linhagem: [{ etapa: 'Site', detalhe: 'evento pseudonimizado na origem' }, { etapa: 'Feature store', detalhe: 'janela de 120 dias' }, { etapa: 'Meta Ads', detalhe: 'EUA · SCC ANPD', externo: true }, { etapa: 'Expurgo', detalhe: '120 dias' }] },
  { id: 'v-saude', sistema: 'farmacia', dataset: 'receitas', nome: 'medicamento_controlado', tipoArmazenado: 'criptografado', categoria: 'sensivel', sensivel: true, finalidade: 'Dispensação de medicamento sob receita', finalidadesCompativeis: [], baseLegal: 'tutela_saude', retencao: '2 anos', retencaoDias: 730, origem: 'balcão da farmácia', compartilhamentos: [],
    linhagem: [{ etapa: 'Balcão', detalhe: 'receita retida' }, { etapa: 'KMS', detalhe: 'chave própria de saúde' }, { etapa: 'Cripto-shredding', detalhe: '2 anos' }] },
  { id: 'v-cesta', sistema: 'recomendacao', dataset: 'agregados', nome: 'cesta_media_por_regiao', tipoArmazenado: 'agregado', categoria: 'anonimizado', sensivel: false, finalidade: 'Planejamento de sortimento', finalidadesCompativeis: ['auditoria'], baseLegal: 'legitimo_interesse', liaCodigo: 'LIA-RECO-002', retencao: '3 anos', retencaoDias: 1095, origem: 'BI', compartilhamentos: [],
    linhagem: [{ etapa: 'Pedidos', detalhe: 'agregação k≥5' }, { etapa: 'BI', detalhe: 'células suprimidas' }] },
  { id: 'v-tel', sistema: 'fidelidade', dataset: 'membros', nome: 'telefone', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, finalidade: 'Comunicação do programa de fidelidade', finalidadesCompativeis: ['atendimento'], baseLegal: 'consentimento', retencao: 'até revogação', retencaoDias: null, origem: 'adesão ao programa',
    compartilhamentos: [{ destino: 'Zenvia', finalidade: 'Envio de SMS', internacional: false, mecanismo: 'nao_aplicavel' }],
    linhagem: [{ etapa: 'Adesão', detalhe: 'consentimento granular' }, { etapa: 'Zenvia', detalhe: 'SMS transacional', externo: true }, { etapa: 'Expurgo', detalhe: 'na revogação' }] },
];

const varejo: Cenario = {
  id: 'varejo',
  nome: 'Rede Aurora',
  setor: 'Varejo omnicanal',
  descricao: 'Recomendação por comportamento de navegação, programa de fidelidade e farmácia dentro da loja. O risco dominante é a farmácia: dado de saúde no mesmo cadastro do varejo.',
  sistemas: [
    { slug: 'checkout', nome: 'Checkout e pedidos', repositorio: 'aurora/checkout', timeDono: '@squad-vendas', temInventario: true },
    { slug: 'recomendacao', nome: 'Motor de recomendação', repositorio: 'aurora/recomendacao', timeDono: '@squad-dados', temInventario: true },
    { slug: 'farmacia', nome: 'Farmácia', repositorio: 'aurora/farmacia', timeDono: '@squad-saude', temInventario: true },
    { slug: 'fidelidade', nome: 'Programa de fidelidade', repositorio: 'aurora/fidelidade', timeDono: '@squad-crm', temInventario: false },
  ],
  campos: camposVarejo,
  obrigacoes: agendaPadrao(),
  epicos: epicosPadrao('aurora/recomendacao', 512),
  pareceres: pareceresPadrao(),
  achados: achadosPadrao(),
  incidentes: incidentePadrao(['v-cpf', 'v-email', 'v-tel'], 'R09', 'r1'),
  consentimentos: [
    { campoId: 'v-email', versao: 'v2', texto: 'Aceito receber comunicações do programa de fidelidade por e-mail.',
      coletadoEm: '02/02/2026', canal: 'checkout web', hash: sha256('consent-v-email-v2').slice(0, 16),
      estado: 'ativo', titulares: 31207 },
    { campoId: 'v-tel', versao: 'v2', texto: 'Aceito receber comunicações do programa de fidelidade por SMS.',
      coletadoEm: '02/02/2026', canal: 'checkout web', hash: sha256('consent-v-tel-v2').slice(0, 16),
      estado: 'ativo', titulares: 18904 },
  ],
  gates: [
    { id: 'g1', workflow: 'privacy-ci-gate', repositorio: 'recomendacao', prNumero: 512, prTitulo: 'feat: cruzar cesta da farmácia com recomendação', prAutor: '@lucas.dias', headSha: 'd9c8b7a', conclusao: 'failure', bloqueouMerge: true, runUrl: '#', quando: 'há 2 h', ripdId: 'r1',
      findings: [
        { regra: 'dado_sensivel_fora_de_escopo', arquivo: 'src/features/basket.ts', linha: 71, severidade: 'critica', mensagemBruta: "SensitiveFieldError: 'medicamento_controlado' joined into non-health dataset", mensagemHumana: 'O PR cruza o histórico da farmácia com o motor de recomendação. Isso transforma dado de saúde em insumo de marketing — outra finalidade, outra base legal.', comoCorrigir: 'Remova o join. Se a finalidade for legítima, ela precisa de base do Art. 11 e de RIPD próprio.' },
        { regra: 'schema_sem_base_legal', arquivo: '.privacy/data-inventory.reco.yaml', linha: 30, severidade: 'alta', mensagemBruta: "ValidationError: field 'cesta_farmacia' missing 'base_legal'", mensagemHumana: 'O campo derivado entrou sem base legal declarada.', comoCorrigir: 'Declare a base legal ou remova o campo do inventário.' },
      ] },
    { id: 'g2', workflow: 'architecture-review', repositorio: 'recomendacao', prNumero: 512, prTitulo: 'feat: cruzar cesta da farmácia com recomendação', prAutor: '@lucas.dias', headSha: 'd9c8b7a', conclusao: 'action_required', bloqueouMerge: true, runUrl: '#', quando: 'há 2 h', ripdId: 'r1', findings: [] },
    { id: 'g3', workflow: 'privacy-ci-gate', repositorio: 'checkout', prNumero: 941, prTitulo: 'chore: TTL no endereço de entrega', prAutor: '@ana.ferraz', headSha: 'b2a1c0d', conclusao: 'success', bloqueouMerge: false, runUrl: '#', quando: 'há 7 h', findings: [] },
    // C-08 — o gate do repositório que trata dado sob consentimento. Revogar
    // o consentimento derruba este gate, como faz a LIA vencida: a demonstração
    // só existe se houver um gate verde para ficar vermelho.
    { id: 'g4', workflow: 'privacy-ci-gate', repositorio: 'fidelidade', prNumero: 77, prTitulo: 'feat: campanha de SMS do programa', prAutor: '@bruno.reis', headSha: 'e5f4a3b', conclusao: 'success', bloqueouMerge: false, runUrl: '#', quando: 'há 1 d', findings: [] },
  ],
  ripds: [{
    id: 'r1', codigo: 'RIPD-2026-031', titulo: 'Cruzamento de cesta da farmácia com recomendação', sistema: 'recomendacao', prNumero: 512, headSha: 'd9c8b7a',
    contexto: 'Motor de recomendação v4 passando a consumir a base da farmácia para sugerir produtos correlatos.',
    foraDeEscopo: 'Programa de fidelidade (ROPA próprio) e checkout.',
    fluxoMermaid: 'graph LR\n  A[Farmácia] --> B(Feature store)\n  B --> C[Recomendação]\n  C --> D[Vitrine]',
    camposIds: ['v-saude', 'v-navegacao', 'v-cpf'],
    operacoes: [
      { operacao: 'ETL farmacia→feature-store', finalidade: 'Recomendação', baseLegal: 'legitimo_interesse', liaCodigo: 'LIA-RECO-002' },
      { operacao: 'GET /recomendacoes', finalidade: 'Exibir vitrine', baseLegal: 'legitimo_interesse', liaCodigo: 'LIA-RECO-002' },
    ],
    recomendacoes: [
      { prioridade: 'P0', descricao: 'Remover o join com a base da farmácia', dono: '@lucas.dias', prazo: '05/08', concluida: false },
      { prioridade: 'P0', descricao: 'Segregar chave KMS da farmácia da chave do varejo', dono: '@seg-rita', prazo: '12/08', concluida: false },
      { prioridade: 'P1', descricao: 'Auditar quem tem acesso ao dataset receitas', dono: '@seg-rita', prazo: '20/08', concluida: false },
    ],
    triggers: [
      { codigo: 'T1', evidencias: ['medicamento_controlado usado fora da finalidade de saúde'] },
      { codigo: 'T7', evidencias: ['join entre farmacia.receitas e recomendacao.eventos'] },
      { codigo: 'T5', evidencias: ['2,4 milhões de membros no programa'] },
    ],
    volumeTitulares: 2_400_000,
    status: 'em_revisao',
    linddun: LINDDUN_BASE.map((l) => ({ ...l, ativo: l.chave === 'location' ? true : l.ativo })),
  },
  ripdDispensadoPadrao('RIPD-2026-034', 'recomendacao', 518)],
  riscos: riscosComuns(
    { codigo: 'R1', descricao: 'Dado de saúde alimentando recomendação de marketing', probabilidade: 4, impacto: 5, dano: 'moral', danoTexto: 'Inferência de condição de saúde exposta na vitrine, visível a terceiros no mesmo domicílio', tratamento: 'Segregar base da farmácia; chave KMS própria; proibir join no gate', tipo: 'evitar', esforcoSprints: 1.5, dono: '@squad-saude', dominio: 'Engenharia', prazo: '05/08', reavaliacao: '05/11', status: 'em_tratamento', ripdCodigo: 'RIPD-2026-031' },
    { codigo: 'R2', descricao: 'Público semelhante enviado a rede de anúncios sem oposição fácil', probabilidade: 4, impacto: 3, dano: 'perda_de_controle', danoTexto: 'Titular não consegue sair da audiência publicitária', tratamento: 'Oposição em um clique + purga de audiência em 24 h', tipo: 'mitigar', esforcoSprints: 1, dono: '@squad-crm', dominio: 'Produto', prazo: '19/08', reavaliacao: '19/11', status: 'identificado' },
  ),
  lias: [{
    id: 'l1', codigo: 'LIA-RECO-002', titulo: 'Recomendação de produtos por comportamento de navegação',
    finalidade: 'Reduzir o tempo de busca do cliente exibindo produtos correlatos ao que ele já navegou na sessão.',
    categoria: 'Melhoria de produto', beneficio: 2, danoTitular: 2, expectativa: 'alta',
    alternativas: [
      { alternativa: 'Anonimização', situacao: 'rejeitado', justificativa: 'Recomendação sem identificador de sessão devolve a vitrine genérica; o ganho medido cai a zero.' },
      { alternativa: 'Pseudonimização', situacao: 'atendido', justificativa: 'O identificador é HMAC de sessão, rotacionado a cada 30 dias, sem vínculo com CPF.' },
      { alternativa: 'Escopo menor', situacao: 'atendido', justificativa: 'Categoria de produto apenas; SKU individual e base da farmácia estão fora.' },
      { alternativa: 'Retenção menor', situacao: 'atendido', justificativa: 'Janela reduzida de 365 para 120 dias sem perda relevante de conversão.' },
      { alternativa: 'Agregação', situacao: 'nao_aplicavel', justificativa: 'A vitrine é individual; agregado não sustenta a finalidade.' },
      { alternativa: 'Consentimento', situacao: 'rejeitado', justificativa: 'Recomendação básica é expectativa razoável do cliente de e-commerce; pedir consentimento aqui é fadiga sem ganho de controle.' },
    ],
    evidencias: [{ arquivo: 'reco-002-retencao.sql', tipo: 'política de retenção', hash: sha256('reco-002').slice(0, 16) }],
    camposIds: ['v-navegacao', 'v-cesta'], status: 'vigente', vigenciaFim: '30/09/2026', diasParaVencer: 42,
    assinaturaDpo: 'sig:sha256:2b8e4f1a…:oidc|marcela', documentoHash: sha256('LIA-RECO-002').slice(0, 24),
  }],
  titulares: [
    titular('t1', 'v', '712.334.908-11', 'Marina Costa', 'marina.c@exemplo.com',
      [{ chave: 'endereco', rotulo: 'Endereço de entrega', grupo: 'Pedidos', catalogo: 'v-endereco', valor: 'Rua das Acácias, 210 — Recife/PE', mascara: '••••••••••, ••• — ••/••', baseLegal: 'execucao_contrato' },
       { chave: 'telefone', rotulo: 'Telefone', grupo: 'Fidelidade', catalogo: 'v-tel', valor: '(81) 98812-4470', mascara: '(••) •••••-••••', baseLegal: 'consentimento' }],
      [{ chave: 'receita', rotulo: 'Medicamento controlado', grupo: 'Farmácia', catalogo: 'v-saude', baseLegal: 'tutela_saude' }],
      [{ destino: 'Meta Ads', finalidade: 'Público semelhante', baseLegal: 'legitimo_interesse', internacional: true, mecanismo: 'clausulas_padrao_anpd', ultimaRemessa: '27/07' },
       { destino: 'Transportadora Norte', finalidade: 'Entrega', baseLegal: 'execucao_contrato', internacional: false, mecanismo: 'nao_aplicavel', ultimaRemessa: '24/07' }]),
    titular('t2', 'v', '905.221.744-60', 'Rafael Andrade', 'rafael.a@exemplo.com',
      [{ chave: 'endereco', rotulo: 'Endereço de entrega', grupo: 'Pedidos', catalogo: 'v-endereco', valor: 'Av. Beira Mar, 1180 — Fortaleza/CE', mascara: '••••••••••, •••• — ••/••', baseLegal: 'execucao_contrato' }],
      [], [{ destino: 'Transportadora Norte', finalidade: 'Entrega', baseLegal: 'execucao_contrato', internacional: false, mecanismo: 'nao_aplicavel', ultimaRemessa: '19/07' }]),
    titular('t3', 'v', '188.077.312-45', 'Beatriz Lopes', 'bia.l@exemplo.com',
      [{ chave: 'telefone', rotulo: 'Telefone', grupo: 'Fidelidade', catalogo: 'v-tel', valor: '(11) 97741-0033', mascara: '(••) •••••-••••', baseLegal: 'consentimento' }],
      [{ chave: 'receita', rotulo: 'Medicamento controlado', grupo: 'Farmácia', catalogo: 'v-saude', baseLegal: 'tutela_saude' }],
      [{ destino: 'Zenvia', finalidade: 'SMS do programa', baseLegal: 'consentimento', internacional: false, mecanismo: 'nao_aplicavel', ultimaRemessa: '28/07' }]),
  ],
  solicitacoes: solicitacoesPadrao(['t1', 't2', 't3'], ['checkout', 'recomendacao', 'fidelidade']),
  expurgos: [
    { id: 'e1', data: 'hoje', origem: 'cron', status: 'concluido', entradas: expurgoPadrao('recomendacao', [['eventos', 'hard_delete', 41230], ['perfis_sessao', 'crypto_shredding', 12880], ['receitas', 'crypto_shredding', 96], ['clickstream_bruto', 'compactacao_log', 88400]]) },
    { id: 'e2', data: 'ontem', origem: 'cron', status: 'falhou', entradas: expurgoPadrao('recomendacao', [['eventos', 'hard_delete', 0]]) },
  ],
  chaves: [
    { alias: 'alias/varejo-pii-v2', finalidade: 'varejo_pii', status: 'ativa', criadaHaDias: 60, rotacaoEmDias: 30, criptoShredding: true, dependencias: ['pedidos', 'membros'] },
    { alias: 'alias/farmacia-saude-v1', finalidade: 'saude', status: 'ativa', criadaHaDias: 20, rotacaoEmDias: 70, criptoShredding: true, dependencias: ['receitas'] },
    { alias: 'alias/varejo-pii-v3', finalidade: 'varejo_pii_next', status: 'canary', criadaHaDias: 3, rotacaoEmDias: 87, criptoShredding: true, dependencias: [] },
    { alias: 'alias/lake-v1', finalidade: 'lake', status: 'ativa', criadaHaDias: 300, rotacaoEmDias: 2, criptoShredding: false, dependencias: ['clickstream_bruto'] },
  ],
  rotacao: {
    chaveNova: 'alias/varejo-pii-v3', chaveAntiga: 'alias/varejo-pii-v2',
    etapas: [
      { etapa: 'gerar', rotulo: 'Gerar chave', status: 'concluida', progresso: 100, detalhe: 'v3 criada em sa-east-1' },
      { etapa: 'parameter_store', rotulo: 'Parameter Store', status: 'concluida', progresso: 100, detalhe: 'SecureString atualizada' },
      { etapa: 'canary_5', rotulo: 'Canary 5%', status: 'executando', progresso: 40, detalhe: '19 h de 48 h sem erro' },
      { etapa: 'recriptografar', rotulo: 'Recriptografar', status: 'pendente', progresso: 0, detalhe: 'aguarda o fim do canary' },
      { etapa: 'revogar_antiga', rotulo: 'Revogar antiga', status: 'pendente', progresso: 0, detalhe: '30 dias depois' },
    ],
  },
  acessosKms: [
    { quando: 'há 10 min', principal: 'role/checkout-svc', operacao: 'Decrypt', finalidade: 'varejo_pii', origemIp: '10.9.1.4', autorizado: true },
    { quando: 'há 1 h', principal: 'role/reco-etl', operacao: 'Decrypt', finalidade: 'saude', origemIp: '10.9.4.22', autorizado: false, motivo: 'pipeline de recomendação não tem escopo de saúde' },
    { quando: 'há 3 h', principal: 'role/farmacia-svc', operacao: 'GenerateDataKey', finalidade: 'saude', origemIp: '10.9.7.2', autorizado: true },
  ],
  metricas: metricas(72.4, 61, 84, 5),
  maturidade: maturidade(2, 3, 2, 3, 3),
  raci: RACI,
};

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO 3 — Mídia: streaming e publicidade
// ─────────────────────────────────────────────────────────────────────────────

const camposMidia: Campo[] = [
  { id: 'm-nome', sistema: 'contas', dataset: 'assinantes', nome: 'nome_completo', tipoArmazenado: 'criptografado', categoria: 'pessoal', sensivel: false, finalidade: 'Identificação do assinante', finalidadesCompativeis: ['atendimento', 'auditoria'], baseLegal: 'execucao_contrato', retencao: 'contrato + 6 meses', retencaoDias: 180, origem: 'cadastro', compartilhamentos: [],
    linhagem: [{ etapa: 'Cadastro', detalhe: 'nome do titular' }, { etapa: 'Expurgo', detalhe: '6 meses após o contrato' }] },
  { id: 'm-cpf', sistema: 'contas', dataset: 'assinantes', nome: 'cpf', tipoArmazenado: 'hash', categoria: 'pessoal', sensivel: false, finalidade: 'Emissão de nota fiscal da assinatura', finalidadesCompativeis: ['atendimento', 'cobranca', 'auditoria'], baseLegal: 'obrigacao_legal', retencao: '5 anos', retencaoDias: 1825, origem: 'cadastro', compartilhamentos: [],
    linhagem: [{ etapa: 'Cadastro', detalhe: 'hash com sal' }, { etapa: 'SEFAZ', detalhe: 'obrigação fiscal', externo: true }, { etapa: 'Expurgo', detalhe: '5 anos' }] },
  { id: 'm-plano', sistema: 'contas', dataset: 'assinantes', nome: 'plano_assinatura', tipoArmazenado: 'bruto', categoria: 'pessoal', sensivel: false, finalidade: 'Execução do contrato de assinatura', finalidadesCompativeis: ['atendimento', 'cobranca'], baseLegal: 'execucao_contrato', retencao: 'contrato', retencaoDias: null, origem: 'cadastro', compartilhamentos: [],
    linhagem: [{ etapa: 'Cadastro', detalhe: 'escolha do plano' }, { etapa: 'Faturamento', detalhe: 'cobrança recorrente' }] },
  { id: 'm-email', sistema: 'contas', dataset: 'assinantes', nome: 'email', tipoArmazenado: 'hash', categoria: 'pessoal', sensivel: false, finalidade: 'Autenticação e recuperação de senha', finalidadesCompativeis: ['atendimento'], baseLegal: 'execucao_contrato', retencao: 'contrato + 6 meses', retencaoDias: 180, origem: 'cadastro', compartilhamentos: [],
    linhagem: [{ etapa: 'Cadastro', detalhe: 'e-mail e senha apenas' }, { etapa: 'Auth', detalhe: 'cookie HttpOnly' }, { etapa: 'Expurgo', detalhe: '6 meses após o fim do contrato' }] },
  { id: 'm-watch', sistema: 'player', dataset: 'sessoes', nome: 'historico_reproducao', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, finalidade: 'Continuar assistindo e recomendação', finalidadesCompativeis: ['atendimento', 'auditoria'], baseLegal: 'execucao_contrato', retencao: '24 meses', retencaoDias: 730, origem: 'player',
    compartilhamentos: [{ destino: 'Nielsen', finalidade: 'Medição de audiência', internacional: true, pais: 'EUA', mecanismo: 'clausulas_padrao_anpd', evidencia: 'dpa/nielsen-scc.pdf' }],
    linhagem: [{ etapa: 'Player', detalhe: 'evento por título' }, { etapa: 'Nielsen', detalhe: 'EUA · SCC ANPD', externo: true }, { etapa: 'Expurgo', detalhe: '24 meses' }] },
  { id: 'm-geo', sistema: 'player', dataset: 'sessoes', nome: 'geolocalizacao_ip', tipoArmazenado: 'agregado', categoria: 'anonimizado', sensivel: false, finalidade: 'Licenciamento territorial de conteúdo', finalidadesCompativeis: ['auditoria'], baseLegal: 'execucao_contrato', retencao: '30 dias', retencaoDias: 30, origem: 'IP da sessão', compartilhamentos: [],
    linhagem: [{ etapa: 'Sessão', detalhe: 'IP truncado no ingest' }, { etapa: 'Geo', detalhe: 'centroide do município' }, { etapa: 'Expurgo', detalhe: '30 dias' }] },
  { id: 'm-inferencia', sistema: 'ads', dataset: 'segmentos', nome: 'segmento_inferido', tipoArmazenado: 'hmac', categoria: 'pseudonimizado', sensivel: false, finalidade: 'Segmentação publicitária', finalidadesCompativeis: ['auditoria'], baseLegal: 'consentimento', retencao: 'até revogação', retencaoDias: null, origem: 'modelo de audiência',
    compartilhamentos: [{ destino: 'Google Ad Manager', finalidade: 'Entrega de anúncio segmentado', internacional: true, pais: 'EUA', mecanismo: 'clausulas_padrao_anpd', evidencia: 'dpa/gam-scc.pdf' }],
    linhagem: [{ etapa: 'Consentimento', detalhe: 'toggle desligado por padrão' }, { etapa: 'Modelo', detalhe: 'segmento sem categoria sensível' }, { etapa: 'Google Ad Manager', detalhe: 'EUA · SCC ANPD', externo: true }, { etapa: 'Expurgo', detalhe: 'na revogação' }] },
  { id: 'm-orientacao', sistema: 'ads', dataset: 'segmentos', nome: 'afinidade_conteudo_lgbt', tipoArmazenado: 'criptografado', categoria: 'sensivel', sensivel: true, finalidade: 'Curadoria editorial de acervo', finalidadesCompativeis: [], baseLegal: 'consentimento', retencao: '90 dias', retencaoDias: 90, origem: 'consentimento explícito no perfil', compartilhamentos: [],
    linhagem: [{ etapa: 'Perfil', detalhe: 'opt-in explícito e destacado' }, { etapa: 'KMS', detalhe: 'chave própria, nunca compartilhada com ads' }, { etapa: 'Cripto-shredding', detalhe: '90 dias' }] },
  { id: 'm-menor', sistema: 'contas', dataset: 'perfis', nome: 'perfil_infantil', tipoArmazenado: 'criptografado', categoria: 'pessoal', sensivel: false, finalidade: 'Controle parental e classificação etária', finalidadesCompativeis: ['atendimento'], baseLegal: 'consentimento', retencao: 'contrato', retencaoDias: null, origem: 'perfil criado pelo responsável', compartilhamentos: [],
    linhagem: [{ etapa: 'Responsável', detalhe: 'consentimento parental (Art. 14)' }, { etapa: 'Player', detalhe: 'sem publicidade comportamental' }, { etapa: 'Expurgo', detalhe: 'no fim do contrato' }] },
];

const midia: Cenario = {
  id: 'midia',
  nome: 'Palco Streaming',
  setor: 'Mídia e entretenimento',
  descricao: 'Streaming por assinatura com publicidade segmentada e perfis infantis. O risco dominante é a inferência: preferência de conteúdo revela categoria sensível sem que ninguém tenha coletado dado sensível.',
  sistemas: [
    { slug: 'contas', nome: 'Contas e perfis', repositorio: 'palco/contas', timeDono: '@squad-conta', temInventario: true },
    { slug: 'player', nome: 'Player e sessões', repositorio: 'palco/player', timeDono: '@squad-player', temInventario: true },
    { slug: 'ads', nome: 'Publicidade', repositorio: 'palco/ads', timeDono: '@squad-ads', temInventario: true },
  ],
  campos: camposMidia,
  obrigacoes: agendaPadrao(),
  epicos: epicosPadrao('palco/ads', 77),
  pareceres: pareceresPadrao(),
  achados: achadosPadrao(),
  incidentes: incidentePadrao(['m-cpf', 'm-inferencia'], 'R09', 'r1'),
  consentimentos: [
    { campoId: 'm-inferencia', versao: 'v5', texto: 'Autorizo o uso do meu histórico de consumo para recomendação e publicidade segmentada.',
      coletadoEm: '21/05/2026', canal: 'app Android', hash: sha256('consent-m-inferencia-v5').slice(0, 16),
      estado: 'ativo', titulares: 96330 },
    { campoId: 'm-orientacao', versao: 'v5', texto: 'Autorizo o uso de afinidade temática do meu perfil para curadoria editorial.',
      coletadoEm: '21/05/2026', canal: 'app Android', hash: sha256('consent-m-orientacao-v5').slice(0, 16),
      estado: 'ativo', titulares: 4211 },
  ],
  gates: [
    { id: 'g1', workflow: 'privacy-ci-gate', repositorio: 'ads', prNumero: 77, prTitulo: 'feat: segmento por afinidade de acervo', prAutor: '@bruno.reis', headSha: 'e1f2a3b', conclusao: 'failure', bloqueouMerge: true, runUrl: '#', quando: 'há 1 h', ripdId: 'r1',
      findings: [
        { regra: 'inferencia_categoria_sensivel', arquivo: 'src/segments/affinity.ts', linha: 44, severidade: 'critica', mensagemBruta: 'InferenceRiskError: segment derived from title metadata classified as sensitive affinity', mensagemHumana: 'O segmento inferido a partir do acervo assistido reconstrói categoria sensível. Ninguém coletou dado sensível — o modelo o produziu, e o efeito para o titular é o mesmo.', comoCorrigir: 'Remova os títulos classificados como sensíveis do sinal, ou exija consentimento específico do Art. 11 para o segmento.' },
        { regra: 'menor_sem_verificacao', arquivo: 'src/segments/audience.ts', linha: 12, severidade: 'alta', mensagemBruta: "MinorDataError: profile flagged 'infantil' present in ad audience", mensagemHumana: 'Perfil infantil entrou na audiência publicitária. Art. 14 exige tratamento no melhor interesse da criança.', comoCorrigir: 'Exclua perfis infantis de qualquer segmento de publicidade comportamental.' },
      ] },
    { id: 'g2', workflow: 'architecture-review', repositorio: 'ads', prNumero: 77, prTitulo: 'feat: segmento por afinidade de acervo', prAutor: '@bruno.reis', headSha: 'e1f2a3b', conclusao: 'action_required', bloqueouMerge: true, runUrl: '#', quando: 'há 1 h', ripdId: 'r1', findings: [] },
    { id: 'g3', workflow: 'privacy-ci-gate', repositorio: 'player', prNumero: 201, prTitulo: 'chore: truncar IP no ingest', prAutor: '@carla.souza', headSha: 'a9b8c7d', conclusao: 'success', bloqueouMerge: false, runUrl: '#', quando: 'há 12 h', findings: [] },
  ],
  ripds: [{
    id: 'r1', codigo: 'RIPD-2026-008', titulo: 'Segmentação publicitária por afinidade de acervo', sistema: 'ads', prNumero: 77, headSha: 'e1f2a3b',
    contexto: 'Motor de segmentos derivando afinidades a partir do histórico de reprodução para venda de inventário publicitário.',
    foraDeEscopo: 'Recomendação editorial dentro do player (finalidade contratual) e perfis infantis.',
    fluxoMermaid: 'graph LR\n  A[Player] --> B(Modelo de audiência)\n  B --> C[Segmentos]\n  C --> D[Google Ad Manager]',
    camposIds: ['m-watch', 'm-inferencia', 'm-orientacao'],
    operacoes: [
      { operacao: 'ETL sessoes→segmentos', finalidade: 'Segmentação publicitária', baseLegal: 'consentimento' },
      { operacao: 'POST /ads/audience', finalidade: 'Entrega de anúncio', baseLegal: 'consentimento' },
    ],
    recomendacoes: [
      { prioridade: 'P0', descricao: 'Excluir títulos de categoria sensível do sinal de segmento', dono: '@bruno.reis', prazo: '02/08', concluida: false },
      { prioridade: 'P0', descricao: 'Bloquear perfis infantis em qualquer audiência publicitária', dono: '@squad-conta', prazo: '02/08', concluida: true },
      { prioridade: 'P1', descricao: 'Teste de reidentificação por combinação de segmentos', dono: '@ml-nina', prazo: '16/08', concluida: false },
    ],
    triggers: [
      { codigo: 'T1', evidencias: ['segmento inferido reconstrói afinidade sensível'] },
      { codigo: 'T2', evidencias: ['perfil_infantil presente na audiência'] },
      { codigo: 'T4', evidencias: ['telemetria contínua do player'] },
      { codigo: 'T8', evidencias: ['Google Ad Manager em us-east'] },
    ],
    volumeTitulares: 8_900_000,
    status: 'em_revisao',
    decisoes: [
      decidido('d1', {
        categoria: 'sensivel', volumeTitulares: 8_900_000,
        decisaoAutomatizada: false, transferenciaInternacional: true,
      }, 2, '2026-07-14T10:30:00Z'),
      decidido('d3', {
        gatilhos: ['T1', 'T2', 'T4', 'T8'], gatilhosCriticos: 3, gatilhosTotal: 4,
      }, 1, '2026-07-14T10:30:08Z'),
    ],
    linddun: LINDDUN_BASE.map((l) => ({ ...l, ativo: true })),
  },
  ripdDispensadoPadrao('RIPD-2026-012', 'player', 81)],
  riscos: riscosComuns(
    { codigo: 'R1', descricao: 'Inferência reconstrói categoria sensível sem coleta', probabilidade: 5, impacto: 5, dano: 'discriminacao', danoTexto: 'Exposição de característica protegida a anunciantes, com efeito de discriminação sem que o titular tenha informado nada', tratamento: 'Excluir títulos sensíveis do sinal; auditoria de reidentificação por combinação', tipo: 'evitar', esforcoSprints: 1.5, dono: '@bruno.reis', dominio: 'Engenharia', prazo: '02/08', reavaliacao: '02/11', status: 'identificado', ripdCodigo: 'RIPD-2026-008' },
    { codigo: 'R2', descricao: 'Perfil infantil em audiência publicitária', probabilidade: 3, impacto: 5, dano: 'moral', danoTexto: 'Publicidade comportamental dirigida a criança (Art. 14)', tratamento: 'Bloqueio de perfis infantis no pipeline de audiência', tipo: 'evitar', esforcoSprints: 0.5, dono: '@squad-conta', dominio: 'Engenharia', prazo: '02/08', reavaliacao: '02/11', status: 'mitigado', ripdCodigo: 'RIPD-2026-008' },
  ),
  lias: [{
    id: 'l1', codigo: 'LIA-AUDIENCIA-003', titulo: 'Medição de audiência agregada para relatório de licenciamento',
    finalidade: 'Reportar audiência agregada por título aos detentores de direitos, obrigação contratual de licenciamento.',
    categoria: 'Melhoria de produto', beneficio: 2, danoTitular: 3, expectativa: 'baixa',
    alternativas: [
      { alternativa: 'Anonimização', situacao: 'atendido', justificativa: 'O relatório usa contagem agregada por título com k≥50; nenhuma linha individual é exportada.' },
      { alternativa: 'Pseudonimização', situacao: 'atendido', justificativa: 'Identificador de sessão HMAC rotacionado a cada 7 dias.' },
      { alternativa: 'Escopo menor', situacao: 'rejeitado', justificativa: 'O contrato de licenciamento exige quebra por faixa etária e região.' },
      { alternativa: 'Retenção menor', situacao: 'atendido', justificativa: 'Dado bruto de sessão vive 30 dias; só o agregado persiste.' },
      { alternativa: 'Agregação', situacao: 'atendido', justificativa: 'É a forma do relatório: nunca sai linha individual.' },
      { alternativa: 'Consentimento', situacao: 'nao_aplicavel', justificativa: 'A obrigação decorre do contrato de licenciamento, não da relação com o titular.' },
    ],
    evidencias: [{ arquivo: 'audiencia-003-agregacao.sql', tipo: 'política de retenção', hash: sha256('aud-003').slice(0, 16) }],
    camposIds: ['m-geo'], status: 'vencida', vigenciaFim: '10/07/2026', diasParaVencer: -18,
    documentoHash: sha256('LIA-AUDIENCIA-003').slice(0, 24),
  }],
  titulares: [
    titular('t1', 'm', '404.882.113-90', 'Diego Rocha', 'diego.r@exemplo.com',
      [{ chave: 'plano', rotulo: 'Plano', grupo: 'Assinatura', catalogo: 'm-plano', valor: 'Anual com anúncios', mascara: '••••••••••', baseLegal: 'execucao_contrato' }],
      [{ chave: 'afinidade', rotulo: 'Afinidade de conteúdo', grupo: 'Publicidade', catalogo: 'm-orientacao', baseLegal: 'consentimento' }],
      [{ destino: 'Google Ad Manager', finalidade: 'Anúncio segmentado', baseLegal: 'consentimento', internacional: true, mecanismo: 'clausulas_padrao_anpd', ultimaRemessa: '28/07' },
       { destino: 'Nielsen', finalidade: 'Medição de audiência', baseLegal: 'execucao_contrato', internacional: true, mecanismo: 'clausulas_padrao_anpd', ultimaRemessa: '27/07' }]),
    titular('t2', 'm', '620.559.874-02', 'Helena Martins', 'helena.m@exemplo.com',
      [{ chave: 'plano', rotulo: 'Plano', grupo: 'Assinatura', catalogo: 'm-plano', valor: 'Mensal sem anúncios', mascara: '••••••••••', baseLegal: 'execucao_contrato' }], [],
      [{ destino: 'Nielsen', finalidade: 'Medição de audiência', baseLegal: 'execucao_contrato', internacional: true, mecanismo: 'clausulas_padrao_anpd', ultimaRemessa: '26/07' }]),
    titular('t3', 'm', '037.914.226-58', 'Tiago Nunes', 'tiago.n@exemplo.com',
      [{ chave: 'plano', rotulo: 'Plano', grupo: 'Assinatura', catalogo: 'm-plano', valor: 'Família (2 perfis infantis)', mascara: '••••••••••', baseLegal: 'execucao_contrato' }], [],
      [{ destino: 'Nielsen', finalidade: 'Medição de audiência', baseLegal: 'execucao_contrato', internacional: true, mecanismo: 'clausulas_padrao_anpd', ultimaRemessa: '25/07' }]),
  ],
  solicitacoes: solicitacoesPadrao(['t1', 't2', 't3'], ['contas', 'player', 'ads']),
  expurgos: [
    { id: 'e1', data: 'hoje', origem: 'cron', status: 'concluido', entradas: expurgoPadrao('player', [['sessoes', 'hard_delete', 220400], ['geolocalizacao', 'anonimizacao', 220400], ['segmentos', 'crypto_shredding', 3120], ['telemetria_bruta', 'compactacao_log', 940000]]) },
    { id: 'e2', data: 'ontem', origem: 'solicitacao_titular', status: 'concluido', entradas: expurgoPadrao('ads', [['segmentos', 'crypto_shredding', 1]]) },
  ],
  chaves: [
    { alias: 'alias/palco-pii-v1', finalidade: 'assinante_pii', status: 'ativa', criadaHaDias: 120, rotacaoEmDias: 15, criptoShredding: true, dependencias: ['assinantes', 'perfis'] },
    { alias: 'alias/palco-afinidade-v1', finalidade: 'afinidade_sensivel', status: 'ativa', criadaHaDias: 25, rotacaoEmDias: 65, criptoShredding: true, dependencias: ['segmentos'] },
    { alias: 'alias/palco-pii-v2', finalidade: 'assinante_pii_next', status: 'nova', criadaHaDias: 0, rotacaoEmDias: 90, criptoShredding: true, dependencias: [] },
    { alias: 'alias/telemetria-v4', finalidade: 'telemetria', status: 'ativa', criadaHaDias: 45, rotacaoEmDias: 45, criptoShredding: false, dependencias: ['telemetria_bruta'] },
  ],
  rotacao: {
    chaveNova: 'alias/palco-pii-v2', chaveAntiga: 'alias/palco-pii-v1',
    etapas: [
      { etapa: 'gerar', rotulo: 'Gerar chave', status: 'executando', progresso: 20, detalhe: 'aguardando aprovação de mudança' },
      { etapa: 'parameter_store', rotulo: 'Parameter Store', status: 'pendente', progresso: 0, detalhe: '' },
      { etapa: 'canary_5', rotulo: 'Canary 5%', status: 'pendente', progresso: 0, detalhe: '' },
      { etapa: 'recriptografar', rotulo: 'Recriptografar', status: 'pendente', progresso: 0, detalhe: '' },
      { etapa: 'revogar_antiga', rotulo: 'Revogar antiga', status: 'pendente', progresso: 0, detalhe: '' },
    ],
  },
  acessosKms: [
    { quando: 'há 5 min', principal: 'role/player-svc', operacao: 'Decrypt', finalidade: 'assinante_pii', origemIp: '10.2.3.9', autorizado: true },
    { quando: 'há 40 min', principal: 'role/ads-etl', operacao: 'Decrypt', finalidade: 'afinidade_sensivel', origemIp: '10.2.8.1', autorizado: false, motivo: 'pipeline de publicidade não tem escopo de afinidade sensível' },
    { quando: 'há 4 h', principal: 'role/contas-svc', operacao: 'GenerateDataKey', finalidade: 'assinante_pii', origemIp: '10.2.1.5', autorizado: true },
  ],
  metricas: metricas(91.2, 22, 96, 1),
  maturidade: maturidade(4, 4, 3, 3, 4),
  raci: RACI,
};

export const CENARIOS: Record<string, Cenario> = { banco, varejo, midia };
export const CENARIO_PADRAO = 'banco';
