import bcrypt from 'bcryptjs';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { query } from '../db.js';

export type AccountType =
  | 'student'
  | 'co_researcher'
  | 'supervisor'
  | 'assistant_supervisor'
  | 'clinical_evaluator'
  | 'institution';
export type EmailType = 'academic' | 'personal';
export type InstitutionType = 'university' | 'hospital' | 'research-center';
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';
export type SubscriptionPlan = {
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

export interface IUser {
  id: string;
  email: string;
  password: string;
  fullName: string;
  accountType: AccountType;
  phone?: string;
  dateOfBirth?: Date;
  country?: string;
  governorate?: string;
  emailType?: EmailType;
  university?: string;
  college?: string;
  institutionType?: InstitutionType;
  specialization?: string;
  academicLevel?: string;
  academicId?: string;
  academicRank?: string;
  supervisorId?: string;
  authorizedContactName?: string;
  jobTitle?: string;
  directContactNumber?: string;
  isVerified: boolean;
  isActive: boolean;
  trialEndsAt?: Date;
  subscription?: {
    plan: string;
    status: SubscriptionStatus;
    expiresAt?: Date;
  };
}

export type PublicUser = Omit<IUser, 'password'>;

type UserRow = {
  id: string | number;
  email: string;
  password: string;
  full_name: string;
  account_type: AccountType;
  phone: string | null;
  date_of_birth: Date | null;
  country: string | null;
  governorate: string | null;
  email_type: EmailType | null;
  university: string | null;
  college: string | null;
  institution_type: InstitutionType | null;
  specialization: string | null;
  academic_level: string | null;
  academic_id: string | null;
  academic_rank: string | null;
  supervisor_id: string | null;
  authorized_contact_name: string | null;
  job_title: string | null;
  direct_contact_number: string | null;
  is_verified: boolean;
  is_active: boolean;
  trial_ends_at: Date | null;
  subscription_plan: string | null;
  subscription_status: SubscriptionStatus | null;
  subscription_expires_at: Date | null;
};

export type CreateUserInput = Omit<IUser, 'id' | 'isVerified' | 'isActive' | 'subscription'>;

type StoredUser = Omit<IUser, 'dateOfBirth' | 'trialEndsAt' | 'subscription'> & {
  dateOfBirth?: string;
  trialEndsAt?: string;
  subscription?: {
    plan: string;
    status: SubscriptionStatus;
    expiresAt?: string;
  };
};

const localUserStorePath = path.resolve(process.cwd(), 'data', 'dev-users.json');

const localAuthFallbackEnabled = () => process.env.ENABLE_LOCAL_AUTH_FALLBACK !== 'false';

const isDatabaseUnavailable = (error: unknown) =>
  localAuthFallbackEnabled() &&
  error instanceof Error &&
  /Database has not been initialized|ECONNREFUSED|connection.*refused/i.test(error.message);

const toDate = (value: Date | string | undefined): Date | undefined => {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(value);
};

const toIsoString = (value: Date | string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const deserializeStoredUser = (user: StoredUser): IUser => ({
  ...user,
  dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth) : undefined,
  trialEndsAt: user.trialEndsAt ? new Date(user.trialEndsAt) : undefined,
  subscription: user.subscription
    ? {
        ...user.subscription,
        expiresAt: user.subscription.expiresAt ? new Date(user.subscription.expiresAt) : undefined,
      }
    : undefined,
});

const serializeUser = (user: IUser): StoredUser => ({
  ...user,
  dateOfBirth: toIsoString(user.dateOfBirth),
  trialEndsAt: toIsoString(user.trialEndsAt),
  subscription: user.subscription
    ? {
        ...user.subscription,
        expiresAt: toIsoString(user.subscription.expiresAt),
      }
    : undefined,
});

const readLocalUsers = async (): Promise<IUser[]> => {
  try {
    const raw = await readFile(localUserStorePath, 'utf8');
    const users = JSON.parse(raw) as StoredUser[];
    return users.map(deserializeStoredUser);
  } catch {
    return [];
  }
};

const writeLocalUsers = async (users: IUser[]) => {
  await mkdir(path.dirname(localUserStorePath), { recursive: true });
  await writeFile(localUserStorePath, JSON.stringify(users.map(serializeUser), null, 2), 'utf8');
};

const createLocalUserId = () => `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const defaultSubscriptionPlans: SubscriptionPlan[] = [
  {
    id: 'dev_sample_size',
    code: 'sample-size',
    name: 'Sample Size',
    description: 'Includes standalone sample size calculation tools.',
    includesSampleSize: true,
    includesStatisticalAnalysis: false,
    monthlyPrice: 19,
    yearlyPrice: 190,
    isActive: true,
  },
  {
    id: 'dev_stat_analysis',
    code: 'stat-analysis',
    name: 'Statistical Analysis',
    description: 'Includes standalone statistical analysis and reporting.',
    includesSampleSize: false,
    includesStatisticalAnalysis: true,
    monthlyPrice: 29,
    yearlyPrice: 290,
    isActive: true,
  },
  {
    id: 'dev_research_pro',
    code: 'research-pro',
    name: 'Research Pro',
    description: 'Includes both sample size and statistical analysis workflows.',
    includesSampleSize: true,
    includesStatisticalAnalysis: true,
    monthlyPrice: 39,
    yearlyPrice: 390,
    isActive: true,
  },
];

const mapUserRow = (row: UserRow): IUser => ({
  id: String(row.id),
  email: row.email,
  password: row.password,
  fullName: row.full_name,
  accountType: row.account_type,
  phone: row.phone ?? undefined,
  dateOfBirth: row.date_of_birth ?? undefined,
  country: row.country ?? undefined,
  governorate: row.governorate ?? undefined,
  emailType: row.email_type ?? undefined,
  university: row.university ?? undefined,
  college: row.college ?? undefined,
  institutionType: row.institution_type ?? undefined,
  specialization: row.specialization ?? undefined,
  academicLevel: row.academic_level ?? undefined,
  academicId: row.academic_id ?? undefined,
  academicRank: row.academic_rank ?? undefined,
  supervisorId: row.supervisor_id ?? undefined,
  authorizedContactName: row.authorized_contact_name ?? undefined,
  jobTitle: row.job_title ?? undefined,
  directContactNumber: row.direct_contact_number ?? undefined,
  isVerified: row.is_verified,
  isActive: row.is_active,
  trialEndsAt: row.trial_ends_at ?? undefined,
  subscription:
    row.subscription_plan && row.subscription_status
      ? {
          plan: row.subscription_plan,
          status: row.subscription_status,
          expiresAt: row.subscription_expires_at ?? undefined,
        }
      : undefined,
});

export const toPublicUser = (user: IUser): PublicUser => {
  const { password, ...publicUser } = user;
  return publicUser;
};

export const comparePassword = async (candidatePassword: string, hashedPassword: string) => {
  return bcrypt.compare(candidatePassword, hashedPassword);
};

export const findUserByEmail = async (email: string): Promise<IUser | null> => {
  const normalizedEmail = email.trim().toLowerCase();
  if (localAuthFallbackEnabled()) {
    const users = await readLocalUsers();
    return users.find((user) => user.email.toLowerCase() === normalizedEmail) ?? null;
  }
  try {
    const result = await query<UserRow>('SELECT * FROM users WHERE email = $1 LIMIT 1', [normalizedEmail]);
    const row = result.rows[0];
    return row ? mapUserRow(row) : null;
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const users = await readLocalUsers();
    return users.find((user) => user.email.toLowerCase() === normalizedEmail) ?? null;
  }
};

export const findUserById = async (id: string): Promise<PublicUser | null> => {
  if (localAuthFallbackEnabled()) {
    const users = await readLocalUsers();
    const user = users.find((item) => item.id === id);
    return user ? toPublicUser(user) : null;
  }
  try {
    const result = await query<UserRow>('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    const row = result.rows[0];
    return row ? toPublicUser(mapUserRow(row)) : null;
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const users = await readLocalUsers();
    const user = users.find((item) => item.id === id);
    return user ? toPublicUser(user) : null;
  }
};

export const createUser = async (input: CreateUserInput): Promise<PublicUser> => {
  const hashRounds = localAuthFallbackEnabled() ? 4 : 10;
  const hashedPassword = await bcrypt.hash(input.password, hashRounds);

  if (localAuthFallbackEnabled()) {
    const users = await readLocalUsers();
    const user: IUser = {
      id: createLocalUserId(),
      email: input.email.trim().toLowerCase(),
      password: hashedPassword,
      fullName: input.fullName.trim(),
      accountType: input.accountType,
      phone: input.phone?.trim() || undefined,
      dateOfBirth: toDate(input.dateOfBirth),
      country: input.country?.trim() || undefined,
      governorate: input.governorate?.trim() || undefined,
      emailType: input.emailType,
      university: input.university?.trim() || undefined,
      college: input.college?.trim() || undefined,
      institutionType: input.institutionType,
      specialization: input.specialization?.trim() || undefined,
      academicLevel: input.academicLevel?.trim() || undefined,
      academicId: input.academicId?.trim() || undefined,
      academicRank: input.academicRank?.trim() || undefined,
      supervisorId: input.supervisorId?.trim() || undefined,
      authorizedContactName: input.authorizedContactName?.trim() || undefined,
      jobTitle: input.jobTitle?.trim() || undefined,
      directContactNumber: input.directContactNumber?.trim() || undefined,
      isVerified: false,
      isActive: true,
      trialEndsAt: toDate(input.trialEndsAt),
    };

    users.push(user);
    await writeLocalUsers(users);
    return toPublicUser(user);
  }

  try {
    const result = await query<UserRow>(
      `
        INSERT INTO users (
          email, password, full_name, account_type, phone, date_of_birth, country, governorate,
          email_type, university, college, institution_type, specialization, academic_level,
          academic_id, academic_rank, supervisor_id, authorized_contact_name, job_title,
          direct_contact_number, is_verified, is_active, trial_ends_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19,
          $20, $21, $22, $23, NOW()
        )
        RETURNING *
      `,
      [
        input.email.trim().toLowerCase(),
        hashedPassword,
        input.fullName.trim(),
        input.accountType,
        input.phone?.trim() || null,
        input.dateOfBirth || null,
        input.country?.trim() || null,
        input.governorate?.trim() || null,
        input.emailType || null,
        input.university?.trim() || null,
        input.college?.trim() || null,
        input.institutionType || null,
        input.specialization?.trim() || null,
        input.academicLevel?.trim() || null,
        input.academicId?.trim() || null,
        input.academicRank?.trim() || null,
        input.supervisorId?.trim() || null,
        input.authorizedContactName?.trim() || null,
        input.jobTitle?.trim() || null,
        input.directContactNumber?.trim() || null,
        false,
        true,
        input.trialEndsAt || null,
      ],
    );

    return toPublicUser(mapUserRow(result.rows[0]));
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const users = await readLocalUsers();
    const user: IUser = {
      id: createLocalUserId(),
      email: input.email.trim().toLowerCase(),
      password: hashedPassword,
      fullName: input.fullName.trim(),
      accountType: input.accountType,
      phone: input.phone?.trim() || undefined,
      dateOfBirth: toDate(input.dateOfBirth),
      country: input.country?.trim() || undefined,
      governorate: input.governorate?.trim() || undefined,
      emailType: input.emailType,
      university: input.university?.trim() || undefined,
      college: input.college?.trim() || undefined,
      institutionType: input.institutionType,
      specialization: input.specialization?.trim() || undefined,
      academicLevel: input.academicLevel?.trim() || undefined,
      academicId: input.academicId?.trim() || undefined,
      academicRank: input.academicRank?.trim() || undefined,
      supervisorId: input.supervisorId?.trim() || undefined,
      authorizedContactName: input.authorizedContactName?.trim() || undefined,
      jobTitle: input.jobTitle?.trim() || undefined,
      directContactNumber: input.directContactNumber?.trim() || undefined,
      isVerified: false,
      isActive: true,
      trialEndsAt: toDate(input.trialEndsAt),
    };

    users.push(user);
    await writeLocalUsers(users);
    return toPublicUser(user);
  }
};

export const listUsersByAccountTypes = async (accountTypes: AccountType[]): Promise<PublicUser[]> => {
  if (accountTypes.length === 0) {
    return [];
  }

  try {
    const result = await query<UserRow>(
      `
        SELECT *
        FROM users
        WHERE account_type = ANY($1::text[])
        ORDER BY full_name ASC, email ASC
      `,
      [accountTypes],
    );

    return result.rows.map((row) => toPublicUser(mapUserRow(row)));
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const users = await readLocalUsers();
    return users
      .filter((user) => accountTypes.includes(user.accountType))
      .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.email.localeCompare(b.email))
      .map(toPublicUser);
  }
};

export const findUserByIdAndAccountType = async (id: string, accountType: AccountType): Promise<PublicUser | null> => {
  if (localAuthFallbackEnabled()) {
    const users = await readLocalUsers();
    const user = users.find((item) => item.id === id && item.accountType === accountType);
    return user ? toPublicUser(user) : null;
  }
  try {
    const result = await query<UserRow>(
      'SELECT * FROM users WHERE id = $1 AND account_type = $2 LIMIT 1',
      [id, accountType],
    );

    const row = result.rows[0];
    return row ? toPublicUser(mapUserRow(row)) : null;
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const users = await readLocalUsers();
    const user = users.find((item) => item.id === id && item.accountType === accountType);
    return user ? toPublicUser(user) : null;
  }
};

export const findUserByAcademicIdAndAccountType = async (
  academicId: string,
  accountType: AccountType,
): Promise<PublicUser | null> => {
  const normalizedAcademicId = academicId.trim().toLowerCase();
  if (!normalizedAcademicId) {
    return null;
  }

  if (localAuthFallbackEnabled()) {
    const users = await readLocalUsers();
    const user = users.find(
      (item) => item.academicId?.trim().toLowerCase() === normalizedAcademicId && item.accountType === accountType,
    );
    return user ? toPublicUser(user) : null;
  }

  try {
    const result = await query<UserRow>(
      `
        SELECT *
        FROM users
        WHERE LOWER(academic_id) = $1
          AND account_type = $2
        LIMIT 1
      `,
      [normalizedAcademicId, accountType],
    );

    const row = result.rows[0];
    return row ? toPublicUser(mapUserRow(row)) : null;
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const users = await readLocalUsers();
    const user = users.find(
      (item) => item.academicId?.trim().toLowerCase() === normalizedAcademicId && item.accountType === accountType,
    );
    return user ? toPublicUser(user) : null;
  }
};

export const findUserByAcademicId = async (academicId: string): Promise<PublicUser | null> => {
  const normalizedAcademicId = academicId.trim().toLowerCase();
  if (!normalizedAcademicId) {
    return null;
  }

  if (localAuthFallbackEnabled()) {
    const users = await readLocalUsers();
    const user = users.find((item) => item.academicId?.trim().toLowerCase() === normalizedAcademicId);
    return user ? toPublicUser(user) : null;
  }

  try {
    const result = await query<UserRow>(
      `
        SELECT *
        FROM users
        WHERE LOWER(academic_id) = $1
        LIMIT 1
      `,
      [normalizedAcademicId],
    );

    const row = result.rows[0];
    return row ? toPublicUser(mapUserRow(row)) : null;
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const users = await readLocalUsers();
    const user = users.find((item) => item.academicId?.trim().toLowerCase() === normalizedAcademicId);
    return user ? toPublicUser(user) : null;
  }
};

export type OutcomeAssessorDirectoryEntry = PublicUser & {
  studiesEvaluated: number;
  completedAssessments: number;
  averageCompletionHours: number | null;
  availabilityStatus: 'available' | 'busy' | 'unavailable';
};

export const listOutcomeAssessors = async (filters?: {
  search?: string;
  specialization?: string;
  university?: string;
}): Promise<OutcomeAssessorDirectoryEntry[]> => {
  const searchValue = filters?.search?.trim().toLowerCase() ?? '';
  const specializationValue = filters?.specialization?.trim().toLowerCase() ?? '';
  const universityValue = filters?.university?.trim().toLowerCase() ?? '';

  try {
    const result = await query<
      UserRow & {
        studies_evaluated: string | number;
        completed_assessments: string | number;
        average_completion_hours: string | number | null;
        availability_status: 'available' | 'busy' | 'unavailable';
      }
    >(
      `
        SELECT
          users.*,
          COUNT(DISTINCT requests.study_id)::BIGINT AS studies_evaluated,
          COUNT(entries.id) FILTER (WHERE entries.status IN ('submitted', 'locked'))::BIGINT AS completed_assessments,
          AVG(
            EXTRACT(EPOCH FROM (COALESCE(entries.submitted_at, requests.completed_at) - requests.accepted_at)) / 3600
          ) FILTER (
            WHERE requests.accepted_at IS NOT NULL
              AND (entries.submitted_at IS NOT NULL OR requests.completed_at IS NOT NULL)
          ) AS average_completion_hours,
          CASE
            WHEN COUNT(requests.id) FILTER (WHERE requests.request_status IN ('active', 'accepted', 'new')) >= 4 THEN 'busy'
            WHEN users.is_active = FALSE THEN 'unavailable'
            ELSE 'available'
          END AS availability_status
        FROM users
        LEFT JOIN study_outcome_assessment_requests AS requests
          ON requests.assessor_user_id = users.id
        LEFT JOIN study_outcome_assessment_entries AS entries
          ON entries.request_id = requests.id
          AND entries.assessor_user_id = users.id
        WHERE users.account_type = 'clinical_evaluator'
          AND (
            $1 = ''
            OR LOWER(users.full_name) LIKE '%' || $1 || '%'
            OR LOWER(COALESCE(users.academic_id, '')) LIKE '%' || $1 || '%'
            OR LOWER(COALESCE(users.specialization, '')) LIKE '%' || $1 || '%'
            OR LOWER(COALESCE(users.university, '')) LIKE '%' || $1 || '%'
          )
          AND ($2 = '' OR LOWER(COALESCE(users.specialization, '')) = $2)
          AND ($3 = '' OR LOWER(COALESCE(users.university, '')) = $3)
        GROUP BY users.id
        ORDER BY users.full_name ASC, users.email ASC
      `,
      [searchValue, specializationValue, universityValue],
    );

    return result.rows.map((row) => ({
      ...toPublicUser(mapUserRow(row)),
      studiesEvaluated: Number(row.studies_evaluated),
      completedAssessments: Number(row.completed_assessments),
      averageCompletionHours:
        row.average_completion_hours === null ? null : Number(Number(row.average_completion_hours).toFixed(2)),
      availabilityStatus: row.availability_status,
    }));
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const users = await readLocalUsers();
    return users
      .filter((user) => {
        if (user.accountType !== 'clinical_evaluator') {
          return false;
        }
        const haystack = [user.fullName, user.academicId, user.specialization, user.university]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return (
          (!searchValue || haystack.includes(searchValue)) &&
          (!specializationValue || user.specialization?.toLowerCase() === specializationValue) &&
          (!universityValue || user.university?.toLowerCase() === universityValue)
        );
      })
      .map((user) => ({
        ...toPublicUser(user),
        studiesEvaluated: 0,
        completedAssessments: 0,
        averageCompletionHours: null,
        availabilityStatus: user.isActive ? 'available' : 'unavailable',
      }));
  }
};

export type InstitutionUserOverview = {
  totalStudents: number;
  totalSupervisors: number;
  totalAssistantSupervisors: number;
  totalClinicalEvaluators: number;
  totalResearchers: number;
  specializationBreakdown: Array<{
    specialization: string;
    totalUsers: number;
  }>;
};

export const getInstitutionUserOverview = async (): Promise<InstitutionUserOverview> => {
  try {
    const countResult = await query<{
      account_type: AccountType;
      total_users: string | number;
    }>(
      `
        SELECT account_type, COUNT(*)::BIGINT AS total_users
        FROM users
        GROUP BY account_type
      `,
    );

    const specializationResult = await query<{
      specialization: string | null;
      total_users: string | number;
    }>(
      `
        SELECT specialization, COUNT(*)::BIGINT AS total_users
        FROM users
        WHERE specialization IS NOT NULL AND TRIM(specialization) <> ''
        GROUP BY specialization
        ORDER BY COUNT(*) DESC, specialization ASC
        LIMIT 5
      `,
    );

    const counts = new Map<AccountType, number>(
      countResult.rows.map((row) => [row.account_type, Number(row.total_users)]),
    );

    return {
      totalStudents: counts.get('student') ?? 0,
      totalSupervisors: counts.get('supervisor') ?? 0,
      totalAssistantSupervisors: counts.get('assistant_supervisor') ?? 0,
      totalClinicalEvaluators: counts.get('clinical_evaluator') ?? 0,
      totalResearchers: (counts.get('student') ?? 0) + (counts.get('co_researcher') ?? 0),
      specializationBreakdown: specializationResult.rows.map((row) => ({
        specialization: row.specialization ?? 'Unspecified',
        totalUsers: Number(row.total_users),
      })),
    };
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const users = await readLocalUsers();
    const counts = new Map<AccountType, number>();
    const specializationCounts = new Map<string, number>();
    for (const user of users) {
      counts.set(user.accountType, (counts.get(user.accountType) ?? 0) + 1);
      if (user.specialization) {
        specializationCounts.set(user.specialization, (specializationCounts.get(user.specialization) ?? 0) + 1);
      }
    }
    return {
      totalStudents: counts.get('student') ?? 0,
      totalSupervisors: counts.get('supervisor') ?? 0,
      totalAssistantSupervisors: counts.get('assistant_supervisor') ?? 0,
      totalClinicalEvaluators: counts.get('clinical_evaluator') ?? 0,
      totalResearchers: (counts.get('student') ?? 0) + (counts.get('co_researcher') ?? 0),
      specializationBreakdown: [...specializationCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([specialization, totalUsers]) => ({ specialization, totalUsers })),
    };
  }
};

export const listSubscriptionPlans = async (): Promise<SubscriptionPlan[]> => {
  try {
    const result = await query<{
      id: string | number;
      code: string;
      name: string;
      description: string | null;
      includes_sample_size: boolean;
      includes_statistical_analysis: boolean;
      monthly_price: string | number;
      yearly_price: string | number;
      is_active: boolean;
    }>(
      `
        SELECT
          id,
          code,
          name,
          description,
          includes_sample_size,
          includes_statistical_analysis,
          monthly_price,
          yearly_price,
          is_active
        FROM subscription_plans
        WHERE is_active = TRUE
        ORDER BY monthly_price ASC, name ASC
      `,
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      code: row.code,
      name: row.name,
      description: row.description ?? undefined,
      includesSampleSize: row.includes_sample_size,
      includesStatisticalAnalysis: row.includes_statistical_analysis,
      monthlyPrice: Number(row.monthly_price),
      yearlyPrice: Number(row.yearly_price),
      isActive: row.is_active,
    }));
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    return defaultSubscriptionPlans;
  }
};

export const findSubscriptionPlanByCode = async (code: string): Promise<SubscriptionPlan | null> => {
  const normalizedCode = code.trim().toLowerCase();
  if (!normalizedCode) {
    return null;
  }

  try {
    const result = await query<{
      id: string | number;
      code: string;
      name: string;
      description: string | null;
      includes_sample_size: boolean;
      includes_statistical_analysis: boolean;
      monthly_price: string | number;
      yearly_price: string | number;
      is_active: boolean;
    }>(
      `
        SELECT
          id,
          code,
          name,
          description,
          includes_sample_size,
          includes_statistical_analysis,
          monthly_price,
          yearly_price,
          is_active
        FROM subscription_plans
        WHERE LOWER(code) = $1
          AND is_active = TRUE
        LIMIT 1
      `,
      [normalizedCode],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: String(row.id),
      code: row.code,
      name: row.name,
      description: row.description ?? undefined,
      includesSampleSize: row.includes_sample_size,
      includesStatisticalAnalysis: row.includes_statistical_analysis,
      monthlyPrice: Number(row.monthly_price),
      yearlyPrice: Number(row.yearly_price),
      isActive: row.is_active,
    };
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    return defaultSubscriptionPlans.find((plan) => plan.code.toLowerCase() === normalizedCode) ?? null;
  }
};

export const updateUserSubscription = async (
  userId: string,
  input: {
    planCode: string;
    billingCycle: 'monthly' | 'yearly';
  },
): Promise<PublicUser | null> => {
  const plan = await findSubscriptionPlanByCode(input.planCode);
  if (!plan) {
    return null;
  }

  const expiryDate = new Date();
  if (input.billingCycle === 'yearly') {
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
  } else {
    expiryDate.setMonth(expiryDate.getMonth() + 1);
  }

  try {
    const result = await query<UserRow>(
      `
        UPDATE users
        SET
          subscription_plan = $2,
          subscription_status = 'active',
          subscription_expires_at = $3,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [userId, plan.code, expiryDate],
    );

    const row = result.rows[0];
    return row ? toPublicUser(mapUserRow(row)) : null;
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    const users = await readLocalUsers();
    const userIndex = users.findIndex((user) => user.id === userId);
    if (userIndex === -1) {
      return null;
    }

    users[userIndex] = {
      ...users[userIndex],
      subscription: {
        plan: plan.code,
        status: 'active',
        expiresAt: expiryDate,
      },
    };
    await writeLocalUsers(users);
    return toPublicUser(users[userIndex]);
  }
};
