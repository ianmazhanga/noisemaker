/**
 * A Postgres (PGlite) with every migration applied, plus a small stand-in for what
 * Supabase provides first: the auth schema and the anon, authenticated and service roles.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const SUPABASE_STANDIN = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`

export interface TestDb {
  db: PGlite
  /** Runs SQL as the public key ('anon'), the secret key ('service') or a signed-in user (their id). */
  as<T = Record<string, unknown>>(who: 'anon' | 'service' | string, sql: string, params?: unknown[]): Promise<T[]>
  /** Runs SQL as the database owner, like the SQL Editor. */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** Creates an account with the given role (or none). */
  addUser(id: string, email: string, role?: string | null, canViewStories?: boolean): Promise<void>
}

export async function migratedDb(): Promise<TestDb> {
  const db = new PGlite()
  await db.exec(SUPABASE_STANDIN)
  const dir = new URL('../../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(file, dir), 'utf8'))

  const as = async <T,>(who: string, sql: string, params: unknown[] = []): Promise<T[]> => {
    const user = who === 'anon' || who === 'service' ? '' : who
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false);`)
    await db.exec(`set role ${who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated'}`)
    try {
      return (await db.query<T>(sql, params)).rows
    } finally {
      await db.exec('reset role')
    }
  }
  const admin = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
  const addUser = async (id: string, email: string, role: string | null = null, canViewStories = false) => {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
    await db.query('update public.profiles set role = $2::public.staff_role, can_view_stories = $3 where id = $1', [id, role, canViewStories])
  }
  return { db, as, admin, addUser }
}
