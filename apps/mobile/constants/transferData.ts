import { currentUser, sarahShifts, teammates } from "./dummyData";
import type { TransferRequest } from "../lib/transferStore";

export const transferableShifts = sarahShifts;

export const transferRecipients = teammates.filter((t) => t.id !== currentUser.id);

export const demoIncomingRequest: TransferRequest = {
  id: "demo-incoming-1",
  fromUserId: "t1",
  fromUserName: "Marcus Lee",
  toUserId: currentUser.id,
  toUserName: currentUser.name,
  shift: {
    id: "marcus-s1",
    name: "Afternoon Shift",
    day: "Thursday",
    dayShort: "Thu",
    date: "Jun 5",
    startTime: "12PM",
    endTime: "8PM",
    location: "Main Branch",
    role: "Shift Lead",
  },
  note: "Family appointment — can you cover?",
  status: "pending",
  createdAt: Date.now(),
};
