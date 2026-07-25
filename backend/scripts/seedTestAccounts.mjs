import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const appDatabase = process.env.PGDATABASE || 'clinical_research';
const adminDatabase = process.env.PG_ADMIN_DATABASE || 'postgres';

const getConnectionConfig = (database) => ({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || undefined,
  database,
});

const createUsersTableQuery = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (
      account_type IN (
        'student',
        'co_researcher',
        'supervisor',
        'assistant_supervisor',
        'clinical_evaluator',
        'institution'
      )
    ),
    phone TEXT,
    date_of_birth DATE,
    country TEXT,
    governorate TEXT,
    email_type TEXT CHECK (email_type IN ('academic', 'personal')),
    university TEXT,
    college TEXT,
    institution_type TEXT CHECK (institution_type IN ('university', 'hospital', 'research-center')),
    specialization TEXT,
    academic_level TEXT,
    academic_id TEXT,
    academic_rank TEXT,
    supervisor_id TEXT,
    authorized_contact_name TEXT,
    job_title TEXT,
    direct_contact_number TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    trial_ends_at TIMESTAMPTZ,
    subscription_plan TEXT,
    subscription_status TEXT CHECK (subscription_status IN ('active', 'expired', 'cancelled')),
    subscription_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const createStudiesTableQuery = `
  CREATE TABLE IF NOT EXISTS studies (
    id BIGSERIAL PRIMARY KEY,
    principal_investigator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    study_type TEXT NOT NULL,
    workflow_type TEXT NOT NULL CHECK (workflow_type IN ('supervised', 'migration')),
    status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'active', 'completed', 'cancelled')),
    target_sample_size INTEGER NOT NULL DEFAULT 0,
    enrolled_patients INTEGER NOT NULL DEFAULT 0,
    has_randomization BOOLEAN NOT NULL DEFAULT FALSE,
    has_blinding BOOLEAN NOT NULL DEFAULT FALSE,
    protocol_file_name TEXT,
    ethics_approval_number TEXT,
    clinical_registration_number TEXT,
    co_researcher_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    supervisor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    assistant_supervisor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    assigned_clinical_evaluator_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    review_decision TEXT CHECK (review_decision IN ('approved', 'changes_requested', 'rejected')),
    review_notes TEXT,
    reviewed_at TIMESTAMPTZ,
    reviewed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    requires_clinical_evaluation BOOLEAN NOT NULL DEFAULT FALSE,
    clinical_evaluation_decision TEXT CHECK (clinical_evaluation_decision IN ('pending', 'accepted', 'needs_revision', 'not_recommended')),
    clinical_evaluation_notes TEXT,
    clinical_evaluated_at TIMESTAMPTZ,
    clinical_evaluated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (principal_investigator_id, title),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const plainPassword = 'Test@12345';
const hashedPassword = await bcrypt.hash(plainPassword, 10);

const testAccounts = [
  {
    email: 'student.test@clinresearch.local',
    password: hashedPassword,
    fullName: 'Test Student',
    accountType: 'student',
    phone: '+201001112223',
    dateOfBirth: new Date('1998-04-12'),
    country: 'Egypt',
    governorate: 'Cairo',
    emailType: 'academic',
    university: 'Cairo University',
    college: 'Faculty of Dentistry',
    specialization: 'Orthodontics and Dentofacial Orthopedics',
    academicLevel: "Master's",
    academicId: 'STD-1001',
    supervisorId: 'SUP-2001',
    isVerified: true,
    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
  {
    email: 'co.researcher.test@clinresearch.local',
    password: hashedPassword,
    fullName: 'Test Co Researcher',
    accountType: 'co_researcher',
    phone: '+201001112227',
    dateOfBirth: new Date('1999-06-10'),
    country: 'Egypt',
    governorate: 'Cairo',
    emailType: 'academic',
    university: 'Cairo University',
    college: 'Faculty of Dentistry',
    specialization: 'Prosthodontics',
    academicLevel: "Master's",
    academicId: 'COR-3001',
    supervisorId: 'SUP-2001',
    isVerified: true,
    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
  {
    email: 'supervisor.test@clinresearch.local',
    password: hashedPassword,
    fullName: 'Test Supervisor',
    accountType: 'supervisor',
    phone: '+201001112224',
    dateOfBirth: new Date('1980-09-03'),
    country: 'Egypt',
    governorate: 'Giza',
    emailType: 'academic',
    university: 'Ain Shams University',
    college: 'Faculty of Dentistry',
    specialization: 'Oral and Maxillofacial Surgery',
    academicId: 'SUP-2001',
    academicRank: 'Associate Professor',
    isVerified: true,
    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
  {
    email: 'assistant.supervisor.test@clinresearch.local',
    password: hashedPassword,
    fullName: 'Test Assistant Supervisor',
    accountType: 'assistant_supervisor',
    phone: '+201001112228',
    dateOfBirth: new Date('1985-11-21'),
    country: 'Egypt',
    governorate: 'Giza',
    emailType: 'academic',
    university: 'Ain Shams University',
    college: 'Faculty of Dentistry',
    specialization: 'Periodontology',
    academicId: 'ASUP-2002',
    academicRank: 'Assistant Professor',
    isVerified: true,
    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
  {
    email: 'clinical.evaluator.test@clinresearch.local',
    password: hashedPassword,
    fullName: 'Test Clinical Evaluator',
    accountType: 'clinical_evaluator',
    phone: '+201001112229',
    dateOfBirth: new Date('1983-02-15'),
    country: 'Egypt',
    governorate: 'Alexandria',
    emailType: 'academic',
    university: 'Alexandria University',
    college: 'Faculty of Dentistry',
    specialization: 'Oral Medicine',
    academicId: 'EVAL-4001',
    academicRank: 'Associate Professor',
    isVerified: true,
    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
  {
    email: 'institution.test@clinresearch.local',
    password: hashedPassword,
    fullName: 'Test Dental Research Center',
    accountType: 'institution',
    phone: '+201001112225',
    country: 'Egypt',
    governorate: 'Alexandria',
    institutionType: 'research-center',
    authorizedContactName: 'Institution Admin',
    jobTitle: 'Research Operations Director',
    directContactNumber: '+201001112226',
    isVerified: true,
    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
];

try {
  const adminPool = new Pool(getConnectionConfig(adminDatabase));
  const dbExists = await adminPool.query('SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists', [appDatabase]);
  if (!dbExists.rows[0]?.exists && appDatabase !== adminDatabase) {
    await adminPool.query(`CREATE DATABASE "${appDatabase}"`);
  }
  await adminPool.end();

  const pool = new Pool(getConnectionConfig(appDatabase));
  await pool.query(createUsersTableQuery);
  await pool.query(createStudiesTableQuery);
  await pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_type_check');
  await pool.query(`
    ALTER TABLE users
    ADD CONSTRAINT users_account_type_check
    CHECK (
      account_type IN (
        'student',
        'co_researcher',
        'supervisor',
        'assistant_supervisor',
        'clinical_evaluator',
        'institution'
      )
    )
  `);
  await pool.query(
    "ALTER TABLE studies ADD COLUMN IF NOT EXISTS review_decision TEXT CHECK (review_decision IN ('approved', 'changes_requested', 'rejected'))",
  );
  await pool.query('ALTER TABLE studies ADD COLUMN IF NOT EXISTS review_notes TEXT');
  await pool.query('ALTER TABLE studies ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ');
  await pool.query(
    'ALTER TABLE studies ADD COLUMN IF NOT EXISTS reviewed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL',
  );
  await pool.query('ALTER TABLE studies ADD COLUMN IF NOT EXISTS co_researcher_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL');
  await pool.query('ALTER TABLE studies ADD COLUMN IF NOT EXISTS supervisor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL');
  await pool.query(
    'ALTER TABLE studies ADD COLUMN IF NOT EXISTS assistant_supervisor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL',
  );
  await pool.query(
    'ALTER TABLE studies ADD COLUMN IF NOT EXISTS assigned_clinical_evaluator_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL',
  );
  await pool.query('ALTER TABLE studies ADD COLUMN IF NOT EXISTS requires_clinical_evaluation BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query(
    "ALTER TABLE studies ADD COLUMN IF NOT EXISTS clinical_evaluation_decision TEXT CHECK (clinical_evaluation_decision IN ('pending', 'accepted', 'needs_revision', 'not_recommended'))",
  );
  await pool.query('ALTER TABLE studies ADD COLUMN IF NOT EXISTS clinical_evaluation_notes TEXT');
  await pool.query('ALTER TABLE studies ADD COLUMN IF NOT EXISTS clinical_evaluated_at TIMESTAMPTZ');
  await pool.query(
    'ALTER TABLE studies ADD COLUMN IF NOT EXISTS clinical_evaluated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL',
  );
  await pool.query('ALTER TABLE studies ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS studies_principal_title_unique_idx ON studies (principal_investigator_id, title)',
  );

  for (const account of testAccounts) {
    await pool.query(
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
        ON CONFLICT (email) DO UPDATE SET
          password = EXCLUDED.password,
          full_name = EXCLUDED.full_name,
          account_type = EXCLUDED.account_type,
          phone = EXCLUDED.phone,
          date_of_birth = EXCLUDED.date_of_birth,
          country = EXCLUDED.country,
          governorate = EXCLUDED.governorate,
          email_type = EXCLUDED.email_type,
          university = EXCLUDED.university,
          college = EXCLUDED.college,
          institution_type = EXCLUDED.institution_type,
          specialization = EXCLUDED.specialization,
          academic_level = EXCLUDED.academic_level,
          academic_id = EXCLUDED.academic_id,
          academic_rank = EXCLUDED.academic_rank,
          supervisor_id = EXCLUDED.supervisor_id,
          authorized_contact_name = EXCLUDED.authorized_contact_name,
          job_title = EXCLUDED.job_title,
          direct_contact_number = EXCLUDED.direct_contact_number,
          is_verified = EXCLUDED.is_verified,
          is_active = EXCLUDED.is_active,
          trial_ends_at = EXCLUDED.trial_ends_at,
          updated_at = NOW()
      `,
      [
        account.email,
        hashedPassword,
        account.fullName,
        account.accountType,
        account.phone ?? null,
        account.dateOfBirth ?? null,
        account.country ?? null,
        account.governorate ?? null,
        account.emailType ?? null,
        account.university ?? null,
        account.college ?? null,
        account.institutionType ?? null,
        account.specialization ?? null,
        account.academicLevel ?? null,
        account.academicId ?? null,
        account.academicRank ?? null,
        account.supervisorId ?? null,
        account.authorizedContactName ?? null,
        account.jobTitle ?? null,
        account.directContactNumber ?? null,
        account.isVerified,
        true,
        account.trialEndsAt ?? null,
      ],
    );
  }

  const linkedUsersResult = await pool.query(
    `
      SELECT email, id
      FROM users
      WHERE email = ANY($1::text[])
    `,
    [[
      'student.test@clinresearch.local',
      'co.researcher.test@clinresearch.local',
      'supervisor.test@clinresearch.local',
      'assistant.supervisor.test@clinresearch.local',
      'clinical.evaluator.test@clinresearch.local',
    ]],
  );
  const linkedUsers = Object.fromEntries(linkedUsersResult.rows.map((row) => [row.email, row.id]));
  const studentId = linkedUsers['student.test@clinresearch.local'];

  if (studentId) {
    const sampleStudies = [
      {
        title: 'Efficacy of New Drug X in Hypertension',
        description: 'Randomized controlled trial evaluating the efficacy of Drug X in lowering systolic blood pressure.',
        studyType: 'Randomized Controlled Trial',
        workflowType: 'supervised',
        status: 'pending',
        targetSampleSize: 50,
        enrolledPatients: 22,
        hasRandomization: true,
        hasBlinding: true,
        protocolFileName: 'drug-x-protocol.pdf',
        ethicsApprovalNumber: 'IRB-HTN-2026-011',
        clinicalRegistrationNumber: 'NCT-HTN-2026-2001',
        coResearcherUserId: linkedUsers['co.researcher.test@clinresearch.local'] ?? null,
        supervisorUserId: linkedUsers['supervisor.test@clinresearch.local'] ?? null,
        assistantSupervisorUserId: linkedUsers['assistant.supervisor.test@clinresearch.local'] ?? null,
        clinicalEvaluatorUserId: linkedUsers['clinical.evaluator.test@clinresearch.local'] ?? null,
        requiresClinicalEvaluation: true,
      },
      {
        title: 'Diabetes Management Study',
        description: 'Observational study tracking glycemic outcomes across adult diabetes cohorts.',
        studyType: 'Observational Study',
        workflowType: 'migration',
        status: 'active',
        targetSampleSize: 92,
        enrolledPatients: 92,
        hasRandomization: false,
        hasBlinding: false,
        protocolFileName: 'diabetes-observational.docx',
        ethicsApprovalNumber: 'IRB-DM-2026-021',
        clinicalRegistrationNumber: '',
        coResearcherUserId: linkedUsers['co.researcher.test@clinresearch.local'] ?? null,
        supervisorUserId: linkedUsers['supervisor.test@clinresearch.local'] ?? null,
        assistantSupervisorUserId: linkedUsers['assistant.supervisor.test@clinresearch.local'] ?? null,
        clinicalEvaluatorUserId: null,
        requiresClinicalEvaluation: false,
      },
    ];

    for (const study of sampleStudies) {
      await pool.query(
        `
          INSERT INTO studies (
            principal_investigator_id, title, description, study_type, workflow_type, status,
            target_sample_size, enrolled_patients, has_randomization, has_blinding, protocol_file_name,
            ethics_approval_number, clinical_registration_number, co_researcher_user_id, supervisor_user_id,
            assistant_supervisor_user_id, assigned_clinical_evaluator_user_id,
            requires_clinical_evaluation, clinical_evaluation_decision, updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14, $15,
            $16, $17,
            $18, $19, NOW()
          )
          ON CONFLICT (principal_investigator_id, title) DO UPDATE SET
            description = EXCLUDED.description,
            study_type = EXCLUDED.study_type,
            workflow_type = EXCLUDED.workflow_type,
            status = EXCLUDED.status,
            target_sample_size = EXCLUDED.target_sample_size,
            enrolled_patients = EXCLUDED.enrolled_patients,
            has_randomization = EXCLUDED.has_randomization,
            has_blinding = EXCLUDED.has_blinding,
            protocol_file_name = EXCLUDED.protocol_file_name,
            ethics_approval_number = EXCLUDED.ethics_approval_number,
            clinical_registration_number = EXCLUDED.clinical_registration_number,
            co_researcher_user_id = EXCLUDED.co_researcher_user_id,
            supervisor_user_id = EXCLUDED.supervisor_user_id,
            assistant_supervisor_user_id = EXCLUDED.assistant_supervisor_user_id,
            assigned_clinical_evaluator_user_id = EXCLUDED.assigned_clinical_evaluator_user_id,
            requires_clinical_evaluation = EXCLUDED.requires_clinical_evaluation,
            clinical_evaluation_decision = EXCLUDED.clinical_evaluation_decision,
            updated_at = NOW()
        `,
        [
          studentId,
          study.title,
          study.description,
          study.studyType,
          study.workflowType,
          study.status,
          study.targetSampleSize,
          study.enrolledPatients,
          study.hasRandomization,
          study.hasBlinding,
          study.protocolFileName,
          study.ethicsApprovalNumber,
          study.clinicalRegistrationNumber || null,
          study.coResearcherUserId,
          study.supervisorUserId,
          study.assistantSupervisorUserId,
          study.clinicalEvaluatorUserId,
          study.requiresClinicalEvaluation,
          study.requiresClinicalEvaluation ? 'pending' : null,
        ],
      );
    }
  }

  await pool.end();

  console.log('Seeded test accounts successfully.');
  console.log(`Password for all accounts: ${plainPassword}`);
  console.log('student.test@clinresearch.local');
  console.log('co.researcher.test@clinresearch.local');
  console.log('supervisor.test@clinresearch.local');
  console.log('assistant.supervisor.test@clinresearch.local');
  console.log('clinical.evaluator.test@clinresearch.local');
  console.log('institution.test@clinresearch.local');
} catch (error) {
  console.error('Failed to seed test accounts:', error);
  process.exitCode = 1;
}
