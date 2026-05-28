import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../constants/colors";
import { api } from "../lib/api";
import {
  formatDateYmd,
  formatRoleLabel,
  formatShiftDateLabel,
  formatShiftTimeRange,
  getMondayForOffset,
  shiftDurationLabel,
} from "../lib/time";

type ShiftOption = {
  id: string;
  name: string;
  date: string;
  time: string;
  duration: string;
};

function shiftDisplayName(role: string, startTime: string): string {
  const hour = parseInt(startTime.slice(0, 2), 10);
  const label = formatRoleLabel(role);
  if (hour < 12) return `${label} · Morning`;
  if (hour < 17) return `${label} · Afternoon`;
  return `${label} · Evening`;
}

export default function OfferShiftScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [posted, setPosted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [myRole, setMyRole] = useState("");

  const loadShifts = useCallback(async () => {
    setLoading(true);
    try {
      const weekStart = formatDateYmd(getMondayForOffset(0));
      const [me, schedule] = await Promise.all([api.getMe(), api.getMySchedule(weekStart)]);
      setMyRole(formatRoleLabel(me.role));
      setShifts(
        schedule.shifts.map((s) => ({
          id: s.id,
          name: shiftDisplayName(s.role, s.startTime),
          date: formatShiftDateLabel(s.shiftDate),
          time: formatShiftTimeRange(s.startTime, s.endTime),
          duration: shiftDurationLabel(s.startTime, s.endTime),
        })),
      );
    } catch (e) {
      Alert.alert(
        "Could not load shifts",
        e instanceof Error ? e.message : "Publish a schedule first to offer shifts.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  const onPost = async () => {
    if (!selected || posting) return;
    setPosting(true);
    try {
      await api.postOpenShift(selected, note.trim() || undefined);
      setPosted(true);
      setTimeout(() => router.back(), 2000);
    } catch (e) {
      Alert.alert("Post failed", e instanceof Error ? e.message : "Please try again");
    } finally {
      setPosting(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Offer Shift to Team</Text>
          <Text style={styles.sub}>Post a shift for your team to claim</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 92 }]}>
          <Text style={styles.sectionTitle}>Which shift do you want to offer?</Text>
          <View style={{ gap: 8 }}>
            {shifts.length === 0 ? (
              <Text style={styles.emptyHint}>
                No published shifts this week. Ask your manager to publish the schedule first.
              </Text>
            ) : (
              shifts.map((shift) => (
                <Pressable
                  key={shift.id}
                  style={[styles.shiftCard, selected === shift.id && styles.shiftCardSelected]}
                  onPress={() => setSelected(shift.id)}
                >
                  <View style={styles.bar} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shiftName}>{shift.name}</Text>
                    <Text style={styles.shiftMeta}>{shift.date}</Text>
                    <Text style={styles.shiftMeta}>{shift.time}</Text>
                  </View>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{shift.duration}</Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>

          <View style={styles.infoBanner}>
            <Feather name="info" size={16} color={Colors.primary} />
            <Text style={styles.infoText}>
              This shift will be visible to all {myRole || "matching role"} coworkers on your team.
              First to claim gets the shift.
            </Text>
          </View>

          <Text style={styles.noteLabel}>Add a note (optional)</Text>
          <TextInput
            style={styles.noteInput}
            placeholder="e.g. Can't make it, family emergency"
            placeholderTextColor={Colors.textMuted}
            value={note}
            onChangeText={setNote}
          />

          {posted ? (
            <View style={styles.successCard}>
              <Feather name="check-circle" size={36} color={Colors.success} />
              <Text style={styles.successTitle}>Shift Posted!</Text>
              <Text style={styles.successSub}>Your team can now claim this shift</Text>
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 8 }} />
            </View>
          ) : null}
        </ScrollView>
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={[styles.btn, (!selected || posted || posting || shifts.length === 0) && styles.btnDisabled]}
          onPress={() => void onPost()}
          disabled={!selected || posted || posting || shifts.length === 0}
        >
          {posting ? (
            <ActivityIndicator color={Colors.textLight} />
          ) : (
            <Text style={styles.btnText}>Post Shift</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  title: { fontSize: 18, fontWeight: "700", color: Colors.textPrimary },
  sub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  content: { padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: Colors.textPrimary, marginBottom: 10 },
  emptyHint: { fontSize: 14, color: Colors.textMuted, lineHeight: 20 },
  shiftCard: { flexDirection: "row", gap: 12, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 14, alignItems: "center" },
  shiftCardSelected: { borderColor: Colors.primary },
  bar: { width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: Colors.primary },
  shiftName: { fontSize: 15, fontWeight: "700", color: Colors.textPrimary },
  shiftMeta: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  badge: { backgroundColor: Colors.primaryLight, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  badgeText: { fontSize: 11, color: Colors.primary, fontWeight: "700" },
  infoBanner: { marginTop: 14, borderRadius: 10, backgroundColor: Colors.primaryLight, padding: 12, flexDirection: "row", gap: 8 },
  infoText: { flex: 1, fontSize: 12, lineHeight: 18, color: Colors.primary },
  noteLabel: { fontSize: 13, color: Colors.textSecondary, fontWeight: "600", marginTop: 16, marginBottom: 8 },
  noteInput: { height: 46, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, paddingHorizontal: 12, color: Colors.textPrimary, fontSize: 14 },
  successCard: { marginTop: 16, backgroundColor: Colors.surface, borderWidth: 1, borderColor: "#86EFAC", borderRadius: 14, padding: 16, alignItems: "center" },
  successTitle: { marginTop: 6, fontSize: 18, fontWeight: "700", color: Colors.success },
  successSub: { marginTop: 4, fontSize: 13, color: Colors.textMuted },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border, paddingHorizontal: 16, paddingTop: 12 },
  btn: { height: 50, borderRadius: 12, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: Colors.textLight, fontSize: 16, fontWeight: "600" },
});
