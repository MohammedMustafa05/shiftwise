import { useMemo, useRef, useState } from "react";
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = {
  background: "#F0F4FF",
  surface: "#FFFFFF",
  primary: "#4F46E5",
  textPrimary: "#0F172A",
  textMuted: "#94A3B8",
  textSecondary: "#64748B",
  border: "#E2E8F0",
  textLight: "#FFFFFF",
  inputBg: "#F8FAFC",
  warning: "#F59E0B",
  verified: "#10B981",
  verifiedBg: "#F0FDF4",
  verifiedBorder: "#BBF7D0",
};

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

type DayConfig = {
  key: DayKey;
  label: string;
  from: string;
  to: string;
  managerApproved: boolean;
  confirmed: boolean;
};

const INITIAL_DAYS: DayConfig[] = [
  {
    key: "mon",
    label: "Monday",
    from: "8:00 AM",
    to: "4:00 PM",
    managerApproved: true,
    confirmed: true,
  },
  {
    key: "tue",
    label: "Tuesday",
    from: "8:00 AM",
    to: "4:00 PM",
    managerApproved: true,
    confirmed: true,
  },
  {
    key: "wed",
    label: "Wednesday",
    from: "9:00 AM",
    to: "5:00 PM",
    managerApproved: true,
    confirmed: true,
  },
  {
    key: "thu",
    label: "Thursday",
    from: "8:00 AM",
    to: "4:00 PM",
    managerApproved: false,
    confirmed: false,
  },
  {
    key: "fri",
    label: "Friday",
    from: "8:00 AM",
    to: "3:00 PM",
    managerApproved: false,
    confirmed: false,
  },
  {
    key: "sat",
    label: "Saturday",
    from: "10:00 AM",
    to: "2:00 PM",
    managerApproved: false,
    confirmed: false,
  },
  {
    key: "sun",
    label: "Sunday",
    from: "10:00 AM",
    to: "2:00 PM",
    managerApproved: false,
    confirmed: false,
  },
];

const VERIFICATION_NOTE =
  "Your hours will be verified by your manager before being confirmed.";

const TIME_OPTIONS = (() => {
  const opts: string[] = [];
  for (let h = 6; h <= 23; h++) {
    for (const m of [0, 30]) {
      if (h === 23 && m === 30) continue;
      const period = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      opts.push(`${h12}:${m === 0 ? "00" : "30"} ${period}`);
    }
  }
  return opts;
})();

const ITEM_H = 44;

export default function AvailabilityScreen() {
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<DayConfig[]>(INITIAL_DAYS);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerDay, setPickerDay] = useState<DayKey | null>(null);
  const [pickerField, setPickerField] = useState<"from" | "to">("from");
  const [pickerValue, setPickerValue] = useState(TIME_OPTIONS[4]);
  const wheelRef = useRef<ScrollView>(null);

  const pickerIndex = useMemo(
    () => Math.max(0, TIME_OPTIONS.indexOf(pickerValue)),
    [pickerValue],
  );

  const openPicker = (dayKey: DayKey, field: "from" | "to", current: string) => {
    setPickerDay(dayKey);
    setPickerField(field);
    setPickerValue(current);
    setPickerVisible(true);
    setTimeout(() => {
      wheelRef.current?.scrollTo({ y: pickerIndex * ITEM_H, animated: false });
    }, 50);
  };

  const confirmPicker = () => {
    if (!pickerDay) return;
    setDays((prev) =>
      prev.map((d) =>
        d.key === pickerDay ? { ...d, [pickerField]: pickerValue } : d,
      ),
    );
    setPickerVisible(false);
  };

  const onWheelScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
    const clamped = Math.max(0, Math.min(TIME_OPTIONS.length - 1, idx));
    setPickerValue(TIME_OPTIONS[clamped]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Set Availability</Text>
        <Text style={styles.subtitle}>Set your preferred working hours</Text>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 88 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {days.map((day) => (
          <View key={day.key} style={styles.card}>
            <Text style={styles.dayName}>{day.label}</Text>

            <View style={styles.timeRow}>
              <View style={styles.timeField}>
                <Text style={styles.timeLabel}>From</Text>
                <Pressable
                  style={styles.timeBox}
                  onPress={() => openPicker(day.key, "from", day.from)}
                >
                  <Feather name="clock" size={16} color={C.textMuted} />
                  <Text style={styles.timeText}>{day.from}</Text>
                </Pressable>
              </View>
              <View style={styles.timeField}>
                <Text style={styles.timeLabel}>To</Text>
                <Pressable
                  style={styles.timeBox}
                  onPress={() => openPicker(day.key, "to", day.to)}
                >
                  <Feather name="clock" size={16} color={C.textMuted} />
                  <Text style={styles.timeText}>{day.to}</Text>
                </Pressable>
              </View>
            </View>

            <Text style={styles.verifyNote}>{VERIFICATION_NOTE}</Text>

            <View
              style={[
                styles.verifyRow,
                day.managerApproved && styles.verifyRowVerified,
              ]}
            >
              {day.managerApproved ? (
                <>
                  <Feather name="check-circle" size={18} color={C.verified} />
                  <Text style={styles.verifiedLabel}>Verified</Text>
                </>
              ) : (
                <>
                  <Feather name="clock" size={18} color={C.textMuted} />
                  <Text style={styles.pendingLabel}>Pending</Text>
                </>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable style={styles.continueBtn}>
          <Text style={styles.continueText}>Continue</Text>
        </Pressable>
      </View>

      <Modal visible={pickerVisible} transparent animationType="slide">
        <Pressable style={styles.sheetBackdrop} onPress={() => setPickerVisible(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Select time</Text>
            <View style={styles.wheelWrap}>
              <View style={styles.wheelHighlight} pointerEvents="none" />
              <ScrollView
                ref={wheelRef}
                showsVerticalScrollIndicator={false}
                snapToInterval={ITEM_H}
                decelerationRate="fast"
                onMomentumScrollEnd={onWheelScroll}
                onScrollEndDrag={onWheelScroll}
                contentContainerStyle={{
                  paddingVertical: ITEM_H * 2,
                }}
              >
                {TIME_OPTIONS.map((time) => (
                  <View key={time} style={styles.wheelItem}>
                    <Text
                      style={[
                        styles.wheelText,
                        time === pickerValue && styles.wheelTextActive,
                      ]}
                    >
                      {time}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>
            <Pressable style={styles.confirmBtn} onPress={confirmPicker}>
              <Text style={styles.confirmText}>Confirm</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
    alignItems: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: C.textPrimary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: C.textMuted,
    marginTop: 6,
    textAlign: "center",
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
  },
  dayName: {
    fontSize: 16,
    fontWeight: "700",
    color: C.textPrimary,
    marginBottom: 12,
  },
  timeRow: {
    flexDirection: "row",
    gap: 12,
  },
  timeField: {
    flex: 1,
  },
  timeLabel: {
    fontSize: 12,
    color: C.textMuted,
    marginBottom: 6,
    fontWeight: "500",
  },
  timeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  timeText: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  verifyNote: {
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 17,
    marginTop: 12,
  },
  verifyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    paddingBottom: 4,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
    borderRadius: 8,
  },
  verifyRowVerified: {
    backgroundColor: C.verifiedBg,
    borderTopColor: C.verifiedBorder,
    marginHorizontal: -4,
    paddingHorizontal: 14,
  },
  verifiedLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: C.verified,
  },
  pendingLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textMuted,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: C.background,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  continueBtn: {
    backgroundColor: C.primary,
    borderRadius: 28,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  continueText: {
    color: C.textLight,
    fontSize: 16,
    fontWeight: "600",
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 28,
    paddingHorizontal: 20,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: C.textPrimary,
    textAlign: "center",
    marginBottom: 12,
  },
  wheelWrap: {
    height: ITEM_H * 5,
    position: "relative",
    marginBottom: 16,
  },
  wheelHighlight: {
    position: "absolute",
    top: ITEM_H * 2,
    left: 0,
    right: 0,
    height: ITEM_H,
    borderRadius: 10,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: C.border,
  },
  wheelItem: {
    height: ITEM_H,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelText: {
    fontSize: 18,
    color: C.textMuted,
  },
  wheelTextActive: {
    color: C.primary,
    fontWeight: "700",
  },
  confirmBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmText: {
    color: C.textLight,
    fontSize: 16,
    fontWeight: "600",
  },
});
