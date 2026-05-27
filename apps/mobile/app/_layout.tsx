import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="transfer-shift" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="shift-requests" options={{ animation: "slide_from_right" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
