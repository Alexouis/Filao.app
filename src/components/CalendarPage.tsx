import React, { useState, useMemo, useEffect } from 'react';
import {
    ChevronLeft,
    ChevronRight,
    Calendar as CalendarIcon,
    Plus,
    Clock
} from 'lucide-react';
import { LimitReachedModal } from './LimitReachedModal';
import { PLANS_CONFIG, PLANS_TYPES, PlanType, REQUIRED_DOCS_BY_ROLE, UserProfile } from '../config';
import { canCreateTender } from '@/helpers/planHelpers';
import { GLASS_STYLE } from '../lib/styles';
import { supabase } from '../lib/supabaseClient';

// --- TYPES ---
// Troisième définition locale de Tender, à côté de celles de types.ts et
// config.ts. Elle omettait `invitations`, pourtant lu l. 255 depuis une jointure.
import type { Tender } from '../types';

interface CalendarPageProps {
    onAddTender: () => void;
    cachedTenders?: Tender[];
    onTendersLoad?: (tenders: Tender[]) => void;
    onNavigateToTender?: (tenderId: string, status: string) => void;
    onNavigate?: (tab: string) => void;
    userProfile: UserProfile;
}

// --- STYLES & CONSTANTS ---


type CalendarViewType = 'month' | 'week' | 'quarter';

export const CalendarPage: React.FC<CalendarPageProps> = ({
    onAddTender,
    cachedTenders,
    onTendersLoad,
    onNavigateToTender,
    onNavigate,
    userProfile
}) => {
    const [currentDate, setCurrentDate] = useState(new Date());

    const [tenders, setTenders] = useState<Tender[]>(cachedTenders || []);
    const [loading, setLoading] = useState(!cachedTenders);
    const [calendarView, setCalendarView] = useState<CalendarViewType>('month');
    const [showLimitModal, setShowLimitModal] = useState(false);
    const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
    const [hasGoogleCalendar, setHasGoogleCalendar] = useState(false);
    const [googleEvents, setGoogleEvents] = useState<any[]>([]);
    const [googleSyncError, setGoogleSyncError] = useState<string | null>(null);

    // Constants
    const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
    const weekDays = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

    // --- GOOGLE CALENDAR LOGIC ---
    useEffect(() => {
        checkGoogleIntegration();
    }, []);

    const checkGoogleIntegration = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            // 1. Check if we have an active session with Google provider tokens
            const isGoogleProvider = session.user?.app_metadata?.provider === 'google' || 
                                   session.user?.identities?.some(id => id.provider === 'google');
            
            if (session.provider_token && isGoogleProvider) {
                // Upsert into user_integrations to ensure we have the latest tokens
                const expiresAt = session.provider_refresh_token 
                    ? new Date(Date.now() + 3600 * 1000).toISOString() // Default 1h if not specified
                    : null;

                const { error: upsertError } = await supabase
                    .from('user_integrations')
                    .upsert({
                        user_id: session.user.id,
                        provider: 'google',
                        access_token: session.provider_token,
                        refresh_token: session.provider_refresh_token,
                        expires_at: expiresAt
                    }, { onConflict: 'user_id,provider' });

                if (upsertError) console.error('Error saving integration:', upsertError);
                
                setHasGoogleCalendar(true);
                fetchGoogleEvents(session.access_token);
                return;
            }

            // 2. Fallback: check database if provider_token is not in current session
            const { data, error } = await supabase
                .from('user_integrations')
                .select('*')
                .eq('user_id', session.user.id)
                .eq('provider', 'google')
                .single();
            
            if (data && !error) {
                setHasGoogleCalendar(true);
                fetchGoogleEvents(session.access_token);
            }
        } catch (err) {
            console.error('Error checking integration:', err);
        }
    };

    const fetchGoogleEvents = async (supabaseToken: string) => {
        try {
            setGoogleSyncError(null);
            const { data, error } = await supabase.functions.invoke('sync-google-calendar', {
                body: { action: 'pull_events' },
                headers: {
                    Authorization: `Bearer ${supabaseToken}`
                }
            });

            if (error) {
                // Supabase invoke returns function errors (like 400) in the error object
                const errorMsg = typeof error === 'string' ? error : (error.message || "Erreur de synchronisation");
                if (errorMsg.includes("Permissions insuffisantes") || errorMsg.includes("scope")) {
                    setGoogleSyncError("Permissions insuffisantes pour l'agenda.");
                } else if (errorMsg.includes("Session Google expirée") || errorMsg.includes("reconnexion requise")) {
                    setGoogleSyncError("Session Google expirée. Reconnexion requise.");
                } else {
                    console.error('Sync function error from invoke:', error);
                    setGoogleSyncError("Erreur de synchronisation");
                }
                return;
            }

            if (data?.error) {
                if (data.error.includes("Permissions insuffisantes") || data.error.includes("scope")) {
                    setGoogleSyncError("Permissions insuffisantes pour l'agenda.");
                } else if (data.error.includes("Session Google expirée") || data.error.includes("reconnexion requise")) {
                    setGoogleSyncError("Session Google expirée. Reconnexion requise.");
                } else {
                    console.error('Sync function error in data:', data.error);
                    setGoogleSyncError("Erreur de synchronisation");
                }
                return;
            }

            if (data?.success && data.events) {
                const formattedEvents = data.events.map((e: any) => ({
                    id: e.id,
                    type: 'google_event',
                    label: e.summary,
                    statut: 'google',
                    progress: 100,
                    time: e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'All Day',
                    dateStr: e.start?.dateTime ? e.start.dateTime.split('T')[0] : e.start?.date
                }));
                setGoogleEvents(formattedEvents);
            }
        } catch (err) {
            console.error('Error pulling events:', err);
        }
    };

    const handleConnectGoogle = async () => {
        try {
            setIsConnectingGoogle(true);
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: window.location.href, // Return right back to calendar
                    queryParams: {
                      access_type: 'offline',
                      prompt: 'consent'
                    },
                    scopes: 'https://www.googleapis.com/auth/calendar'
                }
            });
            if (error) throw error;
        } catch (err) {
            console.error('Error connecting Google:', err);
            setIsConnectingGoogle(false);
        }
    };

    // --- DATA FETCHING ---
    useEffect(() => {
        if (cachedTenders) {
            // Filter out Refused Tenders from cache
            const visible = cachedTenders.filter(t => {
                const myGroupement = t.groupements?.find((g: any) => 
                    (userProfile?.entreprise_id && g.entreprise_id === userProfile.entreprise_id)
                );
                if (myGroupement?.statut === 'refuse') return false;

                const myInvitation = t.invitations?.find((i: any) => i.email === userProfile?.email);
                if (myInvitation?.status === 'refused') return false;

                // NEW: Hide pending invitations from Calendar
                const isPending = myGroupement?.statut === 'invite' || myInvitation?.status === 'pending';
                if (isPending) return false;

                return true;
            });
            setTenders(visible);
            setLoading(false);
        } else {
            fetchTenders();
        }
    }, [cachedTenders, userProfile]);

    const fetchTenders = async () => {
        try {
            setLoading(true);
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                setLoading(false);
                return;
            }

            const { data, error } = await supabase
                .from('reponses_ao')
                .select(`
                  *,
                  groupements (
                    id,
                    role_groupement,
                    statut,
                    entreprise_id
                  ),
                  invitations (
                    id,
                    email,
                    status
                  )
                `);

            if (error) throw error;
            const validTenders = (data as unknown as Tender[]) || [];

            // Filter out Refused Tenders (both in groupements and invitations)
            const visibleTenders = validTenders.filter(t => {
                const myGroupement = t.groupements?.find((g: any) => 
                    (userProfile?.entreprise_id && g.entreprise_id === userProfile.entreprise_id)
                );
                if (myGroupement?.statut === 'refuse') return false;

                const myInvitation = t.invitations?.find((i: any) => i.email === userProfile?.email);
                if (myInvitation?.status === 'refused') return false;

                // NEW: Hide pending invitations from Calendar
                const isPending = myGroupement?.statut === 'invite' || myInvitation?.status === 'pending';
                if (isPending) return false;

                return true;
            });

            setTenders(visibleTenders);
            if (onTendersLoad) {
                onTendersLoad(visibleTenders);
            }
        } catch (error) {
            console.error('Error fetching tenders:', error);
        } finally {
            setLoading(false);
        }
    };

    // --- PROGRESS LOGIC ---
    const getProgress = (tender: Tender) => {
        const getCountForRole = (role: string) => (REQUIRED_DOCS_BY_ROLE[role as keyof typeof REQUIRED_DOCS_BY_ROLE] || []).length;

        let collabsDocsCount = 0;

        if (tender.groupements && Array.isArray(tender.groupements)) {
            tender.groupements.forEach((g: any) => {
                if (g.role_groupement) {
                    collabsDocsCount += getCountForRole(g.role_groupement);
                }
            });
        }

        if (!tender.groupements || tender.groupements.length === 0) {
            collabsDocsCount = getCountForRole("Mandataire");
        }

        const totalExpected = collabsDocsCount;
        const totalReceived = tender.nb_fichiers_recus || 0;

        if (totalExpected === 0) return 0;
        return Math.min(100, Math.round((totalReceived / totalExpected) * 100));
    };

    // --- NAVIGATION ---
    const handlePrev = () => {
        if (calendarView === 'month') setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
        else if (calendarView === 'week') setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 7));
        else setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 3, 1));
    };

    const handleNext = () => {
        if (calendarView === 'month') setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
        else if (calendarView === 'week') setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7));
        else setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 3, 1));
    };

    const handleAddTenderClick = () => {
        const check = canCreateTender(userProfile, tenders);
        if (!check.allowed) { setShowLimitModal(true); return; }
        onAddTender();
    };

    const handleEventClick = (e: React.MouseEvent, tenderId: string, status: string) => {
        e.stopPropagation();
        if (onNavigateToTender) onNavigateToTender(tenderId, status);
    };

    // --- DATA HELPERS ---
    const getEventsForDay = (day: number, month: number, year: number) => {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        const dailyTenders = tenders.filter(t => t.date_limite && t.date_limite.split('T')[0] === dateStr).map(t => {
            const dateObj = new Date(t.date_limite);
            const timeString = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return {
                id: t.id,
                type: 'tender_deadline',
                label: t.titre,
                statut: t.statut,
                progress: getProgress(t),
                time: timeString
            };
        });

        // Les jalons étaient chargés (le select utilise `*`) mais jamais lus :
        // seule `date_limite` alimentait le calendrier. Or le rétroplanning est
        // précisément ce que le calendrier doit rendre visible.
        const dailyJalons = tenders.flatMap(t =>
            (t.jalons || [])
                .filter((j: any) => j?.date && String(j.date).split('T')[0] === dateStr)
                // La date limite figure déjà via `date_limite` : on éviterait
                // sinon deux entrées identiques le même jour.
                .filter((j: any) => j.label !== 'Date limite de dépôt')
                .map((j: any) => ({
                    id: `${t.id}-${j.label}-${j.date}`,
                    tenderId: t.id,
                    type: 'jalon',
                    label: j.label,
                    tenderTitle: t.titre,
                    statut: j.statut || 'a_faire',
                    responsable: j.responsable,
                    color: j.color,
                    enRetard: j.statut !== 'fait' && new Date(j.date) < new Date(new Date().toDateString()),
                    time: ''
                }))
        );

        const dailyGoogleEvents = googleEvents.filter(e => e.dateStr === dateStr);

        return [...dailyTenders, ...dailyJalons, ...dailyGoogleEvents];
    };

    const upcomingEvents = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return tenders
            .filter(t => new Date(t.date_limite) >= today)
            .sort((a, b) => new Date(a.date_limite).getTime() - new Date(b.date_limite).getTime())
            .slice(0, 6);
    }, [tenders]);

    /**
     * Jalons à venir, tous AO confondus. Complète `upcomingEvents`, qui ne
     * regarde que les dates limites : sans cela, un dossier dont la remise est
     * dans six semaines n'apparaît nulle part alors que sa deadline questions
     * tombe la semaine prochaine.
     */
    const upcomingJalons = useMemo(() => {
        const today = new Date(new Date().toDateString());
        return tenders
            .flatMap(t => (t.jalons || [])
                .filter((j: any) => j?.date && j.statut !== 'fait' && j.label !== 'Date limite de dépôt')
                .map((j: any) => ({ ...j, tenderId: t.id, tenderTitle: t.titre })))
            .filter((j: any) => new Date(j.date) >= today)
            .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)))
            .slice(0, 6);
    }, [tenders]);

    const getCalendarLabel = () => {
        if (calendarView === 'month') {
            return `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
        } else if (calendarView === 'week') {
            return `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
        } else if (calendarView === 'quarter') {
            const qNum = Math.floor(currentDate.getMonth() / 3) + 1;
            return `Trimestre ${qNum} ${currentDate.getFullYear()}`;
        }
        return "";
    };

    // --- CALENDAR GRID LOGIC ---
    const monthGridDays = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDayOfMonth = new Date(year, month, 1);
        let startDayOfWeek = firstDayOfMonth.getDay() - 1;
        if (startDayOfWeek === -1) startDayOfWeek = 6;

        const days = [];
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = startDayOfWeek - 1; i >= 0; i--) {
            days.push({ day: prevMonthLastDay - i, month: month === 0 ? 11 : month - 1, year: month === 0 ? year - 1 : year, currentMonth: false });
        }
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let i = 1; i <= daysInMonth; i++) {
            days.push({ day: i, month: month, year: year, currentMonth: true });
        }
        const remainingCells = 42 - days.length;
        for (let i = 1; i <= remainingCells; i++) {
            days.push({ day: i, month: month === 11 ? 0 : month + 1, year: month === 11 ? year + 1 : year, currentMonth: false });
        }
        return days;
    }, [currentDate]);

    // --- SUB-COMPONENTS ---
    const CalendarGrid = () => {
        if (calendarView === 'month') {
            return (
                <div className="grid grid-cols-7 gap-3 h-full auto-rows-fr">
                    {/* Headers */}
                    {weekDays.map(day => (
                        <div key={day} className="text-center text-[#0B1F38]/40 font-bold text-xs uppercase tracking-wider mb-2">
                            {day}
                        </div>
                    ))}

                    {monthGridDays.map((d, idx) => {
                        const dayEvents = getEventsForDay(d.day, d.month, d.year);
                        const isToday = new Date().getDate() === d.day && new Date().getMonth() === d.month && new Date().getFullYear() === d.year;

                        return (
                            <div
                                key={idx}
                                className={`
                                relative p-2 md:p-3 rounded-2xl border transition-all flex flex-col gap-1 min-h-[100px] max-h-[150px] overflow-hidden group
                                ${d.currentMonth ? 'cursor-pointer' : 'opacity-40'}
                                ${isToday
                                        ? 'bg-white shadow-xl shadow-[#00A3E0]/10 border-[#00A3E0] ring-1 ring-[#00A3E0]/20 z-10 scale-[1.02]'
                                        : 'bg-white/20 border-white/30 hover:bg-white/40 hover:border-white/50'
                                    }
                            `}
                            >
                                <div className="flex justify-between items-center mb-1">
                                    <span className={`text-sm font-bold flex items-center justify-center w-7 h-7 rounded-full ${isToday ? 'bg-[#00A3E0] text-white shadow-md' : 'text-[#0B1F38]/70 group-hover:bg-white/50'}`}>
                                        {d.day}
                                    </span>
                                    {dayEvents.length > 0 && !isToday && <div className="w-2 h-2 bg-[#FF8D6D] rounded-full"></div>}
                                </div>

                                <div className="flex flex-col gap-1.5 overflow-x-hidden overflow-y-auto flex-1 min-h-0 custom-scrollbar-dark">
                                    {dayEvents.slice(0, 3).map((evt: any, i) => (
                                        <div
                                            key={i}
                                            onClick={(e) => evt.type !== 'google_event' && handleEventClick(e, evt.tenderId || evt.id, evt.statut)}
                                            className={`px-2 py-1.5 rounded-lg border font-medium flex flex-col gap-1 transition-all ${evt.type !== 'google_event' ? 'hover:scale-[1.02] cursor-pointer' : ''}
                                            bg-white/80 ${evt.type === 'google_event' ? 'border-[#00A3E0]/40' : evt.enRetard ? 'border-red-400' : evt.type === 'jalon' ? 'border-[#0B8FAC]/40' : 'border-[#FF8D6D]/30'} shadow-sm
                                        `}
                                            title={evt.label}
                                        >
                                            <div className="flex justify-between items-center w-full">
                                                <span className={`truncate text-xs font-bold ${evt.type === 'google_event' ? 'text-[#00A3E0]' : 'text-[#0B1F38]'}`}>{evt.label}</span>
                                                {/* Progress Number displayed as in dashboard */}
                                                {evt.type !== 'google_event' && evt.type !== 'jalon' && (
                                                    <span className="font-bold text-[#0B1F38] text-[9px] shrink-0">{evt.progress}%</span>
                                                )}
                                            </div>
                                            {evt.type !== 'google_event' && evt.type !== 'jalon' && (
                                                <div className="w-full h-1 bg-[#0B1F38]/10 rounded-full mt-0.5 overflow-hidden">
                                                    <div className="h-full bg-[#FF8D6D] rounded-full" style={{ width: `${evt.progress}%` }}></div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    {dayEvents.length > 3 && (
                                        <div className="text-[9px] text-[#0B1F38]/50 pl-1 font-medium">
                                            + {dayEvents.length - 3} autres
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        }

        if (calendarView === 'week') {
            const curr = new Date(currentDate);
            const first = curr.getDate() - curr.getDay() + 1;
            const weekStart = new Date(curr.setDate(first));

            const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(weekStart);
                d.setDate(weekStart.getDate() + i);
                return { day: d.getDate(), month: d.getMonth(), year: d.getFullYear() };
            });

            return (
                <div className="grid grid-cols-7 gap-4 h-full">
                    {days.map((d, i) => {
                        const dayEvents = getEventsForDay(d.day, d.month, d.year);
                        const isToday = new Date().getDate() === d.day && new Date().getMonth() === d.month && new Date().getFullYear() === d.year;

                        return (
                            <div key={i} className={`flex flex-col p-4 rounded-2xl border transition-all hover:bg-white/40 group relative h-full ${isToday ? 'bg-white border-[#00A3E0] shadow-xl ring-1 ring-[#00A3E0]/20' : 'bg-white/20 border-white/30 hover:border-white/50'}`}>
                                <div className="text-center mb-4 pb-4 border-b border-white/20">
                                    <div className="text-xs font-bold text-[#0B1F38]/40 uppercase mb-1">{weekDays[i]}</div>
                                    <div className={`text-2xl font-bold ${isToday ? 'text-[#00A3E0]' : 'text-[#0B1F38]'}`}>{d.day}</div>
                                </div>
                                {/* `min-h-0` : même défaut que la vue Mois, sans quoi le
                                    conteneur s'étire au lieu de défiler. */}
                                <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto custom-scrollbar-dark">
                                    {dayEvents.map((evt, idx) => (
                                        <div
                                            key={idx}
                                            onClick={(e) => handleEventClick(e, evt.tenderId || evt.id, evt.statut)}
                                            className="p-3 rounded-lg bg-white border border-[#FF8D6D]/30 shadow-sm flex flex-col gap-1 hover:scale-[1.02] transition-transform cursor-pointer"
                                        >
                                            <div className="flex justify-between items-start">
                                                <span className="font-bold text-[#0B1F38] text-sm truncate leading-tight">{evt.label}</span>
                                                {evt.type !== 'jalon' && <span className="font-bold text-[#0B1F38] text-xs shrink-0">{evt.progress}%</span>}
                                            </div>
                                            {/* Un jalon n'a pas d'avancement chiffré : la barre
                                                afficherait une progression inventée. */}
                                            {evt.type !== 'jalon' && (
                                                <div className="w-full h-1 bg-[#0B1F38]/10 rounded-full mt-1 overflow-hidden">
                                                    <div className="h-full bg-[#FF8D6D] rounded-full" style={{ width: `${evt.progress}%` }}></div>
                                                </div>
                                            )}
                                            {evt.type === 'jalon' ? (
                                                <div className="flex items-center gap-1 mt-1 text-[10px] text-[#0B1F38]/60 truncate">
                                                    {evt.tenderTitle}
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1 mt-1 text-[10px] text-[#0B1F38]/60">
                                                    <Clock size={10} /> {evt.time}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )
        }

        if (calendarView === 'quarter') {
            const viewMonth = currentDate.getMonth();
            const displayMonths = [0, 1, 2].map(offset => {
                const date = new Date(currentDate.getFullYear(), viewMonth + offset, 1);
                return { name: monthNames[date.getMonth()], monthIdx: date.getMonth(), year: date.getFullYear() };
            });

            return (
                <div className="grid grid-cols-3 gap-6 h-full">
                    {displayMonths.map((m, i) => {
                        const monthEvents = tenders.filter(t => {
                            const d = new Date(t.date_limite);
                            return d.getMonth() === m.monthIdx && d.getFullYear() === m.year;
                        });

                        return (
                            <div key={i} className="bg-white/30 border border-white/40 rounded-3xl p-6 flex flex-col h-full hover:bg-white/40 transition-colors">
                                <h3 className="text-xl font-bold text-[#0B1F38] mb-4 flex items-center gap-2">
                                    <CalendarIcon size={20} className="text-[#00A3E0]" /> {m.name}
                                </h3>
                                <div className="flex-1 overflow-y-auto custom-scrollbar-dark space-y-3">
                                    {monthEvents.length > 0 ? monthEvents.map((t, idx) => {
                                        const progress = getProgress(t);
                                        return (
                                            <div 
                                                key={idx} 
                                                onClick={(e) => handleEventClick(e, t.id, t.statut)}
                                                className="p-3 rounded-xl bg-white border border-[#FF8D6D]/30 shadow-sm flex flex-col gap-1 hover:scale-[1.02] transition-transform cursor-pointer"
                                            >
                                                <div className="flex justify-between items-center">
                                                    <span className="text-xs font-bold text-[#0B1F38]/50">Le {new Date(t.date_limite).getDate()}</span>
                                                    <span className="font-bold text-[#0B1F38] text-xs">{progress}%</span>
                                                </div>
                                                <div className="font-bold text-[#0B1F38] text-sm truncate">{t.titre}</div>
                                                <div className="w-full h-1 bg-[#0B1F38]/10 rounded-full mt-1 overflow-hidden">
                                                    <div className="h-full bg-[#FF8D6D] rounded-full" style={{ width: `${progress}%` }}></div>
                                                </div>
                                            </div>
                                        )
                                    }) : <div className="text-center text-[#0B1F38]/30 italic text-sm py-10">Aucun événement</div>}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )
        }

        return null;
    };

    if (loading) return (
        <div className="flex justify-center items-center h-screen bg-[#F8FAFC]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#00A3E0]"></div>
        </div>
    );

    return (
        // MAIN WRAPPER with background color and blobs
        <div className="w-full p-4 mx-auto h-full flex flex-col gap-6">
            {/* GLASS CONTAINER */}
            <div className={`flex-1 ${GLASS_STYLE} rounded-3xl flex flex-col h-full overflow-hidden relative z-10`}>

                {/* HEADER SECTION */}
                <div className="p-6 border-b border-white/30 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-[#00A3E0]">Mon calendrier</h1>
                        <p className="text-sm text-[#0B1F38]/60 mt-1">Suivez vos échéances et rendez-vous</p>
                    </div>

                    <div className="flex items-center gap-3 md:gap-4 flex-nowrap shrink-0 overflow-x-auto no-scrollbar">
                        {/* Date Navigation */}
                        <div className="flex items-center bg-white/40 border border-white/50 rounded-xl p-1 shadow-sm shrink-0">
                            <button onClick={handlePrev} className="p-2 hover:bg-white/60 rounded-lg transition-colors text-[#0B1F38]/60 hover:text-[#00A3E0]">
                                <ChevronLeft size={20} />
                            </button>
                            <span className="px-2 font-bold text-[#0B1F38] min-w-[160px] text-center capitalize text-sm">{getCalendarLabel()}</span>
                            <button onClick={handleNext} className="p-2 hover:bg-white/60 rounded-lg transition-colors text-[#0B1F38]/60 hover:text-[#00A3E0]">
                                <ChevronRight size={20} />
                            </button>
                        </div>

                        {/* View Switcher */}
                        <div className="flex bg-white/40 border border-white/50 rounded-xl p-1 shadow-sm shrink-0">
                            {['quarter', 'month', 'week'].map((view) => (
                                <button
                                    key={view}
                                    onClick={() => setCalendarView(view as CalendarViewType)}
                                    className={`px-3 py-2 text-sm font-bold rounded-lg transition-all ${calendarView === view
                                        ? 'bg-white text-[#00A3E0] shadow-sm'
                                        : 'text-[#0B1F38]/60 hover:text-[#0B1F38]'
                                        }`}
                                >
                                    {view === 'quarter' ? 'Trimestre' : view === 'month' ? 'Mois' : 'Semaine'}
                                </button>
                            ))}
                        </div>

                        {/* Action Button */}
                        <button
                            onClick={handleAddTenderClick}
                            className="flex justify-center items-center gap-2 bg-[#FF8575] hover:bg-[#ff715e] text-white font-bold px-4 py-2.5 rounded-xl shadow-lg shadow-[#FF8575]/20 transition-all transform hover:scale-[1.02] text-sm shrink-0"
                        >
                            <Plus size={18} strokeWidth={3} /> <span className="hidden sm:inline">Ajouter</span>
                        </button>
                    </div>
                </div>

                {/* CONTENT AREA */}
                <div className="flex flex-1 overflow-hidden">
                    {/* Main Calendar Grid */}
                    <div className="flex-1 p-6 overflow-y-auto custom-scrollbar-dark relative z-10">
                        <CalendarGrid />
                    </div>

                    {/* Sidebar (Upcoming Events) - styled as glass panel */}
                    {/* `min-h-0` + `overflow-hidden` : sans quoi les listes enfants
                        s'étirent à la taille de leur contenu et se chassent l'une
                        l'autre hors de l'écran. */}
                    <div className="w-80 border-l border-white/30 bg-white/10 p-6 flex flex-col gap-6 backdrop-blur-sm relative z-20 min-h-0 overflow-hidden">
                        {/* Jalons à venir : le panneau ne listait que les dates limites,
                            donc un dossier remis dans six semaines n'apparaissait nulle
                            part alors que sa deadline questions tombait sous huit jours. */}
                        {upcomingJalons.length > 0 && (
                            /* `flex-1 basis-0` : les deux listes se partagent l'espace
                               restant à parts égales et défilent chacune de leur côté.
                               Un plafond en pixels dépendait de la hauteur d'écran et
                               de la présence du bloc Synchronisation. */
                            <div className="flex-1 basis-0 min-h-0 flex flex-col">
                                <h3 className="text-lg font-bold text-[#0B1F38] mb-3 flex items-center gap-2 shrink-0">
                                    <Clock size={18} className="text-[#0B8FAC]" />
                                    Jalons à venir
                                    <span className="ml-auto text-xs font-bold text-[#0B1F38]/40">{upcomingJalons.length}</span>
                                </h3>
                                <div className="space-y-2 overflow-y-auto min-h-0 custom-scrollbar-dark pr-1">
                                    {upcomingJalons.map((j: any, idx: number) => {
                                        const d = new Date(j.date);
                                        return (
                                            <button
                                                key={idx}
                                                onClick={() => onNavigateToTender && onNavigateToTender(j.tenderId, '')}
                                                className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl bg-white/60 border border-white/50 hover:border-[#0B8FAC]/40 transition-all"
                                            >
                                                <div className="w-9 shrink-0 text-center">
                                                    <p className="text-sm font-bold text-[#0B1F38] leading-none">{d.getDate()}</p>
                                                    <p className="text-[9px] font-bold text-[#0B1F38]/40 uppercase">{monthNames[d.getMonth()].substring(0, 3)}</p>
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-xs font-bold text-[#0B1F38] truncate">{j.label}</p>
                                                    <p className="text-[10px] text-[#0B1F38]/50 truncate">{j.tenderTitle}</p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col flex-1 basis-0 min-h-0">
                            <h3 className="text-lg font-bold text-[#0B1F38] mb-4 flex items-center gap-2 shrink-0">
                                <CalendarIcon size={18} className="text-[#00A3E0]" />
                                Prochains jours
                                {/* Symétrique du compteur des jalons : la liste défilant
                                    dans une hauteur variable, rien n'indiquait sinon
                                    qu'il restait des échéances sous la ligne de flottaison. */}
                                {upcomingEvents.length > 0 && (
                                    <span className="ml-auto text-xs font-bold text-[#0B1F38]/40">{upcomingEvents.length}</span>
                                )}
                            </h3>

                            <div className="space-y-3 overflow-y-auto custom-scrollbar-dark pr-2 flex-1 min-h-0 pb-4">
                                {upcomingEvents.length > 0 ? upcomingEvents.map((tender, idx) => {
                                    const dateObj = new Date(tender.date_limite);
                                    const dayNum = dateObj.getDate();
                                    const monthStr = monthNames[dateObj.getMonth()].substring(0, 3);
                                    const progress = getProgress(tender);

                                    return (
                                        <div
                                            key={tender.id}
                                            onClick={() => onNavigateToTender && onNavigateToTender(tender.id, tender.statut)}
                                            className="p-3 bg-white border border-[#FF8D6D]/30 rounded-xl transition-all cursor-pointer group hover:shadow-md shadow-sm"
                                        >
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="text-xs font-bold text-[#0B1F38]/50">{monthStr} {dayNum}</span>
                                                {/* Progress displayed as requested */}
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-[#0B1F38] text-xs">{progress}%</span>
                                                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[#FF8D6D]/10 text-[#FF8D6D]">
                                                        {dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                            </div>
                                            <p className="font-bold text-sm text-[#FF8D6D] line-clamp-1">{tender.titre}</p>
                                            <div className="w-full h-1 bg-[#0B1F38]/10 rounded-full mt-2 overflow-hidden">
                                                <div className="h-full bg-[#FF8D6D] rounded-full" style={{ width: `${progress}%` }}></div>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-2 text-xs text-[#FF8D6D]/70">
                                                <Clock size={12} />
                                                <span>Échéance AO</span>
                                            </div>
                                        </div>
                                    )
                                }) : (
                                    <div className="p-3 bg-white/40 border border-white/50 rounded-xl">
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="text-xs font-bold text-[#0B1F38]/40">Aujourd'hui</span>
                                        </div>
                                        <p className="font-bold text-[#00A3E0] text-sm">Vous n'avez pas d'échéance proche</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="mt-auto shrink-0 p-4 rounded-xl bg-gradient-to-br from-[#00A3E0]/20 to-[#26367F]/20 border border-white/40">
                            <h4 className="font-bold text-[#0B1F38] text-sm mb-2">Synchronisation</h4>
                            {hasGoogleCalendar && !googleSyncError ? (
                                <p className="text-xs text-green-700 mb-3 font-medium">✓ Agenda Google connecté</p>
                            ) : hasGoogleCalendar && googleSyncError ? (
                                <>
                                    <p className="text-xs text-red-600 mb-1 font-bold">⚠️ Accès agenda manquant</p>
                                    <p className="text-[10px] text-[#0B1F38]/70 mb-3">Veuillez réinitialiser la connexion pour autoriser l'accès au calendrier.</p>
                                    <button
                                        onClick={handleConnectGoogle}
                                        disabled={isConnectingGoogle}
                                        className="w-full py-2 bg-white text-red-600 border border-red-100 text-xs font-bold rounded-lg shadow-sm hover:bg-red-50 transition-all disabled:opacity-50"
                                    >
                                        {isConnectingGoogle ? 'Connexion...' : 'Réinitialiser la connexion'}
                                    </button>
                                </>
                            ) : (
                                <>
                                    <p className="text-xs text-[#0B1F38]/70 mb-3">Connectez votre agenda Google pour ne rien manquer.</p>
                                    <button
                                        onClick={handleConnectGoogle}
                                        disabled={isConnectingGoogle}
                                        className="w-full py-2 bg-white text-[#0B1F38] text-xs font-bold rounded-lg shadow-sm hover:shadow-md transition-all disabled:opacity-50"
                                    >
                                        {isConnectingGoogle ? 'Connexion...' : 'Connecter Google Agenda'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <LimitReachedModal
                isOpen={showLimitModal}
                onClose={() => setShowLimitModal(false)}
                onUpgrade={() => {
                    setShowLimitModal(false);
                    if (onNavigate) onNavigate('pricing');
                }}
                limitType="activeTenders"
                planLabel={PLANS_CONFIG[(userProfile?.plan as PlanType) || PLANS_TYPES.free]?.label || 'Gratuit'}
                message={canCreateTender(userProfile, tenders).message}
            />
        </div>
    );
};