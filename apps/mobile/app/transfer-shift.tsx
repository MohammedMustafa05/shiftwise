import { useCallback, useEffect, useMemo, useState } from "react";
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
import { api, getStoredUser } from "../lib/api";
import {
  formatDateYmd,
  formatRoleLabel,
  formatShiftDateLabel,
  formatShiftTimeRange,
  getMondayForOffset,
  shiftDurationLabel,
} from "../lib/time";

type Coworker = {
  id: string;
  name: string;
  role: string;
  availability: "available" | "limited";
};

type MyShift = {
  id: string;
  name: string;
  dateLabel: string;
  time: string;
  duration: string;
};

type TeamShift = {
  id: string;
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  role: string;
};

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function shiftDisplayName(role: string, startTime: string): string {
  const hour = parseInt(startTime.slice(0, 2), 10);
  if (hour < 12) return `${formatRoleLabel(role)} · Morning`;
  if (hour < 17) return `${formatRoleLabel(role)} · Afternoon`;
  return `${formatRoleLabel(role)} · Evening`;
}

export default function TransferShiftScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [selectedCoworkerId, setSelectedCoworkerId] = useState<string | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [selectedTargetShiftId, setSelectedTargetShiftId] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [coworkers, setCoworkers] = useState<Coworker[]>([]);
  const [myShifts, setMyShifts] = useState<MyShift[]>([]);
  const [teamShifts, setTeamShifts] = useState<TeamShift[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const weekStart = formatDateYmd(getMondayForOffset(0));
      const user = await getStoredUser();
      const [coworkerRows, schedule, team] = await Promise.all([
        api.getCoworkers(),
        api.getMySchedule(weekStart),
        user?.workplaceId
          ? api.getTeamSchedule(user.workplaceId, weekStart)
          : Promise.resolve([]),
      ]);

      const teamByEmployee = new Set(team.map((t) => t.employeeId));
      setCoworkers(
        coworkerRows.map((c) => ({
          id: c.id,
          name: c.name,
          role: formatRoleLabel(c.role),
          availability: teamByEmployee.has(c.id) ? "available" : "limited",
        })),
      );
      setMyShifts(
        schedule.shifts.map((s) => ({
          id: s.id,
          name: shiftDisplayName(s.role, s.startTime),
          dateLabel: formatShiftDateLabel(s.shiftDate),
          time: formatShiftTimeRange(s.startTime, s.endTime),
          duration: shiftDurationLabel(s.startTime, s.endTime),
        })),
      );
      setTeamShifts(team);
    } catch (e) {
      Alert.alert(
        "Could not load shifts",
        e instanceof Error ? e.message : "Check that a schedule is published for this week.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return coworkers;
    return coworkers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.role.toLowerCase().includes(q),
    );
  }, [query, coworkers]);

  const selectedCoworker = coworkers.find((c) => c.id === selectedCoworkerId);
  const coworkerShifts = useMemo(() => {
    if (!selectedCoworkerId) return [];
    return teamShifts
      .filter((s) => s.employeeId === selectedCoworkerId)
      .sort((a, b) => a.shiftDate.localeCompare(b.shiftDate) || a.startTime.localeCompare(b.startTime))
      .map((s) => ({
        id: s.id,
        name: shiftDisplayName(s.role, s.startTime),
        dateLabel: formatShiftDateLabel(s.shiftDate),
        time: formatShiftTimeRange(s.startTime, s.endTime),
        duration: shiftDurationLabel(s.startTime, s.endTime),
      }));
  }, [selectedCoworkerId, teamShifts]);

  const isSwap = coworkerShifts.length > 0;
  const canSend =
    Boolean(selectedShiftId) &&
    (!isSwap || Boolean(selectedTargetShiftId)) &&
    !sent &&
    !sending &&
    myShifts.length > 0;

  const sendRequest = async () => {
    if (!selectedCoworker || !selectedShiftId || sending || !canSend) return;
    setSending(true);
    try {
      await api.createTransfer(selectedShiftId, selectedCoworker.id, {
        targetShiftId: selectedTargetShiftId ?? undefined,
      });
      setSent(true);
      setTimeout(() => router.back(), 2000);
    } catch (e) {
      Alert.alert("Request failed", e instanceof Error ? e.message : "Please try again");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          style={styles.backBtn}
          onPress={() => {
            if (step === 2 && !sent) {
              setStep(1);
              setSelectedShiftId(null);
              setSelectedTargetShiftId(null);
              return;
            }
            router.back();
          }}
          hitSlop={8}
        >
          <Feather name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Transfer My Shift</Text>
          <Text style={styles.headerSub}>Switch your shift with a coworker</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.progressRow}>
            <View style={[styles.progressDot, step === 1 && styles.progressDotActive]} />
            <View style={[styles.progressDot, step === 2 && styles.progressDotActive]} />
            <Text style={styles.progressText}>Step {step} of 2</Text>
          </View>

          {step === 1 ? (
            <>
              <Text style={styles.sectionTitle}>Who do you want to switch with?</Text>

              <View style={styles.searchWrap}>
                <Feather name="search" size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search coworkers..."
                  placeholderTextColor={Colors.textMuted}
                  value={query}
                  onChangeText={setQuery}
                />
              </View>

              <View style={styles.section}>
                {filtered.length === 0 ? (
                  <Text style={styles.emptyHint}>No coworkers found</Text>
                ) : (
                  filtered.map((person) => {
                    const selected = selectedCoworkerId === person.id;
                    const available = person.availability === "available";
                    return (
                      <Pressable
                        key={person.id}
                        style={[styles.option, selected && styles.optionSelected]}
                        onPress={() => {
                          setSelectedCoworkerId(person.id);
                          setSelectedTargetShiftId(null);
                        }}
                      >
                        <View
                          style={[
                            styles.avatar,
                            { backgroundColor: available ? "#C7D2FE" : "#E2E8F0" },
                          ]}
                        >
                          <Text style={styles.avatarText}>{initials(person.name)}</Text>
                        </View>
                        <View style={styles.optionBody}>
                          <Text style={styles.optionTitle}>{person.name}</Text>
                          <Text style={styles.optionMeta}>{person.role}</Text>
                          <View style={styles.availabilityRow}>
                            <View
                              style={[
                                styles.availabilityDot,
                                {
                                  backgroundColor: available ? Colors.success : Colors.textMuted,
                                },
                              ]}
                            />
                            <Text style={styles.availabilityText}>
                              {available ? "Scheduled this week" : "Limited availability"}
                            </Text>
                          </View>
                        </View>
                        <View style={[styles.radio, selected && styles.radioSelected]}>
                          {selected && <View style={styles.radioInner} />}
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Which shift do you want to give?</Text>
              <View style={styles.section}>
                {myShifts.length === 0 ? (
                  <Text style={styles.emptyHint}>
                    No published shifts this week. Ask your manager to publish the schedule first.
                  </Text>
                ) : (
                  myShifts.map((shift) => {
                    const selected = selectedShiftId === shift.id;
                    return (
                      <Pressable
                        key={shift.id}
                        style={[styles.shiftCard, selected && styles.optionSelected]}
                        onPress={() => setSelectedShiftId(shift.id)}
                      >
                        <View style={styles.shiftBar} />
                        <View style={styles.optionBody}>
                          <Text style={styles.optionTitle}>{shift.name}</Text>
                          <Text style={styles.optionMeta}>{shift.dateLabel}</Text>
                          <Text style={styles.optionMeta}>{shift.time}</Text>
                        </View>
                        <View style={styles.durationPill}>
                          <Text style={styles.durationText}>{shift.duration}</Text>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </View>
              {selectedCoworker && coworkerShifts.length > 0 ? (
                <>
                  <Text style={styles.sectionSubTitle}>
                    {selectedCoworker.name}'s shift you will receive
                  </Text>
                  <View style={styles.section}>
                    {coworkerShifts.map((shift) => {
                      const selected = selectedTargetShiftId === shift.id;
                      return (
                        <Pressable
                          key={shift.id}
                          style={[styles.coworkerShiftCard, selected && styles.optionSelected]}
                          onPress={() => setSelectedTargetShiftId(shift.id)}
                        >
                          <View style={styles.shiftBar} />
                          <View style={styles.optionBody}>
                            <Text style={styles.optionTitle}>{shift.name}</Text>
                            <Text style={styles.optionMeta}>{shift.dateLabel}</Text>
                            <Text style={styles.optionMeta}>{shift.time}</Text>
                          </View>
                          <View style={styles.durationPill}>
                            <Text style={styles.durationText}>{shift.duration}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
              <Text style={styles.noteInfo}>
                {isSwap
                  ? "The selected coworker must accept before both shifts are swapped"
                  : "The selected coworker will be notified and must accept before the shift is transferred"}
              </Text>
            </>
          )}

          {sent ? (
            <View style={styles.successCard}>
              <Feather name="check-circle" size={36} color={Colors.success} />
              <Text style={styles.successTitle}>Request Sent!</Text>
              <Text style={styles.successSub}>
                {selectedCoworker?.name ?? "Coworker"} will be notified
              </Text>
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 8 }} />
            </View>
          ) : null}
        </ScrollView>
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {step === 1 ? (
          <Pressable
            style={[styles.sendBtn, !selectedCoworkerId && styles.sendBtnDisabled]}
            onPress={() => setStep(2)}
            disabled={!selectedCoworkerId || loading}
          >
            <Text style={styles.sendText}>Next: Select Your Shift</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            onPress={() => void sendRequest()}
            disabled={!canSend}
          >
            {sending ? (
              <ActivityIndicator color={Colors.textLight} />
            ) : (
              <Text style={styles.sendText}>Send Switch Request</Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: Colors.textPrimary },
  headerSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  scroll: { flex: 1 },
  content: { padding: 16 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  progressDotActive: { backgroundColor: Colors.primary },
  progressText: { fontSize: 12, color: Colors.textMuted, marginLeft: 4 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: Colors.textPrimary, marginBottom: 10 },
  sectionSubTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textSecondary,
    marginTop: 14,
    marginBottom: 8,
  },
  emptyHint: { fontSize: 14, color: Colors.textMuted, lineHeight: 20, paddingVertical: 8 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    height: 46,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 15, color: Colors.textPrimary },
  section: { gap: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  shiftCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  coworkerShiftCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  shiftBar: { width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: Colors.primary },
  optionSelected: { borderColor: Colors.primary },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: Colors.primaryDark, fontWeight: "700", fontSize: 13 },
  optionBody: { flex: 1 },
  optionTitle: { fontSize: 15, fontWeight: "700", color: Colors.textPrimary },
  optionMeta: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  availabilityRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  availabilityDot: { width: 7, height: 7, borderRadius: 4 },
  availabilityText: { fontSize: 12, color: Colors.textSecondary },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: Colors.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  durationPill: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  durationText: { fontSize: 12, color: Colors.primary, fontWeight: "700" },
  noteInfo: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 12,
    fontStyle: "italic",
    lineHeight: 18,
  },
  successCard: {
    marginTop: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
  },
  successTitle: { fontSize: 18, fontWeight: "700", color: Colors.success, marginTop: 6 },
  successSub: { fontSize: 13, color: Colors.textMuted, marginTop: 4 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  sendBtn: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderRadius: 14,
    height: 52,
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendText: { color: Colors.textLight, fontSize: 16, fontWeight: "600" },
});
