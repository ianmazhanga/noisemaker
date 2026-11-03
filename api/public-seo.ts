import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createNewsSeoHandler } from './_lib/news-seo.ts'

export const GET = createNewsSeoHandler({
  env: process.env,
  fetch: (...args) => fetch(...args),
  readAsset: (name) => readFile(join(process.cwd(), 'dist', name), 'utf8'),
  now: () => new Date(),
})
