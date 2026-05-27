import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors } from "../constants/colors";
import type { Shift } from "../constants/dummyData";

type ShiftCardProps = {
  shift: Shift;
};

export default function ShiftCard({ shift }: ShiftCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.accent} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.name}>{shift.name}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{shift.role}</Text>
          </View>
        </View>
        <View style={styles.detailRow}>
          <Feather name="clock" size={14} color={Colors.textMuted} />
          <Text style={styles.detailText}>
            {shift.startTime}–{shift.endTime}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Feather name="map-pin" size={14} color={Colors.textMuted} />
          <Text style={styles.detailText}>{shift.location}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    marginBottom: 12,
  },
  accent: {
    width: 4,
    backgroundColor: Colors.primary,
  },
  body: {
    flex: 1,
    padding: 16,
    gap: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  badge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.secondary,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  detailText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
});
