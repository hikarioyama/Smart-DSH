import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const output = resolve(import.meta.dirname, '..', 'lib')
await rm(output, { recursive: true, force: true })
