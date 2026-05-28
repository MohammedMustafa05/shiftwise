import { useCallback, useState } from "react";
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
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../constants/colors";
import { api } from "../lib/api";
import {
  formatRoleLabel,
  formatShiftTimeRange,
  timeAgo,
} from "../lib/time";

type TransferRequest = Awaited<ReturnType<typeof api.getTransferRequests>>[number];

type CardStatus = "pending" | "accepted" | "declined" | "collapsed";

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
  if (hour < 12) return "Morning Shift";
  if (hour < 17) return "Afternoon Shift";
  return "Evening Shift";
}

function RequestCard({
  request,
  cardStatus,
  onAccept,
  onDecline,
  responding,
}: {
  request: TransferRequest;
  cardStatus: CardStatus;
  onAccept: () => void;
  onDecline: () => void;
  responding: boolean;
}) {
  if (cardStatus === "collapsed") return null;

  const dateShort = new Date(`${request.shiftDate}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const isSwap = Boolean(
    request.targetShiftId && request.targetShiftDate && request.targetStartTime && request.targetEndTime,
  );

  const targetDateShort = request.targetShiftDate
    ? new Date(`${request.targetShiftDate}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <View
      style={[
        styles.card,
        cardStatus === "accepted" && styles.cardAccepted,
        cardStatus === "declined" && styles.cardDeclined,
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(request.fromUserName)}</Text>
        </View>
        <View style={styles.cardHeaderBody}>
          <Text style={styles.fromName}>{request.fromUserName}</Text>
          <Text style={styles.fromMeta}>
            {isSwap ? "wants to switch shifts" : "wants you to take their shift"}
          </Text>
        </View>
        <Text style={styles.timeAgo}>
          {request.createdAt ? timeAgo(request.createdAt) : ""}
        </Text>
      </View>

      <View style={styles.shiftBox}>
        <Text style={styles.labelPrimary}>THEIR SHIFT</Text>
        <Text style={styles.shiftName}>
          {shiftDisplayName(request.role, request.startTime)}
        </Text>
        <Text style={styles.shiftMeta}>
          {dateShort} · {formatShiftTimeRange(request.startTime, request.endTime)}
        </Text>
        <View style={[styles.rolePill, { backgroundColor: Colors.primaryLight }]}>
          <Text style={styles.roleText}>{formatRoleLabel(request.role)}</Text>
        </View>
        {request.note ? <Text style={styles.noteText}>"{request.note}"</Text> : null}
      </View>

      {isSwap ? (
        <>
          <View style={styles.switchIconWrap}>
            <Feather name="repeat" size={16} color={Colors.textMuted} />
          </View>
          <View style={styles.shiftBox}>
            <Text style={styles.labelSecondary}>YOUR SHIFT</Text>
            <Text style={styles.shiftName}>
              {shiftDisplayName(request.targetRole ?? request.role, request.targetStartTime!)}
            </Text>
            <Text style={styles.shiftMeta}>
              {targetDateShort} · {formatShiftTimeRange(request.targetStartTime!, request.targetEndTime!)}
            </Text>
            <View style={[styles.rolePill, { backgroundColor: Colors.primaryLight }]}>
              <Text style={styles.roleText}>{formatRoleLabel(request.targetRole ?? request.role)}</Text>
            </View>
          </View>
        </>
      ) : (
        <View style={styles.infoBanner}>
          <Feather name="info" size={14} color={Colors.primary} />
          <Text style={styles.infoText}>
            If you accept, this shift will be added to your published schedule
          </Text>
        </View>
      )}

      {cardStatus === "pending" ? (
        <View style={styles.actions}>
          <Pressable
            style={[styles.declineBtn, responding && styles.btnDisabled]}
            onPress={onDecline}
            disabled={responding}
          >
            <Text style={styles.declineText}>Decline</Text>
          </Pressable>
          <Pressable
            style={[styles.acceptBtn, responding && styles.btnDisabled]}
            onPress={onAccept}
            disabled={responding}
          >
            {responding ? (
              <ActivityIndicator color={Colors.textLight} />
            ) : (
              <Text style={styles.acceptText}>Accept</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={styles.statusMsgWrap}>
          <Feather
            name={cardStatus === "accepted" ? "check-circle" : "x-circle"}
            size={18}
            color={cardStatus === "accepted" ? Colors.success : Colors.error}
          />
          <Text
            style={[
              styles.statusMsg,
              { color: cardStatus === "accepted" ? Colors.success : Colors.error },
            ]}
          >
            {cardStatus === "accepted" ? "Shift switch confirmed!" : "Request declined"}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function ShiftRequestsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [requests, setRequests] = useState<TransferRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [cardStatuses, setCardStatuses] = useState<Record<string, CardStatus>>({});
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const visibleRequests = requests.filter((r) => cardStatuses[r.id] !== "collapsed");
  const pendingCount = visibleRequests.filter(
    (r) => (cardStatuses[r.id] ?? "pending") === "pending",
  ).length;

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.getTransferRequests();
      setRequests(rows);
      setCardStatuses((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          if (!next[row.id]) next[row.id] = "pending";
        }
        return next;
      });
    } catch (e) {
      Alert.alert("Could not load requests", e instanceof Error ? e.message : "Please try again");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadRequests();
    }, [loadRequests]),
  );

  const respond = async (id: string, status: "accepted" | "declined") => {
    setRespondingId(id);
    try {
      await api.respondTransfer(id, status);
      setCardStatuses((prev) => ({ ...prev, [id]: status }));
      setTimeout(() => {
        setCardStatuses((prev) => ({ ...prev, [id]: "collapsed" }));
        setRequests((prev) => prev.filter((r) => r.id !== id));
      }, 1000);
    } catch (e) {
      Alert.alert("Action failed", e instanceof Error ? e.message : "Please try again");
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.headerTitle}>Shift Requests</Text>
          {pendingCount > 0 ? (
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{pendingCount}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : visibleRequests.length === 0 ? (
        <View style={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.empty}>
            <Feather name="calendar" size={40} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No pending requests</Text>
            <Text style={styles.emptyText}>
              Shift transfer requests from coworkers will appear here
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24, gap: 12 }]}
        >
          {visibleRequests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              cardStatus={cardStatuses[request.id] ?? "pending"}
              responding={respondingId === request.id}
              onAccept={() => void respond(request.id, "accepted")}
              onDecline={() => void respond(request.id, "declined")}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  titleWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  countPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
  },
  countPillText: { color: Colors.textLight, fontWeight: "700", fontSize: 12 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: Colors.textPrimary },
  content: { padding: 16 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 14,
  },
  cardAccepted: { backgroundColor: "#ECFDF5", borderColor: "#86EFAC" },
  cardDeclined: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: Colors.textLight, fontWeight: "700", fontSize: 14 },
  cardHeaderBody: { flex: 1 },
  fromName: { fontSize: 16, fontWeight: "700", color: Colors.textPrimary },
  fromMeta: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  timeAgo: { fontSize: 11, color: Colors.textMuted },
  shiftBox: {
    backgroundColor: Colors.cellBg,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  labelPrimary: { fontSize: 11, fontWeight: "700", color: Colors.primary, letterSpacing: 0.8 },
  labelSecondary: { fontSize: 11, fontWeight: "700", color: Colors.textMuted, letterSpacing: 0.8 },
  switchIconWrap: { alignItems: "center" },
  shiftName: { fontSize: 15, fontWeight: "600", color: Colors.textPrimary },
  shiftMeta: { fontSize: 13, color: Colors.textMuted },
  noteText: { fontSize: 12, color: Colors.textSecondary, fontStyle: "italic", marginTop: 4 },
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.primaryLight,
    borderRadius: 10,
    padding: 10,
  },
  infoText: { flex: 1, fontSize: 12, color: Colors.primary, lineHeight: 17 },
  rolePill: {
    alignSelf: "flex-start",
    marginTop: 6,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  roleText: { fontSize: 11, color: Colors.primary, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10 },
  btnDisabled: { opacity: 0.6 },
  declineBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  declineText: { fontSize: 15, fontWeight: "600", color: Colors.error },
  acceptBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptText: { fontSize: 15, fontWeight: "600", color: Colors.textLight },
  statusMsgWrap: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  statusMsg: { fontSize: 14, fontWeight: "700" },
  empty: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
});
