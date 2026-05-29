import type {
  Employee,
  Shift,
  Schedule,
  ScheduleFlag,
  ScheduleMlMetadata,
  AvailabilityRequest,
  TimeOffRequest,
  Preferences,
  SalesData,
  Role,
} from '../types';
import { format, startOfWeek } from 'date-fns';

type ApiWebEmployee = {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: string[];
  experienceLevel: string;
  shiftTier: string;
  minHours: number;
  maxHours: number;
  preferredName?: string;
  fullDayCapable?: boolean;
  employeeType: string;
  pairingAlwaysWith: string[];
  pairingNeverWith: string[];
  createdAt: string;
};

type ApiScheduleDetail = {
  id: string;
  weekStart: string;
  status: 'draft' | 'published';
  exportedAt: string | null;
  mlMetadata?: Record<string, unknown>;
  shifts: Array<{
    id: string;
    employeeId: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    role: string;
    location?: string;
    isLocked?: boolean;
  }>;
};

const ROLE_MAP: Record<string, Role> = {
  COOK: 'Cook',
  CASHIER: 'Cashier',
  PACKLINER: 'Packliner',
  Cook: 'Cook',
  Cashier: 'Cashier',
  Packliner: 'Packliner',
  STAFF: 'Cashier',
};

function inferShiftType(start: string): Shift['shift_type'] {
  const h = parseInt(start.split(':')[0], 10);
  if (h < 14) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

export function mapEmployeeFromApi(e: ApiWebEmployee): Employee {
  return {
    id: e.id,
    created_at: e.createdAt,
    name: e.name,
    preferred_name: e.preferredName ?? e.name.split(' ')[0],
    email: e.email,
    phone: e.phone ?? '',
    role: e.role.map((r) => ROLE_MAP[r] ?? 'Cashier'),
    experience_level: (e.experienceLevel as Employee['experience_level']) ?? 'Intermediate',
    shift_tier: (e.shiftTier as Employee['shift_tier']) ?? 'Rush-capable',
    min_hours: e.minHours,
    max_hours: e.maxHours,
    full_day_capable: e.fullDayCapable ?? false,
    employee_type: (e.employeeType as Employee['employee_type']) ?? 'Part Time',
    pairing_always_with: e.pairingAlwaysWith,
    pairing_never_with: e.pairingNeverWith,
    userId: e.userId,
  };
}

export function mapEmployeeToApi(emp: Employee) {
  return {
    name: emp.name,
    preferredName: emp.preferred_name,
    email: emp.email,
    phone: emp.phone,
    role: emp.role,
    experienceLevel: emp.experience_level,
    shiftTier: emp.shift_tier,
    minHours: emp.min_hours,
    maxHours: emp.max_hours,
    fullDayCapable: emp.full_day_capable ?? false,
    employeeType: emp.employee_type,
    fullDayCapable: emp.full_day_capable ?? false,
    pairingAlwaysWith: emp.pairing_always_with,
    pairingNeverWith: emp.pairing_never_with,
  };
}

export function mapScheduleFromApi(
  detail: ApiScheduleDetail,
  employees: Employee[]
): { schedule: Schedule; shifts: Shift[] } {
  const userIdToProfile = new Map(
    employees.map((e) => [(e as Employee & { userId?: string }).userId ?? e.id, e])
  );

  const raw = detail.mlMetadata as Record<string, unknown> | undefined;
  let mlMetadata: ScheduleMlMetadata | undefined;
  if (raw && typeof raw === 'object') {
    mlMetadata = {
      workersNeeded: (raw.workersNeeded ?? raw.workers_needed) as ScheduleMlMetadata['workersNeeded'],
      flags: Array.isArray(raw.flags) ? (raw.flags as ScheduleFlag[]) : [],
      engineVersion: String(raw.engineVersion ?? raw.engine_version ?? ''),
      labourCostPct: typeof raw.labourCostPct === 'number' ? raw.labourCostPct : undefined,
      avgHourlyWage: typeof raw.avgHourlyWage === 'number' ? raw.avgHourlyWage : undefined,
      salesReferenceWeekStart:
        typeof raw.salesReferenceWeekStart === 'string' ? raw.salesReferenceWeekStart : undefined,
      salesReferenceWeekEnd:
        typeof raw.salesReferenceWeekEnd === 'string' ? raw.salesReferenceWeekEnd : undefined,
      roleRequirementsConfigured:
        typeof raw.roleRequirementsConfigured === 'boolean'
          ? raw.roleRequirementsConfigured
          : undefined,
      preferenceOverrides: Array.isArray(raw.preferenceOverrides)
        ? (raw.preferenceOverrides as ScheduleMlMetadata['preferenceOverrides'])
        : undefined,
      llmSuggestedShifts: Array.isArray(raw.llmSuggestedShifts)
        ? (raw.llmSuggestedShifts as ScheduleMlMetadata['llmSuggestedShifts'])
        : undefined,
    };
  }

  const schedule: Schedule = {
    id: detail.id,
    week_start_date: detail.weekStart,
    status: detail.status,
    generated_at: new Date().toISOString(),
    last_modified: detail.exportedAt ?? new Date().toISOString(),
    ml_metadata: mlMetadata,
  };

  const shifts: Shift[] = detail.shifts.map((s) => {
    const emp = [...userIdToProfile.values()].find(
      (e) => (e as Employee & { userId?: string }).userId === s.employeeId
    ) ?? employees.find((e) => e.id === s.employeeId);
    return {
      id: s.id,
      schedule_id: detail.id,
      employee_id: emp?.id ?? s.employeeId,
      employee: emp,
      role: ROLE_MAP[s.role] ?? 'Cashier',
      date: s.shiftDate,
      start_time: s.startTime,
      end_time: s.endTime,
      is_locked: s.isLocked ?? false,
      shift_type: inferShiftType(s.startTime),
    };
  });

  return { schedule, shifts };
}

export function mapShiftUpdatesToApi(
  updates: Record<string, unknown>,
  employees: Employee[]
): Record<string, unknown> {
  const apiUpdates: Record<string, unknown> = {};
  if (updates.start_time) apiUpdates.startTime = updates.start_time;
  if (updates.end_time) apiUpdates.endTime = updates.end_time;
  if (updates.role) apiUpdates.role = String(updates.role).toUpperCase();
  if (updates.is_locked !== undefined) apiUpdates.isLocked = updates.is_locked;
  if (updates.employee_id) {
    const emp = employees.find((e) => e.id === updates.employee_id);
    const userId = (emp as Employee & { userId?: string })?.userId;
    if (userId) apiUpdates.employeeId = userId;
  }
  return apiUpdates;
}

/** API stores [start, end, …] per day; UI grid expects hourly slots like "10:00". */
function expandHourRange(start: string, end: string): string[] {
  const startH = parseInt(start.split(':')[0], 10);
  let endH = parseInt(end.split(':')[0], 10);
  if (endH === 0) endH = 24;
  if (endH <= startH) endH += 24;
  const hours: string[] = [];
  for (let h = startH; h < endH; h++) {
    const hr = h >= 24 ? h - 24 : h;
    hours.push(`${String(hr).padStart(2, '0')}:00`);
  }
  return hours;
}

function isHourlySlotList(values: string[]): boolean {
  if (!values.every((v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v))) return false;
  if (values.length === 1) return true;
  if (values.length >= 3) return true;
  const startH = parseInt(values[0].split(':')[0], 10);
  const endH = parseInt(values[1].split(':')[0], 10);
  return endH === startH + 1;
}

function expandAvailabilityGrid(
  grid: Record<string, string[]>
): AvailabilityRequest['availability_grid'] {
  const result = {} as AvailabilityRequest['availability_grid'];
  const dayKeys = [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  ] as const;
  for (const day of dayKeys) {
    result[day] = [];
  }
  for (const [rawDay, value] of Object.entries(grid ?? {})) {
    const day = rawDay.toLowerCase() as (typeof dayKeys)[number];
    if (!dayKeys.includes(day) || value == null) continue;
    const hours = new Set<string>();

    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (first && typeof first === 'object' && 'startTime' in first && 'endTime' in first) {
        const item = first as { startTime: string; endTime: string; block?: string };
        if (item.block !== 'off') {
          expandHourRange(item.startTime, item.endTime).forEach((h) => hours.add(h));
        }
      } else if (value.every((t): t is string => typeof t === 'string' && t.includes(':'))) {
        if (isHourlySlotList(value)) {
          for (const t of value) hours.add(t);
        } else if (value.length >= 2) {
          for (let i = 0; i + 1 < value.length; i += 2) {
            expandHourRange(value[i], value[i + 1]).forEach((h) => hours.add(h));
          }
        } else {
          for (const t of value) hours.add(t);
        }
      }
    } else if (typeof value === 'string') {
      const blockKey = value as string;
      const ranges: Record<string, [string, string]> = {
        morning: ['10:00', '16:00'],
        evening: ['16:00', '22:00'],
        full: ['10:00', '22:00'],
        off: ['00:00', '00:00'],
      };
      const range = ranges[blockKey];
      if (range && blockKey !== 'off') {
        expandHourRange(range[0], range[1]).forEach((h) => hours.add(h));
      }
    }

    result[day] = [...hours].sort();
  }
  return result;
}

function stubEmployeeFromRequest(employeeId: string, employeeName: string): Employee {
  return {
    id: employeeId,
    userId: employeeId,
    created_at: new Date().toISOString(),
    name: employeeName,
    email: '',
    phone: '',
    role: ['Cashier'],
    experience_level: 'Intermediate',
    shift_tier: 'Rush-capable',
    min_hours: 0,
    max_hours: 40,
    employee_type: 'Part Time',
    pairing_always_with: [],
    pairing_never_with: [],
  };
}

export function mapAvailabilityFromApi(
  items: Array<{
    id: string;
    employeeId: string;
    employeeName: string;
    weekStart: string;
    availabilityGrid: Record<string, string[]>;
    availabilityBlocks?: Array<{ day: string; block: string; timeRange: string }>;
    isFirstApproval?: boolean;
    status: string;
    submittedAt: string;
  }>,
  employees: Employee[]
): AvailabilityRequest[] {
  return items.map((r) => ({
    id: r.id,
    employee_id: r.employeeId,
    employee:
      employees.find((e) => (e as Employee & { userId?: string }).userId === r.employeeId) ??
      stubEmployeeFromRequest(r.employeeId, r.employeeName),
    week_start_date: r.weekStart,
    availability_grid: expandAvailabilityGrid(r.availabilityGrid ?? {}),
    availability_blocks: r.availabilityBlocks,
    is_first_approval: r.isFirstApproval,
    status: r.status as AvailabilityRequest['status'],
    submitted_at: r.submittedAt,
  }));
}

export function mapTimeOffFromApi(
  items: Array<{
    id: string;
    employeeId: string;
    employeeName: string;
    startDate: string;
    endDate: string;
    reason: string;
    status: string;
    submittedAt: string;
  }>,
  employees: Employee[]
): TimeOffRequest[] {
  return items.map((r) => ({
    id: r.id,
    employee_id: r.employeeId,
    employee:
      employees.find((e) => (e as Employee & { userId?: string }).userId === r.employeeId) ??
      stubEmployeeFromRequest(r.employeeId, r.employeeName),
    start_date: r.startDate,
    end_date: r.endDate,
    reason: r.reason,
    status: r.status as TimeOffRequest['status'],
    submitted_at: r.submittedAt,
  }));
}

export function mapPreferencesFromApi(p: {
  laborCostTarget: number;
  maxConsecutiveDays: number;
  minAvailabilityHours: number;
  minDaysOffPerWeek?: number;
  roleRequirements: Preferences['role_requirements'];
  operatingHours: { open: string; close: string };
}): Preferences {
  return {
    id: 'workplace-prefs',
    labor_cost_target: p.laborCostTarget,
    max_consecutive_days: p.maxConsecutiveDays,
    min_availability_hours: p.minAvailabilityHours,
    min_days_off_per_week: p.minDaysOffPerWeek ?? 2,
    role_requirements: p.roleRequirements,
    operating_hours: p.operatingHours,
  };
}

export function mapPreferencesToApi(prefs: Preferences) {
  return {
    laborCostTarget: prefs.labor_cost_target,
    maxConsecutiveDays: prefs.max_consecutive_days,
    minAvailabilityHours: prefs.min_availability_hours,
    minDaysOffPerWeek: prefs.min_days_off_per_week,
    roleRequirements: prefs.role_requirements,
    operatingHours: prefs.operating_hours,
  };
}

export function mapSalesFromApi(data: {
  weekStart: string;
  days: Array<{ date: string; hourlySales: Record<string, number> }>;
}): SalesData[] {
  return data.days.map((d) => ({
    id: `sd-${d.date}`,
    date: d.date,
    week_start_date: data.weekStart,
    hourly_sales: d.hourlySales,
  }));
}

export function weekStartMonday(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}
