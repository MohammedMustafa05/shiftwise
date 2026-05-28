import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { API_BASE } from "../../lib/api";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../lib/api";
import { format24hTo12h, parse12hTo24h } from "../../lib/time";

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
  enabled: boolean;
  from: string;
  to: string;
  managerApproved: boolean;
  confirmed: boolean;
};

const DAY_KEY_TO_DOW: Record<DayKey, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

const INITIAL_DAYS: DayConfig[] = [
  {
    key: "mon",
    label: "Monday",
    enabled: true,
    from: "8:00 AM",
    to: "4:00 PM",
    managerApproved: true,
    confirmed: true,
  },
  {
    key: "tue",
    label: "Tuesday",
    enabled: true,
    from: "8:00 AM",
    to: "4:00 PM",
    managerApproved: true,
    confirmed: true,
  },
  {
    key: "wed",
    label: "Wednesday",
    enabled: true,
    from: "9:00 AM",
    to: "5:00 PM",
    managerApproved: true,
    confirmed: true,
  },
  {
    key: "thu",
    label: "Thursday",
    enabled: true,
    from: "8:00 AM",
    to: "4:00 PM",
    managerApproved: false,
    confirmed: false,
  },
  {
    key: "fri",
    label: "Friday",
    enabled: true,
    from: "8:00 AM",
    to: "3:00 PM",
    managerApproved: false,
    confirmed: false,
  },
  {
    key: "sat",
    label: "Saturday",
    enabled: true,
    from: "10:00 AM",
    to: "2:00 PM",
    managerApproved: false,
    confirmed: false,
  },
  {
    key: "sun",
    label: "Sunday",
    enabled: true,
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

function findTimeIndex(time: string): number {
  const exact = TIME_OPTIONS.indexOf(time);
  if (exact >= 0) return exact;

  const toMinutes = (t: string) => {
    const parts = t.trim().split(/\s+/);
    const period = parts[parts.length - 1]?.toUpperCase();
    const [hStr, mStr] = (parts[0] ?? "8:00").split(":");
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr ?? "0", 10);
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h * 60 + m;
  };

  const target = toMinutes(time);
  let best = 0;
  let bestDiff = Infinity;
  TIME_OPTIONS.forEach((opt, i) => {
    const diff = Math.abs(toMinutes(opt) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

export default function AvailabilityScreen() {
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<DayConfig[]>(INITIAL_DAYS);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerDay, setPickerDay] = useState<DayKey | null>(null);
  const [pickerField, setPickerField] = useState<"from" | "to">("from");
  const [pickerValue, setPickerValue] = useState(TIME_OPTIONS[4]);
  const wheelRef = useRef<ScrollView>(null);

  const openPicker = (dayKey: DayKey, field: "from" | "to", current: string) => {
    const idx = findTimeIndex(current);
    const normalized = TIME_OPTIONS[idx] ?? current;
    setPickerDay(dayKey);
    setPickerField(field);
    setPickerValue(normalized);
    setPickerVisible(true);
  };

  const toggleDay = (dayKey: DayKey, enabled: boolean) => {
    setDays((prev) =>
      prev.map((d) =>
        d.key === dayKey ? { ...d, enabled, managerApproved: false, confirmed: false } : d,
      ),
    );
  };

  useEffect(() => {
    if (!pickerVisible) return;
    const idx = findTimeIndex(pickerValue);
    const timer = setTimeout(() => {
      wheelRef.current?.scrollTo({ y: idx * ITEM_H, animated: false });
    }, 80);
    return () => clearTimeout(timer);
  }, [pickerVisible, pickerValue]);

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

  useEffect(() => {
    void api
      .getAvailability()
      .then((rows) => {
        if (rows.length === 0) return;
        setDays(
          (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as DayKey[]).map((key) => {
            const dow = DAY_KEY_TO_DOW[key];
            const row = rows.find((r) => r.dayOfWeek === dow);
            return {
              key,
              label: DAY_LABELS[key],
              enabled: Boolean(row),
              from: row ? format24hTo12h(row.from) : "8:00 AM",
              to: row ? format24hTo12h(row.to) : "4:00 PM",
              managerApproved: row?.managerApproved ?? false,
              confirmed: row?.confirmed ?? false,
            };
          }),
        );
      })
      .catch((e) => {
        Alert.alert(
          "Could not load availability",
          e instanceof Error ? e.message : `Check that the API is running (${API_BASE})`,
        );
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleContinue() {
    setSaving(true);
    try {
      const blocks = days
        .filter((d) => d.enabled)
        .map((d) => ({
        dayOfWeek: DAY_KEY_TO_DOW[d.key],
        startTime: parse12hTo24h(d.from),
        endTime: parse12hTo24h(d.to),
        }));
      await api.saveAvailability(blocks);
      Alert.alert(
        "Availability submitted",
        "Your manager will review and confirm your hours.",
      );
      setDays((prev) =>
        prev.map((d) => ({ ...d, managerApproved: false, confirmed: false })),
      );
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Try again");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

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
            <View style={styles.dayHeader}>
              <Text style={styles.dayName}>{day.label}</Text>
              <View style={styles.toggleWrap}>
                <Text style={styles.toggleText}>{day.enabled ? "Available" : "Off"}</Text>
                <Switch
                  value={day.enabled}
                  onValueChange={(next) => toggleDay(day.key, next)}
                  trackColor={{ false: "#CBD5E1", true: "#A5B4FC" }}
                  thumbColor={day.enabled ? C.primary : "#F8FAFC"}
                />
              </View>
            </View>

            <View style={styles.timeRow}>
              <View style={styles.timeField}>
                <Text style={styles.timeLabel}>From</Text>
                <Pressable
                  style={[styles.timeBox, !day.enabled && styles.timeBoxDisabled]}
                  onPress={() => openPicker(day.key, "from", day.from)}
                  disabled={!day.enabled}
                >
                  <Feather name="clock" size={16} color={C.textMuted} />
                  <Text style={[styles.timeText, !day.enabled && styles.timeTextDisabled]}>
                    {day.from}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.timeField}>
                <Text style={styles.timeLabel}>To</Text>
                <Pressable
                  style={[styles.timeBox, !day.enabled && styles.timeBoxDisabled]}
                  onPress={() => openPicker(day.key, "to", day.to)}
                  disabled={!day.enabled}
                >
                  <Feather name="clock" size={16} color={C.textMuted} />
                  <Text style={[styles.timeText, !day.enabled && styles.timeTextDisabled]}>
                    {day.to}
                  </Text>
                </Pressable>
              </View>
            </View>

            <Text style={styles.verifyNote}>{VERIFICATION_NOTE}</Text>

            {!day.enabled ? (
              <View style={styles.verifyRow}>
                <>
                  <Feather name="slash" size={18} color={C.textMuted} />
                  <Text style={styles.pendingLabel}>Day off</Text>
                </>
              </View>
            ) : (
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
            )}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={[styles.continueBtn, saving && { opacity: 0.7 }]}
          onPress={handleContinue}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={C.textLight} />
          ) : (
            <Text style={styles.continueText}>Continue</Text>
          )}
        </Pressable>
      </View>

      <Modal visible={pickerVisible} transparent animationType="slide">
        <View style={styles.sheetBackdrop}>
          <Pressable style={styles.sheetDismiss} onPress={() => setPickerVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Select time</Text>
            <View style={styles.wheelWrap}>
              <View style={styles.wheelHighlight} pointerEvents="none" />
              <ScrollView
                ref={wheelRef}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                snapToInterval={ITEM_H}
                snapToAlignment="start"
                decelerationRate="fast"
                scrollEventThrottle={16}
                onMomentumScrollEnd={onWheelScroll}
                onScrollEndDrag={onWheelScroll}
                contentContainerStyle={{
                  paddingVertical: ITEM_H * 2,
                }}
              >
                {TIME_OPTIONS.map((time) => (
                  <Pressable
                    key={time}
                    style={styles.wheelItem}
                    onPress={() => {
                      const idx = findTimeIndex(time);
                      setPickerValue(time);
                      wheelRef.current?.scrollTo({ y: idx * ITEM_H, animated: true });
                    }}
                  >
                    <Text
                      style={[
                        styles.wheelText,
                        time === pickerValue && styles.wheelTextActive,
                      ]}
                    >
                      {time}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <Pressable style={styles.confirmBtn} onPress={confirmPicker}>
              <Text style={styles.confirmText}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  dayName: {
    fontSize: 16,
    fontWeight: "700",
    color: C.textPrimary,
  },
  toggleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.textMuted,
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
  timeBoxDisabled: {
    opacity: 0.55,
  },
  timeText: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  timeTextDisabled: {
    color: C.textSecondary,
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
  sheetDismiss: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 28,
    paddingHorizontal: 20,
    zIndex: 1,
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
