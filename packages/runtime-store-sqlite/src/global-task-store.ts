import { TaskRuntimeKernel } from "@agent-world/task-runtime";
import type { JournalKernel } from "./journal-kernel.js";

/** Register before restore(). Existing legacy task commands remain untouched. */
export function createDurableTaskRuntime(kernel: JournalKernel): TaskRuntimeKernel {
  return kernel.register("aw2TaskRuntime", () => new TaskRuntimeKernel(), ["apply"]);
}
