import { gmailRuntime, approveEmail } from "./gmail-runtime.js";
const [path, endpoint] = process.argv.slice(2);
const fetcher: typeof fetch = (input, init) =>
  fetch(
    endpoint + new URL(String(input)).pathname + new URL(String(input)).search,
    init,
  );
const f = await gmailRuntime(path!, fetcher);
await approveEmail(f);
await f.runtime.source.email!.execute("job", "owner");
f.close();
