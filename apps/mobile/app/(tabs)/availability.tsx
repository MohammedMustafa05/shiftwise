import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../lib/api";
import { getStoredUser } from "../../lib/api";
import { useEmployeeRealtime } from "../../lib/useEmployeeRealtime";

const C = {
  background: "#F0F4FF",
  surface: "#FFFFFF",
  primary: "#4F46E5",
  primaryTint: "rgba(79, 70, 229, 0.08)",
  textPrimary: "#0F172A",
  textMuted: "#94A3B8",
  textSecondary: "#64748B",
  border: "#E2E8F0",
  textLight: "#FFFFFF",
};

type BlockKey = "morning" | "evening" | "full";

type BlockDef = { key: BlockKey; label: string; time: string; hours: number };

const WEEK_ORDER = [
  { dow: 1, label: "Monday" },
  { dow: 2, label: "Tuesday" },
  { dow: 3, label: "Wednesday" },
  { dow: 4, label: "Thursday" },
  { dow: 5, label: "Friday" },
  { dow: 6, label: "Saturday" },
  { dow: 0, label: "Sunday" },
];

function blocksForDay(dow: number): BlockDef[] {
  if (dow === 5 || dow === 6) {
    return [
      { key: "morning", label: "Morning", time: "10:00 AM – 5:00 PM", hours: 7 },
      { key: "evening", label: "Evening", time: "5:00 PM – 12:00 AM", hours: 7 },
      { key: "full", label: "Full Day", time: "10:00 AM – 12:00 AM", hours: 14 },
    ];
  }
  return [
    { key: "morning", label: "Morning", time: "10:00 AM – 4:00 PM", hours: 6 },
    { key: "evening", label: "Evening", time: "4:00 PM – 10:00 PM", hours: 6 },
    { key: "full", label: "Full Day", time: "10:00 AM – 10:00 PM", hours: 12 },
  ];
}

function blockTimes(dow: number, key: BlockKey) {
  if (dow === 5 || dow === 6) {
    if (key === "morning") return { startTime: "10:00", endTime: "17:00" };
    if (key === "evening") return { startTime: "17:00", endTime: "00:00" };
    return { startTime: "10:00", endTime: "00:00" };
  }
  if (key === "morning") return { startTime: "10:00", endTime: "16:00" };
  if (key === "evening") return { startTime: "16:00", endTime: "22:00" };
  return { startTime: "10:00", endTime: "22:00" };
}

export default function AvailabilityScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Record<number, BlockKey>>({});
  const [dayOff, setDayOff] = useState<Record<number, boolean>>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [verified, setVerified] = useState(false);
  const [userId, setUserId] = useState<string | undefined>();
  const [workplaceId, setWorkplaceId] = useState<string | undefined>();

  useEffect(() => {
    void getStoredUser().then((u) => {
      setUserId(u?.id ?? undefined);
      setWorkplaceId(u?.workplaceId ?? undefined);
    });
  }, []);

  const load = () => {
    void api
      .getAvailability()
      .then((rows) => {
        const next: Record<number, BlockKey> = {};
        const off: Record<number, boolean> = {};
        for (const row of rows) {
          if (row.block === "off") {
            off[row.dayOfWeek] = true;
          } else if (row.block) {
            next[row.dayOfWeek] = row.block as BlockKey;
          }
        }
        setSelected(next);
        setDayOff(off);
        if (rows.length > 0) {
          setHasSubmitted(true);
          setVerified(Boolean(rows[0]?.confirmed) && Boolean(rows[0]?.managerApproved));
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEmployeeRealtime({
    userId,
    workplaceId,
    onAvailabilityChange: () => load(),
  });

  const totalHours = useMemo(() => {
    return Object.entries(selected).reduce((sum, [dow, key]) => {
      const def = blocksForDay(Number(dow)).find((b) => b.key === key);
      return sum + (def?.hours ?? 0);
    }, 0);
  }, [selected]);

  const toggleBlock = (dow: number, key: BlockKey) => {
    setSelected((prev) => {
      if (prev[dow] === key) {
        const copy = { ...prev };
        delete copy[dow];
        return copy;
      }
      return { ...prev, [dow]: key };
    });
  };

  const toggleDayOff = (dow: number) => {
    setDayOff((prev) => {
      const next = { ...prev, [dow]: !prev[dow] };
      if (next[dow]) {
        setSelected((sel) => {
          const copy = { ...sel };
          delete copy[dow];
          return copy;
        });
      }
      return next;
    });
  };

  const onContinue = async () => {
    if (totalHours < 24) {
      Alert.alert(
        "Minimum Availability Required",
        "You must select at least 24 hours of availability to continue. Please add more time blocks.",
        [{ text: "OK" }],
      );
      return;
    }
    setSaving(true);
    try {
      const blocks = Object.entries(selected).map(([dow, key]) => {
        const times = blockTimes(Number(dow), key);
        return {
          dayOfWeek: Number(dow),
          block: key,
          startTime: times.startTime,
          endTime: times.endTime,
        };
      });
      const offBlocks = Object.entries(dayOff)
        .filter(([, v]) => v)
        .map(([dow]) => ({
          dayOfWeek: Number(dow),
          block: "off",
          startTime: "00:00",
          endTime: "00:00",
        }));
      await api.saveAvailability([...blocks, ...offBlocks]);
      Alert.alert("Submitted", "Your availability has been sent to your manager.");
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not save availability");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>My Availability</Text>
        <Text style={styles.subtitle}>Select your available time blocks for each day</Text>

        {hasSubmitted ? (
          <View style={[styles.statusBadge, verified ? styles.statusVerified : styles.statusPending]}>
            <Feather
              name={verified ? "check-circle" : "clock"}
              size={14}
              color={verified ? "#10B981" : "#F59E0B"}
            />
            <Text style={[styles.statusText, verified ? styles.statusTextVerified : styles.statusTextPending]}>
              {verified ? "Verified" : "Pending Approval"}
            </Text>
          </View>
        ) : null}

        {WEEK_ORDER.map(({ dow, label }) => {
          const dayBlocks = blocksForDay(dow);
          const picked = selected[dow];
          const isOff = Boolean(dayOff[dow]);
          return (
            <View key={dow} style={styles.daySection}>
              <View style={styles.dayHeaderRow}>
                <Text style={styles.dayLabel}>{label}</Text>
                <Pressable
                  onPress={() => toggleDayOff(dow)}
                  style={[styles.offToggle, isOff && styles.offToggleActive]}
                >
                  <Text style={[styles.offToggleText, isOff && styles.offToggleTextActive]}>
                    Not Available
                  </Text>
                </Pressable>
              </View>
              {isOff ? <Text style={styles.dayOffLabel}>Day Off</Text> : null}
              {dayBlocks.map((block) => {
                const isSelected = picked === block.key;
                const disabled = isOff || (picked !== undefined && !isSelected);
                return (
                  <Pressable
                    key={block.key}
                    disabled={disabled}
                    onPress={() => toggleBlock(dow, block.key)}
                    style={[
                      styles.blockCard,
                      isSelected && styles.blockCardSelected,
                      disabled && styles.blockCardDisabled,
                    ]}
                  >
                    <View style={styles.blockText}>
                      <Text style={styles.blockName}>{block.label}</Text>
                      <Text style={styles.blockTime}>{block.time}</Text>
                    </View>
                    {isSelected ? (
                      <Feather name="check-circle" size={22} color={C.primary} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={[styles.continueBtn, saving && styles.continueBtnDisabled]}
          onPress={() => void onContinue()}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={C.textLight} />
          ) : (
            <Text style={styles.continueText}>Continue</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.background },
  content: { paddingHorizontal: 16 },
  title: { fontSize: 26, fontWeight: "700", color: C.textPrimary },
  subtitle: { fontSize: 14, color: C.textMuted, marginTop: 4, marginBottom: 20 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 14,
  },
  statusPending: {
    backgroundColor: "rgba(245, 158, 11, 0.10)",
    borderColor: "rgba(245, 158, 11, 0.25)",
  },
  statusVerified: {
    backgroundColor: "rgba(16, 185, 129, 0.10)",
    borderColor: "rgba(16, 185, 129, 0.25)",
  },
  statusText: { fontSize: 13, fontWeight: "700" },
  statusTextPending: { color: "#B45309" },
  statusTextVerified: { color: "#047857" },
  daySection: { marginBottom: 18 },
  dayHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  dayLabel: { fontSize: 15, fontWeight: "600", color: C.textPrimary, marginBottom: 8 },
  offToggle: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  offToggleActive: {
    borderColor: C.primary,
    backgroundColor: C.primaryTint,
  },
  offToggleText: { fontSize: 12, fontWeight: "700", color: C.textSecondary },
  offToggleTextActive: { color: C.primary },
  dayOffLabel: { fontSize: 13, color: C.textMuted, marginBottom: 10 },
  blockCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  blockCardSelected: {
    borderColor: C.primary,
    backgroundColor: C.primaryTint,
  },
  blockCardDisabled: { opacity: 0.4 },
  blockText: { flex: 1 },
  blockName: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  blockTime: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: C.background,
  },
  continueBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  continueBtnDisabled: { opacity: 0.7 },
  continueText: { color: C.textLight, fontSize: 16, fontWeight: "600" },
});
