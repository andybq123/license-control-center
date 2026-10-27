import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(process.env.DB_FILE || path.join(DATA_DIR, "licenses.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  document TEXT,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  license_key TEXT NOT NULL UNIQUE,
  product TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  expires_at TEXT,
  max_installs INTEGER NOT NULL DEFAULT 1,
  allowed_domains TEXT NOT NULL DEFAULT '',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS installations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  url TEXT,
  ip TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  app_version TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (license_id, instance_id)
);
CREATE TABLE IF NOT EXISTS install_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER,
  license_key TEXT,
  instance_id TEXT,
  domain TEXT,
  event TEXT NOT NULL,
  result TEXT,
  message TEXT,
  app_version TEXT,
  ip TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  ip TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migrações leves (bancos antigos)
for (const col of ["lat REAL", "lon REAL", "block_reason TEXT"]) {
  try { db.exec(`ALTER TABLE installations ADD COLUMN ${col}`); } catch { /* já existe */ }
}
