import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: { rollupOptions: { input: {
    console: resolve(import.meta.dirname, "index.html"),
    demo: resolve(import.meta.dirname, "demo.html")
  } } }
});
