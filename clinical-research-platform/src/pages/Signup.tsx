import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Brain, CheckCircle2, ChevronRight, LoaderCircle } from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { apiBaseUrl, getDashboardPath } from '../lib/auth';
import type { AccountType } from '../lib/auth';
import { useAuth } from '../context/useAuth';

type FormState = {
  accountType: AccountType;
  fullName: string;
  email: string;
  password: string;
  phone: string;
  dateOfBirth: string;
  country: string;
  governorate: string;
  emailType: 'academic' | 'personal';
  university: string;
  college: string;
  specialization: string;
  academicLevel: string;
  academicId: string;
  supervisorId: string;
  academicRank: string;
  institutionType: 'university' | 'hospital' | 'research-center' | '';
  authorizedContactName: string;
  jobTitle: string;
  directContactNumber: string;
};

type SupervisorDirectoryEntry = {
  id: string;
  fullName: string;
  email: string;
  academicRank?: string;
  specialization?: string;
};

const COUNTRY_OPTIONS = [
  'egypt',
  'saudiArabia',
  'unitedArabEmirates',
  'jordan',
  'iraq',
  'kuwait',
  'oman',
  'qatar',
  'bahrain',
  'palestine',
  'lebanon',
  'sudan',
  'unitedKingdom',
  'unitedStates',
] as const;

const SPECIALIZATION_OPTIONS = [
  'orthodontics',
  'oralAndMaxillofacialSurgery',
  'endodontics',
  'pediatricDentistry',
  'prosthodontics',
  'periodontology',
  'dentalPublicHealth',
  'oralAndMaxillofacialPathology',
  'oralAndMaxillofacialRadiology',
  'oralMedicine',
] as const;

const ACADEMIC_LEVEL_OPTIONS = [
  'intern',
  'resident',
  'diploma',
  'masters',
  'doctorate',
] as const;

const ACADEMIC_RANK_OPTIONS = [
  'lecturer',
  'assistantProfessor',
  'associateProfessor',
  'professor',
] as const;

const RESEARCH_ACCOUNT_TYPES: AccountType[] = ['student', 'co_researcher'];
const SUPERVISION_ACCOUNT_TYPES: AccountType[] = ['supervisor', 'assistant_supervisor', 'clinical_evaluator'];

const baseInputClassName =
  'w-full px-5 py-4 bg-slate-800 border border-slate-700 rounded-2xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

const initialFormState: FormState = {
  accountType: 'student',
  fullName: '',
  email: '',
  password: '',
  phone: '',
  dateOfBirth: '',
  country: '',
  governorate: '',
  emailType: 'academic',
  university: '',
  college: '',
  specialization: '',
  academicLevel: '',
  academicId: '',
  supervisorId: '',
  academicRank: '',
  institutionType: '',
  authorizedContactName: '',
  jobTitle: '',
  directContactNumber: '',
};

function Signup() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { signIn } = useAuth();
  const [formState, setFormState] = useState<FormState>(initialFormState);
  const [linkageMode, setLinkageMode] = useState<'independent' | 'supervisor'>('independent');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [supervisorDirectory, setSupervisorDirectory] = useState<SupervisorDirectoryEntry[]>([]);

  const isArabic = i18n.resolvedLanguage === 'ar';
  const textAlignClass = isArabic ? 'text-right' : 'text-left';

  const specializationOptions = useMemo(
    () =>
      SPECIALIZATION_OPTIONS.map((value) => ({
        value,
        label: t(`signup.options.specializations.${value}`),
      })),
    [t],
  );

  const academicLevelOptions = useMemo(
    () =>
      ACADEMIC_LEVEL_OPTIONS.map((value) => ({
        value,
        label: t(`signup.options.academicLevels.${value}`),
      })),
    [t],
  );

  const academicRankOptions = useMemo(
    () =>
      ACADEMIC_RANK_OPTIONS.map((value) => ({
        value,
        label: t(`signup.options.academicRanks.${value}`),
      })),
    [t],
  );

  useEffect(() => {
    let ignore = false;

    const loadSupervisors = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/auth/public-directory?accountTypes=supervisor`);
        if (!response.ok) {
          throw new Error('Unable to load supervisors');
        }

        const data = (await response.json()) as SupervisorDirectoryEntry[];
        if (!ignore) {
          setSupervisorDirectory(data);
        }
      } catch {
        if (!ignore) {
          setSupervisorDirectory([]);
        }
      }
    };

    void loadSupervisors();

    return () => {
      ignore = true;
    };
  }, []);

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;

    setFormState((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleAccountTypeChange = (accountType: AccountType) => {
    setErrorMessage('');
    setSuccessMessage('');
    setLinkageMode('independent');
    setFormState((current) => ({
      ...current,
      accountType,
      supervisorId: '',
      academicLevel: RESEARCH_ACCOUNT_TYPES.includes(accountType) ? current.academicLevel : '',
      academicRank: SUPERVISION_ACCOUNT_TYPES.includes(accountType) ? current.academicRank : '',
      institutionType: accountType === 'institution' ? current.institutionType : '',
      authorizedContactName: accountType === 'institution' ? current.authorizedContactName : '',
      jobTitle: accountType === 'institution' ? current.jobTitle : '',
      directContactNumber: accountType === 'institution' ? current.directContactNumber : '',
    }));
  };

  const handleLinkageModeChange = (value: 'independent' | 'supervisor') => {
    setLinkageMode(value);
    if (value === 'independent') {
      setFormState((current) => ({
        ...current,
        supervisorId: '',
      }));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (RESEARCH_ACCOUNT_TYPES.includes(formState.accountType) && linkageMode === 'supervisor' && !formState.supervisorId.trim()) {
      setErrorMessage(t('signup.messages.supervisorIdRequired'));
      return;
    }

    setIsSubmitting(true);

    const payload = {
      ...formState,
      supervisorId: linkageMode === 'supervisor' ? formState.supervisorId.trim() : '',
      ...(formState.accountType === 'institution' ? { dateOfBirth: undefined } : {}),
    };

    try {
      const response = await fetch(`${apiBaseUrl}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
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
        errors?: Array<{ field?: string; message?: string }>;
      };

      if (!response.ok) {
        const validationMessage = data.errors?.map((item) => item.message).filter(Boolean).join(' ');
        throw new Error(validationMessage || data.message || t('signup.messages.genericError'));
      }

      signIn({
        token: data.token,
        accountType: data.accountType ?? formState.accountType,
        fullName: data.fullName ?? formState.fullName,
        email: data.email ?? formState.email,
        trialEndsAt: data.trialEndsAt,
        subscription: data.subscription,
      });

      setSuccessMessage(t('signup.messages.success'));
      navigate(getDashboardPath(formState.accountType));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('signup.messages.genericError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      dir={isArabic ? 'rtl' : 'ltr'}
      className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 py-12 px-4 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-4xl">
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

        <div className="w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 lg:p-10">
          <div className={`mb-8 ${textAlignClass}`}>
            <div className="mb-4 flex items-center justify-center gap-2">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-teal-500 rounded-xl flex items-center justify-center">
                <Brain className="w-7 h-7 text-white" />
              </div>
            </div>
            <h2 className="text-center text-3xl font-bold bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent mb-2">
              {t('signup.title')}
            </h2>
            <p className="text-center text-slate-400">{t('signup.subtitle')}</p>
          </div>

          <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                'student',
                'co_researcher',
                'supervisor',
                'assistant_supervisor',
                'clinical_evaluator',
                'institution',
              ] as AccountType[]
            ).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleAccountTypeChange(type)}
                className={`rounded-2xl px-4 py-4 font-semibold transition-all ${
                  formState.accountType === type
                    ? 'bg-gradient-to-r from-blue-600 to-teal-600 text-white shadow-lg'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                {t(`signup.accountType.${type}`)}
              </button>
            ))}
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                  {t('signup.common.phone')}
                </label>
                <input
                  name="phone"
                  type="tel"
                  value={formState.phone}
                  onChange={handleChange}
                  className={baseInputClassName}
                  placeholder={t('signup.placeholders.phone')}
                />
              </div>

              {formState.accountType !== 'institution' && (
                <div>
                  <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                    {t('signup.common.dateOfBirth')}
                  </label>
                  <input
                    name="dateOfBirth"
                    type="date"
                    value={formState.dateOfBirth}
                    onChange={handleChange}
                    className={baseInputClassName}
                  />
                </div>
              )}

              <div>
                <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                  {t('signup.common.country')}
                </label>
                <select
                  name="country"
                  value={formState.country}
                  onChange={handleChange}
                  className={baseInputClassName}
                >
                  <option value="">{t('countries.select')}</option>
                  {COUNTRY_OPTIONS.map((countryKey) => (
                    <option key={countryKey} value={t(`countries.${countryKey}`)}>
                      {t(`countries.${countryKey}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                  {t('signup.common.governorate')}
                </label>
                <input
                  name="governorate"
                  type="text"
                  value={formState.governorate}
                  onChange={handleChange}
                  className={baseInputClassName}
                  placeholder={t('signup.placeholders.governorate')}
                />
              </div>

              <div>
                <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                  {t('signup.common.password')}
                </label>
                <input
                  name="password"
                  type="password"
                  value={formState.password}
                  onChange={handleChange}
                  className={baseInputClassName}
                  placeholder={t('signup.placeholders.password')}
                />
              </div>
            </div>

            {RESEARCH_ACCOUNT_TYPES.includes(formState.accountType) && (
              <div className="space-y-6">
                <div>
                  <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                    {t(`signup.${formState.accountType}.fullName`)}
                  </label>
                  <input
                    name="fullName"
                    type="text"
                    value={formState.fullName}
                    onChange={handleChange}
                    className={baseInputClassName}
                    placeholder={
                      formState.accountType === 'co_researcher'
                        ? t('signup.placeholders.coResearcherName')
                        : t('signup.placeholders.studentName')
                    }
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t('signup.student.emailType')}
                    </label>
                    <select
                      name="emailType"
                      value={formState.emailType}
                      onChange={handleChange}
                      className={baseInputClassName}
                    >
                      <option value="academic">{t('signup.student.academicEmail')}</option>
                      <option value="personal">{t('signup.student.personalEmail')}</option>
                    </select>
                  </div>

                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t(`signup.${formState.accountType}.email`)}
                    </label>
                    <input
                      name="email"
                      type="email"
                      value={formState.email}
                      onChange={handleChange}
                      className={baseInputClassName}
                      placeholder={t('signup.placeholders.email')}
                    />
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t('signup.common.university')}
                    </label>
                    <input
                      name="university"
                      type="text"
                      value={formState.university}
                      onChange={handleChange}
                      className={baseInputClassName}
                      placeholder={t('signup.placeholders.university')}
                    />
                  </div>

                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t('signup.common.college')}
                    </label>
                    <input
                      name="college"
                      type="text"
                      value={formState.college}
                      onChange={handleChange}
                      className={baseInputClassName}
                      placeholder={t('signup.placeholders.college')}
                    />
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t(`signup.${formState.accountType}.academicLevel`)}
                    </label>
                    <select
                      name="academicLevel"
                      value={formState.academicLevel}
                      onChange={handleChange}
                      className={baseInputClassName}
                    >
                      <option value="">{t('signup.placeholders.selectOption')}</option>
                      {academicLevelOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t(`signup.${formState.accountType}.specialization`)}
                    </label>
                    <select
                      name="specialization"
                      value={formState.specialization}
                      onChange={handleChange}
                      className={baseInputClassName}
                    >
                      <option value="">{t('signup.placeholders.selectOption')}</option>
                      {specializationOptions.map((option) => (
                        <option key={option.value} value={option.label}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                    {t(`signup.${formState.accountType}.academicId`)}
                  </label>
                  <input
                    name="academicId"
                    type="text"
                    value={formState.academicId}
                    onChange={handleChange}
                    className={baseInputClassName}
                    placeholder={t('signup.placeholders.academicId')}
                  />
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950/40 p-5">
                  <label className={`block text-sm font-medium text-slate-300 mb-4 ${textAlignClass}`}>
                    {t(`signup.${formState.accountType}.supervisorLinkage`)}
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4 text-slate-300">
                      <input
                        type="radio"
                        name="linkage"
                        value="independent"
                        checked={linkageMode === 'independent'}
                        onChange={() => handleLinkageModeChange('independent')}
                        className="h-4 w-4 text-blue-600"
                      />
                      <span>{t(`signup.${formState.accountType}.independent`)}</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4 text-slate-300">
                      <input
                        type="radio"
                        name="linkage"
                        value="supervisor"
                        checked={linkageMode === 'supervisor'}
                        onChange={() => handleLinkageModeChange('supervisor')}
                        className="h-4 w-4 text-blue-600"
                      />
                      <span>{t(`signup.${formState.accountType}.supervisorId`)}</span>
                    </label>
                  </div>

                  {linkageMode === 'supervisor' && (
                    <div className="mt-4">
                      <select
                        name="supervisorId"
                        value={formState.supervisorId}
                        onChange={handleChange}
                        className={baseInputClassName}
                      >
                        <option value="">{t('signup.placeholders.selectOption')}</option>
                        {supervisorDirectory.map((supervisor) => (
                          <option key={supervisor.id} value={supervisor.id}>
                            {supervisor.fullName}
                            {supervisor.academicRank ? ` - ${supervisor.academicRank}` : ''}
                            {supervisor.specialization ? ` - ${supervisor.specialization}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}

            {SUPERVISION_ACCOUNT_TYPES.includes(formState.accountType) && (
              <div className="space-y-6">
                <div>
                  <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                    {t(`signup.${formState.accountType}.fullName`)}
                  </label>
                  <input
                    name="fullName"
                    type="text"
                    value={formState.fullName}
                    onChange={handleChange}
                    className={baseInputClassName}
                    placeholder={
                      formState.accountType === 'assistant_supervisor'
                        ? t('signup.placeholders.assistantSupervisorName')
                        : formState.accountType === 'clinical_evaluator'
                          ? t('signup.placeholders.clinicalEvaluatorName')
                          : t('signup.placeholders.supervisorName')
                    }
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t(`signup.${formState.accountType}.emailType`)}
                    </label>
                    <select
                      name="emailType"
                      value={formState.emailType}
                      onChange={handleChange}
                      className={baseInputClassName}
                    >
                      <option value="academic">{t('signup.student.academicEmail')}</option>
                      <option value="personal">{t('signup.student.personalEmail')}</option>
                    </select>
                  </div>

                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t(`signup.${formState.accountType}.email`)}
                    </label>
                    <input
                      name="email"
                      type="email"
                      value={formState.email}
                      onChange={handleChange}
                      className={baseInputClassName}
                      placeholder={t('signup.placeholders.email')}
                    />
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t('signup.common.university')}
                    </label>
                    <input
                      name="university"
                      type="text"
                      value={formState.university}
                      onChange={handleChange}
                      className={baseInputClassName}
                      placeholder={t('signup.placeholders.university')}
                    />
                  </div>

                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t('signup.common.college')}
                    </label>
                    <input
                      name="college"
                      type="text"
                      value={formState.college}
                      onChange={handleChange}
                      className={baseInputClassName}
                      placeholder={t('signup.placeholders.college')}
                    />
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t(`signup.${formState.accountType}.academicRank`)}
                    </label>
                    <select
                      name="academicRank"
                      value={formState.academicRank}
                      onChange={handleChange}
                      className={baseInputClassName}
                    >
                      <option value="">{t('signup.placeholders.selectOption')}</option>
                      {academicRankOptions.map((option) => (
                        <option key={option.value} value={option.label}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t(`signup.${formState.accountType}.specialization`)}
                    </label>
                    <select
                      name="specialization"
                      value={formState.specialization}
                      onChange={handleChange}
                      className={baseInputClassName}
                    >
                      <option value="">{t('signup.placeholders.selectOption')}</option>
                      {specializationOptions.map((option) => (
                        <option key={option.value} value={option.label}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {formState.accountType === 'institution' && (
              <div className="space-y-6">
                <div>
                  <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                    {t('signup.institution.officialName')}
                  </label>
                  <input
                    name="fullName"
                    type="text"
                    value={formState.fullName}
                    onChange={handleChange}
                    className={baseInputClassName}
                    placeholder={t('signup.placeholders.institutionName')}
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t('signup.institution.type')}
                    </label>
                    <select
                      name="institutionType"
                      value={formState.institutionType}
                      onChange={handleChange}
                      className={baseInputClassName}
                    >
                      <option value="">{t('signup.placeholders.selectOption')}</option>
                      <option value="university">{t('signup.institution.university')}</option>
                      <option value="hospital">{t('signup.institution.hospital')}</option>
                      <option value="research-center">{t('signup.institution.researchCenter')}</option>
                    </select>
                  </div>

                  <div>
                    <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                      {t('signup.institution.officialEmail')}
                    </label>
                    <input
                      name="email"
                      type="email"
                      value={formState.email}
                      onChange={handleChange}
                      className={baseInputClassName}
                      placeholder={t('signup.placeholders.officialEmail')}
                    />
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950/40 p-5">
                  <h3 className={`text-xl font-semibold text-white mb-6 ${textAlignClass}`}>
                    {t('signup.institution.authorizedInfo')}
                  </h3>
                  <div className="space-y-6">
                    <div>
                      <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                        {t('signup.institution.authFullName')}
                      </label>
                      <input
                        name="authorizedContactName"
                        type="text"
                        value={formState.authorizedContactName}
                        onChange={handleChange}
                        className={baseInputClassName}
                        placeholder={t('signup.placeholders.authorizedName')}
                      />
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                      <div>
                        <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                          {t('signup.institution.jobTitle')}
                        </label>
                        <input
                          name="jobTitle"
                          type="text"
                          value={formState.jobTitle}
                          onChange={handleChange}
                          className={baseInputClassName}
                          placeholder={t('signup.placeholders.jobTitle')}
                        />
                      </div>

                      <div>
                        <label className={`block text-sm font-medium text-slate-300 mb-2 ${textAlignClass}`}>
                          {t('signup.institution.directContact')}
                        </label>
                        <input
                          name="directContactNumber"
                          type="tel"
                          value={formState.directContactNumber}
                          onChange={handleChange}
                          className={baseInputClassName}
                          placeholder={t('signup.placeholders.phone')}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {(errorMessage || successMessage) && (
              <div
                className={`flex items-start gap-3 rounded-2xl border px-4 py-4 ${
                  errorMessage
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                }`}
              >
                {errorMessage ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />}
                <p>{errorMessage || successMessage}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 disabled:opacity-70 disabled:cursor-not-allowed text-white py-5 rounded-2xl font-bold text-lg transition-all hover:shadow-xl hover:shadow-blue-500/30 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle className="h-5 w-5 animate-spin" />
                  {t('signup.actions.creating')}
                </>
              ) : (
                <>
                  {t('signup.button')}
                  <ChevronRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          <p className={`mt-8 text-slate-400 ${textAlignClass}`}>
            {t('signup.alreadyHaveAccount')}{' '}
            <Link to="/login" className="text-blue-400 hover:text-blue-300 font-semibold hover:underline">
              {t('signup.loginHere')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Signup;
