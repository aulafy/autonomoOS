import * as THREE from "three";

const $ = <T extends HTMLElement>(q: string) =>
  document.querySelector<T>(q)!;

const status = $("#status");
const current = $("#current");
const timeline = $("#timeline");
const planBox = $("#plan");
const app = $("#app");

const goRoom = $<HTMLButtonElement>("#go-room");
const goHome = $<HTMLButtonElement>("#go-home");
const sayButton = $<HTMLButtonElement>("#say");
const sayText = $<HTMLInputElement>("#say-text");
const healthButton = $<HTMLButtonElement>("#health");
const planButton = $<HTMLButtonElement>("#plan-button");
const goalInput = $<HTMLInputElement>("#goal");
const denyButton = $<HTMLButtonElement>("#deny");
const slowButton = $<HTMLButtonElement>("#slow");
const revokeButton = $<HTMLButtonElement>("#revoke");
const replayButton = $<HTMLButtonElement>("#replay");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20252b);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);

camera.position.set(8, 7, 10);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.5));

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 10),
  new THREE.MeshStandardMaterial({ color: 0x50555c })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const astra = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.35, 1.2, 8, 16),
  new THREE.MeshStandardMaterial({ color: 0xdadada })
);
astra.position.set(0, 1, 0);
scene.add(astra);

const homeMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.4, 0.52, 32),
  new THREE.MeshStandardMaterial({
    color: 0xeeeeee,
    side: THREE.DoubleSide
  })
);
homeMarker.rotation.x = -Math.PI / 2;
homeMarker.position.set(0, 0.02, 0);
scene.add(homeMarker);

const meetingRoom = new THREE.Mesh(
  new THREE.BoxGeometry(2.5, 0.05, 2.5),
  new THREE.MeshStandardMaterial({ color: 0x7b8189 })
);
meetingRoom.position.set(4, 0.03, -2);
scene.add(meetingRoom);

let target = astra.position.clone();
let runningIntentId: string | null = null;

function animate() {
  requestAnimationFrame(animate);
  astra.position.lerp(target, 0.04);
  renderer.render(scene, camera);
}
animate();

const ws = new WebSocket("ws://localhost:8787");

function send(message: unknown) {
  if (ws.readyState !== WebSocket.OPEN) {
    status.textContent = "Runtime disconnected";
    return;
  }

  ws.send(JSON.stringify(message));
}

function makeIntent(
  action: string,
  extra: Record<string, unknown> = {}
) {
  return {
    id: crypto.randomUUID(),
    actorId: "astra",
    action,
    provenance: {
      source: "human"
    },
    ...extra
  };
}

function sendIntent(intent: any) {
  if (
    intent.action === "use_tool" &&
    intent.parameters?.tool === "demo.slow"
  ) {
    runningIntentId = intent.id;
  }

  send({
    type: "action.intent",
    intent
  });
}

function renderEvent(event: any, replay = false) {
  const line = document.createElement("div");
  line.className = "event";

  line.textContent =
    `${replay ? "REPLAY " : ""}${event.type}` +
    `${event.intentId ? ` · ${event.intentId.slice(0,8)}` : ""}`;

  timeline.appendChild(line);
  timeline.scrollTop = timeline.scrollHeight;

  if (event.type === "agent.moved") {
    const [x, y, z] = event.payload.position;
    target = new THREE.Vector3(x, y + 0.5, z);
  }

  if (event.type === "agent.said") {
    current.textContent =
      `${replay ? "REPLAY " : ""}Astra: ${event.payload.text}`;
  } else if (!replay) {
    current.textContent = event.type;
  }
}

goRoom.addEventListener("click", () => {
  sendIntent(makeIntent("goto", {
    targetId: "meeting_room"
  }));
});

goHome.addEventListener("click", () => {
  sendIntent(makeIntent("goto", {
    targetId: "home_point"
  }));
});

sayButton.addEventListener("click", () => {
  sendIntent(makeIntent("say", {
    parameters: {
      text: sayText.value
    }
  }));
});

healthButton.addEventListener("click", () => {
  planBox.textContent = "Checking llama.cpp…";

  send({
    type: "inference.health.request"
  });
});

planButton.addEventListener("click", () => {
  planBox.textContent =
    "Asking the local model for a proposal. Nothing will execute.";

  send({
    type: "agent.plan.request",
    goal: goalInput.value
  });
});

denyButton.addEventListener("click", () => {
  sendIntent(makeIntent("purchase_compute", {
    parameters: {
      units: 100
    },
    constraints: {
      maxCost: 10
    }
  }));
});

slowButton.addEventListener("click", () => {
  const intent = makeIntent("use_tool", {
    parameters: {
      tool: "demo.slow"
    }
  });

  runningIntentId = intent.id;
  sendIntent(intent);
});

revokeButton.addEventListener("click", () => {
  if (!runningIntentId) {
    current.textContent = "No running revocable action.";
    return;
  }

  send({
    type: "action.revoke",
    intentId: runningIntentId
  });
});

replayButton.addEventListener("click", () => {
  timeline.innerHTML = "";

  send({
    type: "replay.request",
    limit: 30
  });
});

ws.addEventListener("open", () => {
  status.textContent = "Connected to Agent Runtime";
});

ws.addEventListener("message", e => {
  const message = JSON.parse(e.data);

  if (message.type === "runtime.ready") {
    status.textContent =
      `Connected · ${message.eventCount ?? 0} event(s) stored`;
    return;
  }

  if (message.type === "runtime.event") {
    renderEvent(message.event, false);

    if (
      message.event.intentId === runningIntentId &&
      (
        message.event.type === "execution.revoked" ||
        message.event.type === "observation.confirmed" ||
        message.event.type === "execution.failed"
      )
    ) {
      runningIntentId = null;
    }

    return;
  }

  if (message.type === "world.event") {
    return;
  }

  if (message.type === "inference.health.result") {
    planBox.textContent = JSON.stringify(
      message.health,
      null,
      2
    );
    return;
  }

  if (message.type === "agent.plan.proposed") {
    planBox.textContent =
      `PROPOSAL ONLY — NOT EXECUTED\n\n` +
      JSON.stringify(message.proposal, null, 2);
    return;
  }

  if (message.type === "replay.event") {
    renderEvent(message.event, true);
    return;
  }

  if (message.type === "replay.completed") {
    current.textContent =
      `Replay completed: ${message.count} event(s)`;
    return;
  }

  if (message.type === "runtime.error") {
    planBox.textContent =
      `Runtime error:\n${message.error}`;
  }
});

ws.addEventListener("close", () => {
  status.textContent = "Runtime disconnected";
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
