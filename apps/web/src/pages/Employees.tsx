import { useState, useMemo } from 'react';
import { Users, Search, Plus, X, Phone, Mail, ChevronDown, Save } from 'lucide-react';
import { mockEmployees } from '../lib/mockData';
import type { Employee, Role, ExperienceLevel, ShiftTier, EmployeeType } from '../lib/types';
import {
  getRoleBadgeClass, getExperienceBadgeClass, getInitials, getAvatarColor, generateId,
} from '../lib/utils';

const ROLES: Role[] = ['Cashier', 'Cook', 'Packliner'];
const EXPERIENCE_LEVELS: ExperienceLevel[] = ['Veteran', 'Intermediate', 'Trainee'];
const SHIFT_TIERS: ShiftTier[] = ['Rush-capable', 'Light shifts'];
const EMPLOYEE_TYPES: EmployeeType[] = ['Part Time', 'Full Time'];

const DEFAULT_EMPLOYEE: Omit<Employee, 'id' | 'created_at'> = {
  name: '', preferred_name: '', email: '', phone: '',
  role: ['Cashier'], experience_level: 'Intermediate', shift_tier: 'Rush-capable',
  min_hours: 20, max_hours: 35, min_shifts_per_week: 2, max_shifts_per_week: 5,
  employee_type: 'Part Time',
  pairing_always_with: [], pairing_never_with: [],
};

function inputStyle(focused = false) {
  return {
    backgroundColor: '#18181B',
    border: `1px solid ${focused ? '#818CF8' : '#3F3F46'}`,
    boxShadow: focused ? '0 0 0 1px #818CF8' : 'none',
    color: '#FAFAFA',
  };
}

function DrawerTextField({
  label, value, onChange, type = 'text', icon: Icon, hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; icon?: React.ElementType; hint?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider mb-1.5"
        style={{ color: '#71717A', letterSpacing: '0.06em' }}>
        {label}
      </label>
      <div className="relative">
        {Icon && <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#71717A' }} />}
        <input
          type={type} value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={`w-full py-2.5 rounded-lg text-sm outline-none transition-all ${Icon ? 'pl-9 pr-3' : 'px-3'}`}
          style={inputStyle(focused)}
        />
      </div>
      {hint && <div className="text-xs mt-1" style={{ color: '#71717A' }}>{hint}</div>}
    </div>
  );
}

function DrawerSelectField({
  label, value, options, onChange,
}: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider mb-1.5"
        style={{ color: '#71717A', letterSpacing: '0.06em' }}>
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="w-full appearance-none pl-3 pr-8 py-2.5 rounded-lg text-sm outline-none transition-all"
          style={inputStyle(focused)}
        >
          {options.map(o => (
            <option key={o} value={o} style={{ backgroundColor: '#27272A' }}>{o}</option>
          ))}
        </select>
        <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: '#71717A' }} />
      </div>
    </div>
  );
}

function DrawerNumberField({
  label, value, onChange, min, max, suffix,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; suffix?: string;
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
          className="w-full pl-3 pr-10 py-2.5 rounded-lg text-sm outline-none transition-all"
          style={inputStyle(focused)}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#71717A' }}>{suffix}</span>
        )}
      </div>
    </div>
  );
}

function EmployeeDrawer({
  employee, onSave, onClose,
}: {
  employee: Partial<Employee>;
  onSave: (emp: Employee) => void;
  onClose: () => void;
}) {
  const isNew = !employee.id;
  const [form, setForm] = useState({ ...DEFAULT_EMPLOYEE, ...employee });

  function set<K extends keyof typeof form>(key: K, val: (typeof form)[K]) {
    setForm(f => ({ ...f, [key]: val }));
  }

  function toggleRole(r: Role) {
    const current = form.role;
    if (current.includes(r)) {
      if (current.length === 1) return;
      set('role', current.filter(x => x !== r));
    } else {
      set('role', [...current, r]);
    }
  }

  function handleSave() {
    onSave({
      ...form,
      id: employee.id ?? generateId(),
      created_at: employee.created_at ?? new Date().toISOString(),
    });
    onClose();
  }

  const canSave = Boolean(form.name && form.email);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: 'rgba(24,24,27,0.75)' }}
        onClick={onClose}
      />
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
        style={{
          width: 420,
          backgroundColor: '#27272A',
          borderLeft: '1px solid #3F3F46',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5"
          style={{ borderBottom: '1px solid #3F3F46' }}>
          <div className="flex items-center gap-3">
            {form.name ? (
              <div
                className="flex items-center justify-center w-9 h-9 rounded-full text-xs font-semibold shrink-0"
                style={{ backgroundColor: getAvatarColor(form.name), color: '#FFFFFF' }}
              >
                {getInitials(form.name)}
              </div>
            ) : (
              <div className="flex items-center justify-center w-9 h-9 rounded-full"
                style={{ backgroundColor: '#3F3F46' }}>
                <Users size={16} style={{ color: '#71717A' }} />
              </div>
            )}
            <div>
              <div className="text-sm font-semibold" style={{ color: '#FAFAFA' }}>
                {isNew ? 'Add Employee' : 'Edit Employee'}
              </div>
              <div className="text-xs" style={{ color: '#71717A' }}>
                {isNew ? 'New team member' : form.email || 'No email set'}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: '#71717A' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46';
              (e.currentTarget as HTMLElement).style.color = '#FAFAFA';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              (e.currentTarget as HTMLElement).style.color = '#71717A';
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest mb-3"
              style={{ color: '#71717A', letterSpacing: '0.1em' }}>
              Personal Info
            </div>
            <div className="space-y-3">
              <DrawerTextField label="Full Name" value={form.name} onChange={v => set('name', v)} />
              <DrawerTextField
                label="Preferred Name"
                value={form.preferred_name ?? ''}
                onChange={v => set('preferred_name', v)}
                hint="This is the name shown on the schedule"
              />
              <DrawerTextField label="Email Address" value={form.email} onChange={v => set('email', v)} type="email" icon={Mail} />
              <DrawerTextField label="Phone Number" value={form.phone} onChange={v => set('phone', v)} type="tel" icon={Phone} />
            </div>
          </div>

          <div style={{ height: 1, backgroundColor: '#3F3F46' }} />

          <div>
            <div className="text-xs font-semibold uppercase tracking-widest mb-3"
              style={{ color: '#71717A', letterSpacing: '0.1em' }}>
              Role &amp; Experience
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider mb-1.5"
                  style={{ color: '#71717A', letterSpacing: '0.06em' }}>
                  Role
                </label>
                <div className="flex gap-2 flex-wrap">
                  {ROLES.map(r => {
                    const active = form.role.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => toggleRole(r)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${getRoleBadgeClass(r)}`}
                        style={{ opacity: active ? 1 : 0.35 }}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>
              <DrawerSelectField label="Experience Level" value={form.experience_level} options={EXPERIENCE_LEVELS} onChange={v => set('experience_level', v as ExperienceLevel)} />
              <DrawerSelectField label="Shift Tier" value={form.shift_tier} options={SHIFT_TIERS} onChange={v => set('shift_tier', v as ShiftTier)} />
            </div>
          </div>

          <div style={{ height: 1, backgroundColor: '#3F3F46' }} />

          <div>
            <div className="text-xs font-semibold uppercase tracking-widest mb-3"
              style={{ color: '#71717A', letterSpacing: '0.1em' }}>
              Schedule Settings
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <DrawerNumberField label="Min Hours / Week" value={form.min_hours} onChange={v => set('min_hours', v)} min={0} max={80} suffix="hrs" />
              <DrawerNumberField label="Max Hours / Week" value={form.max_hours} onChange={v => set('max_hours', v)} min={0} max={80} suffix="hrs" />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <DrawerNumberField label="Min Shifts / Week" value={form.min_shifts_per_week ?? 0} onChange={v => set('min_shifts_per_week', v)} min={0} max={14} suffix="shifts" />
              <DrawerNumberField label="Max Shifts / Week" value={form.max_shifts_per_week ?? 0} onChange={v => set('max_shifts_per_week', v)} min={0} max={14} suffix="shifts" />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider mb-1.5"
                style={{ color: '#71717A', letterSpacing: '0.06em' }}>
                Employee Type
              </label>
              <div className="flex gap-2">
                {EMPLOYEE_TYPES.map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => set('employee_type', type)}
                    className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                    style={
                      form.employee_type === type
                        ? { backgroundColor: '#818CF8', color: '#FFFFFF' }
                        : { backgroundColor: '#18181B', border: '1px solid #3F3F46', color: '#A1A1AA' }
                    }
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4" style={{ borderTop: '1px solid #3F3F46' }}>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={{ backgroundColor: '#3F3F46', color: '#A1A1AA' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#2A2A38'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46'}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={{ backgroundColor: '#818CF8', color: '#FFFFFF', opacity: canSave ? 1 : 0.5 }}
              onMouseEnter={e => { if (canSave) (e.currentTarget as HTMLElement).style.backgroundColor = '#6366F1'; }}
              onMouseLeave={e => { if (canSave) (e.currentTarget as HTMLElement).style.backgroundColor = '#818CF8'; }}
            >
              <Save size={14} />
              {isNew ? 'Add Employee' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>(mockEmployees);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<string>('All');
  const [filterExp, setFilterExp] = useState<string>('All');
  const [filterType, setFilterType] = useState<string>('All');
  const [drawer, setDrawer] = useState<Partial<Employee> | null>(null);

  const filtered = useMemo(() => employees.filter(e => {
    const q = search.toLowerCase();
    return (
      (!q || e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)) &&
      (filterRole === 'All' || e.role.includes(filterRole as Role)) &&
      (filterExp === 'All' || e.experience_level === filterExp) &&
      (filterType === 'All' || e.employee_type === filterType)
    );
  }), [employees, search, filterRole, filterExp, filterType]);

  function handleSave(emp: Employee) {
    setEmployees(prev => {
      const idx = prev.findIndex(e => e.id === emp.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = emp; return n; }
      return [...prev, emp];
    });
  }

  const hasFilters = search || filterRole !== 'All' || filterExp !== 'All' || filterType !== 'All';

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: '#FAFAFA' }}>Employees</h1>
          <p className="text-sm mt-0.5" style={{ color: '#A1A1AA' }}>
            {employees.length} team members
          </p>
        </div>
        <button
          onClick={() => setDrawer({})}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
          style={{ backgroundColor: '#818CF8', color: '#FFFFFF' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#6366F1'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#818CF8'}
        >
          <Plus size={15} />
          Add Employee
        </button>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: '#71717A' }} />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-3 py-2 rounded-lg text-sm outline-none transition-all"
            style={{ width: 240, backgroundColor: '#27272A', border: '1px solid #3F3F46', color: '#FAFAFA' }}
            onFocus={e => { e.target.style.border = '1px solid #818CF8'; }}
            onBlur={e => { e.target.style.border = '1px solid #3F3F46'; }}
          />
        </div>

        {[
          { label: 'Role', value: filterRole, opts: ['All', ...ROLES], set: setFilterRole },
          { label: 'Experience', value: filterExp, opts: ['All', ...EXPERIENCE_LEVELS], set: setFilterExp },
          { label: 'Type', value: filterType, opts: ['All', 'Full Time', 'Part Time'], set: setFilterType },
        ].map(({ label, value, opts, set }) => (
          <div key={label} className="relative">
            <select
              value={value}
              onChange={e => set(e.target.value)}
              className="appearance-none pl-3 pr-7 py-2 rounded-lg text-sm outline-none"
              style={{
                backgroundColor: '#27272A',
                border: '1px solid #3F3F46',
                color: value === 'All' ? '#71717A' : '#FAFAFA',
              }}
            >
              {opts.map(o => (
                <option key={o} value={o} style={{ backgroundColor: '#27272A' }}>
                  {o === 'All' ? `All ${label}s` : o}
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: '#71717A' }} />
          </div>
        ))}

        {hasFilters && (
          <button
            onClick={() => { setSearch(''); setFilterRole('All'); setFilterExp('All'); setFilterType('All'); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-all"
            style={{ color: '#A1A1AA', backgroundColor: '#3F3F46' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#2A2A38'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46'}
          >
            <X size={12} /> Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
        {/* Header */}
        <div
          className="grid px-5 py-3 text-xs font-medium uppercase tracking-wide"
          style={{
            gridTemplateColumns: '2fr 160px 130px 130px 100px 80px 110px 72px',
            color: '#71717A',
            borderBottom: '1px solid #3F3F46',
            letterSpacing: '0.06em',
          }}
        >
          <div>Employee</div>
          <div>Role</div>
          <div>Experience</div>
          <div>Shift Tier</div>
          <div>Hours</div>
          <div>Shifts</div>
          <div>Type</div>
          <div className="text-right">Edit</div>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Users size={36} style={{ color: '#3F3F46' }} />
            <div className="text-sm font-medium" style={{ color: '#71717A' }}>
              {hasFilters ? 'No employees match your filters' : 'No employees yet'}
            </div>
            {!hasFilters && (
              <button
                onClick={() => setDrawer({})}
                className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
                style={{ backgroundColor: '#818CF8', color: '#FFFFFF' }}
              >
                <Plus size={14} /> Add first employee
              </button>
            )}
          </div>
        ) : (
          filtered.map((emp, idx) => (
            <div
              key={emp.id}
              className="grid items-center px-5 py-3.5 transition-colors"
              style={{
                gridTemplateColumns: '2fr 160px 130px 130px 100px 80px 110px 72px',
                borderBottom: idx < filtered.length - 1 ? '1px solid #3F3F46' : undefined,
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(30,30,42,0.5)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
            >
              {/* Name */}
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold shrink-0"
                  style={{ backgroundColor: getAvatarColor(emp.name), color: '#FFFFFF' }}
                >
                  {getInitials(emp.name)}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: '#FAFAFA' }}>{emp.name}</div>
                  <div className="text-xs truncate" style={{ color: '#71717A' }}>{emp.email}</div>
                </div>
              </div>
              {/* Role */}
              <div className="flex flex-wrap gap-1">
                {emp.role.map(r => (
                  <span key={r} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeClass(r)}`}>
                    {r}
                  </span>
                ))}
              </div>
              {/* Experience */}
              <div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getExperienceBadgeClass(emp.experience_level)}`}>
                  {emp.experience_level}
                </span>
              </div>
              {/* Shift Tier */}
              <div className="text-xs" style={{ color: '#A1A1AA' }}>{emp.shift_tier}</div>
              {/* Hours */}
              <div className="text-xs" style={{ color: '#A1A1AA' }}>{emp.min_hours}–{emp.max_hours} hrs</div>
              {/* Shifts */}
              <div className="text-xs" style={{ color: '#A1A1AA' }}>
                {emp.min_shifts_per_week ?? 0} – {emp.max_shifts_per_week ?? 0}
              </div>
              {/* Employee Type */}
              <div>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                  style={
                    emp.employee_type === 'Full Time'
                      ? { backgroundColor: 'rgba(129,140,248,0.15)', color: '#818CF8' }
                      : { backgroundColor: 'rgba(148,163,184,0.15)', color: '#A1A1AA' }
                  }
                >
                  {emp.employee_type}
                </span>
              </div>
              {/* Edit */}
              <div className="flex justify-end">
                <button
                  onClick={() => setDrawer(emp)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ backgroundColor: '#3F3F46', color: '#A1A1AA' }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#2A2A38';
                    (e.currentTarget as HTMLElement).style.color = '#FAFAFA';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46';
                    (e.currentTarget as HTMLElement).style.color = '#A1A1AA';
                  }}
                >
                  Edit
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {drawer !== null && (
        <EmployeeDrawer
          employee={drawer}
          onSave={handleSave}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
