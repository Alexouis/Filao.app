import React, { useState } from 'react';
import { deposerFichier } from '../helpers/uploadHelpers';
import { useToast } from './ui/Toast';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
   UploadCloud, CheckCircle, Loader2, FileText,
   ShieldAlert, Briefcase, MapPin, Calendar,
   Building2, User, LogIn, Euro, Link as LinkIcon, Info,
   Check,
   Eye
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { APP_CONFIG, REQUIRED_DOCS_BY_ROLE, SECTORS_LABELS, MARKET_TYPES_LABELS, Tender, HANDOVER_TYPES_LABELS, PlanType, PLANS_CONFIG, PLANS_TYPES } from '../config';
import { notifyCollaborationAccepted, notifyCollaborationRejected, notifyDocumentAdded } from '../helpers/notificationHelpers';
import { capitalizeFirstLetter } from '../helpers/textHelpers'
import { LimitReachedModal } from './LimitReachedModal';

export const CollaboratorSubmission: React.FC = () => {
   const { showToast } = useToast();
   const [searchParams] = useSearchParams();
   const navigate = useNavigate();
   const tenderIdParam = searchParams.get('tenderId');
   const tokenParam = searchParams.get('token');

   // --- STATE ---
   const [step, setStep] = useState<'verify' | 'workspace'>('verify');
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [showLimitModal, setShowLimitModal] = useState(false);

   // Verification Form
   const [emailInput, setEmailInput] = useState('');
   const [codeInput, setCodeInput] = useState('');
   // Secret ayant servi à ouvrir la session invité. Les fonctions SECURITY
   // DEFINER l'exigent à nouveau pour toute écriture : il n'y a plus d'UPDATE
   // direct sur `invitations` depuis le client.
   const [guestAuth, setGuestAuth] = useState<
      { mode: 'token'; token: string } | { mode: 'code'; email: string; code: string } | null
   >(null);

   // Workspace Data
   const [tender, setTender] = useState<Tender | null>(null);
   const [myCollabData, setMyCollabData] = useState<any>(null);
   const [owner, setOwner] = useState<any>(null); // Store Creator Profile
   const [tenderFiles, setTenderFiles] = useState<any[]>([]);
   const [uploadingFile, setUploadingFile] = useState<string | null>(null);

   // --- AUTO-LOGIN WITH TOKEN ---
   React.useEffect(() => {
      if (tokenParam) {
         handleTokenAuth();
      }
   }, [tokenParam]);

   /**
    * Les fonctions SECURITY DEFINER de la migration 034 renvoient un
    * enregistrement à plat. On reconstitue ici la forme attendue par l'écran,
    * qui recevait auparavant `tender:reponses_ao (*)` — donc toutes les
    * colonnes, y compris celles qu'il n'affiche pas.
    */
   const mapInvitationRow = (row: any) => ({
      invite: {
         id: row.invitation_id,
         email: row.email,
         role: row.role,
         status: row.status,
         expires_at: row.expires_at
      },
      tender: {
         id: row.tender_id,
         titre: row.titre,
         organisme_acheteur: row.organisme_acheteur,
         date_limite: row.date_limite,
         date_publication: row.date_publication,
         date_depot_souhaitee: row.date_depot_souhaitee,
         montant_estime: row.montant_estime,
         lieu_execution: row.lieu_execution,
         secteur_activite: row.secteur_activite,
         type_marche: row.type_marche,
         type_groupement: row.type_groupement,
         mode_passation: row.mode_passation,
         description: row.description,
         lien_telechargement: row.lien_telechargement,
         statut: row.statut,
         createur_id: row.createur_id
      }
   });

   const handleTokenAuth = async () => {
      setLoading(true);
      setError(null);
      try {
         // 1. Validate Token & Fetch Tender
         // `invitations` n'est plus lisible directement (migration 034) : le
         // token est exigé en paramètre de la fonction.
         const { data: rows, error: inviteError } = await supabase
            .rpc('get_invitation_by_token', { p_token: tokenParam });

         const row = rows?.[0];
         if (inviteError || !row) throw new Error("Invitation invalide ou expirée.");
         if (row.expires_at && new Date(row.expires_at) < new Date()) throw new Error("Invitation expirée.");

         const { invite, tender: tenderData } = mapInvitationRow(row);
         if (!tenderData.id) throw new Error("Appel d'offres introuvable.");
         setGuestAuth({ mode: 'token', token: tokenParam as string });

         // 2. Fetch Owner
         // Lecture par RPC, comme dans la branche « code d'accès ». Interroger
         // `utilisateurs` directement ne fonctionne pas ici : l'invité n'est pas
         // authentifié et n'a aucun droit de lecture sur cette table. La requête
         // renvoyait donc null sans erreur, `owner` restait nul, et le dépôt de
         // fichier sortait silencieusement sur la garde de `handleFileUpload`.
         const { data: ownerResults, error: ownerErr } = await supabase.rpc('get_tender_owner_info', {
            p_tender_id: tenderData.id
         });

         if (ownerErr) {
            console.error("get_tender_owner_info:", ownerErr);
            setOwner({ id: tenderData.createur_id, plan: 'partenaire', storage_used: 0 });
         } else if (ownerResults && ownerResults.length > 0) {
            setOwner(ownerResults[0]);
         } else {
            setOwner({ id: tenderData.createur_id, plan: 'partenaire', storage_used: 0 });
         }
         
         setTender(tenderData);
         setMyCollabData({
            id: invite.id,
            email: invite.email,
            role: invite.role,
            status: invite.status === 'accepted' ? 'approved' : invite.status === 'refused' ? 'refused' : 'pending',
            name: invite.email.split('@')[0],
            hasAccount: false // Will be resolved if they log in
         });
         setStep('workspace');

         // Load files
         fetchTenderFiles(tenderData.id, invite.email);

      } catch (err: any) {
         console.error(err);
         setError(err.message || "Erreur d'authentification invitation.");
      } finally {
         setLoading(false);
      }
   };

   // --- 1. VERIFICATION LOGIC ---
   const handleVerify = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!tenderIdParam) {
         setError("Lien invalide (ID manquant).");
         return;
      }

      setLoading(true);
      setError(null);

      try {
         // 1. Fetch the Invitation linked to this tender and email
         // Le code d'accès est vérifié côté base : tant que `invitations` était
         // lisible par tous, il ne protégeait rien.
         const { data: rows, error: inviteError } = await supabase
            .rpc('get_invitation_by_code', {
               p_tender_id: tenderIdParam,
               p_email: emailInput,
               p_code: codeInput
            });

         const row = rows?.[0];
         if (inviteError || !row) throw new Error("Identifiants incorrects ou accès révoqué.");

         const { invite, tender: tenderData } = mapInvitationRow(row);
         if (!tenderData.id) throw new Error("Appel d'offres introuvable.");
         setGuestAuth({ mode: 'code', email: emailInput, code: codeInput });

         // 2. Fetch Owner (Creator) Info via RPC to avoid RLS circular dependency
         const { data: ownerResults, error: ownerErr } = await supabase.rpc('get_tender_owner_info', { 
            p_tender_id: tenderIdParam 
         });

         if (ownerErr) {
            console.error("RPC Error:", ownerErr);
            // Optionally set fallback plan if RPC fails
            setOwner({ id: tenderData.createur_id, plan: 'partenaire', storage_used: 0 });
         } else if (ownerResults && ownerResults.length > 0) {
            setOwner(ownerResults[0]);
         }

         setTender(tenderData);
         setMyCollabData({
            id: invite.id,
            email: invite.email,
            role: invite.role,
            status: invite.status === 'accepted' ? 'approved' : invite.status === 'refused' ? 'refused' : 'pending',
            name: invite.email.split('@')[0],
            hasAccount: false
         });
         setStep('workspace');

         // Load files immediately (using email as folder for guests)
         fetchTenderFiles(tenderData.id, invite.email);

      } catch (err: any) {
         console.error(err);
         setError(err.message);
      } finally {
         setLoading(false);
      }
   };

   // --- 2. WORKSPACE LOGIC ---

   const fetchTenderFiles = async (tId: string, ownerEmail: string) => {

      const { data, error } = await supabase.storage
         .from('documents')
         .list(`${ownerEmail}`); // Adjust this path match your bucket structure

      if (!error && data) {
         // Filter files belonging to THIS tender
         const relevantFiles = data.filter(f => f.name.includes(tId));

         setTenderFiles(relevantFiles.map(f => ({ ...f, docType: f.name.split('-')[0] })));
      }
   };

   const handleStatusChange = async (newStatus: 'approved' | 'refused') => {
      if (!tender || !myCollabData) return;
      setLoading(true);

      try {
         // 1. Call the edge function for unified acceptance
         // This handles invitations and groupements tables
         const { data: { session } } = await supabase.auth.getSession();
         
         const payload = {
            tenderId: tender.id,
            accept: newStatus === 'approved'
         };

         // If user is logged in, we can use the edge function directly
         if (session) {
            const { error: edgeError } = await supabase.functions.invoke('accept-invitation', {
               body: payload
            });
            if (edgeError) throw edgeError;
         } else {
            // Guest Flow: Update invitations table directly if allowed (or we'd need a guest-authorized edge function)
            // For now, let's update invitations table. 
            // Note: RLS must allow this (policy usually allows update if token matches)
            
            let answer = {};
            if(newStatus === 'approved'){
               answer["status"] = 'accepted';
               answer["accepted_at"] = new Date().toISOString();
            } else {
               answer["status"] = 'refused';
               answer["refused_at"] = new Date().toISOString();
            }
            const nouveauStatut = newStatus === 'approved' ? 'accepted' : 'refused';

            const { data: ok, error: inviteError } = guestAuth?.mode === 'token'
               ? await supabase.rpc('respond_to_invitation', {
                    p_token: guestAuth.token, p_status: nouveauStatut })
               : await supabase.rpc('respond_to_invitation_by_code', {
                    p_tender_id: tenderIdParam ?? tender?.id,
                    p_email: guestAuth?.mode === 'code' ? guestAuth.email : myCollabData.email,
                    p_code: guestAuth?.mode === 'code' ? guestAuth.code : '',
                    p_status: nouveauStatut });

            if (inviteError) throw inviteError;
            if (!ok) {
               // La fonction refuse si l'invitation n'est plus `pending` ou a
               // expiré ; l'UPDATE direct l'acceptait silencieusement.
               showToast("Cette invitation a déjà reçu une réponse ou a expiré.", 'warning');
               return;
            }
         }

         // 2. Update Local State
         setMyCollabData({ ...myCollabData, status: newStatus });

         showToast(newStatus === 'approved' ? 'Invitation acceptée !' : 'Invitation refusée.', 'success');

      } catch (err) {
         console.error(err);
         showToast('Erreur lors de la mise à jour du statut.', 'error');
      } finally {
         setLoading(false);
      }
   };

    const handleDownload = async (fileName: string) => {
      if (!myCollabData?.email) return;
      const fullPath = `${myCollabData.email}/${fileName}`;
      
      const { data, error } = await supabase.storage
         .from('documents')
         .createSignedUrl(fullPath, 60); // 1 minute link

      if (error) {
         console.error("Download error:", error);
         // If toast isn't imported, we'll use a simple alert or just log
         alert("Erreur lors de l'accès au fichier. Veuillez réessayer.");
      } else if (data?.signedUrl) {
         window.open(data.signedUrl, '_blank');
      }
   };

   const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, docType: string) => {
       if (!event.target.files || event.target.files.length === 0) return;
       // Cette garde renvoyait sans un mot : un `owner` non résolu faisait
       // échouer le dépôt sans erreur, sans requête réseau et sans trace.
       if (!tender || !owner) {
          console.error('Dépôt impossible : contexte incomplet', { tender: !!tender, owner: !!owner });
          showToast("Le dossier n'est pas complètement chargé. Rechargez la page et réessayez.", 'error');
          return;
       }

       const file = event.target.files[0];
       const newFileSize = file.size;

       setUploadingFile(docType);

      try {
         // --- 1. DETERMINE PATH & CHECK EXISTING FILE ---
         const userIdentifier = myCollabData.email;
         // Filename format: TYPE-COLLABID-TENDERID
         // This matches the parsing logic in TenderWizard.tsx
         const fileName = `${docType}-${myCollabData.id}-${tender.id}`;
         const folderPath = userIdentifier;
         const fullPath = `${folderPath}/${fileName}`;

         // Check if a file with this name already exists to calculate the Delta
         let oldFileSize = 0;
         const { data: existingFiles } = await supabase.storage
            .from('documents')
            .list(folderPath, { search: fileName });

         // Exact match check
         const existingFile = existingFiles?.find(f => f.name === fileName);
         if (existingFile) {
            oldFileSize = existingFile.metadata?.size || 0;
         }

         // Calculate the difference (Positive = using more space, Negative = freeing space)
         const delta = newFileSize - oldFileSize;

         // --- 2. CHECK CREATOR'S STORAGE LIMIT (Using Delta) ---
         let creatorPlanKey = (owner.plan as PlanType) || PLANS_TYPES.free;
         if (!PLANS_CONFIG[creatorPlanKey]) creatorPlanKey = PLANS_TYPES.free;
         const planConfig = PLANS_CONFIG[creatorPlanKey];
         const currentUsage = owner.storage_used || 0;
         // Note: Adjust 'storageLimit' access based on your actual config structure (e.g. planConfig.storageLimit or planConfig.limits.storage)
         const storageLimit = planConfig.storageLimit || planConfig.limits?.storage;

         if (delta > 0 && (currentUsage + delta > storageLimit)) {
            setShowLimitModal(true);
            setUploadingFile(null);
            return; // STOP UPLOAD
         }

         // --- 3. UPLOAD TO STORAGE ---
         // Dépôt d'un partenaire non inscrit : c'est le point d'entrée le plus
         // exposé, l'appelant n'ayant pas de compte. Le secret utilisé à
         // l'ouverture de la session invité est rejoué ici pour que le serveur
         // vérifie lui-même l'identité.
         const { erreur } = await deposerFichier(file, {
            dossier: myCollabData.email,
            point: 'depot_partenaire',
            upsert: true,
            ...(guestAuth?.mode === 'token'
               ? { token: guestAuth.token }
               : guestAuth?.mode === 'code'
                  ? { tenderId: tenderIdParam ?? tender?.id, email: guestAuth.email, accessCode: guestAuth.code }
                  : {}),
         });

         if (erreur) throw new Error(erreur);

         // --- 4. INCREMENT CREATOR'S DB COUNTER (Storage) ---
         // We charge the usage to the Creator (owner.id)
         if (delta !== 0) {
            const { error: rpcError } = await supabase.rpc('increment_storage_usage', {
               user_id: owner.id,
               bytes_added: delta // Use Delta!
            });

            if (rpcError) console.error("Error updating storage counter:", rpcError);

            // Update local state optimistically so UI reflects usage immediately
            setOwner((prev: any) => ({
               ...prev,
               storage_used: (prev?.storage_used || 0) + delta
            }));
         }

         // --- 5. UPDATE TENDER FILE COUNT (Progress) ---
         // Only increment if this is a NEW file (oldFileSize was 0)
         if (oldFileSize === 0) {
            const { error: countError } = await supabase.rpc('update_tender_file_count', {
               tender_id: tender.id,
               increment_by: 1
            });

            if (countError) console.error("Error updating file count:", countError);
         }

         // --- 6. REFRESH UI & NOTIFY ---
         await fetchTenderFiles(tender.id, userIdentifier);

         await notifyDocumentAdded(
            [tender.createur_id],
            myCollabData.name || myCollabData.email,
            "",
            tender.id,
            tender.titre,
            docType
         );

      } catch (err) {
         console.error(err);
         showToast('Erreur lors du téléchargement.', 'error');
      } finally {
         setUploadingFile(null);
      }
   };

   // --- HELPERS ---
   const formatCurrency = (amount: string | number) => {
      if (!amount) return 'Non renseigné';
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(amount));
   };

   const formatDate = (dateString: string) => {
      if (!dateString) return 'Non renseignée';
      return new Date(dateString).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
   };

   // --- RENDER: 1. VERIFICATION FORM ---
   if (step === 'verify') {
      return (
         <div className="min-h-screen bg-filao-surface flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-8 md:p-12 shadow-2xl w-full max-w-md border border-filao-primary/10">
               <div className="text-center mb-8">
                  <img src={APP_CONFIG.altLogo} alt="Filao" className="h-12 mb-6 mx-auto md:mx-0" />
                  <div className="w-16 h-16 bg-filao-lightTeal rounded-2xl flex items-center justify-center mx-auto mb-4 text-filao-primary">
                     <Briefcase size={32} />
                  </div>
                  <h1 className="text-2xl font-bold text-filao-dark">Espace Collaborateur</h1>
                  <p className="text-gray-500 mt-2">Connectez-vous pour accéder au dossier.</p>
               </div>

               <form onSubmit={handleVerify} className="space-y-6">
                  <div>
                     <label className="block text-sm font-bold text-gray-700 mb-2">Adresse Email</label>
                     <div className="relative">
                        <input
                           type="email"
                           required
                           value={emailInput}
                           onChange={(e) => setEmailInput(e.target.value)}
                           className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-filao-primary focus:ring-1 focus:ring-filao-primary transition-all"
                           placeholder="vous@exemple.com"
                        />
                        <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                     </div>
                  </div>

                  <div>
                     <label className="block text-sm font-bold text-gray-700 mb-2">Code d'accès</label>
                     <div className="relative">
                        <input
                           type="text"
                           required
                           value={codeInput}
                           onChange={(e) => setCodeInput(e.target.value)}
                           className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-filao-primary focus:ring-1 focus:ring-filao-primary transition-all uppercase tracking-widest"
                           placeholder="ABC-123"
                        />
                        <ShieldAlert size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                     </div>
                     <p className="text-xs text-gray-400 mt-2">Ce code vous a été envoyé par email.</p>
                  </div>

                  {error && (
                     <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2">
                        <ShieldAlert size={16} /> {error}
                     </div>
                  )}

                  <button
                     type="submit"
                     disabled={loading}
                     className="w-full bg-filao-primary text-white font-bold py-4 rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg"
                  >
                     {loading ? <Loader2 className="animate-spin" /> : <><LogIn size={20} /> Accéder au dossier</>}
                  </button>
               </form>
            </div>
         </div>
      );
   }

   // --- RENDER: 2. WORKSPACE ---
   if (!tender || !myCollabData) return null;

   const isPending = myCollabData.status === 'pending' || !myCollabData.status;
   const isApproved = myCollabData.status === 'approved';
   const role = myCollabData.role || "Sous-traitant";
   const requiredDocs = REQUIRED_DOCS_BY_ROLE[role as keyof typeof REQUIRED_DOCS_BY_ROLE] || [];

   // Format Owner Name
   const ownerName = owner
      ? `${owner.prenom} ${owner.nom}${owner.entreprise ? ` (${owner.entreprise})` : ''}`
      : "Le Créateur du marché";

   // Reusable Info Item Component
   const InfoItem = ({ icon: Icon, label, value, isLink = false }: any) => (
      <div className="flex flex-col gap-1 p-4  rounded-xl border border-gray-100 h-full">
         <div className="flex text-gray-400 items-start gap-3">
            <Icon size={16} />

            <div className="flex flex-col gap-1">
               <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
               {isLink && value ? (
                  <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-600 underline truncate hover:text-blue-800">
                     Accéder au lien
                  </a>
               ) : (
                  <span className="text-sm font-medium text-gray-800 break-words">
                     {Array.isArray(value) ? value.join(', ') : (value || 'Non renseigné')}
                  </span>
               )}
            </div>
         </div>

      </div>
   );

   return (
      <div className="min-h-screen bg-filao-surface pb-12">

         {/* Top Bar */}
         <div className="bg-filao-dark text-white p-6 shadow-lg sticky top-0 z-40">
            <div className="max-w-6xl mx-auto flex justify-between items-center">
               <div>
                  <img src={APP_CONFIG.logoExpandedUrl} alt="Filao" className="h-8" />
               </div>
               <div className="flex items-center gap-3">
                  <Briefcase className="text-filao-primary" />
                  <h1 className="font-bold text-lg md:text-xl truncate max-w-md text-ellipsis" title={tender.titre}>{capitalizeFirstLetter(tender.titre)}</h1>
               </div>
               <div className="hidden md:block text-xs bg-white/10 px-3 py-1 rounded-full">
                  Connecté : {myCollabData.email}
               </div>
            </div>
         </div>

         <div className="max-w-6xl mx-auto px-4 mt-8 space-y-8">

            {/* Invitation Banner with Mandataire Name */}
            {isPending && (
               <div className="bg-white border-l-4 border-orange-500 rounded-r-xl p-6 shadow-md flex flex-col md:flex-row items-center justify-between gap-6 animate-fade-in-up">
                  <div>
                     <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
                        <ShieldAlert className="text-orange-500" size={22} />
                        Invitation à collaborer
                     </h2>
                     <p className="text-gray-600  mt-2">
                        <span className="font-bold text-filao-dark">{ownerName}</span> vous invite à rejoindre le groupement pour ce marché en tant que <span className="font-bold text-orange-600">{role}</span>.
                     </p>
                     <p className="text-sm text-gray-500 mt-1">
                        Veuillez prendre connaissance des détails du projet ci-dessous avant d'accepter.
                     </p>
                  </div>
                  <div className="flex gap-3 shrink-0">
                     <button
                        onClick={() => handleStatusChange('refused')}
                        className="px-6 py-3 border-2 border-gray-200 text-gray-500 rounded-xl font-bold hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                     >
                        Refuser
                     </button>
                     <button
                        onClick={() => handleStatusChange('approved')}
                        className="px-8 py-3 bg-filao-primary text-white rounded-xl font-bold hover:opacity-90 transition-all shadow-lg flex items-center gap-2"
                     >
                        <Check size={20} />
                        Accepter l'invitation
                     </button>
                  </div>
               </div>
            )}

            {/* FULL TENDER INFO GRID */}
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-gray-100">
               <div className="flex items-center justify-between gap-3 mb-6 pb-4 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                     <Info className="text-filao-primary" size={24} />
                     <h2 className="text-2xl font-bold text-filao-dark">Information du projet</h2>
                  </div>
                  <div className="flex flex-col items-start md:items-end gap-1">
                     <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Statut du dossier</span>
                     <span className={`px-4 py-1.5 rounded-full text-sm font-bold shadow-sm ${
                        tender.statut === 'En cours' ? 'bg-green-100 text-green-700' :
                        tender.statut === 'Déposé' ? 'bg-blue-100 text-blue-700' :
                        tender.statut === 'Gagné' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                        tender.statut === 'Perdu' ? 'bg-gray-100 text-gray-700' :
                        'bg-gray-100 text-gray-600'
                     }`}>
                        {tender.statut || 'N/A'}
                     </span>
                  </div>
               </div>
               <div className="flex flex-col gap-4 mb-4">
                     <InfoItem icon={User} label="Créateur du marché" value={ownerName} />
                     <InfoItem icon={Info} label="Titre" value={capitalizeFirstLetter(tender.titre)} />
                  
               </div>
               {/* Key Info Grid */}
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                  <InfoItem icon={Building2} label="Organisme Acheteur" value={tender.organisme_acheteur} />
                  <InfoItem icon={MapPin} label="Lieu d'exécution" value={tender.lieu_execution} />
                  <InfoItem icon={Briefcase} label="Secteur" value={SECTORS_LABELS[tender.secteur_activite]} />
                  <InfoItem icon={Euro} label="Montant Estimé" value={formatCurrency(tender.montant_estime)} />
                  <InfoItem icon={Calendar} label="Date de publication" value={formatDate(tender.date_publication)} />
                  <div className="bg-orange-50 border-orange-100 p-4 rounded-xl border flex flex-col gap-1">
                     <div className="flex text-orange-600 items-start gap-3">
                        <Calendar size={16} />

                        <div className="flex flex-col gap-1">
                           <span className="text-xs font-bold uppercase tracking-wider">Date limite de réponse</span>
                           <span className="text-sm font-bold text-orange-700">{formatDate(tender.date_limite)}</span>

                        </div>
                     </div>
                  </div>
                  <InfoItem icon={Calendar} label="Dépôt souhaité" value={formatDate(tender.date_depot_souhaitee)} />
                  <InfoItem icon={FileText} label="Type de marché" value={MARKET_TYPES_LABELS[tender.type_marche]} />
                  <InfoItem icon={FileText} label="Mode de passation" value={HANDOVER_TYPES_LABELS[tender.mode_passation]} />
                  <InfoItem icon={LinkIcon} label="Lien DCE" value={tender.lien_telechargement} isLink />
               </div>

               {/* Description */}
               {tender.description && (
                  <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                     <span className="block text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-2">
                        <FileText size={14} /> Description du besoin
                     </span>
                     <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">{tender.description}</p>
                  </div>
               )}
            </div>

            {/* Files Upload Section */}
            <div className={`transition-all duration-500 ${!isApproved ? 'opacity-60 pointer-events-none grayscale-[0.5]' : ''}`}>
               <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-gray-100 relative">

                  {!isApproved && (
                     <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[2px] rounded-[2rem]">
                        <div className="bg-white p-6 rounded-2xl shadow-2xl border border-gray-200 text-center max-w-sm">
                           <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                              <ShieldAlert className="text-orange-500" size={32} />
                           </div>
                           <p className="font-bold text-gray-800 text-lg">Espace de dépôt verrouillé</p>
                           <p className="text-sm text-gray-500 mt-2">Vous devez accepter l'invitation du créateur pour pouvoir déposer vos pièces administratives.</p>
                        </div>
                     </div>
                  )}

                  <div className="flex justify-between items-center mb-8">
                     <div>
                        <h2 className="text-2xl font-bold text-filao-dark">Vos documents requis</h2>
                        <p className="text-gray-500 text-sm mt-1">Liste des pièces à fournir pour le rôle de {role}</p>
                     </div>
                     <span className="text-sm bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-bold">
                        {requiredDocs.length} fichiers attendus
                     </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     {requiredDocs.map((doc, idx) => {
                        const uploaded = tenderFiles.find(f => f.docType === doc.value);
                        const isTenderEnCours = tender.statut === 'En cours';

                        return (
                           <div key={idx} className={`border rounded-2xl p-5 flex items-center justify-between transition-all ${uploaded ? 'border-green-200 bg-green-50/30' : 'border-gray-200 hover:border-filao-primary/50'}`}>
                              <div className="flex items-center gap-4">
                                 <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${uploaded ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                                    {uploaded ? <CheckCircle size={24} /> : <FileText size={24} />}
                                 </div>
                                 <div>
                                    <h4 className="font-bold text-gray-800 text-sm">{doc.label}</h4>
                                    {uploaded ? (
                                       <p className="text-xs text-green-600 font-medium mt-0.5">Reçu le {new Date(uploaded.created_at).toLocaleDateString()}</p>
                                    ) : (
                                       <p className="text-xs text-orange-500 font-medium mt-0.5">En attente</p>
                                    )}
                                 </div>
                              </div>

                              <div className="flex items-center gap-2">
                                 {uploaded && (
                                    <button
                                       onClick={() => handleDownload(uploaded.name)}
                                       className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 text-gray-600 hover:bg-filao-primary hover:text-white transition-all shadow-sm"
                                       title="Visualiser le document"
                                    >
                                       <Eye size={16} />
                                    </button>
                                 )}

                                 {uploadingFile === doc.value ? (
                                    <div className="w-10 h-10 flex items-center justify-center"><Loader2 className="animate-spin text-filao-primary" /></div>
                                 ) : (
                                    isTenderEnCours && (
                                       <label className="cursor-pointer">
                                          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${uploaded ? 'bg-white border border-gray-200 text-gray-600 hover:text-filao-primary' : 'bg-filao-primary text-white hover:opacity-90 shadow-md'}`}>
                                             <UploadCloud size={16} />
                                             {uploaded ? 'Modifier' : 'Déposer'}
                                          </div>
                                          <input
                                             type="file"
                                             className="hidden"
                                             onChange={(e) => handleFileUpload(e, doc.value)}
                                             accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.png"
                                          />
                                       </label>
                                    )
                                 )}
                              </div>
                           </div>
                        );
                     })}
                  </div>
               </div>
            </div>

            {/* CTA: Create Account */}
            <div className="bg-[#1B5D7A] rounded-[2.5rem] p-10 text-white text-center shadow-xl relative overflow-hidden group">
               <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:scale-110 transition-transform duration-700"></div>
               <h3 className="text-3xl font-bold mb-4 relative z-10">Besoin de suivre plusieurs projets ?</h3>
               <p className="text-white/70 mb-8 max-w-lg mx-auto text-lg relative z-10">
                  Créez un compte gratuitement pour centraliser tous vos appels d'offres, gérer votre profil et gagner du temps sur vos prochaines collaborations.
               </p>
               <button
                  onClick={() => navigate('/register')}
                  className="bg-white text-[#1B5D7A] px-10 py-4 rounded-2xl font-bold hover:bg-gray-100 transition-all shadow-lg hover:shadow-xl relative z-10 transform hover:-translate-y-1"
               >
                  Créer mon compte Filao
               </button>
            </div>

            <LimitReachedModal
               isOpen={showLimitModal}
               onClose={() => setShowLimitModal(false)}
               limitType="storage"
               message={`Impossible de téléverser le fichier. Le quota de stockage du propriétaire de l'appel d'offres (${owner?.prenom || ''} ${owner?.nom || ''}) est atteint. Veuillez le contacter.`}
            />

         </div>
      </div>
   );
};