import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import type { JsonValue } from "@agent-world/task-runtime";
const ajvPath=createRequire(import.meta.url).resolve("ajv");
export async function evaluateSchema(schema:JsonValue,value:JsonValue,signal:AbortSignal,timeoutMs=1000):Promise<boolean|undefined> {
  if (signal.aborted || JSON.stringify(schema).length>65536 || JSON.stringify(value).length>1048576) return undefined;
  return new Promise(resolve => {
    const worker=new Worker(new URL("./schema-worker.cjs",import.meta.url),{ workerData:{ schema,value,ajvPath },resourceLimits:{ maxOldGenerationSizeMb:32,maxYoungGenerationSizeMb:8 } });
    let settled=false;
    const finish=(value:boolean|undefined) => { if (settled) return; settled=true; clearTimeout(timer); signal.removeEventListener("abort",abort); void worker.terminate(); resolve(value); };
    const abort=() => finish(undefined),timer=setTimeout(abort,timeoutMs);
    signal.addEventListener("abort",abort,{ once:true });
    worker.on("message",(message:unknown) => {
      const result=message as { status?:string; valid?:boolean };
      finish(result?.status==="evaluated" && typeof result.valid==="boolean" ? result.valid : undefined);
    });
    worker.on("error",abort); worker.on("exit",() => finish(undefined));
  });
}
