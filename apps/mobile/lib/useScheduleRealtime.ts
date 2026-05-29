import { useEffect } from "react";
import { isSupabaseConfigured, supabase } from "./supabase";

export function useScheduleRealtime(workplaceId: string | undefined, onUpdate: () => void) {
  useEffect(() => {
    if (!workplaceId) return;

    if (isSupabaseConfigured && supabase) {
      const sb = supabase;
      const channel = supabase
        .channel(`schedules-${workplaceId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "schedules",
            filter: `workplace_id=eq.${workplaceId}`,
          },
          () => onUpdate(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "schedule_shifts",
          },
          () => onUpdate(),
        )
        .subscribe();

      return () => {
        void sb.removeChannel(channel);
      };
    }

    const interval = setInterval(onUpdate, 15000);
    return () => clearInterval(interval);
  }, [workplaceId, onUpdate]);
}
