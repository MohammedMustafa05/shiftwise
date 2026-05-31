import { Tabs, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors } from "../../constants/colors";
import { useCallback, useState } from "react";
import { api } from "../../lib/api";

export default function TabLayout() {
  const [pending, setPending] = useState(0);

  const refreshPending = useCallback(() => {
    void api
      .getTransferRequests()
      .then((rows) => setPending(rows.length))
      .catch(() => setPending(0));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshPending();
    }, [refreshPending]),
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#818CF8",
        tabBarInactiveTintColor: "#475569",
        tabBarStyle: {
          backgroundColor: "#0F0F16",
          borderTopColor: "#1E1E2A",
          borderTopWidth: 1,
          height: 88,
          paddingTop: 8,
          paddingBottom: 28,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Feather name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: "Schedule",
          tabBarIcon: ({ color, size }) => <Feather name="calendar" size={size} color={color} />,
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarBadgeStyle: {
            backgroundColor: Colors.error,
            color: Colors.textLight,
          },
        }}
      />
      <Tabs.Screen
        name="availability"
        options={{
          title: "Availability",
          tabBarIcon: ({ color, size }) => <Feather name="clock" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
