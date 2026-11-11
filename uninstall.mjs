#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PATCH_MARKER = "pi-tool-groups-patch:v0.5.0";

function fail(message) {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

function run(command, args = []) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function findPiPackage() {
  let executable;
  try {
    executable = run(process.platform === "win32" ? "where" : "which", ["pi"]).split(/\r?\n/)[0];
  } catch {
    fail("Could not find the `pi` executable in PATH.");
  }
  const realExecutable = fs.realpathSync(executable);
  let cursor = path.dirname(realExecutable);
  while (cursor !== path.dirname(cursor)) {
    const packageJson = path.join(cursor, "package.json");
    if (fs.existsSync(packageJson)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8"));
        if (pkg.name === "@earendil-works/pi-coding-agent") return { root: cursor, pkg };
      } catch {}
    }
    cursor = path.dirname(cursor);
  }
  fail("Could not locate @earendil-works/pi-coding-agent.");
}

const { root, pkg } = findPiPackage();
const chunksDir = path.join(root, "dist", "bundle", "chunks");
const candidates = fs.readdirSync(chunksDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => path.join(chunksDir, name))
  .filter((file) => fs.readFileSync(file, "utf8").includes(PATCH_MARKER));

if (candidates.length === 0) {
  console.log("Pi Tool Groups is not installed in the current Pi bundle.");
  process.exit(0);
}
if (candidates.length !== 1) fail(`Expected one patched bundle chunk, found ${candidates.length}.`);

const target = candidates[0];
const backup = path.join(os.homedir(), ".pi", "agent", "patch-backups", "pi-tool-groups", pkg.version, path.basename(target));
if (!fs.existsSync(backup)) fail(`Backup not found: ${backup}`);

const temporary = `${target}.pi-tool-groups.restore.tmp.js`;
fs.copyFileSync(backup, temporary);
try {
  run(process.execPath, ["--check", temporary]);
  fs.renameSync(temporary, target);
} catch (error) {
  try { fs.rmSync(temporary, { force: true }); } catch {}
  fail(`Restore validation failed. ${error.message}`);
}

console.log(`\n✓ Pi Tool Groups removed\n\nRestored: ${target}\n\nRestart Pi to return to the standard tool-call UI.`);
