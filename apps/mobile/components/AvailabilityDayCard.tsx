import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors } from "../constants/colors";
import type { AvailabilityStatus, DayAvailability } from "../constants/dummyData";

const TIME_OPTIONS = ["6AM", "8AM", "10AM", "12PM", "2PM", "4PM", "6PM", "8PM", "10PM"];

type AvailabilityDayCardProps = {
  day: DayAvailability;
  onChange: (updated: DayAvailability) => void;
};

const STATUS_OPTIONS: { value: AvailabilityStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "unavailable", label: "Unavailable" },
  { value: "partial", label: "Partial" },
];

function getStatusColors(status: AvailabilityStatus) {
  switch (status) {
    case "available":
      return { bg: Colors.success, border: Colors.success, text: Colors.textLight };
    case "unavailable":
      return { bg: Colors.unavailable, border: Colors.unavailable, text: Colors.primary };
    case "partial":
      return { bg: Colors.accent, border: Colors.accent, text: Colors.textLight };
  }
}

function nextTime(current: string, direction: 1 | -1) {
  const index = TIME_OPTIONS.indexOf(current);
  if (index === -1) return TIME_OPTIONS[0];
  const next = (index + direction + TIME_OPTIONS.length) % TIME_OPTIONS.length;
  return TIME_OPTIONS[next];
}

export default function AvailabilityDayCard({ day, onChange }: AvailabilityDayCardProps) {
  const setStatus = (status: AvailabilityStatus) => {
    if (status === "partial") {
      onChange({
        ...day,
        status,
        startTime: day.startTime ?? "10AM",
        endTime: day.endTime ?? "6PM",
      });
      return;
    }

    onChange({ ...day, status, startTime: undefined, endTime: undefined });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.dayName}>{day.day}</Text>
      <Text style={styles.dayShort}>{day.dayShort}</Text>

      <View style={styles.statusRow}>
        {STATUS_OPTIONS.map((option) => {
          const selected = day.status === option.value;
          const colors = getStatusColors(option.value);
          return (
            <Pressable
              key={option.value}
              style={[
                styles.statusPill,
                selected && { backgroundColor: colors.bg, borderColor: colors.border },
              ]}
              onPress={() => setStatus(option.value)}
            >
              <Text
                style={[styles.statusText, selected && { color: colors.text }]}
                numberOfLines={1}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {day.status === "partial" && (
        <View style={styles.timeSection}>
          <Text style={styles.timeLabel}>Available hours</Text>
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.timeFieldLabel}>From</Text>
              <Pressable
                style={styles.timePicker}
                onPress={() =>
                  onChange({ ...day, startTime: nextTime(day.startTime ?? "10AM", 1) })
                }
              >
                <Text style={styles.timeValue}>{day.startTime}</Text>
              </Pressable>
            </View>
            <Text style={styles.timeDash}>–</Text>
            <View style={styles.timeField}>
              <Text style={styles.timeFieldLabel}>To</Text>
              <Pressable
                style={styles.timePicker}
                onPress={() =>
                  onChange({ ...day, endTime: nextTime(day.endTime ?? "6PM", 1) })
                }
              >
                <Text style={styles.timeValue}>{day.endTime}</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.timeChips}>
            {TIME_OPTIONS.map((time) => {
              const active = day.startTime === time || day.endTime === time;
              return (
                <Pressable
                  key={time}
                  style={[styles.timeChip, active && styles.timeChipActive]}
                  onPress={() => {
                    if (!day.startTime || day.endTime === day.startTime) {
                      onChange({ ...day, startTime: time, endTime: day.endTime ?? "6PM" });
                    } else {
                      onChange({ ...day, endTime: time });
                    }
                  }}
                >
                  <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>
                    {time}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 14,
  },
  dayName: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.primary,
  },
  dayShort: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: "row",
    gap: 6,
  },
  statusPill: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 20,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    alignItems: "center",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.muted,
  },
  timeSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  timeLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.muted,
    marginBottom: 10,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginBottom: 12,
  },
  timeField: {
    flex: 1,
  },
  timeFieldLabel: {
    fontSize: 11,
    color: Colors.muted,
    marginBottom: 4,
  },
  timePicker: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  timeValue: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.primary,
  },
  timeDash: {
    fontSize: 16,
    color: Colors.muted,
    paddingBottom: 10,
  },
  timeChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  timeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  timeChipActive: {
    backgroundColor: Colors.caramelLight,
    borderColor: Colors.accent,
  },
  timeChipText: {
    fontSize: 12,
    fontWeight: "500",
    color: Colors.muted,
  },
  timeChipTextActive: {
    color: Colors.primary,
    fontWeight: "600",
  },
});
