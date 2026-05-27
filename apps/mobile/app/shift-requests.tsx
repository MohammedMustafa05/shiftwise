import { useCallback, useEffect, useState } from "react";
import {
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
import { currentUser } from "../constants/dummyData";
import { demoIncomingRequest } from "../constants/transferData";
import {
  getPendingIncoming,
  respondToTransfer,
  seedDemoIncomingRequest,
  subscribeTransfers,
  type TransferRequest,
} from "../lib/transferStore";

function RequestCard({
  request,
  onAccept,
  onDecline,
}: {
  request: TransferRequest;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {request.fromUserName
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </Text>
        </View>
        <View style={styles.cardHeaderBody}>
          <Text style={styles.fromName}>{request.fromUserName}</Text>
          <Text style={styles.fromMeta}>wants to transfer a shift to you</Text>
        </View>
      </View>

      <View style={styles.shiftBox}>
        <Text style={styles.shiftName}>{request.shift.name}</Text>
        <Text style={styles.shiftMeta}>
          {request.shift.day}, {request.shift.date} · {request.shift.startTime} –{" "}
          {request.shift.endTime}
        </Text>
        <Text style={styles.shiftMeta}>{request.shift.location}</Text>
      </View>

      {request.note ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteLabel}>Note</Text>
          <Text style={styles.noteText}>{request.note}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable style={styles.declineBtn} onPress={onDecline}>
          <Text style={styles.declineText}>Decline</Text>
        </Pressable>
        <Pressable style={styles.acceptBtn} onPress={onAccept}>
          <Text style={styles.acceptText}>Accept</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function ShiftRequestsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState<TransferRequest[]>([]);

  const refresh = useCallback(() => {
    setPending(getPendingIncoming(currentUser.id));
  }, []);

  useEffect(() => {
    seedDemoIncomingRequest(demoIncomingRequest);
  }, []);

  useEffect(() => subscribeTransfers(refresh), [refresh]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const handleAccept = (request: TransferRequest) => {
    respondToTransfer(request.id, "accepted");
    Alert.alert(
      "Shift accepted",
      `You're now assigned to ${request.shift.name} on ${request.shift.dayShort} ${request.shift.date}. ${request.fromUserName} has been notified.`,
    );
    refresh();
  };

  const handleDecline = (request: TransferRequest) => {
    respondToTransfer(request.id, "declined");
    Alert.alert(
      "Request declined",
      `${request.fromUserName} has been notified that you declined the transfer.`,
    );
    refresh();
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Shift Requests</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {pending.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="inbox" size={40} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No pending requests</Text>
            <Text style={styles.emptyText}>
              When a teammate sends you a shift transfer, it will show up here.
            </Text>
          </View>
        ) : (
          pending.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              onAccept={() => handleAccept(request)}
              onDecline={() => handleDecline(request)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: Colors.textPrimary },
  content: { padding: 16, gap: 16 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 14,
  },
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
  shiftBox: {
    backgroundColor: Colors.cellBg,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  shiftName: { fontSize: 15, fontWeight: "600", color: Colors.textPrimary },
  shiftMeta: { fontSize: 13, color: Colors.textMuted },
  noteBox: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 10,
    padding: 12,
  },
  noteLabel: { fontSize: 11, fontWeight: "600", color: Colors.primary, marginBottom: 4 },
  noteText: { fontSize: 14, color: Colors.textPrimary, lineHeight: 20 },
  actions: { flexDirection: "row", gap: 10 },
  declineBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  declineText: { fontSize: 15, fontWeight: "600", color: Colors.textPrimary },
  acceptBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptText: { fontSize: 15, fontWeight: "600", color: Colors.textLight },
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
