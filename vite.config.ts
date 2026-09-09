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
  build: {
    rollupOptions: {
      output: {
        /**
         * Dépendances tierces isolées, chacune dans son morceau.
         *
         * DEUX RAISONS
         *
         * 1. Cache. React et le client Supabase ne changent qu'aux montées de
         *    version. Mêlés au code applicatif, la moindre correction obligeait
         *    le navigateur à retélécharger 1,6 Mo ; séparés, ils survivent aux
         *    déploiements.
         *
         * 2. Portée. `recharts` ne sert qu'à l'écran de facturation. Le laisser
         *    dans un morceau commun le ferait charger pour tout le monde. Isolé,
         *    il n'arrive qu'avec l'écran qui s'en sert — d'où un morceau par
         *    bibliothèque plutôt qu'un « vendor » fourre-tout, qui aurait
         *    ramené les graphiques dès l'ouverture de l'application.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          charts: ['recharts'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
