import type { JobRole } from "./colors";

export type Shift = {
  id: string;
  name: string;
  day: string;
  dayShort: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  role: string;
};

export type Teammate = {
  id: string;
  name: string;
  initials: string;
  role: string;
  shift?: string;
  shiftTime?: string;
};

export type AvailabilityStatus = "available" | "unavailable" | "partial";

export type DayAvailability = {
  day: string;
  dayShort: string;
  status: AvailabilityStatus;
  startTime?: string;
  endTime?: string;
};

export const currentUser = {
  id: "1",
  name: "Sarah Johnson",
  initials: "SJ",
  firstName: "Sarah",
  email: "sarah.johnson@shiftagent.co",
  phone: "(416) 555-0142",
  role: "Barista",
  employmentType: "Full Time",
  department: "Front of House",
  branch: "Main Branch",
  location: "Toronto, ON",
  startDate: "March 15, 2024",
};

export const stats = {
  shiftsThisWeek: 4,
  hoursThisWeek: 32,
  daysOff: 3,
  hoursWorked: 28,
  shiftsDone: 12,
  streak: 5,
};

export const nextShift: Shift = {
  id: "next-1",
  name: "Morning Shift",
  day: "Monday",
  dayShort: "Mon",
  date: "Jun 2",
  startTime: "8AM",
  endTime: "4PM",
  location: "Main Branch",
  role: "Barista",
};

export const sarahShifts: Shift[] = [
  {
    id: "s1",
    name: "Morning Shift",
    day: "Monday",
    dayShort: "Mon",
    date: "Jun 2",
    startTime: "8AM",
    endTime: "4PM",
    location: "Main Branch",
    role: "Barista",
  },
  {
    id: "s2",
    name: "Afternoon Shift",
    day: "Wednesday",
    dayShort: "Wed",
    date: "Jun 4",
    startTime: "12PM",
    endTime: "8PM",
    location: "Main Branch",
    role: "Barista",
  },
  {
    id: "s3",
    name: "Morning Shift",
    day: "Friday",
    dayShort: "Fri",
    date: "Jun 6",
    startTime: "8AM",
    endTime: "4PM",
    location: "Main Branch",
    role: "Barista",
  },
  {
    id: "s4",
    name: "Evening Shift",
    day: "Saturday",
    dayShort: "Sat",
    date: "Jun 7",
    startTime: "4PM",
    endTime: "10PM",
    location: "Main Branch",
    role: "Barista",
  },
];

export const teammates: Teammate[] = [
  { id: "t1", name: "Marcus Lee", initials: "ML", role: "Shift Lead", shift: "Morning Shift", shiftTime: "8AM–4PM" },
  { id: "t2", name: "Priya Patel", initials: "PP", role: "Barista", shift: "Morning Shift", shiftTime: "8AM–4PM" },
  { id: "t3", name: "James O'Brien", initials: "JO", role: "Barista", shift: "Morning Shift", shiftTime: "8AM–12PM" },
  { id: "t4", name: "Aisha Rowe", initials: "AR", role: "Cashier", shift: "Morning Shift", shiftTime: "8AM–4PM" },
  { id: "t5", name: "Tom Wells", initials: "TW", role: "Barista", shift: "Afternoon Shift", shiftTime: "12PM–8PM" },
  { id: "t6", name: "Nina Chan", initials: "NC", role: "Shift Lead", shift: "Evening Shift", shiftTime: "4PM–10PM" },
];

export const teamOnShiftToday: Teammate[] = teammates.slice(0, 4);

export const announcements = [
  {
    id: "a1",
    title: "Weekly schedule is live",
    date: "May 24, 2026",
    type: "schedule_published" as const,
    route: "/(tabs)/schedule",
    read: false,
  },
];

export const weekDays = [
  { label: "Mon", date: "Jun 2", fullDate: "2026-06-02" },
  { label: "Tue", date: "Jun 3", fullDate: "2026-06-03" },
  { label: "Wed", date: "Jun 4", fullDate: "2026-06-04" },
  { label: "Thu", date: "Jun 5", fullDate: "2026-06-05" },
  { label: "Fri", date: "Jun 6", fullDate: "2026-06-06" },
  { label: "Sat", date: "Jun 7", fullDate: "2026-06-07" },
  { label: "Sun", date: "Jun 8", fullDate: "2026-06-08" },
];

export const teamScheduleByDay: Record<string, Teammate[]> = {
  "2026-06-02": teammates,
  "2026-06-03": [],
  "2026-06-04": [teammates[0], teammates[4], { ...currentUser, initials: "SJ", shift: "Afternoon Shift", shiftTime: "12PM–8PM" } as Teammate],
  "2026-06-05": [],
  "2026-06-06": [teammates[1], { ...currentUser, initials: "SJ", shift: "Morning Shift", shiftTime: "8AM–4PM" } as Teammate],
  "2026-06-07": [teammates[5], { ...currentUser, initials: "SJ", shift: "Evening Shift", shiftTime: "4PM–10PM" } as Teammate],
  "2026-06-08": [],
};

export const defaultAvailability: DayAvailability[] = [
  { day: "Monday", dayShort: "Mon", status: "available" },
  { day: "Tuesday", dayShort: "Tue", status: "unavailable" },
  { day: "Wednesday", dayShort: "Wed", status: "available" },
  { day: "Thursday", dayShort: "Thu", status: "partial", startTime: "2PM", endTime: "8PM" },
  { day: "Friday", dayShort: "Fri", status: "available" },
  { day: "Saturday", dayShort: "Sat", status: "partial", startTime: "10AM", endTime: "6PM" },
  { day: "Sunday", dayShort: "Sun", status: "unavailable" },
];

export const lastAvailabilitySubmitted = "Monday May 20 · 9:32 AM";

export type TimelineShift = {
  id: string;
  employeeName: string;
  initials: string;
  role: JobRole;
  startTime: string;
  endTime: string;
  startHour: number;
  endHour: number;
  location: string;
};

export const timelineWeekDays = [
  { index: 0, label: "Mon", date: 2, dayName: "Monday", fullLabel: "Monday, June 2" },
  { index: 1, label: "Tue", date: 3, dayName: "Tuesday", fullLabel: "Tuesday, June 3" },
  { index: 2, label: "Wed", date: 4, dayName: "Wednesday", fullLabel: "Wednesday, June 4" },
  { index: 3, label: "Thu", date: 5, dayName: "Thursday", fullLabel: "Thursday, June 5" },
  { index: 4, label: "Fri", date: 6, dayName: "Friday", fullLabel: "Friday, June 6" },
  { index: 5, label: "Sat", date: 7, dayName: "Saturday", fullLabel: "Saturday, June 7" },
  { index: 6, label: "Sun", date: 8, dayName: "Sunday", fullLabel: "Sunday, June 8" },
];

export const timelineTodayIndex = 0;

function shift(
  id: string,
  employeeName: string,
  initials: string,
  role: JobRole,
  startTime: string,
  endTime: string,
  startHour: number,
  endHour: number,
): TimelineShift {
  return {
    id,
    employeeName,
    initials,
    role,
    startTime,
    endTime,
    startHour,
    endHour,
    location: "Main Branch",
  };
}

export const timelineShiftsByDay: Record<number, TimelineShift[]> = {
  0: [
    shift("m1", "Sarah Johnson", "SJ", "Cook", "8AM", "4PM", 8, 16),
    shift("m2", "Marcus Lee", "ML", "Cook", "10AM", "6PM", 10, 18),
    shift("m3", "Priya Patel", "PP", "Packer", "9AM", "3PM", 9, 15),
    shift("m4", "Aisha Rowe", "AR", "Cashier", "8AM", "2PM", 8, 14),
    shift("m5", "Tom Wells", "TW", "Shift Lead", "7AM", "3PM", 7, 15),
    shift("m6", "Nina Chan", "NC", "Server", "11AM", "7PM", 11, 19),
  ],
  1: [
    shift("t1", "James O'Brien", "JO", "Packer", "12PM", "8PM", 12, 20),
    shift("t2", "Aisha Rowe", "AR", "Cashier", "10AM", "4PM", 10, 16),
    shift("t3", "Nina Chan", "NC", "Server", "9AM", "5PM", 9, 17),
    shift("t4", "Dan Kim", "DK", "Server", "2PM", "9PM", 14, 21),
  ],
  2: [
    shift("w1", "Sarah Johnson", "SJ", "Cook", "10AM", "6PM", 10, 18),
    shift("w2", "Priya Patel", "PP", "Packer", "8AM", "4PM", 8, 16),
    shift("w3", "Tom Wells", "TW", "Shift Lead", "12PM", "8PM", 12, 20),
    shift("w4", "Marcus Lee", "ML", "Cook", "7AM", "3PM", 7, 15),
  ],
  3: [],
  4: [
    shift("f1", "Sarah Johnson", "SJ", "Cook", "7AM", "3PM", 7, 15),
    shift("f2", "Marcus Lee", "ML", "Cook", "12PM", "8PM", 12, 20),
    shift("f3", "Priya Patel", "PP", "Packer", "8AM", "4PM", 8, 16),
    shift("f4", "James O'Brien", "JO", "Packer", "2PM", "9PM", 14, 21),
    shift("f5", "Aisha Rowe", "AR", "Cashier", "9AM", "5PM", 9, 17),
    shift("f6", "Tom Wells", "TW", "Shift Lead", "7AM", "3PM", 7, 15),
    shift("f7", "Nina Chan", "NC", "Server", "10AM", "6PM", 10, 18),
    shift("f8", "Dan Kim", "DK", "Server", "3PM", "9PM", 15, 21),
  ],
  5: [
    shift("s1", "Sarah Johnson", "SJ", "Cook", "8AM", "2PM", 8, 14),
    shift("s2", "Nina Chan", "NC", "Server", "10AM", "6PM", 10, 18),
    shift("s3", "Aisha Rowe", "AR", "Cashier", "9AM", "3PM", 9, 15),
  ],
  6: [],
};

export type HourRange = { startHour: number; endHour: number };

export const availabilityWeekDays = [
  { index: 0, label: "Mon", date: 2 },
  { index: 1, label: "Tue", date: 3 },
  { index: 2, label: "Wed", date: 4 },
  { index: 3, label: "Thu", date: 5 },
  { index: 4, label: "Fri", date: 6 },
  { index: 5, label: "Sat", date: 7 },
  { index: 6, label: "Sun", date: 8 },
];

export const defaultAvailabilityRanges: Record<number, HourRange[]> = {
  0: [{ startHour: 8, endHour: 15 }],
  1: [{ startHour: 10, endHour: 15 }],
  2: [{ startHour: 8, endHour: 16 }],
  3: [],
  4: [{ startHour: 9, endHour: 16 }],
  5: [{ startHour: 10, endHour: 14 }],
  6: [],
};

