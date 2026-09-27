import * as THREE from "three";

const $ =
  <T extends HTMLElement>(
    selector: string
  ) =>
    document.querySelector<T>(
      selector
    )!;

const status =
  $("#status");

const current =
  $("#current");

const timeline =
  $("#timeline");

const controlPlane =
  $("#control-plane");

const planBox =
  $("#plan");

const taskBox =
  $("#task");

const app =
  $("#app");

const goRoom =
  $<HTMLButtonElement>(
    "#go-room"
  );

const goHome =
  $<HTMLButtonElement>(
    "#go-home"
  );

const sayButton =
  $<HTMLButtonElement>(
    "#say"
  );

const sayText =
  $<HTMLInputElement>(
    "#say-text"
  );

const healthButton =
  $<HTMLButtonElement>(
    "#health"
  );

const planButton =
  $<HTMLButtonElement>(
    "#plan-button"
  );

const runGoalButton =
  $<HTMLButtonElement>(
    "#run-goal"
  );

const goalInput =
  $<HTMLInputElement>(
    "#goal"
  );

const denyButton =
  $<HTMLButtonElement>(
    "#deny"
  );

const slowButton =
  $<HTMLButtonElement>(
    "#slow"
  );

const revokeButton =
  $<HTMLButtonElement>(
    "#revoke"
  );

const replayButton =
  $<HTMLButtonElement>(
    "#replay"
  );

const scene =
  new THREE.Scene();

scene.background =
  new THREE.Color(
    0x20252b
  );

const camera =
  new THREE.PerspectiveCamera(
    50,
    window.innerWidth /
      window.innerHeight,
    0.1,
    100
  );

camera.position.set(
  8,
  7,
  10
);

camera.lookAt(
  0,
  0,
  0
);

const renderer =
  new THREE.WebGLRenderer({
    antialias: true
  });

renderer.setPixelRatio(
  Math.min(
    window.devicePixelRatio,
    2
  )
);

renderer.setSize(
  window.innerWidth,
  window.innerHeight
);

app.appendChild(
  renderer.domElement
);

scene.add(
  new THREE.HemisphereLight(
    0xffffff,
    0x444444,
    2.5
  )
);

const floor =
  new THREE.Mesh(
    new THREE.PlaneGeometry(
      12,
      10
    ),

    new THREE.MeshStandardMaterial({
      color: 0x50555c
    })
  );

floor.rotation.x =
  -Math.PI / 2;

scene.add(
  floor
);

const astra =
  new THREE.Mesh(
    new THREE.CapsuleGeometry(
      0.35,
      1.2,
      8,
      16
    ),

    new THREE.MeshStandardMaterial({
      color: 0xdadada
    })
  );

astra.position.set(
  0,
  1,
  0
);

scene.add(
  astra
);

const homeMarker =
  new THREE.Mesh(
    new THREE.RingGeometry(
      0.4,
      0.52,
      32
    ),

    new THREE.MeshStandardMaterial({
      color: 0xeeeeee,
      side: THREE.DoubleSide
    })
  );

homeMarker.rotation.x =
  -Math.PI / 2;

homeMarker.position.set(
  0,
  0.02,
  0
);

scene.add(
  homeMarker
);

const meetingRoom =
  new THREE.Mesh(
    new THREE.BoxGeometry(
      2.5,
      0.05,
      2.5
    ),

    new THREE.MeshStandardMaterial({
      color: 0x7b8189
    })
  );

meetingRoom.position.set(
  4,
  0.03,
  -2
);

scene.add(
  meetingRoom
);

let target =
  astra.position.clone();

let runningIntentId:
  string | null =
    null;

let activeTaskId:
  string | null =
    null;

function animate() {
  requestAnimationFrame(
    animate
  );

  astra.position.lerp(
    target,
    0.04
  );

  renderer.render(
    scene,
    camera
  );
}

animate();

const requestedRuntimePort = Number(new URLSearchParams(window.location.search)
  .get("runtimePort") ?? "8787");
const runtimePort = Number.isInteger(requestedRuntimePort) &&
  requestedRuntimePort >= 1 && requestedRuntimePort <= 65535
  ? requestedRuntimePort : 8787;
const ws = new WebSocket(`ws://127.0.0.1:${runtimePort}`);

function send(
  message: unknown
) {
  if (
    ws.readyState !==
    WebSocket.OPEN
  ) {
    status.textContent =
      "Runtime disconnected";

    return;
  }

  ws.send(
    JSON.stringify(
      message
    )
  );
}

function makeIntent(
  action: string,
  extra: Record<
    string,
    unknown
  > = {}
) {
  return {
    id:
      crypto.randomUUID(),

    actorId:
      "astra",

    action,

    provenance: {
      source:
        "human"
    },

    ...extra
  };
}

function sendIntent(
  intent: any
) {
  if (
    intent.action ===
      "use_tool" &&
    intent.parameters?.tool ===
      "demo.slow"
  ) {
    runningIntentId =
      intent.id;
  }

  send({
    type:
      "action.intent",

    intent
  });
}

function eventClass(
  type: string
) {
  if (
    type === "task.completed" ||
    type ===
      "observation.confirmed"
  ) {
    return "success";
  }

  if (
    type === "task.failed" ||
    type ===
      "policy.denied" ||
    type ===
      "execution.failed" ||
    type ===
      "execution.revoked" ||
    type ===
      "plan.validation_failed"
  ) {
    return "failure";
  }

  if (
    type.startsWith("plan.") ||
    type.startsWith("inference.")
  ) {
    return "planning";
  }

  if (
    type.startsWith("execution.")
  ) {
    return "execution";
  }

  return "";
}

type ControlSnapshot = {
  effects: Array<{
    id: string; taskId: string; action: string; resourceIds: string[];
    status: string; taskStatus: string | null; reservationStatuses: string[];
    transitions: Array<{ type: string; status: string; at: number }>;
    observations: Array<{ status: string; source: string; at: number }>;
    reconciliation: { jobStatus: string | null;
      decisions: Array<{ outcome: string; at: number }> };
  }>;
};

function renderControlSnapshot(snapshot: ControlSnapshot) {
  controlPlane.replaceChildren();
  if (!snapshot.effects.length) {
    controlPlane.textContent = "No governed effects recorded yet.";
    return;
  }
  const fact = (card: HTMLElement, value: string) => {
    const line = document.createElement("div");
    line.className = "control-fact";
    line.textContent = value;
    card.appendChild(line);
  };
  for (const effect of snapshot.effects) {
    const card = document.createElement("article");
    card.className = "control-effect";
    card.dataset.status = effect.status;
    const heading = document.createElement("strong");
    heading.textContent = `${effect.action} · ${effect.status.toUpperCase()}`;
    card.appendChild(heading);
    fact(card, `effect ${effect.id.slice(0, 12)} · task ${effect.taskId.slice(0, 12)}`);
    fact(card, `resource ${effect.resourceIds.join(", ")}`);
    fact(card, `task ${effect.taskStatus ?? "unknown"} · budget ${effect.reservationStatuses.join(", ") || "none"}`);
    for (const transition of effect.transitions) {
      fact(card, `${new Date(transition.at).toLocaleTimeString()}  ${transition.type} → ${transition.status}`);
    }
    for (const observation of effect.observations) {
      fact(card, `${new Date(observation.at).toLocaleTimeString()}  observation ${observation.status} (${observation.source})`);
    }
    for (const decision of effect.reconciliation.decisions) {
      fact(card, `${new Date(decision.at).toLocaleTimeString()}  reconciliation ${decision.outcome}`);
    }
    if (effect.status === "unknown") {
      fact(card, `reconciliation job ${effect.reconciliation.jobStatus ?? "not queued"}`);
    }
    controlPlane.appendChild(card);
  }
}

function renderEvent(
  event: any,
  replay = false
) {
  const line =
    document.createElement(
      "div"
    );

  line.className =
    `event ${eventClass(event.type)}`;

  const left =
    document.createElement(
      "div"
    );

  left.className =
    "event-type";

  left.textContent =
    `${replay ? "R · " : ""}${event.type}`;

  const right =
    document.createElement(
      "div"
    );

  const refs: string[] =
    [];

  if (event.taskId) {
    refs.push(
      `task=${event.taskId.slice(0, 8)}`
    );
  }

  if (event.intentId) {
    refs.push(
      `intent=${event.intentId.slice(0, 8)}`
    );
  }

  right.textContent =
    refs.join(" ");

  line.append(
    left,
    right
  );

  timeline.appendChild(
    line
  );

  if (
    !replay &&
    event.type !==
      "agent.moved" &&
    event.type !==
      "agent.said"
  ) {
    current.textContent =
      event.type;
  }

  if (
    event.type ===
    "agent.moved"
  ) {
    const position =
      event.payload?.position;

    if (
      Array.isArray(position) &&
      position.length >= 3
    ) {
      const [x, y, z] =
        position;

      target =
        new THREE.Vector3(
          x,
          y + 0.5,
          z
        );
    }
  }

  if (
    event.type ===
    "agent.said"
  ) {
    current.textContent =
      `${replay ? "REPLAY " : ""}` +
      `Astra: ${event.payload?.text ?? ""}`;
  }

  if (
    event.type ===
    "task.created"
  ) {
    activeTaskId =
      event.taskId ?? null;

    taskBox.textContent =
      `TASK CREATED\n` +
      `id: ${event.taskId}\n` +
      `goal: ${event.payload?.goal ?? ""}`;
  }

  if (
    event.type ===
    "plan.proposed" &&
    event.taskId ===
      activeTaskId
  ) {
    planBox.textContent =
      `PLAN PROPOSED\n\n` +
      JSON.stringify(
        event.payload,
        null,
        2
      );
  }

  if (
    event.type ===
    "task.completed"
  ) {
    taskBox.textContent =
      `TASK COMPLETED\n` +
      `id: ${event.taskId}\n` +
      `actions: ${event.payload?.actionCount ?? "?"}`;
  }

  if (
    event.type ===
    "task.failed"
  ) {
    taskBox.textContent =
      `TASK FAILED\n` +
      `id: ${event.taskId}\n` +
      `reason: ${event.payload?.reason ?? "unknown"}\n` +
      `${event.payload?.detail ?? event.payload?.error ?? ""}`;
  }
}

goRoom.addEventListener(
  "click",
  () => {
    sendIntent(
      makeIntent(
        "goto",
        {
          targetId:
            "meeting_room"
        }
      )
    );
  }
);

goHome.addEventListener(
  "click",
  () => {
    sendIntent(
      makeIntent(
        "goto",
        {
          targetId:
            "home_point"
        }
      )
    );
  }
);

sayButton.addEventListener(
  "click",
  () => {
    sendIntent(
      makeIntent(
        "say",
        {
          parameters: {
            text:
              sayText.value
          }
        }
      )
    );
  }
);

healthButton.addEventListener(
  "click",
  () => {
    planBox.textContent =
      "Checking llama.cpp…";

    send({
      type:
        "inference.health.request"
    });
  }
);

planButton.addEventListener(
  "click",
  () => {
    planBox.textContent =
      "Proposal mode: asking local model. Nothing will execute.";

    send({
      type:
        "agent.plan.request",

      goal:
        goalInput.value
    });
  }
);

runGoalButton.addEventListener(
  "click",
  () => {
    timeline.innerHTML =
      "";

    taskBox.textContent =
      "Creating governed task…";

    planBox.textContent =
      "The model may propose actions, but every action must pass Policy → Execution → Observation.";

    send({
      type:
        "agent.goal.run",

      goal:
        goalInput.value
    });
  }
);

denyButton.addEventListener(
  "click",
  () => {
    sendIntent(
      makeIntent(
        "purchase_compute",
        {
          parameters: {
            units: 100
          },

          constraints: {
            maxCost: 10
          }
        }
      )
    );
  }
);

slowButton.addEventListener(
  "click",
  () => {
    const intent =
      makeIntent(
        "use_tool",
        {
          parameters: {
            tool:
              "demo.slow"
          }
        }
      );

    runningIntentId =
      intent.id;

    sendIntent(
      intent
    );
  }
);

revokeButton.addEventListener(
  "click",
  () => {
    if (
      !runningIntentId
    ) {
      current.textContent =
        "No running revocable action.";

      return;
    }

    send({
      type:
        "action.revoke",

      intentId:
        runningIntentId
    });
  }
);

replayButton.addEventListener(
  "click",
  () => {
    timeline.innerHTML =
      "";

    send({
      type:
        "replay.request",

      limit:
        50
    });
  }
);

ws.addEventListener(
  "open",
  () => {
    status.textContent =
      "Connected to Agent Runtime";
    send({ type: "control.snapshot.request" });
  }
);

window.setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    send({ type: "control.snapshot.request" });
  }
}, 2000);

ws.addEventListener(
  "message",
  event => {
    const message =
      JSON.parse(
        event.data
      );

    if (
      message.type ===
      "runtime.ready"
    ) {
      status.textContent =
        `Connected · ${message.eventCount ?? 0} event(s) stored`;

      return;
    }

    if (message.type === "control.snapshot") {
      renderControlSnapshot(message.snapshot as ControlSnapshot);
      return;
    }

    if (
      message.type ===
      "runtime.event"
    ) {
      renderEvent(
        message.event,
        false
      );

      if (
        message.event.intentId ===
          runningIntentId &&
        (
          message.event.type ===
            "execution.revoked" ||
          message.event.type ===
            "observation.confirmed" ||
          message.event.type ===
            "execution.failed"
        )
      ) {
        runningIntentId =
          null;
      }

      return;
    }

    if (
      message.type ===
      "world.event"
    ) {
      return;
    }

    if (
      message.type ===
      "inference.health.result"
    ) {
      planBox.textContent =
        JSON.stringify(
          message.health,
          null,
          2
        );

      return;
    }

    if (
      message.type ===
      "agent.plan.proposed"
    ) {
      planBox.textContent =
        `PROPOSAL ONLY — NOT EXECUTED\n\n` +
        JSON.stringify(
          message.proposal,
          null,
          2
        );

      return;
    }

    if (
      message.type ===
      "agent.goal.result"
    ) {
      if (
        message.result?.ok
      ) {
        taskBox.textContent +=
          `\n\nRuntime result: completed.`;
      } else {
        taskBox.textContent +=
          `\n\nRuntime result: failed.\n${message.result?.reason ?? ""}`;
      }

      return;
    }

    if (
      message.type ===
      "replay.started"
    ) {
      current.textContent =
        `Replay started: ${message.count} event(s)`;

      return;
    }

    if (
      message.type ===
      "replay.event"
    ) {
      renderEvent(
        message.event,
        true
      );

      return;
    }

    if (
      message.type ===
      "replay.completed"
    ) {
      current.textContent =
        `Replay completed: ${message.count} event(s)`;

      return;
    }

    if (
      message.type ===
      "revoke.result"
    ) {
      current.textContent =
        message.revoked
          ? `Revocation requested for ${String(message.intentId).slice(0, 8)}`
          : "Nothing was running for that intent.";

      return;
    }

    if (
      message.type ===
      "runtime.error"
    ) {
      taskBox.textContent =
        `RUNTIME ERROR\n${message.error}`;

      return;
    }
  }
);

ws.addEventListener(
  "close",
  () => {
    status.textContent =
      "Runtime disconnected";
  }
);

window.addEventListener(
  "resize",
  () => {
    camera.aspect =
      window.innerWidth /
      window.innerHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
      window.innerWidth,
      window.innerHeight
    );
  }
);
