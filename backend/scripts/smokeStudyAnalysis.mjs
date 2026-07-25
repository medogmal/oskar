import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const apiBaseUrl = 'http://127.0.0.1:5000/api';

const getJson = async (response) => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return { message: await response.text() };
};

const ensureOk = async (response, message) => {
  if (!response.ok) {
    const payload = await getJson(response);
    throw new Error(`${message}: ${payload.message ?? payload.detail ?? response.statusText}`);
  }

  return getJson(response);
};

const loginResponse = await fetch(`${apiBaseUrl}/auth/login`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'student.test@clinresearch.local',
    password: 'Test@12345',
  }),
});

const loginPayload = await ensureOk(loginResponse, 'Login failed');
const token = loginPayload.token;

const authHeaders = {
  Authorization: `Bearer ${token}`,
};

const studiesResponse = await fetch(`${apiBaseUrl}/studies`, {
  headers: authHeaders,
});
const studies = await ensureOk(studiesResponse, 'Unable to load studies');

if (!Array.isArray(studies) || studies.length === 0) {
  throw new Error('No studies available for the smoke test');
}

const selectedStudyId = String(studies[0].id);
const analysisForm = new FormData();
analysisForm.append(
  'file',
  new Blob(
    [
      [
        'group,value',
        'A,10',
        'A,12',
        'A,11',
        'B,18',
        'B,20',
        'B,19',
      ].join('\n'),
    ],
    { type: 'text/csv' },
  ),
  'smoke-analysis.csv',
);
analysisForm.append(
  'config',
  JSON.stringify({
    analysis_type: 'independent_t_test',
    group_column: 'group',
    value_column: 'value',
  }),
);
analysisForm.append('prompt', 'Explain the difference between the two groups.');
analysisForm.append('mode', 'results_explanation');
analysisForm.append('title', 'Smoke Test Analysis');

const analysisResponse = await fetch(`${apiBaseUrl}/studies/${selectedStudyId}/analysis/run`, {
  method: 'POST',
  headers: authHeaders,
  body: analysisForm,
});
const analysisPayload = await ensureOk(analysisResponse, 'Unable to run persisted analysis');

const resourcesResponse = await fetch(`${apiBaseUrl}/studies/${selectedStudyId}/resources`, {
  headers: authHeaders,
});
const resourcesPayload = await ensureOk(resourcesResponse, 'Unable to fetch study resources');

const analysisId = String(analysisPayload.analysis.id);
const reportResponse = await fetch(`${apiBaseUrl}/studies/${selectedStudyId}/analyses/${analysisId}/report`, {
  headers: authHeaders,
});

if (!reportResponse.ok) {
  const payload = await getJson(reportResponse);
  throw new Error(`Unable to download report: ${payload.message ?? payload.detail ?? reportResponse.statusText}`);
}

const reportArrayBuffer = await reportResponse.arrayBuffer();
const reportPath = path.join(backendRoot, 'smoke-report.pdf');
await fs.writeFile(reportPath, Buffer.from(reportArrayBuffer));

console.log(
  JSON.stringify(
    {
      studyId: selectedStudyId,
      analysisId,
      analysisType: analysisPayload.analysis.analysisType,
      reportRelativePath: analysisPayload.analysis.reportRelativePath,
      savedFiles: Array.isArray(resourcesPayload.files) ? resourcesPayload.files.length : 0,
      savedAnalyses: Array.isArray(resourcesPayload.analyses) ? resourcesPayload.analyses.length : 0,
      reportPath,
    },
    null,
    2,
  ),
);
