import type {
  Employee, AvailabilityRequest, TimeOffRequest, Preferences,
  Schedule, Shift, SalesData, ActivityItem, DayKey, TimeRangeRule,
} from './types';

export const mockEmployees: Employee[] = [
  {
    id: 'emp-1', created_at: '2023-06-10T09:00:00Z',
    name: 'Maria Santos', preferred_name: 'Maria', email: 'maria.santos@example.com', phone: '(555) 234-5678',
    role: ['Cook'], experience_level: 'Veteran', shift_tier: 'Rush-capable',
    min_hours: 25, max_hours: 40, min_shifts_per_week: 3, max_shifts_per_week: 5, employee_type: 'Full Time',
    pairing_always_with: ['emp-4'], pairing_never_with: [],
  },
  {
    id: 'emp-2', created_at: '2023-08-22T09:00:00Z',
    name: 'James Chen', preferred_name: 'James', email: 'james.chen@example.com', phone: '(555) 345-6789',
    role: ['Cashier'], experience_level: 'Intermediate', shift_tier: 'Rush-capable',
    min_hours: 20, max_hours: 35, min_shifts_per_week: 2, max_shifts_per_week: 4, employee_type: 'Part Time',
    pairing_always_with: [], pairing_never_with: [],
  },
  {
    id: 'emp-3', created_at: '2024-01-05T09:00:00Z',
    name: 'Aisha Thompson', preferred_name: 'Aisha', email: 'aisha.t@example.com', phone: '(555) 456-7890',
    role: ['Packliner'], experience_level: 'Trainee', shift_tier: 'Light shifts',
    min_hours: 15, max_hours: 30, min_shifts_per_week: 2, max_shifts_per_week: 3, employee_type: 'Part Time',
    pairing_always_with: [], pairing_never_with: [],
  },
  {
    id: 'emp-4', created_at: '2022-11-14T09:00:00Z',
    name: 'Carlos Rivera', preferred_name: 'Carlos', email: 'carlos.r@example.com', phone: '(555) 567-8901',
    role: ['Cook', 'Cashier'], experience_level: 'Veteran', shift_tier: 'Rush-capable',
    min_hours: 30, max_hours: 40, min_shifts_per_week: 4, max_shifts_per_week: 5, employee_type: 'Full Time',
    pairing_always_with: ['emp-1'], pairing_never_with: [],
  },
  {
    id: 'emp-5', created_at: '2023-03-17T09:00:00Z',
    name: 'Emma Wilson', preferred_name: 'Emma', email: 'emma.w@example.com', phone: '(555) 678-9012',
    role: ['Cashier'], experience_level: 'Intermediate', shift_tier: 'Rush-capable',
    min_hours: 25, max_hours: 40, min_shifts_per_week: 3, max_shifts_per_week: 5, employee_type: 'Full Time',
    pairing_always_with: [], pairing_never_with: [],
  },
  {
    id: 'emp-6', created_at: '2023-09-01T09:00:00Z',
    name: 'David Park', preferred_name: 'David', email: 'david.park@example.com', phone: '(555) 789-0123',
    role: ['Packliner'], experience_level: 'Intermediate', shift_tier: 'Light shifts',
    min_hours: 20, max_hours: 35, min_shifts_per_week: 2, max_shifts_per_week: 4, employee_type: 'Part Time',
    pairing_always_with: [], pairing_never_with: [],
  },
  {
    id: 'emp-7', created_at: '2024-02-20T09:00:00Z',
    name: 'Sofia Gonzalez', preferred_name: 'Sofia', email: 'sofia.g@example.com', phone: '(555) 890-1234',
    role: ['Cook', 'Packliner'], experience_level: 'Trainee', shift_tier: 'Light shifts',
    min_hours: 15, max_hours: 25, min_shifts_per_week: 2, max_shifts_per_week: 3, employee_type: 'Part Time',
    pairing_always_with: [], pairing_never_with: [],
  },
  {
    id: 'emp-8', created_at: '2022-07-30T09:00:00Z',
    name: 'Marcus Johnson', preferred_name: 'Marcus', email: 'marcus.j@example.com', phone: '(555) 901-2345',
    role: ['Cashier'], experience_level: 'Veteran', shift_tier: 'Rush-capable',
    min_hours: 35, max_hours: 40, min_shifts_per_week: 4, max_shifts_per_week: 5, employee_type: 'Full Time',
    pairing_always_with: [], pairing_never_with: [],
  },
  {
    id: 'emp-9', created_at: '2023-05-12T09:00:00Z',
    name: 'Priya Patel', preferred_name: 'Priya', email: 'priya.p@example.com', phone: '(555) 012-3456',
    role: ['Packliner'], experience_level: 'Veteran', shift_tier: 'Rush-capable',
    min_hours: 30, max_hours: 40, min_shifts_per_week: 4, max_shifts_per_week: 5, employee_type: 'Full Time',
    pairing_always_with: [], pairing_never_with: [],
  },
  {
    id: 'emp-10', created_at: '2023-12-01T09:00:00Z',
    name: 'Tyler Brooks', preferred_name: 'Tyler', email: 'tyler.b@example.com', phone: '(555) 123-4567',
    role: ['Cook'], experience_level: 'Intermediate', shift_tier: 'Light shifts',
    min_hours: 20, max_hours: 35, min_shifts_per_week: 2, max_shifts_per_week: 4, employee_type: 'Part Time',
    pairing_always_with: [], pairing_never_with: [],
  },
];

const ALL_HOURS = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'];
const MORNING_HOURS = ['10:00','11:00','12:00','13:00'];
const AFTERNOON_HOURS = ['14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'];
const EVENING_HOURS = ['18:00','19:00','20:00','21:00','22:00'];

const fullAvailGrid = (): AvailabilityRequest['availability_grid'] =>
  Object.fromEntries(
    ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d => [d, [...ALL_HOURS]])
  ) as Record<DayKey, string[]>;

export const mockAvailabilityRequests: AvailabilityRequest[] = [
  {
    id: 'avail-1', employee_id: 'emp-3',
    employee: mockEmployees.find(e => e.id === 'emp-3'),
    week_start_date: '2024-05-20',
    availability_grid: {
      monday:    [...MORNING_HOURS],
      tuesday:   [...ALL_HOURS],
      wednesday: [...AFTERNOON_HOURS],
      thursday:  [...ALL_HOURS],
      friday:    [...EVENING_HOURS],
      saturday:  [...ALL_HOURS],
      sunday:    [...AFTERNOON_HOURS],
    },
    status: 'pending',
    submitted_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'avail-2', employee_id: 'emp-7',
    employee: mockEmployees.find(e => e.id === 'emp-7'),
    week_start_date: '2024-05-20',
    availability_grid: fullAvailGrid(),
    status: 'pending',
    submitted_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
];

export const mockTimeOffRequests: TimeOffRequest[] = [
  {
    id: 'toff-1', employee_id: 'emp-2',
    employee: mockEmployees.find(e => e.id === 'emp-2'),
    start_date: '2024-05-27', end_date: '2024-05-29',
    reason: 'Family vacation planned months in advance.',
    status: 'pending',
    submitted_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'toff-2', employee_id: 'emp-5',
    employee: mockEmployees.find(e => e.id === 'emp-5'),
    start_date: '2024-06-03', end_date: '2024-06-03',
    reason: 'Medical appointment.',
    status: 'pending',
    submitted_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
  },
];

const DEFAULT_RULES: TimeRangeRule[] = [
  { from: '10:00', to: '16:00', cashiers: 0, cooks: 0, packliners: 0 },
  { from: '16:00', to: '18:00', cashiers: 0, cooks: 0, packliners: 0 },
  { from: '18:00', to: '22:00', cashiers: 0, cooks: 0, packliners: 0 },
];

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

export const mockPreferences: Preferences = {
  id: 'pref-1',
  labor_cost_target: 28,
  max_consecutive_days: 5,
  min_availability_hours: 20,
  max_hours_per_week: 45,
  role_requirements: Object.fromEntries(DAYS.map(d => [d, DEFAULT_RULES.map(r => ({ ...r }))])),
  operating_hours: {
    open: '10:00',
    close: '22:00',
  },
};

export const mockSchedule: Schedule = {
  id: 'sched-1',
  week_start_date: '2024-05-20',
  status: 'draft',
  generated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  last_modified: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
};

export const mockShifts: Shift[] = [
  // Monday
  { id: 's1',  schedule_id: 'sched-1', employee_id: 'emp-1', employee: mockEmployees[0], role: 'Cook',     date: '2024-05-20', start_time: '10:00', end_time: '18:00', is_locked: true,  shift_type: 'morning'   },
  { id: 's2',  schedule_id: 'sched-1', employee_id: 'emp-8', employee: mockEmployees[7], role: 'Cashier',  date: '2024-05-20', start_time: '10:00', end_time: '18:00', is_locked: false, shift_type: 'morning'   },
  { id: 's3',  schedule_id: 'sched-1', employee_id: 'emp-9', employee: mockEmployees[8], role: 'Packliner',date: '2024-05-20', start_time: '14:00', end_time: '22:00', is_locked: false, shift_type: 'afternoon' },
  { id: 's4',  schedule_id: 'sched-1', employee_id: 'emp-4', employee: mockEmployees[3], role: 'Cook',     date: '2024-05-20', start_time: '14:00', end_time: '22:00', is_locked: false, shift_type: 'afternoon' },
  { id: 's5',  schedule_id: 'sched-1', employee_id: 'emp-2', employee: mockEmployees[1], role: 'Cashier',  date: '2024-05-20', start_time: '16:00', end_time: '22:00', is_locked: false, shift_type: 'afternoon' },
  // Tuesday
  { id: 's6',  schedule_id: 'sched-1', employee_id: 'emp-1', employee: mockEmployees[0], role: 'Cook',     date: '2024-05-21', start_time: '10:00', end_time: '18:00', is_locked: false, shift_type: 'morning'   },
  { id: 's7',  schedule_id: 'sched-1', employee_id: 'emp-5', employee: mockEmployees[4], role: 'Cashier',  date: '2024-05-21', start_time: '10:00', end_time: '18:00', is_locked: false, shift_type: 'morning'   },
  // Wednesday
  { id: 's8',  schedule_id: 'sched-1', employee_id: 'emp-4', employee: mockEmployees[3], role: 'Cook',     date: '2024-05-22', start_time: '14:00', end_time: '22:00', is_locked: false, shift_type: 'afternoon' },
  { id: 's9',  schedule_id: 'sched-1', employee_id: 'emp-6', employee: mockEmployees[5], role: 'Packliner',date: '2024-05-22', start_time: '14:00', end_time: '22:00', is_locked: false, shift_type: 'afternoon' },
  // Thursday
  { id: 's10', schedule_id: 'sched-1', employee_id: 'emp-1', employee: mockEmployees[0], role: 'Cook',     date: '2024-05-23', start_time: '10:00', end_time: '18:00', is_locked: false, shift_type: 'morning'   },
  { id: 's11', schedule_id: 'sched-1', employee_id: 'emp-8', employee: mockEmployees[7], role: 'Cashier',  date: '2024-05-23', start_time: '10:00', end_time: '18:00', is_locked: false, shift_type: 'morning'   },
  // Friday
  { id: 's12', schedule_id: 'sched-1', employee_id: 'emp-4', employee: mockEmployees[3], role: 'Cook',     date: '2024-05-24', start_time: '14:00', end_time: '22:00', is_locked: false, shift_type: 'afternoon' },
  { id: 's13', schedule_id: 'sched-1', employee_id: 'emp-5', employee: mockEmployees[4], role: 'Cashier',  date: '2024-05-24', start_time: '14:00', end_time: '22:00', is_locked: false, shift_type: 'afternoon' },
  { id: 's14', schedule_id: 'sched-1', employee_id: 'emp-9', employee: mockEmployees[8], role: 'Packliner',date: '2024-05-24', start_time: '14:00', end_time: '22:00', is_locked: false, shift_type: 'afternoon' },
  // Saturday
  { id: 's15', schedule_id: 'sched-1', employee_id: 'emp-1', employee: mockEmployees[0], role: 'Cook',     date: '2024-05-25', start_time: '10:00', end_time: '18:00', is_locked: true,  shift_type: 'morning'   },
  { id: 's16', schedule_id: 'sched-1', employee_id: 'emp-4', employee: mockEmployees[3], role: 'Cook',     date: '2024-05-25', start_time: '14:00', end_time: '22:00', is_locked: false, shift_type: 'afternoon' },
  { id: 's17', schedule_id: 'sched-1', employee_id: 'emp-2', employee: mockEmployees[1], role: 'Cashier',  date: '2024-05-25', start_time: '18:00', end_time: '22:00', is_locked: false, shift_type: 'evening'   },
];

const makeDailySales = (base: number) =>
  Object.fromEntries(
    Array.from({ length: 18 }, (_, i) => {
      const hour = i + 6;
      const peak = (hour >= 11 && hour <= 14) || (hour >= 17 && hour <= 20);
      return [String(hour), Math.round(base * (peak ? 1.4 + Math.random() * 0.4 : 0.6 + Math.random() * 0.4))];
    })
  );

export const mockSalesData: SalesData[] = [
  { id: 'sd-mon', date: '2024-05-20', week_start_date: '2024-05-20', hourly_sales: makeDailySales(420) },
  { id: 'sd-tue', date: '2024-05-21', week_start_date: '2024-05-20', hourly_sales: makeDailySales(380) },
  { id: 'sd-wed', date: '2024-05-22', week_start_date: '2024-05-20', hourly_sales: makeDailySales(410) },
  { id: 'sd-thu', date: '2024-05-23', week_start_date: '2024-05-20', hourly_sales: makeDailySales(450) },
  { id: 'sd-fri', date: '2024-05-24', week_start_date: '2024-05-20', hourly_sales: makeDailySales(580) },
  { id: 'sd-sat', date: '2024-05-25', week_start_date: '2024-05-20', hourly_sales: makeDailySales(720) },
  { id: 'sd-sun', date: '2024-05-26', week_start_date: '2024-05-20', hourly_sales: makeDailySales(660) },
];

export const mockActivity: ActivityItem[] = [
  { id: 'act-1', type: 'schedule_generated', message: 'Schedule generated for week of May 20', timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(), actor: 'Manager' },
  { id: 'act-2', type: 'employee_approved',  message: 'Approved availability for Sofia Gonzalez', timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), actor: 'Manager' },
  { id: 'act-3', type: 'shift_edited',       message: 'Maria Santos shift on Mon locked', timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), actor: 'Manager' },
  { id: 'act-4', type: 'employee_added',     message: 'Added new employee Tyler Brooks', timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), actor: 'Manager' },
  { id: 'act-5', type: 'schedule_published', message: 'Published schedule for week of May 13', timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), actor: 'Manager' },
];
