import { builtinModules } from 'node:module'
import { spawnSync } from 'node:child_process'
import { accessSync, constants as fsConstants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { ALPHA1_REVISION, ALPHA1_TAG } from './prepare-alpha1-types.mjs'
import { sanitizedSubprocessEnv } from './subprocess-env.mjs'

export { sanitizedSubprocessEnv } from './subprocess-env.mjs'

const PACKAGE_NAME = 'dsh-codex-sidebar'
const INVALID_REGISTRY = 'http://127.0.0.1:9/'
const PACKED_ROOT = 'package/'
export const CLEAN_ZOD_SOURCE = 'node_modules/.pnpm/zod@4.4.3/node_modules/zod'
const SOURCE_SEGMENTS = new Set(['src', 'source', 'test', 'tests', '__tests__', 'scripts'])
const NODE_BUILTINS = new Set(builtinModules)

/** Return paths reported by either pnpm pack JSON format. */
export function packFilePaths(value) {
  const result = Array.isArray(value) ? value[0] : value
  const files = result?.files
  return Array.isArray(files) ? files.map((entry) => entry?.path).filter((path) => typeof path === 'string') : []
}

function fail(message) {
  throw new Error('[dsh-codex-sidebar pack gate] ' + message)
}

function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function relativePackedPath(value, label = 'packed path') {
  if (typeof value !== 'string') fail(label + ' is not a string: ' + String(value))
  const normalized = value.replaceAll('\\', '/')
  const withoutDot = normalized.replace(/^\.\//, '')
  const path = withoutDot.startsWith(PACKED_ROOT) ? withoutDot.slice(PACKED_ROOT.length) : withoutDot
  const segments = path.split('/')
  if (path.length === 0 || path === '.' || path.startsWith('/') || /^[A-Za-z]:\//.test(path) || segments.includes('..') || path.includes(String.fromCharCode(0))) fail(label + ' escapes the package: ' + value)
  return path
}

function assertSafeTarget(target, label) {
  const path = relativePackedPath(target, label)
  if (path.includes('*')) fail(label + ' uses an unsupported wildcard: ' + target)
  return path
}

function collectExportTargets(value, output = [], label = 'exports') {
  if (typeof value === 'string') {
    output.push({ label, target: value })
    return output
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => { collectExportTargets(item, output, label + '[' + index + ']') })
    return output
  }
  const record = asRecord(value)
  if (record === undefined) return output
  for (const [key, item] of Object.entries(record)) collectExportTargets(item, output, label + '.' + key)
  return output
}


/** Collect every concrete target from every exports condition. */
export function exportTargetPaths(manifest) {
  return collectExportTargets(manifest.exports).map(({ label, target }) => ({ label, target, path: assertSafeTarget(target, label) }))
}

/** Validate all exported, main, and type files against a packed file list. */
export function assertPackedPackageLayout({ manifest, packedFiles, packageRoot, fileExists = existsSync }) {
  const root = resolve(packageRoot)
  assertSafeDirectoryRoot(root, 'package root')
  const files = new Set(packedFiles.map((path) => relativePackedPath(path)))
  const targets = exportTargetPaths(manifest)
  if (typeof manifest.main === 'string') targets.push({ label: 'main', target: manifest.main, path: assertSafeTarget(manifest.main, 'main') })
  if (typeof manifest.types === 'string') targets.push({ label: 'types', target: manifest.types, path: assertSafeTarget(manifest.types, 'types') })
  for (const entry of targets) {
    if (!files.has(entry.path)) fail(entry.label + ' is missing from the tarball: ' + entry.path)
    const diskPath = resolve(root, entry.path)
    if (!pathWithin(root, diskPath)) fail(entry.label + ' escapes the extracted package: ' + entry.path)
    if (!fileExists(diskPath)) fail(entry.label + ' is missing from the extracted package: ' + diskPath)
    const info = lstatSync(diskPath, { throwIfNoEntry: false })
    if (info === undefined || !info.isFile() || info.isSymbolicLink() || realpathSync(diskPath) !== diskPath) fail(entry.label + ' is not a regular canonical file: ' + entry.path)
  }
  return targets.map(({ label, path }) => ({ label, path }))
}

/** Reject source, test, script, map, secret, and symlink entries in a package. */
export function assertNoForbiddenPackedFiles(packedFiles, packageRoot) {
  const root = resolve(packageRoot)
  assertSafeDirectoryRoot(root, 'package root')
  for (const raw of packedFiles) {
    const path = relativePackedPath(raw)
    const parts = path.split('/')
    if (parts.some((part) => SOURCE_SEGMENTS.has(part))) fail('forbidden source/test/script path in tarball: ' + path)
    if (/\.map$/i.test(path)) fail('forbidden source map in tarball: ' + path)
    const basename = parts.at(-1) ?? ''
    if (/^\.env(?:\.|$)/i.test(basename) || /(?:secret|credential|password|token)/i.test(basename) || /(?:\.pem|\.key|\.p12|\.pfx|\.crt|\.cer)$/i.test(basename)) fail('forbidden secret path in tarball: ' + path)
    const diskPath = resolve(root, path)
    if (!pathWithin(root, diskPath)) fail('packed path escapes package root: ' + path)
    const info = lstatSync(diskPath, { throwIfNoEntry: false })
    if (info === undefined || !info.isFile() || info.isSymbolicLink() || realpathSync(diskPath) !== diskPath) fail('packed entry is not a regular canonical file: ' + path)
  }
}

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

function isBuiltin(specifier) {
  return specifier.startsWith('node:') || NODE_BUILTINS.has(specifier)
}

/** Extract literal require/import specifiers from packed JavaScript. */
export function staticJavaScriptSpecifiers(source) {
  const result = new Set()
  const patterns = [
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\b(?:import|export)\s+(?:(?:[^;\n]*?)\s+from\s+)?['"]([^'"]+)['"]/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) if (match[1] !== undefined) result.add(match[1])
  }
  return [...result]
}

function resolvePackedImport(packageRoot, importer, specifier, packedFiles) {
  const root = resolve(packageRoot)
  const base = resolve(root, dirname(importer), specifier)
  if (!pathWithin(root, base)) fail('relative packed import escapes package: ' + importer + ' -> ' + specifier)
  const candidates = [base]
  if (extname(base) === '') candidates.push(base + '.js', base + '.mjs', base + '.cjs', base + '.json', join(base, 'index.js'))
  for (const candidate of candidates) {
    const path = relative(root, candidate).replaceAll(sep, '/')
    const info = lstatSync(candidate, { throwIfNoEntry: false })
    if (packedFiles.has(path) && info?.isFile() && !info.isSymbolicLink() && realpathSync(candidate) === candidate) return path
  }
  fail('relative packed import is missing: ' + importer + ' -> ' + specifier)
}

/** Verify the complete static JS closure and every bare import declaration. */
export function assertPackedJavaScriptClosure({ manifest, packageRoot, packedFiles, entryPaths }) {
  const root = resolve(packageRoot)
  assertSafeDirectoryRoot(root, 'package root')
  const files = new Set(packedFiles.map((path) => relativePackedPath(path)))
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...(manifest.bundleDependencies ?? []),
    ...(manifest.bundledDependencies ?? []),
  ])
  const entries = entryPaths === undefined ? [...files].filter((path) => /\.(?:c|m)?js$/i.test(path)) : entryPaths.map(relativePackedPath).filter((path) => /\.(?:c|m)?js$/i.test(path))
  const seen = new Set()
  const queue = [...entries]
  while (queue.length > 0) {
    const importer = queue.shift()
    if (importer === undefined || seen.has(importer)) continue
    seen.add(importer)
    if (!files.has(importer)) fail('JS entry is missing from the tarball: ' + importer)
    const importerPath = resolve(root, importer)
    const importerInfo = lstatSync(importerPath, { throwIfNoEntry: false })
    if (importerInfo === undefined || !importerInfo.isFile() || importerInfo.isSymbolicLink() || realpathSync(importerPath) !== importerPath) fail('JS entry is not a regular canonical file: ' + importer)
    const source = readFileSync(importerPath, 'utf8')
    for (const specifier of staticJavaScriptSpecifiers(source)) {
      if (isBuiltin(specifier)) continue
      if (specifier.startsWith('.')) {
        const target = resolvePackedImport(root, importer, specifier, files)
        if (/\.(?:c|m)?js$/i.test(target)) queue.push(target)
        continue
      }
      if (specifier.startsWith('/')) fail('absolute packed import is not publishable: ' + importer + ' -> ' + specifier)
      const name = packageName(specifier)
      if (!declared.has(name)) fail('packed JS imports undeclared package ' + specifier + ' from ' + importer)
    }
  }
  return [...seen]
}

/** Preserve the historical focused helper while the full gate grows around it. */
export function assertPackContainsClientTypes({ root, manifest, packJson, fileExists = existsSync }) {
  const clientTypes = manifest.exports?.['./client']?.types
  if (typeof clientTypes !== 'string') throw new Error('package ./client export has no types entry')
  const packageRoot = resolve(root)
  const expected = assertSafeTarget(clientTypes, 'package ./client types')
  const declaration = resolve(packageRoot, expected)
  if (!pathWithin(packageRoot, declaration)) throw new Error('package ./client declaration escapes package root: ' + clientTypes)
  if (!fileExists(declaration)) throw new Error('package ./client declaration is missing: ' + declaration)
  const info = lstatSync(declaration, { throwIfNoEntry: false })
  if (info !== undefined && (!info.isFile() || info.isSymbolicLink() || realpathSync(declaration) !== declaration)) throw new Error('package ./client declaration is not a regular canonical file: ' + declaration)
  const files = packFilePaths(packJson).map((path) => relativePackedPath(path, 'packed artifact path'))
  if (!files.includes(expected)) throw new Error('packed artifact is missing ' + expected)
  return expected
}

function optionalLstat(path) {
  try {
    return lstatSync(path, { throwIfNoEntry: false })
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return undefined
    throw error
  }
}

function isPnpmPackageEntrypoint(path) {
  const normalized = path.replaceAll('\\', '/')
  if (!normalized.endsWith('/pnpm/bin/pnpm.cjs')) return false
  const packageRoot = resolve(dirname(path), '..')
  const packageManifest = join(packageRoot, 'package.json')
  const manifestInfo = optionalLstat(packageManifest)
  if (manifestInfo === undefined || !manifestInfo.isFile() || manifestInfo.isSymbolicLink() || realpathSync(packageManifest) !== packageManifest) return false
  try {
    const manifest = JSON.parse(readFileSync(packageManifest, 'utf8'))
    return manifest?.name === 'pnpm' && typeof manifest.version === 'string' && manifest.version.length > 0
  } catch (manifestParseError) {
    void manifestParseError
    return false
  }
}

/** Resolve a real pnpm entrypoint without invoking a Corepack downloader. */
export function realPnpmInvocation(env = sanitizedSubprocessEnv()) {
  const pathValue = Object.entries(env).find(([name]) => name.toUpperCase() === 'PATH')?.[1]
  const pathEntries = (typeof pathValue === 'string' ? pathValue : '').split(delimiter).filter(Boolean)
  const candidates = []
  for (const entry of pathEntries) {
    candidates.push(join(entry, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'))
    if (process.platform === 'win32') candidates.push(join(entry, 'pnpm'))
  }
  let sawCorepack = false
  for (const candidate of candidates) {
    const info = optionalLstat(candidate)
    if (info === undefined || (!info.isFile() && !info.isSymbolicLink())) continue
    let executable = true
    try { accessSync(candidate, fsConstants.X_OK) } catch (accessError) { void accessError; executable = false }
    if (!executable) continue
    const canonical = realpathSync(candidate)
    const normalizedCanonical = canonical.replaceAll('\\', '/')
    if (normalizedCanonical.endsWith('/corepack/dist/pnpm.js')) {
      const direct = resolve(dirname(canonical), '../../pnpm/bin/pnpm.cjs')
      const directInfo = optionalLstat(direct)
      if (directInfo?.isFile() && !directInfo.isSymbolicLink() && realpathSync(direct) === direct && isPnpmPackageEntrypoint(direct)) return { command: process.execPath, prefix: [direct] }
      continue
    }
    if (isPnpmPackageEntrypoint(canonical)) return { command: process.execPath, prefix: [canonical] }
  }
  fail('real pnpm executable is unavailable; refusing a Corepack network bootstrap')
}

/** Run a gate subprocess and reject output on stderr or warnings. */
export function command(commandName, args, options = {}) {
  const env = options.env ?? sanitizedSubprocessEnv()
  const result = spawnSync(commandName, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options, env })
  const stdout = typeof result.stdout === 'string' ? result.stdout : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr : ''
  if (result.error !== undefined) fail(`${commandName} ${args.join(' ')} failed: ${result.error.message}`)
  if (result.status !== 0) fail(`${commandName} ${args.join(' ')} exited ${String(result.status)}${stdout.trim().length === 0 ? '' : `\nstdout: ${stdout.trim()}`}${stderr.trim().length === 0 ? '' : `\nstderr: ${stderr.trim()}`}`)
  if (stderr.trim().length !== 0) fail(`${commandName} ${args.join(' ')} emitted stderr:\n${stderr.trim()}`)
  const warnings = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /(?:^|\s)(?:WARN|WARNING)(?::|\s|$)/i.test(line))
  if (warnings.length > 0) fail(`${commandName} ${args.join(' ')} emitted warnings:\n${warnings.join('\n')}`)
  return stdout
}

function archiveEntries(archive, env) {
  return command('tar', ['-tzf', archive], { env }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function walkFiles(root) {
  const output = []
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const name = prefix.length === 0 ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) visit(path, name)
      else output.push(name.replaceAll(sep, '/'))
    }
  }
  visit(root, '')
  return output
}

/** Read the package manifest from a local npm archive. */
export function packageManifestFromArchive(archive, env) {
  return JSON.parse(command('tar', ['-xOf', archive, 'package/package.json'], { env }))
}

/** Build the exact package identity used by fixture provenance. */
export function packageKey(name, version) {
  return name + '@' + version
}



/** Return whether target is contained by root without traversal. */
export function pathWithin(root, target) {
  const child = relative(root, target)
  return child === '' || (child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child) && !child.startsWith('/'))
}

function statDirectory(path, label) {
  const info = lstatSync(path, { throwIfNoEntry: false })
  if (info === undefined) fail(label + ' is missing: ' + path)
  if (info.isSymbolicLink()) fail(label + ' is a symlink or junction: ' + path)
  if (!info.isDirectory()) fail(label + ' is not a directory: ' + path)
  const canonical = realpathSync(path)
  if (canonical !== path) fail(label + ' escapes its requested root: ' + path)
  return canonical
}

/** Validate a directory root before any recursive filesystem operation. */
export function assertSafeDirectoryRoot(root, label = 'temporary root') {
  const requested = resolve(root)
  return statDirectory(requested, label)
}

/** Reject symlinks, junctions, nonregular members, and containment escapes. */
export function assertSafeDirectoryTree(root, label = 'temporary tree', options = {}) {
  const requested = resolve(root)
  const canonical = statDirectory(requested, label)
  const ignoredDirectories = new Set(options.ignoredDirectories ?? [])
  const allowedSymlinkRoots = (options.allowedSymlinkRoots ?? []).map((value) => realpathSync(resolve(value)))
  const allowedLink = (target) => allowedSymlinkRoots.some((allowedRoot) => pathWithin(allowedRoot, target))
  const inspectIgnored = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const member = join(directory, entry.name)
      const memberLabel = prefix.length === 0 ? label + ' member' : label + ' member ' + prefix + '/' + entry.name
      const info = lstatSync(member, { throwIfNoEntry: false })
      if (info === undefined) fail(memberLabel + ' disappeared during validation: ' + member)
      if (info.isSymbolicLink()) {
        const target = realpathSync(member)
        if (!allowedLink(target)) fail(memberLabel + ' is a symlink or junction outside approved roots: ' + member)
        continue
      }
      if (info.isDirectory()) {
        const memberCanonical = realpathSync(member)
        if (!pathWithin(canonical, memberCanonical) && !allowedSymlinkRoots.some((allowedRoot) => pathWithin(allowedRoot, memberCanonical))) fail(memberLabel + ' escapes its root: ' + member)
        inspectIgnored(memberCanonical, prefix.length === 0 ? entry.name : prefix + '/' + entry.name)
        continue
      }
      if (!info.isFile()) fail(memberLabel + ' is not a regular file: ' + member)
      if (!pathWithin(canonical, realpathSync(member))) fail(memberLabel + ' escapes its root: ' + member)
    }
  }
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const member = join(directory, entry.name)
      const memberLabel = prefix.length === 0 ? label + ' member' : label + ' member ' + prefix + '/' + entry.name
      const info = lstatSync(member, { throwIfNoEntry: false })
      if (info === undefined) fail(memberLabel + ' disappeared during validation: ' + member)
      if (info.isSymbolicLink()) fail(memberLabel + ' is a symlink or junction: ' + member)
      if (ignoredDirectories.has(entry.name)) {
        if (!info.isDirectory()) fail(memberLabel + ' is not a regular directory: ' + member)
        const ignoredCanonical = realpathSync(member)
        if (!pathWithin(canonical, ignoredCanonical)) fail(memberLabel + ' escapes its root: ' + member)
        inspectIgnored(ignoredCanonical, prefix.length === 0 ? entry.name : prefix + '/' + entry.name)
        continue
      }
      if (info.isDirectory()) {
        const memberCanonical = realpathSync(member)
        if (!pathWithin(canonical, memberCanonical)) fail(memberLabel + ' escapes its root: ' + member)
        visit(memberCanonical, prefix.length === 0 ? entry.name : prefix + '/' + entry.name)
        continue
      }
      if (!info.isFile()) fail(memberLabel + ' is not a regular file: ' + member)
      const memberCanonical = realpathSync(member)
      if (!pathWithin(canonical, memberCanonical)) fail(memberLabel + ' escapes its root: ' + member)
    }
  }
  visit(canonical, '')
  return canonical
}

/** Remove a validated temporary directory without following links. */
export function removeTemporaryTree(root, label = 'temporary root') {
  const requested = resolve(root)
  const info = lstatSync(requested, { throwIfNoEntry: false })
  if (info === undefined) return false
  const canonical = assertSafeDirectoryTree(requested, label)
  rmSync(canonical, { recursive: true, force: false })
  return true
}

/** Remove a package-manager tree after validating contained links individually. */
export function removeManagedTemporaryTree(root, label = 'managed temporary root') {
  const requested = resolve(root)
  const rootInfo = lstatSync(requested, { throwIfNoEntry: false })
  if (rootInfo === undefined) return false
  const canonical = statDirectory(requested, label)
  const links = []
  const inspect = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const member = join(directory, entry.name)
      const memberLabel = prefix.length === 0 ? label + ' member' : label + ' member ' + prefix + '/' + entry.name
      const info = lstatSync(member, { throwIfNoEntry: false })
      if (info === undefined) fail(memberLabel + ' disappeared during cleanup validation: ' + member)
      if (info.isSymbolicLink()) {
        const target = realpathSync(member)
        if (!pathWithin(canonical, target)) fail(memberLabel + ' escapes its root: ' + member)
        links.push(member)
        continue
      }
      if (info.isDirectory()) {
        const memberCanonical = realpathSync(member)
        if (!pathWithin(canonical, memberCanonical)) fail(memberLabel + ' escapes its root: ' + member)
        inspect(memberCanonical, prefix.length === 0 ? entry.name : prefix + '/' + entry.name)
        continue
      }
      if (!info.isFile()) fail(memberLabel + ' is not a regular file: ' + member)
      if (!pathWithin(canonical, realpathSync(member))) fail(memberLabel + ' escapes its root: ' + member)
    }
  }
  inspect(canonical, '')
  for (const link of links.sort((left, right) => right.length - left.length)) rmSync(link, { force: false })
  return removeTemporaryTree(canonical, label)
}

/** Run work and every cleanup, preserving the work failure before cleanup failures. */
export function withCleanup(work, cleanups, label = 'cleanup failed') {
  let result
  let failed = false
  let primary
  try {
    result = work()
  } catch (error) {
    failed = true
    primary = error
  }
  const cleanupFailures = []
  for (const cleanup of cleanups) {
    try {
      cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (failed) {
    if (cleanupFailures.length === 0) throw primary
    throw new AggregateError([primary, ...cleanupFailures], label)
  }
  if (cleanupFailures.length === 1) throw cleanupFailures[0]
  if (cleanupFailures.length > 1) throw new AggregateError(cleanupFailures, label)
  return result
}

/** Reject an unavailable or unverifiable local fixture. */
export function assertLocalFixture(name, source, expected = {}) {
  if (typeof source !== 'string' || !existsSync(join(source, 'package.json'))) fail('missing local fixture for ' + name)
  const resolved = assertSafeDirectoryTree(source, 'fixture ' + name, { ignoredDirectories: ['node_modules', '.git'], allowedSymlinkRoots: expected.allowedSymlinkRoots ?? [] })
  const packageManifest = JSON.parse(readFileSync(join(resolved, 'package.json'), 'utf8'))
  if (packageManifest.name !== name) fail('fixture name mismatch: requested ' + name + ', found ' + String(packageManifest.name))
  if (typeof packageManifest.version !== 'string' || packageManifest.version.length === 0) fail('fixture ' + name + ' has no version')
  if (expected.version !== undefined && packageManifest.version !== expected.version) fail('fixture ' + name + ' version mismatch: expected ' + expected.version + ', found ' + packageManifest.version)
  if (expected.realpath !== undefined && resolved !== expected.realpath) fail('fixture ' + name + ' realpath mismatch: expected ' + expected.realpath + ', found ' + resolved)
  return resolved
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
  if (match === null) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4]?.split('.') ?? [] }
}

/** Compare two complete semantic versions for fixture ordering. */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) return undefined
  for (const field of ['major', 'minor', 'patch']) {
    if (a[field] !== b[field]) return a[field] < b[field] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length !== 0) return 1
  if (a.prerelease.length !== 0 && b.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber < rightNumber ? -1 : 1
    if (leftNumber !== undefined) return -1
    if (rightNumber !== undefined) return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function rangeComparator(version, operator, base) {
  const comparison = compareVersions(version, base)
  if (comparison === undefined) return false
  if (operator === '>') return comparison > 0
  if (operator === '>=') return comparison >= 0
  if (operator === '<') return comparison < 0
  if (operator === '<=') return comparison <= 0
  return comparison === 0
}

/** Check the fixture semver range forms used by persisted dependencies. */
export function satisfiesVersion(version, rawRange) {
  const range = rawRange.trim()
  if (range === '*' || range === 'latest') return range === '*'
  for (const alternative of range.split('||').map((part) => part.trim())) {
    if (alternative === '*') return true
    const caret = /^\^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-[0-9A-Za-z.-]+)?$/.exec(alternative)
    if (caret !== null) {
      const base = caret[1] + '.' + caret[2] + '.' + caret[3]
      const major = Number(caret[1])
      const minor = Number(caret[2])
      const upper = major > 0 ? (major + 1) + '.0.0' : minor > 0 ? '0.' + (minor + 1) + '.0' : '0.0.' + (Number(caret[3]) + 1)
      if (rangeComparator(version, '>=', base) && rangeComparator(version, '<', upper)) return true
      continue
    }
    const tilde = /^~([0-9]+)\.([0-9]+)\.([0-9]+)(?:-[0-9A-Za-z.-]+)?$/.exec(alternative)
    if (tilde !== null) {
      const base = tilde[1] + '.' + tilde[2] + '.' + tilde[3]
      const upper = tilde[1] + '.' + (Number(tilde[2]) + 1) + '.0'
      if (rangeComparator(version, '>=', base) && rangeComparator(version, '<', upper)) return true
      continue
    }
    const wildcard = /^(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?$/.exec(alternative)
    if (wildcard !== null && (wildcard[2] === undefined || /[xX*]/.test(wildcard[2]) || wildcard[3] === undefined || /[xX*]/.test(wildcard[3]))) {
      const parsed = parseVersion(version)
      if (parsed !== undefined && parsed.major === Number(wildcard[1]) && (wildcard[2] === undefined || /[xX*]/.test(wildcard[2]) || parsed.minor === Number(wildcard[2]))) return true
      continue
    }
    const normalizedAlternative = alternative.replace(/(>=|<=|>|<|=)[ \t]+/g, '$1')
    const comparators = normalizedAlternative.split(/\s+/).filter(Boolean)
    if (comparators.length > 1 || /^(?:>=|>|<=|<|=)/.test(normalizedAlternative)) {
      if (comparators.every((comparator) => {
        const match = /^(>=|>|<=|<|=)?(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z.-]+))?$/.exec(comparator)
        if (match === null || match[2] === undefined || /[xX*]/.test(match[2]) || (match[3] !== undefined && /[xX*]/.test(match[3]))) return false
        const base = match[2] + '.' + (match[3] ?? '0') + '.' + (match[4] ?? '0') + (match[5] === undefined ? '' : '-' + match[5])
        return rangeComparator(version, match[1] ?? '=', base)
      })) return true
      continue
    }
    if (rangeComparator(version, '=', alternative)) return true
  }
  return false
}





/** Normalize a workspace range to the resolved fixture version. */
export function workspaceRange(range, version) {
  const suffix = range.slice('workspace:'.length)
  if (suffix === '^' || suffix === '~') return suffix + version
  if (suffix === '*') return version
  return suffix
}



/** Return the SHA-512 integrity string for a local archive. */
export function archiveDigest(archive) {
  return 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64')
}

/** Return the byte length of a persisted fixture archive. */
export function archiveByteSize(archive) {
  return statSync(archive).size
}

/** Return the lowercase SHA-256 digest of a persisted fixture archive. */
export function archiveSha256(archive) {
  return createHash('sha256').update(readFileSync(archive)).digest('hex')
}



function assertPersistedRange(edge, child) {
  if (edge.range.startsWith('workspace:')) {
    const suffix = edge.range.slice('workspace:'.length)
    if (suffix !== '*' && suffix !== '^' && suffix !== '~' && !satisfiesVersion(child.version, suffix)) fail('workspace range is unsatisfied: ' + edge.parentKey + ' -> ' + child.key + ' (' + edge.range + ')')
    return
  }
  if (!satisfiesVersion(child.version, edge.range)) fail('declared range is unsatisfied: ' + edge.parentKey + ' -> ' + child.key + ' (' + edge.range + ')')
}

/** Validate one persisted fixture archive and return its canonical path. */
export function assertPersistedFixtureArchive(bundleRoot, entry, archiveRoot = join(bundleRoot, 'tarballs')) {
  const root = assertSafeDirectoryRoot(bundleRoot, 'persisted fixture root')
  const canonicalArchiveRoot = assertSafeDirectoryRoot(archiveRoot, 'persisted fixture archive root')
  if (typeof entry.archive !== 'string' || entry.archive.length === 0 || entry.archive.includes('..') || entry.archive.startsWith('/') || entry.archive.includes('\\')) fail('fixture archive path is unsafe for ' + entry.key)
  const archive = resolve(root, entry.archive)
  if (!pathWithin(canonicalArchiveRoot, archive) || !existsSync(archive) || !lstatSync(archive).isFile() || lstatSync(archive).isSymbolicLink()) fail('fixture archive is unavailable or not a regular file: ' + entry.key)
  if (realpathSync(archive) !== archive) fail('fixture archive is not its canonical realpath: ' + archive)
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes !== statSync(archive).size) fail('fixture archive byte size mismatch: ' + entry.key)
  if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256) || entry.sha256 !== archiveSha256(archive)) fail('fixture archive SHA-256 mismatch: ' + entry.key)
  if (typeof entry.integrity !== 'string' || entry.integrity !== archiveDigest(archive)) fail('fixture archive SHA-512 integrity mismatch: ' + entry.key)
  return archive
}

function assertPersistedProvenance(entry) {
  const provenance = entry.provenance
  if (provenance === undefined || typeof provenance !== 'object' || provenance === null) fail('fixture provenance is missing: ' + entry.key)
  if (provenance.kind === 'clean-alpha1') {
    if (provenance.repository !== 'https://github.com/deepseek-ai/deepseek-harness.git' || provenance.tag !== ALPHA1_TAG || provenance.revision !== ALPHA1_REVISION || provenance.integrity !== 'git:' + ALPHA1_REVISION) fail('clean alpha1 provenance is invalid: ' + entry.key)
    return
  }
  if (provenance.kind !== 'registry-clean-alpha1-store' && provenance.kind !== 'registry-consumer-store') fail('fixture provenance kind is invalid: ' + entry.key)
  if (typeof provenance.source !== 'string' || provenance.source.length === 0 || typeof provenance.lockfile !== 'string' || !provenance.lockfile.endsWith('pnpm-lock.yaml') || typeof provenance.integrity !== 'string' || !provenance.integrity.startsWith('sha512-')) fail('registry fixture provenance is invalid: ' + entry.key)
}

/** Reject persisted fixture paths ignored by the repository. */
export function assertPersistedFixtureFilesVisible(root, paths, env) {
  assertSafeDirectoryRoot(root, 'fixture repository root')
  for (const path of paths) {
    if (assertSafeTarget(path, 'persisted fixture path') !== path.replace(/^\.\//, '')) fail('persisted fixture path is unsafe: ' + path)
  }
  const result = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '--stdin'], { encoding: 'utf8', input: paths.join('\n') + '\n', env: env ?? sanitizedSubprocessEnv() })
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
  if (result.error !== undefined) fail('could not check fixture ignore rules: ' + result.error.message)
  if (stderr.length > 0) fail('git check-ignore emitted stderr: ' + stderr)
  if (result.status === 0) fail('persisted fixture is ignored by repository rules: ' + stdout)
  if (result.status !== 1) fail('git check-ignore exited ' + String(result.status) + ' while checking persisted fixtures')
}

/** Load and validate the committed exact-version fixture graph. */
export function loadFixtureBundle(root, manifest, env) {
  const bundleRoot = resolve(root, 'fixtures/alpha1')
  assertSafeDirectoryRoot(bundleRoot, 'persisted fixture root')
  const archiveRoot = join(bundleRoot, 'tarballs')
  assertSafeDirectoryRoot(archiveRoot, 'persisted fixture archive root')
  const manifestPath = join(bundleRoot, 'PROVENANCE.json')
  const manifestInfo = lstatSync(manifestPath, { throwIfNoEntry: false })
  if (manifestInfo === undefined || !manifestInfo.isFile() || manifestInfo.isSymbolicLink() || realpathSync(manifestPath) !== manifestPath) fail('persisted alpha1 fixture manifest is not a regular file: ' + manifestPath)
  let payload
  try { payload = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch (error) { fail('persisted fixture manifest is invalid: ' + (error instanceof Error ? error.message : String(error))) }
  if (payload?.schema !== 1 || payload.alpha1?.repository !== 'https://github.com/deepseek-ai/deepseek-harness.git' || payload.alpha1?.tag !== ALPHA1_TAG || payload.alpha1?.revision !== ALPHA1_REVISION) fail('persisted fixture bundle is not the exact official alpha1 artifact')
  const rootKey = packageKey(manifest.name, manifest.version)
  if (payload.root?.key !== rootKey || payload.root?.name !== manifest.name || payload.root?.version !== manifest.version) fail('persisted fixture root does not match packed package')
  if (!Array.isArray(payload.fixtures) || !Array.isArray(payload.edges)) fail('persisted fixture bundle has no graph arrays')
  const records = new Map()
  const archivePaths = new Map()
  const persistedPaths = ['fixtures/alpha1/PROVENANCE.json']
  for (const entry of payload.fixtures) {
    if (typeof entry?.key !== 'string' || typeof entry.name !== 'string' || typeof entry.version !== 'string' || entry.key !== packageKey(entry.name, entry.version)) fail('persisted fixture has an inexact package key')
    if (records.has(entry.key)) fail('persisted fixture package@version is duplicated: ' + entry.key)
    assertPersistedProvenance(entry)
    if (typeof entry.archive === 'string') persistedPaths.push(join('fixtures/alpha1', entry.archive).replaceAll(sep, '/'))
    const archive = assertPersistedFixtureArchive(bundleRoot, entry, archiveRoot)
    const packed = packageManifestFromArchive(archive, env)
    if (packed.name !== entry.name || packed.version !== entry.version) fail('persisted fixture archive manifest mismatch: ' + entry.key)
    const record = { key: entry.key, name: entry.name, version: entry.version, source: archive, manifest: packed, provenance: entry.provenance, integrity: entry.provenance.integrity, archiveIntegrity: entry.integrity }
    records.set(entry.key, record)
    archivePaths.set(entry.key, archive)
  }
  assertPersistedFixtureFilesVisible(root, persistedPaths, env)
  const rootRecord = { key: rootKey, name: manifest.name, version: manifest.version, source: realpathSync(root), manifest, provenance: { kind: 'consumer-source', realpath: realpathSync(root) } }
  const edges = []
  const edgeByParentName = new Map()
  const edgeIndex = new Map()
  for (const edge of payload.edges) {
    if (typeof edge?.parentKey !== 'string' || typeof edge.childKey !== 'string' || typeof edge.name !== 'string' || typeof edge.range !== 'string' || !['dependencies', 'optionalDependencies', 'peerDependencies'].includes(edge.field)) fail('persisted fixture edge is malformed')
    const parent = edge.parentKey === rootKey ? rootRecord : records.get(edge.parentKey)
    const child = records.get(edge.childKey)
    if (parent === undefined || child === undefined || edge.childName !== child.name || edge.childVersion !== child.version) fail('persisted fixture edge points to an unknown exact package: ' + edge.parentKey + ' -> ' + edge.childKey)
    const values = parent.manifest[edge.field]
    if (values === undefined || typeof values[edge.name] !== 'string') fail('persisted fixture edge is not declared by parent: ' + edge.parentKey + ' -> ' + edge.name)
    const expectedRange = edge.range.startsWith('workspace:') ? workspaceRange(edge.range, child.version) : edge.range
    if (values[edge.name] !== expectedRange) fail('persisted fixture edge range differs from parent declaration: ' + edge.parentKey + ' -> ' + edge.childKey)
    assertPersistedRange(edge, child)
    if (edge.range.startsWith('workspace:') && child.provenance.kind !== 'clean-alpha1') fail('workspace edge does not point to clean alpha1 fixture: ' + edge.parentKey + ' -> ' + edge.childKey)
    const normalized = { ...edge, parentName: parent.name, parentVersion: parent.version, childName: child.name, childVersion: child.version, parentSource: parent.source, optional: edge.optional === true }
    const parentNameKey = edge.parentKey + '>' + edge.name
    const previous = edgeByParentName.get(parentNameKey)
    if (previous !== undefined && previous.childKey !== edge.childKey) fail('persisted parent dependency resolves to multiple versions: ' + parentNameKey)
    edgeByParentName.set(parentNameKey, normalized)
    const exactEdgeKey = edge.parentKey + '->' + edge.childKey
    edgeIndex.set(exactEdgeKey, [...(edgeIndex.get(exactEdgeKey) ?? []), normalized])
    edges.push(normalized)
  }
  const reachable = new Set()
  const queue = edges.filter((edge) => edge.parentKey === rootKey).map((edge) => edge.childKey)
  while (queue.length > 0) {
    const key = queue.shift()
    if (key === undefined || reachable.has(key)) continue
    reachable.add(key)
    for (const edge of edges) if (edge.parentKey === key) queue.push(edge.childKey)
  }
  for (const key of records.keys()) if (!reachable.has(key)) fail('persisted fixture is unreachable from packed package: ' + key)
  const zod = records.get('zod@4.4.3')
  if (zod === undefined || zod.provenance.kind !== 'registry-clean-alpha1-store' || zod.provenance.source !== CLEAN_ZOD_SOURCE) fail('persisted clean alpha1 pnpm-store zod@4.4.3 fixture is missing or came from another source')
  return { root: rootRecord, records, edges, edgeByParentName, edgeIndex, sources: { alpha: bundleRoot }, archivePaths }
}

const CONSUMER_SMOKE = [
  "import { createRequire } from 'node:module'",
  "import { lstatSync, readFileSync } from 'node:fs'",
  "import { Script, createContext } from 'node:vm'",
  "import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'",
  "",
  "const require = createRequire(import.meta.url)",
  "const packageEntry = require.resolve('dsh-codex-sidebar')",
  "const resolvedHost = import.meta.resolve('dsh-codex-sidebar')",
  "if (new URL(resolvedHost).pathname !== packageEntry) throw new Error('host package resolution is not installed package')",
  "const packageRoot = resolve(dirname(packageEntry), '..')",
  "const packageRelative = relative(process.cwd(), packageRoot)",
  "if (isAbsolute(packageRelative) || packageRelative === '..' || packageRelative.startsWith('..' + sep)) throw new Error('package resolved outside the isolated consumer')",
  "if (lstatSync(packageRoot).isSymbolicLink()) throw new Error('package was installed as a symlink')",
  "const hostPlugin = await import('dsh-codex-sidebar')",
  "if (typeof hostPlugin.apply !== 'function' || hostPlugin.name !== 'dsh-codex-sidebar' || JSON.stringify(hostPlugin.inject) !== JSON.stringify(['connection'])) throw new Error('host package import failed')",
  "const packageManifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))",
  "const smokeCleanups = []",
  "let smokeFailed = false",
  "let smokeError",
  "try {",
  "  const host = new (await import('@deepseek-ai/cordis')).Context()",
  "  smokeCleanups.push(() => host.fiber.dispose())",
  "  host.provide('connection', { rpc: { handle() { return () => {} } } })",
  "  const hostFiber = host.plugin(hostPlugin)",
  "  smokeCleanups.push(() => hostFiber.dispose())",
  "  await hostFiber",
  "  if (packageManifest.exports?.['./invariant'] !== undefined) {",
  "    const invariantRegistryModule = await import('@deepseek-ai/dsh-invariants')",
  "    const invariantRegistry = invariantRegistryModule.default ?? invariantRegistryModule",
  "    const invariantRegistryFiber = host.plugin(invariantRegistry)",
  "    smokeCleanups.push(() => invariantRegistryFiber.dispose())",
  "    await invariantRegistryFiber",
  "    const invariant = await import('dsh-codex-sidebar/invariant')",
  "    const invariantFiber = host.plugin(invariant)",
  "    smokeCleanups.push(() => invariantFiber.dispose())",
  "    await invariantFiber",
  "  }",
  "} catch (error) {",
  "  smokeFailed = true",
  "  smokeError = error",
  "}",
  "const smokeCleanupErrors = []",
  "for (const disposer of smokeCleanups.reverse()) {",
  "  try { await disposer() } catch (error) { smokeCleanupErrors.push(error) }",
  "}",
  "if (smokeFailed) {",
  "  if (smokeCleanupErrors.length > 0) throw new AggregateError([smokeError, ...smokeCleanupErrors], 'consumer plugin smoke failed')",
  "  throw smokeError",
  "}",
  "if (smokeCleanupErrors.length === 1) throw smokeCleanupErrors[0]",
  "if (smokeCleanupErrors.length > 1) throw new AggregateError(smokeCleanupErrors, 'consumer plugin smoke cleanup failed')",
  "",
  "const clientEntry = require.resolve('dsh-codex-sidebar/client')",
  "const resolvedClient = import.meta.resolve('dsh-codex-sidebar/client')",
  "if (new URL(resolvedClient).pathname !== clientEntry) throw new Error('client package resolution is not installed package')",
  "const clientRelative = relative(packageRoot, clientEntry)",
  "if (isAbsolute(clientRelative) || clientRelative === '..' || clientRelative.startsWith('..' + sep)) throw new Error('client resolved outside the installed package')",
  "const registrations = []",
  "const window = { __ModuleLoader__: { load(value) { registrations.push(value) } } }",
  "const navigator = { userAgent: 'dsh-pack-gate', platform: process.platform }",
  "const context = createContext({ window, self: window, navigator, console, setTimeout, clearTimeout })",
  "new Script(readFileSync(clientEntry, 'utf8'), { filename: clientEntry }).runInContext(context)",
  "if (registrations.length !== 1 || registrations[0]?.id !== 'dsh-codex-sidebar' || typeof registrations[0]?.factory !== 'function') throw new Error('client ModuleLoader registration failed')",
  "const client = registrations[0].factory(createRequire(clientEntry))",
  "if (typeof client.apply !== 'function' || client.name !== 'dsh-codex-sidebar-client' || !Array.isArray(client.inject) || !client.inject.every((value) => typeof value === 'string')) throw new Error('client factory execution failed')",
  "",
  "const pty = require('node-pty')",
  "if (typeof pty.spawn !== 'function') throw new Error('node-pty fixture is not executable')",
  "const shell = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh'",
  "const args = process.platform === 'win32' ? ['/d', '/c', 'echo dsh-pack-gate'] : ['-c', 'printf dsh-pack-gate']",
  "const terminal = pty.spawn(shell, args, { name: 'xterm-color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env })",
  "let output = ''",
  "await new Promise((resolvePromise, reject) => {",
  "  const timer = setTimeout(() => { terminal.kill(); reject(new Error('node-pty fixture did not exit')) }, 10_000)",
  "  terminal.onData((value) => { output += value })",
  "  terminal.onExit(() => { clearTimeout(timer); resolvePromise() })",
  "})",
  "if (!output.includes('dsh-pack-gate')) throw new Error('node-pty fixture produced no output')",
  "",
  "const playwright = require('playwright-core')",
  "if (typeof playwright.chromium?.launch !== 'function') throw new Error('playwright-core fixture is not executable')",
  "const playwrightPackage = JSON.parse(readFileSync(require.resolve('playwright-core/package.json'), 'utf8'))",
  "if (playwrightPackage.name !== 'playwright-core' || typeof playwrightPackage.version !== 'string') throw new Error('playwright-core fixture metadata is invalid')",
].join(String.fromCharCode(10))


/** Ensure the consumer install cannot consult a registry or bypass peer validation. */
export function assertOfflineInstallArgs(args) {
  if (!Array.isArray(args) || args[0] !== 'install') fail('consumer install must start with install')
  const exactFlags = ['--offline', '--ignore-scripts', '--strict-peer-dependencies', '--lockfile=false', '--config.audit=false', '--config.fund=false']
  for (const flag of exactFlags) {
    const count = args.filter((value) => value === flag).length
    if (count !== 1) fail('consumer install requires exactly one ' + flag)
  }
  for (const forbidden of ['--no-audit', '--no-fund']) if (args.includes(forbidden)) fail('consumer install uses an npm-only flag: ' + forbidden)
  const conflictingPrefixes = ['--offline=', '--ignore-scripts=', '--strict-peer-dependencies=', '--lockfile=', '--config.audit=', '--config.fund=', '--registry=', '--store-dir=']
  for (const arg of args) if (!exactFlags.includes(arg) && conflictingPrefixes.some((prefix) => arg.startsWith(prefix))) fail('consumer install uses a conflicting policy flag: ' + arg)
  const registryFlags = args.filter((value) => value === '--registry')
  if (registryFlags.length !== 1) fail('consumer install requires exactly one --registry')
  const registryIndex = args.indexOf('--registry')
  if (args[registryIndex + 1] !== INVALID_REGISTRY) fail('consumer install registry is not invalid: ' + String(args[registryIndex + 1]))
  const storeFlags = args.filter((value) => value === '--store-dir')
  if (storeFlags.length !== 1) fail('consumer install requires exactly one --store-dir')
  const storeIndex = args.indexOf('--store-dir')
  const store = args[storeIndex + 1]
  if (typeof store !== 'string' || store.length === 0 || store.startsWith('-')) fail('consumer install store directory is not fresh: ' + String(store))
  return args
}

function fixtureOverrides(graph, fixtureArchives) {
  const overrides = {}
  for (const edge of graph.edges) {
    const archive = fixtureArchives.get(edge.childKey)
    if (archive === undefined) fail('missing fixture archive for graph edge ' + edge.parentKey + ' -> ' + edge.childKey)
    const selector = edge.parentName + '@' + edge.parentVersion + '>' + edge.name
    const value = pathToFileURL(archive).href
    if (overrides[selector] !== undefined && overrides[selector] !== value) fail('scoped override resolves to multiple archives: ' + selector)
    overrides[selector] = value
  }
  return overrides
}

function consumerDependencies(graph, packageArchive, fixtureArchives) {
  const dependencies = { [PACKAGE_NAME]: pathToFileURL(packageArchive).href }
  for (const edge of graph.edges) {
    if (edge.optional || (edge.parentKey !== graph.root.key && edge.field !== 'peerDependencies')) continue
    const archive = fixtureArchives.get(edge.childKey)
    if (archive === undefined) fail('missing root fixture archive for ' + edge.childKey)
    const value = pathToFileURL(archive).href
    if (dependencies[edge.name] !== undefined && dependencies[edge.name] !== value) fail('root dependency resolves to multiple versions: ' + edge.name)
    dependencies[edge.name] = value
  }
  return dependencies
}

function installedConsumerPackageIndex(consumer) {
  const index = new Map()
  const visited = new Set()
  const addPackage = (directory) => {
    const actual = realpathSync(directory)
    const manifestPath = join(actual, 'package.json')
    if (!existsSync(manifestPath)) return
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      fail('invalid installed consumer package manifest ' + manifestPath + ': ' + (error instanceof Error ? error.message : String(error)))
    }
    if (typeof manifest?.name === 'string' && typeof manifest.version === 'string' && manifest.version.length > 0) index.set(packageKey(manifest.name, manifest.version), actual)
    const nested = join(actual, 'node_modules')
    if (existsSync(nested)) visitNodeModules(nested)
  }
  const visitNodeModules = (directory) => {
    const actualDirectory = realpathSync(directory)
    if (visited.has(actualDirectory)) return
    visited.add(actualDirectory)
    for (const entry of readdirSync(actualDirectory, { withFileTypes: true })) {
      if (entry.name === '.bin') continue
      const path = join(actualDirectory, entry.name)
      if (entry.name === '.pnpm') {
        for (const storeEntry of readdirSync(path, { withFileTypes: true })) {
          if (!storeEntry.isDirectory()) continue
          const nested = join(path, storeEntry.name, 'node_modules')
          if (existsSync(nested)) visitNodeModules(nested)
        }
        continue
      }
      if (entry.name.startsWith('@') && entry.isDirectory()) {
        for (const packageEntry of readdirSync(path, { withFileTypes: true })) if (packageEntry.isDirectory() || packageEntry.isSymbolicLink()) addPackage(join(path, packageEntry.name))
        continue
      }
      if (entry.isDirectory() || entry.isSymbolicLink()) addPackage(path)
    }
  }
  const nodeModules = join(consumer, 'node_modules')
  if (existsSync(nodeModules)) visitNodeModules(nodeModules)
  return index
}

function assertInstalledFixtureVersions(consumer, graph) {
  const installed = installedConsumerPackageIndex(consumer)
  const required = new Set()
  const queue = graph.edges.filter((edge) => edge.parentKey === graph.root.key && !edge.optional).map((edge) => edge.childKey)
  while (queue.length > 0) {
    const key = queue.shift()
    if (key === undefined || required.has(key)) continue
    required.add(key)
    for (const edge of graph.edges) if (edge.parentKey === key && !edge.optional) queue.push(edge.childKey)
  }
  for (const key of required) if (!installed.has(key)) fail('consumer did not install exact fixture ' + key)
}

function runConsumer(packageArchive, graph, fixtureArchives, directory, env) {
  const consumer = join(directory, 'consumer')
  const store = join(directory, 'empty-pnpm-store')
  const userconfig = join(directory, 'empty-npmrc')
  mkdirSync(consumer, { recursive: true })
  mkdirSync(store, { recursive: true })
  assertSafeDirectoryRoot(consumer, 'isolated consumer root')
  assertSafeDirectoryRoot(store, 'consumer pnpm store')
  if (readdirSync(store).length !== 0) fail('consumer pnpm store was not fresh')
  writeFileSync(userconfig, '')
  const packageJson = {
    name: 'dsh-codex-sidebar-pack-consumer',
    version: '1.0.0',
    private: true,
    dependencies: consumerDependencies(graph, packageArchive, fixtureArchives),
    pnpm: { overrides: fixtureOverrides(graph, fixtureArchives) },
  }
  writeFileSync(join(consumer, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n')
  writeFileSync(join(consumer, 'smoke.mjs'), CONSUMER_SMOKE + '\n')
  const installArgs = assertOfflineInstallArgs([
    'install',
    '--offline',
    '--ignore-scripts',
    '--strict-peer-dependencies',
    '--lockfile=false',
    '--registry',
    INVALID_REGISTRY,
    '--store-dir',
    store,
    '--config.audit=false',
    '--config.fund=false',
  ])
  const pnpm = realPnpmInvocation(env)
  command(pnpm.command, [...pnpm.prefix, ...installArgs], { cwd: consumer, env })
  const installed = join(consumer, 'node_modules', PACKAGE_NAME)
  if (!existsSync(installed)) fail('consumer did not install the package')
  const installedRealpath = realpathSync(installed)
  if (!pathWithin(consumer, installedRealpath)) fail('consumer package resolved outside isolated consumer: ' + installedRealpath)
  assertInstalledFixtureVersions(consumer, graph)
  command(process.execPath, ['smoke.mjs'], { cwd: consumer, env })
}

function runGate(root) {
  assertSafeDirectoryRoot(root, 'repository root')
  const sourceManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const directory = mkdtempSync(join(tmpdir(), PACKAGE_NAME + '-pack-'))
  assertSafeDirectoryRoot(directory, 'pack gate temporary root')
  const userconfig = join(directory, 'empty-npmrc')
  const gitconfig = join(directory, 'empty-gitconfig')
  const home = join(directory, 'empty-home')
  const store = join(directory, 'empty-pnpm-store')
  const npmCache = join(directory, 'empty-npm-cache')
  mkdirSync(home, { recursive: true })
  writeFileSync(userconfig, '')
  writeFileSync(gitconfig, '')
  const env = sanitizedSubprocessEnv({
    npm_config_userconfig: userconfig,
    pnpm_config_userconfig: userconfig,
    npm_config_registry: INVALID_REGISTRY,
    pnpm_config_registry: INVALID_REGISTRY,
    pnpm_config_store_dir: store,
    npm_config_cache: npmCache,
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: '1',
  })
  return withCleanup(() => {
    const packDirectory = join(directory, 'package-archive')
    const extractDirectory = join(directory, 'extracted')
    mkdirSync(packDirectory, { recursive: true })
    mkdirSync(extractDirectory, { recursive: true })
    mkdirSync(store, { recursive: true })
    assertSafeDirectoryRoot(packDirectory, 'pack archive root')
    assertSafeDirectoryRoot(extractDirectory, 'pack extraction root')
    assertSafeDirectoryRoot(store, 'pack consumer pnpm store')
    mkdirSync(npmCache, { recursive: true })
    if (readdirSync(store).length !== 0) fail('consumer pnpm store was not fresh')
    const output = command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packDirectory], { cwd: root, env })
    let parsed
    try { parsed = JSON.parse(output) } catch (packJsonError) { fail('npm pack returned invalid JSON: ' + (packJsonError instanceof Error ? packJsonError.message : String(packJsonError))) }
    const result = Array.isArray(parsed) ? parsed[0] : parsed
    if (typeof result?.filename !== 'string' || !result.filename.endsWith('.tgz')) fail('npm pack did not return one real tarball')
    const archive = join(packDirectory, result.filename)
    const archiveInfo = lstatSync(archive, { throwIfNoEntry: false })
    if (archiveInfo === undefined || !archiveInfo.isFile() || archiveInfo.isSymbolicLink() || realpathSync(archive) !== archive) fail('pack output is not a regular tarball')
    const archivePaths = archiveEntries(archive, env)
    for (const path of archivePaths) {
      if (!path.startsWith(PACKED_ROOT) || path.includes('/../') || path.startsWith('../') || path.startsWith('/')) fail('tarball entry escapes package/: ' + path)
    }
    if (!archivePaths.includes('package/package.json')) fail('tarball has no package manifest')
    command('tar', ['-xzf', archive, '-C', extractDirectory], { env })
    const packageRoot = join(extractDirectory, 'package')
    if (!existsSync(packageRoot)) fail('tarball extraction has no package directory')
    assertSafeDirectoryTree(packageRoot, 'extracted package')
    const packedFiles = archivePaths.filter((path) => !path.endsWith('/')).map(relativePackedPath)
    const diskFiles = walkFiles(packageRoot)
    const packedSet = new Set(packedFiles)
    if (diskFiles.some((path) => !packedSet.has(path)) || packedFiles.some((path) => !diskFiles.includes(path))) fail('extracted package does not match tarball files')
    const packedManifest = packageManifestFromArchive(archive, env)
    if (packedManifest.name !== sourceManifest.name || packedManifest.version !== sourceManifest.version) fail('packed manifest name/version differs from source')
    assertNoForbiddenPackedFiles(packedFiles, packageRoot)
    assertPackedPackageLayout({ manifest: packedManifest, packedFiles, packageRoot })
    assertPackedJavaScriptClosure({ manifest: packedManifest, packageRoot, packedFiles })
    const graph = loadFixtureBundle(root, packedManifest, env)
    const fixtures = graph.archivePaths
    runConsumer(archive, graph, fixtures, directory, env)
    console.log('pack gate passed: ' + result.filename + ' (' + packedFiles.length + ' files, ' + fixtures.size + ' local fixtures)')
  }, [() => removeManagedTemporaryTree(directory, 'pack gate temporary root')], 'pack gate work and cleanup failed')
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  runGate(root)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()