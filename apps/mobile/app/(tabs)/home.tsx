import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import StatCard from "../../components/StatCard";
import TeamMemberChip from "../../components/TeamMemberChip";
import { Colors } from "../../constants/colors";
import {
  announcements,
  currentUser,
  nextShift,
  stats,
  teamOnShiftToday,
} from "../../constants/dummyData";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  const shiftSummary = `${nextShift.name} · ${nextShift.dayShort} ${nextShift.date} · ${nextShift.startTime}–${nextShift.endTime} · ${nextShift.location}`;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.wordmark}>Shiftwise</Text>
        <View style={styles.locationRow}>
          <Feather name="map-pin" size={14} color={Colors.textMuted} />
          <Text style={styles.location}>{currentUser.location}</Text>
        </View>
      </View>

      <Text style={styles.greeting}>Good morning, {currentUser.firstName}</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Next shift</Text>
        <View style={styles.nextShiftCard}>
          <View style={styles.nextShiftAccent} />
          <View style={styles.nextShiftBody}>
            <View style={styles.nextShiftHeader}>
              <Feather name="clock" size={16} color={Colors.primary} />
              <Text style={styles.nextShiftLabel}>Upcoming</Text>
            </View>
            <Text style={styles.nextShiftText}>{shiftSummary}</Text>
          </View>
        </View>
      </View>

      <View style={styles.statsRow}>
        <StatCard icon="calendar" label="Shifts" value={stats.shiftsThisWeek} />
        <View style={styles.statsGap} />
        <StatCard icon="watch" label="Hours" value={stats.hoursThisWeek} />
        <View style={styles.statsGap} />
        <StatCard icon="sun" label="Days Off" value={stats.daysOff} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Team on shift today</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.teamScroll}
        >
          {teamOnShiftToday.map((member) => (
            <View key={member.id} style={styles.teamChipWrap}>
              <TeamMemberChip member={member} />
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Announcements</Text>
        {announcements.map((item) => (
          <View key={item.id} style={styles.announcementCard}>
            <View style={styles.announcementIcon}>
              <Feather name="bell" size={18} color={Colors.primary} />
            </View>
            <View style={styles.announcementBody}>
              <Text style={styles.announcementTitle}>{item.title}</Text>
              <Text style={styles.announcementDate}>{item.date}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={Colors.textMuted} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: 16,
  },
  header: {
    alignItems: "center",
    marginBottom: 24,
  },
  wordmark: {
    fontSize: 28,
    fontWeight: "700",
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  location: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: "500",
  },
  greeting: {
    fontSize: 22,
    fontWeight: "600",
    color: Colors.textPrimary,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  nextShiftCard: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  nextShiftAccent: {
    width: 4,
    backgroundColor: Colors.primary,
  },
  nextShiftBody: {
    flex: 1,
    padding: 16,
  },
  nextShiftHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  nextShiftLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  nextShiftText: {
    fontSize: 15,
    color: Colors.textPrimary,
    lineHeight: 22,
    fontWeight: "500",
  },
  statsRow: {
    flexDirection: "row",
    marginBottom: 24,
  },
  statsGap: {
    width: 10,
  },
  teamScroll: {
    paddingRight: 8,
    gap: 12,
  },
  teamChipWrap: {
    marginRight: 4,
  },
  announcementCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 12,
  },
  announcementIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  announcementBody: {
    flex: 1,
  },
  announcementTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  announcementDate: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
});
