import type { Acao } from './permissoes';
import type { Superficie } from './rotas';

export type Metodo = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * A rota exige `X-Purpose`? (Risco-011)
 *
 * O `openapi.yaml:20` promete, desde sempre, que *"`X-Purpose` é obrigatório em
 * qualquer rota do console que toque dado de titular"*. Quando o PR 5 mediu, o
 * contrato tinha **68 operações**: três declaravam o cabeçalho e **duas** o
 * exigiam no código. `POST /audit/exportar` declarava e não exigia — o registro
 * de acessos inteiro saía da plataforma sem finalidade nenhuma.
 *
 * Promessa em prosa não é instrumento, e por isso o campo é **obrigatório no
 * tipo**: a rota nova é forçada a decidir, como já acontece com a política de
 * escopo. Dispensar exige motivo escrito, e o motivo é cobrado por teste — a
 * isenção sem justificativa é a forma de esta lista virar carta-branca.
 */
export type ExigenciaDeFinalidade = 'exigida' | 'dispensada';

/**
 * Nenhuma rota do portal exige finalidade — e o motivo é um só, escrito uma vez.
 *
 * No portal não há operador: quem está do outro lado é a própria pessoa. A
 * finalidade do Art. 37 responde "por que **você** está olhando o dado de
 * alguém", e essa pergunta não existe quando o titular olha o próprio dado. O
 * que autoriza aqui é a verificação, com nível derivado do direito — o
 * instrumento do portal é esse, e ele já está no lugar desde o PR 1.
 */
const SEM_FINALIDADE_NO_PORTAL =
  'Superfície do titular: quem lê é a própria pessoa, e o que autoriza é a verificação com nível '
  + 'derivado do direito (Art. 18). A finalidade do Art. 37 responde por que um operador olha o dado '
  + 'de outra pessoa — pergunta que não existe quando a pessoa olha o dela.';

/**
 * Política de resposta declarada por rota.
 *
 * Antes desta tabela, a guarda de escrita era **desviada**: rotas com
 * necessidade própria saíam antes dela, e o motivo ficava na ordem das linhas
 * do `switch`. Isso é uma lista de exceções, e lista de exceções cresce.
 *
 * Aqui o motivo mora no dado. Cada rota declara o que é e como responde a quem
 * está fora de escopo; a guarda lê a tabela em vez de ser contornada. Quem
 * acrescentar a próxima rota é obrigado a declarar a política dela — a entrada
 * ausente é recusada por padrão (`POLITICA_PADRAO`), não liberada.
 */
export interface PoliticaRota {
  metodo: Metodo;
  caminho: RegExp;
  /**
   * Em qual superfície a rota vive. Ausente é `console` — as quarenta e poucas
   * rotas do balcão não precisam repetir o padrão.
   *
   * A separação não é cosmética: `GET requests/2026-0731` existe nas duas, e
   * significa coisas diferentes. No console é a fila do DPO; no portal é o
   * pedido de uma pessoa, que só ela pode ver.
   */
  superficie?: Superficie;
  /** `escrita` exige a ação `escrever`; `leitura` não. Só se aplica ao console. */
  tipo: 'leitura' | 'escrita';
  /**
   * Como a rota responde a quem não pode alcançá-la.
   *
   * `404_uniforme` para tudo que confirma a existência de um titular: um 403
   * ali diria "existe, você é que não pode" — o oráculo que a Regra 5 fecha.
   * `403` para recusa sobre a capacidade do ator, que não revela nada sobre
   * quem está do outro lado.
   * `401_uniforme` é a do portal: sem confirmação de identidade não há resposta,
   * e a recusa é a mesma para "não confirmou", "confirmou outro direito" e
   * "esse protocolo é de outra pessoa".
   */
  foraDeEscopo: '404_uniforme' | '403' | '401_uniforme';
  /** Permissão adicional, além do que `tipo` exige. Só se aplica ao console. */
  acao?: Acao;
  /**
   * Portal: a rota exige sessão de verificação confirmada?
   *
   * Só `GET /me/direitos` dispensa — é o cardápio, e não carrega dado de
   * titular. Perguntar quem é a pessoa antes de dizer o que ela pode pedir
   * inverte a ordem: o portal não pergunta nada antes de oferecer.
   */
  exigeSessao?: boolean;
  /**
   * Risco-011 — a rota exige `X-Purpose`? Obrigatório: ninguém acrescenta rota
   * sem decidir, e a decisão fica no diff.
   */
  finalidade: ExigenciaDeFinalidade;
  /**
   * Obrigatório quando `dispensada`. Isenção sem motivo é isenção sem revisor:
   * o teste cobra substância, não a existência do campo.
   */
  motivoDaDispensa?: string;
  /**
   * Risco-011 — a operação exige confirmação de identidade recente?
   *
   * A janela é derivada **da operação, no servidor**, como o nível de
   * verificação do portal vem do direito. Cliente que mandasse o próprio nível
   * estaria alegando, não provando.
   *
   * O conjunto não foi inventado neste PR: são as quatro operações que o
   * repositório já prometia proteger com step-up, em `db/schema.sql:35`,
   * `:766` e `docs/01-arquitetura.md:143` e `:158`.
   */
  stepUp?: { janelaMin: number };
  /** Descrição curta, para a mensagem de recusa e para quem lê a tabela. */
  nota: string;
}

export const POLITICAS: PoliticaRota[] = [
  // ══ PORTAL DO TITULAR (Risco-001) ═════════════════════════════════════════
  //
  // Nenhuma delas tem `acao`: o titular não tem papel, e inventar um papel
  // "titular" faria a matriz interna decidir sobre alguém que não é ator da
  // organização. O que autoriza aqui é a verificação — e o nível dela vem do
  // direito, nunca do cliente.
  {
    metodo: 'GET', caminho: /^me\/direitos$/, superficie: 'portal',
    tipo: 'leitura', foraDeEscopo: '401_uniforme', exigeSessao: false,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'O cardápio dos onze direitos, com nível e prazo. Não carrega dado de titular, e por isso '
      + 'é a única do portal que responde antes de qualquer verificação.',
  },
  {
    metodo: 'POST', caminho: /^me\/verificacao$/, superficie: 'portal',
    tipo: 'escrita', foraDeEscopo: '401_uniforme', exigeSessao: false,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'Abre a verificação no nível que o direito exige. Responde 201 mesmo sem cadastro: '
      + 'um 404 aqui seria oráculo de existência operável em lote.',
  },
  {
    metodo: 'POST', caminho: /^me\/verificacao\/[^/]+\/codigo$/, superficie: 'portal',
    tipo: 'escrita', foraDeEscopo: '401_uniforme', exigeSessao: false,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'Confirma e emite a sessão. A recusa é uma só, idêntica para código errado, fator errado '
      + 'e identificador sem cadastro.',
  },
  {
    metodo: 'POST', caminho: /^requests$/, superficie: 'portal',
    tipo: 'escrita', foraDeEscopo: '401_uniforme', exigeSessao: true,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'Abre a solicitação. Calcula o prazo pelo direito e grava antes de responder — falha de '
      + 'log derruba o protocolo inteiro.',
  },
  {
    metodo: 'GET', caminho: /^requests\/[^/]+\/pacote$/, superficie: 'portal',
    tipo: 'leitura', foraDeEscopo: '401_uniforme', exigeSessao: true,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'O pacote de resposta, por link assinado de 24 h — com a frase que justifica a validade curta.',
  },
  {
    metodo: 'POST', caminho: /^requests\/[^/]+\/mensagens$/, superficie: 'portal',
    tipo: 'escrita', foraDeEscopo: '401_uniforme', exigeSessao: true,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'A ponta do titular no mesmo canal da T4. Passa pelo redator antes do append.',
  },
  {
    metodo: 'GET', caminho: /^requests\/[^/]+$/, superficie: 'portal',
    tipo: 'leitura', foraDeEscopo: '401_uniforme', exigeSessao: true,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'O próprio pedido: estado, prazo, apagados e retidos. Protocolo de outra pessoa responde '
      + 'igual a não confirmado.',
  },
  {
    metodo: 'GET', caminho: /^me\/consentimentos$/, superficie: 'portal',
    tipo: 'leitura', foraDeEscopo: '401_uniforme', exigeSessao: true,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'O texto consentido na versão aceita, com data e canal — a prova do Art. 8º, §2º.',
  },
  {
    metodo: 'POST', caminho: /^me\/consentimentos\/[^/]+\/revogacao$/, superficie: 'portal',
    tipo: 'escrita', foraDeEscopo: '401_uniforme', exigeSessao: true,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'Revogação do titular da sessão, e não do campo inteiro. Dispara a cascata e a registra.',
  },
  {
    metodo: 'GET', caminho: /^me\/consentimentos\/[^/]+\/propagacao$/, superficie: 'portal',
    tipo: 'leitura', foraDeEscopo: '401_uniforme', exigeSessao: true,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'Onde a revogação já chegou. Pendência acima de 24 h levanta alerta — visível ao titular.',
  },
  {
    metodo: 'POST', caminho: /^me\/decisoes\/[^/]+\/revisao$/, superficie: 'portal',
    tipo: 'escrita', foraDeEscopo: '401_uniforme', exigeSessao: true,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'A contestação do Art. 20. É o pedido; o ato de rever é do console.',
  },
  {
    metodo: 'GET', caminho: /^me\/decisoes\/[^/]+$/, superficie: 'portal',
    tipo: 'leitura', foraDeEscopo: '401_uniforme', exigeSessao: true,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'Os fatores da decisão automatizada, em linguagem de pessoa (Art. 20, §1º).',
  },
  {
    metodo: 'POST', caminho: /^titulares\/me\/oposicao$/, superficie: 'portal',
    tipo: 'escrita', foraDeEscopo: '401_uniforme', exigeSessao: true,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
    nota: 'Oposição do Art. 18, §2º — o caminho que a LIA vigente publica. Vive fora de /me/ porque '
      + 'é o endereço que o artefato assinado anuncia, e mudar o endereço seria mudar a promessa. '
      + 'Não colide com a ficha do balcão em GET titulares/{id}: método, superfície e segmento diferem.',
  },

  // ══ CONSOLE INTERNO ═══════════════════════════════════════════════════════
  // ── Step-up de autenticação (Risco-011) ───────────────────────────────────
  //
  // `leitura`, e não `escrita`: quem mais precisa de step-up é o auditor
  // externo, que exporta o trail e não tem permissão de escrever em nada. Se
  // confirmar a identidade exigisse `escrever`, a exigência de step-up viraria
  // uma porta trancada por dentro para exatamente o papel que ela protege.
  {
    metodo: 'POST', caminho: /^step-up$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Abre o desafio de confirmação de identidade do próprio ator. Não alcança dado de titular — é '
      + 'o passo que autoriza quem vai alcançar, e exigir finalidade aqui empurraria a declaração '
      + 'para antes de a pessoa saber o que vai fazer.',
    nota: 'Abre o desafio de step-up. O código não sai na resposta: vai pelo canal, como no portal.',
  },
  {
    metodo: 'POST', caminho: /^step-up\/[^/]+\/confirmar$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Confirma o desafio e abre a janela. Mesma razão da rota que o abre: autoriza o acesso, não é '
      + 'o acesso.',
    nota: 'Confirma o desafio. Recusa única para código errado, desafio vencido e desafio alheio.',
  },

  // ── Auditoria ─────────────────────────────────────────────────────────────
  {
    metodo: 'POST', caminho: /^audit\/verificar$/,
    tipo: 'leitura', foraDeEscopo: '403', acao: 'verificar_integridade',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Recomputa a cadeia e devolve contagem de blocos, integridade e primeira divergência. Nenhum '
      + 'valor de titular sai daqui — e exigir finalidade do auditor externo para conferir o hash seria '
      + 'pedir justificativa para o ato que existe justamente para não depender de confiança.',
    nota: 'Recomputa hashes e compara, sem mudar uma linha. É o ato que sustenta o parecer do auditor externo. '
      + 'Continua leitura mesmo gravando INTEGRIDADE_VERIFICADA (T6-01): o registro é consequência do sistema, não escalada do ator.',
  },
  {
    metodo: 'POST', caminho: /^audit\/exportar$/,
    tipo: 'leitura', foraDeEscopo: '403', acao: 'exportar_auditoria',
    finalidade: 'exigida',
    stepUp: { janelaMin: 10 },
    nota: 'Exportar o registro de acessos é, ele mesmo, um acesso — gravado antes de o arquivo existir (C-06). '
      + 'Leitura pelo mesmo motivo da verificação, e por isso alcança o auditor externo.',
  },
  {
    metodo: 'GET', caminho: /^audit(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'exigida',
    nota: 'Leitura do trail.',
  },
  {
    metodo: 'POST', caminho: /^audit\/forjar$/,
    tipo: 'escrita', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Simulação de ataque, presa ao modo demonstração e fora do contrato de produção (Risco-035). '
      + 'Adultera uma linha sem ler nenhuma; não há acesso a declarar.',
    nota: 'Simulação de ataque. Exige também o modo demonstração, checado na rota.',
  },
  {
    metodo: 'PATCH', caminho: /^audit(\/.*)?$/,
    tipo: 'escrita', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Recusada pelo banco antes de qualquer leitura — o trail é append-only. Exigir finalidade para '
      + 'uma operação que nunca acontece seria instrumentar teatro.',
    nota: 'Recusada pelo banco com 409 — append-only.',
  },
  {
    metodo: 'DELETE', caminho: /^audit(\/.*)?$/,
    tipo: 'escrita', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Recusada pelo banco antes de qualquer leitura — o trail é append-only, e nem administrador '
      + 'apaga.',
    nota: 'Recusada pelo banco com 409 — append-only.',
  },

  // ── Titulares ─────────────────────────────────────────────────────────────
  {
    metodo: 'POST', caminho: /^titulares\/buscar$/,
    tipo: 'escrita', foraDeEscopo: '404_uniforme', acao: 'buscar_titular',
    finalidade: 'exigida',
    nota: 'Localizar um titular pelo documento. Grava no trail antes de responder, por isso é escrita.',
  },
  {
    metodo: 'GET', caminho: /^titulares\/[^/]+$/,
    tipo: 'leitura', foraDeEscopo: '404_uniforme', acao: 'ver_portal_titular',
    finalidade: 'exigida',
    nota: 'Ficha do titular no balcão de atendimento.',
  },

  // ── Revelação e decisão ───────────────────────────────────────────────────
  {
    metodo: 'POST', caminho: /^pseudonyms\/resolve$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'revelar_pii',
    finalidade: 'exigida',
    stepUp: { janelaMin: 10 },
    nota: 'Reidentificação. A recusa é sobre a capacidade do ator, não sobre a existência do titular.',
  },
  {
    metodo: 'POST', caminho: /^decisoes\/[^/]+\/revisar$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'revisar_decisao',
    finalidade: 'exigida',
    nota: 'Revisão de decisão automatizada (Art. 20).',
  },

  // ── Transições de estado (PR 7) ───────────────────────────────────────────
  {
    metodo: 'POST', caminho: /^estados\/[^/]+\/[^/]+$/,
    tipo: 'escrita', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Move um artefato de governança entre estados (RIPD, parecer, achado, incidente). Opera sobre o '
      + 'artefato e devolve o estado novo; nenhum dado de titular atravessa.',
    nota: 'Mover artefato entre estados. A sequência é da tabela de mock/estados.ts; o conteúdo exigido, da rota.',
  },

  // ── Épico e PbD (PR 11) ───────────────────────────────────────────────────
  {
    metodo: 'GET', caminho: /^epicos(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Checklist dos sete princípios de PbD, com o veredito calculado pela mesma regra do gate. '
      + 'Marcação de processo, não dado de pessoa.',
    nota: 'Checklist dos sete princípios, com o veredito calculado pela mesma regra que o gate de CI usa. '
      + 'Leitura ampla: quem audita precisa ver o que foi marcado sem evidência.',
  },

  // ── Calendário do ano (PR 10 · T10) ───────────────────────────────────────
  {
    metodo: 'GET', caminho: /^calendario(\/assinatura)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Obrigações do ano e a URL do próprio feed. Obrigação não carrega dado pessoal — é regra do PR '
      + '10, provada em teste, e é o que torna o calendário sincronizável com ferramenta de fora.',
    nota: 'O ano provisionado. Leitura ampla: obrigação não carrega dado pessoal, e quem audita '
      + 'precisa ver o ano inteiro, não só a própria parte.',
  },
  {
    metodo: 'GET', caminho: /^calendario\/[^/]+\.ics$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Feed lido por cliente de calendário sem sessão, que não tem como mandar cabeçalho. O que '
      + 'autoriza aqui é o token assinado e expirável; e o evento carrega código, tipo e consequência — '
      + 'nunca titular, protocolo com dado ou escopo de incidente.',
    nota: 'Feed ICS somente leitura. O token vai no caminho, carrega o papel e o prazo, e é '
      + 'conferido na rota: quem consome é um cliente de calendário sem sessão nem cabeçalho.',
  },
  {
    metodo: 'POST', caminho: /^calendario\/[^/]+\/prorrogar$/,
    tipo: 'escrita', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Prorroga o prazo de uma obrigação de governança, com justificativa registrada. Data de '
      + 'compromisso interno, sem titular envolvido.',
    nota: 'Prorrogar exige justificativa e grava antes de a data nova valer. A permissão fina é a '
      + 'da própria obrigação, checada na rota.',
  },

  // ── Fila de trabalho (PR 9 · T0) ──────────────────────────────────────────
  {
    metodo: 'GET', caminho: /^fila$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'A fila do papel da sessão, derivada dos estados: código do artefato, prazo e dono. Item de '
      + 'atendimento aparece pelo protocolo, que é o pseudônimo — abrir o pedido exige finalidade, e essa '
      + 'exigência está na rota que abre.',
    nota: 'A fila do papel da sessão, derivada dos estados. Leitura sem parâmetro: quem lê recebe a '
      + 'própria fila e a contagem do que é de outros — contagem, nunca a lista alheia.',
  },

  // ── Tabelas de decisão (PR 8 · DMN) ───────────────────────────────────────
  {
    metodo: 'GET', caminho: /^dmn(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Catálogo das tabelas de decisão com as versões publicadas. Regra que decidiu e não pode ser lida '
      + 'por quem audita é regra que não se defende.',
    nota: 'Catálogo de D1, D2 e D3 com todas as versões publicadas. Leitura ampla de propósito: '
      + 'regra que decidiu e não pode ser lida por quem audita é regra que não se defende.',
  },
  {
    metodo: 'POST', caminho: /^dmn\/[^/]+\/aplicar$/,
    tipo: 'escrita', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Aplica a tabela sobre os atributos do artefato (categoria, volume, gatilhos) e devolve a '
      + 'decisão. As entradas são características do tratamento, não do titular.',
    nota: 'Aplicar a tabela grava a versão e as entradas antes de responder — por isso é escrita, '
      + 'mesmo a decisão sendo derivada do artefato.',
  },

  // ── Incidentes (C-07 · Art. 48) ───────────────────────────────────────────
  {
    metodo: 'GET', caminho: /^incidentes(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Fila de incidentes com escopo agregado — quantos titulares, quais categorias, qual prazo da '
      + 'ANPD. Nenhum titular identificado, por desenho do Art. 48.',
    nota: 'Fila de incidentes. Leitura ampla de propósito: incidente escondido de quem audita não é incidente tratado.',
  },
  {
    metodo: 'POST', caminho: /^incidentes$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'abrir_incidente',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Abre o incidente com escopo lido do catálogo. Registra categorias e volume; não alcança pessoa.',
    nota: 'Abre o incidente com escopo lido do catálogo. É de quem opera a resposta — engenharia e segurança.',
  },
  {
    metodo: 'POST', caminho: /^incidentes\/[^/]+\/conter$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'abrir_incidente',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Contenção técnica: estanca o vazamento antes de decidir. Ato sobre o sistema, não sobre dado.',
    nota: 'Contenção: estanca antes de decidir. Mesma mão que abriu o incidente.',
  },
  {
    metodo: 'POST', caminho: /^incidentes\/[^/]+\/(decisao|comunicar|registrar-nao-comunicacao|encerrar)$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'comunicar_incidente',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Decisão, comunicação e encerramento do incidente (Art. 48). A comunicação nomeia categorias e '
      + 'medidas, e a lista de destinatários é derivada pelo sistema — o operador não a lê aqui.',
    nota: 'Decidir, comunicar e encerrar são do DPO, que responde pela comunicação ao titular e à ANPD (Art. 48).',
  },

  // ── Consentimento (C-08) ──────────────────────────────────────────────────
  {
    metodo: 'GET', caminho: /^consentimentos(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'exigida',
    nota: 'Registros de consentimento — a prova que sustenta a base legal no ROPA.',
  },
  {
    metodo: 'POST', caminho: /^consentimentos\/[^/]+\/revogar$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'revogar_consentimento',
    finalidade: 'exigida',
    nota: 'Revogação do titular (Art. 18, VIII), operada pelo balcão. Propaga: o campo perde base legal e o gate bloqueia.',
  },

  // ── Solicitações ──────────────────────────────────────────────────────────
  {
    metodo: 'POST', caminho: /^requests\/[^/]+\/concluir$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'concluir_solicitacao',
    finalidade: 'exigida',
    stepUp: { janelaMin: 10 },
    nota: 'Encerra o atendimento e para o cronômetro do SLA.',
  },
  {
    metodo: 'POST', caminho: /^requests\/[^/]+\/mensagens$/,
    tipo: 'escrita', foraDeEscopo: '403',
    finalidade: 'exigida',
    nota: 'Canal entre titular e DPO.',
  },
  {
    metodo: 'GET', caminho: /^requests(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'exigida',
    nota: 'Fila de atendimento.',
  },

  // ── Catálogo, RIPD, LIA, risco, expurgo, KMS, métricas ────────────────────
  {
    metodo: 'GET', caminho: /^catalog(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'O ROPA vivo: nome do campo, categoria, base legal, finalidade e prazo. É metadado sobre o '
      + 'tratamento — o valor do campo nunca esteve nesta rota.',
    nota: 'ROPA vivo.',
  },
  {
    metodo: 'POST', caminho: /^catalog\/validar$/,
    tipo: 'escrita', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Valida um inventário declarado contra as regras do catálogo. Lê declaração, não dado.',
    nota: 'Validação de inventário.',
  },
  {
    metodo: 'GET', caminho: /^gates(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Execuções do gate de CI, com regra, arquivo e linha. O achado nunca carrega o valor encontrado — '
      + 'é constraint no banco (finding_sem_pii) e máscara no gate.',
    nota: 'Execuções dos gates.',
  },
  {
    metodo: 'POST', caminho: /^ripds\/[^/]+\/(aprovar|render)$/,
    tipo: 'escrita', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Aprova e gera o relatório de impacto. O RIPD descreve o tratamento e o risco do tratamento; '
      + 'titular identificado não entra.',
    nota: 'Aprovação e geração do RIPD.',
  },
  {
    metodo: 'POST', caminho: /^ripds\/[^/]+\/gatilho$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'gerar_ripd',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Dispara um gatilho de reabertura declarado numa dispensa de RIPD. Quem chama é a triagem do CI.',
    nota: 'Dispara um gatilho de reabertura declarado numa dispensa. Quem chama é a triagem do CI, '
      + 'que fala o vocabulário do catálogo — por isso a permissão é a de engenharia.',
  },
  {
    metodo: 'POST', caminho: /^lias\/[^/]+\/equidade$/,
    tipo: 'escrita', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Mede disparidade sobre massa agregada por grupo e decide o estado da LIA. Não lê registro de '
      + 'pessoa nenhuma: a entrada são contagens versionadas, e a saída é o status de um artefato jurídico. '
      + 'A finalidade do Art. 37 responde por que alguém olhou o dado de um titular, e aqui ninguém olhou.',
    nota: 'Teste de disparidade da LIA (Risco-007). Escrita porque muda o estado do artefato.',
  },
  {
    metodo: 'POST', caminho: /^lias\/[^/]+\/(campos|assinar)$/,
    tipo: 'escrita', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Vincula campo à LIA e assina o balanceamento do Art. 10. Opera sobre o artefato jurídico, não '
      + 'sobre registro de pessoa.',
    nota: 'Vínculo e assinatura da LIA.',
  },
  {
    metodo: 'GET', caminho: /^risks(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Matriz de risco: probabilidade, impacto, dano e tratamento. Risco é sobre o tratamento.',
    nota: 'Matriz de risco.',
  },
  {
    metodo: 'PATCH', caminho: /^risks\/[^/]+$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'gerenciar_risco',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Reclassifica um risco, com justificativa substantiva exigida pelo banco. Sem titular envolvido.',
    nota: 'Reclassificação de risco.',
  },
  {
    metodo: 'POST', caminho: /^purge\/[^/]+\/verificar$/,
    tipo: 'escrita', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Confere o lote executado: contagem antes, contagem depois e o par de provas. Devolve números, '
      + 'nunca os registros — que é justamente o que o expurgo eliminou.',
    nota: 'Verificação de lote de expurgo.',
  },
  {
    metodo: 'GET', caminho: /^retencao$/, tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'O ciclo de vida por campo: prazo, fato gerador, vencimento e volume estimado. Prazo vencido '
      + 'escondido de quem audita é prazo que ninguém cobra.',
    nota: 'O ciclo de vida do dado. Leitura ampla: prazo vencido escondido de quem audita é prazo que ninguém cobra.',
  },
  {
    metodo: 'POST', caminho: /^purge\/executar$/, tipo: 'escrita', foraDeEscopo: '403', acao: 'rodar_expurgo',
    finalidade: 'exigida',
    stepUp: { janelaMin: 5 },
    nota: 'Executa o expurgo do dia. Grava antes de eliminar; falha de log derruba a execução inteira.',
  },
  {
    metodo: 'GET', caminho: /^kms(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Chaves, aliases e o pipeline de rotação. Metadado de criptografia; a chave em si nunca sai.',
    nota: 'Chaves e rotação.',
  },
  {
    metodo: 'POST', caminho: /^kms\/[^/]+\/(agendar-rotacao|promover-canary)$/,
    tipo: 'escrita', foraDeEscopo: '403', acao: 'ver_pipeline_rotacao',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Opera o ciclo de vida da chave. Não decifra nada e não alcança registro de titular.',
    nota: 'Operar o ciclo de chave é de quem responde por ele — engenharia e segurança. T7-01.',
  },
  {
    metodo: 'GET', caminho: /^metrics(\/.*)?$/,
    tipo: 'leitura', foraDeEscopo: '403',
    finalidade: 'dispensada',
    motivoDaDispensa:
      'Métricas agregadas de governança, com série histórica. Números sobre o programa, não sobre '
      + 'pessoas.',
    nota: 'Métricas de governança.',
  },
];

/**
 * Rota sem política declarada é tratada como escrita e recusada. O padrão
 * fecha, não abre: quem esquecer de declarar descobre no primeiro teste, não
 * em produção.
 */
export const POLITICA_PADRAO: PoliticaRota = {
  metodo: 'POST', caminho: /.*/, tipo: 'escrita', foraDeEscopo: '403',
  // O padrão fecha também aqui: rota não declarada exige finalidade. Se
  // dispensasse, esquecer de declarar seria o caminho mais curto para escapar
  // do Art. 37 — e o padrão passaria a premiar o esquecimento.
  finalidade: 'exigida',
  nota: 'Rota sem política declarada.',
};

/**
 * O padrão do portal fecha ainda mais: sem política declarada, exige sessão e
 * responde a recusa uniforme. Rota nova no portal que ninguém declarou não
 * vaza — some.
 */
export const POLITICA_PADRAO_PORTAL: PoliticaRota = {
  metodo: 'POST', caminho: /.*/, superficie: 'portal',
  tipo: 'escrita', foraDeEscopo: '401_uniforme', exigeSessao: true,
    finalidade: 'dispensada', motivoDaDispensa: SEM_FINALIDADE_NO_PORTAL,
  nota: 'Rota do portal sem política declarada.',
};

/**
 * A superfície faz parte da chave.
 *
 * Sem ela, `GET requests/2026-0731` do portal casaria com a política da fila do
 * DPO — e a rota do titular herdaria a recusa do console, que é `403` e conta
 * o que não devia. O padrão é `console` para que as políticas já escritas
 * continuem valendo sem repetir o campo.
 */
export function politicaDe(
  metodo: Metodo, caminhoSemPrefixo: string, superficie: Superficie = 'console',
): PoliticaRota | null {
  return POLITICAS.find((p) => p.metodo === metodo
    && (p.superficie ?? 'console') === superficie
    && p.caminho.test(caminhoSemPrefixo)) ?? null;
}
