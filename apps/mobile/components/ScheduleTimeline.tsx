import { useMemo, useRef } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  Colors,
  getRoleColor,
  ROLE_GROUP_LABELS,
  type JobRole,
} from "../constants/colors";
import type { TimelineShift } from "../constants/dummyData";
import {
  durationToHeight,
  formatHourLabel,
  formatTimeRangeShort,
  getCurrentTimePosition,
  hourToTimelineTop,
  TIMELINE_END_HOUR,
  TIMELINE_ROW_HEIGHT,
  TIMELINE_START_HOUR,
  TIMELINE_TOTAL_HEIGHT,
} from "../utils/time";

const TIME_COL_W = 60;
const BLOCK_W = 80;
const BLOCK_GAP = 8;
const GROUP_PAD = 12;

const ROLE_ORDER: JobRole[] = [
  "Cook",
  "Packer",
  "Cashier",
  "Shift Lead",
  "Server",
  "Cleaner",
];

type ScheduleTimelineProps = {
  shifts: TimelineShift[];
  isToday: boolean;
  roleFilter: JobRole | "All";
  onShiftPress: (shift: TimelineShift) => void;
};

function groupByRole(shifts: TimelineShift[]) {
  const map = new Map<JobRole, TimelineShift[]>();
  for (const role of ROLE_ORDER) {
    const items = shifts.filter((s) => s.role === role);
    if (items.length > 0) map.set(role, items);
  }
  return map;
}

function groupWidth(count: number) {
  return count * BLOCK_W + Math.max(0, count - 1) * BLOCK_GAP + GROUP_PAD * 2;
}

export default function ScheduleTimeline({
  shifts,
  isToday,
  roleFilter,
  onShiftPress,
}: ScheduleTimelineProps) {
  const timeScrollRef = useRef<ScrollView>(null);
  const bodyScrollRef = useRef<ScrollView>(null);
  const syncing = useRef(false);

  const hours = useMemo(() => {
    const list: number[] = [];
    for (let h = TIMELINE_START_HOUR; h <= TIMELINE_END_HOUR; h++) list.push(h);
    return list;
  }, []);

  const roleGroups = useMemo(() => groupByRole(shifts), [shifts]);
  const currentTimeTop = isToday ? getCurrentTimePosition() : -1;

  const columns = useMemo(() => {
    let offset = 0;
    return Array.from(roleGroups.entries()).map(([role, roleShifts]) => {
      const width = groupWidth(roleShifts.length);
      const col = { role, shifts: roleShifts, left: offset, width };
      offset += width;
      return col;
    });
  }, [roleGroups]);

  const totalGridWidth = columns.reduce((sum, c) => sum + c.width, 0) || 200;

  const syncScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (syncing.current) return;
    syncing.current = true;
    const y = e.nativeEvent.contentOffset.y;
    timeScrollRef.current?.scrollTo({ y, animated: false });
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  if (shifts.length === 0) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIcon}>
          <Feather name="calendar" size={32} color={Colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>No shifts scheduled for this day</Text>
        <Text style={styles.emptySubtitle}>
          Check another day or contact your manager
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.headerScroll}
        contentContainerStyle={{ paddingLeft: TIME_COL_W, minWidth: TIME_COL_W + totalGridWidth }}
      >
        {columns.map((col) => (
          <View key={col.role} style={[styles.colHeader, { width: col.width }]}>
            <Text style={[styles.colHeaderText, { color: getRoleColor(col.role) }]}>
              {ROLE_GROUP_LABELS[col.role]}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.body}>
        <ScrollView
          ref={timeScrollRef}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          style={styles.timeCol}
        >
          {hours.map((hour) => (
            <View key={hour} style={styles.timeRow}>
              <Text style={styles.timeLabel}>{formatHourLabel(hour)}</Text>
              {isToday &&
                currentTimeTop >= 0 &&
                Math.abs(currentTimeTop - hourToTimelineTop(hour)) < 32 && (
                  <View style={styles.nowDot} />
                )}
            </View>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gridH}>
          <ScrollView
            ref={bodyScrollRef}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            onScroll={syncScroll}
            scrollEventThrottle={16}
          >
            <View style={[styles.grid, { width: totalGridWidth, height: TIMELINE_TOTAL_HEIGHT }]}>
              {hours.map((hour) => (
                <View
                  key={`line-${hour}`}
                  style={[styles.hourLine, { top: hourToTimelineTop(hour) }]}
                />
              ))}

              {isToday && currentTimeTop >= 0 && (
                <View style={[styles.nowLine, { top: currentTimeTop }]} />
              )}

              {columns.map((col) => (
                <View
                  key={col.role}
                  style={[styles.roleColumn, { left: col.left, width: col.width }]}
                >
                  {col.shifts.map((s, blockIndex) => {
                    const dimmed = roleFilter !== "All" && roleFilter !== s.role;
                    return (
                      <Pressable
                        key={s.id}
                        style={[
                          styles.block,
                          {
                            top: hourToTimelineTop(s.startHour),
                            height: durationToHeight(s.startHour, s.endHour),
                            left: GROUP_PAD + blockIndex * (BLOCK_W + BLOCK_GAP),
                            width: BLOCK_W,
                            backgroundColor: getRoleColor(s.role),
                            opacity: dimmed ? 0.15 : 1,
                          },
                        ]}
                        onPress={() => onShiftPress(s)}
                      >
                        <Text style={styles.blockName} numberOfLines={1}>
                          {s.employeeName.split(" ")[0]}
                        </Text>
                        <Text style={styles.blockRole} numberOfLines={1}>
                          {s.role}
                        </Text>
                        <Text style={styles.blockTime} numberOfLines={1}>
                          {formatTimeRangeShort(s.startTime, s.endTime)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  headerScroll: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  colHeader: {
    paddingVertical: 10,
    paddingHorizontal: GROUP_PAD,
    justifyContent: "center",
  },
  colHeaderText: {
    fontSize: 13,
    fontWeight: "700",
  },
  body: {
    flex: 1,
    flexDirection: "row",
  },
  timeCol: {
    width: TIME_COL_W,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  timeRow: {
    height: TIMELINE_ROW_HEIGHT,
    paddingTop: 4,
    paddingRight: 6,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "flex-end",
  },
  timeLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: "500",
    textAlign: "right",
  },
  nowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.error,
    position: "absolute",
    right: -4,
    top: 8,
  },
  gridH: {
    flex: 1,
  },
  grid: {
    position: "relative",
  },
  hourLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Colors.border,
  },
  nowLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: Colors.error,
    zIndex: 10,
  },
  roleColumn: {
    position: "absolute",
    top: 0,
    height: TIMELINE_TOTAL_HEIGHT,
  },
  block: {
    position: "absolute",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
    justifyContent: "space-between",
  },
  blockName: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textLight,
  },
  blockRole: {
    fontSize: 10,
    color: "rgba(255,255,255,0.75)",
  },
  blockTime: {
    fontSize: 9,
    color: "rgba(255,255,255,0.85)",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: Colors.textPrimary,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
});
