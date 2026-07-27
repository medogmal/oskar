export type AccountType =
  | 'student'
  | 'co_researcher'
  | 'supervisor'
  | 'assistant_supervisor'
  | 'clinical_evaluator'
  | 'institution';

export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';

export type AuthUser = {
  id?: string;
  _id?: string;
  token: string;
  email: string;
  fullName: string;
  accountType: AccountType;
  phone?: string;
  dateOfBirth?: string;
  country?: string;
  governorate?: string;
  emailType?: 'academic' | 'personal';
  university?: string;
  college?: string;
  institutionType?: 'university' | 'hospital' | 'research-center';
  specialization?: string;
  academicLevel?: string;
  academicId?: string;
  academicRank?: string;
  supervisorId?: string;
  authorizedContactName?: string;
  jobTitle?: string;
  directContactNumber?: string;
  trialEndsAt?: string;
  subscription?: {
    plan: string;
    status: SubscriptionStatus;
    expiresAt?: string;
  };
};

const authStorageKey = 'clinresearch.auth';

const accountTypes = new Set<AccountType>([
  'student',
  'co_researcher',
  'supervisor',
  'assistant_supervisor',
  'clinical_evaluator',
  'institution',
]);

const dashboardPaths: Record<AccountType, string> = {
  student: '/student-dashboard',
  co_researcher: '/co-researcher-dashboard',
  supervisor: '/supervisor-dashboard',
  assistant_supervisor: '/assistant-supervisor-dashboard',
  clinical_evaluator: '/clinical-evaluator-dashboard',
  institution: '/institution-dashboard',
};

const defaultApiBaseUrl = 'http://localhost:5000/api';

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || defaultApiBaseUrl).replace(/\/$/, '');

const isBrowser = () => typeof window !== 'undefined' && Boolean(window.localStorage);

const isAccountType = (value: unknown): value is AccountType =>
  typeof value === 'string' && accountTypes.has(value as AccountType);

export const getDashboardPath = (accountType: AccountType) => dashboardPaths[accountType] ?? dashboardPaths.student;

export const getStoredAuth = (): AuthUser | null => {
  if (!isBrowser()) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(authStorageKey);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<AuthUser>;
    if (!parsed.token || !isAccountType(parsed.accountType)) {
      return null;
    }

    return {
      ...parsed,
      token: String(parsed.token),
      email: parsed.email ?? '',
      fullName: parsed.fullName ?? '',
      accountType: parsed.accountType,
    };
  } catch {
    return null;
  }
};

export const setStoredAuth = (user: AuthUser) => {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(authStorageKey, JSON.stringify(user));
};

export const clearStoredAuth = () => {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.removeItem(authStorageKey);
};
