export type WorldEntityKind =
  | "human"
  | "agent"
  | "robot"
  | "object"
  | "machine"
  | "service"
  | "space";

export interface WorldEntity {
  id: string;
  kind: WorldEntityKind;
  name: string;
  state: Record<string, unknown>;
  affordances: string[];

  transform?: {
    position: [number, number, number];
    rotation: [number, number, number, number];
  };

  render?: {
    asset?: string;
    representation?: string;
  };
}
