import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function packFilePaths(value) {
  const result = Array.isArray(value) ? value[0] : value
  const files = result?.files
  return Array.isArray(files) ? files.map((entry) => entry.path).filter((path) => typeof path === 'string') : []
}

export function assertPackContainsClientTypes({ root, manifest, packJson, fileExists = existsSync }) {
  const clientTypes = manifest.exports?.['./client']?.types
  if (typeof clientTypes !== 'string') throw new Error('package ./client export has no types entry')
  const declaration = resolve(root, clientTypes)
  if (!fileExists(declaration)) throw new Error(`package ./client declaration is missing: ${declaration}`)
  const files = packFilePaths(packJson)
  const expected = clientTypes.replace(/^\.\//, '')
  if (!files.includes(expected)) throw new Error(`packed artifact is missing ${expected}`)
  return expected
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const output = execFileSync('pnpm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' })
  const expected = assertPackContainsClientTypes({ root, manifest, packJson: JSON.parse(output) })
  console.log(`pack contains ${expected}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
