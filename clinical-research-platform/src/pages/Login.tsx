import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Brain, ChevronRight, LoaderCircle } from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { apiBaseUrl, getDashboardPath } from '../lib/auth';
import type { AccountType } from '../lib/auth';
import { useAuth } from '../context/useAuth';

function Login() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const isArabic = i18n.resolvedLanguage === 'ar';
  const textAlignClass = isArabic ? 'text-right' : 'text-left';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiBaseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = (await response.json()) as {
        message?: string;
        token?: string;
        accountType?: AccountType;
        fullName?: string;
        email?: string;
        trialEndsAt?: string;
        subscription?: {
          plan: string;
          status: 'active' | 'expired' | 'cancelled';
          expiresAt?: string;
        };
      };

      if (!response.ok || !data.accountType || !data.token) {
        throw new Error(data.message || t('login.messages.invalidCredentials'));
      }

      signIn({
        token: data.token,
        accountType: data.accountType,
        fullName: data.fullName ?? '',
        email: data.email ?? email,
        trialEndsAt: data.trialEndsAt,
        subscription: data.subscription,
      });

      navigate(getDashboardPath(data.accountType));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('login.messages.invalidCredentials'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      dir={isArabic ? 'rtl' : 'ltr'}
      className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 py-12 px-4 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            <Brain className="h-4 w-4" />
            الشاشة الرئيسية
          </Link>
          <LanguageSwitcher />
        </div>

        <div className="w-full rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-8 text-center">
            <div className="mb-4 flex items-center justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-teal-500">
                <Brain className="h-7 w-7 text-white" />
              </div>
            </div>
            <h2 className="text-3xl font-bold text-white">{t('login.title')}</h2>
            <p className="mt-2 text-slate-400">{t('login.subtitle')}</p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label className={`mb-2 block text-sm font-medium text-slate-300 ${textAlignClass}`}>
                {t('login.email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-slate-700 bg-slate-800 px-5 py-4 text-white placeholder-slate-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t('signup.placeholders.email')}
              />
            </div>

            <div>
              <label className={`mb-2 block text-sm font-medium text-slate-300 ${textAlignClass}`}>
                {t('login.password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-slate-700 bg-slate-800 px-5 py-4 text-white placeholder-slate-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t('signup.placeholders.password')}
              />
            </div>

            {errorMessage && (
              <div className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-4 text-rose-100">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                <p>{errorMessage}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-teal-600 py-4 text-lg font-semibold text-white transition-all hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle className="h-5 w-5 animate-spin" />
                  {t('login.messages.loading')}
                </>
              ) : (
                <>
                  {t('login.button')}
                  <ChevronRight className="h-5 w-5" />
                </>
              )}
            </button>
          </form>

          <p className={`mt-6 text-slate-400 ${textAlignClass}`}>
            {t('login.noAccount')}{' '}
            <Link to="/signup" className="font-medium text-blue-400 hover:text-blue-300 hover:underline">
              {t('login.signupHere')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
