import React, { useState, useEffect } from 'react';
import { deposerFichier } from '../../helpers/uploadHelpers';
import { User, Mail, Phone, Loader2, Check, Bell, Smartphone, AtSign } from 'lucide-react';
import { SettingsCard } from './SettingsCard';
import { supabase } from '../../lib/supabaseClient';
import { UserProfile } from '../../config';
import { useAuth } from '../../context/AuthContext';

interface ProfileTabProps {
    userProfile: UserProfile | null;
    onUpdate: () => void;
}

// Default notification preferences
const DEFAULT_PREFS = {
    nouveau_document: { app: true, email: false },
    rappels: { app: true, email: true },
    messages_feed: { app: true, email: false },
    communications: { app: true, email: false },
};

type NotifEvent = keyof typeof DEFAULT_PREFS;
type NotifChannel = 'app' | 'email';

const NOTIF_EVENTS: { key: NotifEvent; label: string; description: string }[] = [
    { key: 'nouveau_document', label: 'Nouveau document', description: 'Un partenaire dépose une pièce sur un AO' },
    { key: 'rappels', label: 'Rappels', description: 'Échéances et dates limites à venir' },
    { key: 'messages_feed', label: 'Messages', description: 'Nouveau message dans le fil d\'un AO' },
    { key: 'communications', label: 'Actualités Filao', description: 'Conseils, mises à jour et offres' },
];

export const ProfileTab: React.FC<ProfileTabProps> = ({ userProfile, onUpdate }) => {
    const { user } = useAuth();
    const [formData, setFormData] = useState({
        prenom: '',
        nom: '',
        date_naissance: '',
        telephone: '',
        photo_url: '',
    });

    const [notifPrefs, setNotifPrefs] = useState(DEFAULT_PREFS);

    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [avatarError, setAvatarError] = useState(false);

    useEffect(() => {
        if (userProfile) {
            setFormData({
                prenom: userProfile.prenom || '',
                nom: userProfile.nom || '',
                date_naissance: userProfile.date_naissance || '',
                telephone: userProfile.telephone || '',
                photo_url: userProfile.photo_url || '',
            });
            if (userProfile.notification_preferences) {
                setNotifPrefs({ ...DEFAULT_PREFS, ...userProfile.notification_preferences });
            }
        }
    }, [userProfile]);

    const handleInputChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !userProfile) return;
        try {
            setUploadingPhoto(true);
            // Le nom du fichier est décidé côté serveur (nom canonique) : le
            // construire ici n'aurait aucun effet.
            const { chemin, bucket, urlPublique, erreur } = await deposerFichier(file, {
                dossier: `photos/${userProfile.email}`,
                point: 'logo',
                upsert: true,
            });
            if (erreur || !chemin) throw new Error(erreur);
            // L'URL versionnée renvoyée par le serveur prime : le nom du fichier
            // étant canonique, l'URL nue serait servie depuis le cache navigateur.
            const publicUrl = urlPublique
                || supabase.storage.from(bucket || 'public-assets').getPublicUrl(chemin).data.publicUrl;
            setFormData(prev => ({ ...prev, photo_url: publicUrl }));
            await supabase.from('utilisateurs').update({ photo_url: publicUrl }).eq('id', userProfile.id);
            onUpdate();
        } catch (err: any) {
            // Le message du serveur nomme la cause (format refusé, taille,
            // destination) ; l'écraser par un texte générique obligeait à
            // ouvrir les logs pour un diagnostic que l'utilisateur pouvait lire.
            console.error('Upload photo:', err);
            setError(err?.message || "Erreur lors de l'upload de la photo");
        } finally {
            setUploadingPhoto(false);
        }
    };

    // Toggle a single notification preference and persist immediately
    const toggleNotifPref = async (event: NotifEvent, channel: NotifChannel) => {
        if (!userProfile) return;
        const updated = {
            ...notifPrefs,
            [event]: {
                ...notifPrefs[event],
                [channel]: !notifPrefs[event][channel],
            },
        };
        setNotifPrefs(updated);
        await supabase
            .from('utilisateurs')
            .update({ notification_preferences: updated })
            .eq('id', userProfile.id);
        onUpdate();
    };

    const handleSave = async () => {
        if (!userProfile) return;
        try {
            setLoading(true);
            setError(null);
            setSuccess(false);
            const { error: updateError } = await supabase
                .from('utilisateurs')
                .update({
                    prenom: formData.prenom,
                    nom: formData.nom,
                    date_naissance: formData.date_naissance || null,
                    telephone: formData.telephone,
                })
                .eq('id', userProfile.id);
            if (updateError) throw updateError;
            setSuccess(true);
            onUpdate();
            setTimeout(() => setSuccess(false), 3000);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const inputClass = "w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-filao-primary focus:ring-1 focus:ring-filao-primary/30 transition-colors";

    // Compact toggle switch
    const Toggle = ({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) => (
        <button
            onClick={onToggle}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${enabled ? 'bg-filao-primary' : 'bg-gray-300'}`}
            role="switch"
            aria-checked={enabled}
        >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm ${enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
        </button>
    );

    return (
        <div className="space-y-3 ">
            {/* Page Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Mon Profil</h2>
                    <p className="text-gray-500 text-sm">Identité et préférences de notification</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={loading}
                    className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all ${success
                        ? 'bg-green-500 text-white'
                        : 'bg-filao-primary text-white hover:shadow-md hover:shadow-filao-primary/20'
                        } disabled:opacity-50`}
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : success ? <Check className="w-4 h-4" /> : null}
                    {success ? 'Enregistré !' : 'Enregistrer'}
                </button>
            </div>

            {error && <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{error}</div>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Photo & Identity */}
                <SettingsCard title="Photo et Identité" icon={User}>
                    <div className="flex items-start gap-4">
                        <div className="relative group shrink-0">
                            <img
                                src={(!avatarError && formData.photo_url)
                                    ? formData.photo_url
                                    : (!avatarError && (user?.user_metadata?.avatar_url || user?.user_metadata?.picture))
                                        ? (user?.user_metadata?.avatar_url || user?.user_metadata?.picture)
                                        : `https://ui-avatars.com/api/?name=${encodeURIComponent(formData.prenom)}+${encodeURIComponent(formData.nom)}&background=E8F1F2&color=1A3350&bold=true`
                                }
                                alt="Avatar"
                                className="w-14 h-14 rounded-full object-cover border-2 border-gray-100"
                                onError={() => setAvatarError(true)}
                            />
                            <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                                {uploadingPhoto ? <Loader2 className="w-5 h-5 animate-spin text-white" /> : <span className="text-[10px] text-white font-medium">Modifier</span>}
                                <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" disabled={uploadingPhoto} />
                            </label>
                        </div>
                        <div className="space-y-2 flex-1">
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-xs font-medium text-gray-600 block mb-1">Prénom</label>
                                    <input type="text" value={formData.prenom} onChange={(e) => handleInputChange('prenom', e.target.value)} className={inputClass} />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-600 block mb-1">Nom</label>
                                    <input type="text" value={formData.nom} onChange={(e) => handleInputChange('nom', e.target.value)} className={inputClass} />
                                </div>
                            </div>
                        </div>
                    </div>
                </SettingsCard>

                {/* Contact Info */}
                <SettingsCard title="Coordonnées" icon={Mail}>
                    <div className="space-y-2">
                        <div>
                            <label className="text-xs font-medium text-gray-600 block mb-1">Email</label>
                            <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-xl text-gray-500 text-sm cursor-not-allowed">
                                <Mail size={14} />
                                {userProfile?.email}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-xs font-medium text-gray-600 block mb-1">Téléphone</label>
                                <div className="relative">
                                    <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="tel"
                                        value={formData.telephone}
                                        onChange={(e) => handleInputChange('telephone', e.target.value)}
                                        className={`${inputClass} pl-9`}
                                        placeholder="06 12 34 56 78"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600 block mb-1">Date de naissance</label>
                                <input
                                    type="date"
                                    value={formData.date_naissance ? formData.date_naissance.split('T')[0] : ''}
                                    onChange={(e) => handleInputChange('date_naissance', e.target.value)}
                                    className={inputClass}
                                />
                            </div>
                        </div>
                    </div>
                </SettingsCard>

                {/* Notification Preferences — Event × Channel Matrix */}
                <SettingsCard title="Préférences de notifications" icon={Bell} className="md:col-span-2">
                    {/* Header row */}
                    <div className="grid grid-cols-[1fr_56px_56px] items-center gap-x-2 px-1">
                        <div></div>
                        <div className="flex flex-col items-center gap-0.5">
                            <Smartphone size={14} className="text-gray-400" />
                            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">App</span>
                        </div>
                        <div className="flex flex-col items-center gap-0.5">
                            <AtSign size={14} className="text-gray-400" />
                            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Email</span>
                        </div>
                    </div>

                    {/* Rows */}
                    <div className="divide-y divide-gray-100">
                        {NOTIF_EVENTS.map(({ key, label, description }) => (
                            <div key={key} className="grid grid-cols-[1fr_56px_56px] items-center gap-x-2 py-2.5 px-1">
                                <div>
                                    <p className="text-sm text-gray-700 font-medium">{label}</p>
                                    <p className="text-xs text-gray-400">{description}</p>
                                </div>
                                <div className="flex justify-center">
                                    <Toggle
                                        enabled={notifPrefs[key]?.app ?? true}
                                        onToggle={() => toggleNotifPref(key, 'app')}
                                    />
                                </div>
                                <div className="flex justify-center">
                                    <Toggle
                                        enabled={notifPrefs[key]?.email ?? false}
                                        onToggle={() => toggleNotifPref(key, 'email')}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </SettingsCard>
            </div>
        </div>
    );
};