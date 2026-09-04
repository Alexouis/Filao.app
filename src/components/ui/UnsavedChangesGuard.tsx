import React, { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { enregistrerBoiteConfirmation } from '../../helpers/useUnsavedChanges';

/**
 * Branche la boîte « saisie non enregistrée » sur l'application.
 *
 * POURQUOI CE COMPOSANT
 * La garde utilisait `window.confirm`, la dernière boîte native de l'app
 * (« localhost:3000 indique… »). On ne pouvait pas la remplacer par une modale
 * sans lever une difficulté de fond : `window.confirm` répond de façon
 * SYNCHRONE, alors qu'une modale React demande un aller-retour de rendu.
 *
 * COMMENT
 * Ce composant, monté une seule fois à la racine, expose au registre de gardes
 * une fonction asynchrone. Quand une navigation doit être confirmée, elle ouvre
 * la modale et renvoie une promesse résolue par le choix de l'utilisateur.
 * `navigateTo` n'a plus qu'à l'attendre.
 */
export const UnsavedChangesGuard: React.FC = () => {
    const [message, setMessage] = useState<string | null>(null);
    // Résolveur de la promesse en attente. Un `ref` et non un état : le
    // modifier ne doit pas provoquer de rendu.
    const resolveRef = useRef<((reponse: boolean) => void) | null>(null);

    useEffect(() => {
        return enregistrerBoiteConfirmation((msg: string) => {
            setMessage(msg);
            return new Promise<boolean>(resolve => {
                resolveRef.current = resolve;
            });
        });
    }, []);

    const repondre = (reponse: boolean) => {
        setMessage(null);
        const resoudre = resolveRef.current;
        resolveRef.current = null;
        resoudre?.(reponse);
    };

    return (
        <ConfirmDialog
            ouvert={message !== null}
            titre="Quitter sans enregistrer ?"
            message={message ?? ''}
            libelleConfirmer="Quitter"
            libelleAnnuler="Rester"
            onConfirmer={() => repondre(true)}
            onAnnuler={() => repondre(false)}
        />
    );
};
