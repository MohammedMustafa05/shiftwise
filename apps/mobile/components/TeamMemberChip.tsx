import { StyleSheet, Text, View } from "react-native";
import { Colors } from "../constants/colors";
import type { Teammate } from "../constants/dummyData";

type TeamMemberChipProps = {
  member: Teammate;
};

export default function TeamMemberChip({ member }: TeamMemberChipProps) {
  return (
    <View style={styles.chip}>
      <View style={styles.avatar}>
        <Text style={styles.initials}>{member.initials}</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {member.name.split(" ")[0]}
      </Text>
      <Text style={styles.role} numberOfLines={1}>
        {member.role}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    width: 72,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  initials: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textLight,
  },
  name: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
    textAlign: "center",
  },
  role: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: 1,
  },
});
