import { defineConfig } from "vite";
import { createDemoClassifierHandler } from "./src/demo-classifier-http.js";
export default defineConfig({
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  plugins: [{ name: "pymes-demo-classifier", configureServer(server) {
    const classify = createDemoClassifierHandler("http://127.0.0.1:5174");
    server.middlewares.use(async (request, response, next) => {
      if (!await classify(request, response)) next();
    });
  } }]
});
