import { useCallback, useEffect, useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { apiBaseUrl } from '../lib/auth';

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
};

type StudyResourcePanelProps = {
  studyId: string;
  token: string;
  compact?: boolean;
};

function StudyResourcePanel({ studyId, token, compact = false }: StudyResourcePanelProps) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<StudyResourceFile[]>([]);
  const [analyses, setAnalyses] = useState<StudyResourceAnalysis[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeDownloadKey, setActiveDownloadKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadResources = useCallback(async () => {
    try {
      setError('');
      setIsLoading(true);

      const response = await fetch(`${apiBaseUrl}/studies/${studyId}/resources`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load study resources');
      }

      const data = (await response.json()) as {
        files?: StudyResourceFile[];
        analyses?: StudyResourceAnalysis[];
      };

      setFiles(data.files ?? []);
      setAnalyses(data.analyses ?? []);
    } catch {
      setError(t('studies.messages.loadError'));
      setFiles([]);
      setAnalyses([]);
    } finally {
      setIsLoading(false);
    }
  }, [studyId, t, token]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const downloadProtectedFile = useCallback(
    async (url: string, downloadName: string, downloadKey: string) => {
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

  const sectionClassName = compact
    ? 'rounded-2xl border border-slate-200 bg-slate-50 p-4'
    : 'rounded-2xl bg-white p-4 ring-1 ring-slate-200';

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <span>{t('studies.messages.loadingResources')}</span>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className={sectionClassName}>
            <p className="text-sm font-semibold text-slate-800">{t('studies.details.files')}</p>
            {files.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{t('studies.details.noFiles')}</p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm text-slate-600">
                {files.slice(0, compact ? 3 : 5).map((file) => (
                  <li key={file.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{file.originalName}</p>
                        <p className="mt-1 text-xs text-slate-500">{file.fileCategory}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void downloadProtectedFile(
                            `${apiBaseUrl}/studies/${studyId}/files/${file.id}/download`,
                            file.originalName,
                            `file-${file.id}`,
                          )
                        }
                        disabled={activeDownloadKey === `file-${file.id}`}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {activeDownloadKey === `file-${file.id}` ? t('studies.messages.downloading') : t('studies.actions.downloadFile')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={sectionClassName}>
            <p className="text-sm font-semibold text-slate-800">{t('studies.details.analyses')}</p>
            {analyses.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{t('studies.details.noAnalyses')}</p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm text-slate-600">
                {analyses.slice(0, compact ? 3 : 5).map((analysis) => (
                  <li key={analysis.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{analysis.title}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {analysis.analysisType ? analysis.analysisType : t('aiChat.results.unspecifiedAnalysis')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void downloadProtectedFile(
                            `${apiBaseUrl}/studies/${studyId}/analyses/${analysis.id}/report`,
                            `${analysis.title}.pdf`,
                            `analysis-${analysis.id}`,
                          )
                        }
                        disabled={activeDownloadKey === `analysis-${analysis.id}`}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {activeDownloadKey === `analysis-${analysis.id}` ? t('studies.messages.downloading') : t('studies.actions.downloadReport')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default StudyResourcePanel;
