import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { UserProfile } from '../config';

// --- Types ---
interface AuthContextType {
    session: Session | null;
    user: User | null;
    userProfile: UserProfile | null;
    loading: boolean;
    signOut: () => Promise<void>;
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
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
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

                fetchUserProfile(session.user.id);
            } else {
                setUserProfile(null);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    // Sync notifications_on with browser permission
    useEffect(() => {
        if (userProfile?.notifications_on && typeof Notification !== 'undefined' && Notification.permission === 'denied') {
            supabase.from('utilisateurs').update({ notifications_on: false }).eq('id', userProfile.id);
        }
    }, [userProfile]);

    const value: AuthContextType = {
        session,
        user: session?.user ?? null,
        userProfile,
        loading,
        signOut,
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
