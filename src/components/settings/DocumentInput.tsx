import React from 'react';
import { Upload, Loader2, FileText, Clock, AlertTriangle, ExternalLink, ShieldCheck } from 'lucide-react';

type DocumentStatus = 'valide' | 'expire' | 'en_attente';

interface DocumentInputProps {
    label: string;
    currentUrl: string;
    onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    isUploading: boolean;
    accept?: string;
    status?: DocumentStatus;
    onRemove?: () => void;
    onValidate?: () => void;
}

const statusConfig: Record<DocumentStatus, { label: string; className: string; icon: React.ReactNode }> = {
    valide: {
        label: 'Vérifié',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        icon: <ShieldCheck size={12} />,
    },
    expire: {
        label: 'Expiré',
        className: 'bg-red-50 text-red-600 border-red-200',
        icon: <AlertTriangle size={12} />,
    },
    en_attente: {
        label: 'À vérifier',
        className: 'bg-amber-50 text-amber-600 border-amber-200',
        icon: <Clock size={12} />,
    },
};

export const DocumentInput: React.FC<DocumentInputProps> = ({
    label,
    currentUrl,
    onUpload,
    isUploading,
    accept = ".pdf,.jpg,.jpeg,.png",
    status,
    onRemove,
    onValidate,
}) => {
    const statusInfo = status ? statusConfig[status] : null;

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">{label}</label>
                {/* Single badge area — either a clickable "Valider" button or a static status badge */}
                {statusInfo && currentUrl && (
                    <div>
                        {onValidate && status === 'en_attente' ? (
                            /* Clickable validate button */
                            <button
                                onClick={onValidate}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 transition-colors cursor-pointer"
                                title="Marquer comme vérifié"
                            >
                                <ShieldCheck size={12} />
                                Valider
                            </button>
                        ) : (
                            /* Static status badge */
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusInfo.className}`}>
                                {statusInfo.icon}
                                {statusInfo.label}
                            </span>
                        )}
                    </div>
                )}
            </div>
            <div className="w-full bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between transition-colors hover:border-blue-500/50">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className={`p-2 rounded-lg ${currentUrl ? (status === 'valide' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600') : 'bg-gray-100 text-gray-400'}`}>
                        {currentUrl ? (status === 'valide' ? <ShieldCheck size={16} /> : <Clock size={16} />) : <FileText size={16} />}
                    </div>
                    {currentUrl ? (
                        <a href={currentUrl} target="_blank" rel="noopener noreferrer"
                            className="truncate text-sm text-blue-600 hover:underline max-w-[150px] md:max-w-xs flex items-center gap-1">
                            {currentUrl.split('/').pop()?.split('?')[0]}
                            <ExternalLink size={12} className="shrink-0" />
                        </a>
                    ) : (
                        <span className="text-sm text-gray-400">Aucun fichier</span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {onRemove && currentUrl && (
                        <button onClick={onRemove}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-colors">
                            Supprimer
                        </button>
                    )}
                    <label className={`px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide cursor-pointer transition-all flex items-center gap-2 ${isUploading
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : currentUrl
                            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                        }`}>
                        {isUploading ? (
                            <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Upload...
                            </>
                        ) : (
                            <>
                                <Upload className="w-3 h-3" />
                                {currentUrl ? 'Modifier' : 'Ajouter'}
                            </>
                        )}
                        <input
                            type="file"
                            accept={accept}
                            onChange={onUpload}
                            className="hidden"
                            disabled={isUploading}
                        />
                    </label>
                </div>
            </div>
        </div>
    );
};
