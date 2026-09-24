import React, { useId, useMemo, useState } from 'react';
import { Check, Circle, Eye, EyeOff } from 'lucide-react';
import { evaluerMotDePasse, robustesseMotDePasse, type ContexteMotDePasse } from '../../helpers/motDePasse';

/**
 * Saisie d'un NOUVEAU mot de passe, commune à l'inscription, au changement et
 * à la réinitialisation : deux champs avec affichage, jauge de robustesse et
 * légende des critères, cochés au fil de la saisie.
 *
 * Les trois formulaires avaient chacun leur présentation, et deux d'entre eux
 * n'indiquaient aucune règle avant l'envoi.
 */
export const ChampsMotDePasse: React.FC<{
    valeur: string;
    confirmation: string;
    onValeur: (v: string) => void;
    onConfirmation: (v: string) => void;
    contexte?: ContexteMotDePasse;
    classeChamp: string;
    classeLibelle?: string;
    libelleValeur?: string;
    libelleConfirmation?: string;
    /** Deux colonnes (inscription) ou une (fenêtres étroites). */
    disposition?: 'colonnes' | 'pile';
}> = ({
    valeur, confirmation, onValeur, onConfirmation, contexte = {} as ContexteMotDePasse, classeChamp,
    classeLibelle = 'text-xs font-medium text-gray-600 block mb-1',
    libelleValeur = 'Nouveau mot de passe', libelleConfirmation = 'Confirmer le mot de passe',
    disposition = 'pile',
}) => {
    const id = useId();
    const [visible, setVisible] = useState(false);
    const [visibleConf, setVisibleConf] = useState(false);
    const criteres = useMemo(() => evaluerMotDePasse(valeur, confirmation, contexte),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [valeur, confirmation, contexte.email, contexte.prenom, contexte.nom]);
    const robustesse = useMemo(() => robustesseMotDePasse(valeur, contexte),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [valeur, contexte.email, contexte.prenom, contexte.nom]);

    const champ = (
        idChamp: string, libelle: string, v: string, onChange: (v: string) => void,
        estVisible: boolean, basculer: () => void,
    ) => (
        <div>
            <label htmlFor={idChamp} className={classeLibelle}>{libelle}</label>
            <div className="relative">
                <input
                    id={idChamp}
                    type={estVisible ? 'text' : 'password'}
                    value={v}
                    onChange={(e) => onChange(e.target.value)}
                    autoComplete="new-password"
                    aria-describedby={`${id}-criteres`}
                    className={`${classeChamp} pr-10`}
                />
                <button
                    type="button"
                    onClick={basculer}
                    aria-label={estVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                    {estVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
            </div>
        </div>
    );

    return (
        <div className="space-y-3">
            <div className={disposition === 'colonnes' ? 'grid grid-cols-2 gap-4' : 'space-y-3'}>
                {champ(`${id}-mdp`, libelleValeur, valeur, onValeur, visible, () => setVisible(v => !v))}
                {champ(`${id}-conf`, libelleConfirmation, confirmation, onConfirmation, visibleConf, () => setVisibleConf(v => !v))}
            </div>

            {valeur.length > 0 && (
                <div>
                    <div className="flex gap-1 h-1.5" aria-hidden="true">
                        {[0, 1, 2, 3].map(i => (
                            <div key={i} className={`flex-1 rounded-full transition-colors ${i < robustesse.niveau ? robustesse.couleur : 'bg-gray-200'}`} />
                        ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{robustesse.libelle}</p>
                </div>
            )}

            {/* Légende des critères : visible dès le départ, cochée au fil de
                la saisie. `aria-live` annonce les changements aux lecteurs
                d'écran. */}
            <ul id={`${id}-criteres`} className="space-y-1" aria-live="polite">
                {criteres.map(c => (
                    <li key={c.cle} className={`flex items-center gap-2 text-xs ${c.ok ? 'text-emerald-600' : 'text-gray-500'}`}>
                        {c.ok
                            ? <Check size={13} className="shrink-0" aria-hidden="true" />
                            : <Circle size={11} className="shrink-0 mx-px" aria-hidden="true" />}
                        <span>{c.libelle}</span>
                        <span className="sr-only">{c.ok ? '(respecté)' : '(à respecter)'}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};
