import { findHoldedContactsByPhone, listGoogleCalendarEvents } from "./connectors.js";

/** Local server-side probe. Outputs counts only; never emits raw provider records. */
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "holded") {
    if (args.length !== 1) throw new Error("USAGE: holded <phone>");
    const contacts = await findHoldedContactsByPhone({
      apiKey: process.env.PYMES_HOLDED_API_KEY ?? "", phone: args[0]!
    });
    process.stdout.write(JSON.stringify({ provider: "holded", result: "read_only",
      matches: contacts.length }) + "\n");
    return;
  }
  if (command === "calendar") {
    if (args.length !== 2) throw new Error("USAGE: calendar <timeMin> <timeMax>");
    const events = await listGoogleCalendarEvents({
      accessToken: process.env.PYMES_GOOGLE_ACCESS_TOKEN ?? "",
      calendarId: process.env.PYMES_GOOGLE_CALENDAR_ID ?? "",
      timeMin: args[0]!, timeMax: args[1]!
    });
    process.stdout.write(JSON.stringify({ provider: "google_calendar", result: "read_only",
      events: events.length, allDay: events.filter(event => event.allDay).length }) + "\n");
    return;
  }
  throw new Error("USAGE: pilot:read -- holded <phone> | calendar <timeMin> <timeMax>");
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "UNKNOWN_READ_FAILURE";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
