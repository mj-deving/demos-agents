import { cp, mkdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(packageRoot, "..", "..", "src", "lib", "sources", "providers");
const distRoot = resolve(packageRoot, "dist");

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectory(name) {
  const source = resolve(sourceRoot, name);
  if (!(await exists(source))) {
    return;
  }

  const destination = resolve(distRoot, name);
  await rm(destination, { recursive: true, force: true });
  await mkdir(distRoot, { recursive: true });
  await cp(source, destination, { recursive: true });
}

await copyDirectory("specs");
await copyDirectory("hooks");
