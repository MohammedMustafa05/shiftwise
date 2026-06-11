import { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
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
import type { Employee, PreferenceOverride, Role, Schedule, Shift } from '../lib/types';
import { getInitials, getAvatarColor } from '../lib/utils';
import { api, isApiConfigured, loadScheduleWithEmployees } from '../lib/api';
import { ApiError, getToken, apiFetch } from '../lib/api/client';
import { useEmployees } from '../hooks/useEmployerApi';
import { OverrideReasonPicker } from '../components/schedule/OverrideReasonPicker';
import type { OverrideReason } from '@shiftagent/shared';
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
      title={shift.is_engine_suggested && shift.llm_reasoning ? shift.llm_reasoning : undefined}
      className="inline-flex flex-col items-center justify-center rounded-2xl font-bold transition-transform hover:scale-[1.02] relative"
      style={{
        padding: '8px 14px',
        backgroundColor: style.bg,
        color: style.text,
        whiteSpace: 'nowrap',
        fontSize: 13,
        lineHeight: 1.25,
        gap: 4,
        outline: shift.is_engine_suggested ? '1px solid rgba(129,140,248,0.5)' : undefined,
      }}
      onClick={onClick}
    >
      {shift.is_engine_suggested && (
        <span
          className="absolute -top-1 -right-1 text-[8px] font-bold px-1 rounded"
          style={{ backgroundColor: UI.accent, color: '#FFF' }}
        >
          AI
        </span>
      )}
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

function parseISOSafe(iso: string): Date | null {
  try {
    const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// ─── Time Wheel Picker ────────────────────────────────────────────────────────

const SCHED_TIME_OPTS: { value: string; label: string }[] = (() => {
  const opts: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const value = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      const period = h < 12 ? 'AM' : 'PM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      opts.push({ value, label: `${h12}:${m.toString().padStart(2, '0')} ${period}` });
    }
  }
  return opts;
})();

const S_ITEM_H = 36;
const S_COPY_LEN = SCHED_TIME_OPTS.length;
const S_REPEATED = [...SCHED_TIME_OPTS, ...SCHED_TIME_OPTS, ...SCHED_TIME_OPTS];

function SchedWheelPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedIdx = Math.max(0, SCHED_TIME_OPTS.findIndex((o) => o.value === value));

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const target = (S_COPY_LEN + selectedIdx - 1) * S_ITEM_H;
    if (Math.abs(containerRef.current.scrollTop - target) > 1) {
      containerRef.current.scrollTop = target;
    }
  }, [selectedIdx]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    let { scrollTop } = el;
    const OFFSET = S_COPY_LEN * S_ITEM_H;
    if (scrollTop < (S_COPY_LEN - 1) * S_ITEM_H) {
      el.scrollTop = scrollTop + OFFSET;
      scrollTop = el.scrollTop;
    } else if (scrollTop > (2 * S_COPY_LEN - 2) * S_ITEM_H) {
      el.scrollTop = scrollTop - OFFSET;
      scrollTop = el.scrollTop;
    }
    const absIdx = Math.round(scrollTop / S_ITEM_H) + 1;
    const realIdx = ((absIdx % S_COPY_LEN) + S_COPY_LEN) % S_COPY_LEN;
    if (SCHED_TIME_OPTS[realIdx].value !== value) onChange(SCHED_TIME_OPTS[realIdx].value);
  }

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <style>{`.swp::-webkit-scrollbar{display:none}`}</style>
      <div style={{ position: 'absolute', top: S_ITEM_H, left: 4, right: 4, height: S_ITEM_H, backgroundColor: UI.accentSoft, borderTop: `1px solid ${UI.border}`, borderBottom: `1px solid ${UI.border}`, borderRadius: 6, pointerEvents: 'none', zIndex: 1 }} />
      <div
        ref={containerRef}
        className="swp"
        onScroll={handleScroll}
        style={{ height: S_ITEM_H * 3, overflowY: 'scroll', scrollbarWidth: 'none', backgroundColor: UI.cardAlt, borderRadius: 8, border: `1px solid ${UI.border}`, scrollSnapType: 'y mandatory', overscrollBehavior: 'contain', position: 'relative' }}
      >
        {S_REPEATED.map((opt, absIdx) => {
          const absDist = Math.abs(absIdx - (S_COPY_LEN + selectedIdx));
          const isCenter = absDist === 0;
          const localIdx = absIdx % S_COPY_LEN;
          return (
            <div
              key={`${absIdx}-${opt.value}`}
              onClick={() => { onChange(opt.value); if (containerRef.current) containerRef.current.scrollTop = (S_COPY_LEN + localIdx - 1) * S_ITEM_H; }}
              style={{ height: S_ITEM_H, display: 'flex', alignItems: 'center', justifyContent: 'center', scrollSnapAlign: 'center', cursor: 'pointer', fontSize: isCenter ? 14 : 12, fontWeight: isCenter ? 600 : 400, color: isCenter ? UI.text : UI.muted, opacity: absDist === 0 ? 1 : absDist === 1 ? 0.5 : 0.2, transform: `scale(${isCenter ? 1 : 0.9})`, transition: 'opacity 0.12s, transform 0.12s', userSelect: 'none' }}
            >
              {opt.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Edit Shift Popover ───────────────────────────────────────────────────────

type PopoverAnchor = { x: number; y: number };

type EditPopoverState = PopoverAnchor & { shift: Shift };

type AddShiftPopoverState = PopoverAnchor & { employeeId: string; date: string };

type ShiftFormPayload = {
  employeeId: string;
  start: string;
  end: string;
  role: Role;
};

const ROLE_OPTIONS: Role[] = ['Cook', 'Cashier', 'Packer'];

function shiftOutsideAvailability(
  availGrid: Record<string, string[]> | null,
  date: string,
  start: string,
  end: string
): boolean {
  if (!availGrid) return false;
  const day = parseISOSafe(date);
  if (!day) return false;
  const KEY: Record<number, string> = {
    0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday',
  };
  const hours = availGrid[KEY[day.getDay()]] ?? [];
  if (!hours.length) return false;
  const startH = parseInt(start.split(':')[0], 10);
  const endH = parseInt(end.split(':')[0], 10);
  for (let h = startH; h < endH; h++) {
    if (!hours.includes(`${h.toString().padStart(2, '0')}:00`)) return true;
  }
  return false;
}

function ShiftEditorPopover({
  anchor,
  title,
  subtitle,
  employees,
  initial,
  availGrid,
  date,
  onClose,
  onSave,
  onDelete,
  saveLabel = 'Save',
}: {
  anchor: PopoverAnchor;
  title: string;
  subtitle: string;
  employees: Employee[];
  initial: ShiftFormPayload;
  availGrid: Record<string, string[]> | null;
  date: string;
  onClose: () => void;
  onSave: (payload: ShiftFormPayload) => Promise<void>;
  onDelete?: () => Promise<void>;
  saveLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [employeeId, setEmployeeId] = useState(initial.employeeId);
  const [role, setRole] = useState<Role>(initial.role);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [onClose]);

  const availConflict = useMemo(
    () => shiftOutsideAvailability(availGrid, date, start, end),
    [availGrid, date, start, end]
  );

  const popoverW = 320;
  const popoverH = onDelete ? 520 : 480;
  const left = Math.min(Math.max(8, anchor.x - popoverW / 2), window.innerWidth - popoverW - 8);
  const top = Math.min(anchor.y + 12, window.innerHeight - popoverH - 8);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ employeeId, start, end, role });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 rounded-xl shadow-xl"
      style={{ left, top, width: popoverW, backgroundColor: UI.card, border: `1px solid ${UI.border}` }}
    >
      <div className="p-4 max-h-[85vh] overflow-y-auto">
        <div className="text-sm font-semibold mb-0.5" style={{ color: UI.text }}>{title}</div>
        <div className="text-xs mb-3" style={{ color: UI.muted }}>{subtitle}</div>

        <label className="block text-xs font-medium mb-1" style={{ color: UI.muted }}>Employee</label>
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="w-full mb-3 px-2 py-2 rounded-lg text-sm outline-none"
          style={{ backgroundColor: UI.cardAlt, color: UI.text, border: `1px solid ${UI.border}` }}
        >
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.name}</option>
          ))}
        </select>

        <label className="block text-xs font-medium mb-1" style={{ color: UI.muted }}>Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="w-full mb-3 px-2 py-2 rounded-lg text-sm outline-none"
          style={{ backgroundColor: UI.cardAlt, color: UI.text, border: `1px solid ${UI.border}` }}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        {availConflict && (
          <div className="text-xs mb-3" style={{ color: '#F87171' }}>
            Outside this employee&apos;s available hours (shifts must fit inside their submitted block)
          </div>
        )}

        <div className="flex gap-3 mb-4">
          <div style={{ flex: 1 }}>
            <div className="text-xs mb-1.5 font-medium" style={{ color: UI.muted }}>Start</div>
            <SchedWheelPicker value={start} onChange={setStart} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="text-xs mb-1.5 font-medium" style={{ color: UI.muted }}>End</div>
            <SchedWheelPicker value={end} onChange={setEnd} />
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || deleting}
          className="w-full py-2 rounded-lg text-sm font-semibold mb-2 disabled:opacity-60"
          style={{ backgroundColor: UI.accent, color: '#FFFFFF' }}
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={saving || deleting}
            className="w-full py-2 rounded-lg text-sm font-semibold mb-2 disabled:opacity-60"
            style={{ backgroundColor: 'transparent', color: '#F87171', border: '1px solid rgba(248,113,113,0.35)' }}
          >
            {deleting ? 'Removing…' : 'Remove shift'}
          </button>
        ) : null}
        <button type="button" onClick={onClose} className="w-full py-1.5 text-xs font-medium" style={{ color: UI.muted }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Role Conflict Toast + Warnings ──────────────────────────────────────────

function RoleConflictToast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg text-sm" style={{ backgroundColor: 'rgba(248,113,113,0.2)', color: '#F87171', border: '1px solid rgba(248,113,113,0.3)' }}>
      {msg}
    </div>
  );
}

function ScheduleToast({ toast, onClose }: { toast: { type: 'success' | 'error'; msg: string }; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, toast.type === 'success' ? 2000 : 3000);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  const isError = toast.type === 'error';
  return (
    <div
      className="fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg text-sm"
      style={isError
        ? { backgroundColor: 'rgba(248,113,113,0.2)', color: '#F87171', border: '1px solid rgba(248,113,113,0.3)' }
        : { backgroundColor: '#16161F', color: '#F1F5F9', border: '1px solid #1E1E2A' }
      }
    >
      {toast.msg}
    </div>
  );
}

function RoleConflictsWarning({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <div className="mb-4 rounded-lg px-4 py-3" style={{ backgroundColor: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
      <div className="text-sm font-semibold mb-1.5" style={{ color: '#F87171' }}>⚠ Role Conflicts Detected</div>
      <ul className="space-y-0.5">
        {warnings.map((w, i) => (
          <li key={i} className="text-xs" style={{ color: '#FCA5A5' }}>• {w}</li>
        ))}
      </ul>
      <div className="text-xs mt-2" style={{ color: '#F87171', opacity: 0.7 }}>Resolve before publishing: each employee can only have one role per day.</div>
    </div>
  );
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
  const [popover, setPopover] = useState<EditPopoverState | null>(null);
  const [addShift, setAddShift] = useState<AddShiftPopoverState | null>(null);
  const [pendingOverride, setPendingOverride] = useState<{
    shiftId: string;
    start: string;
    end: string;
    role: Role;
    employeeId: string;
    employeeName: string;
  } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isApiConfigured);
  const [employeeAvailMap, setEmployeeAvailMap] = useState<Map<string, Record<string, string[]>>>(new Map());
  const [roleConflictToast, setRoleConflictToast] = useState<string | null>(null);
  const [lockedTooltip, setLockedTooltip] = useState<{ x: number; y: number } | null>(null);
  const [roleWarnings, setRoleWarnings] = useState<string[]>([]);
  const [scheduleToast, setScheduleToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    if (!lockedTooltip) return;
    const t = setTimeout(() => setLockedTooltip(null), 2000);
    return () => clearTimeout(t);
  }, [lockedTooltip]);

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

        // Check for one-role-per-day violations
        const byEmpDay = new Map<string, Set<string>>();
        for (const s of mapped.shifts) {
          const key = `${s.employee_id}|${s.date}`;
          const roles = byEmpDay.get(key) ?? new Set<string>();
          roles.add(s.role);
          byEmpDay.set(key, roles);
        }
        const warns: string[] = [];
        for (const [key, roles] of byEmpDay) {
          if (roles.size > 1) {
            const sepIdx = key.indexOf('|');
            const empId = key.slice(0, sepIdx);
            const date = key.slice(sepIdx + 1);
            const emp = employees.find((e) => e.id === empId);
            const empName = emp?.name ?? 'Employee';
            const d = parseISOSafe(date);
            const dateLabel = d ? format(d, 'EEE MMM d') : date;
            warns.push(`${empName} is already scheduled as ${[...roles].join(' and ')} on ${dateLabel}`);
          }
        }
        setRoleWarnings(warns);
        if (warns.length > 0) setRoleConflictToast(warns[0]);

        // Fetch approved availability for in-popover conflict check
        if (isApiConfigured) {
          try {
            const availRaw = await apiFetch<Array<{ employeeId: string; availabilityGrid: Record<string, string[]> }>>(
              '/api/approvals/availability?status=approved',
            );
            const amap = new Map<string, Record<string, string[]>>();
            for (const item of availRaw) {
              if (!item.employeeId || !item.availabilityGrid) continue;
              const emp = employees.find(
                (e) => (e as Employee & { userId?: string }).userId === item.employeeId,
              );
              if (emp) {
                amap.set(emp.id, item.availabilityGrid);
                amap.set(item.employeeId, item.availabilityGrid);
              } else {
                amap.set(item.employeeId, item.availabilityGrid);
              }
            }
            setEmployeeAvailMap(amap);
          } catch {
            /* no availability data — conflict check disabled */
          }
        }
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
        setRoleWarnings([]);
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
    setScheduleToast({ type: 'success', msg: 'Generating schedule… this can take 2–3 minutes. Do not leave this page.' });
    try {
      if (isApiConfigured) {
        const result = await api.generateSchedule(weekStr);
        await loadWeek();
        const shiftCount = result.shifts?.length ?? shifts.length;
        setScheduleToast({
          type: 'success',
          msg: shiftCount
            ? `Draft schedule ready (${shiftCount} shifts) — edit shifts, then publish when ready`
            : 'Draft schedule generated — edit shifts, then publish when ready',
        });
      } else {
        setSchedule((s) => ({ ...s, status: 'draft', generated_at: new Date().toISOString() }));
      }
    } catch (e) {
      setGenerateError(e instanceof ApiError ? e.message : 'Failed to generate schedule');
    } finally {
      setGenerating(false);
    }
  }

  async function handleExportPdf() {
    if (!isApiConfigured || !schedule.id) return;
    const token = getToken();
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/schedules/${schedule.id}/export/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = 'PDF export failed';
        try {
          const body = await res.json();
          msg = body.error ?? msg;
        } catch {
          /* non-JSON error body */
        }
        setScheduleToast({ type: 'error', msg });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schedule-${weekStr}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setScheduleToast({ type: 'error', msg: 'PDF export failed — is the API running?' });
    }
  }

  async function handleExportCsv() {
    if (isApiConfigured && schedule.id && schedule.status === 'published') {
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
      const firstName = (s.employee?.name ?? '').trim().split(/\s+/)[0] ?? '';
      rows.push([s.date, firstName, s.role, s.start_time.slice(0, 5), s.end_time.slice(0, 5)]);
    }
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${weekStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isDraft = schedule.status === 'draft';

  async function persistShiftUpdate(shiftId: string, payload: ShiftFormPayload, useOverride: boolean) {
    if (!schedule.id || !isApiConfigured) return;
    if (useOverride) {
      const emp = employees.find((e) => e.id === payload.employeeId);
      setPendingOverride({
        shiftId,
        start: payload.start,
        end: payload.end,
        role: payload.role,
        employeeId: payload.employeeId,
        employeeName: emp?.name ?? 'Employee',
      });
      return;
    }
    const updates = {
      start_time: `${payload.start}:00`,
      end_time: `${payload.end}:00`,
      role: payload.role,
      employee_id: payload.employeeId,
    };
    const prevShifts = shifts;
    setShifts((prev) =>
      prev.map((s) =>
        s.id === shiftId
          ? {
              ...s,
              ...updates,
              employee: employees.find((e) => e.id === payload.employeeId) ?? s.employee,
            }
          : s
      )
    );
    try {
      await api.updateShift(schedule.id, shiftId, updates, employees);
      await loadWeek();
      setScheduleToast({ type: 'success', msg: 'Shift saved' });
    } catch {
      setShifts(prevShifts);
      setScheduleToast({ type: 'error', msg: 'Failed to save — please try again' });
    }
  }

  async function handleEditSave(shiftId: string, payload: ShiftFormPayload) {
    const shift = shifts.find((s) => s.id === shiftId);
    if (!shift) return;
    setPopover(null);
    await persistShiftUpdate(shiftId, payload, Boolean(shift.is_engine_suggested && isApiConfigured));
  }

  async function handleOverrideConfirm(reason: OverrideReason, notes: string) {
    if (!pendingOverride || !schedule.id) return;
    const { shiftId, start, end, role, employeeId } = pendingOverride;
    try {
      await api.overrideShift(schedule.id, shiftId, {
        overrideReason: reason,
        notes: notes || undefined,
        startTime: start,
        endTime: end,
        role: role.toUpperCase(),
        employeeId: (employees.find((e) => e.id === employeeId) as Employee & { userId?: string })?.userId ?? employeeId,
      });
      await loadWeek();
      setScheduleToast({ type: 'success', msg: 'Saved with override reason' });
    } catch {
      setScheduleToast({ type: 'error', msg: 'Failed to save — please try again' });
    } finally {
      setPendingOverride(null);
    }
  }

  async function handleDeleteShift(shiftId: string) {
    if (!schedule.id || !isApiConfigured) return;
    try {
      await api.deleteShift(schedule.id, shiftId);
      await loadWeek();
      setScheduleToast({ type: 'success', msg: 'Shift removed' });
    } catch {
      setScheduleToast({ type: 'error', msg: 'Failed to remove shift' });
    }
  }

  async function handleAddShiftSave(payload: ShiftFormPayload, date: string) {
    if (!schedule.id || !isApiConfigured) return;
    const emp = employees.find((e) => e.id === payload.employeeId);
    const userId = (emp as Employee & { userId?: string })?.userId ?? payload.employeeId;
    try {
      await api.createShift(
        schedule.id,
        {
          employeeId: userId,
          shiftDate: date,
          startTime: payload.start,
          endTime: payload.end,
          role: payload.role,
        },
        employees
      );
      await loadWeek();
      setScheduleToast({ type: 'success', msg: 'Shift added' });
    } catch {
      setScheduleToast({ type: 'error', msg: 'Failed to add shift' });
    }
  }

  async function handlePublish() {
    if (!schedule.id) return;
    setPublishing(true);
    try {
      await api.publishSchedule(schedule.id);
      await loadWeek();
      setScheduleToast({ type: 'success', msg: 'Schedule published' });
    } catch (e) {
      setScheduleToast({
        type: 'error',
        msg: e instanceof ApiError ? e.message : 'Failed to publish',
      });
    } finally {
      setPublishing(false);
    }
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

      <RoleConflictsWarning warnings={roleWarnings} />

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
            onClick={() => void handleExportPdf()}
            disabled={!showGrid}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
            style={{ backgroundColor: 'transparent', color: UI.text, border: `1px solid ${UI.border}` }}
          >
            <Download size={15} />
            Download PDF
          </button>
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            disabled={!showGrid}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
            style={{ backgroundColor: 'transparent', color: UI.text, border: `1px solid ${UI.border}` }}
          >
            Export CSV
          </button>
          {isDraft && schedule.id ? (
            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={publishing || roleWarnings.length > 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
              style={{ backgroundColor: 'transparent', color: UI.text, border: `1px solid ${UI.border}` }}
              title={roleWarnings.length > 0 ? 'Resolve role conflicts before publishing' : undefined}
            >
              {publishing ? 'Publishing…' : 'Publish schedule'}
            </button>
          ) : null}
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
                      className="group"
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
                            onClick={(e) => {
                              if (!isDraft) return;
                              if ((e.target as HTMLElement).closest('button')) return;
                              setAddShift({ employeeId: emp.id, date: dateStr, x: e.clientX, y: e.clientY });
                            }}
                          >
                            <div className="flex flex-col items-center gap-1.5 min-h-[40px] justify-center">
                              {dayShifts.map((shift) => (
                                <ShiftPill
                                  key={shift.id}
                                  shift={shift}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isDraft) return;
                                    if (shift.is_locked) {
                                      setLockedTooltip({ x: e.clientX, y: e.clientY });
                                    } else {
                                      setPopover({ shift, x: e.clientX, y: e.clientY });
                                    }
                                  }}
                                />
                              ))}
                              {isDraft && dayShifts.length === 0 ? (
                                <span className="text-xs opacity-0 group-hover:opacity-100" style={{ color: UI.muted2 }}>
                                  + Add
                                </span>
                              ) : null}
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

      {popover && isDraft ? (
        <ShiftEditorPopover
          anchor={popover}
          title="Edit shift"
          subtitle={
            parseISOSafe(popover.shift.date)
              ? format(parseISOSafe(popover.shift.date)!, 'EEEE, MMM d')
              : popover.shift.date
          }
          employees={employees}
          initial={{
            employeeId: popover.shift.employee_id,
            role: popover.shift.role,
            start: popover.shift.start_time.slice(0, 5),
            end: popover.shift.end_time.slice(0, 5),
          }}
          availGrid={employeeAvailMap.get(popover.shift.employee_id) ?? null}
          date={popover.shift.date}
          onClose={() => setPopover(null)}
          onSave={(payload) => handleEditSave(popover.shift.id, payload)}
          onDelete={() => handleDeleteShift(popover.shift.id)}
        />
      ) : null}

      {addShift && isDraft ? (
        <ShiftEditorPopover
          anchor={addShift}
          title="Add shift"
          subtitle={
            parseISOSafe(addShift.date)
              ? format(parseISOSafe(addShift.date)!, 'EEEE, MMM d')
              : addShift.date
          }
          employees={employees}
          initial={{
            employeeId: addShift.employeeId,
            role: employees.find((e) => e.id === addShift.employeeId)?.role[0] ?? 'Cook',
            start: '10:00',
            end: '16:00',
          }}
          availGrid={employeeAvailMap.get(addShift.employeeId) ?? null}
          date={addShift.date}
          onClose={() => setAddShift(null)}
          onSave={async (payload) => {
            const date = addShift.date;
            setAddShift(null);
            await handleAddShiftSave(payload, date);
          }}
          saveLabel="Add shift"
        />
      ) : null}

      {pendingOverride && (
        <OverrideReasonPicker
          employeeName={pendingOverride.employeeName}
          onConfirm={(reason, notes) => void handleOverrideConfirm(reason, notes)}
          onCancel={() => setPendingOverride(null)}
        />
      )}

      {lockedTooltip && (
        <div
          className="fixed z-50 rounded-lg px-3 py-2 text-xs font-medium shadow-xl pointer-events-none"
          style={{ left: lockedTooltip.x, top: lockedTooltip.y + 8, backgroundColor: UI.card, border: `1px solid ${UI.border}`, color: UI.muted }}
        >
          Unlock this shift to edit
        </div>
      )}

      {roleConflictToast && (
        <RoleConflictToast msg={roleConflictToast} onClose={() => setRoleConflictToast(null)} />
      )}

      {scheduleToast && (
        <ScheduleToast toast={scheduleToast} onClose={() => setScheduleToast(null)} />
      )}
    </div>
  );
}
