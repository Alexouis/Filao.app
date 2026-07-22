import React, { useState } from 'react';
import { X, Star, MessageSquare, Briefcase, Trophy, AlertTriangle, Users } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useToast } from './ui/Toast';
import { STATUSES } from '@/config';

interface RatePartnersModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: () => void;
    tenderId: string;
    tenderTitle: string;
    currentUserId: string;
    currentUserCompanyId: string;
    partners: any[]; // List of partners to rate
    currentStatus?: string;
}

export const RatePartnersModal: React.FC<RatePartnersModalProps> = ({
    isOpen, onClose, onSubmit, tenderId, tenderTitle, currentUserId, currentUserCompanyId, partners, currentStatus
}) => {
    const { showToast } = useToast();
    const [ratings, setRatings] = useState<Record<string, number>>({});
    const [comments, setComments] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);

    // Status management
    const isAlreadyClosed = currentStatus === STATUSES.won || currentStatus === STATUSES.lost;
    const [selectedStatus, setSelectedStatus] = useState<string | null>(isAlreadyClosed ? currentStatus : null);

    if (!isOpen) return null;

    // Filter out my own company from partners list if present
    const partnersToRate = partners.filter(p => p.company_id !== currentUserCompanyId && p.company_id);

    const handleRatingChange = (companyId: string, rating: number) => {
        setRatings(prev => ({ ...prev, [companyId]: rating }));
    };

    const handleCommentChange = (companyId: string, comment: string) => {
        setComments(prev => ({ ...prev, [companyId]: comment }));
    };

    const handleSubmit = async () => {
        try {
            setSubmitting(true);

            // Prepare insertions
            const insertions = partnersToRate.map(p => {
                const note = ratings[p.company_id];
                if (!note) return null; // Skip if no rating

                return {
                    projet_id: tenderId,
                    evaluateur_id: currentUserCompanyId,
                    evalue_id: p.company_id,
                    note: note,
                    commentaire: comments[p.company_id] || ''
                };
            }).filter(Boolean);

            if (insertions.length > 0) {
                const { error } = await supabase
                    .from('avis_partenaires')
                    .insert(insertions);

                if (error) throw error;
            }

            // Update Tender Status if changed and not already closed
            if (!isAlreadyClosed && selectedStatus) {
                const { error: statusError } = await supabase
                    .from('reponses_ao')
                    .update({ statut: selectedStatus })
                    .eq('id', tenderId);

                if (statusError) throw statusError;
            }

            showToast('Avis et statut enregistrés avec succès', 'success');

            onSubmit(); // Proceed to close tender / refresh
            onClose();

        } catch (error) {
            console.error('Error saving ratings:', error);
            showToast('Erreur lors de l\'enregistrement des avis', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="absolute top-6 right-6 text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={24} />
                </button>

                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-[#00A3E0]/10 rounded-full flex items-center justify-center mx-auto mb-4 text-[#00A3E0]">
                        <Star size={32} fill="currentColor" />
                    </div>
                    <h2 className="text-2xl font-bold text-[#0B1F38] mb-2">Clôture du projet</h2>
                    <p className="text-gray-500">
                        Projet : <span className="font-semibold text-[#0B1F38]">"{tenderTitle}"</span>
                    </p>
                </div>

                <div className="space-y-8 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2 -mr-2">

                    {/* 1. Status Selection (if not closed) */}
                    {!isAlreadyClosed && (
                        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
                            <h3 className="font-bold text-[#0B1F38] mb-4 flex items-center gap-2">
                                <Trophy size={18} className="text-yellow-500" />
                                Résultat de l'appel d'offres
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => setSelectedStatus(STATUSES.won)}
                                    className={`py-4 px-6 rounded-xl border-2 font-bold transition-all text-center ${selectedStatus === STATUSES.won
                                            ? 'border-green-500 bg-green-50 text-green-700 shadow-sm'
                                            : 'border-gray-200 bg-white text-gray-500 hover:border-green-200 hover:bg-green-50/50'
                                        }`}
                                >
                                    🏆 {STATUSES.won}
                                </button>
                                <button
                                    onClick={() => setSelectedStatus(STATUSES.lost)}
                                    className={`py-4 px-6 rounded-xl border-2 font-bold transition-all text-center ${selectedStatus === STATUSES.lost
                                            ? 'border-red-500 bg-red-50 text-red-700 shadow-sm'
                                            : 'border-gray-200 bg-white text-gray-500 hover:border-red-200 hover:bg-red-50/50'
                                        }`}
                                >
                                    ❌ {STATUSES.lost}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 2. Partner Ratings */}
                    <div>
                        <h3 className="font-bold text-[#0B1F38] mb-4 flex items-center gap-2">
                            <Users size={18} className="text-[#00A3E0]" />
                            Notez la collaboration
                        </h3>
                        {partnersToRate.length === 0 ? (
                            <p className="text-center text-gray-400 italic py-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                Aucun partenaire à noter pour ce projet.
                            </p>
                        ) : (
                            <div className="space-y-4">
                                {partnersToRate.map(partner => (
                                    <div key={partner.company_id} className="p-4 rounded-xl bg-white border border-gray-200 shadow-sm">
                                        <div className="flex items-start gap-4 mb-4">
                                            <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-[#0B1F38] font-bold text-sm shrink-0">
                                                {partner.company_name ? partner.company_name[0] : '?'}
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="font-bold text-[#0B1F38] text-sm">{partner.company_name}</h3>
                                                <p className="text-xs text-gray-500 flex items-center gap-1">
                                                    <Briefcase size={10} />
                                                    {partner.role || 'Partenaire'}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex flex-col gap-3 pl-14">
                                            <div className="flex items-center gap-2">
                                                {[1, 2, 3, 4, 5].map((star) => (
                                                    <button
                                                        key={star}
                                                        onClick={() => handleRatingChange(partner.company_id, star)}
                                                        className={`transition-transform hover:scale-110 ${(ratings[partner.company_id] || 0) >= star
                                                                ? 'text-yellow-400 fill-yellow-400'
                                                                : 'text-gray-200'
                                                            }`}
                                                    >
                                                        <Star size={20} />
                                                    </button>
                                                ))}
                                                <span className="ml-2 text-xs font-medium text-gray-400">
                                                    {(ratings[partner.company_id] || 0)}/5
                                                </span>
                                            </div>

                                            <div className="relative">
                                                <MessageSquare size={14} className="absolute left-3 top-2.5 text-gray-400" />
                                                <textarea
                                                    value={comments[partner.company_id] || ''}
                                                    onChange={(e) => handleCommentChange(partner.company_id, e.target.value)}
                                                    placeholder="Commentaire (optionnel)..."
                                                    className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A3E0]/20 resize-none h-16"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex gap-4 mt-8 pt-6 border-t border-gray-100">
                    <button
                        onClick={onSubmit} // Skip rating
                        className="flex-1 py-3 text-gray-500 font-medium hover:bg-gray-50 rounded-xl transition-colors"
                    >
                        Passer cette étape
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="flex-1 py-3 bg-[#00A3E0] text-white font-bold rounded-xl hover:bg-[#008CC1] transition-colors shadow-lg shadow-[#00A3E0]/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {submitting ? 'Enregistrement...' : 'Valider'}
                    </button>
                </div>
            </div>
        </div>
    );
};
