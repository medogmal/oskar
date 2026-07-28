import type { ReportTemplate, VariableMapping, ValidationItem, PhaseApproval } from '../types/clinresearch';
import { apiBaseUrl } from './auth';

const toCsvCell = (value: string | number | boolean | undefined | null) => {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export const exportCsv = <T extends object>(rows: T[], filename: string, columns?: Array<{ key: keyof T & string; label: string }>) => {
  if (rows.length === 0) return;
  const finalCols = columns ?? Object.keys(rows[0]).map((k) => ({ key: k as keyof T & string, label: k }));
  const header = finalCols.map((c) => toCsvCell(c.label)).join(',');
  const body = rows
    .map((row) => {
      const record = row as Record<string, unknown>;
      return finalCols.map((c) => toCsvCell(record[c.key] as string | number | boolean | null | undefined)).join(',');
    })
    .join('\r\n');
  const csv = '\uFEFF' + header + '\r\n' + body;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, ensureExt(filename, '.csv'));
};

export const exportVariablesMatrixCsv = (rows: VariableMapping[], filename = 'variable-mapping-matrix') => {
  const cols: Array<{ key: keyof VariableMapping & string; label: string }> = [
    { key: 'label', label: 'Variable Label' },
    { key: 'definition', label: 'Definition' },
    { key: 'role', label: 'Role' },
    { key: 'scale', label: 'Measurement Scale' },
    { key: 'source', label: 'Data Source' },
    { key: 'measurementMethod', label: 'Measurement Method' },
    { key: 'unit', label: 'Unit' },
    { key: 'linkedOutcomeIds', label: 'Linked Outcomes' },
    { key: 'linkedResearchQuestionIds', label: 'Linked RQs' },
    { key: 'linkedReferenceIds', label: 'Linked References' },
    { key: 'recommendedStatisticalTest', label: 'Recommended Statistical Test' },
    { key: 'section', label: 'CRF Section' },
    { key: 'required', label: 'Required?' },
    { key: 'note', label: 'Notes' },
  ];
  const mapped = rows.map((r) => ({
    ...r,
    linkedOutcomeIds: r.linkedOutcomeIds.join('; '),
    linkedResearchQuestionIds: r.linkedResearchQuestionIds.join('; '),
    linkedReferenceIds: r.linkedReferenceIds.join('; '),
    required: r.required ? 'Yes' : 'No',
  }));
  exportCsv(mapped, filename, cols);
};

export const exportErrorsCsv = (items: ValidationItem[], filename = 'validation-issues') => {
  const cols: Array<{ key: keyof ValidationItem & string; label: string }> = [
    { key: 'id', label: 'Issue ID' },
    { key: 'severity', label: 'Severity' },
    { key: 'category', label: 'Category' },
    { key: 'status', label: 'Status' },
    { key: 'title', label: 'Title' },
    { key: 'detail', label: 'Detail' },
    { key: 'suggestedAction', label: 'Suggested Correction' },
    { key: 'createdAt', label: 'Created At' },
  ];
  exportCsv(items, filename, cols);
};

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const ensureExt = (name: string, ext: string) => (name.toLowerCase().endsWith(ext) ? name : name + ext);

const downloadProtectedExport = async (url: string, token: string, report: ReportTemplate, fallbackFilename: string) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ report }),
  });

  if (!response.ok) {
    throw new Error('Unable to export report');
  }

  const blob = await response.blob();
  const header = response.headers.get('content-disposition') ?? '';
  const filenameMatch = /filename="([^"]+)"/i.exec(header);
  triggerDownload(blob, filenameMatch?.[1] ?? fallbackFilename);
};

const buildReportHtml = (report: ReportTemplate): string => {
  const sectionsHtml = report.sections
    .map((s) => {
      const tag = `h${s.level}` as const;
      const tablesHtml = s.tables
        ? s.tables
            .map(
              (t) => `
        <table class="report-table" style="border-collapse: collapse; margin: 12px 0; width: 100%;">
          <caption style="text-align: left; font-weight: 600; margin-bottom: 4px;">${t.caption}</caption>
          <thead>
            <tr>
              ${t.columns.map((c) => `<th style="border: 1px solid #d1d5db; background:#f1f5f9; padding:8px; text-align:left;">${c}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${t.rows
              .map(
                (r) => `<tr>${r
                  .map((cell) => `<td style="border:1px solid #e5e7eb; padding:6px 8px;">${String(cell ?? '')}</td>`)
                  .join('')}</tr>`
              )
              .join('')}
          </tbody>
        </table>`
            )
            .join('\n')
        : '';
      const highlightsHtml = s.highlights
        ? `<ul class="report-highlights">${s.highlights.map((h) => `<li>• ${h}</li>`).join('')}</ul>`
        : '';
      return `
    <section class="report-section" style="page-break-inside: avoid;">
      <${tag} style="margin-top:18px; margin-bottom:8px; color:#0f172a; border-left: 4px solid #3b82f6; padding-left: 10px;">${s.heading}</${tag}>
      <div style="line-height: 1.6; color: #334155; white-space: pre-wrap;">${s.body}</div>
      ${highlightsHtml}
      ${tablesHtml}
    </section>`;
    })
    .join('\n');

  const refsHtml =
    report.references.length > 0
      ? `
  <section class="report-references" style="page-break-before: always;">
    <h2 style="margin-top:18px; margin-bottom:10px; color:#0f172a;">📚 References</h2>
    <ol style="line-height: 1.7; color:#334155;">
      ${report.references.map((r) => `<li id="ref-${r.id}">[${r.id}] ${r.citationText}</li>`).join('\n')}
    </ol>
  </section>`
      : '';

  return `<!doctype html>
<html dir="auto" lang="en">
<head>
<meta charset="utf-8" />
<title>${report.title} — ${report.studyTitle}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    margin: 0;
    padding: 32px 48px;
    color: #0f172a;
    background: white;
    max-width: 920px;
    margin: auto;
  }
  .report-header {
    border-bottom: 2px solid #3b82f6;
    padding-bottom: 14px;
    margin-bottom: 18px;
  }
  .report-meta-row { display: flex; justify-content: space-between; color: #475569; font-size: 13px; margin: 4px 0; }
  .report-highlights { color: #0f766e; padding-left: 14px; }
  .report-footer { margin-top: 40px; border-top: 1px solid #cbd5e1; padding-top: 10px; font-size: 12px; color: #64748b; display: flex; justify-content: space-between; }
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="no-print" style="position: sticky; top: 0; background: #eff6ff; padding: 8px 12px; margin: -32px -48px 20px -48px; border-bottom: 1px solid #bfdbfe;">
    <button onclick="window.print()" style="padding:6px 14px; background:#2563eb; color:white; border:0; border-radius:6px; cursor:pointer; margin-right: 8px;">🖨️ Print / Save PDF</button>
    <span style="font-size: 12px; color:#1e3a8a;">Tip: When printing select "Save as PDF" to export the document permanently.</span>
  </div>
  <div class="report-header">
    <h1 style="margin: 0 0 10px 0; color:#1e3a8a; font-size: 24px;">${report.title}</h1>
    <div class="report-meta-row"><span>📄 Study:</span><strong>${report.studyTitle} (ID: ${report.studyId})</strong></div>
    <div class="report-meta-row"><span>✅ Version:</span><code>${report.version}</code></div>
    <div class="report-meta-row"><span>👤 Author:</span>${report.authorName}</div>
    <div class="report-meta-row"><span>📅 Issued At:</span>${new Date(report.issuedAt).toLocaleString()}</div>
  </div>
  ${sectionsHtml}
  ${refsHtml}
  <div class="report-footer">
    <span>Generated by ClinResearch AI Platform</span>
    <span>Document ID: ${report.id}</span>
  </div>
</body>
</html>`;
};

export const openReportForPrint = (report: ReportTemplate) => {
  const html = buildReportHtml(report);
  const win = window.open('', '_blank', 'width=960,height=820');
  if (!win) {
    alert('Please allow popups for this site to open the printable report.');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
};

export const exportReportPdf = async (report: ReportTemplate, token: string) => {
  await downloadProtectedExport(
    `${apiBaseUrl}/analytics/exports/report.pdf`,
    token,
    report,
    ensureExt(`${report.studyTitle}-${report.title}`, '.pdf'),
  );
};

export const exportReportXlsx = async (report: ReportTemplate, token: string) => {
  await downloadProtectedExport(
    `${apiBaseUrl}/analytics/exports/report.xlsx`,
    token,
    report,
    ensureExt(`${report.studyTitle}-${report.title}`, '.xlsx'),
  );
};

export const buildBlankReport = (
  type: ReportTemplate['type'],
  studyId: string,
  studyTitle: string,
  authorName: string
): ReportTemplate => ({
  id: crypto.randomUUID(),
  type,
  title:
    type === 'proposal_review'
      ? 'Proposal Review Report'
      : type === 'crf_review'
      ? 'CRF / Case Report Form Review Report'
      : type === 'statistical_analysis'
      ? 'Statistical Analysis Plan & Report'
      : type === 'sample_size'
      ? 'Sample Size & Power Analysis Report'
      : type === 'errors_deficiencies'
      ? 'Deficiencies & Issues Audit Report'
      : type === 'scientific_justification'
      ? 'Scientific Justification Report'
      : 'Supervisor Final Review Report',
  version: '1.0',
  issuedAt: new Date().toISOString(),
  studyId,
  studyTitle,
  authorName,
  sections: [
    {
      id: 'exec-summary',
      heading: 'Executive Summary',
      level: 1,
      body: 'This section summarizes the findings, recommendations and final decision. Please edit with your executive summary.',
    },
    {
      id: 'methodology',
      heading: 'Methodological Assessment',
      level: 2,
      body: 'Detailed assessment of study design, variables and clinical validity.',
    },
    {
      id: 'recommendations',
      heading: 'Recommendations & Action Items',
      level: 2,
      body: 'List the corrective actions required with owners and deadlines.',
      highlights: ['Edit bullet 1', 'Edit bullet 2'],
    },
  ],
  references: [],
});

export const exportBibTeX = (refs: Array<{ id: string; authors?: string; year?: string; title: string; journal?: string; volume?: string; pages?: string }>, filename = 'references') => {
  const entries = refs
    .map(
      (r, i) => `@article{${r.id || `ref${i + 1}`},
  title = {${r.title}},
  author = {${r.authors ?? 'Unknown Author'}},
  journal = {${r.journal ?? ''}},
  year = {${r.year ?? ''}},
  volume = {${r.volume ?? ''}},
  pages = {${r.pages ?? ''}}
}`
    )
    .join('\n\n');
  const blob = new Blob([entries], { type: 'application/x-bibtex' });
  triggerDownload(blob, ensureExt(filename, '.bib'));
};

export const exportRIS = (refs: Array<{ id: string; authors?: string; year?: string; title: string; journal?: string; volume?: string; pages?: string }>, filename = 'references') => {
  const entries = refs
    .map(
      (r) => `TY  - JOUR
TI  - ${r.title}
AU  - ${r.authors ?? 'Unknown'}
PY  - ${r.year ?? ''}
JO  - ${r.journal ?? ''}
VL  - ${r.volume ?? ''}
SP  - ${r.pages?.split('-')[0] ?? ''}
EP  - ${r.pages?.split('-')[1] ?? ''}
ID  - ${r.id ?? ''}
ER  - `
    )
    .join('\n\n');
  const blob = new Blob([entries], { type: 'application/x-research-info-systems' });
  triggerDownload(blob, ensureExt(filename, '.ris'));
};

export const exportPhasesReport = (phases: PhaseApproval[], _studyTitle: string, filename = 'phase-approvals') => {
  const cols: Array<{ key: keyof PhaseApproval & string; label: string }> = [
    { key: 'phase', label: 'Phase' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    { key: 'submittedAt', label: 'Submitted At' },
    { key: 'decidedAt', label: 'Decided At' },
    { key: 'decidedByName', label: 'Decision By' },
    { key: 'decisionNotes', label: 'Decision Notes' },
  ];
  exportCsv(phases, filename, cols);
};

export const printHtmlElement = (elementId: string, title?: string) => {
  const el = document.getElementById(elementId);
  if (!el) return;
  const content = el.innerHTML;
  const win = window.open('', '_blank', 'width=960,height=820');
  if (!win) {
    alert('Please allow popups to print this section.');
    return;
  }
  win.document.write(`<!doctype html>
<html dir="auto"><head><meta charset="utf-8" /><title>${title ?? elementId}</title>
<style>
  body { font-family: 'Segoe UI', Arial; padding: 24px 40px; color: #0f172a; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 13px; }
  th { background: #f1f5f9; }
</style></head><body>
  ${title ? `<h2 style="color:#1e3a8a;">${title}</h2>` : ''}
  ${content}
</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 200);
};
