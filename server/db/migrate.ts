import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeDb, getDb } from './client.ts'

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url))

function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function ensureMigrationsTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
}

function appliedMigrations(): Set<string> {
  ensureMigrationsTable()
  const rows = getDb().prepare('SELECT name FROM _migrations').all() as { name: string }[]
  return new Set(rows.map((row) => row.name))
}

function readSql(name: string, direction: 'up' | 'down'): string {
  return readFileSync(join(MIGRATIONS_DIR, name, `${direction}.sql`), 'utf-8')
}

export function migrateUp(): string[] {
  ensureMigrationsTable()
  const applied = appliedMigrations()
  const pending = listMigrations().filter((name) => !applied.has(name))
  const db = getDb()

  for (const name of pending) {
    db.exec(readSql(name, 'up'))
    db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
      name,
      new Date().toISOString(),
    )
  }
  return pending
}

export function migrateDown(steps = 1): string[] {
  ensureMigrationsTable()
  const applied = [...appliedMigrations()].sort()
  const toRevert = applied.slice(-steps).reverse()
  const db = getDb()

  for (const name of toRevert) {
    db.exec(readSql(name, 'down'))
    db.prepare('DELETE FROM _migrations WHERE name = ?').run(name)
  }
  return toRevert
}

export function migrationStatus(): { name: string, applied: boolean }[] {
  const applied = appliedMigrations()
  return listMigrations().map((name) => ({ name, applied: applied.has(name) }))
}

function main() {
  const [, , command, arg] = process.argv

  if (command === 'up') {
    const applied = migrateUp()
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.')
  }
  else if (command === 'down') {
    const steps = arg ? Number(arg) : 1
    const reverted = migrateDown(steps)
    console.log(reverted.length ? `Reverted: ${reverted.join(', ')}` : 'Nothing to revert.')
  }
  else if (command === 'status') {
    for (const { name, applied } of migrationStatus()) {
      console.log(`${applied ? '[x]' : '[ ]'} ${name}`)
    }
  }
  else {
    console.error('Usage: migrate.ts <up|down [steps]|status>')
    process.exitCode = 1
  }

  closeDb()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
