import { apiBaseUrl } from './auth';

export type StudyResourceFile = {
  id: string;
  originalName: string;
  fileCategory: 'protocol' | 'dataset' | 'image' | 'attachment' | 'report';
  createdAt: string;
};

export type StudyWorkspaceNamespace =
  | 'variables'
  | 'research-questions'
  | 'objectives'
  | 'validation-items'
  | 'governance';

type WorkspaceEnvelope<T> = {
  schemaVersion: 1;
  namespace: StudyWorkspaceNamespace;
  studyId: string;
  savedAt: string;
  data: T;
};

type StudyResourcesResponse = {
  files?: StudyResourceFile[];
};

const WORKSPACE_PREFIX = 'oskar-workspace';

const namespacePrefix = (namespace: StudyWorkspaceNamespace) => `${WORKSPACE_PREFIX}-${namespace}-`;

const buildWorkspaceFileName = (namespace: StudyWorkspaceNamespace) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${namespacePrefix(namespace)}${timestamp}.json`;
};

const isWorkspaceFile = (fileName: string, namespace: StudyWorkspaceNamespace) =>
  fileName.toLowerCase().startsWith(namespacePrefix(namespace).toLowerCase()) && fileName.toLowerCase().endsWith('.json');

export const listStudyFiles = async (studyId: string, token: string) => {
  const response = await fetch(`${apiBaseUrl}/studies/${studyId}/resources`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Unable to load study resources');
  }

  const payload = (await response.json()) as StudyResourcesResponse;
  return payload.files ?? [];
};

export const downloadStudyFileText = async (studyId: string, fileId: string, token: string) => {
  const response = await fetch(`${apiBaseUrl}/studies/${studyId}/files/${fileId}/download`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Unable to download study file');
  }

  return response.text();
};

const getLatestWorkspaceFile = async (studyId: string, token: string, namespace: StudyWorkspaceNamespace) => {
  const files = await listStudyFiles(studyId, token);
  return files
    .filter((file) => isWorkspaceFile(file.originalName, namespace))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
};

export const loadWorkspaceData = async <T>(
  studyId: string,
  token: string,
  namespace: StudyWorkspaceNamespace,
  fallback: T,
): Promise<T> => {
  const file = await getLatestWorkspaceFile(studyId, token, namespace);
  if (!file) {
    return fallback;
  }

  try {
    const rawText = await downloadStudyFileText(studyId, file.id, token);
    const parsed = JSON.parse(rawText) as Partial<WorkspaceEnvelope<T>> | T;

    if (
      parsed &&
      typeof parsed === 'object' &&
      'schemaVersion' in parsed &&
      'namespace' in parsed &&
      'data' in parsed
    ) {
      const envelope = parsed as WorkspaceEnvelope<T>;
      return envelope.namespace === namespace ? envelope.data : fallback;
    }

    return parsed as T;
  } catch {
    return fallback;
  }
};

export const uploadWorkspaceData = async <T>(
  studyId: string,
  token: string,
  namespace: StudyWorkspaceNamespace,
  data: T,
) => {
  const envelope: WorkspaceEnvelope<T> = {
    schemaVersion: 1,
    namespace,
    studyId,
    savedAt: new Date().toISOString(),
    data,
  };

  const file = new File([JSON.stringify(envelope, null, 2)], buildWorkspaceFileName(namespace), {
    type: 'application/json',
  });

  const formData = new FormData();
  formData.append('file', file);
  formData.append('fileCategory', 'attachment');

  const response = await fetch(`${apiBaseUrl}/studies/${studyId}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Unable to save workspace snapshot');
  }

  return response.json();
};
