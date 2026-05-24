import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { UserRole } from "@shiftwise/shared";

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>ShiftWise</Text>
      <Text style={styles.subtitle}>Employee app — scheduling</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Mobile shell</Text>
        <Text style={styles.cardText}>
          Join workplace, submit availability, view published schedule.
        </Text>
        <Text style={styles.code}>Role: {UserRole.enum.EMPLOYEE}</Text>
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fb",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1a1a2e",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: "#64748b",
    marginBottom: 24,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 20,
    width: "100%",
    maxWidth: 360,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
    color: "#1a1a2e",
  },
  cardText: {
    fontSize: 14,
    color: "#475569",
    lineHeight: 20,
  },
  code: {
    marginTop: 12,
    fontSize: 13,
    color: "#4338ca",
    fontFamily: "monospace",
  },
});
