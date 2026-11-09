import { defineConfig } from "tsup";

// Node-only ESM: pdfjs-dist stays external (it is a dependency), the CLI gets a shebang.
export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm"],
  dts: { entry: { index: "src/index.ts" } },
  target: "node20",
  platform: "node",
  clean: true,
});
