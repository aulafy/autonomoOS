const { parentPort, workerData } = require('node:worker_threads');
try {
  const Ajv = require(workerData.ajvPath);
  const ajv = new Ajv({ strict: true, ownProperties: true, logger: false });
  const validate = ajv.compile(workerData.schema);
  if (validate.$async) throw new Error('ASYNC_SCHEMA_UNSUPPORTED');
  parentPort.postMessage({ status: 'evaluated', valid: validate(workerData.value) === true });
} catch { parentPort.postMessage({ status: 'unknown' }); }
