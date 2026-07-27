import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  FileText,
  FlaskConical,
  Gauge,
  Shuffle,
  ShieldCheck,
  Users,
} from 'lucide-react';
import LanguageSwitcher from './LanguageSwitcher';

type NavItem = {
  key: string;
  label: string;
  enLabel: string;
  to: string;
  active?: boolean;
};

type ResearchWorkspaceShellProps = {
  title: string;
  subtitle: string;
  currentStudyLabel?: string;
  dateLabel?: string;
  navItems: NavItem[];
  actions?: ReactNode;
  children: ReactNode;
};

const iconMap: Record<string, typeof Gauge> = {
  dashboard: Gauge,
  setup: FlaskConical,
  methodology: Shuffle,
  samples: Users,
  form: ClipboardCheck,
  calendar: CalendarDays,
  access: ShieldCheck,
  studies: FileText,
  analysis: BarChart3,
};

export const buildResearchWorkspaceNav = (studyId?: string): NavItem[] => [
  {
    key: 'dashboard',
    label: 'لوحة التحكم',
    enLabel: 'Dashboard',
    to: '/student-dashboard',
  },
  {
    key: 'setup',
    label: 'تأسيس الدراسة',
    enLabel: 'Study Setup',
    to: '/studies?create=1&workflow=supervised',
  },
  {
    key: 'methodology',
    label: 'معالج المنهجية',
    enLabel: 'Methodology',
    to: studyId ? `/studies/${studyId}?tab=overview` : '/studies',
  },
  {
    key: 'samples',
    label: 'دليل العينات والتحقق',
    enLabel: 'Samples',
    to: studyId ? `/studies/${studyId}?tab=patients` : '/studies',
  },
  {
    key: 'form',
    label: 'استعراض الاستمارة',
    enLabel: 'Form Specs',
    to: studyId ? `/studies/${studyId}/assessment-form` : '/studies',
  },
  {
    key: 'calendar',
    label: 'التقويم والزيارات',
    enLabel: 'Calendar',
    to: studyId ? `/studies/${studyId}?tab=calendar` : '/studies',
  },
  {
    key: 'access',
    label: 'الصلاحيات والمشرفون',
    enLabel: 'Access',
    to: studyId ? `/studies/${studyId}?tab=access` : '/studies',
  },
  {
    key: 'analysis',
    label: 'التحليل والتقارير',
    enLabel: 'Reports',
    to: studyId ? `/ai-chat?studyId=${studyId}` : '/ai-chat',
  },
];

function ResearchWorkspaceShell({
  title,
  subtitle,
  currentStudyLabel,
  dateLabel,
  navItems,
  actions,
  children,
}: ResearchWorkspaceShellProps) {
  const todayLabel =
    dateLabel ??
    new Intl.DateTimeFormat('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date());

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full bg-gradient-to-b from-slate-950 via-slate-900 to-teal-950 text-white lg:min-h-screen lg:w-72 shadow-2xl">
          <div className="border-b border-white/10 px-6 pb-5 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-teal-700 shadow-lg shadow-teal-900/50">
                <FlaskConical className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-black leading-tight">
                  Clin<span className="text-teal-400">Research</span> AI
                </h1>
                <p className="text-[10px] font-semibold text-slate-400">منصة الأبحاث والدراسات السريرية</p>
              </div>
            </div>
          </div>

          <nav className="space-y-1.5 overflow-y-auto px-3 py-5">
            <p className="px-3 pb-1 text-[10px] font-bold tracking-widest text-slate-500">القائمة الرئيسية</p>
            {navItems.map((item) => {
              const Icon = iconMap[item.key] ?? FileText;
              return (
                <Link
                  key={`${item.key}-${item.to}`}
                  to={item.to}
                  className={`relative flex items-center gap-3 rounded-2xl px-4 py-3 text-right text-[0.92rem] font-semibold transition ${
                    item.active
                      ? 'bg-gradient-to-br from-teal-600 to-teal-800 text-white shadow-lg shadow-teal-950/30'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {item.active ? <span className="absolute right-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-teal-300 shadow-[0_0_12px_#2dd4bf]" /> : null}
                  <Icon className="h-5 w-5 shrink-0" />
                  <span>{item.label}</span>
                  <span className="mr-auto text-[10px] font-medium opacity-60">{item.enLabel}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">
          <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="truncate text-xl font-black text-slate-800">{title}</h2>
              <p className="truncate text-xs font-semibold text-slate-400">{subtitle}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {currentStudyLabel ? (
                <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 text-xs font-extrabold text-teal-800">
                  {currentStudyLabel}
                </div>
              ) : null}
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-500">{todayLabel}</div>
              <LanguageSwitcher />
              {actions}
            </div>
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}

export default ResearchWorkspaceShell;
