export const Colors = {
  background: "#0A0A0F",
  surface: "#16161F",
  card: "#16161F",
  primary: "#818CF8",
  primaryLight: "rgba(129,140,248,0.12)",
  primaryDark: "#6366F1",
  secondary: "#818CF8",
  success: "#34D399",
  warning: "#FBBF24",
  error: "#F87171",
  textPrimary: "#F1F5F9",
  textSecondary: "#94A3B8",
  textMuted: "#475569",
  border: "#1E1E2A",
  active: "#818CF8",
  textLight: "#FFFFFF",
  emptyCell: "#16161F",
  cellBg: "#16161F",
  todayTint: "rgba(129,140,248,0.1)",
  inputBackground: "#16161F",
  inputBorder: "#1E1E2A",
  rangeShades: ["#818CF8", "#6366F1", "#4F46E5"] as const,
  accent: "#818CF8",
  muted: "#475569",
  text: "#F1F5F9",
  cardBorder: "#1E1E2A",
  caramelLight: "rgba(129,140,248,0.12)",
  unavailable: "#16161F",
} as const;

export type JobRole =
  | "Cook"
  | "Packer"
  | "Cashier"
  | "Shift Lead"
  | "Server"
  | "Cleaner";

const ROLE_COLORS: Record<JobRole, string> = {
  Cook: "#F87171",
  Packer: "#34D399",
  Cashier: "#818CF8",
  "Shift Lead": "#818CF8",
  Server: "#FBBF24",
  Cleaner: "#94A3B8",
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
