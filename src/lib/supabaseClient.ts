import { createClient } from '@supabase/supabase-js';

// These environment variables should be defined in your deployment environment
// For local development, they can be set in a .env file prefixed with VITE_
//
// `import.meta.env` n'existe QUE sous Vite. Hors de lui — dans les tests, qui
// tournent sous Node — l'objet est absent, et le lire directement levait
// « Cannot read properties of undefined ». Le repli sur un objet vide rend ce
// module importable partout ; en production Vite renseigne bien les valeurs.
const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;

// `createClient` refuse une URL vide (« supabaseUrl is required »). Hors Vite,
// on lui donne une adresse manifestement factice : le module reste importable
// pour les tests de rendu, et toute requête réellement émise échouerait de
// façon visible plutôt que de viser un vrai projet par accident.
const supabaseUrl = env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || 'cle-absente';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
