import fs from "node:fs";
import path from "node:path";
import type { WorldEvent } from "@agent-world/protocol";

export class JsonlEventStore {
  constructor(private filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  append(event: WorldEvent) {
    fs.appendFileSync(this.filePath, JSON.stringify(event) + "\n", "utf8");
  }

  readAll(): WorldEvent[] {
    if (!fs.existsSync(this.filePath)) return [];

    return fs.readFileSync(this.filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }
}
