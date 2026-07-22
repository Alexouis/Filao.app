import React, { useState, useEffect } from 'react';
import { useToast } from './ui/Toast';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { THEME_COLORS, UserProfile, Tender, CollaboratorData, FinancialProps, MonthlyData, STATUSES, PLANS_CONFIG, PLANS_TYPES, PlanType } from '../config';
import { ChevronDown, Pencil, Loader2 } from 'lucide-react';
import { LimitReachedModal } from './LimitReachedModal';
import { supabase } from '../lib/supabaseClient';
import { canCreateTender } from '@/helpers/planHelpers';

export const Financial: React.FC<FinancialProps> = ({
  onNavigate,
  cachedTenders,
  onTendersLoad,
  userProfile
}) => {
  const { showToast } = useToast();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [userCreatedAt, setUserCreatedAt] = useState<Date | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>('');
  const [annualGoal, setAnnualGoal] = useState<number>(145000);
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [tempGoal, setTempGoal] = useState<string>('145000');
  const [allGoals, setAllGoals] = useState<Record<string, number>>({});
  const [savingGoal, setSavingGoal] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);

  // Derive user creation date from prop instead of making a separate query
  useEffect(() => {
    if (userProfile?.created_at) {
      setUserCreatedAt(new Date(userProfile.created_at));
    }
  }, [userProfile]);

  useEffect(() => {
    fetchUserGoals();
    if (cachedTenders && cachedTenders.length > 0) {
      setTenders(cachedTenders);
      setLoading(false);
    } else {
      fetchTenders();
    }
  }, [cachedTenders]);

  useEffect(() => {
    // Set initial month and year to current
    const now = new Date();
    setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    setSelectedYear(String(now.getFullYear()));
  }, []);

  // Update annual goal when year changes
  useEffect(() => {
    if (selectedYear && allGoals[selectedYear] !== undefined) {
      setAnnualGoal(allGoals[selectedYear]);
      setTempGoal(String(allGoals[selectedYear]));
    } else if (selectedYear) {
      // Default goal for years without a set goal
      setAnnualGoal(0);
      setTempGoal('0');
    }
  }, [selectedYear, allGoals]);


  const fetchUserGoals = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('utilisateurs')
        .select('objectifs')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      if (data && data.objectifs) {
        setAllGoals(data.objectifs);
        // Set current year's goal if it exists
        const currentYear = new Date().getFullYear().toString();
        if (data.objectifs[currentYear]) {
          setAnnualGoal(data.objectifs[currentYear]);
          setTempGoal(String(data.objectifs[currentYear]));
        }
      }
    } catch (error) {
      console.error('Error fetching user goals:', error);
    }
  };

  const fetchTenders = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('reponses_ao')
        .select('*')
        .eq('createur_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const tendersData = data || [];
      setTenders(tendersData);
      // if (onTendersLoad) {
      //   onTendersLoad(tendersData);
      // }
    } catch (error) {
      console.error('Error fetching tenders:', error);
    } finally {
      setLoading(false);
    }
  };

  // Generate available months from user creation to now
  const getAvailableMonths = (): { value: string; label: string }[] => {
    if (!userCreatedAt) return [];

    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const start = new Date(userCreatedAt);

    let current = new Date(start.getFullYear(), start.getMonth(), 1);

    while (current <= now) {
      const value = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
      const label = current.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      months.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
      current.setMonth(current.getMonth() + 1);
    }

    return months.reverse();
  };

  // Generate available years from user creation to now
  const getAvailableYears = (): number[] => {
    if (!userCreatedAt) return [];

    const years: number[] = [];
    const currentYear = new Date().getFullYear();
    const startYear = userCreatedAt.getFullYear();

    for (let year = startYear; year <= currentYear; year++) {
      years.push(year);
    }

    return years.reverse();
  };

  // Calculate revenue for selected month
  const getMonthRevenue = (): number => {
    if (!selectedMonth) return 0;

    const [year, month] = selectedMonth.split('-').map(Number);

    return tenders
      .filter(tender => {
        const tenderDate = new Date(tender.created_at);
        return tender.statut === STATUSES.won &&
          tenderDate.getFullYear() === year &&
          tenderDate.getMonth() + 1 === month;
      })
      .reduce((sum, tender) => sum + (tender.montant_estime || 0), 0);
  };

  // Calculate total revenue for the year
  const getYearRevenue = (): number => {
    if (!selectedYear) return 0;

    const year = parseInt(selectedYear);

    return tenders
      .filter(tender => {
        const tenderDate = new Date(tender.created_at);
        return tender.statut === STATUSES.won && tenderDate.getFullYear() === year;
      })
      .reduce((sum, tender) => sum + (tender.montant_estime || 0), 0);
  };

  // Calculate percentage of annual goal
  const getGoalPercentage = (): number => {
    const yearRevenue = getYearRevenue();
    return annualGoal > 0 ? (yearRevenue / annualGoal) * 100 : 0;
  };

  // Calculate total amount of all tenders responded to
  const getTotalRespondedAmount = (): number => {
    return tenders
      .filter(tender => tender.statut === STATUSES.on)
      .reduce((sum, tender) => sum + (tender.montant_estime || 0), 0);
  };

  // Calculate amount of ongoing tenders (not won, not lost)
  const getOngoingAmount = (): number => {
    return tenders
      .filter(tender => tender.statut === STATUSES.on)
      .reduce((sum, tender) => sum + (tender.montant_estime || 0), 0);
  };

  // Generate monthly data for the chart (last 12 months from selected month)
  const getMonthlyChartData = (): MonthlyData[] => {
    if (!selectedMonth) return [];

    const [year, month] = selectedMonth.split('-').map(Number);
    const data: MonthlyData[] = [];

    // Generate 12 months back from selected month
    for (let i = 11; i >= 0; i--) {
      const date = new Date(year, month - 1 - i, 1);
      const monthName = date.toLocaleDateString('fr-FR', { month: 'short' });

      const revenue = tenders
        .filter(tender => {
          const tenderDate = new Date(tender.created_at);
          return tender.statut === STATUSES.won &&
            tenderDate.getFullYear() === date.getFullYear() &&
            tenderDate.getMonth() === date.getMonth();
        })
        .reduce((sum, tender) => sum + (tender.montant_estime || 0), 0);

      data.push({
        name: monthName.charAt(0).toUpperCase() + monthName.slice(1),
        value: revenue
      });
    }

    return data;
  };

  const handleSaveGoal = async () => {
    const newGoal = parseFloat(tempGoal);
    if (isNaN(newGoal) || newGoal <= 0) {
      return;
    }

    try {
      setSavingGoal(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Update goals object with new value for selected year
      const updatedGoals = {
        ...allGoals,
        [selectedYear]: newGoal
      };

      const { error } = await supabase
        .from('utilisateurs')
        .update({ objectifs: updatedGoals })
        .eq('id', user.id);

      if (error) throw error;

      // Update local state
      setAllGoals(updatedGoals);
      setAnnualGoal(newGoal);
      setIsEditingGoal(false);
    } catch (error) {
      console.error('Error saving goal:', error);
      showToast("Erreur lors de la sauvegarde de l'objectif", 'error');
    } finally {
      setSavingGoal(false);
    }
  };

  const formatCurrency = (amount: number): string => {
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K €`;
    }
    return `${amount.toFixed(0)} €`;
  };

  const handleAddTenderClick = () => {
    const check = canCreateTender(userProfile, tenders); // Pass full list of tenders

    if (!check.allowed) {
      // Ideally open the Plan Modal or navigate to settings
      setShowLimitModal(true);
      return;
    }

    // If allowed, proceed
    onNavigate?.('wizard');
  };

  const monthRevenue = getMonthRevenue();
  const goalPercentage = getGoalPercentage();
  const totalRespondedAmount = getTotalRespondedAmount();
  const ongoingAmount = getOngoingAmount();
  const chartData = getMonthlyChartData();
  const availableMonths = getAvailableMonths();
  const availableYears = getAvailableYears();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar-dark pr-2 space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="bg-white/40 backdrop-blur-md rounded-filao-card p-8 md:p-10 flex flex-col md:flex-row justify-between items-center gap-6 shadow-sm border border-white/20">
        <h1 className="text-4xl font-bold text-filao-dark">Suivi financier</h1>
        <button
          onClick={handleAddTenderClick}
          className="bg-filao-primary text-white font-bold px-10 py-4 rounded-2xl shadow-lg hover:opacity-90 transition-all text-lg whitespace-nowrap w-full md:w-auto"
        >
          Répondre à un appel d'offres
        </button>
      </div>

      {/* Top Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-filao-surface/60 backdrop-blur-md rounded-filao-card-sm p-filao-card shadow-filao-card border border-white/50 flex flex-col justify-center">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-xl font-semibold text-filao-dark">Chiffre d'affaires</h3>
            <select
              className="bg-transparent border border-gray-300 rounded-filao-input text-sm px-2 py-1 outline-none text-gray-600 cursor-pointer"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {availableMonths.map(month => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>
          <span className="text-5xl font-bold text-filao-dark">
            {formatCurrency(monthRevenue)}
          </span>
        </div>

        <div className="bg-filao-dark/80 backdrop-blur-md rounded-filao-card-sm p-filao-card shadow-filao-card border border-white/10 text-white flex items-center justify-between relative overflow-hidden">
          <div className="h-32 w-32 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Done', value: Math.min(goalPercentage, 100) },
                    { name: 'Remaining', value: Math.max(100 - goalPercentage, 0) }
                  ]}
                  innerRadius={40}
                  outerRadius={55}
                  paddingAngle={5}
                  dataKey="value"
                  startAngle={90}
                  endAngle={-270}
                >
                  <Cell key="cell-0" fill={THEME_COLORS.primary} />
                  <Cell key="cell-1" fill={THEME_COLORS.white} opacity={0.2} />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-xs font-bold text-filao-primary">
                {goalPercentage.toFixed(2)}%
              </span>
            </div>
          </div>
          <div className="z-10">
            <h3 className="text-3xl font-medium">De votre objectif annuel</h3>
          </div>
        </div>
      </div>

      {/* Middle Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-filao-dark/80 backdrop-blur-md rounded-filao-card-sm p-filao-card shadow-filao-card border border-white/10 text-white">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold">Objectif annuel</h2>
              <button
                className="text-white/40 hover:text-white transition-colors"
                onClick={() => {
                  setIsEditingGoal(!isEditingGoal);
                  setTempGoal(String(annualGoal));
                }}
              >
                <Pencil size={20} />
              </button>
            </div>
            <div className="relative">
              <select
                className="px-3 py-1 bg-white/20 rounded-filao-input text-sm backdrop-blur-sm cursor-pointer hover:bg-white/30 transition-all duration-filao"
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
              >
                {availableYears.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
          </div>
          {isEditingGoal ? (
            <div className="flex items-baseline gap-2">
              <input
                type="number"
                value={tempGoal}
                onChange={(e) => setTempGoal(e.target.value)}
                className="bg-white/20 text-white text-4xl font-bold px-2 py-1 rounded outline-none w-40"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveGoal();
                  if (e.key === 'Escape') {
                    setIsEditingGoal(false);
                    setTempGoal(String(annualGoal));
                  }
                }}
                autoFocus
                disabled={savingGoal}
              />
              <span className="text-4xl font-light opacity-80">€</span>
              <button
                onClick={handleSaveGoal}
                disabled={savingGoal}
                className="ml-2 px-3 py-1 bg-filao-primary rounded text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1"
              >
                {savingGoal ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Enregistrement...
                  </>
                ) : (
                  'Valider'
                )}
              </button>
              <button
                onClick={() => {
                  setIsEditingGoal(false);
                  setTempGoal(String(annualGoal));
                }}
                disabled={savingGoal}
                className="px-3 py-1 bg-white/10 rounded text-sm hover:bg-white/20 transition-colors disabled:opacity-50"
              >
                Annuler
              </button>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold">
                {formatCurrency(annualGoal).replace(' €', '')}
              </span>
              <span className="text-5xl font-light opacity-80">€</span>
            </div>
          )}
        </div>

        <div className="bg-filao-surface/60 backdrop-blur-md rounded-filao-card-sm p-filao-card shadow-filao-card border border-white/50">
          <div className="grid grid-cols-2 gap-8 h-full">
            <div className="border-r border-gray-300 pr-4 flex flex-col justify-between">
              <p className="text-sm text-gray-500 mb-2">Montant total des appels d'offres auxquels vous avez répondu</p>
              <span className="text-3xl font-bold text-filao-dark">
                {formatCurrency(totalRespondedAmount)}
              </span>
            </div>
            <div className="flex flex-col justify-between">
              <p className="text-sm text-gray-500 mb-2">Montant des appels d'offres en cours</p>
              <span className="text-3xl font-bold text-filao-dark">
                {formatCurrency(ongoingAmount)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chart */}
      <div className="bg-filao-chart rounded-filao-card-sm p-6 shadow-filao-modal text-white relative overflow-hidden">
        <div className="flex justify-between items-center mb-8 relative z-10">
          <h3 className="text-xl font-semibold">Suivi du chiffre d'affaires</h3>
          <select
            className="bg-transparent border border-gray-300 rounded-filao-input text-sm px-2 py-1 outline-none text-white cursor-pointer"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            {availableMonths.map(month => (
              <option key={month.value} value={month.value} className="text-gray-800">
                {month.label}
              </option>
            ))}
          </select>
        </div>

        <div className="h-64 w-full relative z-10">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={THEME_COLORS.white} stopOpacity={0.5} />
                  <stop offset="95%" stopColor={THEME_COLORS.white} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'white', opacity: 0.8, fontSize: 12 }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'white', opacity: 0.8, fontSize: 12 }}
                tickFormatter={(value) => formatCurrency(value)}
              />
              <Tooltip
                contentStyle={{ backgroundColor: THEME_COLORS.dark, border: 'none', borderRadius: '8px', color: 'white' }}
                itemStyle={{ color: THEME_COLORS.primary }}
                formatter={(value: number) => [formatCurrency(value), 'Chiffre d\'affaires']}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#FFFFFF"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorValue)"
              />
            </AreaChart>
          </ResponsiveContainer>
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