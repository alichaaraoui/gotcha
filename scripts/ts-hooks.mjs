// Lets plain `node` (22.6+, type stripping) import our TS lib code: resolves "@/…", extensionless
// imports and JSON. No dev server, no extra deps. Used by score-demo.mjs.
import { statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(spec, ctx, next) {
  let path = null;
  if (spec.startsWith("@/")) path = join(root, spec.slice(2));
  else if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.endsWith(".ts")) path = join(dirname(fileURLToPath(ctx.parentURL)), spec);
  if (path) {
    for (const p of [path, `${path}.ts`, `${path}.tsx`, join(path, "index.ts")]) {
      if (statSync(p, { throwIfNoEntry: false })?.isFile()) {
        const url = pathToFileURL(p).href;
        return { url, shortCircuit: true, importAttributes: p.endsWith(".json") ? { type: "json" } : ctx.importAttributes };
      }
    }
  }
  return next(spec, ctx);
}

export async function load(url, ctx, next) {
  if (url.endsWith(".json")) return next(url, { ...ctx, importAttributes: { type: "json" } });
  if (url.endsWith(".ts")) return next(url, { ...ctx, format: "module-typescript" });
  return next(url, ctx);
}
