import { GmailInboxSync } from "../../src/gmail-inbox-sync.js";
import { InboxStore } from "../../src/inbox-store.js";
import { fakeGmail, mailbox, credentialSource, NOW } from "./gmail-inbox-fake.js";
const [path] = process.argv.slice(2);
let full = 0;
const g = fakeGmail(mailbox(20), {
  onRequest: async (p) => {
    if (p.includes("format=full") && ++full === 8) {
      process.send!("mid-fetch"); // some batches already committed
      await new Promise(() => {}); // hang until SIGKILL
    }
  },
});
const store = new InboxStore(path!, () => NOW);
await new GmailInboxSync(credentialSource().source, store, { tenant: "agency", owner: "owner" }, g.fetcher, { listPageSize: 4, maxCandidates: 100, selectionCap: 50, batchSize: 3 }, () => NOW).fullSync();
