import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Calendar,
  ArrowRight,
  Check,
  Brain,
  Download,
} from 'lucide-react';
import {
  format,
  addDays,
  addWeeks,
  subWeeks,
  isSameDay,
  startOfWeek,
} from 'date-fns';
import { mockShifts, mockSchedule } from '../lib/mockData';
import type { PreferenceOverride, Role, Schedule, Shift } from '../lib/types';
import { getInitials, getAvatarColor } from '../lib/utils';
import { api, isApiConfigured, loadScheduleWithEmployees } from '../lib/api';
import { ApiError, getToken } from '../lib/api/client';
import { useEmployees } from '../hooks/useEmployerApi';
import {
  buildAiSuggestions,
  displayNameShort,
  findShiftForOverride,
  formatShiftPillLabel,
  formatTime12FromString,
  getShiftStyle,
  inferShiftName,
  parseOverrideLine,
  shiftDurationFromStrings,
  weekTotalColor,
  ROLE_PILL,
  type AISuggestionStatus,
} from './scheduleUtils';

// ─── Theme (matches rest of web app) ─────────────────────────────────────────

const UI = {
  page: '#18181B',
  card: '#27272A',
  cardAlt: '#18181B',
  border: '#3F3F46',
  text: '#FAFAFA',
  muted: '#A1A1AA',
  muted2: '#71717A',
  accent: '#818CF8',
  accentDark: '#6366F1',
  accentSoft: 'rgba(129,140,248,0.15)',
  todayCol: 'rgba(129,140,248,0.1)',
  rowAlt: '#1E1E22',
  hover: 'rgba(129,140,248,0.08)',
  footer: '#18181B',
  weekend: 'rgba(251,191,36,0.04)',
};

const ROW_HEIGHT = 64;
const EMP_COL_WIDTH = 220;
const DAY_COL_MIN = 132;

function ShiftPill({
  shift,
  onClick,
}: {
  shift: Shift;
  onClick: (e: React.MouseEvent) => void;
}) {
  const style = getShiftStyle(shift.start_time, shift.end_time);
  const rolePill = ROLE_PILL[shift.role];
  return (
    <button
      type="button"
      className="inline-flex flex-col items-center justify-center rounded-2xl font-bold transition-transform hover:scale-[1.02]"
      style={{
        padding: '8px 14px',
        backgroundColor: style.bg,
        color: style.text,
        whiteSpace: 'nowrap',
        fontSize: 13,
        lineHeight: 1.25,
        gap: 4,
      }}
      onClick={onClick}
    >
      <span>{formatShiftPillLabel(shift.start_time, shift.end_time)}</span>
      <span
        className="text-[10px] font-semibold leading-none"
        style={{ color: rolePill.text }}
      >
        {rolePill.label}
      </span>
    </button>
  );
}

type PopoverState = { shift: Shift; x: number; y: number };

function ShiftPopover({ popover, onClose }: { popover: PopoverState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { shift } = popover;
  const style = getShiftStyle(shift.start_time, shift.end_time);
  const hours = shiftDurationFromStrings(shift.start_time, shift.end_time);
  const day = parseISOSafe(shift.date);

  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [onClose]);

  const left = Math.min(popover.x, window.innerWidth - 260);
  const top = Math.min(popover.y + 8, window.innerHeight - 200);

  return (
    <div
      ref={ref}
      className="fixed z-50 w-64 rounded-xl p-4 shadow-xl"
      style={{ left, top, backgroundColor: UI.card, border: `1px solid ${UI.border}` }}
    >
      <div className="text-sm font-semibold mb-1" style={{ color: UI.text }}>
        {shift.employee?.name ?? 'Unassigned'}
      </div>
      <div className="text-xs mb-3" style={{ color: UI.muted }}>
        {day ? format(day, 'EEEE, MMM d') : shift.date}
      </div>
      <div
        className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold mb-3"
        style={{ backgroundColor: style.bg, color: style.text }}
      >
        {formatShiftPillLabel(shift.start_time, shift.end_time)}
      </div>
      <div className="space-y-1 text-xs" style={{ color: UI.muted }}>
        <div><span style={{ color: UI.text }}>Duration:</span> {hours} hours</div>
        <div><span style={{ color: UI.text }}>Role:</span> {shift.role}</div>
      </div>
      <button
        type="button"
        className="mt-4 w-full py-2 rounded-lg text-xs font-semibold"
        style={{ backgroundColor: UI.accent, color: '#FFFFFF' }}
      >
        Edit
      </button>
    </div>
  );
}

function parseISOSafe(iso: string): Date | null {
  try {
    const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// ─── AI Suggestions ───────────────────────────────────────────────────────────

type SuggestionState = PreferenceOverride & { id: string; status: AISuggestionStatus };

function AISuggestionsSection({
  suggestions,
  onAccept,
  onKeep,
  onAcceptAll,
  onRejectAll,
}: {
  suggestions: SuggestionState[];
  onAccept: (id: string) => void;
  onKeep: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
  const pending = suggestions.filter((s) => s.status === 'pending');
  const accepted = suggestions.filter((s) => s.status === 'accepted').length;

  if (!suggestions.some((s) => s.status === 'pending' || s.status === 'accepted')) {
    return null;
  }

  return (
    <div className="mt-8">
      <div
        className="rounded-xl p-6"
        style={{ backgroundColor: UI.card, border: `1px solid ${UI.border}` }}
      >
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Brain size={20} style={{ color: UI.accent }} />
              <h2 className="text-xl font-bold" style={{ color: UI.text }}>AI Suggestions</h2>
            </div>
            <p className="text-sm max-w-2xl" style={{ color: UI.muted }}>
              The AI scheduling engine made the following suggestions. Your preferences resulted in
              the changes shown below. Review and decide whether to apply any of them.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onAcceptAll}
              disabled={pending.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
              style={{ backgroundColor: UI.accent, color: '#FFFFFF' }}
            >
              Accept All
            </button>
            <button
              type="button"
              onClick={onRejectAll}
              disabled={pending.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
              style={{ backgroundColor: 'transparent', color: '#F87171', border: '1px solid rgba(248,113,113,0.35)' }}
            >
              Reject All
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-5">
          <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: UI.accentSoft, color: UI.accent }}>
            {suggestions.length} suggestions from AI
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: 'rgba(52,211,153,0.12)', color: '#34D399' }}>
            {accepted} accepted
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: UI.cardAlt, color: UI.muted }}>
            {pending.length} pending
          </span>
        </div>

        <div className="space-y-4">
          {suggestions.map((s) => {
            const suggestedParsed = parseOverrideLine(s.suggested);
            const schedParsed = parseOverrideLine(s.scheduled);
            const aiStart = suggestedParsed.start ?? '10:00';
            const aiEnd = suggestedParsed.end ?? '16:00';
            const schedStart = schedParsed.start ?? aiStart;
            const schedEnd = schedParsed.end ?? aiEnd;
            const aiHours = shiftDurationFromStrings(aiStart, aiEnd);
            const schedHours = shiftDurationFromStrings(schedStart, schedEnd);
            const dateLabel = suggestedParsed.date
              ? format(parseISOSafe(suggestedParsed.date) ?? new Date(), 'EEEE MMM d')
              : '';

            if (s.status === 'accepted') {
              return (
                <div
                  key={s.id}
                  className="rounded-xl px-5 py-4 flex items-center gap-2"
                  style={{ backgroundColor: UI.cardAlt, border: '1px solid rgba(52,211,153,0.25)' }}
                >
                  <Check size={16} style={{ color: '#34D399' }} />
                  <span className="text-sm font-medium" style={{ color: '#34D399' }}>AI suggestion applied</span>
                  <span className="text-sm" style={{ color: UI.muted }}>— {s.employeeName}{dateLabel ? `, ${dateLabel}` : ''}</span>
                </div>
              );
            }

            if (s.status === 'kept') {
              return (
                <div
                  key={s.id}
                  className="rounded-xl px-5 py-4"
                  style={{ backgroundColor: UI.cardAlt, border: `1px solid ${UI.border}` }}
                >
                  <span className="text-sm" style={{ color: UI.muted2 }}>Preference kept</span>
                  <span className="text-sm ml-2" style={{ color: UI.muted }}>— {s.employeeName}{dateLabel ? `, ${dateLabel}` : ''}</span>
                </div>
              );
            }

            return (
              <div
                key={s.id}
                className="rounded-xl p-5"
                style={{ backgroundColor: UI.cardAlt, border: `1px solid ${UI.border}`, borderLeft: `4px solid ${UI.accent}` }}
              >
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: getAvatarColor(s.employeeName), color: '#FFFFFF' }}
                    >
                      {getInitials(s.employeeName)}
                    </div>
                    <span className="font-semibold" style={{ color: UI.text }}>{s.employeeName}</span>
                  </div>
                  {dateLabel && (
                    <span className="text-sm" style={{ color: UI.muted }}>{dateLabel}</span>
                  )}
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-stretch mb-4">
                  <div className="rounded-lg p-3" style={{ backgroundColor: UI.accentSoft }}>
                    <div className="text-[10px] font-semibold tracking-wide mb-2" style={{ color: UI.accent }}>AI SUGGESTED</div>
                    <div className="text-sm font-bold mb-1" style={{ color: UI.text }}>{inferShiftName(aiStart, aiEnd)}</div>
                    <div className="text-xs" style={{ color: UI.muted }}>{formatTime12FromString(aiStart)} – {formatTime12FromString(aiEnd)}</div>
                    <div className="text-xs mt-1" style={{ color: UI.muted2 }}>{aiHours} hours</div>
                  </div>
                  <div className="flex items-center">
                    <ArrowRight size={18} style={{ color: UI.muted2 }} />
                  </div>
                  <div className="rounded-lg p-3" style={{ backgroundColor: 'rgba(251,191,36,0.08)' }}>
                    <div className="text-[10px] font-semibold tracking-wide mb-2" style={{ color: '#FBBF24' }}>SCHEDULED INSTEAD</div>
                    <div className="text-sm font-bold mb-1" style={{ color: UI.text }}>{inferShiftName(schedStart, schedEnd)}</div>
                    <div className="text-xs" style={{ color: UI.muted }}>{formatTime12FromString(schedStart)} – {formatTime12FromString(schedEnd)}</div>
                    <div className="text-xs mt-1" style={{ color: UI.muted2 }}>{schedHours} hours</div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <p className="text-xs italic flex-1" style={{ color: UI.muted }}>
                    Reason: {s.reason}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onAccept(s.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ backgroundColor: UI.accent, color: '#FFFFFF' }}
                    >
                      Accept AI Suggestion
                    </button>
                    <button
                      type="button"
                      onClick={() => onKeep(s.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ backgroundColor: 'transparent', color: UI.muted, border: `1px solid ${UI.border}` }}
                    >
                      Keep My Preference
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Schedule Page ────────────────────────────────────────────────────────────

export default function Schedule() {
  const { employees, workplaceId, loading: employeesLoading } = useEmployees();
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [schedule, setSchedule] = useState<Schedule>(
    isApiConfigured
      ? { id: '', week_start_date: format(new Date(), 'yyyy-MM-dd'), status: 'draft', generated_at: '', last_modified: '' }
      : mockSchedule,
  );
  const [shifts, setShifts] = useState<Shift[]>(isApiConfigured ? [] : mockShifts);
  const [suggestionStates, setSuggestionStates] = useState<Record<string, AISuggestionStatus>>({});
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isApiConfigured);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekStr = format(weekStart, 'yyyy-MM-dd');
  const today = new Date();

  const loadWeek = useCallback(async () => {
    if (!isApiConfigured || !workplaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const detail = await api.getScheduleByWeek(workplaceId, weekStr);
      if (detail) {
        const mapped = loadScheduleWithEmployees(detail, employees);
        setSchedule(mapped.schedule);
        setShifts(mapped.shifts);
        setSuggestionStates({});
      } else {
        setSchedule({
          id: '',
          week_start_date: weekStr,
          status: 'draft',
          generated_at: '',
          last_modified: '',
        });
        setShifts([]);
        setSuggestionStates({});
      }
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
    }
  }, [workplaceId, weekStr, employees]);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek]);

  const aiSuggestions = useMemo((): SuggestionState[] => {
    const overrides = buildAiSuggestions(
      schedule.ml_metadata?.preferenceOverrides,
      schedule.ml_metadata?.llmSuggestedShifts,
      shifts,
      employees,
    );
    return overrides.map((o, i) => ({
      ...o,
      id: `override-${i}`,
      status: suggestionStates[`override-${i}`] ?? 'pending',
    }));
  }, [
    schedule.ml_metadata?.preferenceOverrides,
    schedule.ml_metadata?.llmSuggestedShifts,
    shifts,
    employees,
    suggestionStates,
  ]);

  const filteredEmployees = useMemo(() => {
    let list = employees.length ? [...employees] : [];
    if (roleFilter !== 'all') {
      list = list.filter((e) => e.role.includes(roleFilter));
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [employees, roleFilter]);

  const shiftsByEmployeeDay = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const s of shifts) {
      const key = `${s.employee_id}-${s.date}`;
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  }, [shifts]);

  const dayTotals = useMemo(() =>
    weekDays.map((day) => {
      const ds = format(day, 'yyyy-MM-dd');
      return shifts
        .filter((s) => s.date === ds)
        .reduce((sum, s) => sum + shiftDurationFromStrings(s.start_time, s.end_time), 0);
    }),
  [shifts, weekDays]);

  const employeeTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const emp of employees) {
      const total = shifts
        .filter((s) => s.employee_id === emp.id)
        .reduce((sum, s) => sum + shiftDurationFromStrings(s.start_time, s.end_time), 0);
      map.set(emp.id, total);
    }
    return map;
  }, [shifts, employees]);

  const grandTotal = useMemo(
    () => shifts.reduce((sum, s) => sum + shiftDurationFromStrings(s.start_time, s.end_time), 0),
    [shifts],
  );

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      if (isApiConfigured) {
        const result = await api.generateSchedule(weekStr);
        if (result.scheduleId) {
          await api.publishSchedule(result.scheduleId);
        }
        await loadWeek();
      } else {
        setSchedule((s) => ({ ...s, status: 'draft', generated_at: new Date().toISOString() }));
      }
    } catch (e) {
      setGenerateError(e instanceof ApiError ? e.message : 'Failed to generate schedule');
    } finally {
      setGenerating(false);
    }
  }

  async function handleExport() {
    if (isApiConfigured && schedule.id) {
      const token = getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/schedules/${schedule.id}/export/clearview`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `clearview-${weekStr}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
    }
    const rows = [['Date', 'Employee', 'Role', 'Start', 'End']];
    for (const s of shifts) {
      rows.push([s.date, s.employee?.name ?? '', s.role, s.start_time, s.end_time]);
    }
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${weekStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function applyAiSuggestion(id: string) {
    const suggestion = aiSuggestions.find((s) => s.id === id);
    if (!suggestion || !schedule.id) return;

    const scheduled = parseOverrideLine(suggestion.scheduled);
    const suggested = parseOverrideLine(suggestion.suggested);
    const shift = findShiftForOverride(shifts, scheduled);

    if (shift && suggested.start && suggested.end && isApiConfigured) {
      const updates = { start_time: `${suggested.start}:00`, end_time: `${suggested.end}:00` };
      setShifts((prev) =>
        prev.map((s) => (s.id === shift.id ? { ...s, ...updates } : s)),
      );
      try {
        await api.updateShift(schedule.id, shift.id, updates, employees);
      } catch {
        await loadWeek();
        return;
      }
    }

    setSuggestionStates((prev) => ({ ...prev, [id]: 'accepted' }));
  }

  function keepPreference(id: string) {
    setSuggestionStates((prev) => ({ ...prev, [id]: 'kept' }));
  }

  function acceptAllAi() {
    for (const s of aiSuggestions.filter((x) => x.status === 'pending')) {
      void applyAiSuggestion(s.id);
    }
  }

  function rejectAllAi() {
    setSuggestionStates((prev) => {
      const next = { ...prev };
      for (const s of aiSuggestions.filter((x) => x.status === 'pending')) {
        next[s.id] = 'kept';
      }
      return next;
    });
  }

  const pageLoading = loading || employeesLoading;
  const showGrid = Boolean(schedule.id) && !pageLoading;
  const showEmpty = !pageLoading && !schedule.id;
  const showAiSection =
    showGrid &&
    aiSuggestions.some((s) => s.status === 'pending' || s.status === 'accepted');

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: UI.text }}>Schedule</h1>
        <p className="text-sm mt-0.5" style={{ color: UI.muted }}>
          Manage and publish your weekly shift schedule
        </p>
      </div>

      {generateError && (
        <div
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ backgroundColor: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#FCA5A5' }}
        >
          {generateError}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-4">
        <div
          className="flex items-center gap-1 rounded-xl p-1"
          style={{ backgroundColor: UI.card, border: `1px solid ${UI.border}` }}
        >
          <button
            type="button"
            onClick={() => setWeekStart((w) => subWeeks(w, 1))}
            className="p-2 rounded-lg transition-colors"
            style={{ color: UI.accent }}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-semibold px-3 min-w-[160px] text-center" style={{ color: UI.text }}>
            {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d')}
          </span>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addWeeks(w, 1))}
            className="p-2 rounded-lg transition-colors"
            style={{ color: UI.accent }}
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as Role | 'all')}
            className="px-3 py-2 rounded-lg text-sm font-medium outline-none cursor-pointer"
            style={{ backgroundColor: UI.card, color: UI.text, border: `1px solid ${UI.border}` }}
          >
            <option value="all">All Roles</option>
            <option value="Cook">Cook</option>
            <option value="Cashier">Cashier</option>
            <option value="Packliner">Packer</option>
          </select>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={!showGrid}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
            style={{ backgroundColor: 'transparent', color: UI.text, border: `1px solid ${UI.border}` }}
          >
            <Download size={15} />
            Export
          </button>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-70"
            style={{ backgroundColor: UI.accent, color: '#FFFFFF' }}
          >
            {generating ? (
              <>
                <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#FFFFFF' }} />
                Generating…
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Generate Schedule
              </>
            )}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ backgroundColor: UI.card, border: `1px solid ${UI.border}`, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
      >
        {pageLoading ? (
          <div className="flex items-center justify-center py-24" style={{ color: UI.muted }}>
            Loading schedule…
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center py-24 px-6">
            <Calendar size={48} style={{ color: UI.muted2 }} />
            <p className="text-base font-medium mt-4" style={{ color: UI.muted }}>
              No schedule generated yet for this week
            </p>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: UI.accent, color: '#FFFFFF' }}
            >
              <Sparkles size={16} />
              Generate Schedule
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[calc(100vh-240px)] overflow-y-auto">
            <table className="w-full border-collapse min-w-[1280px]" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th
                    className="sticky left-0 z-30 text-left font-bold px-4 py-4"
                    style={{
                      width: EMP_COL_WIDTH,
                      minWidth: EMP_COL_WIDTH,
                      fontSize: 14,
                      top: 0,
                      backgroundColor: UI.cardAlt,
                      color: UI.text,
                      borderBottom: `1px solid ${UI.border}`,
                    }}
                  >
                    Employee
                  </th>
                  {weekDays.map((day, i) => {
                    const isToday = isSameDay(day, today);
                    const isWeekend = i >= 4;
                    let headerBg = UI.card;
                    if (isToday) headerBg = UI.accent;
                    else if (isWeekend) headerBg = UI.weekend as unknown as string;

                    return (
                      <th
                        key={i}
                        className="sticky z-20 px-2 py-4 text-center"
                        style={{
                          minWidth: DAY_COL_MIN,
                          top: 0,
                          backgroundColor: headerBg,
                          borderBottom: `1px solid ${UI.border}`,
                          borderTopLeftRadius: isToday ? 8 : 0,
                          borderTopRightRadius: isToday ? 8 : 0,
                        }}
                      >
                        <div className="text-base font-bold" style={{ color: isToday ? '#FFFFFF' : UI.text }}>
                          {format(day, 'MMM d')}
                        </div>
                        <div className="text-xs mt-1" style={{ color: isToday ? 'rgba(255,255,255,0.85)' : UI.muted2 }}>
                          {format(day, 'EEEE')}
                        </div>
                      </th>
                    );
                  })}
                  <th
                    className="sticky z-20 px-3 py-4 text-center font-bold"
                    style={{
                      minWidth: 100,
                      fontSize: 14,
                      top: 0,
                      backgroundColor: UI.cardAlt,
                      color: UI.text,
                      borderBottom: `1px solid ${UI.border}`,
                    }}
                  >
                    Week Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((emp, rowIdx) => {
                  const rowBg = rowIdx % 2 === 0 ? UI.card : UI.rowAlt;
                  const isHovered = hoveredRow === emp.id;
                  const empTotal = employeeTotals.get(emp.id) ?? 0;
                  const cellBg = isHovered ? UI.hover : rowBg;

                  return (
                    <tr
                      key={emp.id}
                      onMouseEnter={() => setHoveredRow(emp.id)}
                      onMouseLeave={() => setHoveredRow(null)}
                      style={{
                        height: ROW_HEIGHT,
                        backgroundColor: cellBg,
                        borderBottom: `1px solid ${UI.border}`,
                        cursor: 'pointer',
                        transition: 'background-color 0.12s',
                      }}
                    >
                      <td
                        className="sticky left-0 z-10 px-4 align-middle"
                        style={{
                          width: EMP_COL_WIDTH,
                          minWidth: EMP_COL_WIDTH,
                          backgroundColor: isHovered ? UI.hover : rowBg,
                          borderRight: `1px solid ${UI.border}`,
                        }}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold" style={{ color: UI.text }}>
                            {displayNameShort(emp.name)}
                          </span>
                        </div>
                      </td>

                      {weekDays.map((day, dayIndex) => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const dayShifts = shiftsByEmployeeDay.get(`${emp.id}-${dateStr}`) ?? [];
                        const isToday = isSameDay(day, today);
                        const bg = isToday ? UI.todayCol : isHovered ? UI.hover : rowBg;

                        return (
                          <td
                            key={dayIndex}
                            className="text-center align-middle px-1.5 py-2"
                            style={{ backgroundColor: bg, minWidth: DAY_COL_MIN }}
                          >
                            <div className="flex flex-col items-center gap-1.5">
                              {dayShifts.map((shift) => (
                                <ShiftPill
                                  key={shift.id}
                                  shift={shift}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPopover({ shift, x: e.clientX, y: e.clientY });
                                  }}
                                />
                              ))}
                            </div>
                          </td>
                        );
                      })}

                      <td
                        className="text-center align-middle font-bold"
                        style={{
                          fontSize: 14,
                          color: weekTotalColor(empTotal),
                          backgroundColor: isHovered ? UI.hover : rowBg,
                        }}
                      >
                        {Math.round(empTotal * 10) / 10} hrs
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: UI.footer }}>
                  <td
                    className="sticky left-0 z-10 px-4 py-3.5 font-bold"
                    style={{
                      backgroundColor: UI.footer,
                      color: UI.text,
                      width: EMP_COL_WIDTH,
                      minWidth: EMP_COL_WIDTH,
                      fontSize: 14,
                    }}
                  >
                    Total Hours
                  </td>
                  {dayTotals.map((total, i) => (
                    <td key={i} className="text-center py-3.5 font-bold" style={{ color: UI.text, fontSize: 14 }}>
                      {Math.round(total)} hrs
                    </td>
                  ))}
                  <td className="text-center py-3.5 font-bold" style={{ color: UI.text, fontSize: 14 }}>
                    {Math.round(grandTotal)} hrs
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {showAiSection && (
        <AISuggestionsSection
          suggestions={aiSuggestions}
          onAccept={(id) => void applyAiSuggestion(id)}
          onKeep={keepPreference}
          onAcceptAll={() => void acceptAllAi()}
          onRejectAll={rejectAllAi}
        />
      )}

      {popover && <ShiftPopover popover={popover} onClose={() => setPopover(null)} />}
    </div>
  );
}
