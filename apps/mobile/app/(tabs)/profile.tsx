import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../../constants/colors";
import { currentUser } from "../../constants/dummyData";
import { api, clearAuth, getStoredUser } from "../../lib/api";
import { useEmployeeRealtime } from "../../lib/useEmployeeRealtime";

function isNumericPhone(value: string) {
  return value === "" || /^\d+$/.test(value);
}

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [user, setUser] = useState(currentUser);
  const [preferredName, setPreferredName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [userId, setUserId] = useState<string | undefined>();
  const [workplaceId, setWorkplaceId] = useState<string | undefined>();

  useEffect(() => {
    void getStoredUser().then((u) => {
      setUserId(u?.id ?? undefined);
      setWorkplaceId(u?.workplaceId ?? undefined);
    });
  }, []);

  const loadProfile = useCallback(() => {
    void api.getMe().then((me) => {
      setUser({
        ...currentUser,
        name: me.name,
        firstName: me.name.split(" ")[0],
        email: me.email,
        phone: me.phone ?? "",
        role: me.roles?.join(", ") ?? me.role,
        employmentType: me.employmentType ?? currentUser.employmentType,
        startDate: me.startDate ?? currentUser.startDate,
      });
      setPreferredName(me.preferredName ?? me.name);
      setPhone(me.phone ?? "");
      setRoles(me.roles?.length ? me.roles : [me.role]);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadProfile();
  }, []);

  useEmployeeRealtime({
    userId,
    workplaceId,
    onProfileChange: () => loadProfile(),
  });

  const onPhoneChange = (value: string) => {
    setPhone(value);
    if (!isNumericPhone(value)) {
      setPhoneError("Phone number must contain numbers only");
    } else {
      setPhoneError("");
    }
  };

  const onSaveProfile = async () => {
    if (!isNumericPhone(phone)) {
      setPhoneError("Phone number must contain numbers only");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateMe({
        preferredName: preferredName.trim() || undefined,
        phone: phone.trim(),
      });
      setUser((u) => ({
        ...u,
        name: updated.name,
        firstName: updated.name.split(" ")[0],
        phone: updated.phone ?? "",
        role: updated.roles.join(", "),
      }));
      setRoles(updated.roles);
      Alert.alert("Saved", "Your profile has been updated.");
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await clearAuth();
          router.replace("/login");
        },
      },
    ]);
  };

  const handleChangePassword = () => {
    Alert.alert("Change password", "Contact your manager to reset your password.");
  };

  const canSave = isNumericPhone(phone) && !saving;

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
        <View style={styles.avatar}>
          <Text style={styles.initials}>{user.initials}</Text>
        </View>
        <Text style={styles.name}>{user.name}</Text>
        <Text style={styles.role}>
          {roles.join(" · ")} · {user.employmentType}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Profile details</Text>
        <Text style={styles.fieldLabel}>Preferred name</Text>
        <TextInput
          style={styles.input}
          value={preferredName}
          onChangeText={setPreferredName}
          placeholder="Preferred name"
          placeholderTextColor={Colors.textMuted}
        />
        <View style={styles.divider} />
        <Text style={styles.fieldLabel}>Email</Text>
        <Text style={styles.readOnly}>{user.email}</Text>
        <View style={styles.divider} />
        <Text style={styles.fieldLabel}>Phone</Text>
        <TextInput
          style={[styles.input, phoneError ? styles.inputError : null]}
          value={phone}
          onChangeText={onPhoneChange}
          keyboardType="number-pad"
          placeholder="Phone"
          placeholderTextColor={Colors.textMuted}
        />
        {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
        <View style={styles.divider} />
        <Text style={styles.fieldLabel}>Roles</Text>
        <Text style={styles.readOnly}>{roles.join(", ")}</Text>
        <Pressable
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={() => void onSaveProfile()}
          disabled={!canSave}
        >
          <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save profile"}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Settings</Text>
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={styles.settingIcon}>
              <Feather name="bell" size={16} color={Colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Notifications</Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={setNotificationsEnabled}
            trackColor={{ false: Colors.emptyCell, true: Colors.primary }}
            thumbColor={Colors.card}
          />
        </View>
        <View style={styles.divider} />
        <Pressable style={styles.settingRow} onPress={handleChangePassword}>
          <View style={styles.settingLeft}>
            <View style={styles.settingIcon}>
              <Feather name="lock" size={16} color={Colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Change password</Text>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
      </View>

      <Pressable
        style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutPressed]}
        onPress={handleSignOut}
      >
        <Feather name="log-out" size={18} color={Colors.textPrimary} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 16 },
  header: { alignItems: "center", marginBottom: 20 },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  initials: { fontSize: 32, fontWeight: "700", color: Colors.textLight },
  name: { fontSize: 24, fontWeight: "700", color: Colors.textPrimary },
  role: { fontSize: 15, color: Colors.textSecondary, marginTop: 4, textAlign: "center" },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 15, fontWeight: "600", color: Colors.textPrimary, marginBottom: 14 },
  fieldLabel: { fontSize: 12, color: Colors.textMuted, marginBottom: 6 },
  input: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  inputError: { borderColor: Colors.error },
  errorText: { fontSize: 12, color: Colors.error, marginTop: 4 },
  readOnly: { fontSize: 15, fontWeight: "500", color: Colors.textPrimary },
  saveBtn: {
    marginTop: 16,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: Colors.textLight, fontWeight: "600", fontSize: 15 },
  divider: { height: 1, backgroundColor: Colors.cardBorder, marginVertical: 12 },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  settingLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  settingLabel: { fontSize: 15, fontWeight: "500", color: Colors.textPrimary },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    marginTop: 8,
  },
  signOutPressed: { opacity: 0.85 },
  signOutText: { fontSize: 16, fontWeight: "600", color: Colors.textPrimary },
});
