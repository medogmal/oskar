import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bot,
  Building2,
  ClipboardCheck,
  Download,
  Eye,
  EyeOff,
  FileSignature,
  FileText,
  LoaderCircle,
  LogOut,
  Plus,
  Route,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import OutcomeAssessmentManager from '../components/OutcomeAssessmentManager';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';
import { useAuth } from '../context/useAuth';
import { clearAutofillSnapshot, loadAutofillSnapshot } from '../lib/aiAutofill';
import { apiBaseUrl, type AccountType } from '../lib/auth';
import { CREATE_STUDY_TYPE_OPTIONS, getStudyTypeInfo } from '../lib/studyTypes';


type RandomizationMethod = 'simple' | 'block';
type BlindedParty = 'participant' | 'patient' | 'researcher' | 'supervisor' | 'assessor' | 'statistician';
type BlindingScope = 'material_type' | 'treatment_procedure' | 'split_mouth_side';
type BlindingType = 'open-label' | 'single-blind' | 'double-blind' | 'triple-blind' | 'quadruple-blind';

type BlindingSettings = {
  blindedParties: BlindedParty[];
  scope: BlindingScope[];
  targetVariables?: string[];
  blindingType: BlindingType;
  protocolText?: string;
  permissions: {
    hideMaterialsFromAssessor: boolean;
    maskGroupsForStatistician: boolean;
  };
};

type Study = {
  id: string;
  title: string;
  description?: string;
  principalInvestigatorName?: string;
  coResearcherUserId?: string;
  coResearcherName?: string;
  coResearcherAcademicId?: string;
  supervisorUserId?: string;
  supervisorName?: string;
  supervisorAcademicId?: string;
  assistantSupervisorUserId?: string;
  assistantSupervisorName?: string;
  assistantSupervisorAcademicId?: string;
  assignedClinicalEvaluatorUserId?: string;
  assignedClinicalEvaluatorName?: string;
  assignedClinicalEvaluatorAcademicId?: string;
  studyType: string;
  workflowType: 'supervised' | 'migration';
  status: 'draft' | 'pending' | 'approved' | 'active' | 'completed' | 'cancelled';
  targetSampleSize: number;
  enrolledPatients: number;
  hasRandomization: boolean;
  hasBlinding: boolean;
  randomizationMethod?: RandomizationMethod;
  groups: string[];
  blindingSettings?: BlindingSettings;
  protocolFileName?: string;
  ethicsApprovalNumber?: string;
  clinicalRegistrationNumber?: string;
  reviewDecision?: 'approved' | 'changes_requested' | 'rejected';
  reviewNotes?: string;
  reviewedAt?: string;
  reviewedByName?: string;
  requiresClinicalEvaluation: boolean;
  isLocked?: boolean;
  lockedAt?: string;
  lockedByName?: string;
  clinicalEvaluationDecision?: 'pending' | 'accepted' | 'needs_revision' | 'not_recommended';
  clinicalEvaluationNotes?: string;
  clinicalEvaluatedAt?: string;
  clinicalEvaluatedByName?: string;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
};

type RoleDirectoryEntry = {
  id: string;
  fullName: string;
  email: string;
  accountType: AccountType;
  academicId?: string;
  academicRank?: string;
};

type StudyResourceFile = {
  id: string;
  originalName: string;
  fileCategory: 'protocol' | 'dataset' | 'image' | 'attachment' | 'report';
  createdAt: string;
};

type StudyResourceAnalysis = {
  id: string;
  title: string;
  analysisType?: string;
  createdAt: string;
  reportRelativePath?: string;
};

type StudyResources = {
  files: StudyResourceFile[];
  analyses: StudyResourceAnalysis[];
};

type CreateStudyForm = {
  title: string;
  studyType: string;
  workflowType: 'supervised' | 'migration';
  targetSampleSize: string;
  ethicsApprovalNumber: string;
  clinicalRegistrationNumber: string;
  supervisorUserId: string;
  hasRandomization: boolean;
  hasBlinding: boolean;
  randomizationMethod: RandomizationMethod;
  groupsInput: string;
  blindedParties: BlindedParty[];
  blindingScope: BlindingScope[];
  blindingTargetVariablesInput: string;
  blindingProtocolText: string;
  requiresClinicalEvaluation: boolean;
};

const initialFormState: CreateStudyForm = {
  title: '',
  studyType: 'rct',
  workflowType: 'supervised',

  targetSampleSize: '',
  ethicsApprovalNumber: '',
  clinicalRegistrationNumber: '',
  supervisorUserId: '',
  hasRandomization: false,
  hasBlinding: false,
  randomizationMethod: 'simple',
  groupsInput: 'Experimental, Control',
  blindedParties: [],
  blindingScope: [],
  blindingTargetVariablesInput: 'Treatment group, intervention type',
  blindingProtocolText: '',
  requiresClinicalEvaluation: false,
};

type StudyDesignForm = {
  hasRandomization: boolean;
  randomizationMethod: RandomizationMethod;
  groupsInput: string;
  hasBlinding: boolean;
  blindedParties: BlindedParty[];
  blindingScope: BlindingScope[];
  blindingTargetVariablesInput: string;
  blindingProtocolText: string;
  coResearcherUserId: string;
  assistantSupervisorUserId: string;
  clinicalEvaluatorUserId: string;
  requiresClinicalEvaluation: boolean;
};

const normalizeGroups = (value: string) =>
  Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const normalizeTargetVariables = (value: string) =>
  Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const normalizeBlindedParties = (parties: BlindedParty[]) =>
  Array.from(new Set(parties.map((party) => (party === 'patient' ? 'participant' : party)))) as BlindedParty[];

const inferBlindingType = (parties: BlindedParty[]): BlindingType => {
  const sorted = ['participant', 'researcher', 'supervisor', 'assessor', 'statistician'].filter((party) =>
    normalizeBlindedParties(parties).includes(party as BlindedParty),
  ) as BlindedParty[];

  if (sorted.length === 0) {
    return 'open-label';
  }

  if (sorted.length === 1) {
    return 'single-blind';
  }

  if (sorted.length === 2) {
    return 'double-blind';
  }

  if (sorted.length === 3) {
    return 'triple-blind';
  }

  return sorted.length >= 4 ? 'quadruple-blind' : 'double-blind';
};

const getMaskedGroupCode = (index: number) => `Treatment_${String.fromCharCode(65 + index)}`;

const generateBlindingProtocolText = (input: {
  studyTitle?: string;
  groupsInput: string;
  blindedParties: BlindedParty[];
  blindingScope: BlindingScope[];
  blindingTargetVariablesInput: string;
}) => {
  const groups = normalizeGroups(input.groupsInput);
  const normalizedGroups = groups.length > 0 ? groups : ['Experimental', 'Control'];
  const normalizedParties = normalizeBlindedParties(input.blindedParties);
  const targetVariables = normalizeTargetVariables(input.blindingTargetVariablesInput);
  const blindingType = inferBlindingType(normalizedParties);
  const blindedPartyNarratives: Record<BlindedParty, string> = {
    participant: 'the participant throughout the intervention period',
    patient: 'the participant throughout the intervention period',
    researcher: 'the treating researcher or operator during intervention delivery',
    supervisor: 'the academic supervisor during oversight and review',
    assessor: 'the external outcome assessor during evaluation',
    statistician: 'the statistician during the final analysis stage',
  };
  const scopeNarratives: Record<BlindingScope, string> = {
    material_type: 'the identity of the study material',
    treatment_procedure: 'the treatment or intervention allocation',
    split_mouth_side: 'the treated side in split-mouth allocation',
  };
  const blindedPartyText =
    normalizedParties.length > 0
      ? normalizedParties.map((party) => blindedPartyNarratives[party]).join(', ')
      : 'no trial party';
  const scopeText =
    input.blindingScope.length > 0
      ? input.blindingScope.map((item) => scopeNarratives[item]).join(', ')
      : 'the intervention identity';
  const targetVariableText = targetVariables.length > 0 ? targetVariables.join(', ') : 'group allocation and intervention identity';
  const concealmentText = normalizedGroups
    .map((group, index) => `${group} was coded as ${getMaskedGroupCode(index)}`)
    .join('; ');

  return [
    `Blinding procedures were predefined for the study "${input.studyTitle?.trim() || 'the study'}" as a ${blindingType} design.`,
    `The blinded parties included ${blindedPartyText}.`,
    `Blinding was applied to ${scopeText}.`,
    `The blinded variables included ${targetVariableText}.`,
    `Allocation concealment was maintained by using coded study labels, where ${concealmentText}.`,
    'The randomization list and treatment code key were stored separately from the clinical assessment workflow and were not available to blinded personnel.',
    'Outcome assessors accessed a restricted interface that omitted intervention-identifying material fields whenever assessor blinding was enabled.',
    'For statistical analysis, masked group codes were preserved until the analysis dataset was finalized when statistician blinding was requested.',
  ].join(' ');
};

const applyStudyTypePreset = (
  nextStudyType: string,
): Pick<
  CreateStudyForm,
  'studyType' | 'hasRandomization' | 'hasBlinding' | 'groupsInput' | 'blindedParties' | 'blindingScope' | 'blindingTargetVariablesInput'
> => {
  const info = getStudyTypeInfo(nextStudyType);
  if (info.id === 'rct') {
    return {
      studyType: nextStudyType,
      hasRandomization: true,
      hasBlinding: true,
      groupsInput: info.defaultGroups.join(', '),
      blindedParties: ['participant', 'assessor'] as BlindedParty[],
      blindingScope: ['treatment_procedure'] as BlindingScope[],
      blindingTargetVariablesInput: 'Treatment group, intervention type',
    };
  }
  if (info.id === 'prospective') {
    return {
      studyType: nextStudyType,
      hasRandomization: false,
      hasBlinding: false,
      groupsInput: info.defaultGroups.join(', '),
      blindedParties: [] as BlindedParty[],
      blindingScope: [] as BlindingScope[],
      blindingTargetVariablesInput: 'Exposure status, follow-up code',
    };
  }
  if (info.id === 'retrospective') {
    return {
      studyType: nextStudyType,
      hasRandomization: false,
      hasBlinding: false,
      groupsInput: info.defaultGroups.join(', '),
      blindedParties: [] as BlindedParty[],
      blindingScope: [] as BlindingScope[],
      blindingTargetVariablesInput: 'Historical treatment code',
    };
  }
  return {
    studyType: nextStudyType,
    hasRandomization: false,
    hasBlinding: false,
    groupsInput: info.defaultGroups.join(', '),
    blindedParties: [] as BlindedParty[],
    blindingScope: [] as BlindingScope[],
    blindingTargetVariablesInput: 'Questionnaire version, examiner code',
  };
};

function Studies() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, signOut, token } = useAuth();
  const { t, i18n } = useTranslation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDesignModal, setShowDesignModal] = useState(false);
  const [studies, setStudies] = useState<Study[]>([]);
  const [selectedStudy, setSelectedStudy] = useState<Study | null>(null);
  const [formState, setFormState] = useState<CreateStudyForm>(initialFormState);
  const [designForm, setDesignForm] = useState<StudyDesignForm>({
    hasRandomization: false,
    randomizationMethod: 'simple',
    groupsInput: 'Experimental, Control',
    hasBlinding: false,
    blindedParties: [],
    blindingScope: [],
    blindingTargetVariablesInput: 'Treatment group, intervention type',
    blindingProtocolText: '',
    coResearcherUserId: '',
    assistantSupervisorUserId: '',
    clinicalEvaluatorUserId: '',
    requiresClinicalEvaluation: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResubmittingId, setIsResubmittingId] = useState<string | null>(null);
  const [isLoadingResources, setIsLoadingResources] = useState(false);
  const [activeDownloadKey, setActiveDownloadKey] = useState<string | null>(null);
  const [studyResources, setStudyResources] = useState<StudyResources | null>(null);
  const [roleDirectory, setRoleDirectory] = useState<RoleDirectoryEntry[]>([]);
  const [error, setError] = useState('');
  const [researchProposalFile, setResearchProposalFile] = useState<File | null>(null);
  const [protocolFile, setProtocolFile] = useState<File | null>(null);
  const [autofillNotice, setAutofillNotice] = useState('');

  const coResearchers = roleDirectory.filter((entry) => entry.accountType === 'co_researcher');
  const supervisors = roleDirectory.filter((entry) => entry.accountType === 'supervisor');
  const assistantSupervisors = roleDirectory.filter((entry) => entry.accountType === 'assistant_supervisor');
  const clinicalEvaluators = roleDirectory.filter((entry) => entry.accountType === 'clinical_evaluator');
  const selectedStudyTypeInfo = getStudyTypeInfo(formState.studyType);

  const replaceStudy = useCallback((nextStudy: Study) => {
    setStudies((prev) => prev.map((study) => (study.id === nextStudy.id ? nextStudy : study)));
    setSelectedStudy((prev) => (prev?.id === nextStudy.id ? nextStudy : prev));
  }, []);

  const fetchStudies = useCallback(async () => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    try {
      setError('');
      const response = await fetch(`${apiBaseUrl}/studies`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to fetch studies');
      }

      const data = (await response.json()) as Study[];
      setStudies(data);
    } catch {
      setError(t('studies.messages.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [t, token]);

  useEffect(() => {
    void fetchStudies();
  }, [fetchStudies]);

  useEffect(() => {
    if (searchParams.get('create') !== '1') {
      return;
    }

    const workflow = searchParams.get('workflow');
    if (workflow === 'migration' || workflow === 'supervised') {
      setFormState((prev) => ({
        ...prev,
        workflowType: workflow,
      }));
    }

    setShowCreateModal(true);
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get('autofill') !== '1') {
      return;
    }

    const snapshot = loadAutofillSnapshot();
    if (!snapshot) {
      return;
    }

    setFormState((prev) => ({
      ...prev,
      title: snapshot.studyTitle || prev.title,
      ...applyStudyTypePreset(snapshot.studyTypeGuess || prev.studyType),
      targetSampleSize:
        typeof snapshot.suggestedSampleSize === 'number' && snapshot.suggestedSampleSize > 0
          ? String(snapshot.suggestedSampleSize)
          : prev.targetSampleSize,
      groupsInput: snapshot.studyGroups?.length ? snapshot.studyGroups.join(', ') : prev.groupsInput,
      blindingProtocolText: snapshot.blindingProtocolText || prev.blindingProtocolText,
    }));
    setAutofillNotice(
      `تم تطبيق بيانات مقترحة من المساعد الذكي${snapshot.sourceLabel ? ` من الملف ${snapshot.sourceLabel}` : ''} على نموذج إنشاء الدراسة.`,
    );
    clearAutofillSnapshot();

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('autofill');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const fetchRoleDirectory = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const response = await fetch(
        `${apiBaseUrl}/auth/directory?accountTypes=co_researcher,supervisor,assistant_supervisor,clinical_evaluator`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error('Unable to load role directory');
      }

      const data = (await response.json()) as RoleDirectoryEntry[];
      setRoleDirectory(data);
    } catch {
      setRoleDirectory([]);
    }
  }, [token]);

  useEffect(() => {
    void fetchRoleDirectory();
  }, [fetchRoleDirectory]);

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  const handleChange = <K extends keyof CreateStudyForm>(field: K, value: CreateStudyForm[K]) => {
    if (field === 'studyType' && typeof value === 'string') {
      const preset = applyStudyTypePreset(value);
      setFormState((prev) => ({
        ...prev,
        ...preset,
        blindingProtocolText: preset.hasBlinding
          ? generateBlindingProtocolText({
              studyTitle: prev.title,
              groupsInput: preset.groupsInput,
              blindedParties: preset.blindedParties,
              blindingScope: preset.blindingScope,
              blindingTargetVariablesInput: preset.blindingTargetVariablesInput,
            })
          : '',
      }));
      return;
    }

    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const updateDesignForm = <K extends keyof StudyDesignForm>(field: K, value: StudyDesignForm[K]) => {
    setDesignForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const toggleChoice = <T extends string>(values: T[], value: T) =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  const toggleCreateBlindedParty = (value: BlindedParty) => {
    setFormState((prev) => ({
      ...prev,
      blindedParties: toggleChoice(prev.blindedParties, value),
    }));
  };

  const toggleCreateBlindingScope = (value: BlindingScope) => {
    setFormState((prev) => ({
      ...prev,
      blindingScope: toggleChoice(prev.blindingScope, value),
    }));
  };

  const toggleDesignBlindedParty = (value: BlindedParty) => {
    setDesignForm((prev) => ({
      ...prev,
      blindedParties: toggleChoice(prev.blindedParties, value),
    }));
  };

  const toggleDesignBlindingScope = (value: BlindingScope) => {
    setDesignForm((prev) => ({
      ...prev,
      blindingScope: toggleChoice(prev.blindingScope, value),
    }));
  };

  const generateCreateBlindingProtocol = () => {
    handleChange(
      'blindingProtocolText',
      generateBlindingProtocolText({
        studyTitle: formState.title,
        groupsInput: formState.groupsInput,
        blindedParties: formState.blindedParties,
        blindingScope: formState.blindingScope,
        blindingTargetVariablesInput: formState.blindingTargetVariablesInput,
      }),
    );
  };

  const generateDesignBlindingProtocol = () => {
    updateDesignForm(
      'blindingProtocolText',
      generateBlindingProtocolText({
        studyTitle: selectedStudy?.title,
        groupsInput: designForm.groupsInput,
        blindedParties: designForm.blindedParties,
        blindingScope: designForm.blindingScope,
        blindingTargetVariablesInput: designForm.blindingTargetVariablesInput,
      }),
    );
  };

  const openDesignSettings = (study: Study) => {
    setSelectedStudy(study);
    setDesignForm({
      hasRandomization: study.hasRandomization,
      randomizationMethod: study.randomizationMethod ?? 'simple',
      groupsInput: (study.groups?.length ? study.groups : ['Experimental', 'Control']).join(', '),
      hasBlinding: study.hasBlinding,
      blindedParties: normalizeBlindedParties(study.blindingSettings?.blindedParties ?? []),
      blindingScope: study.blindingSettings?.scope ?? [],
      blindingTargetVariablesInput: (study.blindingSettings?.targetVariables ?? []).join(', '),
      blindingProtocolText: study.blindingSettings?.protocolText ?? '',
      coResearcherUserId: study.coResearcherUserId ?? '',
      assistantSupervisorUserId: study.assistantSupervisorUserId ?? '',
      clinicalEvaluatorUserId: study.assignedClinicalEvaluatorUserId ?? '',
      requiresClinicalEvaluation: study.requiresClinicalEvaluation,
    });
    setShowDesignModal(true);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setAutofillNotice('');
    if (searchParams.get('create') === '1') {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('create');
      nextParams.delete('workflow');
      nextParams.delete('autofill');
      setSearchParams(nextParams, { replace: true });
    }
  };

  const uploadStudyAttachment = useCallback(
    async (studyId: string, file: File, fileCategory: StudyResourceFile['fileCategory']) => {
      if (!token) {
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('fileCategory', fileCategory);

      const response = await fetch(`${apiBaseUrl}/studies/${studyId}/files`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Unable to upload study attachment');
      }
    },
    [token],
  );

  const handleCreateStudy = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token) {
      return;
    }

    if (formState.workflowType === 'supervised' && !formState.supervisorUserId) {
      setError('Please assign a supervisor for supervised studies.');
      return;
    }

    const groups = normalizeGroups(formState.groupsInput);
    if (groups.length === 0) {
      setError('Please define at least one study group.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');

      const response = await fetch(`${apiBaseUrl}/studies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: formState.title,
          studyType: formState.studyType,
          workflowType: formState.workflowType,
          targetSampleSize: Number(formState.targetSampleSize || 0),
          protocolFileName: protocolFile?.name || undefined,
          ethicsApprovalNumber: formState.ethicsApprovalNumber,
          clinicalRegistrationNumber: formState.clinicalRegistrationNumber,
          supervisorUserId: formState.supervisorUserId || undefined,
          hasRandomization: formState.hasRandomization,
          randomizationMethod: formState.hasRandomization ? formState.randomizationMethod : undefined,
          groups,
          hasBlinding: formState.hasBlinding,
          blindedParties: formState.hasBlinding ? normalizeBlindedParties(formState.blindedParties) : [],
          blindingScope: formState.hasBlinding ? formState.blindingScope : [],
          blindingTargetVariables: formState.hasBlinding ? normalizeTargetVariables(formState.blindingTargetVariablesInput) : [],
          blindingProtocolText: formState.hasBlinding ? formState.blindingProtocolText || undefined : undefined,
          requiresClinicalEvaluation: formState.requiresClinicalEvaluation,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to create study');
      }

      const createdStudy = (await response.json()) as Study;
      if (researchProposalFile) {
        await uploadStudyAttachment(createdStudy.id, researchProposalFile, 'attachment');
      }
      if (protocolFile) {
        await uploadStudyAttachment(createdStudy.id, protocolFile, 'protocol');
      }
      setStudies((prev) => [createdStudy, ...prev]);
      setFormState(initialFormState);
      setResearchProposalFile(null);
      setProtocolFile(null);
      closeCreateModal();
      setSelectedStudy(createdStudy);
      void fetchStudyResources(createdStudy.id);
    } catch {
      setError(t('studies.messages.createError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDesignSettings = async () => {
    if (!token || !selectedStudy) {
      return;
    }

    const groups = normalizeGroups(designForm.groupsInput);
    if (groups.length === 0) {
      setError('Please define at least one study group.');
      return;
    }

    try {
      setError('');
      setIsSubmitting(true);
      const response = await fetch(`${apiBaseUrl}/studies/${selectedStudy.id}/design-settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          hasRandomization: designForm.hasRandomization,
          randomizationMethod: designForm.hasRandomization ? designForm.randomizationMethod : undefined,
          groups,
          hasBlinding: designForm.hasBlinding,
          blindedParties: designForm.hasBlinding ? normalizeBlindedParties(designForm.blindedParties) : [],
          blindingScope: designForm.hasBlinding ? designForm.blindingScope : [],
          blindingTargetVariables: designForm.hasBlinding ? normalizeTargetVariables(designForm.blindingTargetVariablesInput) : [],
          blindingProtocolText: designForm.hasBlinding ? designForm.blindingProtocolText || undefined : undefined,
          coResearcherUserId: designForm.coResearcherUserId || undefined,
          assistantSupervisorUserId: designForm.assistantSupervisorUserId || undefined,
          clinicalEvaluatorUserId:
            designForm.requiresClinicalEvaluation && designForm.clinicalEvaluatorUserId
              ? designForm.clinicalEvaluatorUserId
              : undefined,
          requiresClinicalEvaluation: designForm.requiresClinicalEvaluation,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to save study design settings');
      }

      const updatedStudy = (await response.json()) as Study;
      replaceStudy(updatedStudy);
      setShowDesignModal(false);
    } catch {
      setError('Unable to save randomization and blinding settings.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResubmitStudy = async (studyId: string) => {
    if (!token) {
      return;
    }

    try {
      setError('');
      setIsResubmittingId(studyId);

      const response = await fetch(`${apiBaseUrl}/studies/${studyId}/resubmit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to resubmit study');
      }

      const updatedStudy = (await response.json()) as Study;
      replaceStudy(updatedStudy);
    } catch {
      setError(t('studies.messages.resubmitError'));
    } finally {
      setIsResubmittingId(null);
    }
  };

  const fetchStudyResources = useCallback(
    async (studyId: string) => {
      if (!token) {
        return;
      }

      try {
        setIsLoadingResources(true);
        const response = await fetch(`${apiBaseUrl}/studies/${studyId}/resources`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Unable to load study resources');
        }

        const data = (await response.json()) as StudyResources;
        setStudyResources({
          files: data.files ?? [],
          analyses: data.analyses ?? [],
        });
      } catch {
        setStudyResources({
          files: [],
          analyses: [],
        });
      } finally {
        setIsLoadingResources(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!selectedStudy) {
      setStudyResources(null);
      return;
    }

    void fetchStudyResources(selectedStudy.id);
  }, [fetchStudyResources, selectedStudy]);

  const statusTone = useMemo(
    () => ({
      active: 'bg-green-100 text-green-700',
      pending: 'bg-yellow-100 text-yellow-700',
      approved: 'bg-blue-100 text-blue-700',
      draft: 'bg-slate-100 text-slate-700',
      completed: 'bg-violet-100 text-violet-700',
      cancelled: 'bg-rose-100 text-rose-700',
    }),
    [],
  );

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));

  const getReviewDecisionLabel = (study: Study) => {
    if (!study.reviewDecision) {
      return null;
    }

    return t(`studies.review.decisions.${study.reviewDecision}`);
  };

  const downloadProtectedFile = useCallback(
    async (url: string, downloadName: string, downloadKey: string) => {
      if (!token) {
        return;
      }

      try {
        setError('');
        setActiveDownloadKey(downloadKey);

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Unable to download resource');
        }

        const blob = await response.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = downloadName;
        document.body.append(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(objectUrl);
      } catch {
        setError(t('studies.messages.downloadError'));
      } finally {
        setActiveDownloadKey(null);
      }
    },
    [t, token],
  );

  const handleDownloadStudyFile = (file: StudyResourceFile) => {
    if (!selectedStudy) {
      return;
    }

    void downloadProtectedFile(
      `${apiBaseUrl}/studies/${selectedStudy.id}/files/${file.id}/download`,
      file.originalName,
      `file-${file.id}`,
    );
  };

  const handleDownloadAnalysisReport = (analysis: StudyResourceAnalysis) => {
    if (!selectedStudy) {
      return;
    }

    void downloadProtectedFile(
      `${apiBaseUrl}/studies/${selectedStudy.id}/analyses/${analysis.id}/report`,
      `${analysis.title}.pdf`,
      `analysis-${analysis.id}`,
    );
  };

  const handleDownloadAnalysisReportWord = (analysis: StudyResourceAnalysis) => {
    if (!selectedStudy) {
      return;
    }

    void downloadProtectedFile(
      `${apiBaseUrl}/studies/${selectedStudy.id}/analyses/${analysis.id}/report-word`,
      `${analysis.title}.docx`,
      `analysis-word-${analysis.id}`,
    );
  };

  const handleDownloadStatisticianDataset = () => {
    if (!selectedStudy) {
      return;
    }

    void downloadProtectedFile(
      `${apiBaseUrl}/studies/${selectedStudy.id}/exports/statistician-dataset`,
      `${selectedStudy.title}-statistician-dataset.csv`,
      `statistician-dataset-${selectedStudy.id}`,
    );
  };

  const handleDownloadStatisticianDatasetXlsx = () => {
    if (!selectedStudy) {
      return;
    }

    void downloadProtectedFile(
      `${apiBaseUrl}/studies/${selectedStudy.id}/exports/statistician-dataset.xlsx`,
      `${selectedStudy.title}-statistician-dataset.xlsx`,
      `statistician-dataset-xlsx-${selectedStudy.id}`,
    );
  };

  return (
    <>
      <ResearchWorkspaceShell
      title={t('studies.title')}
      subtitle={t('studies.subtitle', { name: user?.fullName ?? t('dashboard.common.fallbackResearcher') })}
      currentStudyLabel={selectedStudy ? selectedStudy.title : `${studies.length} study workspace`}
      navItems={buildResearchWorkspaceNav(selectedStudy?.id).map((item) => ({
        ...item,
        active: item.key === 'setup',
      }))}
      actions={
        <>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 font-medium text-slate-700 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" />
            {t('dashboard.common.logout')}
          </button>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 px-6 py-3 font-medium text-white hover:shadow-lg"
          >
            <Plus className="h-4 w-4" />
            {t('studies.actions.create')}
          </button>
        </>
      }
    >
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="prototype-pick-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-500">(Current Existing Study)</p>
              <h3 className="mt-2 text-xl font-bold text-slate-900">استيراد دراسة قائمة</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                مسار قريب من prototype لبداية سريعة: استيراد ملفات الدراسة الحالية، ثم مراجعة الإعدادات المنهجية، وبعدها استكمال التشغيل من نفس الـ workspace.
              </p>
            </div>
            <FileText className="h-8 w-8 text-slate-400" />
          </div>
          <button
            type="button"
            onClick={() => {
              setFormState((prev) => ({ ...prev, workflowType: 'migration' }));
              setShowCreateModal(true);
            }}
            className="mt-5 rounded-xl bg-slate-800 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
          >
            فتح مسار الدراسة القائمة
          </button>
        </div>

        <div className="prototype-pick-card selected">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-teal-600">(New Study)</p>
              <h3 className="mt-2 text-xl font-bold text-slate-900">تأسيس دراسة جديدة</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                رفع المقترح والبروتوكول، إعداد العشوائية والتعمية، ثم نشر الاستمارة وربط العينات ضمن مسار موحد مشابه للـ prototype.
              </p>
            </div>
            <Plus className="h-8 w-8 text-teal-500" />
          </div>
          <button
            type="button"
            onClick={() => {
              setFormState((prev) => ({ ...prev, workflowType: 'supervised' }));
              setShowCreateModal(true);
            }}
            className="mt-5 rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-700"
          >
            بدء دراسة جديدة
          </button>
        </div>
      </div>

      {error ? <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
      {autofillNotice ? <div className="mb-6 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-700">{autofillNotice}</div> : null}

      {isLoading ? (
        <div className="flex min-h-[220px] items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center gap-3 text-slate-600">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            <span>{t('studies.messages.loading')}</span>
          </div>
        </div>
      ) : studies.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          <h2 className="text-xl font-bold text-slate-900">{t('studies.empty.title')}</h2>
          <p className="mt-2 text-slate-600">{t('studies.empty.description')}</p>
        </div>
      ) : (
        <div className="grid gap-6">
          {studies.map((study) => (
            <div key={study.id} className="workspace-card p-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                  <p className="mt-2 text-slate-600">
                    <span className="inline-flex items-center rounded-lg bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800 border border-teal-200 ml-2">
                      {getStudyTypeInfo(study.studyType).labelAr}
                    </span>
                    {study.targetSampleSize} {t('studies.labels.patients')} • {t(`studies.status.${study.status}`)}
                  </p>

                  <p className="mt-3 text-sm text-slate-500">{study.description || t('studies.labels.noDescription')}</p>

                  {study.reviewDecision ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      <p className="font-semibold">{getReviewDecisionLabel(study)}</p>
                      {study.reviewNotes ? <p className="mt-1">{study.reviewNotes}</p> : null}
                      {study.reviewedByName || study.reviewedAt ? (
                        <p className="mt-2 text-xs text-amber-700">
                          {study.reviewedByName ? `${study.reviewedByName}` : ''}
                          {study.reviewedByName && study.reviewedAt ? ' • ' : ''}
                          {study.reviewedAt ? formatDate(study.reviewedAt) : ''}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <span className="prototype-chip active">
                      Groups: {(study.groups?.length ? study.groups : ['Experimental', 'Control']).join(' / ')}
                    </span>
                    {study.hasRandomization ? (
                      <span className="prototype-chip active">Randomization: {study.randomizationMethod ?? 'simple'}</span>
                    ) : null}
                    {study.hasBlinding ? (
                      <span className="prototype-chip active">Blinding: {study.blindingSettings?.blindingType ?? 'configured'}</span>
                    ) : null}
                    {study.isLocked ? <span className="prototype-chip active">Locked</span> : null}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" onClick={() => setSelectedStudy(study)} className="inline-flex items-center gap-2 text-blue-600 hover:underline">
                      <Eye className="h-4 w-4" />
                      {t('studies.actions.viewDetails')}
                    </button>
                    <button type="button" onClick={() => openDesignSettings(study)} className="inline-flex items-center gap-2 text-violet-600 hover:underline">
                      <Eye className="h-4 w-4" />
                      Design Settings
                    </button>
                    <button type="button" onClick={() => navigate(`/studies/${study.id}`)} className="inline-flex items-center gap-2 text-teal-600 hover:underline">
                      <Users className="h-4 w-4" />
                      {t('studies.actions.managePatients')}
                    </button>
                    <button type="button" onClick={() => navigate(`/studies/${study.id}/assessment-form`)} className="inline-flex items-center gap-2 text-emerald-700 hover:underline">
                      <ClipboardCheck className="h-4 w-4" />
                      استمارة الفحص
                    </button>
                    <button type="button" onClick={() => navigate(`/ai-chat?studyId=${study.id}`)} className="inline-flex items-center gap-2 text-indigo-600 hover:underline">
                      <Bot className="h-4 w-4" />
                      {t('studies.actions.analysis')}
                    </button>
                    {study.reviewDecision === 'changes_requested' ? (
                      <button
                        type="button"
                        onClick={() => void handleResubmitStudy(study.id)}
                        disabled={isResubmittingId === study.id}
                        className="inline-flex items-center gap-2 text-amber-700 hover:underline disabled:opacity-60"
                      >
                        <Plus className="h-4 w-4" />
                        {isResubmittingId === study.id ? t('studies.messages.resubmitting') : t('studies.actions.resubmit')}
                      </button>
                    ) : null}
                  </div>
                </div>

                <span className={`rounded-full px-4 py-1 text-sm font-medium ${statusTone[study.status]}`}>
                  {t(`studies.status.${study.status}`)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      </ResearchWorkspaceShell>

      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-[2rem] bg-slate-100 p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black text-slate-900">واجهة تأسيس الدراسة</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">مطابقة لمسار `Study Setup` في النموذج المرجعي</p>
              </div>
              <button type="button" onClick={closeCreateModal} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            {autofillNotice ? (
              <div className="mb-6 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm font-bold text-teal-700">
                {autofillNotice}
              </div>
            ) : null}

            <form className="space-y-6" onSubmit={handleCreateStudy}>
              <div className="flex items-center gap-3 rounded-2xl border-2 border-teal-200 bg-teal-50 px-5 py-4">
                <Route className="h-5 w-5 text-teal-600" />
                <p className="text-sm font-extrabold text-teal-800">
                  المسار الحالي: <span>{formState.workflowType === 'migration' ? 'دراسة قائمة (Existing Study)' : 'دراسة جديدة (New Study)'}</span>
                </p>
                <button
                  type="button"
                  onClick={() => handleChange('workflowType', formState.workflowType === 'migration' ? 'supervised' : 'migration')}
                  className="mr-auto text-[11px] font-extrabold text-teal-700 transition hover:text-teal-900"
                >
                  تغيير المسار
                </button>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
                <div className="xl:col-span-3 space-y-6">
                  <div className="workspace-card p-6">
                    <div className="mb-5 flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-100 text-teal-600">
                        <FileSignature className="h-4 w-4" />
                      </span>
                      <div>
                        <h4 className="font-black text-slate-800">1. البيانات الأساسية لإطلاق الدراسة</h4>
                        <p className="text-[11px] font-bold text-slate-400">Study initialization inputs</p>
                      </div>
                    </div>

                    <label className="mb-5 block">
                      <span className="mb-2 block text-xs font-extrabold text-slate-600">عنوان الدراسة</span>
                      <input
                        type="text"
                        value={formState.title}
                        onChange={(e) => handleChange('title', e.target.value)}
                        className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-teal-500 focus:bg-white"
                        placeholder={t('studies.create.placeholders.title')}
                        required
                      />
                    </label>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-xs font-extrabold text-slate-600">نوع الدراسة المنهجي</span>
                        <select
                          value={formState.studyType}
                          onChange={(e) => handleChange('studyType', e.target.value)}
                          className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-teal-500 focus:bg-white"
                          required
                        >
                          {CREATE_STUDY_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.labelAr} ({opt.shortLabel})
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-xs font-extrabold text-slate-600">المشرف الأساسي</span>
                        <select
                          value={formState.supervisorUserId}
                          onChange={(e) => handleChange('supervisorUserId', e.target.value)}
                          className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-teal-500 focus:bg-white"
                        >
                          <option value="">{t('studies.create.placeholders.noAssignment')}</option>
                          {supervisors.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.fullName}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className={`mt-4 rounded-2xl border px-4 py-4 ${selectedStudyTypeInfo.badgeClass}`}>
                      <p className="text-xs font-extrabold">Workflow</p>
                      <p className="mt-1 text-sm font-black">{selectedStudyTypeInfo.labelAr}</p>
                      <p className="mt-2 text-xs font-bold opacity-80">{selectedStudyTypeInfo.workflowSummaryAr}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-extrabold">
                        <span className="rounded-full bg-white/80 px-3 py-1">{selectedStudyTypeInfo.screeningModeAr}</span>
                        <span className="rounded-full bg-white/80 px-3 py-1">
                          Randomization: {selectedStudyTypeInfo.supportsRandomization ? 'Supported' : 'Not required'}
                        </span>
                        <span className="rounded-full bg-white/80 px-3 py-1">
                          Blinding: {selectedStudyTypeInfo.supportsBlinding ? 'Available' : 'Optional/Off'}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5">
                      <span className="mb-2 block text-xs font-extrabold text-slate-600">رفع ملف مقترح البحث</span>
                      <label className="prototype-dropzone block cursor-pointer p-6 text-center">
                        <input type="file" accept=".pdf" onChange={(e) => setResearchProposalFile(e.target.files?.[0] ?? null)} className="hidden" />
                        <div className="space-y-2">
                          <FileText className="mx-auto h-8 w-8 text-slate-300" />
                          <p className="text-sm font-extrabold text-slate-500">
                            {researchProposalFile ? researchProposalFile.name : 'اسحب ملف المقترح هنا أو اضغط للاختيار'}
                          </p>
                          <p className="text-[10px] font-bold text-slate-300">PDF / DOCX - بحد أقصى 25MB</p>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="workspace-card p-6">
                    <div className="mb-5 flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                        <SlidersHorizontal className="h-4 w-4" />
                      </span>
                      <div>
                        <h4 className="font-black text-slate-800">2. تحديد الخيارات المنهجية والتحكيم</h4>
                        <p className="text-[11px] font-bold text-slate-400">تنعكس هذه الخيارات مباشرة على معالج المنهجية</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-4 rounded-2xl border-2 border-slate-100 bg-slate-50/70 p-4">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-teal-600 shadow">
                          <Shuffle className="h-5 w-5" />
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-extrabold text-slate-700">تفعيل خيار العشوائية</p>
                          <p className="text-[11px] font-bold text-slate-400">تخصيص العينات للمجموعات آلياً وفق خوارزمية محكومة</p>
                        </div>
                        <span className="text-[11px] font-black text-slate-400">لا</span>
                        <button
                          type="button"
                          disabled={!selectedStudyTypeInfo.supportsRandomization}
                          onClick={() => handleChange('hasRandomization', !formState.hasRandomization)}
                          className={`prototype-switch ${formState.hasRandomization ? 'on' : ''} ${!selectedStudyTypeInfo.supportsRandomization ? 'cursor-not-allowed opacity-50' : ''}`}
                        />
                        <span className="text-[11px] font-black text-teal-600">نعم</span>
                      </div>

                      <div className="flex items-center gap-4 rounded-2xl border-2 border-slate-100 bg-slate-50/70 p-4">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600 shadow">
                          <EyeOff className="h-5 w-5" />
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-extrabold text-slate-700">تفعيل خيار التعمية</p>
                          <p className="text-[11px] font-bold text-slate-400">إخفاء التخصيص العلاجي عن الأطراف المحددة لحماية حياد التجربة</p>
                        </div>
                        <span className="text-[11px] font-black text-slate-400">لا</span>
                        <button
                          type="button"
                          disabled={!selectedStudyTypeInfo.supportsBlinding}
                          onClick={() => handleChange('hasBlinding', !formState.hasBlinding)}
                          className={`prototype-switch ${formState.hasBlinding ? 'on' : ''} ${!selectedStudyTypeInfo.supportsBlinding ? 'cursor-not-allowed opacity-50' : ''}`}
                        />
                        <span className="text-[11px] font-black text-teal-600">نعم</span>
                      </div>

                      <div className="flex items-center gap-4 rounded-2xl border-2 border-slate-100 bg-slate-50/70 p-4">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-sky-600 shadow">
                          <UserCheck className="h-5 w-5" />
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-extrabold text-slate-700">طلب مقيّم خارجي</p>
                          <p className="text-[11px] font-bold text-slate-400">إرسال العينات لتقييم خارجي مستقل بعد قفل الدراسة كاملة</p>
                        </div>
                        <span className="text-[11px] font-black text-slate-400">لا</span>
                        <button
                          type="button"
                          onClick={() => handleChange('requiresClinicalEvaluation', !formState.requiresClinicalEvaluation)}
                          className={`prototype-switch ${formState.requiresClinicalEvaluation ? 'on' : ''}`}
                        />
                        <span className="text-[11px] font-black text-teal-600">نعم</span>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-xs font-extrabold text-slate-600">المجموعات العلاجية</span>
                        <input
                          type="text"
                          value={formState.groupsInput}
                          onChange={(e) => handleChange('groupsInput', e.target.value)}
                          className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-teal-500 focus:bg-white"
                          placeholder="Experimental, Control"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-xs font-extrabold text-slate-600">حجم العينة المستهدف</span>
                        <input
                          type="number"
                          min="0"
                          value={formState.targetSampleSize}
                          onChange={(e) => handleChange('targetSampleSize', e.target.value)}
                          className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-teal-500 focus:bg-white"
                          placeholder="40"
                        />
                      </label>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="mb-3 text-xs font-extrabold text-slate-600">خوارزمية العشوائية</p>
                        <div className="grid gap-3 md:grid-cols-2">
                          {[
                            ['simple', 'عشوائية بسيطة', 'Simple Randomization'],
                            ['block', 'عشوائية بالكتل', 'Block Randomization'],
                          ].map(([value, label, helper]) => (
                            <button
                              key={value}
                              type="button"
                              disabled={!formState.hasRandomization}
                              onClick={() => handleChange('randomizationMethod', value as RandomizationMethod)}
                              className={`prototype-pick-card text-right ${formState.randomizationMethod === value && formState.hasRandomization ? 'selected' : ''} ${
                                !formState.hasRandomization ? 'cursor-not-allowed opacity-50' : ''
                              }`}
                            >
                              <div className="mb-3 flex items-center justify-between">
                                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 text-teal-600">
                                  <Shuffle className="h-4 w-4" />
                                </span>
                                {formState.randomizationMethod === value && formState.hasRandomization ? <span className="prototype-pick-check">✓</span> : null}
                              </div>
                              <p className="text-sm font-extrabold text-slate-700">{label}</p>
                              <p className="mt-1 text-[10px] font-bold text-slate-400">{helper}</p>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="mb-3 text-xs font-extrabold text-slate-600">أطراف التعمية</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {[
                            ['participant', 'المشارك / المريض', 'لا يعرف المعالجة أو المجموعة'],
                            ['researcher', 'الباحث / المعالج', 'لا يعرف التدخل الذي يطبقه'],
                            ['supervisor', 'المشرف', 'يراجع دون رؤية هوية المجموعة أو التدخل'],
                            ['assessor', 'مقيّم النتائج', 'يقيّم النتائج دون معرفة المجموعة'],
                            ['statistician', 'المحلل الإحصائي', 'يستلم البيانات مرمزة'],
                          ].map(([value, label, helper]) => (
                            <button
                              key={value}
                              type="button"
                              disabled={!formState.hasBlinding}
                              onClick={() => toggleCreateBlindedParty(value as BlindedParty)}
                              className={`prototype-pick-card text-right ${formState.blindedParties.includes(value as BlindedParty) && formState.hasBlinding ? 'selected' : ''} ${
                                !formState.hasBlinding ? 'cursor-not-allowed opacity-50' : ''
                              }`}
                            >
                              <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-extrabold text-slate-700">{label}</span>
                                {formState.blindedParties.includes(value as BlindedParty) && formState.hasBlinding ? <span className="prototype-pick-check">✓</span> : null}
                              </div>
                              <p className="text-[10px] font-bold leading-relaxed text-slate-400">{helper}</p>
                            </button>
                          ))}
                        </div>
                        <div className="prototype-blind-badge warm mt-4 rounded-3xl p-5 text-center">
                          <p className="text-xs font-extrabold opacity-80">الاستنتاج التلقائي</p>
                          <p className="mt-2 text-2xl font-black">{inferBlindingType(formState.blindedParties)}</p>
                        </div>
                        <div className="mt-4">
                          <p className="mb-2 text-xs font-extrabold text-slate-600">نطاق التعمية</p>
                          <div className="flex flex-wrap gap-2">
                            {[
                              ['material_type', 'نوع المادة'],
                              ['treatment_procedure', 'نوع التدخل'],
                              ['split_mouth_side', 'جانب المعالجة'],
                            ].map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                disabled={!formState.hasBlinding}
                                onClick={() => toggleCreateBlindingScope(value as BlindingScope)}
                                className={`prototype-chip ${formState.blindingScope.includes(value as BlindingScope) && formState.hasBlinding ? 'active' : ''} ${
                                  !formState.hasBlinding ? 'cursor-not-allowed opacity-50' : ''
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="mt-4 block">
                          <span className="mb-2 block text-xs font-extrabold text-slate-600">المتغيرات المطلوب تعميتها</span>
                          <input
                            type="text"
                            value={formState.blindingTargetVariablesInput}
                            onChange={(e) => handleChange('blindingTargetVariablesInput', e.target.value)}
                            disabled={!formState.hasBlinding}
                            className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-teal-500 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                            placeholder="Treatment group, device name, intervention type"
                          />
                          <p className="mt-2 text-[10px] font-bold text-slate-400">اكتبها مفصولة بفواصل مثل: المجموعة العلاجية، اسم الجهاز، نوع التدخل، النتيجة الأساسية.</p>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="xl:col-span-2 space-y-6">
                  <div className="workspace-card p-6">
                    <div className="mb-5 flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <div>
                        <h4 className="font-black text-slate-800">3. إضافات الهوية والتوثيق</h4>
                        <p className="text-[11px] font-bold text-slate-400">تظهر تلقائياً في ترويسة استمارة الفحص</p>
                      </div>
                    </div>

                    <label className="prototype-dropzone mb-5 flex cursor-pointer items-center gap-4 p-4">
                      <input type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" />
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-teal-100 bg-teal-50 text-2xl text-teal-500">
                        <Building2 className="h-8 w-8" />
                      </div>
                      <div>
                        <p className="text-xs font-extrabold text-slate-500">اضغط لرفع شعار الجامعة</p>
                        <p className="mt-0.5 text-[10px] font-bold text-slate-300">PNG / JPG - يفضّل خلفية شفافة</p>
                      </div>
                    </label>

                    <label className="mb-4 block">
                      <span className="mb-2 block text-xs font-extrabold text-slate-600">رقم الموافقة الأخلاقية</span>
                      <input
                        type="text"
                        value={formState.ethicsApprovalNumber}
                        onChange={(e) => handleChange('ethicsApprovalNumber', e.target.value)}
                        className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition focus:border-teal-500 focus:bg-white"
                        placeholder="KSU-REC-2026-114"
                      />
                    </label>

                    <label className="mb-5 block">
                      <span className="mb-2 block text-xs font-extrabold text-slate-600">رقم التسجيل السريري</span>
                      <input
                        type="text"
                        value={formState.clinicalRegistrationNumber}
                        onChange={(e) => handleChange('clinicalRegistrationNumber', e.target.value)}
                        className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition focus:border-teal-500 focus:bg-white"
                        placeholder="NCT-05874211"
                      />
                    </label>

                    <div className="space-y-4">
                      <label className="prototype-dropzone block cursor-pointer p-5 text-center">
                        <input type="file" accept=".pdf" onChange={(e) => setResearchProposalFile(e.target.files?.[0] ?? null)} className="hidden" />
                        <p className="text-sm font-extrabold text-slate-600">مرفق المقترح البحثي</p>
                        <p className="mt-1 text-[11px] font-bold text-slate-400">{researchProposalFile ? researchProposalFile.name : 'PDF / DOCX'}</p>
                      </label>
                      <label className="prototype-dropzone block cursor-pointer p-5 text-center">
                        <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setProtocolFile(e.target.files?.[0] ?? null)} className="hidden" />
                        <p className="text-sm font-extrabold text-slate-600">مرفق ملف البروتوكول</p>
                        <p className="mt-1 text-[11px] font-bold text-slate-400">{protocolFile ? protocolFile.name : 'PDF / DOCX'}</p>
                      </label>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded-2xl bg-gradient-to-l from-teal-600 to-teal-700 py-4 text-base font-black text-white shadow-xl shadow-teal-600/30 transition hover:from-teal-700 hover:to-teal-800 disabled:opacity-70"
                  >
                    {isSubmitting ? 'جاري إنشاء الدراسة...' : '4. إنشاء الدراسة (Create Study)'}
                  </button>
                  <p className="text-center text-[11px] font-bold leading-relaxed text-slate-400">
                    بمجرد الضغط، يقوم المساعد الذكي بفحص المقترح واستخراج المجموعات وحجم العينة تلقائياً ثم يفتح لك معالج المنهجية.
                  </p>

                  <div className="workspace-card border-2 border-teal-200 p-6">
                    <div className="mb-4 flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 text-white">
                        <Sparkles className="h-4 w-4" />
                      </span>
                      <div>
                        <h4 className="font-black text-slate-800">الهيكل المبني للمقترح - مراجعة الباحث</h4>
                        <p className="text-[11px] font-bold text-slate-400">AI extracted setup preview</p>
                      </div>
                    </div>
                    <div className="mb-4 grid grid-cols-2 gap-4">
                      {normalizeGroups(formState.groupsInput || 'Experimental, Control')
                        .slice(0, 2)
                        .map((group, index) => (
                          <div
                            key={group}
                            className={`rounded-2xl border-2 p-4 text-center ${index === 0 ? 'border-teal-100 bg-teal-50/70' : 'border-slate-200 bg-slate-50'}`}
                          >
                            <p className={`mb-1 text-[11px] font-extrabold ${index === 0 ? 'text-teal-600' : 'text-slate-500'}`}>{group}</p>
                            <p className="text-xs font-bold text-slate-600">Sample arm</p>
                            <p className={`mt-2 text-3xl font-black ${index === 0 ? 'text-teal-700' : 'text-slate-600'}`}>
                              ن = {Math.max(0, Math.round(Number(formState.targetSampleSize || 0) / Math.max(1, normalizeGroups(formState.groupsInput || 'Experimental, Control').length)))}
                            </p>
                          </div>
                        ))}
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-3 flex items-start gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
                          <Bot className="h-3.5 w-3.5" />
                        </span>
                        <p className="rounded-xl rounded-tr-none bg-white p-2.5 text-[11px] font-bold text-slate-600 shadow-sm">
                          هل ترغب بتعديل حجم العينة أو أسماء المجموعات قبل الاعتماد؟ نوع الدراسة الحالي يضبط الـ workflow على: {selectedStudyTypeInfo.screeningModeAr}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={generateCreateBlindingProtocol}
                        disabled={!formState.hasBlinding}
                        className="w-full rounded-xl bg-slate-800 py-3 text-sm font-extrabold text-white transition hover:bg-slate-900 disabled:opacity-60"
                      >
                        توليد بروتوكول التعمية بالذكاء الاصطناعي
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showDesignModal && selectedStudy ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-8 shadow-2xl">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Design Settings</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedStudy.title}</p>
              </div>
              <button type="button" onClick={() => setShowDesignModal(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Randomization</p>
                <div className="mt-4 flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={designForm.hasRandomization}
                      onChange={(e) => updateDesignForm('hasRandomization', e.target.checked)}
                    />
                    Enable randomization
                  </label>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Study groups</label>
                    <input
                      type="text"
                      value={designForm.groupsInput}
                      onChange={(e) => updateDesignForm('groupsInput', e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Experimental, Control"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Method</label>
                    <select
                      value={designForm.randomizationMethod}
                      onChange={(e) => updateDesignForm('randomizationMethod', e.target.value as RandomizationMethod)}
                      disabled={!designForm.hasRandomization}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                    >
                      <option value="simple">Simple randomization</option>
                      <option value="block">Block randomization</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                <p className="text-sm font-semibold text-indigo-900">Blinding</p>
                <div className="mt-4 flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 text-sm font-medium text-indigo-900">
                    <input
                      type="checkbox"
                      checked={designForm.hasBlinding}
                      onChange={(e) => updateDesignForm('hasBlinding', e.target.checked)}
                    />
                    Enable blinding
                  </label>
                </div>

                <div className="mt-4">
                  <p className="text-sm font-medium text-indigo-900">Step 1: Who is blinded?</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {[
                      ['participant', 'Participant / Patient'],
                      ['researcher', 'Researcher / Operator'],
                      ['supervisor', 'Supervisor'],
                      ['assessor', 'Assessor'],
                      ['statistician', 'Statistician'],
                    ].map(([value, label]) => (
                      <label key={value} className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={designForm.blindedParties.includes(value as BlindedParty)}
                          disabled={!designForm.hasBlinding}
                          onChange={() => toggleDesignBlindedParty(value as BlindedParty)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-indigo-700">Blinding type: {inferBlindingType(designForm.blindedParties)}</p>
                </div>

                <div className="mt-4">
                  <p className="text-sm font-medium text-indigo-900">Step 2: What is blinded?</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {[
                      ['material_type', 'Material type'],
                      ['treatment_procedure', 'Treatment / procedure'],
                      ['split_mouth_side', 'Split-mouth side'],
                    ].map(([value, label]) => (
                      <label key={value} className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={designForm.blindingScope.includes(value as BlindingScope)}
                          disabled={!designForm.hasBlinding}
                          onChange={() => toggleDesignBlindingScope(value as BlindingScope)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <label className="mb-1 block text-sm font-medium text-indigo-900">Step 3: Blinded variables</label>
                  <input
                    type="text"
                    value={designForm.blindingTargetVariablesInput}
                    onChange={(e) => updateDesignForm('blindingTargetVariablesInput', e.target.value)}
                    disabled={!designForm.hasBlinding}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
                    placeholder="Treatment group, device name, intervention type"
                  />
                </div>

                <div className="mt-4 rounded-2xl border border-indigo-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-indigo-900">Step 4: AI blinding protocol assistant</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Generates a ready-to-use English blinding paragraph and previews automatic masking behavior.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={generateDesignBlindingProtocol}
                      disabled={!designForm.hasBlinding}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Generate AI Blinding Protocol
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-indigo-100 px-3 py-1 font-medium text-indigo-700">
                      Assessor fields hidden: {designForm.blindedParties.includes('assessor') ? 'Yes' : 'No'}
                    </span>
                    <span className="rounded-full bg-indigo-100 px-3 py-1 font-medium text-indigo-700">
                      Statistician dataset coded: {designForm.blindedParties.includes('statistician') ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <textarea
                    value={designForm.blindingProtocolText}
                    onChange={(e) => updateDesignForm('blindingProtocolText', e.target.value)}
                    rows={6}
                    disabled={!designForm.hasBlinding}
                    className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
                    placeholder="Generated blinding protocol will appear here."
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Team & Access Settings</p>
                <p className="mt-1 text-sm text-slate-500">
                  اختر الباحث المساعد والمشرف المساعد والمقيم من هنا في أي وقت بعد إنشاء الدراسة.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">الباحث المساعد</label>
                    <select
                      value={designForm.coResearcherUserId}
                      onChange={(e) => updateDesignForm('coResearcherUserId', e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">بدون تعيين</option>
                      {coResearchers.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">المشرف المساعد</label>
                    <select
                      value={designForm.assistantSupervisorUserId}
                      onChange={(e) => updateDesignForm('assistantSupervisorUserId', e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">بدون تعيين</option>
                      {assistantSupervisors.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={designForm.requiresClinicalEvaluation}
                        onChange={(e) => updateDesignForm('requiresClinicalEvaluation', e.target.checked)}
                      />
                      تفعيل التقييم السريري الخارجي
                    </label>
                    <select
                      value={designForm.clinicalEvaluatorUserId}
                      onChange={(e) => updateDesignForm('clinicalEvaluatorUserId', e.target.value)}
                      disabled={!designForm.requiresClinicalEvaluation}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                    >
                      <option value="">بدون تعيين</option>
                      {clinicalEvaluators.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-4">
                <button
                  type="button"
                  onClick={() => setShowDesignModal(false)}
                  className="rounded-xl border border-slate-300 px-6 py-3 font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveDesignSettings()}
                  disabled={isSubmitting}
                  className="rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-70"
                >
                  {isSubmitting ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedStudy ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-8 shadow-2xl">
            <div className="mb-6 flex items-center justify-between gap-4">
              <h2 className="text-2xl font-bold text-slate-900">{selectedStudy.title}</h2>
              <button type="button" onClick={() => setSelectedStudy(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-semibold text-slate-500">{t('studies.details.studyType')}</p>
                <p className="mt-1 text-slate-900">{selectedStudy.studyType}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">{t('studies.details.workflowType')}</p>
                <p className="mt-1 text-slate-900">{t(`studies.workflow.${selectedStudy.workflowType}`)}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">{t('studies.details.status')}</p>
                <p className="mt-1 text-slate-900">{t(`studies.status.${selectedStudy.status}`)}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">{t('studies.details.targetSampleSize')}</p>
                <p className="mt-1 text-slate-900">{selectedStudy.targetSampleSize}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">{t('studies.details.enrolledPatients')}</p>
                <p className="mt-1 text-slate-900">{selectedStudy.enrolledPatients}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">{t('studies.details.updatedAt')}</p>
                <p className="mt-1 text-slate-900">{formatDate(selectedStudy.updatedAt)}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">{t('studies.details.coResearcher')}</p>
                <p className="mt-1 text-slate-900">
                  {selectedStudy.coResearcherName || t('studies.labels.notAssigned')}
                  {selectedStudy.coResearcherAcademicId ? ` • ${selectedStudy.coResearcherAcademicId}` : ''}
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">{t('studies.details.supervisor')}</p>
                <p className="mt-1 text-slate-900">
                  {selectedStudy.supervisorName || t('studies.labels.notAssigned')}
                  {selectedStudy.supervisorAcademicId ? ` • ${selectedStudy.supervisorAcademicId}` : ''}
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">{t('studies.details.assistantSupervisor')}</p>
                <p className="mt-1 text-slate-900">
                  {selectedStudy.assistantSupervisorName || t('studies.labels.notAssigned')}
                  {selectedStudy.assistantSupervisorAcademicId ? ` • ${selectedStudy.assistantSupervisorAcademicId}` : ''}
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">{t('studies.details.clinicalEvaluationRequested')}</p>
                <p className="mt-1 text-slate-900">
                  {selectedStudy.requiresClinicalEvaluation ? t('studies.evaluation.requested') : t('studies.evaluation.notRequested')}
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">{t('studies.details.clinicalEvaluator')}</p>
                <p className="mt-1 text-slate-900">
                  {selectedStudy.assignedClinicalEvaluatorName || t('studies.labels.notAssigned')}
                  {selectedStudy.assignedClinicalEvaluatorAcademicId ? ` • ${selectedStudy.assignedClinicalEvaluatorAcademicId}` : ''}
                </p>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-sm font-semibold text-slate-500">{t('studies.details.description')}</p>
              <p className="mt-2 text-slate-700">{selectedStudy.description || t('studies.labels.noDescription')}</p>
            </div>

            <div className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-indigo-900">Randomization & Blinding</p>
                  <p className="mt-1 text-sm text-indigo-700">
                    Groups: {(selectedStudy.groups?.length ? selectedStudy.groups : ['Experimental', 'Control']).join(' / ')}
                  </p>
                  <p className="mt-1 text-sm text-indigo-700">
                    Randomization: {selectedStudy.hasRandomization ? selectedStudy.randomizationMethod ?? 'simple' : 'disabled'}
                  </p>
                  <p className="mt-1 text-sm text-indigo-700">
                    Blinding: {selectedStudy.hasBlinding ? selectedStudy.blindingSettings?.blindingType ?? 'configured' : 'disabled'}
                  </p>
                  {selectedStudy.blindingSettings?.targetVariables?.length ? (
                    <p className="mt-1 text-sm text-indigo-700">
                      Blinded variables: {selectedStudy.blindingSettings.targetVariables.join(' / ')}
                    </p>
                  ) : null}
                  {selectedStudy.blindingSettings?.protocolText ? (
                    <p className="mt-3 text-sm text-indigo-800">{selectedStudy.blindingSettings.protocolText}</p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200">
                      Assessor masking: {selectedStudy.blindingSettings?.permissions.hideMaterialsFromAssessor ? 'On' : 'Off'}
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200">
                      Statistician coded export: {selectedStudy.blindingSettings?.permissions.maskGroupsForStatistician ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/studies/${selectedStudy.id}`)}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    فتح لوحة الدراسة
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/studies/${selectedStudy.id}/assessment-form`)}
                    className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                  >
                    فتح استمارة الفحص
                  </button>
                  <button
                    type="button"
                    onClick={() => openDesignSettings(selectedStudy)}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    Design Settings
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadStatisticianDataset}
                    disabled={activeDownloadKey === `statistician-dataset-${selectedStudy.id}`}
                    className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
                  >
                    {activeDownloadKey === `statistician-dataset-${selectedStudy.id}` ? 'Downloading...' : 'Download Statistician CSV'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadStatisticianDatasetXlsx}
                    disabled={activeDownloadKey === `statistician-dataset-xlsx-${selectedStudy.id}`}
                    className="rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                  >
                    {activeDownloadKey === `statistician-dataset-xlsx-${selectedStudy.id}` ? 'Downloading...' : 'Download Statistician XLSX'}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{t('studies.details.workspace')}</p>
                  <p className="mt-1 text-sm text-slate-500">{t('studies.details.workspaceDescription')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/ai-chat?studyId=${selectedStudy.id}`)}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  {t('studies.actions.openWorkspace')}
                </button>
              </div>

              {isLoadingResources ? (
                <div className="mt-4 inline-flex items-center gap-2 text-sm text-slate-600">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  <span>{t('studies.messages.loadingResources')}</span>
                </div>
              ) : studyResources ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                    <p className="text-sm font-semibold text-slate-800">{t('studies.details.files')}</p>
                    {studyResources.files.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">{t('studies.details.noFiles')}</p>
                    ) : (
                      <ul className="mt-3 space-y-3 text-sm text-slate-600">
                        {studyResources.files.slice(0, 5).map((file) => (
                          <li key={file.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium text-slate-900">{file.originalName}</p>
                                <p className="mt-1 text-xs text-slate-500">{file.fileCategory}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDownloadStudyFile(file)}
                                disabled={activeDownloadKey === `file-${file.id}`}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                              >
                                <Download className="h-3.5 w-3.5" />
                                {activeDownloadKey === `file-${file.id}`
                                  ? t('studies.messages.downloading')
                                  : t('studies.actions.downloadFile')}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                    <p className="text-sm font-semibold text-slate-800">{t('studies.details.analyses')}</p>
                    {studyResources.analyses.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">{t('studies.details.noAnalyses')}</p>
                    ) : (
                      <ul className="mt-3 space-y-3 text-sm text-slate-600">
                        {studyResources.analyses.slice(0, 5).map((analysis) => (
                          <li key={analysis.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium text-slate-900">{analysis.title}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {analysis.analysisType ? analysis.analysisType : t('aiChat.results.unspecifiedAnalysis')}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDownloadAnalysisReport(analysis)}
                                disabled={activeDownloadKey === `analysis-${analysis.id}`}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                              >
                                <Download className="h-3.5 w-3.5" />
                                {activeDownloadKey === `analysis-${analysis.id}`
                                  ? t('studies.messages.downloading')
                                  : t('studies.actions.downloadReport')}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDownloadAnalysisReportWord(analysis)}
                                disabled={activeDownloadKey === `analysis-word-${analysis.id}`}
                                className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
                              >
                                <Download className="h-3.5 w-3.5" />
                                {activeDownloadKey === `analysis-word-${analysis.id}` ? 'Downloading...' : 'Word'}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {selectedStudy.reviewDecision ? (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="text-sm font-semibold text-amber-800">{t('studies.details.review')}</p>
                <p className="mt-2 font-medium text-amber-900">{getReviewDecisionLabel(selectedStudy)}</p>
                {selectedStudy.reviewNotes ? <p className="mt-2 text-sm text-amber-800">{selectedStudy.reviewNotes}</p> : null}
                {selectedStudy.reviewedByName || selectedStudy.reviewedAt ? (
                  <p className="mt-3 text-xs text-amber-700">
                    {selectedStudy.reviewedByName ? `${selectedStudy.reviewedByName}` : ''}
                    {selectedStudy.reviewedByName && selectedStudy.reviewedAt ? ' • ' : ''}
                    {selectedStudy.reviewedAt ? formatDate(selectedStudy.reviewedAt) : ''}
                  </p>
                ) : null}

                {selectedStudy.reviewDecision === 'changes_requested' ? (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => void handleResubmitStudy(selectedStudy.id)}
                      disabled={isResubmittingId === selectedStudy.id}
                      className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                    >
                      {isResubmittingId === selectedStudy.id ? t('studies.messages.resubmitting') : t('studies.actions.resubmit')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {selectedStudy.requiresClinicalEvaluation ? (
              <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-5">
                <p className="text-sm font-semibold text-sky-800">{t('studies.details.clinicalEvaluation')}</p>
                <p className="mt-2 font-medium text-sky-900">
                  {selectedStudy.clinicalEvaluationDecision
                    ? t(`studies.evaluation.status.${selectedStudy.clinicalEvaluationDecision}`)
                    : t('studies.evaluation.status.pending')}
                </p>
                {selectedStudy.clinicalEvaluationNotes ? (
                  <p className="mt-2 text-sm text-sky-800">{selectedStudy.clinicalEvaluationNotes}</p>
                ) : null}
                {selectedStudy.clinicalEvaluatedByName || selectedStudy.clinicalEvaluatedAt ? (
                  <p className="mt-3 text-xs text-sky-700">
                    {selectedStudy.clinicalEvaluatedByName ? `${selectedStudy.clinicalEvaluatedByName}` : ''}
                    {selectedStudy.clinicalEvaluatedByName && selectedStudy.clinicalEvaluatedAt ? ' • ' : ''}
                    {selectedStudy.clinicalEvaluatedAt ? formatDate(selectedStudy.clinicalEvaluatedAt) : ''}
                  </p>
                ) : null}
              </div>
            ) : null}

            {token ? (
              <OutcomeAssessmentManager
                studyId={selectedStudy.id}
                studyType={selectedStudy.studyType}
                token={token}
                studyFiles={(studyResources?.files ?? []).map((file) => ({
                  id: file.id,
                  originalName: file.originalName,
                }))}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

export default Studies;
