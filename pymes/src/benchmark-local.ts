import { totalmem, platform, arch } from "node:os";
import { classifyDemoText } from "./local-classifier.js";

// Sequential requests reflect the intended single-user appliance workload.
const samples = [
  "Quiero comparar un seguro de hogar para mi vivienda.",
  "He tenido un golpe con el coche y necesito comunicar un parte.",
  "Soy autónoma y necesito presupuesto de responsabilidad civil.",
  "Quiero información sobre un seguro de vida.",
  "¿Podemos cambiar nuestra cita al jueves por la mañana?"
];
const latencies: number[] = [];
const startedAt = new Date().toISOString();
const model = process.env.PYMES_LOCAL_MODEL ?? "llama3.2:3b";
console.log(JSON.stringify({ event: "benchmark_started", startedAt, model,
  platform: platform(), architecture: arch(), memoryGiB: Math.round(totalmem() / 2 ** 30),
  samples: samples.length, concurrency: 1, data: "fictional" }));
for (let index = 0; index < samples.length; index++) {
  try {
    const result = await classifyDemoText({ text: samples[index]!, model,
      baseUrl: process.env.PYMES_LOCAL_LLM_URL ?? "http://127.0.0.1:11434" });
    latencies.push(result.latencyMs);
    console.log(JSON.stringify({ event: "sample_completed", sample: index + 1,
      latencyMs: Math.round(result.latencyMs), proposal: result.proposal }));
  } catch {
    // Avoid dumping errors that may contain URLs or provider response bodies.
    console.error(JSON.stringify({ event: "benchmark_failed", sample: index + 1,
      message: "No se completó la clasificación. Comprueba Ollama, el modelo y la dirección local." }));
    process.exitCode = 1;
    break;
  }
}
if (latencies.length === samples.length) {
  console.log(JSON.stringify({ event: "benchmark_completed", model,
    firstRequestMs: Math.round(latencies[0]!),
    meanMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    maxMs: Math.round(Math.max(...latencies)),
    note: "Mide latencia de clasificación; no mide memoria del modelo ni certifica rendimiento en 16 GB." }));
}
