export interface Task {
  id: string;
  goal: string;
  actorId: string;
  status: "queued" | "running" | "blocked" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
}
