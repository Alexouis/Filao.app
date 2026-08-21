import React, { useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { APP_CONFIG } from '../config';

interface MfaGateProps {
    /** Identifiant du facteur TOTP vérifié à challenger. */
    factorId: string;
    /** Appelé une fois l'élévation en AAL2 réussie. */
    onVerified: () => void;
    /** Déconnexion / retour à l'écran de connexion. */
    onCancel: () => void;
}

/**
 * Barrière d'accès AAL2.
 *
 * Affichée quand une session existe (AAL1) mais qu'un facteur TOTP vérifié
 * impose une élévation en AAL2. Placée au niveau du gating global, elle couvre
 * toutes les voies d'entrée — login e-mail, retour OAuth Google, rechargement
 * de page — là où un challenge limité à l'écran de connexion en laisserait
 * passer certaines.
 *
 * Elle accepte un code TOTP ou un code de secours (8 caractères) : ce dernier
 * est vérifié côté serveur par l'edge function `mfa-backup-codes`, qui élève la
 * session en AAL2 si le code est valide et le consomme.
 */
export const MfaGate: React.FC<MfaGateProps> = ({ factorId, onVerified, onCancel }) => {
    const [code, setCode] = useState('');
    const [useBackup, setUseBackup] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const verifyTotp = async () => {
        const clean = code.replace(/\s/g, '');
        if (!/^\d{6}$/.test(clean)) {
            setError('Saisissez le code à 6 chiffres de votre application.');
            return;
        }
        setError(null);
        setLoading(true);
        try {
            const { data: challenge, error: challengeError } =
                await supabase.auth.mfa.challenge({ factorId });
            if (challengeError) throw challengeError;

            const { error: verifyError } = await supabase.auth.mfa.verify({
                factorId,
                challengeId: challenge.id,
                code: clean,
            });
            if (verifyError) throw verifyError;

            onVerified();
        } catch {
            setError('Code incorrect. Vérifiez l\'heure de votre téléphone et réessayez.');
        } finally {
            setLoading(false);
        }
    };

    const verifyBackup = async () => {
        const clean = code.replace(/[\s-]/g, '').toUpperCase();
        if (clean.length < 8) {
            setError('Saisissez un code de secours complet.');
            return;
        }
        setError(null);
        setLoading(true);
        try {
            const { data, error: fnError } = await supabase.functions.invoke('mfa-backup-codes', {
                body: { action: 'recover', code: clean },
            });
            if (fnError) throw fnError;
            if (!data?.success) {
                setError(data?.error === 'invalid_code'
                    ? 'Code de secours invalide ou déjà utilisé.'
                    : 'Vérification impossible. Réessayez.');
                return;
            }
            // Le facteur TOTP a été retiré côté serveur : la session redevient
            // AAL1 sans exigence AAL2. On rafraîchit pour que la barrière tombe,
            // puis on laisse entrer. L'utilisateur pourra ré-enrôler un facteur.
            await supabase.auth.refreshSession();
            onVerified();
        } catch {
            setError('Vérification impossible. Réessayez.');
        } finally {
            setLoading(false);
        }
    };

    const submit = () => (useBackup ? verifyBackup() : verifyTotp());

    return (
        <div className="min-h-screen flex items-center justify-center bg-white px-4">
            <div className="w-full max-w-md mx-auto space-y-8 text-center">
                <img src={APP_CONFIG.altLogo} alt="Filao" className="h-12 mb-6 mx-auto" />

                <div className="flex items-center justify-center w-20 h-20 rounded-full bg-[#EFF4F8] mx-auto">
                    <Lock className="text-filao-primary" size={34} />
                </div>

                <div className="space-y-3">
                    <h2 className="text-2xl font-bold text-filao-dark">Vérification en deux étapes</h2>
                    <p className="text-gray-500 text-sm leading-relaxed">
                        {useBackup
                            ? 'Saisissez l\'un de vos codes de secours. Cela désactivera la double authentification : vous pourrez la réactiver ensuite depuis vos paramètres.'
                            : 'Saisissez le code à 6 chiffres affiché par votre application d\'authentification.'}
                    </p>
                </div>

                {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

                <input
                    type="text"
                    inputMode={useBackup ? 'text' : 'numeric'}
                    autoComplete="one-time-code"
                    maxLength={useBackup ? 14 : 6}
                    value={code}
                    onChange={(e) => setCode(useBackup ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                    placeholder={useBackup ? 'XXXX-XXXX' : '123456'}
                    autoFocus
                    className="w-full bg-[#EFF4F8] border border-transparent rounded-lg px-4 py-3 text-filao-dark text-center text-lg font-mono tracking-[0.4em] focus:outline-none focus:border-filao-blue/30 focus:bg-white transition-all"
                />

                <button
                    onClick={submit}
                    disabled={loading}
                    className="w-full bg-[#0E4F70] text-white font-bold py-3.5 rounded-lg hover:bg-[#0A3D58] transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
                >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Vérifier
                </button>

                <div className="flex flex-col gap-2">
                    <button
                        onClick={() => { setUseBackup(v => !v); setCode(''); setError(null); }}
                        className="text-xs text-filao-primary underline hover:text-filao-dark"
                    >
                        {useBackup ? 'Utiliser plutôt mon application d\'authentification' : 'Je n\'ai pas accès à mon application — utiliser un code de secours'}
                    </button>
                    <button
                        onClick={onCancel}
                        className="text-xs text-gray-400 underline hover:text-filao-dark"
                    >
                        Annuler et revenir à la connexion
                    </button>
                </div>
            </div>
        </div>
    );
};
