import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileText, Home, LoaderCircle, LogOut, Save, Send, ShieldCheck } from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useAuth } from '../context/useAuth';
import { apiBaseUrl } from '../lib/auth';

type AssessmentTemplateField = {
  id: string;
  label: string;
  responseType: 'numeric' | 'choice' | 'text' | 'boolean';
  options?: string[];
};

type WorkspaceData = {
  request: {
    id: string;
    studyId: string;
    studyTitle: string;
    studyType: string;
    requestStatus: string;
    assessmentType: string;
    deadlineAt?: string;
    optionalMessage?: string;
  };
  samples: Array<{
    id: string;
    subjectId: string;
    visitNumber: string;
    sampleStatus: string;
    assets: Array<{
      id: string;
      fileId: string;
      originalName: string;
      assetType: string;
    }>;
  }>;
  entries: Array<{
    id: string;
    sampleId: string;
    response: Record<string, unknown>;
    status: string;
    assessorComments?: string;
  }>;
  approvedTemplate?: {
    id: string;
    versionNumber: number;
    template: AssessmentTemplateField[];
  } | null;
  templateVersions: Array<{
    id: string;
    versionNumber: number;
    approvalStatus: string;
    changeNotes?: string;
    template: AssessmentTemplateField[];
  }>;
  notes: Array<{
    id: string;
    authorName?: string;
    message: string;
    createdAt: string;
  }>;
};

function OutcomeAssessmentWorkspace() {
  const navigate = useNavigate();
  const { requestId } = useParams();
  const { user, signOut, token } = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [draftResponse, setDraftResponse] = useState<Record<string, unknown>>({});
  const [draftComments, setDraftComments] = useState('');
  const [templateDraft, setTemplateDraft] = useState<AssessmentTemplateField[]>([]);
  const [templateChangeNotes, setTemplateChangeNotes] = useState('');
  const [noteMessage, setNoteMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingEntry, setIsSavingEntry] = useState(false);
  const [isSubmittingEntry, setIsSubmittingEntry] = useState(false);
  const [isSubmittingTemplate, setIsSubmittingTemplate] = useState(false);
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [error, setError] = useState('');

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  const loadWorkspace = useCallback(async () => {
    if (!token || !requestId) {
      setIsLoading(false);
      return;
    }

    try {
      setError('');
      setIsLoading(true);
      const response = await fetch(`${apiBaseUrl}/studies/outcome-assessment/assessor/requests/${requestId}/workspace`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load assessor workspace');
      }

      const data = (await response.json()) as WorkspaceData;
      setWorkspace(data);
      setTemplateDraft(data.approvedTemplate?.template ?? []);

      if (!selectedSampleId && data.samples[0]) {
        setSelectedSampleId(data.samples[0].id);
      }
    } catch {
      setError('Unable to load assessor workspace.');
      setWorkspace(null);
    } finally {
      setIsLoading(false);
    }
  }, [requestId, selectedSampleId, token]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const selectedSample = useMemo(
    () => workspace?.samples.find((sample) => sample.id === selectedSampleId) ?? null,
    [selectedSampleId, workspace?.samples],
  );

  const selectedEntry = useMemo(
    () => workspace?.entries.find((entry) => entry.sampleId === selectedSampleId) ?? null,
    [selectedSampleId, workspace?.entries],
  );

  useEffect(() => {
    setDraftResponse(selectedEntry?.response ?? {});
    setDraftComments(selectedEntry?.assessorComments ?? '');
  }, [selectedEntry]);

  const setFieldValue = (fieldId: string, value: unknown) => {
    setDraftResponse((current) => ({
      ...current,
      [fieldId]: value,
    }));
  };

  const persistEntry = async (submit: boolean) => {
    if (!token || !selectedEntry) {
      return;
    }

    try {
      setError('');
      if (submit) {
        setIsSubmittingEntry(true);
      } else {
        setIsSavingEntry(true);
      }

      const response = await fetch(
        `${apiBaseUrl}/studies/outcome-assessment/assessor/entries/${selectedEntry.id}/${submit ? 'submit' : 'save'}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            response: draftResponse,
            assessorComments: draftComments,
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Unable to update assessment entry');
      }

      await loadWorkspace();
    } catch {
      setError(submit ? 'Unable to submit assessment.' : 'Unable to save assessment draft.');
    } finally {
      setIsSavingEntry(false);
      setIsSubmittingEntry(false);
    }
  };

  const addTemplateField = () => {
    setTemplateDraft((current) => [
      ...current,
      {
        id: `field_${Date.now()}`,
        label: 'New field',
        responseType: 'text',
      },
    ]);
  };

  const updateTemplateField = <K extends keyof AssessmentTemplateField>(
    index: number,
    key: K,
    value: AssessmentTemplateField[K],
  ) => {
    setTemplateDraft((current) =>
      current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, [key]: value } : field)),
    );
  };

  const removeTemplateField = (index: number) => {
    setTemplateDraft((current) => current.filter((_, fieldIndex) => fieldIndex !== index));
  };

  const submitTemplateUpdate = async () => {
    if (!token || !requestId) {
      return;
    }

    try {
      setError('');
      setIsSubmittingTemplate(true);
      const response = await fetch(`${apiBaseUrl}/studies/outcome-assessment/assessor/requests/${requestId}/template`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          template: templateDraft,
          changeNotes: templateChangeNotes,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to propose assessment template');
      }

      setTemplateChangeNotes('');
      await loadWorkspace();
    } catch {
      setError('Unable to submit template changes for approval.');
    } finally {
      setIsSubmittingTemplate(false);
    }
  };

  const sendNote = async () => {
    if (!token || !requestId || !noteMessage.trim()) {
      return;
    }

    try {
      setError('');
      setIsSubmittingNote(true);
      const response = await fetch(`${apiBaseUrl}/studies/outcome-assessment/assessor/requests/${requestId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: noteMessage,
          sampleId: selectedSampleId || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to send note');
      }

      setNoteMessage('');
      await loadWorkspace();
    } catch {
      setError('Unable to send note.');
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const downloadFile = async (fileId: string, fileName: string) => {
    if (!token || !workspace) {
      return;
    }

    const response = await fetch(`${apiBaseUrl}/studies/${workspace.request.studyId}/files/${fileId}/download`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      setError('Unable to download blinded sample asset.');
      return;
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
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full bg-slate-950 text-white lg:min-h-screen lg:w-72">
          <div className="border-b border-slate-800 p-6">
            <h2 className="bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-2xl font-bold text-transparent">
              ClinResearch AI
            </h2>
            <p className="mt-2 text-sm text-slate-400">Outcome assessor workspace</p>
          </div>

          <div className="p-6">
            <nav className="space-y-2">
              <Link to="/clinical-evaluator-dashboard" className="flex items-center gap-3 rounded-xl px-4 py-3 font-medium text-slate-300 transition hover:bg-slate-900 hover:text-white">
                <Home className="h-5 w-5" />
                <span>Dashboard</span>
              </Link>
              <Link to="/clinical-evaluator-dashboard" className="flex items-center gap-3 rounded-xl bg-blue-600 px-4 py-3 font-medium text-white">
                <FileText className="h-5 w-5" />
                <span>Assessment Study</span>
              </Link>
            </nav>
          </div>
        </aside>

        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-sm font-medium text-blue-700">Outcome Assessor</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900">
                {workspace?.request.studyTitle || 'Assessment Workspace'}
              </h1>
              <p className="mt-2 text-slate-600">{workspace?.request.assessmentType || 'Independent blinded review'}</p>
              <p className="mt-2 text-sm text-slate-500">{user?.fullName}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <LanguageSwitcher />
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>

          {error ? <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}

          {isLoading ? (
            <div className="flex min-h-[300px] items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-3 text-slate-600">
                <LoaderCircle className="h-5 w-5 animate-spin" />
                <span>Loading workspace...</span>
              </div>
            </div>
          ) : !workspace ? null : (
            <div className="grid gap-6">
              <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-indigo-700" />
                  <h2 className="text-lg font-bold text-slate-900">Study Snapshot</h2>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">Study type</p>
                    <p className="mt-1 font-semibold text-slate-900">{workspace.request.studyType}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">Request status</p>
                    <p className="mt-1 font-semibold text-slate-900">{workspace.request.requestStatus}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">Deadline</p>
                    <p className="mt-1 font-semibold text-slate-900">{workspace.request.deadlineAt || 'Not set'}</p>
                  </div>
                </div>
                {workspace.request.optionalMessage ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    {workspace.request.optionalMessage}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
                <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-lg font-bold text-slate-900">Samples</h2>
                  <div className="mt-4 space-y-3">
                    {workspace.samples.map((sample) => (
                      <button
                        key={sample.id}
                        type="button"
                        onClick={() => setSelectedSampleId(sample.id)}
                        className={`w-full rounded-2xl border p-4 text-left transition ${
                          selectedSampleId === sample.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <p className="font-semibold text-slate-900">{sample.subjectId}</p>
                        <p className="mt-1 text-sm text-slate-500">Visit {sample.visitNumber}</p>
                        <p className="mt-1 text-xs text-slate-500">{sample.sampleStatus}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                    <h2 className="text-lg font-bold text-slate-900">Blinded Assets</h2>
                    {!selectedSample ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                        Select a sample to start reviewing assets.
                      </div>
                    ) : selectedSample.assets.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                        No blinded assets linked to this sample yet.
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        {selectedSample.assets.map((asset) => (
                          <div key={asset.id} className="rounded-2xl border border-slate-200 p-4">
                            <p className="font-semibold text-slate-900">{asset.assetType}</p>
                            <p className="mt-1 text-sm text-slate-500">{asset.originalName}</p>
                            <button
                              type="button"
                              onClick={() => void downloadFile(asset.fileId, asset.originalName)}
                              className="mt-3 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Download
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                    <h2 className="text-lg font-bold text-slate-900">Assessment Form</h2>
                    <div className="mt-4 space-y-4">
                      {(workspace.approvedTemplate?.template ?? []).map((field) => (
                        <div key={field.id}>
                          <label className="mb-1 block text-sm font-medium text-slate-700">{field.label}</label>
                          {field.responseType === 'choice' ? (
                            <select
                              value={String(draftResponse[field.id] ?? '')}
                              onChange={(event) => setFieldValue(field.id, event.target.value)}
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">Select</option>
                              {(field.options ?? []).map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : field.responseType === 'boolean' ? (
                            <select
                              value={String(draftResponse[field.id] ?? '')}
                              onChange={(event) => setFieldValue(field.id, event.target.value === 'true')}
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">Select</option>
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </select>
                          ) : field.responseType === 'numeric' ? (
                            <input
                              type="number"
                              value={String(draftResponse[field.id] ?? '')}
                              onChange={(event) => setFieldValue(field.id, Number(event.target.value))}
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : (
                            <textarea
                              value={String(draftResponse[field.id] ?? '')}
                              onChange={(event) => setFieldValue(field.id, event.target.value)}
                              rows={3}
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          )}
                        </div>
                      ))}

                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">Comments</label>
                        <textarea
                          value={draftComments}
                          onChange={(event) => setDraftComments(event.target.value)}
                          rows={4}
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => void persistEntry(false)}
                          disabled={!selectedEntry || isSavingEntry}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-70"
                        >
                          <Save className="h-4 w-4" />
                          {isSavingEntry ? 'Saving...' : 'Save Draft'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void persistEntry(true)}
                          disabled={!selectedEntry || isSubmittingEntry}
                          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-70"
                        >
                          <Send className="h-4 w-4" />
                          {isSubmittingEntry ? 'Submitting...' : 'Submit Assessment'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-lg font-bold text-slate-900">Template Adjustment</h2>
                  <p className="mt-1 text-sm text-slate-500">Propose changes for researcher/supervisor approval with version history.</p>

                  <div className="mt-4 space-y-4">
                    {templateDraft.map((field, index) => (
                      <div key={field.id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <input
                            type="text"
                            value={field.label}
                            onChange={(event) => updateTemplateField(index, 'label', event.target.value)}
                            className="rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Field label"
                          />
                          <select
                            value={field.responseType}
                            onChange={(event) =>
                              updateTemplateField(index, 'responseType', event.target.value as AssessmentTemplateField['responseType'])
                            }
                            className="rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="text">Text</option>
                            <option value="numeric">Numeric</option>
                            <option value="choice">Choice</option>
                            <option value="boolean">Boolean</option>
                          </select>
                        </div>
                        {field.responseType === 'choice' ? (
                          <input
                            type="text"
                            value={(field.options ?? []).join(', ')}
                            onChange={(event) =>
                              updateTemplateField(
                                index,
                                'options',
                                event.target.value
                                  .split(',')
                                  .map((item) => item.trim())
                                  .filter(Boolean),
                              )
                            }
                            className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Options separated by commas"
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeTemplateField(index)}
                          className="mt-3 rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
                        >
                          Remove field
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={addTemplateField}
                    className="mt-4 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Add Field
                  </button>

                  <textarea
                    value={templateChangeNotes}
                    onChange={(event) => setTemplateChangeNotes(event.target.value)}
                    rows={4}
                    className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Describe why the assessment form needs to be adjusted"
                  />

                  <button
                    type="button"
                    onClick={() => void submitTemplateUpdate()}
                    disabled={isSubmittingTemplate}
                    className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-70"
                  >
                    {isSubmittingTemplate ? 'Submitting...' : 'Submit Template Changes'}
                  </button>
                </div>

                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-lg font-bold text-slate-900">Notes Thread</h2>
                  <div className="mt-4 max-h-64 space-y-3 overflow-y-auto">
                    {workspace.notes.map((note) => (
                      <div key={note.id} className="rounded-2xl bg-slate-50 p-4">
                        <p className="font-semibold text-slate-900">{note.authorName || 'User'}</p>
                        <p className="mt-1 text-sm text-slate-600">{note.message}</p>
                        <p className="mt-2 text-xs text-slate-500">{note.createdAt}</p>
                      </div>
                    ))}
                  </div>

                  <textarea
                    value={noteMessage}
                    onChange={(event) => setNoteMessage(event.target.value)}
                    rows={4}
                    className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Request re-upload, report missing data, or ask a scientific question"
                  />
                  <button
                    type="button"
                    onClick={() => void sendNote()}
                    disabled={isSubmittingNote}
                    className="mt-4 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-70"
                  >
                    {isSubmittingNote ? 'Sending...' : 'Send Note'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default OutcomeAssessmentWorkspace;
