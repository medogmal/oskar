import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LoaderCircle, MessageSquare, Plus, Send, ShieldCheck, UserRoundSearch } from 'lucide-react';
import { apiBaseUrl } from '../lib/auth';

type StudyFileOption = {
  id: string;
  originalName: string;
};

type AssessorDirectoryEntry = {
  id: string;
  fullName: string;
  academicId?: string;
  specialization?: string;
  university?: string;
  academicRank?: string;
  studiesEvaluated: number;
  completedAssessments: number;
  averageCompletionHours: number | null;
  availabilityStatus: 'available' | 'busy' | 'unavailable';
};

type AssessmentRequestSummary = {
  id: string;
  assessorName?: string;
  assessorAcademicId?: string;
  requestStatus: 'new' | 'accepted' | 'rejected' | 'active' | 'completed' | 'archived';
  assessmentType: string;
  deadlineAt?: string;
  samplesRequired: number;
  samplesSubmitted: number;
  optionalMessage?: string;
};

type AssessmentSampleSummary = {
  id: string;
  subjectId: string;
  visitNumber: string;
  inclusionEligible: boolean;
  allocatedGroup?: string;
  maskedGroupCode?: string;
  sampleStatus: 'pending' | 'in_progress' | 'submitted' | 'reopened';
  assets: Array<{
    id: string;
    fileId: string;
    originalName: string;
    assetType: string;
  }>;
};

type AssessmentTemplateField = {
  id: string;
  label: string;
  responseType: 'numeric' | 'choice' | 'text' | 'boolean';
  options?: string[];
};

type AssessmentTemplateVersion = {
  id: string;
  versionNumber: number;
  approvalStatus: 'approved' | 'pending_approval' | 'rejected';
  createdByName?: string;
  approvedByName?: string;
  changeNotes?: string;
  template: AssessmentTemplateField[];
  createdAt: string;
};

type AssessmentNote = {
  id: string;
  authorName?: string;
  message: string;
  createdAt: string;
};

type OutcomeAssessmentOverview = {
  requests: AssessmentRequestSummary[];
  samples: AssessmentSampleSummary[];
  templateVersions: AssessmentTemplateVersion[];
  approvedTemplate?: AssessmentTemplateVersion | null;
};

type OutcomeAssessmentManagerProps = {
  studyId: string;
  studyType: string;
  token: string;
  studyFiles: StudyFileOption[];
};

function OutcomeAssessmentManager({
  studyId,
  studyType,
  token,
  studyFiles,
}: OutcomeAssessmentManagerProps) {
  const [overview, setOverview] = useState<OutcomeAssessmentOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [isSubmittingSample, setIsSubmittingSample] = useState(false);
  const [assessorSearch, setAssessorSearch] = useState('');
  const [assessors, setAssessors] = useState<AssessorDirectoryEntry[]>([]);
  const [selectedAssessorIds, setSelectedAssessorIds] = useState<string[]>([]);
  const [assessmentType, setAssessmentType] = useState('Primary outcome review');
  const [deadlineAt, setDeadlineAt] = useState('');
  const [samplesRequired, setSamplesRequired] = useState('0');
  const [optionalMessage, setOptionalMessage] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [visitNumber, setVisitNumber] = useState('');
  const [inclusionEligible, setInclusionEligible] = useState(true);
  const [sampleAssetType, setSampleAssetType] = useState<'photo_before' | 'photo_after' | 'xray_before' | 'xray_after' | 'stl' | 'lab_result' | 'other'>('photo_before');
  const [linkedFileId, setLinkedFileId] = useState('');
  const [activeNotesRequestId, setActiveNotesRequestId] = useState<string | null>(null);
  const [notes, setNotes] = useState<AssessmentNote[]>([]);
  const [noteMessage, setNoteMessage] = useState('');
  const [showEligibilityModal, setShowEligibilityModal] = useState(false);
  const [eligibilityStage, setEligibilityStage] = useState<'question' | 'fail' | 'form'>('question');
  const [activeSampleId, setActiveSampleId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const formatDate = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(value)),
    [],
  );

  const loadOverview = useCallback(async () => {
    try {
      setError('');
      setIsLoading(true);
      const response = await fetch(`${apiBaseUrl}/studies/${studyId}/outcome-assessment/overview`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load outcome assessment overview');
      }

      const data = (await response.json()) as OutcomeAssessmentOverview;
      setOverview(data);
    } catch {
      setError('Unable to load outcome assessment workspace.');
      setOverview(null);
    } finally {
      setIsLoading(false);
    }
  }, [studyId, token]);

  const loadAssessors = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (assessorSearch.trim()) {
        query.set('search', assessorSearch.trim());
      }

      const response = await fetch(`${apiBaseUrl}/auth/outcome-assessors?${query.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load assessors');
      }

      const data = (await response.json()) as AssessorDirectoryEntry[];
      setAssessors(data);
    } catch {
      setAssessors([]);
    }
  }, [assessorSearch, token]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadAssessors();
  }, [loadAssessors]);

  const pendingTemplateVersions = useMemo(
    () => overview?.templateVersions.filter((item) => item.approvalStatus === 'pending_approval') ?? [],
    [overview],
  );

  const activeSample = useMemo(
    () => overview?.samples.find((sample) => sample.id === activeSampleId) ?? null,
    [activeSampleId, overview?.samples],
  );

  const openEligibilityModal = () => {
    setEligibilityStage('question');
    setSubjectId('');
    setVisitNumber('');
    setInclusionEligible(true);
    setLinkedFileId('');
    setShowEligibilityModal(true);
  };

  const handleEligibilityAnswer = (eligible: boolean) => {
    setInclusionEligible(eligible);
    setEligibilityStage(eligible ? 'form' : 'fail');
  };

  const handleAssessorToggle = (assessorId: string) => {
    setSelectedAssessorIds((current) => {
      if (current.includes(assessorId)) {
        return current.filter((item) => item !== assessorId);
      }

      if (current.length >= 3) {
        return current;
      }

      return [...current, assessorId];
    });
  };

  const handleSendRequest = async () => {
    if (selectedAssessorIds.length === 0) {
      setError('Select at least one assessor.');
      return;
    }

    try {
      setError('');
      setIsSubmittingRequest(true);

      const response = await fetch(`${apiBaseUrl}/studies/${studyId}/outcome-assessment/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          assessorUserIds: selectedAssessorIds,
          assessmentType,
          deadlineAt: deadlineAt || undefined,
          samplesRequired: Number(samplesRequired || 0),
          optionalMessage,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to send assessment request');
      }

      setSelectedAssessorIds([]);
      setOptionalMessage('');
      await loadOverview();
    } catch {
      setError('Unable to send outcome assessment request.');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleAddSample = async () => {
    if (!subjectId.trim() || !visitNumber.trim()) {
      setError('Subject ID and visit number are required.');
      return;
    }

    try {
      setError('');
      setIsSubmittingSample(true);

      const assetLinks = linkedFileId
        ? [
            {
              fileId: linkedFileId,
              assetType: sampleAssetType,
            },
          ]
        : [];

      const response = await fetch(`${apiBaseUrl}/studies/${studyId}/outcome-assessment/samples`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          samples: [
            {
              subjectId,
              visitNumber,
                      inclusionEligible,
              assetLinks,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to add sample');
      }

      setSubjectId('');
      setVisitNumber('');
      setInclusionEligible(true);
      setLinkedFileId('');
      setEligibilityStage('question');
      setShowEligibilityModal(false);
      await loadOverview();
    } catch {
      setError('Unable to save sample for outcome assessment.');
    } finally {
      setIsSubmittingSample(false);
    }
  };

  const loadNotes = async (requestId: string) => {
    try {
      setError('');
      setActiveNotesRequestId(requestId);
      const response = await fetch(`${apiBaseUrl}/studies/${studyId}/outcome-assessment/requests/${requestId}/notes`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load notes');
      }

      const data = (await response.json()) as AssessmentNote[];
      setNotes(data);
    } catch {
      setNotes([]);
      setError('Unable to load assessor notes.');
    }
  };

  const handleSendNote = async () => {
    if (!activeNotesRequestId || !noteMessage.trim()) {
      return;
    }

    try {
      setError('');
      const response = await fetch(
        `${apiBaseUrl}/studies/${studyId}/outcome-assessment/requests/${activeNotesRequestId}/notes`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: noteMessage,
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Unable to send note');
      }

      setNoteMessage('');
      await loadNotes(activeNotesRequestId);
    } catch {
      setError('Unable to send note to assessor thread.');
    }
  };

  const handleApproveTemplate = async (versionId: string) => {
    try {
      setError('');
      const response = await fetch(`${apiBaseUrl}/studies/${studyId}/outcome-assessment/template/${versionId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to approve template version');
      }

      await loadOverview();
    } catch {
      setError('Unable to approve proposed assessment template.');
    }
  };

  return (
    <section className="mt-6 space-y-6">
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-card">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <span>Loading outcome assessment module...</span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-2xl bg-white px-5 py-3 shadow-card">
              <p className="text-xs font-extrabold text-slate-600">حجم العينة المطلوب: <b className="text-sm text-teal-600">{Number(samplesRequired || 0) || overview?.samples.length || 0}</b> عينة</p>
            </div>
            <div className="rounded-2xl bg-white px-5 py-3 shadow-card">
              <p className="text-xs font-extrabold text-slate-600">المسجل حالياً: <b className="text-sm text-slate-800">{overview?.samples.length ?? 0}</b> عينة</p>
            </div>
            <button
              type="button"
              onClick={openEligibilityModal}
              className="mr-auto inline-flex items-center gap-2 rounded-2xl bg-gradient-to-l from-teal-600 to-teal-700 px-6 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-teal-600/25 transition hover:from-teal-700"
            >
              <Plus className="h-4 w-4" />
              تسجيل عينة جديدة
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-white px-5 py-3.5 shadow-card">
            <p className="text-[11px] font-black text-slate-400">مفتاح الحالات المنهجية:</p>
            <span className="prototype-badge prototype-badge-active"><span className="prototype-badge-dot" />نشطة</span>
            <span className="prototype-badge prototype-badge-completed"><span className="prototype-badge-dot" />مكتملة</span>
            <span className="prototype-badge prototype-badge-withdrawn"><span className="prototype-badge-dot" />منسحبة</span>
            <span className="prototype-badge prototype-badge-lost"><span className="prototype-badge-dot" />قيد التنفيذ</span>
            <span className="prototype-badge prototype-badge-excluded"><span className="prototype-badge-dot" />مستبعدة</span>
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h4 className="font-black text-slate-700">سجل المرضى والعينات</h4>
              <p className="text-[10px] font-bold text-slate-400">يظهر تخصيص المجموعة الفعلي والمرمز مع كل عينة مؤهلة</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-[11px] font-black text-slate-400">
                    <th className="px-6 py-3.5 text-right">كود العينة</th>
                    <th className="px-4 py-3.5 text-right">الزيارة</th>
                    <th className="px-4 py-3.5 text-right">المجموعة العلاجية</th>
                    <th className="px-4 py-3.5 text-right">الحالة المنهجية</th>
                    <th className="px-4 py-3.5 text-right">الأصول المرفقة</th>
                    <th className="px-4 py-3.5 text-center">إجراءات العينة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(overview?.samples ?? []).map((sample) => (
                    <tr key={sample.id}>
                      <td className="px-6 py-4 text-sm font-extrabold text-slate-800">{sample.subjectId}</td>
                      <td className="px-4 py-4 text-xs font-bold text-slate-500">Visit {sample.visitNumber}</td>
                      <td className="px-4 py-4">
                        {sample.allocatedGroup ? (
                          <div className="text-xs font-extrabold text-emerald-700">
                            {sample.allocatedGroup}
                            {sample.maskedGroupCode ? <span className="mr-1 text-slate-400">({sample.maskedGroupCode})</span> : null}
                          </div>
                        ) : (
                          <span className="text-xs font-bold text-slate-400">{sample.inclusionEligible ? 'بانتظار التخصيص' : 'غير مؤهل'}</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`prototype-badge ${
                          sample.sampleStatus === 'submitted'
                            ? 'prototype-badge-completed'
                            : sample.inclusionEligible
                              ? 'prototype-badge-active'
                              : 'prototype-badge-excluded'
                        }`}>
                          <span className="prototype-badge-dot" />
                          {sample.sampleStatus}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs font-bold text-slate-500">{sample.assets.length} ملف</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveSampleId(sample.id)}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            عرض
                          </button>
                          <button
                            type="button"
                            onClick={() => setEligibilityStage('form')}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            تحديث
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-6 py-3.5 text-[10px] font-bold text-slate-400">
              عند اكتمال التقييم يمكن قفل العينة ومنع تعديلها مع حفظ سجلها التاريخي داخل الدراسة.
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="flex items-center gap-2">
                <UserRoundSearch className="h-4 w-4 text-slate-600" />
                <p className="font-semibold text-slate-900">Assessor Directory</p>
              </div>
              <p className="mt-1 text-sm text-slate-500">Search by name, Assessor ID, specialization, or university.</p>

              <input
                type="text"
                value={assessorSearch}
                onChange={(event) => setAssessorSearch(event.target.value)}
                className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search assessor directory"
              />

              <div className="mt-4 max-h-72 space-y-3 overflow-y-auto">
                {assessors.map((assessor) => {
                  const selected = selectedAssessorIds.includes(assessor.id);

                  return (
                    <button
                      key={assessor.id}
                      type="button"
                      onClick={() => handleAssessorToggle(assessor.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        selected ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{assessor.fullName}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {assessor.academicId || 'No Assessor ID'} • {assessor.specialization || 'General'} • {assessor.university || 'Unspecified'}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            assessor.availabilityStatus === 'available'
                              ? 'bg-emerald-100 text-emerald-700'
                              : assessor.availabilityStatus === 'busy'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {assessor.availabilityStatus}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <p className="font-semibold text-slate-900">Create Assessment Request</p>
              <p className="mt-1 text-sm text-slate-500">{studyType}</p>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Assessment type</label>
                  <input
                    type="text"
                    value={assessmentType}
                    onChange={(event) => setAssessmentType(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Samples required</label>
                    <input
                      type="number"
                      min="0"
                      value={samplesRequired}
                      onChange={(event) => setSamplesRequired(event.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Deadline</label>
                    <input
                      type="datetime-local"
                      value={deadlineAt}
                      onChange={(event) => setDeadlineAt(event.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <textarea
                  value={optionalMessage}
                  onChange={(event) => setOptionalMessage(event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Add instructions for the assessor"
                />
                <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Selected assessors: {selectedAssessorIds.length}/3</div>
                <button
                  type="button"
                  onClick={() => void handleSendRequest()}
                  disabled={isSubmittingRequest}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-70"
                >
                  <Send className="h-4 w-4" />
                  {isSubmittingRequest ? 'Sending...' : 'Send Assessment Request'}
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-slate-600" />
                <p className="font-semibold text-slate-900">Template Versions</p>
              </div>
              <div className="mt-4 space-y-3">
                {(overview?.templateVersions ?? []).map((version) => (
                  <div key={version.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">Version {version.versionNumber}</p>
                        <p className="mt-1 text-xs text-slate-500">{version.createdByName || 'System'} • {formatDate(version.createdAt)}</p>
                        {version.changeNotes ? <p className="mt-2 text-sm text-slate-600">{version.changeNotes}</p> : null}
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          version.approvalStatus === 'approved'
                            ? 'bg-emerald-100 text-emerald-700'
                            : version.approvalStatus === 'pending_approval'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {version.approvalStatus}
                      </span>
                    </div>
                    {pendingTemplateVersions.some((item) => item.id === version.id) ? (
                      <button
                        type="button"
                        onClick={() => void handleApproveTemplate(version.id)}
                        className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                      >
                        Approve Version
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <p className="font-semibold text-slate-900">Researcher / Supervisor Notes</p>
              {activeNotesRequestId ? (
                <>
                  <div className="mt-4 max-h-64 space-y-3 overflow-y-auto">
                    {notes.map((note) => (
                      <div key={note.id} className="rounded-xl bg-slate-50 p-3">
                        <p className="text-sm font-medium text-slate-900">{note.authorName || 'User'}</p>
                        <p className="mt-1 text-sm text-slate-600">{note.message}</p>
                        <p className="mt-2 text-xs text-slate-500">{formatDate(note.createdAt)}</p>
                      </div>
                    ))}
                  </div>

                  <textarea
                    value={noteMessage}
                    onChange={(event) => setNoteMessage(event.target.value)}
                    rows={4}
                    className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Reply to assessor notes"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSendNote()}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    <Send className="h-4 w-4" />
                    Send Reply
                  </button>
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Select an assessment request to view and reply to notes.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <p className="font-semibold text-slate-900">Assessment Requests</p>
            <div className="mt-4 space-y-3">
              {(overview?.requests ?? []).map((request) => (
                <div key={request.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">
                        {request.assessorName || 'Assessor'} {request.assessorAcademicId ? `• ${request.assessorAcademicId}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {request.assessmentType} • {request.samplesSubmitted}/{request.samplesRequired} samples
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{request.requestStatus}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadNotes(request.id)}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Open Notes
                  </button>
                </div>
              ))}
            </div>
          </div>

          {showEligibilityModal ? (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4">
              <div className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl">
                {eligibilityStage === 'question' ? (
                  <div className="text-center">
                    <span className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-100 text-teal-600">
                      <ShieldCheck className="h-8 w-8" />
                    </span>
                    <h4 className="text-lg font-black text-slate-800">التحقق من الأهلية</h4>
                    <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
                      هل تنطبق على المشارك معايير الاشتمال والاستبعاد الخاصة بالدراسة؟
                    </p>
                    <div className="mt-6 grid grid-cols-2 gap-3">
                      <button type="button" onClick={() => handleEligibilityAnswer(false)} className="rounded-2xl border-2 border-red-200 py-4 font-black text-red-500 transition hover:bg-red-50">
                        لا
                      </button>
                      <button type="button" onClick={() => handleEligibilityAnswer(true)} className="rounded-2xl bg-teal-600 py-4 font-black text-white shadow-lg shadow-teal-600/25 transition hover:bg-teal-700">
                        نعم
                      </button>
                    </div>
                  </div>
                ) : null}

                {eligibilityStage === 'fail' ? (
                  <div className="text-center">
                    <span className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-red-100 text-red-500">
                      <Plus className="h-8 w-8 rotate-45" />
                    </span>
                    <h4 className="text-lg font-black text-red-600">فشل الفرز</h4>
                    <p className="mb-6 mt-2 text-sm font-bold leading-relaxed text-slate-500">
                      تم إيقاف عملية التسجيل فوراً ولم يتم حجز سجل عينة داخل الدراسة.
                    </p>
                    <button type="button" onClick={() => setShowEligibilityModal(false)} className="rounded-xl bg-slate-800 px-8 py-3 text-sm font-extrabold text-white transition hover:bg-slate-900">
                      إغلاق
                    </button>
                  </div>
                ) : null}

                {eligibilityStage === 'form' ? (
                  <div>
                    <h4 className="mb-4 text-lg font-black text-slate-800">تسجيل عينة جديدة</h4>
                    <div className="grid gap-4 md:grid-cols-2">
                      <input
                        type="text"
                        value={subjectId}
                        onChange={(event) => setSubjectId(event.target.value)}
                        className="rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Subject ID"
                      />
                      <input
                        type="text"
                        value={visitNumber}
                        onChange={(event) => setVisitNumber(event.target.value)}
                        className="rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Visit number"
                      />
                      <select
                        value={sampleAssetType}
                        onChange={(event) => setSampleAssetType(event.target.value as typeof sampleAssetType)}
                        className="rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="photo_before">Photo before</option>
                        <option value="photo_after">Photo after</option>
                        <option value="xray_before">X-ray before</option>
                        <option value="xray_after">X-ray after</option>
                        <option value="stl">STL</option>
                        <option value="lab_result">Lab result</option>
                        <option value="other">Other</option>
                      </select>
                      <select
                        value={linkedFileId}
                        onChange={(event) => setLinkedFileId(event.target.value)}
                        className="rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">No linked file</option>
                        {studyFiles.map((file) => (
                          <option key={file.id} value={file.id}>
                            {file.originalName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-6 flex gap-3">
                      <button type="button" onClick={() => setShowEligibilityModal(false)} className="flex-1 rounded-xl border-2 border-slate-200 py-3 text-sm font-extrabold text-slate-500 transition hover:border-slate-300">
                        إلغاء
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAddSample()}
                        disabled={isSubmittingSample}
                        className="flex-1 rounded-xl bg-teal-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-teal-600/25 transition hover:bg-teal-700 disabled:opacity-70"
                      >
                        {isSubmittingSample ? 'Saving sample...' : 'حفظ العينة'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {activeSample ? (
            <div className="fixed inset-0 z-[79] flex items-center justify-center bg-slate-950/60 p-4">
              <div className="w-full max-w-2xl rounded-3xl bg-white p-7 shadow-2xl">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-lg font-black text-slate-800">{activeSample.subjectId}</h4>
                    <p className="text-sm font-bold text-slate-400">Visit {activeSample.visitNumber}</p>
                  </div>
                  <button type="button" onClick={() => setActiveSampleId(null)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-500">
                    إغلاق
                  </button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="prototype-field-box">
                    <p className="mb-1 text-[10px] font-bold text-slate-400">الحالة المنهجية</p>
                    <p>{activeSample.sampleStatus}</p>
                  </div>
                  <div className="prototype-field-box">
                    <p className="mb-1 text-[10px] font-bold text-slate-400">المجموعة العلاجية</p>
                    <p>{activeSample.allocatedGroup || 'بانتظار التخصيص'}</p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-black text-slate-700">الأصول المرفقة</p>
                  <div className="mt-3 space-y-2">
                    {activeSample.assets.length === 0 ? (
                      <p className="text-xs font-bold text-slate-400">لا توجد ملفات مرتبطة بهذه العينة.</p>
                    ) : (
                      activeSample.assets.map((asset) => (
                        <div key={asset.id} className="rounded-xl bg-white p-3 text-xs font-bold text-slate-600">
                          {asset.assetType}: {asset.originalName}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export default OutcomeAssessmentManager;
