import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../constants/colors";
import { api } from "../lib/api";
import {
  formatRoleLabel,
  formatShiftDateLabel,
  formatShiftTimeRange,
  shiftDurationLabel,
  timeAgo,
} from "../lib/time";

type OpenShift = Awaited<ReturnType<typeof api.getOpenShifts>>[number];

function shiftDisplayName(role: string, startTime: string): string {
  const hour = parseInt(startTime.slice(0, 2), 10);
  if (hour < 12) return "Morning Shift";
  if (hour < 17) return "Afternoon Shift";
  return "Evening Shift";
}

export default function OpenShiftsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<OpenShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState("");
  const [confirming, setConfirming] = useState<OpenShift | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [me, rows] = await Promise.all([api.getMe(), api.getOpenShifts()]);
      setMyRole(formatRoleLabel(me.role));
      setItems(rows);
    } catch (e) {
      Alert.alert("Could not load open shifts", e instanceof Error ? e.message : "Please try again");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const claim = async () => {
    if (!confirming || claiming) return;
    setClaiming(true);
    try {
      await api.claimOpenShift(confirming.id);
      setClaimed(true);
      setTimeout(() => {
        setItems((prev) => prev.filter((p) => p.id !== confirming.id));
        setConfirming(null);
        setClaimed(false);
      }, 1200);
    } catch (e) {
      Alert.alert("Claim failed", e instanceof Error ? e.message : "Please try again");
      setConfirming(null);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Open Shifts</Text>
          <Text style={styles.subtitle}>Shifts available for your role</Text>
        </View>
        <View style={styles.rolePill}>
          <Text style={styles.rolePillText}>{myRole || "—"}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="clock" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No open shifts right now</Text>
          <Text style={styles.emptySub}>Check back later or ask your manager</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {items.map((shift) => (
            <View key={shift.id} style={styles.card}>
              <View style={styles.bar} />
              <View style={{ flex: 1 }}>
                <View style={styles.topRow}>
                  <Text style={styles.openLabel}>OPEN SHIFT</Text>
                  <Text style={styles.postedAgo}>{timeAgo(shift.createdAt)}</Text>
                </View>
                <Text style={styles.shiftName}>{shiftDisplayName(shift.role, shift.startTime)}</Text>
                <Text style={styles.rowMeta}>📅 {formatShiftDateLabel(shift.shiftDate)}</Text>
                <Text style={styles.rowMeta}>🕒 {formatShiftTimeRange(shift.startTime, shift.endTime)}</Text>
                <View style={styles.durationPill}>
                  <Text style={styles.durationText}>
                    {shiftDurationLabel(shift.startTime, shift.endTime)}
                  </Text>
                </View>
                <View style={styles.divider} />
                <Text style={styles.postedBy}>Posted by {shift.postedByName}</Text>
                {shift.note ? <Text style={styles.note}>"{shift.note}"</Text> : null}
                <Pressable style={styles.claimBtn} onPress={() => setConfirming(shift)}>
                  <Text style={styles.claimBtnText}>Claim Shift</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={Boolean(confirming)} transparent animationType="slide">
        <View style={styles.sheetBackdrop}>
          <Pressable style={styles.sheetFill} onPress={() => !claimed && !claiming && setConfirming(null)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            {!claimed ? (
              <>
                <Text style={styles.sheetTitle}>Claim this shift?</Text>
                <Text style={styles.sheetMeta}>
                  {confirming
                    ? `${shiftDisplayName(confirming.role, confirming.startTime)} · ${formatShiftDateLabel(confirming.shiftDate)} · ${formatShiftTimeRange(confirming.startTime, confirming.endTime)}`
                    : ""}
                </Text>
                <Text style={styles.sheetHelp}>
                  By claiming this shift you are committing to work this time slot
                </Text>
                <View style={styles.sheetActions}>
                  <Pressable style={styles.cancelBtn} onPress={() => setConfirming(null)} disabled={claiming}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.yesBtn} onPress={() => void claim()} disabled={claiming}>
                    {claiming ? (
                      <ActivityIndicator color={Colors.textLight} />
                    ) : (
                      <Text style={styles.yesText}>Yes, Claim It</Text>
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.claimedWrap}>
                <Feather name="check-circle" size={34} color={Colors.success} />
                <Text style={styles.claimedTitle}>Shift claimed!</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  topBar: { paddingHorizontal: 16 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: 4, marginBottom: 12, paddingHorizontal: 16 },
  title: { fontSize: 26, fontWeight: "700", color: Colors.textPrimary },
  subtitle: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  rolePill: { backgroundColor: Colors.primaryLight, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  rolePillText: { color: Colors.primary, fontWeight: "700", fontSize: 12 },
  content: { gap: 10, paddingHorizontal: 16, paddingBottom: 20 },
  card: { flexDirection: "row", gap: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, borderRadius: 16, padding: 14 },
  bar: { width: 4, borderRadius: 2, backgroundColor: Colors.primary },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  openLabel: { fontSize: 11, color: Colors.primary, fontWeight: "700", letterSpacing: 0.8 },
  postedAgo: { fontSize: 11, color: Colors.textMuted },
  shiftName: { marginTop: 6, fontSize: 20, fontWeight: "700", color: Colors.textPrimary },
  rowMeta: { marginTop: 4, fontSize: 14, color: Colors.textSecondary },
  durationPill: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: Colors.primaryLight },
  durationText: { color: Colors.primary, fontSize: 11, fontWeight: "700" },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 10 },
  postedBy: { fontSize: 12, color: Colors.textMuted },
  note: { marginTop: 4, fontSize: 12, color: Colors.textSecondary, fontStyle: "italic" },
  claimBtn: { marginTop: 10, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: Colors.primary },
  claimBtnText: { color: Colors.textLight, fontWeight: "700", fontSize: 14 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: Colors.textPrimary },
  emptySub: { fontSize: 13, color: Colors.textMuted, textAlign: "center" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.35)", justifyContent: "flex-end" },
  sheetFill: { ...StyleSheet.absoluteFillObject },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderTopWidth: 1, borderTopColor: Colors.border },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: Colors.textPrimary },
  sheetMeta: { marginTop: 8, fontSize: 14, color: Colors.textSecondary },
  sheetHelp: { marginTop: 8, fontSize: 12, lineHeight: 18, color: Colors.textMuted },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, height: 46, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 14, fontWeight: "600", color: Colors.textPrimary },
  yesBtn: { flex: 1, height: 46, borderRadius: 10, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  yesText: { fontSize: 14, fontWeight: "700", color: Colors.textLight },
  claimedWrap: { alignItems: "center", paddingVertical: 8 },
  claimedTitle: { marginTop: 8, fontSize: 18, fontWeight: "700", color: Colors.success },
});
