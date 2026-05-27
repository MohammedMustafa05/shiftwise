import type { Role, ExperienceLevel, DayKey } from './types';

const AVATAR_COLORS = [
  '#818CF8','#F87171','#34D399','#FBBF24','#818CF8',
  '#F87171','#34D399','#475569','#94A3B8','#6366F1',
];

export function getAvatarColor(name: string): string {
  const idx = (name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

export function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

export function getRoleBadgeClass(role: Role): string {
  const map: Record<Role, string> = {
    Cashier:   'bg-[#818CF8]/15 text-[#818CF8]',
    Cook:      'bg-[#F87171]/15 text-[#F87171]',
    Packliner: 'bg-[#34D399]/15 text-[#34D399]',
  };
  return map[role] ?? 'bg-[#475569]/10 text-[#94A3B8]';
}

export function getExperienceBadgeClass(level: ExperienceLevel): string {
  const map: Record<ExperienceLevel, string> = {
    Veteran:      'bg-[#34D399]/15 text-[#34D399]',
    Intermediate: 'bg-[#FBBF24]/15 text-[#FBBF24]',
    Trainee:      'bg-[#F87171]/15 text-[#F87171]',
  };
  return map[level] ?? 'bg-[#475569]/10 text-[#94A3B8]';
}

export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour}:00 ${suffix}` : `${hour}:${String(m).padStart(2,'0')} ${suffix}`;
}

export function generateId(): string {
  return crypto.randomUUID();
}

export const DAY_KEYS: DayKey[] = [
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
];

export const DAY_LABELS: Record<DayKey, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

export const DAY_FULL: Record<DayKey, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
  friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
};

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
