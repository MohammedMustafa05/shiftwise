import { useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Colors } from "../constants/colors";
import {
  AVAIL_BLOCK_HEIGHT,
  AVAIL_END_HOUR,
  AVAIL_START_HOUR,
  formatHourBlockLabel,
} from "../utils/time";

type TapTimeGridProps = {
  ranges: { startHour: number; endHour: number; shadeIndex?: number }[];
  pendingStart: number | null;
  pendingEnd: number | null;
  onHourPress: (hour: number) => void;
  shakeHour: number | null;
};

export default function TapTimeGrid({
  ranges,
  pendingStart,
  pendingEnd,
  onHourPress,
  shakeHour,
}: TapTimeGridProps) {
  const hours: number[] = [];
  for (let h = AVAIL_START_HOUR; h <= AVAIL_END_HOUR; h++) hours.push(h);

  const isInConfirmed = (hour: number) =>
    ranges.some((r) => hour >= r.startHour && hour <= r.endHour);

  const confirmedShade = (hour: number) => {
    const range = ranges.find((r) => hour >= r.startHour && hour <= r.endHour);
    if (!range) return Colors.primary;
    const idx = range.shadeIndex ?? 0;
    return Colors.rangeShades[idx] ?? Colors.primary;
  };

  const isPendingBetween = (hour: number) => {
    if (pendingStart === null || pendingEnd === null) return false;
    const lo = Math.min(pendingStart, pendingEnd);
    const hi = Math.max(pendingStart, pendingEnd);
    return hour >= lo && hour <= hi;
  };

  return (
    <View style={styles.container}>
      {hours.map((hour) => {
        const isStart = pendingStart === hour;
        const isEnd = pendingEnd === hour;
        const confirmed = isInConfirmed(hour);
        const pending = isPendingBetween(hour) && !confirmed;
        const isShaking = shakeHour === hour;

        return (
          <HourRow
            key={hour}
            hour={hour}
            isStart={isStart}
            isEnd={isEnd}
            confirmed={confirmed}
            pending={pending}
            shade={confirmedShade(hour)}
            shaking={isShaking}
            onPress={() => onHourPress(hour)}
          />
        );
      })}
    </View>
  );
}

type HourRowProps = {
  hour: number;
  isStart: boolean;
  isEnd: boolean;
  confirmed: boolean;
  pending: boolean;
  shade: string;
  shaking: boolean;
  onPress: () => void;
};

function HourRow({
  hour,
  isStart,
  isEnd,
  confirmed,
  pending,
  shade,
  shaking,
  onPress,
}: HourRowProps) {
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  if (shaking) {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }

  const blockStyle = [
    styles.block,
    confirmed && { backgroundColor: shade },
    pending && !isStart && !isEnd && styles.blockPending,
    (isStart || isEnd) && styles.blockEndpoint,
  ];

  return (
    <Animated.View
      style={[
        styles.row,
        { transform: [{ translateX: shakeAnim }, { scale: scaleAnim }] },
      ]}
    >
      <Text style={styles.timeLabel}>{formatHourBlockLabel(hour)}</Text>
      <Pressable
        style={blockStyle}
        onPress={onPress}
        onPressIn={() =>
          Animated.spring(scaleAnim, { toValue: 0.98, useNativeDriver: true }).start()
        }
        onPressOut={() =>
          Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start()
        }
      >
        {isStart && <Text style={styles.endpointLabel}>Start</Text>}
        {isEnd && <Text style={styles.endpointLabel}>End</Text>}
        {!isStart && !isEnd && (confirmed || pending) && (
          <Text style={styles.blockHour}>{formatHourBlockLabel(hour)}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: Colors.surface,
  },
  row: {
    flexDirection: "row",
    height: AVAIL_BLOCK_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  timeLabel: {
    width: 56,
    textAlign: "right",
    paddingRight: 10,
    paddingTop: 18,
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: "500",
  },
  block: {
    flex: 1,
    backgroundColor: Colors.cellBg,
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    minHeight: AVAIL_BLOCK_HEIGHT,
  },
  blockPending: {
    backgroundColor: Colors.primary,
  },
  blockEndpoint: {
    backgroundColor: Colors.primaryDark,
  },
  endpointLabel: {
    color: Colors.textLight,
    fontSize: 14,
    fontWeight: "700",
  },
  blockHour: {
    color: Colors.textLight,
    fontSize: 13,
    fontWeight: "600",
  },
});
