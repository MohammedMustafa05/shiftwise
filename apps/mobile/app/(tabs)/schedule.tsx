import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../../constants/colors";
import { api, getStoredUser } from "../../lib/api";
import { useScheduleRealtime } from "../../lib/useScheduleRealtime";
import {
  formatDateYmd,
  formatShiftTimeRange,
  getMondayForOffset,
} from "../../lib/time";

type Role = "Cook" | "Packline" | "Cashier";

type EmployeeShift = {
  id: string;
  name: string;
  role: Role;
  dayIndex: number;
  time: string;
};

const ROLE = {
  Cook: { color: "#4F46E5", label: "Cook" },
  Packline: { color: "#F59E0B", label: "Packline" },
  Cashier: { color: "#10B981", label: "Cashier" },
} as const;

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getMonday(weekOffset: number) {
  return getMondayForOffset(weekOffset);
}

function formatWeekLabel(weekOffset: number) {
  const start = getMonday(weekOffset);
  const end = addDays(start, 6);
  const startPart = `${MONTHS[start.getMonth()]} ${start.getDate()}`;
  const endPart =
    start.getMonth() === end.getMonth()
      ? `${end.getDate()}`
      : `${MONTHS[end.getMonth()]} ${end.getDate()}`;
  return `${startPart} – ${endPart}, ${end.getFullYear()}`;
}

function getDaysForWeek(weekOffset: number) {
  const monday = getMonday(weekOffset);
  return DAY_ABBR.map((abbr, i) => {
    const d = addDays(monday, i);
    return { abbr, date: String(d.getDate()) };
  });
}

function getTodayDayIndex(weekOffset: number): number {
  const monday = getMonday(weekOffset);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    ) {
      return i;
    }
  }
  return 0;
}


function mapApiRole(role: string): Role {
  const r = role.toUpperCase();
  if (r.includes("COOK")) return "Cook";
  if (r.includes("PACK")) return "Packline";
  return "Cashier";
}

export default function ScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(() => getTodayDayIndex(0));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [weekShifts, setWeekShifts] = useState<EmployeeShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [workplaceId, setWorkplaceId] = useState<string | undefined>();

  const refreshPending = useCallback(() => {
    void api.getTransferRequests().then((rows) => {
      setPendingCount(rows.length);
    }).catch(() => setPendingCount(0));
  }, []);

  const loadWeek = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getStoredUser();
      if (!user?.workplaceId) {
        setWeekShifts([]);
        return;
      }
      setWorkplaceId(user.workplaceId);
      const monday = getMondayForOffset(weekOffset);
      const weekStart = formatDateYmd(monday);
      const rows = await api.getTeamSchedule(user.workplaceId, weekStart);
      const mySchedule = await api.getMySchedule(weekStart);
      if (mySchedule.scheduleId) {
        void api.markScheduleViewed(mySchedule.scheduleId).catch(() => undefined);
      }
      setWeekShifts(
        rows.map((r) => ({
          id: r.id,
          name: r.employeeName,
          role: mapApiRole(r.role),
          dayIndex: r.dayIndex,
          time: formatShiftTimeRange(r.startTime, r.endTime),
        })),
      );
    } catch {
      setWeekShifts([]);
    } finally {
      setLoading(false);
    }
  }, [weekOffset]);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  useFocusEffect(
    useCallback(() => {
      refreshPending();
      void loadWeek();
    }, [refreshPending, loadWeek]),
  );

  useScheduleRealtime(workplaceId, () => {
    void loadWeek();
  });

  const days = useMemo(() => getDaysForWeek(weekOffset), [weekOffset]);
  const weekLabel = useMemo(() => formatWeekLabel(weekOffset), [weekOffset]);

  const dayShifts = useMemo(() => {
    return weekShifts.filter((s) => s.dayIndex === selectedDay);
  }, [weekShifts, selectedDay]);

  const goPrevWeek = () => {
    setWeekOffset((w) => {
      const next = w - 1;
      setSelectedDay(getTodayDayIndex(next));
      return next;
    });
  };

  const goNextWeek = () => {
    setWeekOffset((w) => {
      const next = w + 1;
      setSelectedDay(getTodayDayIndex(next));
      return next;
    });
  };

  const sheetOptions = [
    { label: "Transfer My Shift", route: "/transfer-shift" as const },
    { label: "Offer Shift to Team", route: "/offer-shift" as const },
    { label: "Shift Requests", route: "/shift-requests" as const, badge: pendingCount },
    { label: "Request Time Off", route: "/request-time-off" as const },
  ];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Schedule</Text>
          <Text style={styles.subtitle}>Weekly workforce view</Text>
        </View>
      </View>

      <Modal visible={sheetOpen} transparent animationType="slide">
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetOpen(false)}>
          <Pressable
            style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
            onPress={(e) => e.stopPropagation()}
          >
            {sheetOptions.map((opt) => (
              <Pressable
                key={opt.label}
                style={styles.sheetRow}
                onPress={() => {
                  setSheetOpen(false);
                  router.push(opt.route);
                }}
              >
                <Text style={styles.sheetRowText}>{opt.label}</Text>
                {opt.badge && opt.badge > 0 ? (
                  <View style={styles.sheetBadge}>
                    <Text style={styles.sheetBadgeText}>{opt.badge}</Text>
                  </View>
                ) : null}
                <Feather name="chevron-right" size={18} color={Colors.textMuted} />
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.weekNav}>
        <Pressable style={styles.weekBtn} onPress={goPrevWeek} hitSlop={8}>
          <Feather name="chevron-left" size={20} color={Colors.primary} />
        </Pressable>
        <Text style={styles.weekText} numberOfLines={1}>
          {weekLabel}
        </Text>
        <Pressable style={styles.weekBtn} onPress={goNextWeek} hitSlop={8}>
          <Feather name="chevron-right" size={20} color={Colors.primary} />
        </Pressable>
      </View>

      <View style={styles.dayRow}>
        {days.map((day, i) => {
          const active = i === selectedDay;
          return (
            <Pressable
              key={`${weekOffset}-${day.abbr}`}
              style={[styles.dayPill, active && styles.dayPillActive]}
              onPress={() => setSelectedDay(i)}
            >
              <Text style={[styles.dayAbbr, active && styles.dayPillTextActive]}>
                {day.abbr}
              </Text>
              <Text style={[styles.dayDate, active && styles.dayPillTextActive]}>
                {day.date}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.legend}>
        {(Object.keys(ROLE) as Role[]).map((role) => (
          <View key={role} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: ROLE[role].color }]} />
            <Text style={styles.legendLabel}>{ROLE[role].label}</Text>
          </View>
        ))}
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 88 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {dayShifts.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No shifts scheduled</Text>
          </View>
        ) : (
          dayShifts.map((shift) => (
            <View key={`${weekOffset}-${shift.id}`} style={styles.card}>
              <View
                style={[styles.roleDot, { backgroundColor: ROLE[shift.role].color }]}
              />
              <View style={styles.cardBody}>
                <Text style={styles.empName}>{shift.name}</Text>
                <Text style={styles.empRole}>{ROLE[shift.role].label}</Text>
              </View>
              <View style={styles.timeBadge}>
                <Text style={styles.timeText}>{shift.time}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <View style={[styles.manageWrap, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable style={styles.manageBtn} onPress={() => setSheetOpen(true)}>
          <Text style={styles.manageBtnText}>Manage Shifts</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 16,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetRowText: { flex: 1, fontSize: 16, fontWeight: "600", color: Colors.textPrimary },
  sheetBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.error,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    marginRight: 8,
  },
  sheetBadgeText: { fontSize: 11, fontWeight: "700", color: Colors.textLight },
  manageWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
  },
  manageBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  manageBtnText: { color: Colors.textLight, fontSize: 16, fontWeight: "600" },
  weekNav: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginBottom: 10,
  },
  weekBtn: {
    padding: 6,
  },
  weekText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
    textAlign: "center",
  },
  dayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  dayPill: {
    width: 42,
    height: 52,
    borderRadius: 21,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dayPillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dayAbbr: {
    fontSize: 10,
    fontWeight: "600",
    color: Colors.textMuted,
  },
  dayDate: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginTop: 1,
  },
  dayPillTextActive: {
    color: Colors.textLight,
  },
  legend: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: Colors.textSecondary,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 8,
    flexGrow: 1,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  roleDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  cardBody: {
    flex: 1,
  },
  empName: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  empRole: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  timeBadge: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 8,
  },
  timeText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.primary,
  },
  empty: {
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
});
