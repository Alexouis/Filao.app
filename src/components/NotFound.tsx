import React from 'react';
import { Compass, ArrowLeft } from 'lucide-react';

/**
 * Page affichée pour une URL qui ne correspond à aucune route.
 *
 * La réécriture SPA renvoie `index.html` pour tout chemin inconnu : sans cet
 * écran, une adresse erronée affichait l'application comme si de rien n'était,
 * ou la page de connexion. L'utilisateur ne savait pas qu'il s'était trompé, et
 * un lien mal recopié semblait fonctionner.
 *
 * Le serveur ne peut pas distinguer une route applicative d'une faute de
 * frappe — c'est tout l'objet de la réécriture. Ce tri revient donc au routeur,
 * et c'est ici qu'il se conclut.
 */
export const NotFound: React.FC = () => (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="w-full max-w-md text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[#00A3E0]/10 flex items-center justify-center">
                <Compass size={28} className="text-[#00A3E0]" />
            </div>

            <p className="text-sm font-bold text-[#00A3E0] mb-2">Erreur 404</p>
            <h1 className="text-2xl font-bold text-[#0B1F38] mb-3">Cette page n'existe pas</h1>
            <p className="text-sm text-[#0B1F38]/60 leading-relaxed mb-8">
                L'adresse demandée ne correspond à aucune page de Filao. Elle a peut-être
                été mal recopiée, ou le lien que vous avez suivi n'est plus valide.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <a
                    href="/"
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#0B1F38] text-white font-bold rounded-xl hover:bg-[#00A3E0] transition-colors"
                >
                    <ArrowLeft size={16} /> Retour à l'accueil
                </a>
            </div>

            {/* Le chemin demandé est repris tel quel : c'est ce qui permet à
                l'utilisateur de repérer une coupure de lien dans un e-mail,
                cause la plus fréquente d'arrivée sur cette page. */}
            <p className="mt-8 text-[11px] text-[#0B1F38]/35 break-all">
                {typeof window !== 'undefined' ? window.location.pathname : ''}
            </p>
        </div>
    </div>
);