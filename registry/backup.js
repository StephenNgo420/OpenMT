#!/usr/bin/env node
// OpenMT backups (Stage 7). Oneshot script — run daily by a systemd timer,
// not the long-running daemon. Backs up the two pieces of state that
// aren't already in git and aren't reconstructible from it:
//   1. The Work Registry SQLite DB (job history, usage ledger).
//   2. Live OpenClaw config (openclaw.json) — holds real routing/model
//      config plus provider credentials, so it never goes in git, but a
//      bad `config patch` should still be recoverable from more than just
//      the dry-run discipline already practiced.
//
// registry.sqlite runs in WAL mode; db.serialize() gives a consistent
// point-in-time snapshot as a Buffer (SQLite's own serialize format,
// safe to call against a live, concurrently-open WAL database) without
// needing a manual checkpoint dance.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = process.env.REGISTRY_DB_PATH || "/home/OpenMT/OpenMT/registry/registry.sqlite";
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || "/home/OpenMT/.openclaw/openclaw.json";
const BACKUP_ROOT = process.env.OPENMT_BACKUP_DIR || "/home/OpenMT/openmt-backups";
const RETENTION_COUNT = parseInt(process.env.OPENMT_BACKUP_RETENTION || "14", 10);

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function timestampDir() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupRegistryDb(destDir) {
  if (!fs.existsSync(DB_PATH)) {
    log("registry DB not found at", DB_PATH, "— skipping");
    return;
  }
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const buf = db.serialize();
  db.close();
  fs.writeFileSync(path.join(destDir, "registry.sqlite"), buf);
  log("backed up registry DB (", buf.length, "bytes )");
}

function backupOpenclawConfig(destDir) {
  if (!fs.existsSync(OPENCLAW_CONFIG_PATH)) {
    log("openclaw config not found at", OPENCLAW_CONFIG_PATH, "— skipping");
    return;
  }
  fs.copyFileSync(OPENCLAW_CONFIG_PATH, path.join(destDir, "openclaw.json"));
  log("backed up openclaw.json");
}

function pruneOldBackups() {
  let entries;
  try {
    entries = fs.readdirSync(BACKUP_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort(); // ISO-ish timestamp names sort chronologically
  } catch {
    return;
  }
  const excess = entries.length - RETENTION_COUNT;
  if (excess <= 0) return;
  for (const name of entries.slice(0, excess)) {
    fs.rmSync(path.join(BACKUP_ROOT, name), { recursive: true, force: true });
    log("pruned old backup:", name);
  }
}

function main() {
  const destDir = path.join(BACKUP_ROOT, timestampDir());
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  backupRegistryDb(destDir);
  backupOpenclawConfig(destDir);
  pruneOldBackups();
  log("backup complete:", destDir);
}

main();
