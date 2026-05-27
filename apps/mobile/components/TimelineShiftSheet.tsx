import { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  Colors,
  getRoleColor,
} from "../constants/colors";
import { formatTimeRange } from "../utils/time";
import type { TimelineShift } from "../constants/dummyData";

type TimelineShiftSheetProps = {
  visible: boolean;
  shift: TimelineShift | null;
  dayLabel: string;
  onClose: () => void;
};

export default function TimelineShiftSheet({
  visible,
  shift,
  dayLabel,
  onClose,
}: TimelineShiftSheetProps) {
  const slideAnim = useRef(new Animated.Value(400)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : 400,
      useNativeDriver: true,
      damping: 22,
      stiffness: 220,
    }).start();
  }, [visible, slideAnim]);

  if (!shift) return null;

  const roleColor = getRoleColor(shift.role);
  const duration = shift.endHour - shift.startHour;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()}>
          <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
            <View style={styles.handle} />
            <View style={styles.avatarRow}>
              <View style={[styles.avatar, { backgroundColor: roleColor }]}>
                <Text style={styles.initials}>{shift.initials}</Text>
              </View>
              <View style={styles.nameCol}>
                <Text style={styles.name}>{shift.employeeName}</Text>
                <Text style={styles.role}>{shift.role}</Text>
              </View>
            </View>

            <Text style={styles.dayText}>{dayLabel}</Text>
            <Text style={styles.timeRange}>
              {formatTimeRange(shift.startHour, shift.endHour)}
            </Text>
            <Text style={styles.duration}>Duration: {duration} hrs</Text>

            <View style={styles.locationRow}>
              <Feather name="map-pin" size={16} color={Colors.textMuted} />
              <Text style={styles.location}>{shift.location}</Text>
            </View>

            <Text style={styles.hint}>Swipe down to dismiss</Text>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 24,
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 20,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.textLight,
  },
  nameCol: {
    flex: 1,
  },
  name: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  role: {
    fontSize: 15,
    color: Colors.textMuted,
    marginTop: 4,
  },
  dayText: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  timeRange: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  duration: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  location: {
    fontSize: 15,
    color: Colors.textPrimary,
  },
  hint: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: 24,
  },
});
