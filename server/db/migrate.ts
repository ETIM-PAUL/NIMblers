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

async function ensureMigrationsTable(): Promise<void> {
  const db = await getDb()
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
}

async function appliedMigrations(): Promise<Set<string>> {
  await ensureMigrationsTable()
  const db = await getDb()
  const rows = (await db.execute('SELECT name FROM _migrations')).rows as unknown as { name: string }[]
  return new Set(rows.map((row) => row.name))
}

function readSql(name: string, direction: 'up' | 'down'): string {
  return readFileSync(join(MIGRATIONS_DIR, name, `${direction}.sql`), 'utf-8')
}

export async function migrateUp(): Promise<string[]> {
  await ensureMigrationsTable()
  const applied = await appliedMigrations()
  const pending = listMigrations().filter((name) => !applied.has(name))
  const db = await getDb()

  for (const name of pending) {
    await db.executeMultiple(readSql(name, 'up'))
    await db.execute({
      sql: 'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
      args: [name, new Date().toISOString()],
    })
  }
  return pending
}

export async function migrateDown(steps = 1): Promise<string[]> {
  await ensureMigrationsTable()
  const applied = [...(await appliedMigrations())].sort()
  const toRevert = applied.slice(-steps).reverse()
  const db = await getDb()

  for (const name of toRevert) {
    await db.executeMultiple(readSql(name, 'down'))
    await db.execute({ sql: 'DELETE FROM _migrations WHERE name = ?', args: [name] })
  }
  return toRevert
}

export async function migrationStatus(): Promise<{ name: string, applied: boolean }[]> {
  const applied = await appliedMigrations()
  return listMigrations().map((name) => ({ name, applied: applied.has(name) }))
}

async function main() {
  const [, , command, arg] = process.argv

  if (command === 'up') {
    const applied = await migrateUp()
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.')
  }
  else if (command === 'down') {
    const steps = arg ? Number(arg) : 1
    const reverted = await migrateDown(steps)
    console.log(reverted.length ? `Reverted: ${reverted.join(', ')}` : 'Nothing to revert.')
  }
  else if (command === 'status') {
    for (const { name, applied } of await migrationStatus()) {
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
