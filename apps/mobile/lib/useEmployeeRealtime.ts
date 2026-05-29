import { useEffect } from "react";
import { isSupabaseConfigured, supabase } from "./supabase";

export function useEmployeeRealtime(params: {
  userId: string | undefined;
  workplaceId: string | undefined;
  onProfileChange?: () => void;
  onAvailabilityChange?: () => void;
  onTimeOffChange?: () => void;
}) {
  const { userId, workplaceId, onProfileChange, onAvailabilityChange, onTimeOffChange } =
    params;

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!userId) return;

    const sb = supabase;
    const channel = sb
      .channel(`employee-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "employee_profiles",
          filter: `user_id=eq.${userId}`,
        },
        () => onProfileChange?.()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "employee_availability",
          filter: `user_id=eq.${userId}`,
        },
        () => onAvailabilityChange?.()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "availability_submissions",
          filter: `user_id=eq.${userId}`,
        },
        () => onAvailabilityChange?.()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "time_off_requests",
          filter: `user_id=eq.${userId}`,
        },
        () => onTimeOffChange?.()
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [userId, workplaceId, onProfileChange, onAvailabilityChange, onTimeOffChange]);
}

