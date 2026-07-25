import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Bot,
  CalendarDays,
  CalendarPlus2,
  CheckCircle2,
  ClipboardList,
  Download,
  EyeOff,
  FileText,
  Layers3,
  LoaderCircle,
  Lock,
  LogOut,
  MessageSquare,
  Paperclip,
  Pencil,
  ShieldCheck,
  Shuffle,
  Trash2,
  Upload,
  UserPlus,
  UserRoundCheck,
  Users,
  X,
} from 'lucide-react';
import OutcomeAssessmentManager from '../components/OutcomeAssessmentManager';
import ResearchWorkspaceShell, { buildResearchWorkspaceNav } from '../components/ResearchWorkspaceShell';
import { useAuth } from '../context/useAuth';
import { clearAutofillSnapshot, loadAutofillSnapshot } from '../lib/aiAutofill';
import { apiBaseUrl, getDashboardPath } from '../lib/auth';

type Study = {
  id: string;
  title: string;
  description?: string;
  studyType: string;
  workflowType: 'supervised' | 'migration';
  status: 'draft' | 'pending' | 'approved' | 'active' | 'completed' | 'cancelled';
  targetSampleSize: number;
  enrolledPatients: number;
  principalInvestigatorName?: string;
  coResearcherUserId?: string;
  supervisorName?: string;
  coResearcherName?: string;
  assistantSupervisorUserId?: string;
  assistantSupervisorName?: string;
  assignedClinicalEvaluatorUserId?: string;
  assignedClinicalEvaluatorName?: string;
  hasRandomization?: boolean;
  hasBlinding?: boolean;
  randomizationMethod?: 'simple' | 'block';
  groups?: string[];
  blindingSettings?: {
    blindingType?: string;
    blindedParties?: Array<'patient' | 'researcher' | 'assessor' | 'statistician'>;
    scope?: Array<'material_type' | 'treatment_procedure' | 'split_mouth_side'>;
    protocolText?: string;
    permissions?: {
      hideMaterialsFromAssessor?: boolean;
      maskGroupsForStatistician?: boolean;
    };
  };
  requiresClinicalEvaluation: boolean;
  isLocked?: boolean;
  lockedAt?: string;
  lockedByUserId?: string;
  lockedByName?: string;
  clinicalEvaluationDecision?: 'pending' | 'accepted' | 'needs_revision' | 'not_recommended';
  clinicalEvaluationNotes?: string;
  clinicalEvaluatedAt?: string;
  clinicalEvaluatedByName?: string;
  createdAt: string;
  updatedAt: string;
};

type StudyResourceFile = {
  id: string;
  originalName: string;
  fileCategory: 'protocol' | 'dataset' | 'image' | 'attachment' | 'report';
  createdAt: string;
};

type StudyResources = {
  files: StudyResourceFile[];
  analyses: Array<{
    id: string;
    title: string;
    analysisType?: string;
    createdAt: string;
  }>;
};

type BlindedParty = 'patient' | 'researcher' | 'assessor' | 'statistician';
type BlindingScope = 'material_type' | 'treatment_procedure' | 'split_mouth_side';
type RandomizationMethod = 'simple' | 'block';
type ClinicalEvaluationDecision = 'pending' | 'accepted' | 'needs_revision' | 'not_recommended';
type CalendarEventStatus = 'scheduled' | 'completed' | 'cancelled';

type MethodologyDraft = {
  hasRandomization: boolean;
  randomizationMethod: RandomizationMethod;
  groupsInput: string;
  hasBlinding: boolean;
  blindedParties: BlindedParty[];
  blindingScope: BlindingScope[];
  blindingProtocolText: string;
  requiresClinicalEvaluation: boolean;
};

type CalendarEvent = {
  id: string;
  title: string;
  patient: string;
  date: Date;
  type: string;
  status: CalendarEventStatus;
  note?: string;
  attachments?: string[];
};

type StudyTab = 'overview' | 'patients' | 'files' | 'assessment-form' | 'calendar' | 'access' | 'analysis';
type WithdrawStep = 1 | 2 | 3 | 4;
type WithdrawImpactKey = 'stopTreatmentOnly' | 'continueFollowUp' | 'fullWithdrawal' | 'keepHistoricalData';

type WithdrawDraft = {
  patientCode: string;
  reason: string;
  otherReason: string;
  withdrawalDate: string;
  lastVisit: string;
  phase: string;
  decisionMaker: string;
  researcherNotes: string;
  impacts: Record<WithdrawImpactKey, boolean>;
  replaceSample: boolean;
  attachments: string[];
};

type NoticeTone = 'success' | 'info' | 'warning';

const normalizeGroups = (value: string) =>
  Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const inferBlindingType = (parties: BlindedParty[]) => {
  if (parties.length === 0) {
    return 'Open-label';
  }
  if (parties.length === 1 && parties.includes('patient')) {
    return 'Single-blind';
  }
  if (parties.includes('patient') && parties.includes('assessor') && parties.length === 2) {
    return 'Double-blind';
  }
  if (parties.includes('patient') && parties.includes('assessor') && parties.includes('statistician') && parties.length === 3) {
    return 'Triple-blind';
  }
  return parties.length >= 4 ? 'Quadruple-blind' : 'Double-blind';
};

const generateBlindingProtocolText = (input: {
  studyTitle?: string;
  groupsInput: string;
  blindedParties: BlindedParty[];
  blindingScope: BlindingScope[];
}) => {
  const groups = normalizeGroups(input.groupsInput);
  const normalizedGroups = groups.length > 0 ? groups : ['Experimental', 'Control'];
  const blindedPartyNarratives: Record<BlindedParty, string> = {
    patient: 'the participant throughout the intervention period',
    researcher: 'the treating researcher or operator during intervention delivery',
    assessor: 'the external outcome assessor during outcome evaluation',
    statistician: 'the statistician during coded data analysis',
  };
  const scopeNarratives: Record<BlindingScope, string> = {
    material_type: 'the identity of the study material',
    treatment_procedure: 'the treatment or intervention allocation',
    split_mouth_side: 'the treated side in split-mouth allocation',
  };

  return [
    `This study was structured as a ${inferBlindingType(input.blindedParties).toLowerCase()} clinical design.`,
    `Blinded parties included ${input.blindedParties.length ? input.blindedParties.map((item) => blindedPartyNarratives[item]).join(', ') : 'no trial personnel'}.`,
    `Blinding was applied to ${input.blindingScope.length ? input.blindingScope.map((item) => scopeNarratives[item]).join(', ') : 'the intervention identity'}.`,
    `Allocation concealment was maintained through coded labels for ${normalizedGroups.join(' and ')}.`,
    'Any emergency unblinding event is documented in the audit trail together with the user, reason, and timestamp.',
  ].join(' ');
};

const startOfWeek = (value: Date) => {
  const date = new Date(value);
  const diff = (date.getDay() + 6) % 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - diff);
  return date;
};

const formatDateInputValue = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatTimeInputValue = (value: Date) => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;

const createDefaultWithdrawDraft = (patientCode: string): WithdrawDraft => ({
  patientCode,
  reason: '',
  otherReason: '',
  withdrawalDate: formatDateInputValue(new Date()),
  lastVisit: 'الزيارة الثانية',
  phase: 'مرحلة التنشيط والمتابعة',
  decisionMaker: 'المشارك',
  researcherNotes: '',
  impacts: {
    stopTreatmentOnly: false,
    continueFollowUp: false,
    fullWithdrawal: true,
    keepHistoricalData: true,
  },
  replaceSample: false,
  attachments: [],
});

const calendarStatusMeta: Record<CalendarEventStatus, { label: string; badge: string; card: string }> = {
  scheduled: {
    label: 'مجدول',
    badge: 'bg-teal-100 text-teal-700',
    card: 'border-teal-200 bg-teal-50',
  },
  completed: {
    label: 'مكتمل',
    badge: 'bg-emerald-100 text-emerald-700',
    card: 'border-emerald-200 bg-emerald-50',
  },
  cancelled: {
    label: 'ملغي',
    badge: 'bg-rose-100 text-rose-700',
    card: 'border-rose-200 bg-rose-50',
  },
};

const clinicalEvaluationMeta: Record<
  ClinicalEvaluationDecision,
  { label: string; helper: string; tone: string; chip: string }
> = {
  pending: {
    label: 'بانتظار التقييم',
    helper: 'تم تجهيز الدراسة للمراجعة السريرية ولم يصدر القرار النهائي بعد.',
    tone: 'bg-amber-50 text-amber-700',
    chip: 'bg-amber-100 text-amber-700',
  },
  accepted: {
    label: 'مقبولة سريريًا',
    helper: 'التقييم الخارجي اعتمد الدراسة ويمكن متابعة التقارير النهائية.',
    tone: 'bg-emerald-50 text-emerald-700',
    chip: 'bg-emerald-100 text-emerald-700',
  },
  needs_revision: {
    label: 'بحاجة إلى تعديل',
    helper: 'وصلت ملاحظات من المقيم الخارجي وتحتاج الدراسة إلى تحديث قبل الإرسال مجددًا.',
    tone: 'bg-sky-50 text-sky-700',
    chip: 'bg-sky-100 text-sky-700',
  },
  not_recommended: {
    label: 'غير موصى بها',
    helper: 'المقيم الخارجي لم يوصِ باستمرار المسار السريري الحالي حتى تتم المعالجة.',
    tone: 'bg-rose-50 text-rose-700',
    chip: 'bg-rose-100 text-rose-700',
  },
};

function StudyDashboard() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, token, signOut } = useAuth();
  const [study, setStudy] = useState<Study | null>(null);
  const [resources, setResources] = useState<StudyResources>({ files: [], analyses: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingMethodology, setIsSavingMethodology] = useState(false);
  const [selectedUploadCategory, setSelectedUploadCategory] = useState<StudyResourceFile['fileCategory']>('attachment');
  const [methodologyStep, setMethodologyStep] = useState<1 | 2 | 3>(1);
  const [methodologyDraft, setMethodologyDraft] = useState<MethodologyDraft>({
    hasRandomization: false,
    randomizationMethod: 'simple',
    groupsInput: 'Experimental, Control',
    hasBlinding: false,
    blindedParties: [],
    blindingScope: [],
    blindingProtocolText: '',
    requiresClinicalEvaluation: false,
  });
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showLockModal, setShowLockModal] = useState(false);
  const [selectedPatientCode, setSelectedPatientCode] = useState('PT-001');
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [appointmentDate, setAppointmentDate] = useState(new Date().toISOString().slice(0, 10));
  const [appointmentTime, setAppointmentTime] = useState('12:00');
  const [appointmentType, setAppointmentType] = useState('متابعة دورية');
  const [visitNote, setVisitNote] = useState('');
  const [visitAttachments, setVisitAttachments] = useState<string[]>([]);
  const [assistantEmail, setAssistantEmail] = useState('');
  const [assistantPermission, setAssistantPermission] = useState<'read' | 'edit' | 'samples'>('samples');
  const [assistantInvited, setAssistantInvited] = useState(false);
  const [supervisorCode, setSupervisorCode] = useState('SUP-KSU-4471');
  const [supervisorLinked, setSupervisorLinked] = useState(true);
  const [studyLocked, setStudyLocked] = useState(false);
  const [isLockingStudy, setIsLockingStudy] = useState(false);
  const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date()));
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  const [withdrawStep, setWithdrawStep] = useState<WithdrawStep>(1);
  const [withdrawDraft, setWithdrawDraft] = useState<WithdrawDraft>(() => createDefaultWithdrawDraft('PT-001'));
  const [error, setError] = useState('');
  const initialTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<StudyTab>(
    initialTab === 'patients' ||
      initialTab === 'files' ||
      initialTab === 'assessment-form' ||
      initialTab === 'calendar' ||
      initialTab === 'access' ||
      initialTab === 'analysis'
      ? initialTab
      : 'overview',
  );
  const dashboardPath = getDashboardPath(user?.accountType ?? 'student');

  const formatDate = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(value)),
    [],
  );

  const loadStudy = useCallback(async () => {
    if (!token || !id) {
      setIsLoading(false);
      return;
    }

    try {
      setError('');
      setIsLoading(true);

      const [studyResponse, resourcesResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/studies/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${apiBaseUrl}/studies/${id}/resources`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!studyResponse.ok || !resourcesResponse.ok) {
        throw new Error('Unable to load study workspace');
      }

      setStudy((await studyResponse.json()) as Study);
      setResources((await resourcesResponse.json()) as StudyResources);
    } catch {
      setError('تعذر تحميل لوحة الدراسة حالياً.');
      setStudy(null);
    } finally {
      setIsLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    void loadStudy();
  }, [loadStudy]);

  useEffect(() => {
    if (study) {
      setStudyLocked(Boolean(study.isLocked));
      return;
    }

    setStudyLocked(false);
  }, [study]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (
      requestedTab === 'overview' ||
      requestedTab === 'patients' ||
      requestedTab === 'files' ||
      requestedTab === 'assessment-form' ||
      requestedTab === 'calendar' ||
      requestedTab === 'access' ||
      requestedTab === 'analysis'
    ) {
      setActiveTab(requestedTab);
      return;
    }

    setActiveTab('overview');
  }, [searchParams]);

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!token || !id) {
      return;
    }

    if (studyLocked) {
      setError('الدراسة مقفلة حالياً ولا يمكن رفع ملفات جديدة أثناء التقييم الخارجي.');
      event.target.value = '';
      return;
    }

    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      setError('');
      setIsUploading(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('fileCategory', selectedUploadCategory);

      const response = await fetch(`${apiBaseUrl}/studies/${id}/files`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Unable to upload study file');
      }

      await loadStudy();
      event.target.value = '';
    } catch {
      setError('تعذر رفع الملف إلى الدراسة.');
    } finally {
      setIsUploading(false);
    }
  };

  const downloadFile = async (fileId: string, fileName: string) => {
    if (!token || !id) {
      return;
    }

    try {
      setError('');
      const response = await fetch(`${apiBaseUrl}/studies/${id}/files/${fileId}/download`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to download file');
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch {
      setError('تعذر تنزيل الملف المطلوب.');
    }
  };

  const studyFiles = useMemo(
    () => resources.files.map((file) => ({ id: file.id, originalName: file.originalName })),
    [resources.files],
  );

  useEffect(() => {
    const baseDate = new Date();
    const titles = ['Baseline Visit', 'Eligibility Review', 'Treatment Follow-up', 'Outcome Assessment'];
    setCalendarEvents(
      titles.map((title, index) => {
        const date = new Date(baseDate);
        date.setDate(baseDate.getDate() + index);
        return {
          id: `${title}-${index}`,
          title,
          patient: `PT-${String(index + 1).padStart(3, '0')}`,
          date,
          type: ['Baseline', 'Review', 'Follow-up', 'Assessment'][index] ?? 'Visit',
          status: 'scheduled',
        };
      }),
    );
  }, []);

  const weeklyCalendar = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(currentWeekStart);
      date.setDate(currentWeekStart.getDate() + index);

      return {
        key: date.toISOString(),
        date,
        events: calendarEvents
          .filter((event) => event.date.toDateString() === date.toDateString())
          .sort((left, right) => left.date.getTime() - right.date.getTime()),
      };
    });
  }, [calendarEvents, currentWeekStart]);

  const selectedCalendarEvent = useMemo(
    () => calendarEvents.find((event) => event.id === selectedCalendarEventId) ?? null,
    [calendarEvents, selectedCalendarEventId],
  );

  const accessRoles = useMemo(
    () => [
      {
        label: 'الباحث الرئيسي',
        name: study?.principalInvestigatorName || 'غير محدد',
        helper: 'كامل الصلاحيات وإدارة المنهجية',
        tone: 'bg-teal-50 text-teal-700',
      },
      {
        label: 'المشرف الأكاديمي',
        name: study?.supervisorName || 'غير مرتبط بعد',
        helper: 'مراجعة الدراسة وإبداء الملاحظات',
        tone: 'bg-violet-50 text-violet-700',
      },
      {
        label: 'الباحث المساعد',
        name: study?.coResearcherName || 'غير معين',
        helper: 'إضافة عينات أو تحرير حسب الإذن',
        tone: 'bg-sky-50 text-sky-700',
      },
      {
        label: 'المقيم السريري',
        name: study?.assignedClinicalEvaluatorName || 'غير معين',
        helper: study?.requiresClinicalEvaluation ? 'تقييم خارجي مفعل' : 'التقييم الخارجي غير مطلوب',
        tone: 'bg-amber-50 text-amber-700',
      },
    ],
    [
      study?.assignedClinicalEvaluatorName,
      study?.coResearcherName,
      study?.principalInvestigatorName,
      study?.requiresClinicalEvaluation,
      study?.supervisorName,
    ],
  );

  const tabs: Array<{ id: StudyTab; label: string; count?: number }> = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      { id: 'patients', label: 'Patients', count: study?.enrolledPatients ?? 0 },
      { id: 'files', label: 'Files', count: resources.files.length },
      { id: 'assessment-form', label: 'Assessment Form' },
      { id: 'calendar', label: 'Calendar', count: calendarEvents.length },
      { id: 'access', label: 'Access' },
      { id: 'analysis', label: 'Analysis', count: resources.analyses.length },
    ],
    [calendarEvents.length, resources.analyses.length, resources.files.length, study?.enrolledPatients],
  );

  const selectTab = (tab: StudyTab) => {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tab);
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    if (!study) {
      return;
    }

    setMethodologyDraft({
      hasRandomization: Boolean(study.hasRandomization),
      randomizationMethod: study.randomizationMethod ?? 'simple',
      groupsInput: (study.groups?.length ? study.groups : ['Experimental', 'Control']).join(', '),
      hasBlinding: Boolean(study.hasBlinding),
      blindedParties: study.blindingSettings?.blindedParties ?? [],
      blindingScope: study.blindingSettings?.scope ?? [],
      blindingProtocolText: study.blindingSettings?.protocolText ?? '',
      requiresClinicalEvaluation: Boolean(study.requiresClinicalEvaluation),
    });
  }, [study]);

  const updateMethodologyDraft = <K extends keyof MethodologyDraft>(key: K, value: MethodologyDraft[K]) => {
    setMethodologyDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleMethodologyParty = (party: BlindedParty) => {
    setMethodologyDraft((current) => ({
      ...current,
      blindedParties: current.blindedParties.includes(party)
        ? current.blindedParties.filter((item) => item !== party)
        : [...current.blindedParties, party],
    }));
  };

  const toggleMethodologyScope = (scope: BlindingScope) => {
    setMethodologyDraft((current) => ({
      ...current,
      blindingScope: current.blindingScope.includes(scope)
        ? current.blindingScope.filter((item) => item !== scope)
        : [...current.blindingScope, scope],
    }));
  };

  const generateMethodologyProtocol = () => {
    setMethodologyDraft((current) => ({
      ...current,
      blindingProtocolText: generateBlindingProtocolText({
        studyTitle: study?.title,
        groupsInput: current.groupsInput,
        blindedParties: current.blindedParties,
        blindingScope: current.blindingScope,
      }),
    }));
  };

  const saveMethodologySettings = async () => {
    if (!token || !study) {
      return;
    }

    if (studyLocked) {
      setError('الدراسة مقفلة حالياً ولا يمكن تعديل إعدادات المنهجية أثناء التقييم الخارجي.');
      return;
    }

    const groups = normalizeGroups(methodologyDraft.groupsInput);
    if (groups.length === 0) {
      setError('يرجى تعريف مجموعة علاجية واحدة على الأقل قبل الحفظ.');
      return;
    }

    try {
      setError('');
      setIsSavingMethodology(true);
      const response = await fetch(`${apiBaseUrl}/studies/${study.id}/design-settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          hasRandomization: methodologyDraft.hasRandomization,
          randomizationMethod: methodologyDraft.hasRandomization ? methodologyDraft.randomizationMethod : undefined,
          groups,
          hasBlinding: methodologyDraft.hasBlinding,
          blindedParties: methodologyDraft.hasBlinding ? methodologyDraft.blindedParties : [],
          blindingScope: methodologyDraft.hasBlinding ? methodologyDraft.blindingScope : [],
          blindingProtocolText: methodologyDraft.hasBlinding ? methodologyDraft.blindingProtocolText || undefined : undefined,
          requiresClinicalEvaluation: methodologyDraft.requiresClinicalEvaluation,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to save methodology settings');
      }

      const updatedStudy = (await response.json()) as Study;
      setStudy(updatedStudy);
      setMethodologyStep(3);
    } catch {
      setError('تعذر حفظ إعدادات المنهجية الحالية.');
    } finally {
      setIsSavingMethodology(false);
    }
  };

  const patientCodes = useMemo(
    () => Array.from({ length: Math.max(4, study?.enrolledPatients || 0) }, (_, index) => `PT-${String(index + 1).padStart(3, '0')}`),
    [study?.enrolledPatients],
  );

  useEffect(() => {
    if (!patientCodes.includes(selectedPatientCode)) {
      setSelectedPatientCode(patientCodes[0] ?? 'PT-001');
    }
  }, [patientCodes, selectedPatientCode]);

  useEffect(() => {
    if (searchParams.get('autofill') !== '1') {
      return;
    }

    const snapshot = loadAutofillSnapshot();
    if (!snapshot) {
      return;
    }

    setMethodologyDraft((current) => ({
      ...current,
      groupsInput: snapshot.studyGroups?.length ? snapshot.studyGroups.join(', ') : current.groupsInput,
      blindingProtocolText: snapshot.blindingProtocolText || current.blindingProtocolText,
    }));
    setNotice({
      tone: 'info',
      message: `تم تطبيق اقتراحات المساعد الذكي على إعدادات المنهجية${snapshot.sourceLabel ? ` من الملف ${snapshot.sourceLabel}` : ''}.`,
    });
    clearAutofillSnapshot();

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('autofill');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const inviteAssistant = () => {
    if (studyLocked) {
      setError('الدراسة مقفلة حالياً ولا يمكن إرسال دعوات جديدة أثناء التقييم الخارجي.');
      return;
    }

    if (!assistantEmail.trim()) {
      setError('أدخل البريد الإلكتروني للباحث المساعد قبل إرسال الدعوة.');
      return;
    }
    setError('');
    setNotice({ tone: 'info', message: `تم تجهيز دعوة الباحث المساعد ${assistantEmail} بصلاحية ${assistantPermission}.` });
    setAssistantInvited(true);
  };

  const linkSupervisor = () => {
    if (studyLocked) {
      setError('تم قفل الدراسة مؤقتاً، لذلك لا يمكن تعديل مسار الإشراف الآن.');
      return;
    }

    if (!supervisorCode.trim()) {
      setError('أدخل رمز المشرف قبل الربط.');
      return;
    }
    setError('');
    setNotice({ tone: 'success', message: 'تم تحديث قناة الإشراف الأكاديمي وربط رمز المشرف الحالي.' });
    setSupervisorLinked(true);
  };

  const openScheduleModal = (event?: CalendarEvent) => {
    if (studyLocked) {
      setError('الدراسة مقفلة حالياً ولا يمكن تعديل المواعيد أثناء التقييم الخارجي.');
      return;
    }

    setError('');
    if (event) {
      setEditingEventId(event.id);
      setSelectedPatientCode(event.patient);
      setAppointmentDate(formatDateInputValue(event.date));
      setAppointmentTime(formatTimeInputValue(event.date));
      setAppointmentType(event.type);
    } else {
      setEditingEventId(null);
      setSelectedPatientCode(patientCodes[0] ?? 'PT-001');
      setAppointmentDate(formatDateInputValue(new Date()));
      setAppointmentTime('12:00');
      setAppointmentType('متابعة دورية');
    }

    setShowScheduleModal(true);
  };

  const openVisitModal = (event: CalendarEvent) => {
    setSelectedCalendarEventId(event.id);
    setSelectedPatientCode(event.patient);
    setVisitNote(event.note ?? '');
    setVisitAttachments(event.attachments ?? []);
    setShowVisitModal(true);
  };

  const saveAppointment = () => {
    if (!appointmentDate || !appointmentTime) {
      setError('يرجى تحديد التاريخ والوقت قبل حفظ الموعد.');
      return;
    }

    const nextDate = new Date(`${appointmentDate}T${appointmentTime}`);
    if (Number.isNaN(nextDate.getTime())) {
      setError('صيغة الموعد غير صحيحة، تحقق من التاريخ والوقت.');
      return;
    }

    setError('');
    setCalendarEvents((current) => {
      if (editingEventId) {
        return current.map((event) =>
          event.id === editingEventId
            ? {
                ...event,
                title: appointmentType,
                patient: selectedPatientCode,
                date: nextDate,
                type: appointmentType,
              }
            : event,
        );
      }

      return [
        ...current,
        {
          id: `manual-${Date.now()}`,
          title: appointmentType,
          patient: selectedPatientCode,
          date: nextDate,
          type: appointmentType,
          status: 'scheduled',
        },
      ];
    });
    setCurrentWeekStart(startOfWeek(nextDate));
    setNotice({
      tone: editingEventId ? 'info' : 'success',
      message: editingEventId ? 'تم تحديث الموعد المحدد داخل التقويم الأسبوعي.' : 'تمت إضافة الموعد الجديد إلى التقويم الأسبوعي.',
    });
    setEditingEventId(null);
    setShowScheduleModal(false);
  };

  const saveVisit = () => {
    if (!selectedCalendarEventId) {
      setShowVisitModal(false);
      return;
    }

    setCalendarEvents((current) =>
      current.map((event) =>
        event.id === selectedCalendarEventId
          ? {
              ...event,
              note: visitNote.trim(),
              attachments: visitAttachments,
              status: 'completed',
            }
          : event,
      ),
    );
    setNotice({ tone: 'success', message: `تم حفظ الزيارة الحالية للمريض ${selectedPatientCode} وتم تحديث حالتها إلى مكتملة.` });
    setSelectedCalendarEventId(null);
    setVisitNote('');
    setVisitAttachments([]);
    setShowVisitModal(false);
  };

  const deleteCalendarEvent = (eventId: string) => {
    if (studyLocked) {
      setError('الدراسة مقفلة حالياً ولا يمكن حذف المواعيد.');
      return;
    }

    const targetEvent = calendarEvents.find((event) => event.id === eventId);
    if (!targetEvent) {
      return;
    }

    if (!window.confirm(`هل تريد حذف الموعد "${targetEvent.title}" للمريض ${targetEvent.patient}؟`)) {
      return;
    }

    setCalendarEvents((current) => current.filter((event) => event.id !== eventId));
    setNotice({ tone: 'warning', message: `تم حذف موعد ${targetEvent.title} من التقويم.` });
  };

  const updateWithdrawDraft = <K extends keyof WithdrawDraft>(key: K, value: WithdrawDraft[K]) => {
    setWithdrawDraft((current) => ({ ...current, [key]: value }));
  };

  const updateWithdrawImpact = (key: WithdrawImpactKey, value: boolean) => {
    setWithdrawDraft((current) => ({
      ...current,
      impacts: {
        ...current.impacts,
        [key]: value,
      },
    }));
  };

  const closeWithdrawModal = () => {
    setShowWithdrawModal(false);
    setWithdrawStep(1);
    setWithdrawDraft(createDefaultWithdrawDraft(selectedPatientCode || patientCodes[0] || 'PT-001'));
  };

  const openWithdrawModal = () => {
    if (studyLocked) {
      setError('تم قفل الدراسة حالياً، ولا يمكن إنشاء طلب انسحاب جديد حتى انتهاء التقييم الخارجي.');
      return;
    }

    setError('');
    setWithdrawStep(1);
    setWithdrawDraft(createDefaultWithdrawDraft(selectedPatientCode || patientCodes[0] || 'PT-001'));
    setShowWithdrawModal(true);
  };

  const validateWithdrawStep = (step: WithdrawStep) => {
    if (step === 1) {
      if (!withdrawDraft.patientCode || !withdrawDraft.reason) {
        setError('اختر المريض وسبب الانسحاب قبل متابعة المسار.');
        return false;
      }
      if (withdrawDraft.reason === 'other' && !withdrawDraft.otherReason.trim()) {
        setError('يرجى توضيح السبب الآخر قبل الانتقال للخطوة التالية.');
        return false;
      }
    }

    if (step === 2) {
      if (!withdrawDraft.withdrawalDate || !withdrawDraft.lastVisit || !withdrawDraft.phase || !withdrawDraft.decisionMaker) {
        setError('أكمل حقول توثيق الانسحاب قبل المتابعة.');
        return false;
      }
    }

    setError('');
    return true;
  };

  const moveWithdrawStep = (direction: -1 | 1) => {
    if (direction === -1) {
      setWithdrawStep((current) => (current === 1 ? 1 : ((current - 1) as WithdrawStep)));
      return;
    }

    if (!validateWithdrawStep(withdrawStep)) {
      return;
    }

    setWithdrawStep((current) => (current === 4 ? 4 : ((current + 1) as WithdrawStep)));
  };

  const executeWithdrawal = () => {
    if (!validateWithdrawStep(1) || !validateWithdrawStep(2)) {
      return;
    }

    const withdrawnPatientCode = withdrawDraft.patientCode;
    const effectiveWithdrawalDate = new Date(`${withdrawDraft.withdrawalDate}T00:00`);

    setCalendarEvents((current) =>
      current.map((event) =>
        event.patient === withdrawnPatientCode && event.date >= effectiveWithdrawalDate
          ? {
              ...event,
              status: 'cancelled',
              note: withdrawDraft.researcherNotes || event.note,
            }
          : event,
      ),
    );

    setStudy((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        enrolledPatients: withdrawDraft.impacts.fullWithdrawal ? Math.max(0, current.enrolledPatients - 1) : current.enrolledPatients,
        targetSampleSize: withdrawDraft.replaceSample ? current.targetSampleSize + 1 : current.targetSampleSize,
      };
    });

    setNotice({
      tone: 'warning',
      message: withdrawDraft.replaceSample
        ? `تم اعتماد طلب انسحاب ${withdrawnPatientCode} مع زيادة حجم العينة المستهدف لتعويض العينة المنسحبة.`
        : `تم اعتماد طلب انسحاب ${withdrawnPatientCode} وإلغاء المواعيد المستقبلية المرتبطة به داخل التقويم.`,
    });
    closeWithdrawModal();
  };

  const confirmLockStudy = async () => {
    if (!study || !token) {
      return;
    }

    try {
      setError('');
      setIsLockingStudy(true);
      const response = await fetch(`${apiBaseUrl}/studies/${study.id}/lock`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to lock study for external evaluation');
      }

      const updatedStudy = (await response.json()) as Study;
      setStudy(updatedStudy);
      setMethodologyDraft((current) => ({ ...current, requiresClinicalEvaluation: true }));
      setShowLockModal(false);
      setNotice({
        tone: 'warning',
        message: updatedStudy.assignedClinicalEvaluatorName
          ? 'تم قفل الدراسة وتفعيل مسار التقييم الخارجي بالمقيّم السريري المرتبط.'
          : 'تم قفل الدراسة وتفعيل مسار التقييم الخارجي، لكن لا يزال تعيين المقيّم السريري مطلوبًا لإكمال المراجعة.',
      });
    } catch {
      setError('تعذر قفل الدراسة حالياً أو تفعيل مسار التقييم الخارجي.');
    } finally {
      setIsLockingStudy(false);
    }
  };

  const weekRangeLabel = useMemo(() => {
    const endDate = new Date(currentWeekStart);
    endDate.setDate(currentWeekStart.getDate() + 6);
    const formatter = new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${formatter.format(currentWeekStart)} — ${formatter.format(endDate)}`;
  }, [currentWeekStart]);

  const evaluationState = study?.requiresClinicalEvaluation ? study.clinicalEvaluationDecision ?? 'pending' : null;
  const evaluationInfo = evaluationState ? clinicalEvaluationMeta[evaluationState] : null;
  const noticeToneClass =
    notice?.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : notice?.tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-sky-200 bg-sky-50 text-sky-700';

  return (
    <ResearchWorkspaceShell
      title="لوحة الدراسة"
      subtitle="إدارة العينات والملفات والتبويبات التشغيلية للدراسة الحالية"
      currentStudyLabel={study ? `${study.title} (${study.studyType})` : undefined}
      navItems={buildResearchWorkspaceNav(id).map((item) => ({
        ...item,
        active:
          (item.key === 'dashboard' && dashboardPath === '/student-dashboard' && false) ||
          (item.key === 'methodology' && activeTab === 'overview') ||
          (item.key === 'samples' && activeTab === 'patients') ||
          (item.key === 'form' && activeTab === 'assessment-form') ||
          (item.key === 'calendar' && activeTab === 'calendar') ||
          (item.key === 'access' && activeTab === 'access') ||
          (item.key === 'analysis' && activeTab === 'analysis'),
      }))}
      actions={
        <>
          <button
            type="button"
            onClick={() => navigate('/studies')}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            الرجوع للدراسات
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" />
            تسجيل الخروج
          </button>
        </>
      }
    >
      <div className="space-y-6">
        {studyLocked ? (
          <div className="rounded-2xl bg-gradient-to-l from-rose-700 via-red-600 to-rose-600 px-6 py-4 text-white shadow-2xl">
            <div className="flex flex-wrap items-center gap-3">
              <Lock className="h-5 w-5" />
              <p className="text-sm font-black">
                الدراسة مقفلة حالياً وتم تجميد الإدخالات التشغيلية حتى انتهاء التقييم الخارجي
                {study?.assignedClinicalEvaluatorName ? ` بواسطة ${study.assignedClinicalEvaluatorName}` : ''}.
              </p>
              {evaluationInfo ? <span className={`rounded-full px-3 py-1 text-[11px] font-black ${evaluationInfo.chip}`}>{evaluationInfo.label}</span> : null}
              <button type="button" onClick={() => selectTab('analysis')} className="mr-auto rounded-xl bg-white/15 px-4 py-2 text-xs font-extrabold transition hover:bg-white/20">
                فتح التقارير النهائية
              </button>
            </div>
          </div>
        ) : null}

        {error ? <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
        {notice ? <div className={`mb-6 rounded-2xl border p-4 text-sm font-bold ${noticeToneClass}`}>{notice.message}</div> : null}

        {isLoading ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-3 text-slate-600">
              <LoaderCircle className="h-5 w-5 animate-spin" />
              <span>جاري تحميل لوحة الدراسة...</span>
            </div>
          </div>
        ) : !study ? null : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="workspace-card p-5">
                <p className="text-sm text-slate-500">نوع الدراسة</p>
                <p className="mt-2 text-lg font-bold text-slate-900">{study.studyType}</p>
              </div>
              <div className="workspace-card p-5">
                <p className="text-sm text-slate-500">حالة الدراسة</p>
                <p className="mt-2 text-lg font-bold text-slate-900">{study.status}</p>
              </div>
              <div className="workspace-card p-5">
                <p className="text-sm text-slate-500">المرضى المستهدفون</p>
                <p className="mt-2 text-lg font-bold text-slate-900">{study.targetSampleSize}</p>
              </div>
              <div className="workspace-card p-5">
                <p className="text-sm text-slate-500">المرضى المسجلون</p>
                <p className="mt-2 text-lg font-bold text-slate-900">{study.enrolledPatients}</p>
              </div>
            </div>

            <div className="workspace-card p-3">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {tabs.map((tab) => (
                  <button key={tab.id} type="button" onClick={() => selectTab(tab.id)} className={`prototype-tab-btn shrink-0 ${activeTab === tab.id ? 'active' : ''}`}>
                    <span>{tab.label}</span>
                    {typeof tab.count === 'number' ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-white text-slate-600'}`}>
                        {tab.count}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            {activeTab === 'overview' ? (
              <div className={`space-y-6 ${studyLocked ? 'pointer-events-none opacity-65' : ''}`}>
                <div className="workspace-card p-5">
                  <div className="mx-auto flex max-w-4xl items-center">
                    {[
                      { step: 1 as const, label: 'إعدادات العشوائية', en: 'Randomization' },
                      { step: 2 as const, label: 'إعدادات التعمية', en: 'Blinding' },
                      { step: 3 as const, label: 'التحقق الذكي والحفظ', en: 'Verify & Save' },
                    ].map((item, index, array) => (
                      <div key={item.step} className="flex flex-1 items-center">
                        <button type="button" onClick={() => setMethodologyStep(item.step)} className="flex flex-col items-center gap-1.5">
                          <div className={`prototype-step-dot ${methodologyStep === item.step ? 'active' : methodologyStep > item.step ? 'done' : ''}`}>
                            {methodologyStep > item.step ? <CheckCircle2 className="h-4 w-4" /> : item.step}
                          </div>
                          <span className="text-xs font-black text-slate-700">{item.label}</span>
                          <span className="text-[9px] font-bold text-slate-300">{item.en}</span>
                        </button>
                        {index < array.length - 1 ? <div className="prototype-step-line" /> : null}
                      </div>
                    ))}
                  </div>
                </div>

                {methodologyStep === 1 ? (
                  <div className="space-y-6">
                    {!methodologyDraft.hasRandomization ? (
                      <div className="workspace-card border-2 border-dashed border-slate-300 p-8 text-center">
                        <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                          <AlertTriangle className="h-7 w-7" />
                        </span>
                        <h4 className="text-lg font-black text-slate-700">خوارزمية التوزيع العشوائي معطلة</h4>
                        <p className="mx-auto mt-2 max-w-xl text-sm font-bold leading-relaxed text-slate-400">
                          يمكنك الإبقاء على الدراسة بمسار مفتوح أو تفعيل العشوائية الآن ليظهر التخصيص الآلي داخل دليل العينات.
                        </p>
                      </div>
                    ) : null}

                    <div className="workspace-card p-6">
                      <h4 className="mb-1 font-black text-slate-800">1. تحديد خوارزمية العشوائية</h4>
                      <p className="mb-5 text-[11px] font-bold text-slate-400">يظهر هذا المعالج عندما تكون العشوائية مفعلة داخل الدراسة</p>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        {[
                          ['simple', 'عشوائية بسيطة', 'Simple Randomization', 'bg-teal-100 text-teal-600'],
                          ['block', 'عشوائية بالكتل المتوازنة', 'Block Randomization', 'bg-violet-100 text-violet-600'],
                          ['block', 'عشوائية طبقية', 'Stratified-ready workflow', 'bg-amber-100 text-amber-600'],
                        ].map(([value, label, helper, tone], index) => (
                          <button
                            key={`${value}-${index}`}
                            type="button"
                            disabled={!methodologyDraft.hasRandomization}
                            onClick={() => updateMethodologyDraft('randomizationMethod', value as RandomizationMethod)}
                            className={`prototype-pick-card text-right ${methodologyDraft.randomizationMethod === value && methodologyDraft.hasRandomization ? 'selected' : ''} ${
                              !methodologyDraft.hasRandomization ? 'cursor-not-allowed opacity-50' : ''
                            }`}
                          >
                            <div className="mb-3 flex items-center justify-between">
                              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
                                <Shuffle className="h-4 w-4" />
                              </span>
                              {methodologyDraft.randomizationMethod === value && methodologyDraft.hasRandomization ? <span className="prototype-pick-check">✓</span> : null}
                            </div>
                            <p className="text-sm font-extrabold text-slate-700">{label}</p>
                            <p className="mt-0.5 text-[10px] font-bold text-slate-400">{helper}</p>
                          </button>
                        ))}
                      </div>

                      <div className="mt-5 grid gap-6 md:grid-cols-2">
                        <div className="rounded-2xl bg-slate-50 p-6">
                          <h4 className="mb-1 font-black text-slate-800">2. نسبة التوزيع</h4>
                          <p className="mb-4 text-[11px] font-bold text-slate-400">Allocation ratio</p>
                          <div className="flex gap-2">
                            {['1 : 1', '2 : 1', '1 : 1 : 1'].map((ratio, index) => (
                              <button key={ratio} type="button" className={`prototype-chip flex-1 justify-center !py-3 ${index === 0 ? 'active' : ''}`}>
                                {ratio}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-6">
                          <h4 className="mb-1 font-black text-slate-800">3. أمان التوزيع</h4>
                          <p className="mb-4 text-[11px] font-bold text-slate-400">Allocation concealment</p>
                          <div className="space-y-2.5">
                            <div className="prototype-pick-card selected !p-3.5">
                              <div className="flex items-center gap-3">
                                <Bot className="h-4 w-4 text-teal-600" />
                                <p className="flex-1 text-xs font-extrabold text-slate-600">أكواد رقمية مخفية التسلسل</p>
                                <span className="prototype-pick-check">✓</span>
                              </div>
                            </div>
                            <div className="prototype-pick-card !p-3.5">
                              <div className="flex items-center gap-3">
                                <Layers3 className="h-4 w-4 text-teal-600" />
                                <p className="flex-1 text-xs font-extrabold text-slate-600">النظام الإلكتروني المؤتمت المركزي</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-xs font-extrabold text-slate-600">المجموعات العلاجية</span>
                          <input
                            type="text"
                            value={methodologyDraft.groupsInput}
                            onChange={(event) => updateMethodologyDraft('groupsInput', event.target.value)}
                            className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-teal-500 focus:bg-white"
                          />
                        </label>
                        <div className="rounded-2xl border border-teal-100 bg-teal-50 p-4">
                          <p className="text-xs font-extrabold text-teal-700">التوزيع المتوقع لكل ذراع</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {normalizeGroups(methodologyDraft.groupsInput || 'Experimental, Control').map((group, index) => (
                              <span key={group} className={`prototype-chip ${index === 0 ? 'active' : ''}`}>
                                {group}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-6 flex justify-end">
                        <button type="button" onClick={() => setMethodologyStep(2)} className="rounded-xl bg-teal-600 px-8 py-3 text-sm font-extrabold text-white shadow-lg shadow-teal-600/25 transition hover:bg-teal-700">
                          التالي: إعدادات التعمية
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {methodologyStep === 2 ? (
                  <div className="space-y-6">
                    {!methodologyDraft.hasBlinding ? (
                      <div className="workspace-card border-2 border-dashed border-slate-300 p-8 text-center">
                        <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                          <EyeOff className="h-7 w-7" />
                        </span>
                        <h4 className="text-lg font-black text-slate-700">دراسة مفتوحة - التعمية غير مفعلة</h4>
                        <p className="mx-auto mt-2 max-w-lg text-sm font-bold leading-relaxed text-slate-400">
                          يمكنك تفعيل التعمية من هذا المعالج ليتم إخفاء المواد والمجموعات تلقائياً في الواجهات المقيدة.
                        </p>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
                      <div className="xl:col-span-3 workspace-card p-6">
                        <h4 className="mb-1 font-black text-slate-800">الخطوة 1: تحديد أطراف التعمية</h4>
                        <p className="mb-5 text-[11px] font-bold text-slate-400">حدد الأشخاص الذين لن يعرفوا التخصيص العلاجي</p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {[
                            ['patient', 'المشارك (المريض)', 'لا يعرف المادة أو المعالجة التي يتلقاها'],
                            ['researcher', 'الباحث / المعالج', 'لا يعرف المادة أو التدخل الذي يطبقه سريرياً'],
                            ['assessor', 'مقيّم النتائج', 'يقيّم النتائج دون معرفة المجموعة العلاجية'],
                            ['statistician', 'المحلل الإحصائي', 'يستلم البيانات مرمزة بالكامل'],
                          ].map(([value, label, helper]) => (
                            <button
                              key={value}
                              type="button"
                              disabled={!methodologyDraft.hasBlinding}
                              onClick={() => toggleMethodologyParty(value as BlindedParty)}
                              className={`prototype-pick-card text-right ${methodologyDraft.blindedParties.includes(value as BlindedParty) && methodologyDraft.hasBlinding ? 'selected' : ''} ${
                                !methodologyDraft.hasBlinding ? 'cursor-not-allowed opacity-50' : ''
                              }`}
                            >
                              <div className="mb-2 flex items-center justify-between">
                                <p className="text-xs font-extrabold text-slate-700">{label}</p>
                                {methodologyDraft.blindedParties.includes(value as BlindedParty) && methodologyDraft.hasBlinding ? <span className="prototype-pick-check">✓</span> : null}
                              </div>
                              <p className="text-[10px] font-bold leading-relaxed text-slate-400">{helper}</p>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="xl:col-span-2 workspace-card p-6">
                        <div className="mb-4 flex items-center gap-2">
                          <Bot className="h-4 w-4 text-teal-500" />
                          <p className="text-xs font-extrabold text-slate-500">الاستنتاج التلقائي للذكاء الاصطناعي</p>
                        </div>
                        <div className="prototype-blind-badge flex min-h-[220px] flex-col items-center justify-center rounded-3xl p-6 text-center">
                          <EyeOff className="mb-3 h-10 w-10" />
                          <p className="text-2xl font-black">{inferBlindingType(methodologyDraft.blindedParties)}</p>
                          <p className="mt-1 text-sm font-extrabold opacity-70">Blinding inference</p>
                          <p className="mt-3 text-[11px] font-bold leading-relaxed opacity-80">
                            Assessor hidden fields: {methodologyDraft.blindedParties.includes('assessor') ? 'Yes' : 'No'} - Dataset coded:{' '}
                            {methodologyDraft.blindedParties.includes('statistician') ? 'Yes' : 'No'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      <div className="workspace-card p-6">
                        <h4 className="mb-1 font-black text-slate-800">الخطوة 2: نطاق التعمية</h4>
                        <p className="mb-4 text-[11px] font-bold text-slate-400">تحديد ما سيتم إخفاؤه وتعميته</p>
                        <div className="flex flex-wrap gap-2">
                          {[
                            ['material_type', 'نوع المادة'],
                            ['treatment_procedure', 'نوع التدخل / المعالجة'],
                            ['split_mouth_side', 'جانب المعالجة'],
                          ].map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              disabled={!methodologyDraft.hasBlinding}
                              onClick={() => toggleMethodologyScope(value as BlindingScope)}
                              className={`prototype-chip ${methodologyDraft.blindingScope.includes(value as BlindingScope) && methodologyDraft.hasBlinding ? 'active' : ''} ${
                                !methodologyDraft.hasBlinding ? 'cursor-not-allowed opacity-50' : ''
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="workspace-card p-6">
                        <h4 className="mb-1 font-black text-slate-800">الخطوة 3: توليد البروتوكول</h4>
                        <p className="mb-4 text-[11px] font-bold text-slate-400">صياغة أكاديمية جاهزة للإدراج المباشر</p>
                        <button
                          type="button"
                          onClick={generateMethodologyProtocol}
                          disabled={!methodologyDraft.hasBlinding}
                          className="rounded-xl bg-teal-600 px-6 py-3 text-sm font-extrabold text-white transition hover:bg-teal-700 disabled:opacity-60"
                        >
                          توليد الفقرة النهائية للبروتوكول
                        </button>
                        <div className="prototype-paper mt-4 p-5">
                          <textarea
                            value={methodologyDraft.blindingProtocolText}
                            onChange={(event) => updateMethodologyDraft('blindingProtocolText', event.target.value)}
                            rows={8}
                            disabled={!methodologyDraft.hasBlinding}
                            className="w-full resize-none bg-transparent text-[13px] font-bold leading-loose text-slate-700 outline-none disabled:opacity-60"
                            placeholder="Generated blinding protocol will appear here."
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between">
                      <button type="button" onClick={() => setMethodologyStep(1)} className="rounded-xl border-2 border-slate-200 px-6 py-3 text-sm font-extrabold text-slate-500 transition hover:border-slate-300">
                        السابق
                      </button>
                      <button type="button" onClick={() => setMethodologyStep(3)} className="rounded-xl bg-teal-600 px-8 py-3 text-sm font-extrabold text-white shadow-lg shadow-teal-600/25 transition hover:bg-teal-700">
                        التالي: التحقق والحفظ
                      </button>
                    </div>
                  </div>
                ) : null}

                {methodologyStep === 3 ? (
                  <div className="workspace-card mx-auto max-w-4xl p-8">
                    <div className="mb-6 text-center">
                      <span className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-100 text-teal-600">
                        <CheckCircle2 className="h-8 w-8" />
                      </span>
                      <h4 className="text-lg font-black text-slate-800">التحقق الذكي والحفظ</h4>
                      <p className="text-[11px] font-bold text-slate-400">يراجع النظام الإعدادات للتحقق من الامتثال وحفظها على الدراسة</p>
                    </div>
                    <div className="mb-6 space-y-3">
                      {[
                        'الامتثال الكامل لمسار الدراسة الحالي وإعداداتها الأساسية',
                        'عدم وجود تعارضات بين المجموعات والعشوائية والتقييم الخارجي',
                        'توافق نوع التعمية مع الأطراف المحددة ونطاق الإخفاء',
                        'جاهزية بروتوكول التعمية للحفظ داخل ملف الدراسة',
                      ].map((item) => (
                        <div key={item} className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                          <p className="flex-1 text-xs font-extrabold text-slate-600">{item}</p>
                          <span className="text-[10px] font-black text-emerald-500">مطابق</span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => void saveMethodologySettings()}
                      disabled={isSavingMethodology}
                      className="w-full rounded-2xl bg-gradient-to-l from-teal-600 to-teal-700 py-4 font-black text-white shadow-xl shadow-teal-600/25 transition hover:from-teal-700 hover:to-teal-800 disabled:opacity-70"
                    >
                      {isSavingMethodology ? 'جاري الحفظ...' : 'الحفظ النهائي للإعدادات على جميع أجزاء الدراسة'}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeTab === 'patients' ? <OutcomeAssessmentManager studyId={study.id} studyType={study.studyType} token={token!} studyFiles={studyFiles} /> : null}
            {activeTab === 'patients' && studyLocked ? (
              <div className="-mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
                تبويب العينات في وضع القراءة فقط لأن الدراسة أُرسلت بالفعل للتقييم الخارجي.
              </div>
            ) : null}

            {activeTab === 'files' ? (
              <div className="workspace-card p-6">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-700" />
                  <h2 className="text-xl font-bold text-slate-900">ملفات الدراسة</h2>
                </div>
                <div className={`prototype-dropzone mt-4 p-4 ${studyLocked ? 'pointer-events-none opacity-60' : ''}`}>
                  <label className="mb-2 block text-sm font-medium text-slate-700">تصنيف الملف</label>
                  <select
                    value={selectedUploadCategory}
                    onChange={(event) => setSelectedUploadCategory(event.target.value as StudyResourceFile['fileCategory'])}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="attachment">مرفق</option>
                    <option value="protocol">بروتوكول</option>
                    <option value="dataset">Dataset</option>
                    <option value="image">Image</option>
                    <option value="report">Report</option>
                  </select>
                  <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700">
                    <Upload className="h-4 w-4" />
                    {isUploading ? 'جاري الرفع...' : 'رفع ملف جديد'}
                    <input type="file" className="hidden" onChange={(event) => void handleFileUpload(event)} />
                  </label>
                </div>

                <div className="mt-4 grid gap-3">
                  {resources.files.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">لا توجد ملفات مرفقة بعد.</div>
                  ) : (
                    resources.files.map((file) => (
                      <div key={file.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-slate-900">{file.originalName}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {file.fileCategory} • {formatDate(file.createdAt)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void downloadFile(file.id, file.originalName)}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <Download className="h-3.5 w-3.5" />
                            تنزيل
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {activeTab === 'assessment-form' ? (
              <div className="workspace-card p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Assessment Form</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      افتح منشئ الاستمارة لإدارة الحقول، نشر نسخة جديدة، واعتماد النسخ المقترحة من المقيمين.
                    </p>
                  </div>
                  <button type="button" onClick={() => navigate(`/studies/${study.id}/assessment-form`)} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700">
                    فتح استمارة الفحص
                  </button>
                </div>
              </div>
            ) : null}

            {activeTab === 'calendar' ? (
              <div className="space-y-6">
                <div className="workspace-card p-6">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <CalendarDays className="h-5 w-5 text-teal-700" />
                        <h2 className="text-xl font-bold text-slate-900">التقويم والزيارات</h2>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">عرض أسبوعي للزيارات الحالية مع تذكير تشغيلي قريب من prototype المرجعي.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="rounded-2xl bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-700">
                        Upcoming visits: {calendarEvents.filter((event) => event.status === 'scheduled').length}
                      </div>
                      <button
                        type="button"
                        onClick={() => openScheduleModal()}
                        disabled={studyLocked}
                        className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-teal-600/25 transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <CalendarPlus2 className="h-4 w-4" />
                        إضافة موعد جديد
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white px-5 py-4 shadow-card">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setCurrentWeekStart((current) => {
                            const next = new Date(current);
                            next.setDate(current.getDate() - 7);
                            return next;
                          })
                        }
                        className="rounded-xl bg-slate-100 p-2.5 text-slate-500 transition hover:bg-slate-200"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                      <div>
                        <h4 className="text-sm font-black text-slate-800">الأسبوع الحالي</h4>
                        <p className="text-[11px] font-bold text-slate-400">{weekRangeLabel}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setCurrentWeekStart((current) => {
                            const next = new Date(current);
                            next.setDate(current.getDate() + 7);
                            return next;
                          })
                        }
                        className="rounded-xl bg-slate-100 p-2.5 text-slate-500 transition hover:bg-slate-200"
                      >
                        <ArrowLeft className="h-4 w-4 rotate-180" />
                      </button>
                    </div>
                    <p className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                      <Bell className="h-3.5 w-3.5 text-teal-500" />
                      يرسل النظام تذكيراً تلقائياً للباحث قبل موعد الزيارة بيومين.
                    </p>
                  </div>
                </div>

                <div className="workspace-card overflow-hidden">
                  <div className="grid grid-cols-7 divide-x divide-x-reverse divide-slate-100 border-b border-slate-100 bg-slate-50">
                    {weeklyCalendar.map((day) => (
                      <div key={`head-${day.key}`} className="px-4 py-3 text-center text-xs font-bold text-slate-500">
                        {new Intl.DateTimeFormat('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' }).format(day.date)}
                      </div>
                    ))}
                  </div>
                  <div className="grid min-h-[320px] grid-cols-7 divide-x divide-x-reverse divide-slate-100">
                    {weeklyCalendar.map((day) => (
                      <div key={day.key} className="space-y-3 p-4">
                        {day.events.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-center text-xs font-medium text-slate-400">
                            لا توجد زيارة
                          </div>
                        ) : (
                          day.events.map((event) => (
                            <div key={event.id} className={`rounded-2xl border p-3 text-right transition ${calendarStatusMeta[event.status].card}`}>
                              <button type="button" onClick={() => openVisitModal(event)} className="w-full text-right">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-bold text-slate-900">{event.title}</p>
                                    <p className="mt-1 text-xs font-semibold text-slate-600">{event.patient}</p>
                                  </div>
                                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${calendarStatusMeta[event.status].badge}`}>
                                    {calendarStatusMeta[event.status].label}
                                  </span>
                                </div>
                                <p className="mt-2 text-[10px] font-bold text-slate-400">
                                  {event.type} • {formatTimeInputValue(event.date)}
                                </p>
                                {event.note ? <p className="mt-2 text-[11px] font-bold text-slate-500">{event.note}</p> : null}
                              </button>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => openVisitModal(event)}
                                  className="rounded-lg bg-white px-3 py-2 text-[11px] font-extrabold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
                                >
                                  فتح الزيارة
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openScheduleModal(event)}
                                  disabled={studyLocked}
                                  className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-[11px] font-extrabold text-sky-700 ring-1 ring-sky-200 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  تعديل
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteCalendarEvent(event.id)}
                                  disabled={studyLocked}
                                  className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-[11px] font-extrabold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  حذف
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === 'access' ? (
              <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="workspace-card p-6">
                  <div className="mb-5 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-600">
                      <UserPlus className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">إدارة الباحث المساعد</h2>
                      <p className="text-[11px] font-bold text-slate-400">إرسال دعوة وتحديد الصلاحيات مسبقاً قبل تفعيل الحساب داخل الدراسة</p>
                    </div>
                  </div>
                  <input
                    value={assistantEmail}
                    onChange={(event) => setAssistantEmail(event.target.value)}
                    type="email"
                    placeholder="البريد الإلكتروني للباحث المساعد"
                    className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-teal-500 focus:bg-white"
                  />
                  <div className="mt-4 grid grid-cols-3 gap-2.5">
                    {[
                      ['read', 'قراءة فقط'],
                      ['edit', 'تحرير كامل'],
                      ['samples', 'إضافة عينات فقط'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setAssistantPermission(value as 'read' | 'edit' | 'samples')}
                        className={`prototype-pick-card relative !p-3 text-center ${assistantPermission === value ? 'selected' : ''}`}
                      >
                        {assistantPermission === value ? <span className="prototype-pick-check !absolute left-2 top-2">✓</span> : null}
                        <p className="text-[10px] font-extrabold text-slate-600">{label}</p>
                      </button>
                    ))}
                  </div>
                  <p className="mt-4 rounded-xl bg-slate-50 p-3 text-[10px] font-bold leading-relaxed text-slate-400">
                    صلاحية "إضافة عينات فقط" تسمح بإدخال عينات جديدة دون تعديل السجل التاريخي للعينة بعد اعتمادها.
                  </p>
                  <button
                    type="button"
                    onClick={inviteAssistant}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-sky-600/25 transition hover:bg-sky-700"
                  >
                    <UserPlus className="h-4 w-4" />
                    إرسال طلب الدعوة
                  </button>

                  <div className="mt-5 space-y-3">
                    <p className="text-[11px] font-black text-slate-400">فريق العمل الحالي:</p>
                    {accessRoles.map((role) => (
                      <div key={role.label} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-black ${role.tone}`}>{role.label.slice(0, 2)}</div>
                        <div className="flex-1">
                          <p className="text-xs font-extrabold text-slate-700">{role.name}</p>
                          <p className="text-[9px] font-bold text-slate-400">{role.label}</p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold ${role.tone}`}>{role.helper}</span>
                      </div>
                    ))}
                    {assistantInvited ? (
                      <div className="flex items-center gap-3 rounded-xl border border-sky-100 bg-sky-50 p-3">
                        <UserRoundCheck className="h-4 w-4 text-sky-600" />
                        <p className="flex-1 text-xs font-extrabold text-slate-700">{assistantEmail}</p>
                        <span className="rounded-full bg-white px-2.5 py-1 text-[9px] font-extrabold text-sky-600">{assistantPermission}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="workspace-card p-6">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
                        <ClipboardList className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">حالة التقييم السريري</h3>
                        <p className="text-[11px] font-bold text-slate-400">ربط الحالة الحالية ببيانات الدراسة الفعلية ومسار القفل التشغيلي.</p>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className={`rounded-2xl p-4 ${evaluationInfo?.tone ?? 'bg-slate-50 text-slate-700'}`}>
                        <p className="text-xs font-black">وضع التقييم الخارجي</p>
                        <p className="mt-2 text-lg font-black">{evaluationInfo?.label ?? 'غير مفعل'}</p>
                        <p className="mt-2 text-[11px] font-bold leading-6">{evaluationInfo?.helper ?? 'يمكن تفعيل المسار لاحقاً عند الحاجة.'}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 text-slate-700">
                        <p className="text-xs font-black">تعيين المقيم</p>
                        <p className="mt-2 text-lg font-black">{study.assignedClinicalEvaluatorName || 'غير معين بعد'}</p>
                        <p className="mt-2 text-[11px] font-bold leading-6">
                          {study.assignedClinicalEvaluatorName
                            ? 'المسار جاهز للإرسال إلى المقيم الخارجي المعين.'
                            : 'سيظل القفل محلياً داخل مساحة العمل حتى يتم تعيين مقيم سريري فعلي.'}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 text-slate-700">
                        <p className="text-xs font-black">إمكانية التعديل</p>
                        <p className="mt-2 text-lg font-black">{studyLocked ? 'Read-only' : 'Live editing'}</p>
                        <p className="mt-2 text-[11px] font-bold leading-6">
                          {studyLocked
                            ? 'تم تجميد التعديلات على المواعيد والملفات والدعوات حتى انتهاء المراجعة.'
                            : 'لا تزال الدراسة قابلة للتحرير مع ظهور تنبيهات تشغيلية دقيقة.'}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 text-slate-700">
                        <p className="text-xs font-black">آخر قرار موثق</p>
                        <p className="mt-2 text-lg font-black">{study.clinicalEvaluatedAt ? formatDate(study.clinicalEvaluatedAt) : 'لا يوجد بعد'}</p>
                        <p className="mt-2 text-[11px] font-bold leading-6">
                          {study.clinicalEvaluatedByName
                            ? `آخر تحديث بواسطة ${study.clinicalEvaluatedByName}.`
                            : 'لم يتم تسجيل قرار سريري نهائي على الدراسة حتى الآن.'}
                        </p>
                      </div>
                    </div>
                    {study.clinicalEvaluationNotes ? (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold leading-7 text-slate-600">
                        <span className="mb-1 block text-xs font-black text-slate-400">ملاحظات المقيم</span>
                        {study.clinicalEvaluationNotes}
                      </div>
                    ) : null}
                  </div>

                  <div className="workspace-card p-6">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
                        <ShieldCheck className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">الإشراف الأكاديمي والحوكمة</h3>
                        <p className="text-[11px] font-bold text-slate-400">ربط المشرف الأكاديمي وتفعيل قناة المراجعة المؤرشفة</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={supervisorCode}
                        onChange={(event) => setSupervisorCode(event.target.value)}
                        type="text"
                        placeholder="SUP-XXXX-0000"
                        className="flex-1 rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition focus:border-teal-500 focus:bg-white"
                      />
                      <button type="button" onClick={linkSupervisor} className="rounded-xl bg-violet-600 px-6 text-xs font-extrabold text-white transition hover:bg-violet-700">
                        ربط
                      </button>
                    </div>
                    {supervisorLinked ? (
                      <div className="mt-4 rounded-2xl border-2 border-violet-100 bg-violet-50/50 p-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-700 text-xs font-black text-white">س ق</div>
                          <div className="flex-1">
                            <p className="text-sm font-extrabold text-slate-700">{study?.supervisorName || 'د. سارة القحطاني'}</p>
                            <p className="text-[10px] font-bold text-slate-400">أستاذ مشارك - قسم تقويم الأسنان - جامعة الملك سعود</p>
                          </div>
                          <span className="rounded-full border border-green-100 bg-green-50 px-2.5 py-1 text-[9px] font-extrabold text-green-600">مرتبط</span>
                        </div>
                        <div className="mt-3 rounded-xl border border-violet-100 bg-white p-3 space-y-2">
                          <p className="rounded-lg rounded-tr-none bg-slate-50 p-2 text-[10px] font-bold text-slate-500">
                            <b className="text-violet-600">المشرف:</b> راجعت بيانات العينات هذا الأسبوع، التوزيع متوازن.
                          </p>
                          <p className="mr-auto rounded-lg rounded-tl-none bg-violet-50 p-2 text-[10px] font-bold text-slate-500">
                            <b className="text-teal-600">أنا:</b> سأرفع تقرير المتابعة النهائي نهاية الشهر.
                          </p>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 space-y-3">
                      <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">لا يتم كشف المادة للمقيّم إذا كانت التعمية مفعلة للمقيم الخارجي.</div>
                      <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">يتم تصدير البيانات الإحصائية بشكل مرمز عند تفعيل تعمية المحلل الإحصائي.</div>
                      <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">يمكن قفل الدراسة قبل الإرسال للتقييم الخارجي لمنع التعديل أثناء المراجعة.</div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
                    <h3 className="text-lg font-bold text-rose-900">قفل الدراسة والتقييم الخارجي</h3>
                    <p className="mt-2 text-sm leading-7 text-rose-800">
                      هذا القسم يحاكي منطق prototype: قفل الدراسة، تجميد الإدخالات، ثم توجيه الملفات والتقييمات إلى المقيم الخارجي بعد اكتمال العيّنات.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button type="button" onClick={() => selectTab('patients')} className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100">
                        مراجعة العينات أولًا
                      </button>
                      <button
                        type="button"
                        onClick={openWithdrawModal}
                        disabled={studyLocked}
                        className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        طلب انسحاب منهجي
                      </button>
                      <button type="button" onClick={() => navigate(`/ai-chat?studyId=${study.id}`)} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">
                        فتح التقارير والتحليل
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowLockModal(true)}
                      disabled={studyLocked || isLockingStudy}
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-red-600 to-rose-600 py-3.5 text-sm font-black text-white shadow-xl shadow-red-600/25 transition hover:from-red-700 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <Lock className="h-4 w-4" />
                      {studyLocked ? 'الدراسة مقفلة بالفعل' : isLockingStudy ? 'جاري تجهيز القفل...' : 'قفل الدراسة وإرسالها للتقييم الخارجي'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === 'analysis' ? (
              <div className="space-y-6">
                <div className="rounded-3xl bg-gradient-to-l from-indigo-950 via-indigo-900 to-teal-950 p-6 text-white shadow-card">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs font-extrabold text-teal-100">Reports & AI Workspace</p>
                      <h2 className="mt-1 text-2xl font-black">مركز التحليل والتقارير النهائية</h2>
                      <p className="mt-2 text-sm text-slate-200">
                        افتح المساعد الذكي والتحليل الإحصائي المرتبط بهذه الدراسة أو راجع التقارير والنتائج المولدة ضمن المسار النهائي.
                      </p>
                    </div>
                    <button type="button" onClick={() => navigate(`/ai-chat?studyId=${study.id}`)} className="rounded-xl bg-white/15 px-5 py-3 text-sm font-extrabold text-white transition hover:bg-white/20">
                      فتح التحليل والمساعد
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  {[
                    { label: 'تقارير محفوظة', value: resources.analyses.length, tone: 'bg-indigo-100 text-indigo-700' },
                    { label: 'ملفات مرتبطة', value: resources.files.length, tone: 'bg-teal-100 text-teal-700' },
                    { label: 'وضع الدراسة', value: studyLocked ? 'Locked' : 'Live', tone: 'bg-amber-100 text-amber-700' },
                  ].map((card) => (
                    <div key={card.label} className="workspace-card p-5">
                      <div className={`inline-flex rounded-2xl px-3 py-2 text-sm font-extrabold ${card.tone}`}>{card.label}</div>
                      <p className="mt-4 text-2xl font-black text-slate-900">{card.value}</p>
                    </div>
                  ))}
                </div>

                <div className="workspace-card p-6">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-bold text-slate-900">التحليلات المحفوظة</h3>
                    <button type="button" onClick={() => navigate(`/ai-chat?studyId=${study.id}`)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-extrabold text-slate-600 transition hover:bg-slate-50">
                      فتح مساحة التقارير الكاملة
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3">
                    {resources.analyses.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                        لا توجد تحليلات محفوظة لهذه الدراسة بعد.
                      </div>
                    ) : (
                      resources.analyses.map((analysis) => (
                        <div key={analysis.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="font-medium text-slate-900">{analysis.title}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {analysis.analysisType || 'Analysis'} • {formatDate(analysis.createdAt)}
                          </p>
                          <div className="mt-3 flex gap-2">
                            <button type="button" onClick={() => navigate(`/ai-chat?studyId=${study.id}`)} className="rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-extrabold text-white">
                              متابعة
                            </button>
                            <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[11px] font-extrabold text-slate-600">
                              PDF
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {showScheduleModal ? (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
                <CalendarPlus2 className="h-5 w-5" />
              </span>
              <div>
                <h4 className="font-black text-slate-800">{editingEventId ? 'تعديل موعد' : 'تحديد موعد'}</h4>
                <p className="text-[10px] font-bold text-slate-400">
                  {editingEventId ? 'تحديث بيانات الموعد الحالي داخل التقويم' : 'يفتح التقويم التفاعلي تلقائياً لتسجيل الموعد الجديد'}
                </p>
              </div>
            </div>
            <div className="space-y-3.5">
              <div className="prototype-field-box">
                <p className="mb-1 text-[9px] text-slate-400">المريض</p>
                <select value={selectedPatientCode} onChange={(event) => setSelectedPatientCode(event.target.value)}>{patientCodes.map((code) => <option key={code}>{code}</option>)}</select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="prototype-field-box">
                  <p className="mb-1 text-[9px] text-slate-400">التاريخ</p>
                  <input type="date" value={appointmentDate} onChange={(event) => setAppointmentDate(event.target.value)} />
                </div>
                <div className="prototype-field-box">
                  <p className="mb-1 text-[9px] text-slate-400">الوقت</p>
                  <input type="time" value={appointmentTime} onChange={(event) => setAppointmentTime(event.target.value)} />
                </div>
              </div>
              <div className="prototype-field-box">
                <p className="mb-1 text-[9px] text-slate-400">نوع الموعد</p>
                <select value={appointmentType} onChange={(event) => setAppointmentType(event.target.value)}>
                  {['متابعة دورية', 'شد وتنشيط', 'تركيب جهاز', 'أخذ قياسات', 'فك الجهاز'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setEditingEventId(null);
                  setShowScheduleModal(false);
                }}
                className="flex-1 rounded-xl border-2 border-slate-200 py-3 text-sm font-extrabold text-slate-500 transition hover:border-slate-300"
              >
                إلغاء
              </button>
              <button type="button" onClick={saveAppointment} className="flex-1 rounded-xl bg-sky-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-sky-600/25 transition hover:bg-sky-700">
                {editingEventId ? 'حفظ التعديلات' : 'تسجيل الموعد'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showVisitModal ? (
        <div className="fixed inset-0 z-[84] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-100 text-teal-600">
                <MessageSquare className="h-5 w-5" />
              </span>
              <div>
                <h4 className="font-black text-slate-800">إضافة زيارة</h4>
                <p className="text-[10px] font-bold text-slate-400">
                  المريض: <b className="text-teal-600">{selectedPatientCode}</b>
                  {selectedCalendarEvent ? ` • ${selectedCalendarEvent.title}` : ''}
                </p>
              </div>
            </div>
            <div className="space-y-3.5">
              {selectedCalendarEvent ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${calendarStatusMeta[selectedCalendarEvent.status].badge}`}>
                      {calendarStatusMeta[selectedCalendarEvent.status].label}
                    </span>
                    <span className="text-[11px] font-bold text-slate-500">
                      {formatDateInputValue(selectedCalendarEvent.date)} • {formatTimeInputValue(selectedCalendarEvent.date)}
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="prototype-field-box">
                <p className="mb-1 text-[9px] text-slate-400">ملاحظات الزيارة الحالية</p>
                <textarea rows={4} value={visitNote} onChange={(event) => setVisitNote(event.target.value)} placeholder="اكتب الملاحظات السريرية لهذه الزيارة..." />
              </div>
              <div className="prototype-dropzone p-4 text-center">
                <Paperclip className="mx-auto h-5 w-5 text-slate-300" />
                <p className="mt-1 text-[11px] font-extrabold text-slate-500">إرفاق ملفات أو صور جديدة</p>
                <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-4 py-2 text-[11px] font-extrabold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50">
                  <FileText className="h-3.5 w-3.5" />
                  اختيار ملفات
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => setVisitAttachments(Array.from(event.target.files ?? []).map((file) => file.name))}
                  />
                </label>
                {visitAttachments.length ? (
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {visitAttachments.map((attachment) => (
                      <span key={attachment} className="rounded-full bg-white px-3 py-1 text-[10px] font-black text-slate-600 ring-1 ring-slate-200">
                        {attachment}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setShowVisitModal(false)} className="flex-1 rounded-xl border-2 border-slate-200 py-3 text-sm font-extrabold text-slate-500 transition hover:border-slate-300">إلغاء</button>
              <button type="button" onClick={saveVisit} className="flex-1 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-teal-600/25 transition hover:bg-teal-700">حفظ الزيارة</button>
            </div>
          </div>
        </div>
      ) : null}

      {showWithdrawModal ? (
        <div className="fixed inset-0 z-[83] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white p-7 shadow-2xl">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-100 text-rose-500">
                  <LogOut className="h-5 w-5" />
                </span>
                <div>
                  <h4 className="font-black text-slate-800">بدء طلب الانسحاب</h4>
                  <p className="text-[10px] font-bold text-slate-400">
                    المريض: <b className="text-rose-500">{withdrawDraft.patientCode || '—'}</b> — نافذة متسلسلة عبر خطوات مفصلة
                  </p>
                </div>
              </div>
              <button type="button" onClick={closeWithdrawModal} className="rounded-xl bg-slate-100 p-2 text-slate-400 transition hover:bg-slate-200">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-6 flex items-center">
              {[
                { step: 1 as const, label: 'السبب' },
                { step: 2 as const, label: 'التوثيق' },
                { step: 3 as const, label: 'التأثير' },
                { step: 4 as const, label: 'المراجعة' },
              ].map((item, index, array) => (
                <div key={item.step} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center gap-1">
                    <div className={`prototype-step-dot ${withdrawStep === item.step ? 'active' : withdrawStep > item.step ? 'done' : ''}`}>{item.step}</div>
                    <span className="text-[9px] font-extrabold text-slate-400">{item.label}</span>
                  </div>
                  {index < array.length - 1 ? <div className="prototype-step-line" /> : null}
                </div>
              ))}
            </div>

            {withdrawStep === 1 ? (
              <div className="space-y-3">
                <p className="text-xs font-extrabold text-slate-600">الخطوة 1: تحديد سبب الانسحاب من القائمة المنسدلة</p>
                <div className="prototype-field-box">
                  <p className="mb-1 text-[9px] text-slate-400">المريض</p>
                  <select value={withdrawDraft.patientCode} onChange={(event) => updateWithdrawDraft('patientCode', event.target.value)}>
                    {patientCodes.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="prototype-field-box">
                  <p className="mb-1 text-[9px] text-slate-400">سبب الانسحاب</p>
                  <select value={withdrawDraft.reason} onChange={(event) => updateWithdrawDraft('reason', event.target.value)}>
                    <option value="">— اختر السبب —</option>
                    <option value="انسحاب المشارك برغبته">انسحاب المشارك برغبته</option>
                    <option value="فقدان المتابعة (Lost to Follow-up)">فقدان المتابعة (Lost to Follow-up)</option>
                    <option value="عدم الالتزام بالزيارات">عدم الالتزام بالزيارات</option>
                    <option value="مخالفة البروتوكول">مخالفة البروتوكول</option>
                    <option value="ظهور حدث ضار (AE)">ظهور حدث ضار (AE)</option>
                    <option value="ظهور حدث ضار خطير (SAE)">ظهور حدث ضار خطير (SAE)</option>
                    <option value="عدم استيفاء معايير الإدراج">عدم استيفاء معايير الإدراج</option>
                    <option value="استبعاد بقرار الباحث">استبعاد بقرار الباحث</option>
                    <option value="الوفاة">الوفاة</option>
                    <option value="other">سبب آخر...</option>
                  </select>
                </div>
                {withdrawDraft.reason === 'other' ? (
                  <div className="prototype-field-box">
                    <p className="mb-1 text-[9px] text-slate-400">تفصيل السبب الآخر</p>
                    <textarea rows={3} value={withdrawDraft.otherReason} onChange={(event) => updateWithdrawDraft('otherReason', event.target.value)} placeholder="اكتب تفاصيل السبب..." />
                  </div>
                ) : null}
              </div>
            ) : null}

            {withdrawStep === 2 ? (
              <div className="space-y-3">
                <p className="text-xs font-extrabold text-slate-600">الخطوة 2: توثيق الانسحاب</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="prototype-field-box">
                    <p className="mb-1 text-[9px] text-slate-400">تاريخ الانسحاب</p>
                    <input type="date" value={withdrawDraft.withdrawalDate} onChange={(event) => updateWithdrawDraft('withdrawalDate', event.target.value)} />
                  </div>
                  <div className="prototype-field-box">
                    <p className="mb-1 text-[9px] text-slate-400">آخر زيارة مكتملة</p>
                    <select value={withdrawDraft.lastVisit} onChange={(event) => updateWithdrawDraft('lastVisit', event.target.value)}>
                      <option>الزيارة الأولى</option>
                      <option>الزيارة الثانية</option>
                      <option>الزيارة الثالثة</option>
                      <option>الزيارة الرابعة</option>
                    </select>
                  </div>
                  <div className="prototype-field-box">
                    <p className="mb-1 text-[9px] text-slate-400">المرحلة الزمنية</p>
                    <select value={withdrawDraft.phase} onChange={(event) => updateWithdrawDraft('phase', event.target.value)}>
                      <option>مرحلة التركيب</option>
                      <option>مرحلة التنشيط والمتابعة</option>
                      <option>مرحلة التثبيت</option>
                    </select>
                  </div>
                  <div className="prototype-field-box">
                    <p className="mb-1 text-[9px] text-slate-400">متخذ القرار</p>
                    <select value={withdrawDraft.decisionMaker} onChange={(event) => updateWithdrawDraft('decisionMaker', event.target.value)}>
                      <option>المشارك</option>
                      <option>الباحث</option>
                      <option>الطبيب</option>
                      <option>لجنة الأخلاقيات</option>
                    </select>
                  </div>
                </div>
                <div className="prototype-field-box">
                  <p className="mb-1 text-[9px] text-slate-400">ملاحظات الباحث</p>
                  <textarea rows={3} value={withdrawDraft.researcherNotes} onChange={(event) => updateWithdrawDraft('researcherNotes', event.target.value)} placeholder="أي ملاحظات إضافية حول ظروف الانسحاب..." />
                </div>
              </div>
            ) : null}

            {withdrawStep === 3 ? (
              <div className="space-y-2.5">
                <p className="text-xs font-extrabold text-slate-600">الخطوة 3: تأثير الانسحاب على الدراسة</p>
                {[
                  ['stopTreatmentOnly', 'إيقاف العلاج فقط؟'],
                  ['continueFollowUp', 'الاستمرار في المتابعة؟'],
                  ['fullWithdrawal', 'الانسحاب الكامل من الدراسة؟'],
                  ['keepHistoricalData', 'السماح باستخدام البيانات السابقة؟'],
                ].map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between rounded-xl border-2 border-slate-100 p-3.5">
                    <p className="text-xs font-extrabold text-slate-600">{label}</p>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => updateWithdrawImpact(key as WithdrawImpactKey, true)}
                        className={`rounded-xl border px-4 py-1.5 text-xs font-black transition ${
                          withdrawDraft.impacts[key as WithdrawImpactKey]
                            ? 'border-teal-600 bg-teal-600 text-white shadow-lg shadow-teal-600/20'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-teal-200'
                        }`}
                      >
                        نعم
                      </button>
                      <button
                        type="button"
                        onClick={() => updateWithdrawImpact(key as WithdrawImpactKey, false)}
                        className={`rounded-xl border px-4 py-1.5 text-xs font-black transition ${
                          !withdrawDraft.impacts[key as WithdrawImpactKey]
                            ? 'border-teal-600 bg-teal-600 text-white shadow-lg shadow-teal-600/20'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-teal-200'
                        }`}
                      >
                        لا
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-xl border-2 border-teal-100 bg-teal-50/60 p-3.5">
                  <p className="text-xs font-extrabold text-teal-700">هل سيتم استبدال العينة؟</p>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateWithdrawDraft('replaceSample', true)}
                      className={`rounded-xl border px-4 py-1.5 text-xs font-black transition ${
                        withdrawDraft.replaceSample
                          ? 'border-teal-600 bg-teal-600 text-white shadow-lg shadow-teal-600/20'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-teal-200'
                      }`}
                    >
                      نعم
                    </button>
                    <button
                      type="button"
                      onClick={() => updateWithdrawDraft('replaceSample', false)}
                      className={`rounded-xl border px-4 py-1.5 text-xs font-black transition ${
                        !withdrawDraft.replaceSample
                          ? 'border-teal-600 bg-teal-600 text-white shadow-lg shadow-teal-600/20'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-teal-200'
                      }`}
                    >
                      لا
                    </button>
                  </div>
                </div>
                {withdrawDraft.replaceSample ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-[11px] font-extrabold leading-6 text-emerald-700">
                    سيقوم النظام بزيادة حجم العينة المطلوب للدراسة بمقدار (+1) لتعويض العينة المنسحبة.
                  </div>
                ) : null}
              </div>
            ) : null}

            {withdrawStep === 4 ? (
              <div className="space-y-4">
                <p className="text-xs font-extrabold text-slate-600">الخطوة 4: مراجعة الطلب قبل الإرسال</p>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[11px] font-bold leading-7 text-slate-600">
                  <p><b className="text-slate-800">المريض:</b> {withdrawDraft.patientCode}</p>
                  <p><b className="text-slate-800">السبب:</b> {withdrawDraft.reason === 'other' ? withdrawDraft.otherReason : withdrawDraft.reason || 'غير محدد'}</p>
                  <p><b className="text-slate-800">التاريخ:</b> {withdrawDraft.withdrawalDate}</p>
                  <p><b className="text-slate-800">آخر زيارة:</b> {withdrawDraft.lastVisit}</p>
                  <p><b className="text-slate-800">المرحلة:</b> {withdrawDraft.phase}</p>
                  <p><b className="text-slate-800">متخذ القرار:</b> {withdrawDraft.decisionMaker}</p>
                  <p><b className="text-slate-800">الانسحاب الكامل:</b> {withdrawDraft.impacts.fullWithdrawal ? 'نعم' : 'لا'}</p>
                  <p><b className="text-slate-800">استخدام البيانات السابقة:</b> {withdrawDraft.impacts.keepHistoricalData ? 'نعم' : 'لا'}</p>
                  <p><b className="text-slate-800">استبدال العينة:</b> {withdrawDraft.replaceSample ? 'نعم' : 'لا'}</p>
                </div>
                <div className="prototype-dropzone p-4 text-center">
                  <p className="text-[11px] font-extrabold text-slate-500">رفع المستندات الداعمة</p>
                  <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-4 py-2 text-[11px] font-extrabold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50">
                    <Upload className="h-3.5 w-3.5" />
                    إرفاق مستندات
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => updateWithdrawDraft('attachments', Array.from(event.target.files ?? []).map((file) => file.name))}
                    />
                  </label>
                  {withdrawDraft.attachments.length ? (
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      {withdrawDraft.attachments.map((attachment) => (
                        <span key={attachment} className="rounded-full bg-white px-3 py-1 text-[10px] font-black text-slate-600 ring-1 ring-slate-200">
                          {attachment}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-sky-100 bg-sky-50 p-3.5 text-[10px] font-bold leading-6 text-sky-700">
                  يوجد مشرف أكاديمي مرتبط، لذلك سيُرسل الطلب للمراجعة مع توثيق القرار ضمن مسار الدراسة التشغيلي.
                </div>
              </div>
            ) : null}
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={closeWithdrawModal} className="rounded-xl border-2 border-slate-200 px-6 py-3 text-sm font-extrabold text-slate-500 transition hover:border-slate-300">
                إلغاء
              </button>
              {withdrawStep > 1 ? (
                <button type="button" onClick={() => moveWithdrawStep(-1)} className="rounded-xl border-2 border-slate-200 px-6 py-3 text-sm font-extrabold text-slate-500 transition hover:border-slate-300">
                  السابق
                </button>
              ) : null}
              {withdrawStep < 4 ? (
                <button type="button" onClick={() => moveWithdrawStep(1)} className="flex-1 rounded-xl bg-slate-800 py-3 text-sm font-extrabold text-white transition hover:bg-slate-900">
                  التالي
                </button>
              ) : (
                <button type="button" onClick={executeWithdrawal} className="flex-1 rounded-xl bg-gradient-to-l from-red-600 to-rose-600 py-3 text-sm font-black text-white shadow-lg shadow-red-600/25 transition hover:from-red-700">
                  إرسال للمشرف واعتماد الانسحاب
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showLockModal ? (
        <div className="fixed inset-0 z-[82] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
                <Lock className="h-6 w-6" />
              </span>
              <div>
                <h4 className="font-black text-slate-800">تأكيد القفل والإرسال</h4>
                <p className="text-[10px] font-bold text-slate-400">سيتم تجميد الإدخالات وإرسال الدراسة للمقيم الخارجي</p>
              </div>
            </div>
            <p className="rounded-2xl bg-rose-50 p-4 text-sm font-bold leading-7 text-rose-800">
              بعد تأكيد هذه الخطوة يتم إيقاف تعديل الدراسة مؤقتاً، وتعطيل إضافة العينات الجديدة، وإظهار شريط القفل في أعلى مساحة العمل.
            </p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setShowLockModal(false)} className="flex-1 rounded-xl border-2 border-slate-200 py-3 text-sm font-extrabold text-slate-500 transition hover:border-slate-300">تراجع</button>
              <button
                type="button"
                onClick={() => void confirmLockStudy()}
                disabled={isLockingStudy}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-red-600/25 transition hover:bg-red-700 disabled:opacity-60"
              >
                {isLockingStudy ? 'جاري الإرسال...' : 'تأكيد القفل'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ResearchWorkspaceShell>
  );
}

export default StudyDashboard;
