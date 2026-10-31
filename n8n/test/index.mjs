// Entry point so `node --test n8n/test/` works: Node treats a directory argument as a module path and loads
// this file, which imports every *.test.mjs file in the folder.
import { readdirSync } from 'node:fs'

const dir = new URL('./', import.meta.url)
for (const file of readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort()) {
  await import(new URL(file, dir).href)
}
