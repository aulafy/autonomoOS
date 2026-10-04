import { gmailRuntime } from "./gmail-runtime.js";
import { createP01ResponseLoss } from "../../src/gmail-fault-injection.js";
import { P01_TEST_ARM, approveP01Email } from "./gmail-fault.js";
const [path, endpoint, armPath] = process.argv.slice(2);
const base: typeof fetch = (input, init) =>
  fetch(
    endpoint + new URL(String(input)).pathname + new URL(String(input)).search,
    init,
  );
const harness = createP01ResponseLoss(base, armPath!, P01_TEST_ARM);
const f = await gmailRuntime(path!, harness.fetcher);
await approveP01Email(f);
await f.runtime.source.email!.execute("job", "owner").catch(() => null);
// The view is read back from the journal-backed projection after execute settles.
process.send!({
  status: f.runtime.source.email!.view("job", "owner").status,
  phase: harness.state()?.phase ?? null,
});
// Stay alive like the pilot API until the parent sends SIGKILL.
setInterval(() => {}, 1000);
