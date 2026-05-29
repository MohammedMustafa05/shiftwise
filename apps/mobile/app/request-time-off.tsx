import { useState } from "react";
import {
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

type RequestType = "Vacation" | "Sick Day" | "Personal";

export default function RequestTimeOffScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [requestType, setRequestType] = useState<RequestType>("Vacation");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const onSubmit = async () => {
    if (!fromDate || !toDate) {
      Alert.alert("Missing dates", "Please enter both From and To dates (YYYY-MM-DD).");
      return;
    }
    setSaving(true);
    try {
      await api.submitTimeOff({
        startDate: fromDate,
        endDate: toDate,
        reason: reason.trim() || undefined,
        requestType,
      });
      setSubmitted(true);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not submit request");
    } finally {
      setSaving(false);
    }
  };

  if (submitted) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.successBox}>
          <Feather name="check-circle" size={48} color={Colors.primary} />
          <Text style={styles.successTitle}>Request Submitted</Text>
          <Text style={styles.successSub}>Your manager will review your request</Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Request Time Off</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>From</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={Colors.textMuted}
          value={fromDate}
          onChangeText={setFromDate}
        />
        <Text style={styles.label}>To</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={Colors.textMuted}
          value={toDate}
          onChangeText={setToDate}
        />
        <Text style={styles.label}>Reason (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Reason (optional)"
          placeholderTextColor={Colors.textMuted}
          value={reason}
          onChangeText={setReason}
          multiline
        />
        <Text style={styles.label}>Type</Text>
        <View style={styles.pills}>
          {(["Vacation", "Sick Day", "Personal"] as RequestType[]).map((type) => (
            <Pressable
              key={type}
              onPress={() => setRequestType(type)}
              style={[styles.pill, requestType === type && styles.pillActive]}
            >
              <Text style={[styles.pillText, requestType === type && styles.pillTextActive]}>
                {type}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={[styles.submitBtn, saving && { opacity: 0.7 }]}
          onPress={() => void onSubmit()}
          disabled={saving}
        >
          <Text style={styles.submitText}>Submit Request</Text>
        </Pressable>
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
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: Colors.textPrimary },
  content: { padding: 16, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: "600", color: Colors.textSecondary, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  textArea: { minHeight: 88, textAlignVertical: "top" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  pillActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  pillText: { fontSize: 13, fontWeight: "600", color: Colors.textSecondary },
  pillTextActive: { color: Colors.primary },
  submitBtn: {
    marginTop: 28,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { color: Colors.textLight, fontSize: 16, fontWeight: "600" },
  successBox: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  successTitle: { fontSize: 22, fontWeight: "700", color: Colors.textPrimary, marginTop: 16 },
  successSub: { fontSize: 15, color: Colors.textMuted, marginTop: 8, textAlign: "center" },
  backBtn: {
    marginTop: 24,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  backBtnText: { color: Colors.textLight, fontWeight: "600", fontSize: 16 },
});
