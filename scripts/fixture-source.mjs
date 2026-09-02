import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { ALPHA4_REVISION, ALPHA4_TAG, ALPHA4_VERSION, REQUIRED_TYPES, assessAlpha4Checkout } from './prepare-alpha4-types.mjs'
import { archiveByteSize, archiveDigest, archiveSha256, assertLocalFixture, assertSafeDirectoryRoot, assertSafeDirectoryTree, CLEAN_ZOD_SOURCE, command, compareVersions, packageKey, packageManifestFromArchive, pathWithin, removeTemporaryTree, sanitizedSubprocessEnv, satisfiesVersion, withCleanup, workspaceRange } from './check-pack.mjs'

const CLEAN_ALPHA4_REPOSITORY = 'https://github.com/deepseek-ai/deepseek-harness.git'

function fail(message) {
  throw new Error('[dsh-codex-sidebar fixture preparation] ' + message)
}

/** Enumerate dependency edges while excluding optional peer edges. */
export function dependencyEntries(manifest) {
  const optionalPeers = new Set(Object.entries(manifest.peerDependenciesMeta ?? {}).filter(([, meta]) => meta?.optional === true).map(([name]) => name))
  const entries = []
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (typeof range !== 'string') fail('fixture dependency range is not a string for ' + name)
      if (field === 'peerDependencies' && optionalPeers.has(name) && !range.startsWith('workspace:')) continue
      entries.push({ field, name, range, optional: field === 'optionalDependencies' || optionalPeers.has(name) })
    }
  }
  return entries
}

function manifestAt(directory) {
  const path = join(directory, 'package.json')
  if (!existsSync(path)) fail('fixture has no package.json: ' + directory)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail('invalid fixture package manifest ' + path + ': ' + (error instanceof Error ? error.message : String(error)))
  }
  if (typeof manifest?.name !== 'string' || typeof manifest?.version !== 'string' || manifest.version.length === 0) fail('fixture manifest has no exact name/version: ' + path)
  return manifest
}

function addIndexedPackage(index, directory) {
  const actual = realpathSync(directory)
  const manifest = manifestAt(actual)
  const key = packageKey(manifest.name, manifest.version)
  if (!index.has(key)) index.set(key, actual)
}

function indexPackageManifest(index, packagePath) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  } catch (error) {
    fail('invalid fixture package manifest ' + packagePath + ': ' + (error instanceof Error ? error.message : String(error)))
  }
  if (typeof manifest?.name !== 'string' || typeof manifest?.version !== 'string' || manifest.version.length === 0) return
  const source = realpathSync(dirname(packagePath))
  const key = packageKey(manifest.name, manifest.version)
  if (!index.has(key)) index.set(key, source)
}

function packageIndex(roots) {
  const index = new Map()
  for (const root of roots) {
    if (!existsSync(root)) continue
    const visit = (directory) => {
      const entries = readdirSync(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          visit(path)
          continue
        }
        if (entry.name === 'package.json') indexPackageManifest(index, path)
      }
    }
    visit(root)
  }
  return index
}

function nodeModulePackageIndex(root, approvedRoot = root) {
  const index = new Map()
  const visited = new Set()
  const nodeModules = join(root, 'node_modules')
  if (!existsSync(nodeModules)) return index
  const visitNodeModules = (directory) => {
    const actualDirectory = realpathSync(directory)
    if (!pathWithin(approvedRoot, actualDirectory)) fail('fixture dependency tree escapes its approved root: ' + actualDirectory)
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
  const addPackage = (directory) => {
    const actual = realpathSync(directory)
    if (!pathWithin(approvedRoot, actual)) fail('fixture package escapes its approved root: ' + actual)
    const manifestPath = join(actual, 'package.json')
    if (!existsSync(manifestPath)) return
    addIndexedPackage(index, actual)
    const nested = join(actual, 'node_modules')
    if (existsSync(nested)) visitNodeModules(nested)
  }
  visitNodeModules(nodeModules)
  return index
}




function alphaCheckout(root, env) {
  const link = join(root, '.dsh-alpha4')
  const requested = process.env.DSH_ALPHA4_CHECKOUT
  const candidate = requested === undefined
    ? (existsSync(link) ? realpathSync(link) : undefined)
    : resolve(requested)
  if (candidate === undefined || !existsSync(candidate)) {
    fail('set DSH_ALPHA4_CHECKOUT to the built official ' + ALPHA4_TAG + ' checkout')
  }
  const checkout = realpathSync(candidate)
  const missingTypes = REQUIRED_TYPES.filter((path) => !existsSync(join(checkout, path)))
  const assessment = assessAlpha4Checkout({
    remote: command('git', ['-C', checkout, 'config', '--get', 'remote.origin.url'], { env }),
    status: command('git', ['-C', checkout, 'status', '--porcelain=v1', '--untracked-files=all'], { env }),
    head: command('git', ['-C', checkout, 'rev-parse', 'HEAD'], { env }),
    tag: command('git', ['-C', checkout, 'describe', '--exact-match', '--tags', 'HEAD'], { env }),
    missingTypes,
  })
  if (!assessment.ok) fail('official alpha4 checkout rejected at ' + checkout + ': ' + assessment.reasons.join('; '))
  return checkout
}

function fixtureSources(root, env) {
  const alpha = alphaCheckout(root, env)
  const packageRoot = join(alpha, 'packages')
  const vendorRoot = join(alpha, 'vendor')
  const cleanStoreZod = join(alpha, CLEAN_ZOD_SOURCE)
  if (!existsSync(cleanStoreZod)) fail('clean alpha4 pnpm-store zod@4.4.3 fixture is unavailable: ' + cleanStoreZod)
  const index = packageIndex([packageRoot, vendorRoot])
  addIndexedPackage(index, cleanStoreZod)
  const repositoryRoot = realpathSync(root)
  for (const [key, path] of nodeModulePackageIndex(alpha, alpha)) if (!index.has(key)) index.set(key, path)
  for (const [key, path] of nodeModulePackageIndex(repositoryRoot, repositoryRoot)) if (!index.has(key)) index.set(key, path)
  return { root: repositoryRoot, alpha, index }
}

function lockEntry(root, name, version) {
  const lockPath = join(root, 'pnpm-lock.yaml')
  if (!existsSync(lockPath)) fail('fixture lockfile is missing: ' + lockPath)
  const lines = readFileSync(lockPath, 'utf8').split(/\r?\n/)
  const prefix = name + '@' + version
  let inPackages = false
  let current = false
  let found = false
  let integrity
  for (const line of lines) {
    if (line === 'packages:') {
      inPackages = true
      continue
    }
    if (inPackages && line === 'snapshots:') break
    if (!inPackages) continue
    const packageLine = /^  (?:'([^']+)'|([^:]+)):$/.exec(line)
    if (packageLine !== null) {
      const key = packageLine[1] ?? packageLine[2] ?? ''
      current = key === prefix || key.startsWith(prefix + '(')
      if (current) {
        found = true
        integrity = undefined
      }
      continue
    }
    if (current) {
      const resolution = /^    resolution: \{.*integrity: (\S+).*\}$/.exec(line)
      if (resolution !== null) integrity = resolution[1]
    }
  }
  if (!found) fail('fixture ' + name + '@' + version + ' is absent from pnpm-lock.yaml')
  if (integrity === undefined) fail('fixture ' + name + '@' + version + ' has no lockfile integrity')
  return { version, integrity, lockPath: realpathSync(lockPath) }
}

function resolveInstalledDependency(parentSource, name) {
  let directory = parentSource
  while (true) {
    const candidate = join(directory, 'node_modules', name)
    if (existsSync(candidate)) return realpathSync(candidate)
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

function indexedCandidates(index, name, range) {
  return [...index.entries()]
    .filter(([key]) => key.startsWith(name + '@'))
    .map(([key, source]) => ({ key, source, version: key.slice((name + '@').length) }))
    .filter(({ version }) => range.startsWith('workspace:') || satisfiesVersion(version, range))
    .sort((left, right) => (compareVersions(right.version, left.version) ?? 0))
}

function approvedFixtureSource(source, sources, label) {
  if (!pathWithin(sources.alpha, source) && !pathWithin(sources.root, source)) fail(label + ' escapes approved fixture roots: ' + source)
  return source
}

function resolveFixtureSource({ parent, name, range, sources }) {
  const candidates = indexedCandidates(sources.index, name, range)
  const official = candidates.find(({ source }) => pathWithin(join(sources.alpha, 'packages'), source) || pathWithin(join(sources.alpha, 'vendor'), source))
  if (official !== undefined) return approvedFixtureSource(official.source, sources, 'official fixture')
  const installed = resolveInstalledDependency(parent.source, name)
  if (installed !== undefined) return approvedFixtureSource(installed, sources, 'installed fixture')
  const candidate = candidates[0]
  if (candidate === undefined) fail('missing local fixture for ' + name + ' required by ' + parent.key + ' (' + range + ')')
  return approvedFixtureSource(candidate.source, sources, 'indexed fixture')
}

function fixtureProvenance(root, sources, name, source, version) {
  approvedFixtureSource(source, sources, 'fixture provenance')
  const officialPackage = pathWithin(join(sources.alpha, 'packages'), source) || pathWithin(join(sources.alpha, 'vendor'), source)
  if (officialPackage) return { kind: 'clean-alpha4', repository: CLEAN_ALPHA4_REPOSITORY, source: relative(sources.alpha, source).replaceAll(sep, '/'), tag: ALPHA4_TAG, revision: ALPHA4_REVISION, integrity: 'git:' + ALPHA4_REVISION }
  const alphaNodeModules = join(sources.alpha, 'node_modules')
  const fromCleanStore = existsSync(alphaNodeModules) && pathWithin(realpathSync(alphaNodeModules), source)
  const lockRoot = fromCleanStore ? sources.alpha : sources.root
  const lock = lockEntry(lockRoot, name, version)
  return { kind: fromCleanStore ? 'registry-clean-alpha4-store' : 'registry-consumer-store', source: relative(lockRoot, source).replaceAll(sep, '/'), lockfile: fromCleanStore ? 'clean-alpha4/pnpm-lock.yaml' : 'consumer/pnpm-lock.yaml', integrity: lock.integrity }
}

function assertDeclaredRange(edge, child, sources) {
  if (edge.range.startsWith('workspace:')) {
    const suffix = edge.range.slice('workspace:'.length)
    if (suffix !== '*' && suffix !== '^' && suffix !== '~' && !satisfiesVersion(child.manifest.version, suffix)) fail('workspace range is unsatisfied: ' + edge.parentKey + ' -> ' + child.key + ' (' + edge.range + ')')
    if (!pathWithin(sources.alpha, child.source)) fail('workspace dependency is outside official alpha4 checkout: ' + edge.parentKey + ' -> ' + child.key + ' (child ' + child.source + ', parent ' + edge.parentSource + ', root ' + sources.alpha + ')')
    return
  }
  if (!satisfiesVersion(child.manifest.version, edge.range)) fail('declared range is unsatisfied: ' + edge.parentKey + ' -> ' + child.key + ' (' + edge.range + ')')
}

/** Resolve and validate the exact local fixture graph from clean development inputs. */
export function fixtureRecords(root, manifest, env = sanitizedSubprocessEnv()) {
  const sources = fixtureSources(root, env)
  const records = new Map()
  const edges = []
  const edgeByParentName = new Map()
  const edgeIndex = new Map()
  const rootSource = sources.root
  const rootRecord = { key: packageKey(manifest.name, manifest.version), name: manifest.name, version: manifest.version, source: rootSource, manifest, provenance: { kind: 'consumer-source', realpath: rootSource } }
  const queue = dependencyEntries(manifest).map((entry) => ({ parent: rootRecord, ...entry }))
  while (queue.length > 0) {
    const pending = queue.shift()
    if (pending === undefined) continue
    const source = assertLocalFixture(pending.name, approvedFixtureSource(resolveFixtureSource({ parent: pending.parent, name: pending.name, range: pending.range, sources }), sources, 'fixture source'), { allowedSymlinkRoots: [sources.alpha, sources.root] })
    const packageManifest = manifestAt(source)
    const childKey = packageKey(packageManifest.name, packageManifest.version)
    if (packageManifest.name !== pending.name) fail('fixture name mismatch: requested ' + pending.name + ', found ' + packageManifest.name)
    const child = records.get(childKey) ?? (() => {
      const provenance = fixtureProvenance(root, sources, packageManifest.name, source, packageManifest.version)
      if (pathWithin(sources.alpha, source) && packageManifest.name.startsWith('@deepseek-ai/dsh-') && packageManifest.version !== ALPHA4_VERSION) fail('official fixture ' + packageManifest.name + ' has version ' + packageManifest.version + ', expected ' + ALPHA4_VERSION)
      if (!pathWithin(sources.alpha, source) && packageManifest.name.startsWith('@deepseek-ai/dsh-')) fail('DSH fixture is not sourced from official alpha4 checkout: ' + packageManifest.name)
      const record = { key: childKey, name: packageManifest.name, version: packageManifest.version, source, manifest: packageManifest, provenance, integrity: provenance.integrity }
      records.set(childKey, record)
      for (const entry of dependencyEntries(packageManifest)) queue.push({ parent: record, ...entry })
      return record
    })()
    const edge = { parentKey: pending.parent.key, parentName: pending.parent.name, parentVersion: pending.parent.version, parentSource: pending.parent.source, childKey, childName: child.name, childVersion: child.version, name: pending.name, range: pending.range, field: pending.field, optional: pending.optional }
    const parentNameKey = pending.parent.key + '>' + pending.name
    const previous = edgeByParentName.get(parentNameKey)
    if (previous !== undefined && previous.childKey !== edge.childKey) fail('parent dependency resolves to multiple versions: ' + parentNameKey)
    edgeByParentName.set(parentNameKey, edge)
    const edgeKey = edge.parentKey + '->' + edge.childKey
    const siblings = edgeIndex.get(edgeKey) ?? []
    siblings.push(edge)
    edgeIndex.set(edgeKey, siblings)
    assertDeclaredRange(edge, child, sources)
    edges.push(edge)
  }
  return { root: rootRecord, records, edges, edgeByParentName, edgeIndex, sources }
}

function normalizedFixtureManifest(record, graph) {
  const output = structuredClone(record.manifest)
  for (const edge of graph.edges.filter((candidate) => candidate.parentKey === record.key)) {
    const values = output[edge.field]
    if (values === undefined || !(edge.name in values)) fail('fixture dependency edge is missing from manifest: ' + record.key + ' -> ' + edge.name)
    if (typeof values[edge.name] !== 'string') fail('fixture dependency range is not a string for ' + edge.name)
    if (values[edge.name].startsWith('workspace:')) values[edge.name] = workspaceRange(values[edge.name], edge.childVersion)
  }
  delete output.scripts
  return output
}

function assertNativeFixture(record) {
  if (record.name === 'node-pty') {
    const nativeName = process.platform === 'win32' ? 'conpty.node' : 'pty.node'
    const native = join(record.source, 'prebuilds', process.platform + '-' + process.arch, nativeName)
    if (!existsSync(native)) fail('node-pty fixture has no native binary for ' + process.platform + '/' + process.arch)
    if (!existsSync(join(record.source, 'lib/index.js'))) fail('node-pty fixture has no runtime entrypoint')
  }
  if (record.name === 'playwright-core') {
    for (const path of ['index.js', 'index.mjs', 'browsers.json', 'lib/coreBundle.js']) if (!existsSync(join(record.source, path))) fail('playwright-core fixture is incomplete: ' + path)
  }
}

function copyFixtureStage(record, stage, graph) {
  assertLocalFixture(record.name, record.source, { version: record.version, allowedSymlinkRoots: [graph.sources.alpha, graph.sources.root] })
  cpSync(record.source, stage, {
    recursive: true,
    dereference: true,
    filter: (path) => {
      const child = relative(record.source, path)
      return child.length === 0 || (!child.split(sep).includes('node_modules') && !child.split(sep).includes('.git'))
    },
  })
  writeFileSync(join(stage, 'package.json'), JSON.stringify(normalizedFixtureManifest(record, graph), null, 2) + '\n')
}

function packFixture(record, stage, archives, env) {
  const output = command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', archives], { cwd: stage, env })
  let parsed
  try { parsed = JSON.parse(output) } catch { fail('npm pack returned invalid fixture JSON for ' + record.name) }
  const result = Array.isArray(parsed) ? parsed[0] : parsed
  const expectedFilename = record.name.replace(/^@/, '').replaceAll('/', '-') + '-' + record.manifest.version + '.tgz'
  if (result?.filename !== expectedFilename) fail('fixture archive filename mismatch for ' + record.name + ': expected ' + expectedFilename + ', found ' + String(result?.filename))
  const archive = join(archives, expectedFilename)
  if (!existsSync(archive) || !lstatSync(archive).isFile() || lstatSync(archive).isSymbolicLink()) fail('fixture archive is not a regular file: ' + archive)
  if (realpathSync(archive) !== resolve(archive)) fail('fixture archive is not its canonical realpath: ' + archive)
  const packedManifest = packageManifestFromArchive(archive, env)
  if (packedManifest.name !== record.name || packedManifest.version !== record.manifest.version) fail('fixture archive manifest mismatch for ' + record.name)
  record.archiveIntegrity = archiveDigest(archive)
  return archive
}

/** Pack each exact fixture graph node into a standalone local archive. */
export function createFixtureArchives(graph, directory, env = sanitizedSubprocessEnv()) {
  const requestedRoot = resolve(directory)
  if (lstatSync(requestedRoot, { throwIfNoEntry: false }) === undefined) mkdirSync(requestedRoot, { recursive: true })
  const preparationRoot = assertSafeDirectoryRoot(requestedRoot, 'fixture preparation temporary root')
  const stages = join(preparationRoot, 'fixture-stages')
  const archives = join(preparationRoot, 'fixture-archives')
  mkdirSync(stages, { recursive: true })
  mkdirSync(archives, { recursive: true })
  assertSafeDirectoryRoot(stages, 'fixture staging root')
  assertSafeDirectoryRoot(archives, 'fixture archive root')
  const stagePaths = new Map()
  for (const record of graph.records.values()) {
    assertNativeFixture(record)
    const stage = join(stages, record.name.replaceAll('/', '+') + '-' + record.version)
    if (lstatSync(stage, { throwIfNoEntry: false }) !== undefined) fail('fixture staging directory already exists: ' + stage)
    mkdirSync(stage, { recursive: false })
    assertSafeDirectoryRoot(stage, 'fixture staging directory')
    copyFixtureStage(record, stage, graph)
    stagePaths.set(record.key, stage)
  }
  const archivePaths = new Map()
  for (const [key, stage] of stagePaths) {
    const record = graph.records.get(key)
    if (record === undefined) fail('fixture record disappeared: ' + key)
    archivePaths.set(key, packFixture(record, stage, archives, env))
  }
  return archivePaths
}

function ensureSafeDirectoryPath(root, target, label) {
  const canonicalRoot = assertSafeDirectoryRoot(root, label + ' root')
  const requestedTarget = resolve(target)
  if (!pathWithin(canonicalRoot, requestedTarget)) fail(label + ' escapes repository root: ' + target)
  const child = relative(canonicalRoot, requestedTarget)
  let current = canonicalRoot
  for (const segment of child.split(sep).filter(Boolean)) {
    current = join(current, segment)
    const info = lstatSync(current, { throwIfNoEntry: false })
    if (info === undefined) {
      mkdirSync(current)
      continue
    }
    if (info.isSymbolicLink()) fail(label + ' contains a symlink or junction: ' + current)
    if (!info.isDirectory()) fail(label + ' contains a non-directory: ' + current)
    if (realpathSync(current) !== current) fail(label + ' escapes its requested root: ' + current)
  }
  return current
}

/** Persist exact fixture archives and their provenance for offline pack checks. */
export function persistFixtureBundle({ root, graph, archivePaths, destination = 'fixtures/alpha4' }) {
  const repositoryRoot = assertSafeDirectoryRoot(root, 'fixture repository root')
  const bundleRoot = resolve(repositoryRoot, destination)
  if (!pathWithin(repositoryRoot, bundleRoot) || bundleRoot === repositoryRoot) fail('persisted fixture destination escapes repository root: ' + destination)
  const bundleParent = ensureSafeDirectoryPath(repositoryRoot, dirname(bundleRoot), 'persisted fixture parent')
  const existingBundle = lstatSync(bundleRoot, { throwIfNoEntry: false })
  if (existingBundle !== undefined) assertSafeDirectoryTree(bundleRoot, 'persisted fixture root')
  let stagingRoot
  let backupRoot
  let installed = false
  return withCleanup(() => {
    stagingRoot = mkdtempSync(join(bundleParent, '.dsh-fixture-stage-'))
    assertSafeDirectoryRoot(stagingRoot, 'fixture staging root')
    const archiveRoot = join(stagingRoot, 'tarballs')
    mkdirSync(archiveRoot)
    assertSafeDirectoryRoot(archiveRoot, 'fixture staging archive root')
    const fixtures = []
    for (const record of [...graph.records.values()].sort((left, right) => left.key.localeCompare(right.key))) {
      const archive = archivePaths.get(record.key)
      if (archive === undefined) fail('fixture archive disappeared: ' + record.key)
      const archiveInfo = lstatSync(archive, { throwIfNoEntry: false })
      if (archiveInfo === undefined || !archiveInfo.isFile() || archiveInfo.isSymbolicLink() || realpathSync(archive) !== resolve(archive)) fail('fixture archive is not a regular canonical file: ' + archive)
      const filename = basename(archive)
      const persisted = join(archiveRoot, filename)
      const persistedInfo = lstatSync(persisted, { throwIfNoEntry: false })
      if (persistedInfo !== undefined) fail('fixture archive filename collision: ' + filename)
      cpSync(archive, persisted)
      fixtures.push({ key: record.key, name: record.name, version: record.version, archive: 'tarballs/' + filename, bytes: archiveByteSize(persisted), sha256: archiveSha256(persisted), integrity: record.archiveIntegrity, provenance: record.provenance })
    }
    const edges = graph.edges
      .map(({ parentSource, ...edge }) => edge)
      .sort((left, right) => (left.parentKey + '>' + left.childKey + ':' + left.field + ':' + left.name).localeCompare(right.parentKey + '>' + right.childKey + ':' + right.field + ':' + right.name))
    const payload = {
      schema: 1,
      alpha4: { repository: CLEAN_ALPHA4_REPOSITORY, tag: ALPHA4_TAG, revision: ALPHA4_REVISION },
      root: { key: graph.root.key, name: graph.root.name, version: graph.root.version },
      fixtures,
      edges,
    }
    writeFileSync(join(stagingRoot, 'PROVENANCE.json'), JSON.stringify(payload, null, 2) + '\n')
    assertSafeDirectoryTree(stagingRoot, 'fixture staging tree')
    if (existingBundle !== undefined) {
      backupRoot = mkdtempSync(join(bundleParent, '.dsh-fixture-backup-'))
      removeTemporaryTree(backupRoot, 'fixture backup placeholder')
      renameSync(bundleRoot, backupRoot)
    }
    renameSync(stagingRoot, bundleRoot)
    installed = true
    return bundleRoot
  }, [
    () => {
      if (backupRoot === undefined) return
      if (installed) {
        removeTemporaryTree(backupRoot, 'fixture backup root')
        backupRoot = undefined
        return
      }
      const destinationInfo = lstatSync(bundleRoot, { throwIfNoEntry: false })
      if (destinationInfo === undefined) {
        renameSync(backupRoot, bundleRoot)
        backupRoot = undefined
        return
      }
      fail('could not restore the previous fixture bundle: ' + bundleRoot)
    },
    () => {
      if (stagingRoot === undefined) return
      removeTemporaryTree(stagingRoot, 'fixture staging root')
      stagingRoot = undefined
    },
  ], 'fixture bundle persistence and cleanup failed')
}
