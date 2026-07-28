import type { SeverityLevel, ErrorCategory, MeasurementScale } from '../types/clinresearch';
import { SEVERITY_STYLES, CATEGORY_STYLES, SCALE_STYLES } from '../lib/severityHelpers';

export const SeverityBadge = ({ severity }: { severity: SeverityLevel }) => {
  const s = SEVERITY_STYLES[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${s.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

export const CategoryBadge = ({ category }: { category: ErrorCategory }) => {
  const c = CATEGORY_STYLES[category];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${c.badge}`}>{c.label}</span>;
};

export const ScaleBadge = ({ scale }: { scale: MeasurementScale }) => {
  const s = SCALE_STYLES[scale];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${s.badge}`}>
      <span>{s.icon}</span>
      {s.label}
    </span>
  );
};
