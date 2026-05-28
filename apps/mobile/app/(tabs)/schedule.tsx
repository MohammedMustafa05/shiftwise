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
  const [selectedDay, setSelectedDay] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [weekShifts, setWeekShifts] = useState<EmployeeShift[]>([]);
  const [loading, setLoading] = useState(true);

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
      const monday = getMondayForOffset(weekOffset);
      const weekStart = formatDateYmd(monday);
      const rows = await api.getTeamSchedule(user.workplaceId, weekStart);
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

  const days = useMemo(() => getDaysForWeek(weekOffset), [weekOffset]);
  const weekLabel = useMemo(() => formatWeekLabel(weekOffset), [weekOffset]);

  const dayShifts = useMemo(() => {
    return weekShifts.filter((s) => s.dayIndex === selectedDay);
  }, [weekShifts, selectedDay]);

  const goPrevWeek = () => {
    setWeekOffset((w) => w - 1);
    setSelectedDay(0);
  };

  const goNextWeek = () => {
    setWeekOffset((w) => w + 1);
    setSelectedDay(0);
  };

  const openTransfer = () => {
    setMenuOpen(false);
    router.push("/transfer-shift");
  };

  const openOffer = () => {
    setMenuOpen(false);
    router.push("/offer-shift");
  };

  const openOpenShifts = () => {
    setMenuOpen(false);
    router.push("/open-shifts");
  };

  const openRequests = () => {
    setMenuOpen(false);
    router.push("/shift-requests");
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Schedule</Text>
          <Text style={styles.subtitle}>Weekly workforce view</Text>
        </View>
        <Pressable
          style={styles.menuBtn}
          onPress={() => setMenuOpen(true)}
          hitSlop={8}
        >
          <Feather name="more-vertical" size={22} color={Colors.textPrimary} />
          {pendingCount > 0 ? (
            <View style={styles.menuBadge}>
              <Text style={styles.menuBadgeText}>{pendingCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <Modal visible={menuOpen} transparent animationType="fade">
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <Pressable
            style={[styles.menuSheet, { top: insets.top + 52, right: 16 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Pressable style={styles.menuItem} onPress={openTransfer}>
              <Feather name="repeat" size={18} color={Colors.primary} />
              <View style={styles.menuItemBody}>
                <Text style={styles.menuItemText}>Transfer My Shift</Text>
                <Text style={styles.menuItemSubtext}>Switch with coworkers</Text>
              </View>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={openOffer}>
              <Feather name="upload" size={18} color={Colors.primary} />
              <Text style={styles.menuItemText}>Offer Shift to Team</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={openOpenShifts}>
              <Feather name="inbox" size={18} color={Colors.primary} />
              <Text style={styles.menuItemText}>Open Shifts</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={openRequests}>
              <Feather name="inbox" size={18} color={Colors.primary} />
              <Text style={styles.menuItemText}>
                Shift Requests{pendingCount > 0 ? ` (${pendingCount})` : ""}
              </Text>
              {pendingCount > 0 ? (
                <View style={styles.menuItemBadge}>
                  <Text style={styles.menuItemBadgeText}>{pendingCount}</Text>
                </View>
              ) : null}
            </Pressable>
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
          { paddingBottom: insets.bottom + 16 },
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
  menuBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  menuBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.error,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  menuBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: Colors.textLight,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.25)",
  },
  menuSheet: {
    position: "absolute",
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: 220,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  menuItemBody: {
    flex: 1,
  },
  menuItemSubtext: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  menuDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },
  menuItemBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.error,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  menuItemBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textLight,
  },
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
