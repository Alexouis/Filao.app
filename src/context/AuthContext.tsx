import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { chargerForfaits } from '../helpers/planLimits';
import { supabase } from '../lib/supabaseClient';
import { UserProfile } from '../config';
import { getAcquisitionParams } from '../helpers/acquisitionHelpers';
import { identifierUtilisateur, reinitialiserAnalytics } from '../helpers/analytics';

// --- Types ---
interface AuthContextType {
    session: Session | null;
    user: User | null;
    userProfile: UserProfile | null;
    loading: boolean;
    signOut: () => Promise<void>;
    /**
     * Adresse vérifiée ou non.
     *
     * L'information vit dans `auth.users.email_confirmed_at`, pas dans la table
     * `utilisateurs` : elle est donc lue depuis la session plutôt que depuis le
     * profil. Elle conditionne les actions à impact externe — envoyer une
     * invitation depuis une adresse non vérifiée expose la réputation
     * d'expéditeur du produit tout entier.
     */
    emailVerifie: boolean;
    refreshProfile: () => Promise<void>;
}

// --- Context ---
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// --- Provider ---
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    // Guard against concurrent fetchUserProfile calls (race condition between getSession + onAuthStateChange)
    const isFetchingProfile = useRef(false);

    const fetchUserProfile = async (userId: string) => {
        // Prevent concurrent calls (race between getSession + onAuthStateChange)
        if (isFetchingProfile.current) return;
        isFetchingProfile.current = true;

        try {
            // maybeSingle() returns null (not 406) when no row is found
            const { data, error } = await supabase
                .from('utilisateurs')
                .select('*, entreprises:entreprise_id(plan)')
                .eq('id', userId)
                .maybeSingle();

            if (error) {
                console.error('Error fetching user profile:', error);
                return;
            }

            if (!data) {
                // No profile yet — create one from user_metadata (Google or email/password signUp)
                const { data: { user } } = await supabase.auth.getUser();

                if (user) {
                    const meta = user.user_metadata || {};

                    // Support both Google OAuth and email/password signUp metadata
                    const fullName = meta.full_name || meta.name || '';
                    const parts = fullName.split(' ');
                    const lastNameFromGoogle = parts.length > 1 ? parts.pop() : '';
                    const firstNameFromGoogle = parts.join(' ') || fullName;

                    const nom = meta.nom || lastNameFromGoogle || 'Nom';
                    const prenom = meta.prenom || firstNameFromGoogle || 'Prénom';
                    const avatar = meta.avatar_url || meta.picture || null;
                    // UTM capturés en session au premier contact (repli pour le
                    // flux Google, qui ne transporte pas de métadonnées signUp).
                    const acquisition = getAcquisitionParams();

                    const newProfile: Record<string, any> = {
                        id: user.id,
                        email: user.email,
                        nom,
                        prenom,
                        photo_url: avatar,
                        telephone: meta.telephone || null,
                        date_naissance: meta.date_naissance || null,
                        notifications: [],
                        notifications_on: true,
                        // Traces posées à l'inscription (migration 045). Elles
                        // transitent par les métadonnées d'authentification :
                        // c'est le seul canal disponible entre `signUp` et la
                        // création du profil, qui a lieu ici.
                        cgu_acceptees_le: meta.cgu_acceptees_le || null,
                        cgu_version: meta.cgu_version || null,
                        source_inscription: meta.source_inscription || null,
                        source_detail: meta.source_detail || null,
                        // UTM first-touch. Pour l'inscription e-mail ils arrivent
                        // via les métadonnées `signUp` ; pour Google (qui ne passe
                        // pas par `signUp`) on retombe sur la capture en session.
                        // Repli mutualisé dans les deux cas.
                        utm_source: meta.utm_source || acquisition.utm_source || null,
                        utm_medium: meta.utm_medium || acquisition.utm_medium || null,
                        utm_campaign: meta.utm_campaign || acquisition.utm_campaign || null,
                        utm_term: meta.utm_term || acquisition.utm_term || null,
                        utm_content: meta.utm_content || acquisition.utm_content || null,
                    };

                    // upsert is idempotent — safe even if called twice concurrently
                    const { error: upsertError } = await supabase
                        .from('utilisateurs')
                        .upsert(newProfile, { onConflict: 'id' });

                    if (!upsertError) {
                        setUserProfile(newProfile as any);
                    } else {
                        console.error('Error creating profile:', upsertError);
                    }
                }
            } else {
                // Map entreprises.plan onto the user profile
                const plan = data.entreprises?.plan || 'partenaire';
                const { entreprises: _e, ...profileWithoutJoin } = data;

                // Sync Google avatar if photo_url is missing
                if (!data.photo_url) {
                    const { data: { user: currentUser } } = await supabase.auth.getUser();
                    const googleAvatar = currentUser?.user_metadata?.avatar_url
                        || currentUser?.user_metadata?.picture
                        || null;
                    if (googleAvatar) {
                        await supabase
                            .from('utilisateurs')
                            .update({ photo_url: googleAvatar })
                            .eq('id', userId);
                        setUserProfile({ ...profileWithoutJoin, photo_url: googleAvatar, plan } as any);
                        return;
                    }
                }

                setUserProfile({ ...profileWithoutJoin, plan } as any);
            }
        } catch (error) {
            console.error('Error fetching user profile:', error);
        } finally {
            isFetchingProfile.current = false;
        }
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        setSession(null);
        setUserProfile(null);
    };

    const refreshProfile = async () => {
        if (session?.user?.id) {
            await fetchUserProfile(session.user.id);
        }
    };

    useEffect(() => {
        // Check initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            if (session) {
                fetchUserProfile(session.user.id);
            }
            setLoading(false);
        });

        // Listen for auth changes
        // On distingue une VRAIE connexion d'une simple restauration de session
        // (rechargement, retour d'onglet) : Supabase émet `SIGNED_IN` dans les
        // deux cas. Le premier événement au montage est ignoré pour ne pas
        // journaliser une session déjà ouverte comme une nouvelle connexion.
        let premierEvenement = true;
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            setSession(session);
            if (session) {
                // If this is an OAuth sign-in, save the provider tokens to DB
                if (session.provider_token && session.user) {
                    const provider = session.user.app_metadata?.provider || 'google'; // Usually 'google'
                    // Upsert integration tokens
                    supabase.from('user_integrations').upsert({
                        user_id: session.user.id,
                        provider: provider,
                        access_token: session.provider_token,
                        refresh_token: session.provider_refresh_token,
                        // session.expires_in is for the Supabase token, not google. We'll use a standard 1hr offset if missing
                        expires_at: new Date(Date.now() + 3500 * 1000).toISOString()
                    }, { onConflict: 'user_id,provider' }).then(({ error }) => {
                        if (error) console.error('Error upserting provider token', error);
                    });
                }

                // Journal des connexions : seulement sur un SIGNED_IN qui n'est
                // pas la restauration initiale. Best-effort — un échec de
                // journalisation ne doit jamais bloquer l'entrée dans l'app.
                if (event === 'SIGNED_IN' && !premierEvenement) {
                    const methode = session.user?.app_metadata?.provider === 'google' ? 'google' : 'password';
                    supabase.functions.invoke('log-connexion', { body: { methode } })
                        .catch(err => console.warn('Journalisation de connexion échouée', err));
                }

                // Identité analytics pseudonymisée (hachage du user_id). Aucune
                // donnée personnelle : ni email, ni UUID brut n'est émis.
                identifierUtilisateur(session.user.id, session.user.email || undefined);

                fetchUserProfile(session.user.id);
            } else {
                reinitialiserAnalytics();
                setUserProfile(null);
            }
            premierEvenement = false;
        });

        return () => subscription.unsubscribe();
    }, []);

    // Sync notifications_on with browser permission
    useEffect(() => {
        if (userProfile?.notifications_on && typeof Notification !== 'undefined' && Notification.permission === 'denied') {
            supabase.from('utilisateurs').update({ notifications_on: false }).eq('id', userProfile.id);
        }
    }, [userProfile]);

    // `email_confirmed_at` est renseigné par Supabase à la validation du lien.
    // Un compte créé par Google OAuth est vérifié d'emblée, le fournisseur ayant
    // déjà validé l'adresse.
    const emailVerifie = Boolean(session?.user?.email_confirmed_at);

    // Chargement des forfaits au démarrage. Les quotas sont consultés par des
    // fonctions synchrones réparties dans plusieurs écrans, qui ne peuvent pas
    // attendre une requête : la table est donc lue une fois et mise en cache.
    useEffect(() => { chargerForfaits(); }, []);

    const value: AuthContextType = {
        session,
        user: session?.user ?? null,
        userProfile,
        loading,
        signOut,
        emailVerifie,
        refreshProfile,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// --- Hook ---
export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};