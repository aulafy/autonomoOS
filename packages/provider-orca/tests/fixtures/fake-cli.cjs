const mode = process.argv[2];
if (mode === 'descendant') {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", process.argv[3]], { stdio: 'ignore' });
  setInterval(() => {}, 1000);
}
else if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'large') process.stdout.write('x'.repeat(4096));
else if (mode === 'invalid') process.stdout.write('not-json');
else if (mode === 'args') process.stdout.write(JSON.stringify(process.argv.slice(3)));
else if (mode === 'unavailable') process.stdout.write(JSON.stringify({ ok: true, result: { target: { kind: 'local' }, runtime: { state: 'not_running', reachable: false } } }));
else if (mode === 'failed') { process.stdout.write(JSON.stringify({ ok: false, error: { code: 'unavailable' } })); process.exitCode = 1; }
else process.stdout.write(JSON.stringify({ ok: true, result: { target: { kind: 'local' }, runtime: { state: 'ready', reachable: true, appVersion: 'fixture', capabilities: ['orchestration.contract.v1'] } } }));
