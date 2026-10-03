const fs = require('node:fs');
const path = require('node:path');
const [folder, scenario, ...args] = process.argv.slice(2);
const emit = result => process.stdout.write(JSON.stringify({ ok: true, result }));
const receiptsPath = path.join(folder, 'receipts.json');
const receipts = fs.existsSync(receiptsPath) ? JSON.parse(fs.readFileSync(receiptsPath, 'utf8')) : {};
const requestId = args[args.indexOf('--retry-request') + 1];
function recordReceipt(method, result) {
  receipts[requestId] = { method, result };
  fs.writeFileSync(receiptsPath, JSON.stringify(receipts));
}
if (args[0] === 'status') {
  if (scenario === 'probe-timeout') setInterval(() => {}, 1000);
  else emit({ target: { kind: 'local' }, runtime: { state: 'ready', reachable: true, capabilities: ['orchestration.contract.v1'] } });
} else if (args[1] === 'run-create') {
  fs.appendFileSync(path.join(folder, 'calls.jsonl'), JSON.stringify(args) + '\n');
  if (receipts[requestId]) emit(receipts[requestId].result);
  else { recordReceipt('orchestration.runCreate', { run: { id: 'run-1' } }); emit({ run: { id: 'run-1' } }); }
} else if (args[1] === 'worker-start') {
  fs.appendFileSync(path.join(folder, 'calls.jsonl'), JSON.stringify(args) + '\n');
  if (receipts[requestId]) emit(receipts[requestId].result);
  else if (scenario.startsWith('recover-')) {
    recordReceipt('orchestration.workerStart', { state: 'ready', dispatchId: 'dispatch-1', taskId: 'provider-task-1' });
    fs.appendFileSync(path.join(folder, 'effects.jsonl'), 'worker-created\n');
    process.stdout.write('lost-response');
  }
  else if (scenario === 'dispatch-timeout') setInterval(() => {}, 1000);
  else if (scenario === 'malformed') process.stdout.write('bad-json');
  else {
    const result = { state: scenario === 'unknown-start' ? 'outcome_unknown' : 'ready', dispatchId: 'dispatch-1', taskId: 'provider-task-1' };
    recordReceipt('orchestration.workerStart', result); emit(result);
  }
} else if (args[1] === 'request-show') {
  const key = args[args.indexOf('--request') + 1], receipt = receipts[key];
  const state = scenario === 'recover-absent' ? 'absent' : scenario === 'recover-pending' ? 'pending' : 'completed';
  emit({ requestId: scenario === 'recover-stale' ? 'other-request' : key, state: receipt ? state : 'absent',
    ...(receipt && state !== 'absent' ? { method: scenario === 'recover-wrong-method' ? 'orchestration.reply' : receipt.method,
      receipt: { ...receipt.result, mutation: { requestId: scenario === 'recover-wrong-receipt' ? 'other-request' : key } } } : {}) });
} else if (args[1] === 'worker-show') {
  const question = scenario.startsWith('question');
  emit({ dispatch: { id: scenario === 'stale' ? 'old-dispatch' : 'dispatch-1', taskId: 'provider-task-1', runId: 'run-1', assigneeHandle: 'worker-1' },
    worker: { state: question ? 'ready' : scenario === 'failed' ? 'failed' : scenario === 'unknown-observe' ? 'outcome_unknown' : 'succeeded' },
    projection: { dispatchId: scenario === 'question-stale-projection' ? 'old-dispatch' : 'dispatch-1', liveness: { verdict: question ? 'live' : 'exited' } } });
} else if (args[1] === 'inbox') {
  const base = { run_id: 'run-1', to_handle: 'run:run-1', from_handle: 'dispatch:dispatch-1', body: 'Which acceptance test?', type: 'question' };
  const payload = { taskId: 'provider-task-1', dispatchId: 'dispatch-1', options: ['Unit test', 'HTTP test'] };
  const messages = [
    { ...base, id: 'question-1', payload: JSON.stringify(payload) },
    { ...base, id: 'obsolete-question', payload: JSON.stringify({ ...payload, dispatchId: 'old-dispatch' }) },
    { ...base, id: 'other-run', run_id: 'old-run', payload: JSON.stringify(payload) },
    { ...base, id: 'wrong-sender', from_handle: 'another-worker', payload: JSON.stringify(payload) },
    { ...base, id: 'audit-only', delivery_contract: 'audit_only', payload: JSON.stringify(payload) },
    { ...base, id: 'escalation-1', type: 'escalation', body: 'Need approval', payload: JSON.stringify(payload) }
  ];
  if (scenario === 'signals-success' || scenario === 'signals-failed') messages.push({ ...base, id: 'done-1', type: 'worker_done', body: 'Done', payload: JSON.stringify({ ...payload, outcome: scenario === 'signals-failed' ? 'failed' : 'succeeded' }) });
  if (scenario === 'question-malformed') messages[0].payload = 'bad-json';
  if (scenario === 'question-conflict' && fs.existsSync(path.join(folder, 'alter-signal'))) messages[0].body = 'Altered question';
  emit({ messages, count: messages.length });
} else if (args[1] === 'reply') {
  fs.appendFileSync(path.join(folder, 'calls.jsonl'), JSON.stringify(args) + '\n');
  const result = { message: { id: 'answer-1', run_id: 'run-1', to_handle: 'dispatch:dispatch-1', thread_id: args[args.indexOf('--id') + 1], body: args[args.indexOf('--body') + 1] } };
  recordReceipt('orchestration.reply', result);
  fs.appendFileSync(path.join(folder, 'effects.jsonl'), 'answer-sent\n');
  if (scenario === 'question-lost-reply') process.stdout.write('lost-answer');
  else emit(result);
} else { process.exitCode = 2; }
