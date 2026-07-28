import type { SeverityLevel, ErrorCategory, MeasurementScale } from '../types/clinresearch';

export const SEVERITY_STYLES: Record<SeverityLevel, { badge: string; dot: string; bg: string; text: string; label: string; ring: string }> = {
  critical: {
    badge: 'bg-rose-500/15 text-rose-300 border border-rose-500/30',
    dot: 'bg-rose-500',
    bg: 'bg-rose-500/10',
    text: 'text-rose-300',
    label: 'Critical',
    ring: 'ring-1 ring-rose-500/20',
  },
  high: {
    badge: 'bg-orange-500/15 text-orange-300 border border-orange-500/30',
    dot: 'bg-orange-500',
    bg: 'bg-orange-500/10',
    text: 'text-orange-300',
    label: 'High',
    ring: 'ring-1 ring-orange-500/20',
  },
  moderate: {
    badge: 'bg-amber-400/15 text-amber-300 border border-amber-400/30',
    dot: 'bg-amber-400',
    bg: 'bg-amber-400/10',
    text: 'text-amber-300',
    label: 'Moderate',
    ring: 'ring-1 ring-amber-400/20',
  },
  low: {
    badge: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    dot: 'bg-emerald-500',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-300',
    label: 'Low',
    ring: 'ring-1 ring-emerald-500/20',
  },
  info: {
    badge: 'bg-sky-400/15 text-sky-300 border border-sky-400/30',
    dot: 'bg-sky-400',
    bg: 'bg-sky-400/10',
    text: 'text-sky-300',
    label: 'Info',
    ring: 'ring-1 ring-sky-400/20',
  },
};

export const CATEGORY_STYLES: Record<ErrorCategory, { badge: string; label: string }> = {
  methodological: { badge: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30', label: 'Methodological' },
  statistical: { badge: 'bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30', label: 'Statistical' },
  clinical: { badge: 'bg-pink-500/15 text-pink-300 border border-pink-500/30', label: 'Clinical' },
  missing_data: { badge: 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30', label: 'Missing Data' },
  regulatory: { badge: 'bg-purple-500/15 text-purple-300 border border-purple-500/30', label: 'Regulatory' },
  crf_structural: { badge: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30', label: 'CRF Structural' },
  reference_scope: { badge: 'bg-teal-500/15 text-teal-300 border border-teal-500/30', label: 'Reference Scope' },
};

export const SCALE_STYLES: Record<MeasurementScale, { badge: string; label: string; icon: string }> = {
  nominal: { badge: 'bg-violet-500/15 text-violet-300 border border-violet-500/30', label: 'Nominal', icon: '🏷️' },
  ordinal: { badge: 'bg-blue-500/15 text-blue-300 border border-blue-500/30', label: 'Ordinal', icon: '🔢' },
  interval: { badge: 'bg-sky-500/15 text-sky-300 border border-sky-500/30', label: 'Interval', icon: '📏' },
  ratio: { badge: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30', label: 'Ratio', icon: '⚖️' },
  binary: { badge: 'bg-rose-500/15 text-rose-300 border border-rose-500/30', label: 'Binary', icon: '⚪⚫' },
  count: { badge: 'bg-amber-500/15 text-amber-300 border border-amber-500/30', label: 'Count', icon: '🔟' },
  time_to_event: { badge: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30', label: 'Survival / TTE', icon: '⏱️' },
};

export const getSeverityText = (severity: SeverityLevel) => SEVERITY_STYLES[severity].label;
export const getCategoryText = (category: ErrorCategory) => CATEGORY_STYLES[category].label;
export const getScaleText = (scale: MeasurementScale) => SCALE_STYLES[scale].label;
export const getScaleIcon = (scale: MeasurementScale) => SCALE_STYLES[scale].icon;
