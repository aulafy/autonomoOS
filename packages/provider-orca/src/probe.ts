import { OrcaCliTransport } from "./cli-transport.js";
import { decodeOrcaStatus } from "./decoder-v1.js";
const executable = process.env.AWOS_ORCA_EXECUTABLE ?? "/Applications/Orca.app/Contents/Resources/bin/orca";
const result = await new OrcaCliTransport(executable).call(["status", "--json"]);
let availability;
if (result.status !== "completed" || result.exitCode !== 0) availability = { status: "unavailable", reason: result.status === "completed" ? "orca_cli_failed" : result.reason };
else {
  try { availability = decodeOrcaStatus(result.stdout); }
  catch { availability = { status: "unavailable", reason: "orca_malformed_response" }; }
}
console.log(JSON.stringify(availability));
if (availability.status !== "available") process.exitCode = 1;
