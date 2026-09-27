import { ApiEndpointRegistry, type CredentialProvider } from "@agent-world/http-api";
import { createDurableDomainStores, JournalKernel, ReplayClock,
  RuntimeDatabase } from "@agent-world/runtime-store-sqlite";
import { WorldRuntime } from "@agent-world/world-core";
import { createDemoControlPlane } from "../../src/demo-control-plane.js";

const database = new RuntimeDatabase(process.env.H4_RUNTIME_DB!);
const kernel = new JournalKernel(database, new ReplayClock());
const stores = createDurableDomainStores(kernel);
await kernel.restore();
const endpoints = new ApiEndpointRegistry(stores.resources);
const binding = endpoints.register({ serviceName: "demo-api",
  origin: process.env.H4_API_ORIGIN!, credentialRef: "demo-api-default",
  allowFixtureLoopback: true, certifiesRejectedNoEffect: true });
const credentials: CredentialProvider = { getCredential: ref =>
  ref === "demo-api-default" ? process.env.H4_API_TOKEN ?? null : null };
const crashAt = process.env.H4_CRASH_AT;
const kill = () => process.kill(process.pid, "SIGKILL");
const control = createDemoControlPlane(new WorldRuntime(), event =>
  database.appendRuntimeEvent(event), { kernel, stores,
  httpApi: { endpoints, credentials,
    afterRequest: crashAt === "after-post" ? kill : undefined },
  beforePreparedDispatch: crashAt === "prepared" ? kill : undefined,
  beforeExecutorDispatch: crashAt === "dispatching" ? kill : undefined });
control.recoverOnStartup();
const taskId = `crash:${crashAt}`;
await control.prepareGoalTask({ taskId, principalId: "astra",
  targetId: binding.endpointId, action: "api.create_record", objective: "Create alpha" });
const parameters = { name: "alpha", value: 42 };
const objectId = await control.stageTrustedContent(taskId, "astra",
  JSON.stringify(parameters), { confidentiality: "public", categories: [],
    jurisdictions: [], ownerPrincipalIds: [], releasable: true, metadata: {} });
await control.run({ id: `intent:${taskId}`, actorId: "astra",
  action: "api.create_record", targetId: binding.endpointId, parameters,
  provenance: { source: "human" } }, taskId, taskId, undefined, undefined,
{ flowObjectIds: [objectId] });
database.close();
