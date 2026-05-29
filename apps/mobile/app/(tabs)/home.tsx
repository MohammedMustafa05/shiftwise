import { useCallback, useState, type ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import StatCard from "../../components/StatCard";
import TeamMemberChip from "../../components/TeamMemberChip";
import { Colors } from "../../constants/colors";
import {
  announcements as fallbackAnnouncements,
  currentUser,
  stats as mockStats,
} from "../../constants/dummyData";
import {
  announcementIcon,
  type AnnouncementItem,
  type AnnouncementType,
} from "../../lib/announcements";
import { api } from "../../lib/api";
import { formatDateYmd, formatRoleLabel, formatShiftTimeRange, getMondayForOffset, normalizeIsoDate, weekdayShortFromIso } from "../../lib/time";
import { useScheduleRealtime } from "../../lib/useScheduleRealtime";

type UpcomingShift = {
  name: string;
  dayShort: string;
  date: string;
  timeRange: string;
  location: string;
};

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState(currentUser);
  const [stats, setStats] = useState(mockStats);
  const [upcoming, setUpcoming] = useState<UpcomingShift | null>(null);
  const [teamToday, setTeamToday] = useState<Array<{ id: string; name: string; initials: string; role: string }>>([]);
  const [announcementItems, setAnnouncementItems] = useState<AnnouncementItem[]>(fallbackAnnouncements);
  const [workplaceId, setWorkplaceId] = useState<string | undefined>();

  const loadHome = useCallback(async () => {
    try {
      const [me, s, announcements] = await Promise.all([
        api.getMe(),
        api.getStats(),
        api.getAnnouncements(),
      ]);
      setWorkplaceId(me.workplaceId);
      setProfile({
        ...currentUser,
        firstName: me.name.split(" ")[0],
        email: me.email,
        location: me.location ?? me.workplaceName,
      });
      setStats({
        shiftsThisWeek: s.shiftsThisWeek,
        hoursThisWeek: s.hoursThisWeek,
        daysOff: s.daysOff,
      });
      if (s.nextShift) {
        const dateIso = normalizeIsoDate(s.nextShift.shiftDate);
        setUpcoming({
          name: formatRoleLabel(me.role),
          dayShort: weekdayShortFromIso(dateIso),
          date: dateIso,
          timeRange: formatShiftTimeRange(s.nextShift.startTime, s.nextShift.endTime),
          location: s.nextShift.location ?? me.workplaceName,
        });
      } else {
        setUpcoming(null);
      }

      const weekStart = formatDateYmd(getMondayForOffset(0));
      const today = formatDateYmd(new Date());
      const team = await api.getTeamSchedule(me.workplaceId, weekStart);
      const onToday = team.filter((t) => normalizeIsoDate(t.shiftDate) === today);
      const unique = new Map<string, { id: string; name: string; role: string }>();
      for (const t of onToday) {
        if (!unique.has(t.employeeId)) {
          unique.set(t.employeeId, {
            id: t.employeeId,
            name: t.employeeName,
            role: t.role,
          });
        }
      }
      setTeamToday(
        [...unique.values()].map((m) => ({
          id: m.id,
          name: m.name,
          initials: m.name.split(" ").map((n) => n[0]).join("").slice(0, 2),
          role: m.role,
        })),
      );
      setAnnouncementItems(
        announcements.map((a) => ({
          id: a.id,
          title: a.title,
          date: a.date,
          type: a.type as AnnouncementType,
          route: a.route,
          read: a.read,
        })),
      );
    } catch {
      /* use mock data */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadHome();
    }, [loadHome]),
  );

  useScheduleRealtime(workplaceId, loadHome);

  const onAnnouncementPress = useCallback(
    (item: AnnouncementItem) => {
      void api.markAnnouncementRead(item.id).catch(() => undefined);
      setAnnouncementItems((prev) =>
        prev.map((a) => (a.id === item.id ? { ...a, read: true } : a)),
      );
      router.push(item.route as Href);
    },
    [router],
  );

  const shiftSummary = upcoming
    ? `${upcoming.name} · ${upcoming.dayShort} ${upcoming.date} · ${upcoming.timeRange} · ${upcoming.location}`
    : "No upcoming shifts scheduled";

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
        <Text style={styles.wordmark}>ShiftAgent</Text>
        <View style={styles.locationRow}>
          <Feather name="map-pin" size={14} color={Colors.textMuted} />
          <Text style={styles.location}>{profile.location}</Text>
        </View>
      </View>

      <Text style={styles.greeting}>Good morning, {profile.firstName}</Text>

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
        {teamToday.length === 0 ? (
          <Text style={styles.emptyTeam}>No teammates on shift today</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.teamScroll}
          >
            {teamToday.map((member) => (
              <View key={member.id} style={styles.teamChipWrap}>
                <TeamMemberChip member={member} />
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Announcements</Text>
        {announcementItems.length === 0 ? (
          <Text style={styles.emptyAnnouncements}>No announcements yet</Text>
        ) : (
          announcementItems.map((item) => (
            <Pressable
              key={item.id}
              style={[styles.announcementCard, item.read && styles.announcementRead]}
              onPress={() => onAnnouncementPress(item)}
            >
              <View style={styles.announcementIcon}>
                <Feather
                  name={announcementIcon(item.type) as ComponentProps<typeof Feather>["name"]}
                  size={18}
                  color={Colors.primary}
                />
              </View>
              <View style={styles.announcementBody}>
                <Text style={styles.announcementTitle}>{item.title}</Text>
                <Text style={styles.announcementDate}>{item.date}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={Colors.textMuted} />
            </Pressable>
          ))
        )}
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
  emptyTeam: {
    fontSize: 14,
    color: Colors.textMuted,
    paddingVertical: 4,
  },
  emptyAnnouncements: {
    fontSize: 14,
    color: Colors.textMuted,
    paddingVertical: 8,
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
    marginBottom: 10,
  },
  announcementRead: {
    opacity: 0.72,
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
