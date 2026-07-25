import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calculator, BarChart3, CheckCircle2, Crown, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useAuth } from '../context/useAuth';
import { apiBaseUrl, getDashboardPath } from '../lib/auth';

type SubscriptionPlan = {
  id: string;
  code: string;
  name: string;
  description?: string;
  includesSampleSize: boolean;
  includesStatisticalAnalysis: boolean;
  monthlyPrice: number;
  yearlyPrice: number;
  isActive: boolean;
};

function SubscriptionPlans() {
  const { i18n } = useTranslation();
  const { user, token, refreshUser } = useAuth();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [isUpdatingPlanCode, setIsUpdatingPlanCode] = useState<string | null>(null);

  const copy = useMemo(() => {
    const isArabic = i18n.language === 'ar';
    return {
      badge: isArabic ? 'الاشتراكات' : 'Subscriptions',
      title: isArabic ? 'خطط مرنة للبحث والإحصاء' : 'Flexible plans for research and statistics',
      subtitle: isArabic
        ? 'اختر خطة مستقلة لحساب حجم العينة أو التحليل الإحصائي، أو اجمعهما معاً في باقة واحدة.'
        : 'Choose a standalone plan for sample size, statistical analysis, or combine both in one package.',
      monthly: isArabic ? 'شهرياً' : 'Monthly',
      yearly: isArabic ? 'سنوياً' : 'Yearly',
      sampleSize: isArabic ? 'حساب حجم العينة' : 'Sample size calculation',
      statisticalAnalysis: isArabic ? 'التحليل الإحصائي' : 'Statistical analysis',
      active: isArabic ? 'متاحة الآن' : 'Available now',
      backHome: isArabic ? 'العودة للرئيسية' : 'Back to home',
      openWorkspace: isArabic ? 'فتح لوحة التحكم' : 'Open dashboard',
      startNow: isArabic ? 'ابدأ الآن' : 'Get started',
      featured: isArabic ? 'الأكثر شمولاً' : 'Most complete',
      billingMonthly: isArabic ? 'عرض شهري' : 'Monthly view',
      billingYearly: isArabic ? 'عرض سنوي' : 'Yearly view',
      saveNote: isArabic ? 'أفضل قيمة سنوية' : 'Best annual value',
      compareTitle: isArabic ? 'مقارنة سريعة' : 'Quick comparison',
      compareSubtitle: isArabic
        ? 'المنصة تدعم باقات مستقلة لحساب حجم العينة أو التحليل الإحصائي أو الجمع بينهما.'
        : 'The platform supports standalone sample size and statistical analysis plans, or both together.',
      choosePlan: isArabic ? 'اختيار هذه الخطة' : 'Choose this plan',
      currentPlanButton: isArabic ? 'خطتك الحالية' : 'Current plan',
      updatingPlan: isArabic ? 'جاري التحديث...' : 'Updating...',
      updateSuccess: isArabic ? 'تم تحديث الاشتراك بنجاح.' : 'Subscription updated successfully.',
      updateError: isArabic ? 'تعذر تحديث الاشتراك حالياً.' : 'Unable to update subscription right now.',
      loadError: isArabic ? 'تعذر تحميل خطط الاشتراك حالياً.' : 'Unable to load subscription plans right now.',
      pricingNote: isArabic
        ? 'الأسعار الحالية تأتي من قاعدة البيانات ويمكن تحديثها مركزياً من الباكند.'
        : 'Current prices are loaded from the database and can be updated centrally from the backend.',
    };
  }, [i18n.language]);

  useEffect(() => {
    const loadPlans = async () => {
      try {
        setError('');
        const response = await fetch(`${apiBaseUrl}/auth/subscription-plans`);
        if (!response.ok) {
          throw new Error('Unable to load subscription plans');
        }
        const data = (await response.json()) as SubscriptionPlan[];
        setPlans(data);
      } catch {
        setError(copy.loadError);
      } finally {
        setIsLoading(false);
      }
    };

    void loadPlans();
  }, [copy.loadError]);

  const primaryCta = user ? getDashboardPath(user.accountType) : '/signup';
  const currentPlan = plans.find(
    (plan) =>
      plan.code === user?.subscription?.plan ||
      plan.name.toLowerCase() === String(user?.subscription?.plan ?? '').toLowerCase(),
  );

  const handleSelectPlan = async (planCode: string) => {
    if (!token) {
      return;
    }

    try {
      setError('');
      setSuccessMessage('');
      setIsUpdatingPlanCode(planCode);

      const response = await fetch(`${apiBaseUrl}/auth/subscription`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          planCode,
          billingCycle,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        throw new Error(data.message || copy.updateError);
      }

      await refreshUser();
      setSuccessMessage(copy.updateSuccess);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.updateError);
    } finally {
      setIsUpdatingPlanCode(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link to="/" className="text-sm font-medium text-slate-300 hover:text-white">
            {copy.backHome}
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link
              to={primaryCta}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 px-5 py-3 text-sm font-semibold text-white hover:shadow-lg"
            >
              {user ? copy.openWorkspace : copy.startNow}
            </Link>
          </div>
        </div>

        <div className="mt-16 text-center">
          <p className="text-sm font-semibold text-blue-300">{copy.badge}</p>
          <h1 className="mt-4 text-4xl font-bold text-white md:text-5xl">{copy.title}</h1>
          <p className="mx-auto mt-4 max-w-3xl text-lg text-slate-400">{copy.subtitle}</p>
        </div>

        <div className="mx-auto mt-10 flex max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-1">
          <button
            type="button"
            onClick={() => setBillingCycle('monthly')}
            className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${
              billingCycle === 'monthly' ? 'bg-white text-slate-900' : 'text-slate-300'
            }`}
          >
            {copy.billingMonthly}
          </button>
          <button
            type="button"
            onClick={() => setBillingCycle('yearly')}
            className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${
              billingCycle === 'yearly' ? 'bg-white text-slate-900' : 'text-slate-300'
            }`}
          >
            {copy.billingYearly}
          </button>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-sm font-medium text-slate-400">{copy.compareTitle}</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">{copy.compareSubtitle}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-sm font-medium text-slate-400">{copy.sampleSize}</p>
            <p className="mt-2 text-2xl font-bold text-white">{plans.filter((plan) => plan.includesSampleSize).length}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-sm font-medium text-slate-400">{copy.statisticalAnalysis}</p>
            <p className="mt-2 text-2xl font-bold text-white">{plans.filter((plan) => plan.includesStatisticalAnalysis).length}</p>
          </div>
        </div>

        {user ? (
          <div className="mt-8 rounded-3xl border border-blue-500/30 bg-gradient-to-r from-blue-950/60 to-cyan-950/40 p-6">
            <p className="text-sm font-semibold text-blue-300">
              {i18n.language === 'ar' ? 'خطة حسابك الحالية' : 'Your current plan'}
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white">
              {currentPlan?.name ?? user.subscription?.plan ?? (i18n.language === 'ar' ? 'لا توجد خطة نشطة' : 'No active plan')}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              {i18n.language === 'ar' ? 'الحالة:' : 'Status:'} {user.subscription?.status ?? (user.trialEndsAt ? 'trial' : 'inactive')}
              {user.subscription?.expiresAt
                ? ` • ${i18n.language === 'ar' ? 'الانتهاء' : 'Expires'}: ${new Date(user.subscription.expiresAt).toLocaleDateString(i18n.language === 'ar' ? 'ar-EG' : 'en-US')}`
                : ''}
              {!user.subscription?.expiresAt && user.trialEndsAt
                ? ` • ${i18n.language === 'ar' ? 'نهاية التجربة' : 'Trial ends'}: ${new Date(user.trialEndsAt).toLocaleDateString(i18n.language === 'ar' ? 'ar-EG' : 'en-US')}`
                : ''}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-blue-100">
                {i18n.language === 'ar' ? 'حساب حجم العينة' : 'Sample size'}: {currentPlan?.includesSampleSize ? 'Yes' : 'No'}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-blue-100">
                {i18n.language === 'ar' ? 'التحليل الإحصائي' : 'Statistical analysis'}: {currentPlan?.includesStatisticalAnalysis ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {successMessage ? (
          <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}

        {isLoading ? (
          <div className="mt-16 flex items-center justify-center text-slate-300">
            <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
            <span>Loading plans...</span>
          </div>
        ) : (
          <div className="mt-16 grid gap-6 lg:grid-cols-3">
            {plans.map((plan) => {
              const isCombinedPlan = plan.includesSampleSize && plan.includesStatisticalAnalysis;
              const Icon = isCombinedPlan ? Crown : plan.includesSampleSize ? Calculator : BarChart3;
              const isCurrentPlan =
                plan.code === user?.subscription?.plan ||
                plan.name.toLowerCase() === String(user?.subscription?.plan ?? '').toLowerCase();

              return (
                <div
                  key={plan.id}
                  className={`rounded-3xl border p-8 shadow-xl ${
                    isCombinedPlan
                      ? 'border-blue-500/40 bg-gradient-to-br from-slate-900 to-blue-950'
                      : 'border-slate-800 bg-slate-900/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-300">
                      <Icon className="h-7 w-7" />
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                      {isCombinedPlan ? copy.featured : copy.active}
                    </span>
                  </div>

                  <h2 className="mt-6 text-2xl font-bold text-white">{plan.name}</h2>
                  <p className="mt-3 min-h-[72px] text-sm leading-6 text-slate-400">
                    {plan.description}
                  </p>

                  <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          {billingCycle === 'monthly' ? copy.monthly : copy.yearly}
                        </p>
                        <p className="mt-1 text-3xl font-bold text-white">
                          ${billingCycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          {billingCycle === 'monthly' ? copy.yearly : copy.monthly}
                        </p>
                        <p className="mt-1 text-xl font-semibold text-slate-200">
                          ${billingCycle === 'monthly' ? plan.yearlyPrice : plan.monthlyPrice}
                        </p>
                        <p className="mt-1 text-xs text-emerald-300">{copy.saveNote}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 space-y-3 text-sm text-slate-200">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className={`h-4 w-4 ${plan.includesSampleSize ? 'text-emerald-400' : 'text-slate-600'}`} />
                      <span>{copy.sampleSize}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <CheckCircle2
                        className={`h-4 w-4 ${plan.includesStatisticalAnalysis ? 'text-emerald-400' : 'text-slate-600'}`}
                      />
                      <span>{copy.statisticalAnalysis}</span>
                    </div>
                  </div>

                  {user ? (
                    <button
                      type="button"
                      onClick={() => handleSelectPlan(plan.code)}
                      disabled={isCurrentPlan || isUpdatingPlanCode === plan.code}
                      className={`mt-8 inline-flex w-full items-center justify-center rounded-2xl px-5 py-3 font-semibold transition ${
                        isCurrentPlan
                          ? 'bg-slate-700 text-slate-200'
                          : 'bg-white text-slate-900 hover:bg-slate-100'
                      } disabled:cursor-not-allowed disabled:opacity-70`}
                    >
                      {isCurrentPlan
                        ? copy.currentPlanButton
                        : isUpdatingPlanCode === plan.code
                          ? copy.updatingPlan
                          : copy.choosePlan}
                    </button>
                  ) : (
                    <Link
                      to={primaryCta}
                      className="mt-8 inline-flex w-full items-center justify-center rounded-2xl bg-white px-5 py-3 font-semibold text-slate-900 hover:bg-slate-100"
                    >
                      {copy.startNow}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-10 text-center text-sm text-slate-500">{copy.pricingNote}</p>
      </div>
    </div>
  );
}

export default SubscriptionPlans;
