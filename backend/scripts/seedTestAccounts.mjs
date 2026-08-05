import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

const TABLE_INIT_QUERIES = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (
      account_type IN ('student','co_researcher','supervisor','assistant_supervisor','clinical_evaluator','institution')
    ),
    phone TEXT, date_of_birth DATE, country TEXT, governorate TEXT,
    email_type TEXT CHECK (email_type IN ('academic','personal')),
    university TEXT, college TEXT,
    institution_type TEXT CHECK (institution_type IN ('university','hospital','research-center')),
    specialization TEXT, academic_level TEXT, academic_id TEXT, academic_rank TEXT,
    supervisor_id TEXT, authorized_contact_name TEXT, job_title TEXT, direct_contact_number TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    trial_ends_at TIMESTAMPTZ,
    subscription_plan TEXT,
    subscription_status TEXT CHECK (subscription_status IN ('active','expired','cancelled')),
    subscription_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS studies (
    id BIGSERIAL PRIMARY KEY,
    principal_investigator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, description TEXT, study_type TEXT NOT NULL,
    workflow_type TEXT NOT NULL CHECK (workflow_type IN ('supervised','migration')),
    status TEXT NOT NULL CHECK (status IN ('draft','pending','approved','active','completed','cancelled')),
    target_sample_size INTEGER NOT NULL DEFAULT 0,
    enrolled_patients INTEGER NOT NULL DEFAULT 0,
    has_randomization BOOLEAN NOT NULL DEFAULT FALSE,
    has_blinding BOOLEAN NOT NULL DEFAULT FALSE,
    randomization_method TEXT CHECK (randomization_method IN ('simple','block')),
    groups_json JSONB NOT NULL DEFAULT '["Experimental","Control"]'::jsonb,
    blinding_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    protocol_file_name TEXT, ethics_approval_number TEXT, clinical_registration_number TEXT,
    co_researcher_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    supervisor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    assistant_supervisor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    assigned_clinical_evaluator_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    review_decision TEXT CHECK (review_decision IN ('approved','changes_requested','rejected')),
    review_notes TEXT, reviewed_at TIMESTAMPTZ, reviewed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    requires_clinical_evaluation BOOLEAN NOT NULL DEFAULT FALSE,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE, locked_at TIMESTAMPTZ,
    locked_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    clinical_evaluation_decision TEXT CHECK (clinical_evaluation_decision IN ('pending','accepted','needs_revision','not_recommended')),
    clinical_evaluation_notes TEXT, clinical_evaluated_at TIMESTAMPTZ,
    clinical_evaluated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (principal_investigator_id, title),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS study_files (
    id BIGSERIAL PRIMARY KEY, study_id BIGINT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    uploaded_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL, stored_name TEXT NOT NULL, relative_path TEXT NOT NULL,
    mime_type TEXT, size_bytes BIGINT NOT NULL DEFAULT 0,
    file_category TEXT NOT NULL DEFAULT 'attachment' CHECK (file_category IN ('protocol','dataset','image','attachment','report')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS study_outcome_assessment_template_versions (
    id BIGSERIAL PRIMARY KEY, study_id BIGINT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('approved','pending_approval','rejected')),
    template_json JSONB NOT NULL DEFAULT '[]'::jsonb, change_notes TEXT,
    approved_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (study_id, version_number)
  )`,
  `CREATE TABLE IF NOT EXISTS study_outcome_assessment_samples (
    id BIGSERIAL PRIMARY KEY, study_id BIGINT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL, visit_number TEXT NOT NULL,
    inclusion_eligible BOOLEAN NOT NULL DEFAULT TRUE,
    allocated_group TEXT, masked_group_code TEXT,
    sample_status TEXT NOT NULL DEFAULT 'pending' CHECK (sample_status IN ('pending','in_progress','submitted','reopened')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (study_id, subject_id, visit_number)
  )`,
  `CREATE TABLE IF NOT EXISTS study_outcome_assessment_requests (
    id BIGSERIAL PRIMARY KEY, study_id BIGINT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    assessor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_status TEXT NOT NULL DEFAULT 'new' CHECK (request_status IN ('new','accepted','rejected','active','completed','archived')),
    assessment_type TEXT NOT NULL, deadline_at TIMESTAMPTZ,
    samples_required INTEGER NOT NULL DEFAULT 0, optional_message TEXT,
    accepted_at TIMESTAMPTZ, rejected_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (study_id, assessor_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS study_outcome_assessment_entries (
    id BIGSERIAL PRIMARY KEY,
    request_id BIGINT NOT NULL REFERENCES study_outcome_assessment_requests(id) ON DELETE CASCADE,
    sample_id BIGINT NOT NULL REFERENCES study_outcome_assessment_samples(id) ON DELETE CASCADE,
    assessor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_version_id BIGINT REFERENCES study_outcome_assessment_template_versions(id) ON DELETE SET NULL,
    response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','submitted','locked','reopened')),
    assessor_comments TEXT, submitted_at TIMESTAMPTZ, locked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (request_id, sample_id)
  )`,
  `CREATE TABLE IF NOT EXISTS study_outcome_assessment_sample_files (
    id BIGSERIAL PRIMARY KEY,
    sample_id BIGINT NOT NULL REFERENCES study_outcome_assessment_samples(id) ON DELETE CASCADE,
    file_id BIGINT NOT NULL REFERENCES study_files(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL CHECK (asset_type IN ('photo_before','photo_after','xray_before','xray_after','stl','lab_result','other')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS study_outcome_assessment_notes (
    id BIGSERIAL PRIMARY KEY,
    request_id BIGINT NOT NULL REFERENCES study_outcome_assessment_requests(id) ON DELETE CASCADE,
    sample_id BIGINT REFERENCES study_outcome_assessment_samples(id) ON DELETE CASCADE,
    author_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_scope TEXT NOT NULL DEFAULT 'research_team' CHECK (recipient_scope IN ('research_team','assessor_only')),
    message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS study_outcome_assessment_audit_trail (
    id BIGSERIAL PRIMARY KEY,
    request_id BIGINT REFERENCES study_outcome_assessment_requests(id) ON DELETE CASCADE,
    sample_id BIGINT REFERENCES study_outcome_assessment_samples(id) ON DELETE CASCADE,
    entry_id BIGINT REFERENCES study_outcome_assessment_entries(id) ON DELETE CASCADE,
    actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL, details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS study_variable_mappings (
    study_id BIGINT PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
    matrix_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS study_governance_snapshots (
    study_id BIGINT PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
    snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS subscription_plans (
    id BIGSERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT,
    includes_sample_size BOOLEAN NOT NULL DEFAULT FALSE,
    includes_statistical_analysis BOOLEAN NOT NULL DEFAULT FALSE,
    monthly_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    yearly_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS study_analyses (
    id BIGSERIAL PRIMARY KEY, study_id BIGINT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    source_file_id BIGINT REFERENCES study_files(id) ON DELETE SET NULL,
    created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, analysis_type TEXT, assistant_mode TEXT, prompt TEXT,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb, profile_json JSONB,
    result_json JSONB, assistant_json JSONB, ocr_json JSONB, report_relative_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

const plainPassword = 'Test@12345';
const hashedPassword = await bcrypt.hash(plainPassword, 10);

const testAccounts = [
  {
    email: 'student.test@clinresearch.local',
    password: hashedPassword,
    fullName: 'Ahmed Khaled (طالب ماجستير)',
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
    trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  },
  {
    email: 'co.researcher.test@clinresearch.local',
    password: hashedPassword,
    fullName: 'Sara Mahmoud (باحث مشارك)',
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
    trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  },
  {
    email: 'supervisor.test@clinresearch.local',
    password: hashedPassword,
    fullName: 'Prof. Mohamed Ali (مشرف رئيسي)',
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
    academicRank: 'Professor',
    isVerified: true,
    trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  },
  {
    email: 'assistant.supervisor.test@clinresearch.local',
    password: hashedPassword,
    fullName: 'Dr. Hany Samir (مشرف مساعد)',
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
    trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  },
  {
    email: 'clinical.evaluator.test@clinresearch.local',
    password: hashedPassword,
    fullName: 'Dr. Mona Hassan (مقيم سريري)',
    accountType: 'clinical_evaluator',
    phone: '+201001112229',
    dateOfBirth: new Date('1983-02-15'),
    country: 'Egypt',
    governorate: 'Alexandria',
    emailType: 'academic',
    university: 'Alexandria University',
    college: 'Faculty of Dentistry',
    specialization: 'Oral Medicine - Orthodontics',
    academicId: 'EVAL-4001',
    academicRank: 'Consultant',
    isVerified: true,
    trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  },
  {
    email: 'institution.test@clinresearch.local',
    password: hashedPassword,
    fullName: 'Egyptian Dental Research Center',
    accountType: 'institution',
    phone: '+201001112225',
    country: 'Egypt',
    governorate: 'Alexandria',
    institutionType: 'research-center',
    authorizedContactName: 'Dr. Nasser Admin',
    jobTitle: 'Research Operations Director',
    directContactNumber: '+201001112226',
    isVerified: true,
    trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  },
];

const DEMO_CRFTEMPLATE = [
  { id: 'demo_patient_code', label: 'Patient Code', responseType: 'text', section: 'Patient Identification', required: true, note: 'Unique anonymized patient identifier' },
  { id: 'demo_visit_number', label: 'Visit Number', responseType: 'choice', options: ['Visit 1 - Baseline', 'Visit 2 - Mid-Treatment', 'Visit 3 - Debond', 'Visit 4 - Retention 6M', 'Visit 5 - Retention 12M'], section: 'Patient Identification', required: true },
  { id: 'demo_visit_date', label: 'Assessment Date', responseType: 'text', section: 'Patient Identification', required: true },
  { id: 'demo_age', label: 'Age (years)', responseType: 'numeric', section: 'Demographics', required: true },
  { id: 'demo_gender', label: 'Gender', responseType: 'choice', options: ['Male', 'Female'], section: 'Demographics', required: true },
  { id: 'demo_skeletal_class', label: 'Skeletal Classification', responseType: 'choice', options: ['Class I', 'Class II Division 1', 'Class II Division 2', 'Class III'], section: 'Pre-Treatment Diagnosis', required: true },
  { id: 'demo_angels_class', label: "Angle's Classification", responseType: 'choice', options: ['Class I', 'Class II Division 1', 'Class II Division 2', 'Class III'], section: 'Pre-Treatment Diagnosis', required: true },
  { id: 'demo_crowding_upper', label: 'Upper Arch Crowding (mm)', responseType: 'numeric', section: 'Pre-Treatment Diagnosis', required: true, note: 'Positive value = crowding, Negative = spacing' },
  { id: 'demo_crowding_lower', label: 'Lower Arch Crowding (mm)', responseType: 'numeric', section: 'Pre-Treatment Diagnosis', required: true },
  { id: 'demo_overjet_pre', label: 'Pre-Treatment Overjet (mm)', responseType: 'numeric', section: 'Pre-Treatment Measurements', required: true },
  { id: 'demo_overbite_pre', label: 'Pre-Treatment Overbite (%)', responseType: 'numeric', section: 'Pre-Treatment Measurements', required: true },
  { id: 'demo_midline_deviation', label: 'Midline Deviation (mm)', responseType: 'numeric', section: 'Pre-Treatment Measurements', note: 'Positive = right, Negative = left' },
  { id: 'demo_par_score_pre', label: 'PAR Score (Pre)', responseType: 'numeric', section: 'Outcome Measures', required: true, note: 'Peer Assessment Rating - lower is better' },
  { id: 'demo_par_score_post', label: 'PAR Score (Post)', responseType: 'numeric', section: 'Outcome Measures', required: true },
  { id: 'demo_alignment_post', label: 'Post-Treatment Alignment', responseType: 'choice', options: ['Poor (<50%)', 'Fair (50-70%)', 'Good (70-90%)', 'Excellent (>90%)'], section: 'Outcome Measures', required: true },
  { id: 'demo_overjet_post', label: 'Post-Treatment Overjet (mm)', responseType: 'numeric', section: 'Outcome Measures', required: true },
  { id: 'demo_overbite_post', label: 'Post-Treatment Overbite (%)', responseType: 'numeric', section: 'Outcome Measures', required: true },
  { id: 'demo_root_resorption', label: 'Root Resorption', responseType: 'choice', options: ['None', 'Mild (<2mm)', 'Moderate (2-4mm)', 'Severe (>4mm)'], section: 'Radiographic Assessment', required: true },
  { id: 'demo_periodontal_status', label: 'Periodontal Status', responseType: 'choice', options: ['Healthy', 'Early Gingivitis', 'Moderate', 'Severe'], section: 'Radiographic Assessment', required: true },
  { id: 'demo_patient_satisfaction', label: 'Patient Satisfaction (VAS 0-10)', responseType: 'numeric', section: 'Patient Reported', note: '0 = completely dissatisfied, 10 = completely satisfied' },
  { id: 'demo_pain_level', label: 'Pain / Discomfort Level', responseType: 'choice', options: ['None', 'Mild', 'Moderate', 'Severe'], section: 'Patient Reported' },
  { id: 'demo_treatment_duration', label: 'Total Treatment Duration (months)', responseType: 'numeric', section: 'Treatment Summary', required: true },
  { id: 'demo_extractions_done', label: 'Extractions Performed', responseType: 'boolean', section: 'Treatment Summary', required: true },
  { id: 'demo_retention_type', label: 'Retention Type', responseType: 'choice', options: ['Vacuum Formed Essix', 'Hawley', 'Bonded Fixed', 'Combination'], section: 'Treatment Summary' },
  { id: 'demo_complications', label: 'Complications / Adverse Events', responseType: 'text', section: 'Treatment Summary' },
  { id: 'demo_overall_success', label: 'Overall Treatment Success', responseType: 'choice', options: ['Failure', 'Borderline', 'Acceptable', 'Excellent'], section: 'Assessor Final Assessment', required: true },
  { id: 'demo_grading_abr', label: 'ABO Objective Grading Score', responseType: 'numeric', section: 'Assessor Final Assessment', note: 'American Board of Orthodontics - 0-30 scale, <10 = Excellent' },
  { id: 'demo_assessor_comments', label: 'Assessor General Comments', responseType: 'text', section: 'Assessor Final Assessment' },
];

const DEMO_SAMPLES = [
  { subject: 'PT-001', visit: 'Visit 3 - Debond', age: 17, gender: 'Female', group: 'Experimental - Clear Aligners', mask: 'GRP-A', overjetPre: 6.2, overjetPost: 2.1, overbitePre: 55, overbitePost: 15, crowdingUpPre: 7.5, crowdingLowPre: 6.0, parPre: 38, parPost: 7, alignment: 'Excellent (>90%)', rootRes: 'Mild (<2mm)', periodontal: 'Healthy', satisfaction: 9, success: 'Excellent', duration: 14 },
  { subject: 'PT-002', visit: 'Visit 3 - Debond', age: 19, gender: 'Male', group: 'Control - Fixed Braces', mask: 'GRP-B', overjetPre: 5.8, overjetPost: 2.3, overbitePre: 48, overbitePost: 18, crowdingUpPre: 6.0, crowdingLowPre: 5.5, parPre: 34, parPost: 5, alignment: 'Excellent (>90%)', rootRes: 'Mild (<2mm)', periodontal: 'Early Gingivitis', satisfaction: 8, success: 'Acceptable', duration: 16 },
  { subject: 'PT-003', visit: 'Visit 3 - Debond', age: 16, gender: 'Female', group: 'Experimental - Clear Aligners', mask: 'GRP-A', overjetPre: 7.0, overjetPost: 2.5, overbitePre: 62, overbitePost: 20, crowdingUpPre: 8.0, crowdingLowPre: 7.0, parPre: 42, parPost: 12, alignment: 'Good (70-90%)', rootRes: 'Mild (<2mm)', periodontal: 'Healthy', satisfaction: 9, success: 'Excellent', duration: 15 },
  { subject: 'PT-004', visit: 'Visit 3 - Debond', age: 21, gender: 'Female', group: 'Control - Fixed Braces', mask: 'GRP-B', overjetPre: 5.2, overjetPost: 1.8, overbitePre: 45, overbitePost: 12, crowdingUpPre: 5.0, crowdingLowPre: 4.5, parPre: 31, parPost: 4, alignment: 'Excellent (>90%)', rootRes: 'None', periodontal: 'Healthy', satisfaction: 10, success: 'Excellent', duration: 13 },
  { subject: 'PT-005', visit: 'Visit 3 - Debond', age: 18, gender: 'Male', group: 'Experimental - Clear Aligners', mask: 'GRP-A', overjetPre: 6.5, overjetPost: 3.0, overbitePre: 50, overbitePost: 22, crowdingUpPre: 6.8, crowdingLowPre: 6.2, parPre: 36, parPost: 10, alignment: 'Good (70-90%)', rootRes: 'Mild (<2mm)', periodontal: 'Healthy', satisfaction: 7, success: 'Acceptable', duration: 17 },
  { subject: 'PT-006', visit: 'Visit 3 - Debond', age: 20, gender: 'Female', group: 'Control - Fixed Braces', mask: 'GRP-B', overjetPre: 4.8, overjetPost: 2.0, overbitePre: 40, overbitePost: 14, crowdingUpPre: 4.2, crowdingLowPre: 3.8, parPre: 28, parPost: 3, alignment: 'Excellent (>90%)', rootRes: 'None', periodontal: 'Healthy', satisfaction: 9, success: 'Excellent', duration: 12 },
  { subject: 'PT-007', visit: 'Visit 2 - Mid-Treatment', age: 17, gender: 'Male', group: 'Experimental - Clear Aligners', mask: 'GRP-A', overjetPre: 5.9, overjetPost: 3.5, overbitePre: 52, overbitePost: 30, crowdingUpPre: 7.0, crowdingLowPre: 6.5, parPre: 35, parPost: 18, alignment: 'Fair (50-70%)', rootRes: 'None', periodontal: 'Healthy', satisfaction: 6, success: 'Borderline', duration: 9 },
  { subject: 'PT-008', visit: 'Visit 2 - Mid-Treatment', age: 18, gender: 'Female', group: 'Control - Fixed Braces', mask: 'GRP-B', overjetPre: 6.8, overjetPost: 3.8, overbitePre: 58, overbitePost: 28, crowdingUpPre: 7.8, crowdingLowPre: 7.2, parPre: 40, parPost: 21, alignment: 'Fair (50-70%)', rootRes: 'Mild (<2mm)', periodontal: 'Early Gingivitis', satisfaction: 5, success: 'Borderline', duration: 10 },
  { subject: 'PT-009', visit: 'Visit 1 - Baseline', age: 16, gender: 'Male', group: 'Experimental - Clear Aligners', mask: 'GRP-A', overjetPre: 5.5, overjetPost: 0, overbitePre: 46, overbitePost: 0, crowdingUpPre: 6.0, crowdingLowPre: 5.8, parPre: 33, parPost: 0, alignment: 'Poor (<50%)', rootRes: 'None', periodontal: 'Healthy', satisfaction: 0, success: 'Failure', duration: 0 },
  { subject: 'PT-010', visit: 'Visit 1 - Baseline', age: 22, gender: 'Female', group: 'Control - Fixed Braces', mask: 'GRP-B', overjetPre: 7.2, overjetPost: 0, overbitePre: 60, overbitePost: 0, crowdingUpPre: 8.2, crowdingLowPre: 7.5, parPre: 44, parPost: 0, alignment: 'Poor (<50%)', rootRes: 'None', periodontal: 'Healthy', satisfaction: 0, success: 'Failure', duration: 0 },
  { subject: 'PT-011', visit: 'Visit 4 - Retention 6M', age: 19, gender: 'Female', group: 'Experimental - Clear Aligners', mask: 'GRP-A', overjetPre: 6.0, overjetPost: 2.2, overbitePre: 50, overbitePost: 16, crowdingUpPre: 6.8, crowdingLowPre: 6.0, parPre: 36, parPost: 6, alignment: 'Excellent (>90%)', rootRes: 'Mild (<2mm)', periodontal: 'Healthy', satisfaction: 9, success: 'Excellent', duration: 14 },
  { subject: 'PT-012', visit: 'Visit 4 - Retention 6M', age: 20, gender: 'Male', group: 'Control - Fixed Braces', mask: 'GRP-B', overjetPre: 5.6, overjetPost: 2.4, overbitePre: 44, overbitePost: 18, crowdingUpPre: 5.4, crowdingLowPre: 5.0, parPre: 32, parPost: 8, alignment: 'Good (70-90%)', rootRes: 'Mild (<2mm)', periodontal: 'Healthy', satisfaction: 8, success: 'Acceptable', duration: 16 },
];

try {
  const adminPool = new Pool(getConnectionConfig(adminDatabase));
  const dbExists = await adminPool.query('SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists', [appDatabase]);
  if (!dbExists.rows[0]?.exists && appDatabase !== adminDatabase) {
    await adminPool.query(`CREATE DATABASE "${appDatabase}"`);
    console.log(`Created database: ${appDatabase}`);
  }
  await adminPool.end();

  const pool = new Pool(getConnectionConfig(appDatabase));

  console.log('Initializing tables...');
  for (const q of TABLE_INIT_QUERIES) {
    await pool.query(q);
  }
  console.log('Tables initialized.');

  await pool.query(
    `INSERT INTO subscription_plans (code, name, description, includes_sample_size, includes_statistical_analysis, monthly_price, yearly_price)
     VALUES
       ('sample-size', 'Sample Size', 'Includes standalone sample size calculation tools.', TRUE, FALSE, 19, 190),
       ('stat-analysis', 'Statistical Analysis', 'Includes standalone statistical analysis and reporting.', FALSE, TRUE, 29, 290),
       ('research-pro', 'Research Pro', 'Includes both sample size and statistical analysis workflows.', TRUE, TRUE, 39, 390)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW()`,
  );
  console.log('Subscription plans seeded.');

  for (const account of testAccounts) {
    await pool.query(
      `INSERT INTO users (
        email, password, full_name, account_type, phone, date_of_birth, country, governorate,
        email_type, university, college, institution_type, specialization, academic_level,
        academic_id, academic_rank, supervisor_id, authorized_contact_name, job_title,
        direct_contact_number, is_verified, is_active, trial_ends_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW())
       ON CONFLICT (email) DO UPDATE SET
        password = EXCLUDED.password, full_name = EXCLUDED.full_name, account_type = EXCLUDED.account_type,
        phone = EXCLUDED.phone, date_of_birth = EXCLUDED.date_of_birth, country = EXCLUDED.country,
        governorate = EXCLUDED.governorate, email_type = EXCLUDED.email_type,
        university = EXCLUDED.university, college = EXCLUDED.college, institution_type = EXCLUDED.institution_type,
        specialization = EXCLUDED.specialization, academic_level = EXCLUDED.academic_level,
        academic_id = EXCLUDED.academic_id, academic_rank = EXCLUDED.academic_rank,
        supervisor_id = EXCLUDED.supervisor_id, authorized_contact_name = EXCLUDED.authorized_contact_name,
        job_title = EXCLUDED.job_title, direct_contact_number = EXCLUDED.direct_contact_number,
        is_verified = EXCLUDED.is_verified, trial_ends_at = EXCLUDED.trial_ends_at, updated_at = NOW()`,
      [
        account.email, hashedPassword, account.fullName, account.accountType,
        account.phone ?? null, account.dateOfBirth ?? null, account.country ?? null,
        account.governorate ?? null, account.emailType ?? null, account.university ?? null,
        account.college ?? null, account.institutionType ?? null, account.specialization ?? null,
        account.academicLevel ?? null, account.academicId ?? null, account.academicRank ?? null,
        account.supervisorId ?? null, account.authorizedContactName ?? null, account.jobTitle ?? null,
        account.directContactNumber ?? null, account.isVerified, true, account.trialEndsAt ?? null,
      ],
    );
  }
  console.log('Test accounts seeded.');

  const linkedUsersResult = await pool.query(
    `SELECT email, id FROM users WHERE email = ANY($1::text[])`,
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
  const supervisorId = linkedUsers['supervisor.test@clinresearch.local'];
  const coResearcherId = linkedUsers['co.researcher.test@clinresearch.local'];
  const asstSupId = linkedUsers['assistant.supervisor.test@clinresearch.local'];
  const evaluatorId = linkedUsers['clinical.evaluator.test@clinresearch.local'];

  if (studentId) {
    const sampleStudies = [
      {
        title: 'DEMO: Clear Aligners vs Fixed Braces - Clinical Effectiveness RCT',
        description: 'A prospective randomized controlled clinical trial comparing the clinical effectiveness, treatment duration, and patient-reported outcomes of clear thermoplastic aligners versus conventional fixed orthodontic appliances in adolescent and adult patients with Class I and Class II malocclusion. Primary outcome: PAR score reduction. Secondary: treatment time, patient satisfaction, adverse events.',
        studyType: 'Randomized Controlled Trial (RCT) - Orthodontics',
        workflowType: 'supervised',
        status: 'approved',
        targetSampleSize: 60,
        enrolledPatients: 12,
        hasRandomization: true,
        hasBlinding: true,
        randomMethod: 'block',
        groups: ['Experimental - Clear Aligners', 'Control - Fixed Braces'],
        blindingConfig: {
          blindedParties: ['assessor', 'data_analyst'],
          scope: ['outcome_measurement', 'statistical_analysis'],
          hideMaterialsFromAssessor: true,
          studyTitle: 'Clear Aligners vs Fixed Braces RCT',
        },
        protocolFileName: 'DEMO_Orthodontics_Protocol_v2.3.pdf',
        ethicsApprovalNumber: 'IRB-ORT-2026-DEMO-0042',
        clinicalRegistrationNumber: 'PACTR-DEMO-20260715-001',
        coResearcherUserId: coResearcherId,
        supervisorUserId: supervisorId,
        assistantSupervisorUserId: asstSupId,
        clinicalEvaluatorUserId: evaluatorId,
        requiresClinicalEvaluation: true,
        clinicalEvalDecision: 'accepted',
        reviewDecision: 'approved',
        reviewNotes: 'Study design is scientifically sound. Sample size calculation based on PAR score difference of 5 (SD 8) with 80% power and alpha 0.05 confirms n=52 required. Approved with recommendation to include intention-to-treat analysis.',
        isLocked: true,
      },
      {
        title: 'Efficacy of New Drug X in Hypertension Management',
        description: 'Randomized controlled trial evaluating the efficacy and safety profile of Drug X in lowering systolic blood pressure over 12 weeks in adult patients with stage 1-2 essential hypertension.',
        studyType: 'Randomized Controlled Trial',
        workflowType: 'supervised',
        status: 'pending',
        targetSampleSize: 50,
        enrolledPatients: 22,
        hasRandomization: true,
        hasBlinding: true,
        randomMethod: 'simple',
        groups: ['Experimental: Drug X 50mg', 'Control: Placebo'],
        blindingConfig: {
          blindedParties: ['subject', 'assessor', 'data_analyst'],
          scope: ['treatment_allocation', 'outcome_measurement'],
          studyTitle: 'Drug X Hypertension Trial',
        },
        protocolFileName: 'drug-x-protocol-v1.pdf',
        ethicsApprovalNumber: 'IRB-HTN-2026-011',
        clinicalRegistrationNumber: 'NCT-HTN-2026-2001',
        coResearcherUserId: coResearcherId,
        supervisorUserId: supervisorId,
        assistantSupervisorUserId: asstSupId,
        clinicalEvaluatorUserId: evaluatorId,
        requiresClinicalEvaluation: true,
      },
      {
        title: 'Diabetes Type 2 Management Observational Cohort',
        description: 'Retrospective observational cohort study tracking glycemic outcomes (HbA1c trajectory) across 18 months in adult type 2 diabetes patients initiating second-line therapy in a university-affiliated outpatient clinic.',
        studyType: 'Retrospective Observational Study',
        workflowType: 'migration',
        status: 'active',
        targetSampleSize: 92,
        enrolledPatients: 92,
        hasRandomization: false,
        hasBlinding: false,
        groups: ['Metformin + SU', 'Metformin + DPP4i', 'Metformin + GLP1-RA'],
        blindingConfig: {},
        protocolFileName: 'diabetes-cohort-protocol.docx',
        ethicsApprovalNumber: 'IRB-DM-2026-021',
        clinicalRegistrationNumber: '',
        coResearcherUserId: coResearcherId,
        supervisorUserId: supervisorId,
        assistantSupervisorUserId: asstSupId,
        clinicalEvaluatorUserId: null,
        requiresClinicalEvaluation: false,
      },
    ];

    for (const study of sampleStudies) {
      const insertedStudy = await pool.query(
        `INSERT INTO studies (
          principal_investigator_id, title, description, study_type, workflow_type, status,
          target_sample_size, enrolled_patients, has_randomization, has_blinding, randomization_method,
          groups_json, blinding_config_json, protocol_file_name,
          ethics_approval_number, clinical_registration_number, co_researcher_user_id, supervisor_user_id,
          assistant_supervisor_user_id, assigned_clinical_evaluator_user_id,
          review_decision, review_notes, reviewed_at, reviewed_by_user_id,
          requires_clinical_evaluation, is_locked, locked_at, locked_by_user_id,
          clinical_evaluation_decision, clinical_evaluation_notes, clinical_evaluated_at, clinical_evaluated_by_user_id,
          submitted_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,NOW(),NOW())
         ON CONFLICT (principal_investigator_id, title) DO UPDATE SET
          description = EXCLUDED.description, study_type = EXCLUDED.study_type,
          workflow_type = EXCLUDED.workflow_type, status = EXCLUDED.status,
          target_sample_size = EXCLUDED.target_sample_size, enrolled_patients = EXCLUDED.enrolled_patients,
          has_randomization = EXCLUDED.has_randomization, has_blinding = EXCLUDED.has_blinding,
          randomization_method = EXCLUDED.randomization_method, groups_json = EXCLUDED.groups_json,
          blinding_config_json = EXCLUDED.blinding_config_json, protocol_file_name = EXCLUDED.protocol_file_name,
          ethics_approval_number = EXCLUDED.ethics_approval_number,
          clinical_registration_number = EXCLUDED.clinical_registration_number,
          co_researcher_user_id = EXCLUDED.co_researcher_user_id,
          supervisor_user_id = EXCLUDED.supervisor_user_id,
          assistant_supervisor_user_id = EXCLUDED.assistant_supervisor_user_id,
          assigned_clinical_evaluator_user_id = EXCLUDED.assigned_clinical_evaluator_user_id,
          review_decision = EXCLUDED.review_decision, review_notes = EXCLUDED.review_notes,
          reviewed_at = EXCLUDED.reviewed_at, reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
          requires_clinical_evaluation = EXCLUDED.requires_clinical_evaluation,
          is_locked = EXCLUDED.is_locked, locked_at = EXCLUDED.locked_at,
          locked_by_user_id = EXCLUDED.locked_by_user_id,
          clinical_evaluation_decision = EXCLUDED.clinical_evaluation_decision,
          clinical_evaluation_notes = EXCLUDED.clinical_evaluation_notes,
          clinical_evaluated_at = EXCLUDED.clinical_evaluated_at,
          clinical_evaluated_by_user_id = EXCLUDED.clinical_evaluated_by_user_id,
          updated_at = NOW()
         RETURNING id, title`,
        [
          studentId, study.title, study.description, study.studyType, study.workflowType, study.status,
          study.targetSampleSize, study.enrolledPatients, study.hasRandomization, study.hasBlinding,
          study.hasRandomization ? study.randomMethod ?? 'simple' : null,
          JSON.stringify(study.groups), JSON.stringify(study.blindingConfig || {}),
          study.protocolFileName, study.ethicsApprovalNumber, study.clinicalRegistrationNumber || null,
          study.coResearcherUserId ?? null, study.supervisorUserId ?? null,
          study.assistantSupervisorUserId ?? null, study.clinicalEvaluatorUserId ?? null,
          study.reviewDecision ?? null, study.reviewNotes ?? null,
          study.reviewDecision ? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString() : null,
          study.reviewDecision ? study.supervisorUserId ?? null : null,
          study.requiresClinicalEvaluation,
          study.isLocked ?? false,
          study.isLocked ? new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() : null,
          study.isLocked ? study.clinicalEvaluatorUserId ?? null : null,
          study.clinicalEvalDecision ?? (study.requiresClinicalEvaluation ? 'pending' : null),
          study.clinicalEvalDecision ? 'All study documents reviewed. Methodology acceptable. Confirmed 12 baseline samples are valid and complete. Proceed with active data collection phase.' : null,
          study.clinicalEvalDecision ? new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString() : null,
          study.clinicalEvalDecision ? study.clinicalEvaluatorUserId ?? null : null,
        ],
      );

      if (study.title.startsWith('DEMO:')) {
        const demoStudyId = insertedStudy.rows[0].id;
        console.log(`Created DEMO Study #${demoStudyId}: ${insertedStudy.rows[0].title}`);

        // 2) Approved CRF Template
        const templateInserted = await pool.query(
          `INSERT INTO study_outcome_assessment_template_versions (
            study_id, version_number, created_by_user_id, approval_status, template_json,
            change_notes, approved_by_user_id, approved_at, updated_at
          ) VALUES ($1, 1, $2, 'approved', $3::jsonb, $4, $5, NOW(), NOW())
           ON CONFLICT (study_id, version_number) DO UPDATE SET
            template_json = EXCLUDED.template_json, change_notes = EXCLUDED.change_notes,
            approved_by_user_id = EXCLUDED.approved_by_user_id, approved_at = NOW(), updated_at = NOW()
           RETURNING id`,
          [
            demoStudyId, studentId, JSON.stringify(DEMO_CRFTEMPLATE),
            'Initial validated CRF template v1.0 — Covers all CONSORT endpoints for orthodontic RCT. 28 fields across 8 sections aligned with ABO grading standards.',
            supervisorId,
          ],
        );
        const templateVersionId = templateInserted.rows[0].id;
        console.log(`  Approved CRF template version #1 created (id=${templateVersionId}) with ${DEMO_CRFTEMPLATE.length} fields.`);

        // 3) Study file metadata records
        const demoFiles = [
          { name: 'DEMO_Orthodontics_Protocol_v2.3.pdf', stored: 'demo_protocol_v2.3.pdf', rel: 'uploads/studies/demo/demo_protocol_v2.3.pdf', mime: 'application/pdf', size: 2458000, category: 'protocol' },
          { name: 'DEMO_Consent_Form_Arabic_v1.pdf', stored: 'demo_consent_ar.pdf', rel: 'uploads/studies/demo/demo_consent_ar.pdf', mime: 'application/pdf', size: 890000, category: 'attachment' },
          { name: 'DEMO_Sample_Size_Calculation.xlsx', stored: 'demo_sample_size.xlsx', rel: 'uploads/studies/demo/demo_sample_size.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 128000, category: 'report' },
          { name: 'DEMO_Randomization_List_Blocked_1to1.csv', stored: 'demo_randomization.csv', rel: 'uploads/studies/demo/demo_randomization.csv', mime: 'text/csv', size: 8200, category: 'dataset' },
        ];
        const fileIds = [];
        for (const f of demoFiles) {
          const ins = await pool.query(
            `INSERT INTO study_files (study_id, uploaded_by_user_id, original_name, stored_name, relative_path, mime_type, size_bytes, file_category, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT DO NOTHING RETURNING id`,
            [demoStudyId, studentId, f.name, f.stored, f.rel, f.mime, f.size, f.category],
          );
          if (ins.rows[0]?.id) fileIds.push(ins.rows[0].id);
        }
        console.log(`  Study file metadata records created (${fileIds.length} files).`);

        // 4) Samples
        for (const s of DEMO_SAMPLES) {
          const sampleInserted = await pool.query(
            `INSERT INTO study_outcome_assessment_samples (
              study_id, subject_id, visit_number, inclusion_eligible, allocated_group, masked_group_code,
              sample_status, updated_at
            ) VALUES ($1,$2,$3,TRUE,$4,$5,$6,NOW())
             ON CONFLICT (study_id, subject_id, visit_number) DO UPDATE SET
              inclusion_eligible = EXCLUDED.inclusion_eligible,
              allocated_group = EXCLUDED.allocated_group,
              masked_group_code = EXCLUDED.masked_group_code,
              sample_status = EXCLUDED.sample_status,
              updated_at = NOW()
             RETURNING id, sample_status`,
            [
              demoStudyId, s.subject, s.visit, s.group, s.mask,
              s.visit === 'Visit 1 - Baseline' ? 'pending' : s.visit === 'Visit 2 - Mid-Treatment' ? 'in_progress' : 'submitted',
            ],
          );
          const sampleId = sampleInserted.rows[0].id;

          // Link a couple of demo file assets to the first 3 submitted samples
          if (s.visit === 'Visit 3 - Debond' && fileIds.length > 0 && ['PT-001','PT-002','PT-003'].includes(s.subject)) {
            for (const [idx, assetType] of ['photo_before','photo_after','xray_before'].entries()) {
              const fileIdToLink = fileIds[idx % fileIds.length];
              await pool.query(
                `INSERT INTO study_outcome_assessment_sample_files (sample_id, file_id, asset_type, created_at)
                 VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING`,
                [sampleId, fileIdToLink, assetType],
              );
            }
          }
        }
        console.log(`  ${DEMO_SAMPLES.length} patient assessment samples upserted with randomization.`);

        // 5) Assessment request (accepted, active)
        const deadline = new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString();
        const requestInserted = await pool.query(
          `INSERT INTO study_outcome_assessment_requests (
            study_id, assessor_user_id, requested_by_user_id, request_status, assessment_type,
            deadline_at, samples_required, optional_message, accepted_at, updated_at
          ) VALUES ($1,$2,$3,'active','Blinded Outcome Assessment - Orthodontic RCT',$4,$5,
            'Dear Dr. Mona, please perform blinded standardized outcome assessment on the submitted samples. PAR scoring, ABO grading and adverse event reporting required. Thank you.',
            NOW() - INTERVAL \'2 days\', NOW())
           ON CONFLICT (study_id, assessor_user_id) DO UPDATE SET
            request_status = 'active', assessment_type = EXCLUDED.assessment_type,
            deadline_at = EXCLUDED.deadline_at, samples_required = EXCLUDED.samples_required,
            optional_message = EXCLUDED.optional_message, accepted_at = NOW(), updated_at = NOW()
           RETURNING id`,
          [demoStudyId, evaluatorId, studentId, deadline, 12],
        );
        const requestId = requestInserted.rows[0].id;
        console.log(`  Accepted assessment request created (id=${requestId}).`);

        // 6) Entries/responses for submitted and in-progress samples
        for (const s of DEMO_SAMPLES) {
          if (s.visit === 'Visit 1 - Baseline') continue;
          const sampleIdRow = await pool.query(
            `SELECT id FROM study_outcome_assessment_samples WHERE study_id = $1 AND subject_id = $2 AND visit_number = $3 LIMIT 1`,
            [demoStudyId, s.subject, s.visit],
          );
          const sampleId = sampleIdRow.rows[0]?.id;
          if (!sampleId) continue;

          const resp = {
            demo_patient_code: s.subject,
            demo_visit_number: s.visit,
            demo_visit_date: new Date(Date.now() - Math.random() * 60 * 24 * 3600 * 1000).toISOString().slice(0, 10),
            demo_age: s.age,
            demo_gender: s.gender,
            demo_skeletal_class: s.group.includes('Experimental') ? 'Class I' : 'Class II Division 1',
            demo_angels_class: s.group.includes('Experimental') ? 'Class I' : 'Class II Division 1',
            demo_crowding_upper: s.crowdingUpPre,
            demo_crowding_lower: s.crowdingLowPre,
            demo_overjet_pre: s.overjetPre,
            demo_overjet_post: s.overjetPost,
            demo_overbite_pre: s.overbitePre,
            demo_overbite_post: s.overbitePost,
            demo_midline_deviation: (Math.random() * 3).toFixed(1),
            demo_par_score_pre: s.parPre,
            demo_par_score_post: s.parPost,
            demo_alignment_post: s.alignment,
            demo_root_resorption: s.rootRes,
            demo_periodontal_status: s.periodontal,
            demo_patient_satisfaction: s.satisfaction,
            demo_pain_level: s.satisfaction >= 8 ? 'Mild' : s.satisfaction >= 5 ? 'Moderate' : 'Severe',
            demo_treatment_duration: s.duration,
            demo_extractions_done: ['PT-001','PT-003','PT-008'].includes(s.subject),
            demo_retention_type: s.subject.includes('001') || s.subject.includes('005') || s.subject.includes('011') ? 'Vacuum Formed Essix' : 'Hawley',
            demo_complications: s.success === 'Borderline' ? 'Mild relapse tendency in lower anterior region during final week' : s.success === 'Failure' ? 'Patient dropped from study' : '',
            demo_overall_success: s.success,
            demo_grading_abr: s.parPost * 0.8 + Math.random() * 3,
            demo_assessor_comments: s.success === 'Excellent' ? 'Excellent case finishing. All objectives met. PAR reduction >70%. ABO within excellence range.' : s.success === 'Acceptable' ? 'Clinically acceptable result with minor refinements possible. PAR reduction adequate.' : s.success === 'Borderline' ? 'Borderline result; consider additional refinement or retention protocol.' : '',
          };
          const isSubmitted = s.visit === 'Visit 3 - Debond' || s.visit === 'Visit 4 - Retention 6M';
          const entryStatus = isSubmitted ? 'locked' : 'in_progress';

          await pool.query(
            `INSERT INTO study_outcome_assessment_entries (
              request_id, sample_id, assessor_user_id, template_version_id, response_json,
              status, assessor_comments, submitted_at, locked_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,NOW())
             ON CONFLICT (request_id, sample_id) DO UPDATE SET
              response_json = EXCLUDED.response_json, status = EXCLUDED.status,
              assessor_comments = EXCLUDED.assessor_comments,
              submitted_at = EXCLUDED.submitted_at, locked_at = EXCLUDED.locked_at,
              updated_at = NOW()`,
            [
              requestId, sampleId, evaluatorId, templateVersionId,
              JSON.stringify(resp), entryStatus,
              resp.demo_assessor_comments || null,
              isSubmitted ? new Date(Date.now() - Math.random() * 5 * 24 * 3600 * 1000).toISOString() : null,
              isSubmitted ? new Date(Date.now() - Math.random() * 2 * 24 * 3600 * 1000).toISOString() : null,
            ],
          );
        }
        console.log(`  Assessment entries (responses) populated for active visits.`);

        // 7) Notes
        await pool.query(
          `INSERT INTO study_outcome_assessment_notes (request_id, sample_id, author_user_id, recipient_scope, message, created_at)
           VALUES ($1, NULL, $2, 'research_team', $3, NOW())
           ON CONFLICT DO NOTHING`,
          [
            requestId, studentId,
            'مهم للغاية: تأكدوا من تسجيل درجات ABO بشكل موحد وفقاً لأحدث طبعة. أي اختلاف في الطريقة سيؤثر على مصداقية التحليل الإحصائي النهائي.',
          ],
        );
        console.log(`  Team communication notes added. DEMO Study setup complete.`);
      }
    }
    console.log('Sample studies seeded.');
  }

  // Also write everything to local JSON fallback files for dev mode
  const dataDir = path.resolve(process.cwd(), 'data');
  await mkdir(dataDir, { recursive: true });

  const allUsersResult = await pool.query('SELECT * FROM users ORDER BY id ASC');
  const localUsers = allUsersResult.rows.map((u) => ({
    id: String(u.id),
    email: u.email,
    password: u.password,
    fullName: u.full_name,
    accountType: u.account_type,
    phone: u.phone ?? undefined,
    dateOfBirth: u.date_of_birth ? new Date(u.date_of_birth).toISOString() : undefined,
    country: u.country ?? undefined,
    governorate: u.governorate ?? undefined,
    emailType: u.email_type ?? undefined,
    university: u.university ?? undefined,
    college: u.college ?? undefined,
    institutionType: u.institution_type ?? undefined,
    specialization: u.specialization ?? undefined,
    academicLevel: u.academic_level ?? undefined,
    academicId: u.academic_id ?? undefined,
    academicRank: u.academic_rank ?? undefined,
    supervisorId: u.supervisor_id ?? undefined,
    authorizedContactName: u.authorized_contact_name ?? undefined,
    jobTitle: u.job_title ?? undefined,
    directContactNumber: u.direct_contact_number ?? undefined,
    isVerified: u.is_verified,
    isActive: u.is_active,
    trialEndsAt: u.trial_ends_at ? new Date(u.trial_ends_at).toISOString() : undefined,
    subscription:
      u.subscription_plan && u.subscription_status
        ? {
            plan: u.subscription_plan,
            status: u.subscription_status,
            expiresAt: u.subscription_expires_at ? new Date(u.subscription_expires_at).toISOString() : undefined,
          }
        : undefined,
  }));
  await writeFile(path.join(dataDir, 'dev-users.json'), JSON.stringify(localUsers, null, 2), 'utf8');
  console.log(`Local dev-users.json synced (${localUsers.length} accounts).`);

  const allStudiesResult = await pool.query(
    `SELECT id, principal_investigator_id, title, description, study_type, workflow_type, status,
            target_sample_size, enrolled_patients, has_randomization, has_blinding,
            randomization_method, groups_json, blinding_config_json, protocol_file_name,
            ethics_approval_number, clinical_registration_number,
            co_researcher_user_id, supervisor_user_id, assistant_supervisor_user_id,
            assigned_clinical_evaluator_user_id,
            review_decision, review_notes, reviewed_at,
            requires_clinical_evaluation, is_locked, locked_at,
            clinical_evaluation_decision, clinical_evaluation_notes, clinical_evaluated_at,
            submitted_at, created_at, updated_at
     FROM studies ORDER BY id ASC`,
  );
  const localStudies = allStudiesResult.rows.map((row) => ({
    id: String(row.id),
    principalInvestigatorId: String(row.principal_investigator_id),
    title: row.title,
    description: row.description ?? undefined,
    studyType: row.study_type,
    workflowType: row.workflow_type,
    status: row.status,
    targetSampleSize: Number(row.target_sample_size),
    enrolledPatients: Number(row.enrolled_patients),
    hasRandomization: row.has_randomization,
    hasBlinding: row.has_blinding,
    randomizationMethod: row.randomization_method ?? undefined,
    groups: Array.isArray(row.groups_json) ? row.groups_json : ['Experimental', 'Control'],
    blindingSettings:
      row.has_blinding && typeof row.blinding_config_json === 'object'
        ? {
            blindedParties: row.blinding_config_json.blindedParties ?? [],
            scope: row.blinding_config_json.scope ?? [],
            targetVariables: row.blinding_config_json.targetVariables ?? [],
            blindingType:
              (row.blinding_config_json.blindedParties ?? []).length === 0
                ? 'open-label'
                : (row.blinding_config_json.blindedParties ?? []).length >= 3
                  ? 'triple'
                  : (row.blinding_config_json.blindedParties ?? []).length >= 2
                    ? 'double'
                    : 'single',
            protocolText:
              row.blinding_config_json.protocolText ??
              `Blinding configured for study: ${row.title}`,
            permissions: {
              hideMaterialsFromAssessor:
                row.blinding_config_json.hideMaterialsFromAssessor ?? false,
              maskGroupsForStatistician:
                row.blinding_config_json.maskGroupsForStatistician ?? false,
            },
          }
        : undefined,
    protocolFileName: row.protocol_file_name ?? undefined,
    ethicsApprovalNumber: row.ethics_approval_number ?? undefined,
    clinicalRegistrationNumber: row.clinical_registration_number ?? undefined,
    coResearcherUserId: row.co_researcher_user_id ? String(row.co_researcher_user_id) : undefined,
    supervisorUserId: row.supervisor_user_id ? String(row.supervisor_user_id) : undefined,
    assistantSupervisorUserId: row.assistant_supervisor_user_id
      ? String(row.assistant_supervisor_user_id)
      : undefined,
    assignedClinicalEvaluatorUserId: row.assigned_clinical_evaluator_user_id
      ? String(row.assigned_clinical_evaluator_user_id)
      : undefined,
    reviewDecision: row.review_decision ?? undefined,
    reviewNotes: row.review_notes ?? undefined,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : undefined,
    requiresClinicalEvaluation: row.requires_clinical_evaluation,
    isLocked: row.is_locked,
    lockedAt: row.locked_at ? new Date(row.locked_at).toISOString() : undefined,
    lockedByUserId: row.locked_by_user_id ? String(row.locked_by_user_id) : undefined,
    clinicalEvaluationDecision: row.clinical_evaluation_decision ?? undefined,
    clinicalEvaluationNotes: row.clinical_evaluation_notes ?? undefined,
    clinicalEvaluatedAt: row.clinical_evaluated_at ? new Date(row.clinical_evaluated_at).toISOString() : undefined,
    submittedAt: new Date(row.submitted_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
  await writeFile(path.join(dataDir, 'dev-studies.json'), JSON.stringify(localStudies, null, 2), 'utf8');
  console.log(`Local dev-studies.json synced (${localStudies.length} studies).`);

  await pool.end();

  console.log('\n========================================');
  console.log('Seeding completed successfully. ✅');
  console.log(`Password for all accounts: ${plainPassword}`);
  console.log('----------------------------------------');
  console.log('👤 Test Accounts:');
  console.log('  🎓 student.test@clinresearch.local  (طالب - يمتلك دراسة DEMO كاملة)');
  console.log('  👥 co.researcher.test@clinresearch.local  (باحث مشارك)');
  console.log('  👔 supervisor.test@clinresearch.local  (مشرف رئيسي)');
  console.log('  👔 assistant.supervisor.test@clinresearch.local  (مشرف مساعد)');
  console.log('  ⚕️  clinical.evaluator.test@clinresearch.local  (مقيم سريري - طلب DEMO مقبول ومفعل)');
  console.log('  🏢 institution.test@clinresearch.local  (مؤسسة بحثية)');
  console.log('----------------------------------------');
  console.log('📚 DEMO Study Included:');
  console.log('  • 1 دراسة DEMO كاملة من نوع RCT في تقويم الأسنان');
  console.log('  • نموذج CRF معتمد (28 حقلًا × 8 أقسام)');
  console.log('  • 12 عينة مريض مع توزيع عشوائي متوازن (مجموعتين 1:1)');
  console.log('  • طلب تقييم سريري مقبول ومدخلات جزئية');
  console.log('  • ملفات الدراسة + بروتوكول + موافقة أخلاقية');
  console.log('  • 2 دراسات إضافية للتجربة');
  console.log('========================================\n');
} catch (error) {
  console.error('❌ Failed to seed test accounts + DEMO study:', error);
  process.exitCode = 1;
}
