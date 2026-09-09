import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `define` injectait `GEMINI_API_KEY` dans le bundle client, hérité du gabarit
// AI Studio. Aucun code ne lisait `process.env.API_KEY`, mais la substitution
// était littérale : dès que la variable aurait été renseignée en CI ou chez
// l'hébergeur, la clé se serait retrouvée en clair dans le JavaScript public.
// Les seules variables du client sont préfixées `VITE_` et n'ont rien de secret
// (l'URL du projet et la clé anonyme, protégées par les policies RLS).
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
