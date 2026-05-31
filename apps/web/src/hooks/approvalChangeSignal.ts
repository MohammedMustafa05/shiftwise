const listeners = new Set<() => void>();

export const approvalChangeSignal = {
  emit: () => listeners.forEach((fn) => fn()),
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
