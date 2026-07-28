import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

const appDatabase = process.env.PGDATABASE || 'clinical_research';
const adminDatabase = process.env.PG_ADMIN_DATABASE || 'postgres';

const getConnectionConfig = (database: string): PoolConfig => ({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || undefined,
  database,
  connectionTimeoutMillis: Number(process.env.PGCONNECT_TIMEOUT_MS || 5000),
});

let pool: Pool | null = null;

const assertSafeDatabaseName = (database: string) => {
  if (!/^[a-zA-Z0-9_]+$/.test(database)) {
    throw new Error(`Unsafe database name: ${database}`);
  }
};

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
    randomization_method TEXT CHECK (randomization_method IN ('simple', 'block')),
    groups_json JSONB NOT NULL DEFAULT '["Experimental","Control"]'::jsonb,
    blinding_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
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
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    locked_at TIMESTAMPTZ,
    locked_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
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

const createStudyFilesTableQuery = `
  CREATE TABLE IF NOT EXISTS study_files (
    id BIGSERIAL PRIMARY KEY,
    study_id BIGINT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    uploaded_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    file_category TEXT NOT NULL DEFAULT 'attachment' CHECK (file_category IN ('protocol', 'dataset', 'image', 'attachment', 'report')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const createStudyAnalysesTableQuery = `
  CREATE TABLE IF NOT EXISTS study_analyses (
    id BIGSERIAL PRIMARY KEY,
    study_id BIGINT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    source_file_id BIGINT REFERENCES study_files(id) ON DELETE SET NULL,
    created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    analysis_type TEXT,
    assistant_mode TEXT,
    prompt TEXT,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    profile_json JSONB,
    result_json JSONB,
    assistant_json JSONB,
    ocr_json JSONB,
    report_relative_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const createOutcomeAssessmentRequestsTableQuery = `
  CREATE TABLE IF NOT EXISTS study_outcome_assessment_requests (
    id BIGSERIAL PRIMARY KEY,
    study_id BIGINT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    assessor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_status TEXT NOT NULL DEFAULT 'new' CHECK (
      request_status IN ('new', 'accepted', 'rejected', 'active', 'completed', 'archived')
    ),
    assessment_type TEXT NOT NULL,
    deadline_at TIMESTAMPTZ,
    samples_required INTEGER NOT NULL DEFAULT 0,
    optional_message TEXT,
    accepted_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (study_id, assessor_user_id)
  );
`;

const createOutcomeAssessmentSamplesTableQuery = `
  CREATE TABLE IF NOT EXISTS study_outcome_assessment_samples (
    id BIGSERIAL PRIMARY KEY,
    study_id BIGINT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL,
    visit_number TEXT NOT NULL,
    inclusion_eligible BOOLEAN NOT NULL DEFAULT TRUE,
    allocated_group TEXT,
    masked_group_code TEXT,
    sample_status TEXT NOT NULL DEFAULT 'pending' CHECK (
      sample_status IN ('pending', 'in_progress', 'submitted', 'reopened')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (study_id, subject_id, visit_number)
  );
`;

const createSubscriptionPlansTableQuery = `
  CREATE TABLE IF NOT EXISTS subscription_plans (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    includes_sample_size BOOLEAN NOT NULL DEFAULT FALSE,
    includes_statistical_analysis BOOLEAN NOT NULL DEFAULT FALSE,
    monthly_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    yearly_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const createOutcomeAssessmentSampleFilesTableQuery = `
  CREATE TABLE IF NOT EXISTS study_outcome_assessment_sample_files (
    id BIGSERIAL PRIMARY KEY,
    sample_id BIGINT NOT NULL REFERENCES study_outcome_assessment_samples(id) ON DELETE CASCADE,
    file_id BIGINT NOT NULL REFERENCES study_files(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL CHECK (
      asset_type IN ('photo_before', 'photo_after', 'xray_before', 'xray_after', 'stl', 'lab_result', 'other')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const createOutcomeAssessmentTemplateVersionsTableQuery = `
  CREATE TABLE IF NOT EXISTS study_outcome_assessment_template_versions (
    id BIGSERIAL PRIMARY KEY,
    study_id BIGINT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (
      approval_status IN ('approved', 'pending_approval', 'rejected')
    ),
    template_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    change_notes TEXT,
    approved_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (study_id, version_number)
  );
`;

const createOutcomeAssessmentEntriesTableQuery = `
  CREATE TABLE IF NOT EXISTS study_outcome_assessment_entries (
    id BIGSERIAL PRIMARY KEY,
    request_id BIGINT NOT NULL REFERENCES study_outcome_assessment_requests(id) ON DELETE CASCADE,
    sample_id BIGINT NOT NULL REFERENCES study_outcome_assessment_samples(id) ON DELETE CASCADE,
    assessor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_version_id BIGINT REFERENCES study_outcome_assessment_template_versions(id) ON DELETE SET NULL,
    response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
      status IN ('pending', 'in_progress', 'submitted', 'locked', 'reopened')
    ),
    assessor_comments TEXT,
    submitted_at TIMESTAMPTZ,
    locked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (request_id, sample_id)
  );
`;

const createOutcomeAssessmentNotesTableQuery = `
  CREATE TABLE IF NOT EXISTS study_outcome_assessment_notes (
    id BIGSERIAL PRIMARY KEY,
    request_id BIGINT NOT NULL REFERENCES study_outcome_assessment_requests(id) ON DELETE CASCADE,
    sample_id BIGINT REFERENCES study_outcome_assessment_samples(id) ON DELETE CASCADE,
    author_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_scope TEXT NOT NULL DEFAULT 'research_team' CHECK (
      recipient_scope IN ('research_team', 'assessor_only')
    ),
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const createOutcomeAssessmentAuditTrailTableQuery = `
  CREATE TABLE IF NOT EXISTS study_outcome_assessment_audit_trail (
    id BIGSERIAL PRIMARY KEY,
    request_id BIGINT REFERENCES study_outcome_assessment_requests(id) ON DELETE CASCADE,
    sample_id BIGINT REFERENCES study_outcome_assessment_samples(id) ON DELETE CASCADE,
    entry_id BIGINT REFERENCES study_outcome_assessment_entries(id) ON DELETE CASCADE,
    actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const createStudyVariableMappingsTableQuery = `
  CREATE TABLE IF NOT EXISTS study_variable_mappings (
    study_id BIGINT PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
    matrix_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const createStudyGovernanceTableQuery = `
  CREATE TABLE IF NOT EXISTS study_governance_snapshots (
    study_id BIGINT PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
    snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const ensureDatabaseExists = async () => {
  assertSafeDatabaseName(appDatabase);

  if (appDatabase === adminDatabase) {
    return;
  }

  const adminPool = new Pool(getConnectionConfig(adminDatabase));

  try {
    const result = await adminPool.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [appDatabase],
    );

    if (!result.rows[0]?.exists) {
      await adminPool.query(`CREATE DATABASE "${appDatabase}"`);
    }
  } finally {
    await adminPool.end();
  }
};

export const initializeDatabase = async () => {
  await ensureDatabaseExists();

  if (!pool) {
    pool = new Pool(getConnectionConfig(appDatabase));
  }

  await pool.query('SELECT 1');
  await pool.query(createUsersTableQuery);
  await pool.query(createStudiesTableQuery);
  await pool.query(createStudyFilesTableQuery);
  await pool.query(createStudyAnalysesTableQuery);
  await pool.query(createSubscriptionPlansTableQuery);
  await pool.query(createOutcomeAssessmentRequestsTableQuery);
  await pool.query(createOutcomeAssessmentSamplesTableQuery);
  await pool.query(createOutcomeAssessmentSampleFilesTableQuery);
  await pool.query(createOutcomeAssessmentTemplateVersionsTableQuery);
  await pool.query(createOutcomeAssessmentEntriesTableQuery);
  await pool.query(createOutcomeAssessmentNotesTableQuery);
  await pool.query(createOutcomeAssessmentAuditTrailTableQuery);
  await pool.query(createStudyVariableMappingsTableQuery);
  await pool.query(createStudyGovernanceTableQuery);
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
  await pool.query('ALTER TABLE studies ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE studies ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ');
  await pool.query(
    'ALTER TABLE studies ADD COLUMN IF NOT EXISTS locked_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL',
  );
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
    "ALTER TABLE studies ADD COLUMN IF NOT EXISTS randomization_method TEXT CHECK (randomization_method IN ('simple', 'block'))",
  );
  await pool.query(
    "ALTER TABLE studies ADD COLUMN IF NOT EXISTS groups_json JSONB NOT NULL DEFAULT '[\"Experimental\",\"Control\"]'::jsonb",
  );
  await pool.query("ALTER TABLE studies ADD COLUMN IF NOT EXISTS blinding_config_json JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query('ALTER TABLE study_files ADD COLUMN IF NOT EXISTS mime_type TEXT');
  await pool.query('ALTER TABLE study_files ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0');
  await pool.query(
    "ALTER TABLE study_files ADD COLUMN IF NOT EXISTS file_category TEXT NOT NULL DEFAULT 'attachment' CHECK (file_category IN ('protocol', 'dataset', 'image', 'attachment', 'report'))",
  );
  await pool.query("ALTER TABLE study_analyses ADD COLUMN IF NOT EXISTS config_json JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query('ALTER TABLE study_analyses ADD COLUMN IF NOT EXISTS profile_json JSONB');
  await pool.query('ALTER TABLE study_analyses ADD COLUMN IF NOT EXISTS result_json JSONB');
  await pool.query('ALTER TABLE study_analyses ADD COLUMN IF NOT EXISTS assistant_json JSONB');
  await pool.query('ALTER TABLE study_analyses ADD COLUMN IF NOT EXISTS ocr_json JSONB');
  await pool.query('ALTER TABLE study_analyses ADD COLUMN IF NOT EXISTS report_relative_path TEXT');
  await pool.query('ALTER TABLE study_outcome_assessment_samples ADD COLUMN IF NOT EXISTS inclusion_eligible BOOLEAN NOT NULL DEFAULT TRUE');
  await pool.query('ALTER TABLE study_outcome_assessment_samples ADD COLUMN IF NOT EXISTS allocated_group TEXT');
  await pool.query('ALTER TABLE study_outcome_assessment_samples ADD COLUMN IF NOT EXISTS masked_group_code TEXT');
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS studies_principal_title_unique_idx ON studies (principal_investigator_id, title)',
  );
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_academic_id_unique_idx ON users (LOWER(academic_id)) WHERE academic_id IS NOT NULL AND TRIM(academic_id) <> ''",
  );
  await pool.query('CREATE INDEX IF NOT EXISTS study_files_study_id_idx ON study_files (study_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS study_analyses_study_id_idx ON study_analyses (study_id, created_at DESC)');
  await pool.query(
    'CREATE INDEX IF NOT EXISTS outcome_assessment_requests_assessor_idx ON study_outcome_assessment_requests (assessor_user_id, request_status, updated_at DESC)',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS outcome_assessment_requests_study_idx ON study_outcome_assessment_requests (study_id, updated_at DESC)',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS outcome_assessment_samples_study_idx ON study_outcome_assessment_samples (study_id, created_at DESC)',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS outcome_assessment_samples_allocated_group_idx ON study_outcome_assessment_samples (study_id, allocated_group)',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS outcome_assessment_entries_request_idx ON study_outcome_assessment_entries (request_id, status, updated_at DESC)',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS outcome_assessment_notes_request_idx ON study_outcome_assessment_notes (request_id, created_at DESC)',
  );
  await pool.query(
    `
      INSERT INTO subscription_plans (
        code, name, description, includes_sample_size, includes_statistical_analysis, monthly_price, yearly_price
      )
      VALUES
        ('sample-size', 'Sample Size', 'Includes standalone sample size calculation tools.', TRUE, FALSE, 19, 190),
        ('stat-analysis', 'Statistical Analysis', 'Includes standalone statistical analysis and reporting.', FALSE, TRUE, 29, 290),
        ('research-pro', 'Research Pro', 'Includes both sample size and statistical analysis workflows.', TRUE, TRUE, 39, 390)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        includes_sample_size = EXCLUDED.includes_sample_size,
        includes_statistical_analysis = EXCLUDED.includes_statistical_analysis,
        monthly_price = EXCLUDED.monthly_price,
        yearly_price = EXCLUDED.yearly_price,
        updated_at = NOW()
    `,
  );
};

export const query = async <T extends QueryResultRow>(text: string, params: unknown[] = []) => {
  if (!pool) {
    throw new Error('Database has not been initialized');
  }

  return pool.query<T>(text, params);
};

export const closeDatabase = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
