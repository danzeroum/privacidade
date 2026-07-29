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
