import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "release-bundle-budget",
      writeBundle(options, bundle) {
        const initial = new Set<string>();
        const visit = (file: string) => {
          if (initial.has(file)) return;
          const chunk = bundle[file];
          if (chunk?.type !== "chunk") return;
          initial.add(file);
          for (const dependency of chunk.imports) visit(dependency);
        };
        for (const chunk of Object.values(bundle))
          if (chunk.type === "chunk" && chunk.isEntry) visit(chunk.fileName);
        const chunks = Object.values(bundle)
          .filter((chunk) => chunk.type === "chunk")
          .map((chunk) => ({
            file: chunk.fileName,
            bytes: Buffer.byteLength(chunk.code),
            gzipBytes: gzipSync(chunk.code).length,
            initial: initial.has(chunk.fileName),
          }));
        const initialGzipBytes = chunks
          .filter((chunk) => chunk.initial)
          .reduce((sum, chunk) => sum + chunk.gzipBytes, 0);
        if (initialGzipBytes > 250000)
          this.error(`Initial JS exceeds 250 kB gzip: ${initialGzipBytes}`);
        if (chunks.some((chunk) => chunk.bytes > 500000))
          this.error("A JavaScript chunk exceeds 500 kB");
        writeFileSync(
          resolve(options.dir ?? "dist", "bundle-budget.json"),
          JSON.stringify({ initialGzipBytes, chunks }, null, 2),
        );
      },
    },
  ],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-runtime",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
            },
            {
              name: "motion",
              test: /node_modules[\\/](?:motion|framer-motion|motion-dom|motion-utils)[\\/]/,
            },
            {
              name: "rough",
              test: /node_modules[\\/](?:roughjs|hachure-fill|path-data-parser|points-on-curve|points-on-path)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
