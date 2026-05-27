import type { Shift } from "../constants/dummyData";

export type TransferRequest = {
  id: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  shift: Shift;
  note?: string;
  status: "pending" | "accepted" | "declined";
  createdAt: number;
};

type Listener = () => void;

let requests: TransferRequest[] = [];
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeTransfers(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTransferRequests() {
  return [...requests];
}

export function getPendingIncoming(userId: string) {
  return requests.filter((r) => r.toUserId === userId && r.status === "pending");
}

export function getSentByUser(userId: string) {
  return requests.filter((r) => r.fromUserId === userId);
}

export function addTransferRequest(
  req: Omit<TransferRequest, "id" | "status" | "createdAt">,
) {
  const entry: TransferRequest = {
    ...req,
    id: `tr-${Date.now()}`,
    status: "pending",
    createdAt: Date.now(),
  };
  requests = [entry, ...requests];
  notify();
  return entry;
}

export function respondToTransfer(
  id: string,
  response: "accepted" | "declined",
) {
  requests = requests.map((r) =>
    r.id === id ? { ...r, status: response } : r,
  );
  notify();
  return requests.find((r) => r.id === id);
}

export function seedDemoIncomingRequest(req: TransferRequest) {
  if (!requests.some((r) => r.id === req.id)) {
    requests = [req, ...requests];
    notify();
  }
}

export function resetTransferRequests() {
  requests = [];
  notify();
}
