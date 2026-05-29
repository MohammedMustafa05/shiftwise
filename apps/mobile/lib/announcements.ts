export type AnnouncementType =
  | "schedule_published"
  | "shift_request_accepted"
  | "shift_request_rejected"
  | "time_off_accepted"
  | "time_off_rejected"
  | "transfer_shift_accepted"
  | "transfer_shift_rejected"
  | "offer_shift_accepted"
  | "availability_accepted"
  | "availability_rejected";

export type AnnouncementItem = {
  id: string;
  title: string;
  date: string;
  type: AnnouncementType;
  route: string;
  read: boolean;
};

const ICONS: Record<AnnouncementType, string> = {
  schedule_published: "calendar",
  shift_request_accepted: "check-circle",
  shift_request_rejected: "x-circle",
  time_off_accepted: "sun",
  time_off_rejected: "x-circle",
  transfer_shift_accepted: "repeat",
  transfer_shift_rejected: "x-circle",
  offer_shift_accepted: "users",
  availability_accepted: "check-circle",
  availability_rejected: "x-circle",
};

export function announcementIcon(type: AnnouncementType): string {
  return ICONS[type] ?? "bell";
}

/** Maps each announcement type to its destination screen in the mobile app. */
export const ANNOUNCEMENT_ROUTES: Record<AnnouncementType, string> = {
  schedule_published: "/(tabs)/schedule",
  shift_request_accepted: "/shift-requests",
  shift_request_rejected: "/shift-requests",
  time_off_accepted: "/request-time-off",
  time_off_rejected: "/request-time-off",
  transfer_shift_accepted: "/transfer-shift",
  transfer_shift_rejected: "/transfer-shift",
  offer_shift_accepted: "/offer-shift",
  availability_accepted: "/(tabs)/availability",
  availability_rejected: "/(tabs)/availability",
};
