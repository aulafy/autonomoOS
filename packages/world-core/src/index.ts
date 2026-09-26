import type { ActionIntent, WorldEntity, WorldEvent } from "@agent-world/protocol";

export class WorldRuntime {
  private entities = new Map<string, WorldEntity>();

  addEntity(entity: WorldEntity) {
    this.entities.set(entity.id, entity);
  }

  getEntity(id: string) {
    return this.entities.get(id);
  }

  execute(intent: ActionIntent): WorldEvent {
    const now = Date.now();

    if (intent.action === "goto") {
      const actor = this.entities.get(intent.actorId);
      const target = intent.targetId ? this.entities.get(intent.targetId) : undefined;

      if (!actor || !target?.transform) {
        throw new Error("Actor or target not found");
      }

      actor.transform = actor.transform ?? {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1]
      };

      actor.transform.position = [...target.transform.position];

      return {
        id: crypto.randomUUID(),
        timestamp: now,
        type: "agent.moved",
        actorId: actor.id,
        entityId: target.id,
        payload: {
          position: target.transform.position
        }
      };
    }

    if (intent.action === "say") {
      return {
        id: crypto.randomUUID(),
        timestamp: now,
        type: "agent.said",
        actorId: intent.actorId,
        payload: {
          text: String(intent.parameters?.text ?? "")
        }
      };
    }

    throw new Error(`Unsupported action: ${intent.action}`);
  }
}
