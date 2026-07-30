import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    fs: {
      /**
       * O protótipo lê `.privacy/equidade.yaml` e `.privacy/equidade-decisoes.csv`
       * como texto (`?raw`), e os dois ficam **fora** de `app/`.
       *
       * A alternativa era copiar os números para dentro de `src/`, e é justamente
       * a redigitação que o PR 8 do histórico existe para não aceitar: o número
       * na tela e o número do pipeline seriam dois, e o dia em que divergissem
       * ninguém saberia qual estava certo. Um diretório a mais de leitura no
       * servidor de desenvolvimento é o preço de os dois lerem os mesmos bytes.
       */
      allow: ['..'],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
});
