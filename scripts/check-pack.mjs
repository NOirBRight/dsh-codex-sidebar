import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const clientTypes = manifest.exports?.['./client']?.types
if (typeof clientTypes !== 'string') throw new Error('package ./client export has no types entry')
const declaration = resolve(root, clientTypes)
if (!existsSync(declaration)) throw new Error(`package ./client declaration is missing: ${declaration}`)

const output = execFileSync('pnpm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' })
const result = JSON.parse(output)
const files = result[0]?.files?.map((entry) => entry.path) ?? []
const expected = clientTypes.replace(/^\.\//, '')
if (!files.includes(expected)) throw new Error(`packed artifact is missing ${expected}`)
console.log(`pack contains ${expected}`)
