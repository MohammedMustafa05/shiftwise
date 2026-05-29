/** Convert "8:00 AM" → "08:00" (24h) */
export function parse12hTo24h(time12: string): string {
  const parts = time12.trim().split(/\s+/);
  const period = parts[parts.length - 1]?.toUpperCase();
  const timePart = parts.slice(0, -1).join(" ") || parts[0];
  const [hStr, mStr] = timePart.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? "0", 10);
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Convert "08:00" → "8:00 AM" */
export function format24hTo12h(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? "0", 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatShiftTimeRange(start: string, end: string): string {
  return `${format24hTo12h(start.slice(0, 5))} – ${format24hTo12h(end.slice(0, 5))}`;
}

export function getMondayForOffset(offset: number): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff + offset * 7);
  monday.setHours(12, 0, 0, 0);
  return monday;
}

export function formatDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Ensure API date strings are `YYYY-MM-DD` before comparing or displaying. */
export function normalizeIsoDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) return formatDateYmd(d);
  return trimmed.slice(0, 10);
}

export function weekdayShortFromIso(dateStr: string): string {
  const iso = normalizeIsoDate(dateStr);
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

export function formatShiftDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function shiftDurationLabel(start: string, end: string): string {
  const [sh, sm] = start.slice(0, 5).split(":").map(Number);
  const [eh, em] = end.slice(0, 5).split(":").map(Number);
  const hrs = eh + em / 60 - (sh + sm / 60);
  const rounded = Math.round(hrs * 10) / 10;
  return `${rounded} hrs`;
}

export function formatRoleLabel(role: string): string {
  const r = role.toUpperCase();
  if (r.includes("COOK")) return "Cook";
  if (r.includes("PACK")) return "Packliner";
  if (r.includes("CASH")) return "Cashier";
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
