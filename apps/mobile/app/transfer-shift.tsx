import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import { currentUser } from "../constants/dummyData";
import type { Shift } from "../constants/dummyData";
import { transferableShifts, transferRecipients } from "../constants/transferData";
import { addTransferRequest } from "../lib/transferStore";

function formatShiftTime(shift: Shift) {
  return `${shift.dayShort} ${shift.date} · ${shift.startTime} – ${shift.endTime}`;
}

export default function TransferShiftScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const selectedShift = transferableShifts.find((s) => s.id === selectedShiftId);
  const selectedRecipient = transferRecipients.find((r) => r.id === selectedRecipientId);

  const canSend = Boolean(selectedShift && selectedRecipient);

  const handleSend = () => {
    if (!selectedShift || !selectedRecipient) return;

    addTransferRequest({
      fromUserId: currentUser.id,
      fromUserName: currentUser.name,
      toUserId: selectedRecipient.id,
      toUserName: selectedRecipient.name,
      shift: selectedShift,
      note: note.trim() || undefined,
    });

    Alert.alert(
      "Request sent",
      `${selectedRecipient.name} will be notified. You'll get an update when they respond.`,
      [{ text: "OK", onPress: () => router.back() }],
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Transfer My Shift</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>1. Select your shift</Text>
        <View style={styles.section}>
          {transferableShifts.map((shift) => {
            const selected = shift.id === selectedShiftId;
            return (
              <Pressable
                key={shift.id}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => setSelectedShiftId(shift.id)}
              >
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected && <View style={styles.radioInner} />}
                </View>
                <View style={styles.optionBody}>
                  <Text style={styles.optionTitle}>{shift.name}</Text>
                  <Text style={styles.optionMeta}>{formatShiftTime(shift)}</Text>
                  <Text style={styles.optionMeta}>{shift.location}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>2. Transfer to</Text>
        <View style={styles.section}>
          {transferRecipients.map((person) => {
            const selected = person.id === selectedRecipientId;
            return (
              <Pressable
                key={person.id}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => setSelectedRecipientId(person.id)}
              >
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected && <View style={styles.radioInner} />}
                </View>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{person.initials}</Text>
                </View>
                <View style={styles.optionBody}>
                  <Text style={styles.optionTitle}>{person.name}</Text>
                  <Text style={styles.optionMeta}>{person.role}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>3. Add a note (optional)</Text>
        <TextInput
          style={styles.noteInput}
          placeholder="Reason for transfer, preferences, etc."
          placeholderTextColor={Colors.textMuted}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={280}
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!canSend}
        >
          <Feather name="send" size={18} color={Colors.textLight} />
          <Text style={styles.sendText}>Send Request</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
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
  headerTitle: { fontSize: 17, fontWeight: "700", color: Colors.textPrimary },
  scroll: { flex: 1 },
  content: { padding: 16 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: 10,
    marginTop: 8,
  },
  section: { gap: 8, marginBottom: 8 },
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
  optionSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
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
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: Colors.textLight, fontWeight: "700", fontSize: 13 },
  optionBody: { flex: 1 },
  optionTitle: { fontSize: 15, fontWeight: "600", color: Colors.textPrimary },
  optionMeta: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  noteInput: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    minHeight: 100,
    fontSize: 15,
    color: Colors.textPrimary,
    textAlignVertical: "top",
  },
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    height: 52,
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendText: { color: Colors.textLight, fontSize: 16, fontWeight: "600" },
});
