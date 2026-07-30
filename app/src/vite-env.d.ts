/**
 * As variáveis de ambiente que este build lê — e são estas, não "as do Vite".
 *
 * Declarar aqui em vez de puxar `vite/client` é decisão: `types` no tsconfig
 * está fechado, e uma entrada a mais no ambiente global é uma entrada a mais
 * que ninguém revisa. `VITE_PERFIL` é a única, e ela decide o que entra no
 * artefato publicado (RIPD §7.3).
 */
interface ImportMetaEnv {
  /** `producao` liga a catraca do PR 6; qualquer outro valor é demonstração. */
  readonly VITE_PERFIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * `import texto from 'arquivo?raw'` — o texto do arquivo, sem transformação.
 *
 * Declarado aqui pela mesma razão que `ImportMetaEnv`: `types` no tsconfig está
 * fechado, e puxar `vite/client` inteiro traz dezenas de declarações globais que
 * ninguém revisa. O protótipo usa isto para ler o contrato de equidade e a massa
 * de `.privacy/` — os mesmos bytes que o pipeline lê.
 */
declare module '*?raw' {
  const conteudo: string;
  export default conteudo;
}
