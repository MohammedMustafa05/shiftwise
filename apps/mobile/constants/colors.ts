export const Colors = {
  background: "#F0F4FF",
  surface: "#FFFFFF",
  card: "#FFFFFF",
  primary: "#4F46E5",
  primaryLight: "#EEF2FF",
  primaryDark: "#3730A3",
  secondary: "#06B6D4",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  textMuted: "#94A3B8",
  border: "#E2E8F0",
  active: "#4F46E5",
  textLight: "#FFFFFF",
  emptyCell: "#F1F5F9",
  cellBg: "#F8FAFC",
  todayTint: "#EEF2FF",
  inputBackground: "#FFFFFF",
  inputBorder: "#E2E8F0",
  rangeShades: ["#4F46E5", "#6366F1", "#818CF8"] as const,
  accent: "#06B6D4",
  muted: "#94A3B8",
  text: "#0F172A",
  cardBorder: "#E2E8F0",
  caramelLight: "#EEF2FF",
  unavailable: "#F1F5F9",
} as const;

export type JobRole =
  | "Cook"
  | "Packer"
  | "Cashier"
  | "Shift Lead"
  | "Server"
  | "Cleaner";

const ROLE_COLORS: Record<JobRole, string> = {
  Cook: "#4F46E5",
  Packer: "#06B6D4",
  Cashier: "#10B981",
  "Shift Lead": "#8B5CF6",
  Server: "#F59E0B",
  Cleaner: "#64748B",
};

export function getRoleColor(role: JobRole): string {
  return ROLE_COLORS[role];
}

export const ROLE_LEGEND: { role: JobRole | "All"; label: string }[] = [
  { role: "All", label: "All" },
  { role: "Cook", label: "Cook" },
  { role: "Packer", label: "Packer" },
  { role: "Cashier", label: "Cashier" },
  { role: "Shift Lead", label: "Shift Lead" },
  { role: "Server", label: "Server" },
  { role: "Cleaner", label: "Cleaner" },
];

export const ROLE_GROUP_LABELS: Record<JobRole, string> = {
  Cook: "Cooks",
  Packer: "Packers",
  Cashier: "Cashiers",
  "Shift Lead": "Shift Leads",
  Server: "Servers",
  Cleaner: "Cleaners",
};
