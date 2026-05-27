import { useState, useRef, useLayoutEffect } from 'react';
import { Settings, CheckCircle2, Lock, Unlock, ChevronDown, Plus, X } from 'lucide-react';
import { mockPreferences } from '../lib/mockData';
import type { Preferences, TimeRangeRule } from '../lib/types';
import { getRoleBadgeClass } from '../lib/utils';

// ── Day constants ──────────────────────────────────────────────────────────

const DAYS: { key: string; short: string }[] = [
  { key: 'Monday',    short: 'Mon' },
  { key: 'Tuesday',  short: 'Tue' },
  { key: 'Wednesday',short: 'Wed' },
  { key: 'Thursday', short: 'Thu' },
  { key: 'Friday',   short: 'Fri' },
  { key: 'Saturday', short: 'Sat' },
  { key: 'Sunday',   short: 'Sun' },
];

// ── Operating Hours types & constants ─────────────────────────────────────

const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] as const;
type DayName = typeof DAY_NAMES[number];
interface DayHours { open: string; close: string; closed: boolean; }

const WEEKEND_DAYS: readonly DayName[] = ['Saturday', 'Sunday'];

const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const opts: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const value = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
      const period = h < 12 ? 'AM' : 'PM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const label = `${h12}:${m.toString().padStart(2,'0')} ${period}`;
      opts.push({ value, label });
    }
  }
  return opts;
})();

const ITEM_H = 36;
const COPY_LEN = TIME_OPTIONS.length;
const REPEATED_OPTIONS = [...TIME_OPTIONS, ...TIME_OPTIONS, ...TIME_OPTIONS];

function initDayHours(): Record<DayName, DayHours> {
  const base: DayHours = {
    open: mockPreferences.operating_hours.open,
    close: mockPreferences.operating_hours.close,
    closed: false,
  };
  return {
    Monday:    { ...base },
    Tuesday:   { ...base },
    Wednesday: { ...base },
    Thursday:  { ...base },
    Friday:    { ...base },
    Saturday:  { ...base },
    Sunday:    { ...base },
  };
}

// ── Shared sub-components ──────────────────────────────────────────────────

function Section({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
      <div className="mb-5">
        <div className="text-sm font-semibold" style={{ color: '#FAFAFA' }}>{title}</div>
        {description && <div className="text-xs mt-0.5" style={{ color: '#71717A' }}>{description}</div>}
      </div>
      {children}
    </div>
  );
}

function NumInput({
  label, value, onChange, min, max, suffix, hint,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; suffix?: string; hint?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider mb-1.5"
        style={{ color: '#71717A', letterSpacing: '0.06em' }}>
        {label}
      </label>
      <div className="relative">
        <input
          type="number" value={value} min={min} max={max}
          onChange={e => onChange(Number(e.target.value))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="w-full pl-3 pr-12 py-2.5 rounded-lg text-sm outline-none transition-all"
          style={{
            backgroundColor: '#18181B',
            border: `1px solid ${focused ? '#818CF8' : '#3F3F46'}`,
            boxShadow: focused ? '0 0 0 1px #818CF8' : 'none',
            color: '#FAFAFA',
          }}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#71717A' }}>{suffix}</span>
        )}
      </div>
      {hint && <div className="text-xs mt-1" style={{ color: '#71717A' }}>{hint}</div>}
    </div>
  );
}

// ── Time select for rule rows ──────────────────────────────────────────────

function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="appearance-none pl-2 pr-6 py-1.5 rounded-lg text-xs outline-none transition-all"
        style={{
          backgroundColor: '#18181B',
          border: `1px solid ${focused ? '#818CF8' : '#3F3F46'}`,
          color: '#FAFAFA',
          minWidth: 90,
        }}
      >
        {TIME_OPTIONS.map(o => (
          <option key={o.value} value={o.value} style={{ backgroundColor: '#27272A' }}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#71717A' }} />
    </div>
  );
}

function RuleNumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type="number" value={value} min={0} max={99}
      onChange={e => onChange(Number(e.target.value))}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="w-14 text-center py-1.5 rounded-lg text-xs outline-none transition-all"
      style={{
        backgroundColor: '#18181B',
        border: `1px solid ${focused ? '#818CF8' : '#3F3F46'}`,
        color: '#FAFAFA',
      }}
    />
  );
}

// ── Role Requirements per Day ──────────────────────────────────────────────

function RoleRequirementsSection({
  prefs, setPrefs,
}: {
  prefs: Preferences;
  setPrefs: React.Dispatch<React.SetStateAction<Preferences>>;
}) {
  const [activeDay, setActiveDay] = useState('Monday');

  const rules = prefs.role_requirements[activeDay] ?? [];

  function addRule() {
    const newRule: TimeRangeRule = { from: '10:00', to: '16:00', cashiers: 0, cooks: 0, packliners: 0 };
    setPrefs(p => ({
      ...p,
      role_requirements: {
        ...p.role_requirements,
        [activeDay]: [...(p.role_requirements[activeDay] ?? []), newRule],
      },
    }));
  }

  function removeRule(idx: number) {
    setPrefs(p => {
      const next = [...(p.role_requirements[activeDay] ?? [])];
      next.splice(idx, 1);
      return { ...p, role_requirements: { ...p.role_requirements, [activeDay]: next } };
    });
  }

  function updateRule(idx: number, field: keyof TimeRangeRule, val: string | number) {
    setPrefs(p => {
      const next = [...(p.role_requirements[activeDay] ?? [])];
      next[idx] = { ...next[idx], [field]: val };
      return { ...p, role_requirements: { ...p.role_requirements, [activeDay]: next } };
    });
  }

  function copyToDay(targetDay: string) {
    const currentRules = (prefs.role_requirements[activeDay] ?? []).map(r => ({ ...r }));
    setPrefs(p => ({
      ...p,
      role_requirements: { ...p.role_requirements, [targetDay]: currentRules },
    }));
  }

  return (
    <Section
      title="Staff Requirements by Time"
      description="Define minimum staff per role for each time range, per day"
    >
      {/* Day tabs */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {DAYS.map(d => (
          <button
            key={d.key}
            onClick={() => setActiveDay(d.key)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={
              activeDay === d.key
                ? { backgroundColor: '#818CF8', color: '#FFFFFF' }
                : { backgroundColor: '#18181B', color: '#71717A', border: '1px solid #3F3F46' }
            }
            onMouseEnter={e => { if (activeDay !== d.key) (e.currentTarget as HTMLElement).style.color = '#A1A1AA'; }}
            onMouseLeave={e => { if (activeDay !== d.key) (e.currentTarget as HTMLElement).style.color = '#71717A'; }}
          >
            {d.short}
          </button>
        ))}
      </div>

      {/* Column headers */}
      {rules.length > 0 && (
        <div
          className="grid items-center gap-2 px-2 mb-2"
          style={{ gridTemplateColumns: '1fr 8px 1fr 56px 56px 56px 28px' }}
        >
          <div className="text-xs font-medium uppercase tracking-wider" style={{ color: '#71717A' }}>From</div>
          <div />
          <div className="text-xs font-medium uppercase tracking-wider" style={{ color: '#71717A' }}>To</div>
          <div className="text-center">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeClass('Cashier')}`}>
              Cashier
            </span>
          </div>
          <div className="text-center">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeClass('Cook')}`}>
              Cook
            </span>
          </div>
          <div className="text-center">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeClass('Packliner')}`}>
              Pckln
            </span>
          </div>
          <div />
        </div>
      )}

      {/* Time range rows */}
      <div className="space-y-2 mb-3">
        {rules.map((rule, idx) => (
          <div
            key={idx}
            className="grid items-center gap-2 px-2 py-2 rounded-lg"
            style={{ gridTemplateColumns: '1fr 8px 1fr 56px 56px 56px 28px', backgroundColor: '#18181B', border: '1px solid #3F3F46' }}
          >
            <TimeSelect value={rule.from} onChange={v => updateRule(idx, 'from', v)} />
            <div className="text-center text-xs" style={{ color: '#71717A' }}>–</div>
            <TimeSelect value={rule.to} onChange={v => updateRule(idx, 'to', v)} />
            <div className="flex justify-center">
              <RuleNumInput value={rule.cashiers} onChange={v => updateRule(idx, 'cashiers', v)} />
            </div>
            <div className="flex justify-center">
              <RuleNumInput value={rule.cooks} onChange={v => updateRule(idx, 'cooks', v)} />
            </div>
            <div className="flex justify-center">
              <RuleNumInput value={rule.packliners} onChange={v => updateRule(idx, 'packliners', v)} />
            </div>
            <div className="flex justify-center">
              <button
                onClick={() => removeRule(idx)}
                className="flex items-center justify-center w-6 h-6 rounded transition-colors"
                style={{ color: '#71717A' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#F87171'; (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(248,113,113,0.1)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#71717A'; (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              >
                <X size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add time range */}
      <button
        onClick={addRule}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all mb-5"
        style={{ color: '#818CF8', backgroundColor: 'rgba(129,140,248,0.08)', border: '1px dashed rgba(129,140,248,0.3)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(129,140,248,0.15)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(129,140,248,0.08)'}
      >
        <Plus size={12} />
        Add Time Range
      </button>

      {/* Copy to other days */}
      <div style={{ borderTop: '1px solid #3F3F46', paddingTop: 16 }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: '#71717A' }}>Copy this day to:</span>
          {DAYS.filter(d => d.key !== activeDay).map(d => (
            <button
              key={d.key}
              onClick={() => copyToDay(d.key)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
              style={{ backgroundColor: '#18181B', color: '#A1A1AA', border: '1px solid #3F3F46' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46'; (e.currentTarget as HTMLElement).style.color = '#FAFAFA'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#18181B'; (e.currentTarget as HTMLElement).style.color = '#A1A1AA'; }}
            >
              {d.short}
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ── Wheel Picker ───────────────────────────────────────────────────────────

function WheelPicker({ value, onChange, disabled }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedIdx = Math.max(0, TIME_OPTIONS.findIndex(o => o.value === value));

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const target = (COPY_LEN + selectedIdx - 1) * ITEM_H;
    if (Math.abs(containerRef.current.scrollTop - target) > 1) {
      containerRef.current.scrollTop = target;
    }
  }, [selectedIdx]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    let { scrollTop } = el;
    const OFFSET = COPY_LEN * ITEM_H;
    if (scrollTop < (COPY_LEN - 1) * ITEM_H) {
      el.scrollTop = scrollTop + OFFSET;
      scrollTop = el.scrollTop;
    } else if (scrollTop > (2 * COPY_LEN - 2) * ITEM_H) {
      el.scrollTop = scrollTop - OFFSET;
      scrollTop = el.scrollTop;
    }
    const absIdx = Math.round(scrollTop / ITEM_H) + 1;
    const realIdx = ((absIdx % COPY_LEN) + COPY_LEN) % COPY_LEN;
    if (TIME_OPTIONS[realIdx].value !== value) {
      onChange(TIME_OPTIONS[realIdx].value);
    }
  }

  return (
    <div style={{ position: 'relative', width: 120, flexShrink: 0 }}>
      <style>{`.wpicker::-webkit-scrollbar{display:none}`}</style>
      <div
        style={{
          position: 'absolute',
          top: ITEM_H, left: 4, right: 4,
          height: ITEM_H,
          backgroundColor: 'rgba(129,140,248,0.15)',
          borderTop: '1px solid #3F3F46',
          borderBottom: '1px solid #3F3F46',
          borderRadius: 6,
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />
      <div
        ref={containerRef}
        className="wpicker"
        onScroll={disabled ? undefined : handleScroll}
        style={{
          height: ITEM_H * 3,
          overflowY: disabled ? 'hidden' : 'scroll',
          scrollbarWidth: 'none',
          backgroundColor: '#18181B',
          borderRadius: 8,
          border: '1px solid #3F3F46',
          scrollSnapType: 'y mandatory',
          overscrollBehavior: 'contain',
          pointerEvents: disabled ? 'none' : 'auto',
          position: 'relative',
        }}
      >
        {REPEATED_OPTIONS.map((opt, absIdx) => {
          const dist = absIdx - (COPY_LEN + selectedIdx);
          const absDist = Math.abs(dist);
          const isCenter = absDist === 0;
          const localIdx = absIdx % COPY_LEN;
          return (
            <div
              key={`${absIdx}-${opt.value}`}
              onClick={() => {
                if (disabled) return;
                onChange(opt.value);
                if (containerRef.current) {
                  containerRef.current.scrollTop = (COPY_LEN + localIdx - 1) * ITEM_H;
                }
              }}
              style={{
                height: ITEM_H,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                scrollSnapAlign: 'center',
                cursor: disabled ? 'default' : 'pointer',
                fontSize: isCenter ? 15 : 13,
                fontWeight: isCenter ? 600 : 400,
                color: isCenter ? '#FAFAFA' : '#A1A1AA',
                opacity: absDist === 0 ? 1 : absDist === 1 ? 0.5 : 0.2,
                transform: `scale(${isCenter ? 1 : 0.9})`,
                transition: 'opacity 0.12s, transform 0.12s',
                userSelect: 'none',
              }}
            >
              {opt.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Closed toggle ──────────────────────────────────────────────────────────

function ClosedToggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onChange}
      style={{
        position: 'relative', flexShrink: 0,
        width: 32, height: 18, borderRadius: 9,
        backgroundColor: checked ? 'rgba(248,113,113,0.4)' : '#3F3F46',
        border: 'none', padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background-color 0.2s',
      }}
    >
      <span style={{
        position: 'absolute',
        top: 2,
        left: checked ? 16 : 2,
        width: 14, height: 14,
        backgroundColor: 'white',
        borderRadius: '50%',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        transition: 'left 0.2s',
        display: 'block',
      }} />
    </button>
  );
}

function calcDuration(open: string, close: string): string {
  const [openH, openM] = open.split(':').map(Number);
  const [closeH, closeM] = close.split(':').map(Number);
  const openMins = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;
  const diff = closeMins > openMins
    ? closeMins - openMins
    : 24 * 60 - openMins + closeMins;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return m === 0 ? `${h} hrs` : `${h} hrs ${m} mins`;
}

// ── Page component ─────────────────────────────────────────────────────────

export default function PreferencesPage() {
  const [prefs, setPrefs] = useState<Preferences>(mockPreferences);
  const [saved, setSaved] = useState(false);

  const [dayHours, setDayHours] = useState<Record<DayName, DayHours>>(initDayHours);
  const [bulkOpen, setBulkOpen] = useState(mockPreferences.operating_hours.open);
  const [bulkClose, setBulkClose] = useState(mockPreferences.operating_hours.close);
  const [hoursExpanded, setHoursExpanded] = useState(true);
  const [hoursLocked, setHoursLocked] = useState(false);
  const [bulkExpanded, setBulkExpanded] = useState(false);

  function updateLabor<K extends keyof Preferences>(key: K, val: Preferences[K]) {
    setPrefs(p => ({ ...p, [key]: val }));
  }

  function setDayField(day: DayName, field: keyof DayHours, val: string | boolean) {
    setDayHours(prev => ({ ...prev, [day]: { ...prev[day], [field]: val } }));
  }

  function applyToAll() {
    setDayHours(prev => {
      const next = { ...prev };
      for (const day of DAY_NAMES) {
        if (!prev[day].closed) {
          next[day] = { ...prev[day], open: bulkOpen, close: bulkClose };
        }
      }
      return next;
    });
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="p-8 pb-32">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: '#FAFAFA' }}>Preferences</h1>
          <p className="text-sm mt-0.5" style={{ color: '#A1A1AA' }}>
            Configure scheduling rules, staffing targets, and availability requirements
          </p>
        </div>
      </div>

      <div className="max-w-3xl space-y-5">
        {/* Labor Settings */}
        <Section
          title="Labor Settings"
          description="Define cost targets and hour constraints for automatic scheduling"
        >
          <div className="grid grid-cols-2 gap-4">
            <NumInput
              label="Labor Cost Target"
              value={prefs.labor_cost_target}
              onChange={v => updateLabor('labor_cost_target', v)}
              min={0} max={100} suffix="%"
              hint="Percentage of revenue to allocate to labor"
            />
            <NumInput
              label="Max Consecutive Days"
              value={prefs.max_consecutive_days}
              onChange={v => updateLabor('max_consecutive_days', v)}
              min={1} max={7} suffix="days"
              hint="Most days in a row an employee can work"
            />
            <NumInput
              label="Minimum Availability Required Per Employee"
              value={prefs.min_availability_hours}
              onChange={v => updateLabor('min_availability_hours', v)}
              min={0} max={80} suffix="hours per week"
              hint="Minimum hours each employee must be available"
            />
            <NumInput
              label="Maximum Hours Assigned Per Week"
              value={prefs.max_hours_per_week}
              onChange={v => updateLabor('max_hours_per_week', v)}
              min={0} max={80} suffix="hours"
              hint="Employees will not be scheduled beyond this limit"
            />
          </div>
        </Section>

        {/* Staff Requirements by Time */}
        <RoleRequirementsSection prefs={prefs} setPrefs={setPrefs} />

        {/* Operating Hours */}
        <div className="rounded-xl p-6" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>

          <div
            className="flex items-center justify-between rounded-lg"
            onClick={() => setHoursExpanded(x => !x)}
            style={{
              padding: '4px 4px 4px 0',
              marginBottom: hoursExpanded ? 20 : 0,
              cursor: 'pointer',
              transition: 'background-color 0.15s, margin-bottom 0.2s ease-in-out',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(30,30,42,0.4)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
          >
            <div>
              <div className="text-sm font-semibold" style={{ color: '#FAFAFA' }}>Operating Hours</div>
              <div className="text-xs mt-0.5" style={{ color: '#71717A' }}>Set when your restaurant is open for scheduling</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={e => { e.stopPropagation(); setHoursLocked(l => !l); }}
                title={hoursLocked ? 'Unlock hours' : 'Lock hours'}
                style={{
                  background: 'none', border: 'none', padding: 4, borderRadius: 4,
                  cursor: 'pointer',
                  color: hoursLocked ? '#FBBF24' : '#71717A',
                  transition: 'color 0.15s',
                  display: 'flex', alignItems: 'center',
                }}
                onMouseEnter={e => { if (!hoursLocked) (e.currentTarget as HTMLElement).style.color = '#A1A1AA'; }}
                onMouseLeave={e => { if (!hoursLocked) (e.currentTarget as HTMLElement).style.color = '#71717A'; }}
              >
                {hoursLocked ? <Lock size={15} /> : <Unlock size={15} />}
              </button>
              <div style={{
                display: 'flex', alignItems: 'center',
                color: '#71717A',
                transform: hoursExpanded ? 'rotate(0deg)' : 'rotate(180deg)',
                transition: 'transform 0.2s ease-in-out',
              }}>
                <ChevronDown size={16} />
              </div>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateRows: hoursExpanded ? '1fr' : '0fr',
            transition: 'grid-template-rows 0.2s ease-in-out',
          }}>
            <div style={{ overflow: 'hidden' }}>

              {/* Lock banner */}
              <div style={{
                overflow: 'hidden',
                maxHeight: hoursLocked ? '52px' : '0',
                opacity: hoursLocked ? 1 : 0,
                marginBottom: hoursLocked ? 16 : 0,
                transition: 'max-height 0.2s ease-in-out, opacity 0.2s ease-in-out, margin-bottom 0.2s ease-in-out',
              }}>
                <div style={{
                  backgroundColor: 'rgba(251,191,36,0.1)',
                  border: '1px solid rgba(251,191,36,0.2)',
                  borderRadius: 8, padding: '8px 16px',
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12, color: '#FBBF24',
                }}>
                  <Lock size={12} />
                  Operating hours are locked. Unlock to make changes.
                </div>
              </div>

              {/* Bulk action bar */}
              <div style={{ marginBottom: 24 }}>
                <div
                  onClick={() => setBulkExpanded(x => !x)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: 'pointer',
                    color: '#71717A',
                    fontSize: 12,
                    marginBottom: bulkExpanded ? 8 : 0,
                    transition: 'color 0.15s, margin-bottom 0.08s ease-in-out',
                    userSelect: 'none',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#FAFAFA'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#71717A'}
                >
                  <span>Apply to all days</span>
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    transform: bulkExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.08s ease-in-out',
                  }}>
                    <ChevronDown size={12} />
                  </div>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateRows: bulkExpanded ? '1fr' : '0fr',
                  transition: 'grid-template-rows 0.08s ease-in-out',
                }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px',
                      backgroundColor: '#18181B',
                      borderRadius: 8, border: '1px solid #3F3F46',
                      opacity: hoursLocked ? 0.4 : 1,
                      pointerEvents: hoursLocked ? 'none' : 'auto',
                      transition: 'opacity 0.2s',
                    }}>
                      <span style={{ color: '#71717A', fontSize: 12, flex: 1 }}>
                        Set same hours for all days
                      </span>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                        <div>
                          <div style={{ color: '#71717A', fontSize: 11, marginBottom: 6 }}>Opens</div>
                          <WheelPicker value={bulkOpen} onChange={setBulkOpen} />
                        </div>
                        <div>
                          <div style={{ color: '#71717A', fontSize: 11, marginBottom: 6 }}>Closes</div>
                          <WheelPicker value={bulkClose} onChange={setBulkClose} />
                        </div>
                        <button
                          onClick={applyToAll}
                          className="flex items-center px-3 py-2 rounded-lg text-xs font-medium transition-all"
                          style={{ backgroundColor: '#818CF8', color: '#FFFFFF', border: 'none', cursor: 'pointer', marginBottom: 2 }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#6366F1'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#818CF8'}
                        >
                          Apply to all
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Per-day rows */}
              {DAY_NAMES.map((day, idx) => {
                const dh = dayHours[day];
                const weekend = WEEKEND_DAYS.includes(day);
                return (
                  <div
                    key={day}
                    style={{
                      borderBottom: idx < DAY_NAMES.length - 1 ? '1px solid #3F3F46' : undefined,
                      backgroundColor: weekend ? 'rgba(22,22,31,0.6)' : 'transparent',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 20,
                        paddingTop: 14, paddingBottom: dh.closed ? 14 : 6,
                        opacity: hoursLocked ? 0.5 : 1,
                        pointerEvents: hoursLocked ? 'none' : 'auto',
                        transition: 'opacity 0.2s',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex', alignItems: 'center', gap: 16,
                          flex: 1, opacity: dh.closed ? 0.5 : 1,
                          transition: 'opacity 0.2s',
                        }}
                      >
                        <div style={{ width: 96, fontSize: 14, fontWeight: 500, color: '#FAFAFA', flexShrink: 0 }}>
                          {day}
                        </div>
                        <div>
                          <div style={{ color: '#71717A', fontSize: 11, marginBottom: 6 }}>Opens</div>
                          <WheelPicker
                            value={dh.open}
                            onChange={v => setDayField(day, 'open', v)}
                            disabled={dh.closed || hoursLocked}
                          />
                        </div>
                        <div>
                          <div style={{ color: '#71717A', fontSize: 11, marginBottom: 6 }}>Closes</div>
                          <WheelPicker
                            value={dh.close}
                            onChange={v => setDayField(day, 'close', v)}
                            disabled={dh.closed || hoursLocked}
                          />
                        </div>
                        {dh.closed && (
                          <span style={{
                            backgroundColor: 'rgba(248,113,113,0.1)', color: '#F87171',
                            borderRadius: 9999, padding: '2px 10px',
                            fontSize: 12, fontWeight: 500, flexShrink: 0,
                          }}>
                            Closed
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ color: '#71717A', fontSize: 12 }}>Closed</span>
                        <ClosedToggle
                          checked={dh.closed}
                          onChange={() => setDayField(day, 'closed', !dh.closed)}
                          disabled={hoursLocked}
                        />
                      </div>
                    </div>
                    {!dh.closed && (
                      <div style={{ paddingLeft: 112, paddingBottom: 12, fontSize: 12, color: '#A1A1AA' }}>
                        Open for{' '}
                        <span style={{ color: '#818CF8', fontWeight: 500 }}>
                          {calcDuration(dh.open, dh.close)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

            </div>
          </div>
        </div>
      </div>

      {/* Sticky save footer */}
      <div
        className="fixed bottom-0 left-0 right-0 flex items-center justify-end px-8 py-4 z-30"
        style={{
          backgroundColor: '#18181B',
          borderTop: '1px solid #3F3F46',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
          marginLeft: 240,
        }}
      >
        {saved && (
          <div className="flex items-center gap-1.5 mr-4 text-sm"
            style={{ color: '#34D399' }}>
            <CheckCircle2 size={15} />
            Preferences saved
          </div>
        )}
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all"
          style={{ backgroundColor: saved ? '#34D399' : '#818CF8', color: '#FFFFFF' }}
          onMouseEnter={e => { if (!saved) (e.currentTarget as HTMLElement).style.backgroundColor = '#6366F1'; }}
          onMouseLeave={e => { if (!saved) (e.currentTarget as HTMLElement).style.backgroundColor = saved ? '#34D399' : '#818CF8'; }}
        >
          <Settings size={14} />
          {saved ? 'Saved!' : 'Save Preferences'}
        </button>
      </div>
    </div>
  );
}
