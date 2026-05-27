import { useState } from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors } from "../constants/colors";
import {
  availabilityWeekDays,
  type HourRange,
} from "../constants/dummyData";
import {
  AVAIL_END_HOUR,
  AVAIL_START_HOUR,
} from "../utils/time";

type AvailabilityWeekOverviewProps = {
  dayRanges: Record<number, HourRange[]>;
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SPAN = AVAIL_END_HOUR - AVAIL_START_HOUR + 1;

export default function AvailabilityWeekOverview({
  dayRanges,
  selectedDayIndex,
  onSelectDay,
}: AvailabilityWeekOverviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  return (
    <View style={styles.container}>
      <Pressable style={styles.header} onPress={() => setExpanded((p) => !p)}>
        <Text style={styles.title}>This Week Overview</Text>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={20}
          color={Colors.textSecondary}
        />
      </Pressable>

      {expanded && (
        <View style={styles.rows}>
          {availabilityWeekDays.map((day) => {
            const ranges = dayRanges[day.index] ?? [];
            const selected = day.index === selectedDayIndex;
            return (
              <Pressable
                key={day.index}
                style={[styles.row, selected && styles.rowSelected]}
                onPress={() => onSelectDay(day.index)}
              >
                <View style={styles.labelCol}>
                  <Text style={styles.dayName}>{DAY_NAMES[day.index]}</Text>
                  <Text style={styles.dayDate}>Jun {day.date}</Text>
                </View>
                <View style={styles.track} onLayout={onTrackLayout}>
                  {ranges.length === 0 ? (
                    <View style={styles.dashed} />
                  ) : (
                    ranges.map((range) => {
                      const left =
                        ((range.startHour - AVAIL_START_HOUR) / SPAN) * trackWidth;
                      const width =
                        ((range.endHour - range.startHour + 1) / SPAN) * trackWidth;
                      return (
                        <View
                          key={`${range.startHour}-${range.endHour}`}
                          style={[
                            styles.bar,
                            { left, width: Math.max(width, 4) },
                          ]}
                        />
                      );
                    })
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  rows: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowSelected: {
    backgroundColor: Colors.primaryLight,
  },
  labelCol: {
    width: 52,
  },
  dayName: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  dayDate: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  track: {
    flex: 1,
    height: 24,
    backgroundColor: Colors.emptyCell,
    borderRadius: 6,
    position: "relative",
    overflow: "hidden",
  },
  dashed: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: "dashed",
    borderRadius: 6,
    margin: 2,
  },
  bar: {
    position: "absolute",
    top: 3,
    bottom: 3,
    backgroundColor: Colors.primary,
    borderRadius: 4,
  },
});
