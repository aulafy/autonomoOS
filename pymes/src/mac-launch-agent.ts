import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const xml = (value: string) => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
}[char]!));
export function makeUiLaunchAgent(input: { node: string; project: string; logs: string }): string {
  for (const value of Object.values(input)) {
    if (!isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("ABSOLUTE_PATH_REQUIRED");
  }
  const args = [input.node, "--import", "tsx", resolve(input.project, "src/ui-server.ts")];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.pymes.os.ui</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(input.project)}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(resolve(input.logs, "ui.log"))}</string>
<key>StandardErrorPath</key><string>${xml(resolve(input.logs, "ui-error.log"))}</string>
</dict></plist>\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const project = resolve(import.meta.dirname, "..");
  const logs = process.argv[2];
  if (!logs) throw new Error("USAGE: npm run mac:launch-agent -- /absolute/log/directory");
  process.stdout.write(makeUiLaunchAgent({ node: process.execPath, project, logs }));
}
