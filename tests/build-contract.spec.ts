import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { persistFixtureBundle } from '../scripts/fixture-source.mjs'
import {
  archiveByteSize,
  archiveDigest,
  archiveSha256,
  assertLocalFixture,
  assertOfflineInstallArgs,
  assertPersistedFixtureArchive,
  assertPersistedFixtureFilesVisible,
  assertPackContainsClientTypes,
  assertNoForbiddenPackedFiles,
  assertSafeDirectoryRoot,
  assertSafeDirectoryTree,
  assertPackedJavaScriptClosure,
  assertPackedPackageLayout,
  packFilePaths,
  realPnpmInvocation,
  removeTemporaryTree,
  sanitizedSubprocessEnv,
  withCleanup,
} from '../scripts/check-pack.mjs'

interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, { types?: string } | string>
  peerDependencies?: Record<string, string>
  scripts?: Record<string, string>
  name: string
  version: string
}

function json<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T
}

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryPackage(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-codex-sidebar-contract-'))
  temporaryRoots.push(root)
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  return root
}

function temporaryFixtureBundle(): { root: string; bundleRoot: string; archive: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-codex-sidebar-fixture-contract-'))
  temporaryRoots.push(root)
  const bundleRoot = join(root, 'fixtures', 'alpha1')
  const archive = join(bundleRoot, 'tarballs', 'zod-4.4.3.tgz')
  mkdirSync(dirname(archive), { recursive: true })
  cpSync(new URL('../fixtures/alpha1/tarballs/zod-4.4.3.tgz', import.meta.url), archive)
  const git = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8', env: sanitizedSubprocessEnv({ GIT_CONFIG_NOSYSTEM: '1' }) })
  if (git.status !== 0) throw new Error('could not initialize fixture test repository')
  return { root, bundleRoot, archive }
}

describe('Alpha1 build contract', () => {
  it('typechecks the client face and emits its public declaration', () => {
    const manifest = json<Manifest>('../package.json')
    const client = json<{ include?: string[]; compilerOptions?: { emitDeclarationOnly?: boolean; outDir?: string; paths?: Record<string, string[]> } }>(
      '../tsconfig.client.json',
    )

    expect(manifest.scripts?.typecheck).toContain('tsconfig.client.check.json')
    expect(manifest.scripts?.build).toContain('tsconfig.client.json')
    expect(client.include).toContain('src/client/index.ts')
    expect(client.compilerOptions).toMatchObject({ emitDeclarationOnly: true, outDir: 'lib/types' })
    expect(manifest.exports?.['./client']).toMatchObject({ types: './lib/types/client/index.d.ts' })
    expect(client.compilerOptions?.paths?.['@deepseek-ai/dsh-client-ui-chat/client']).toEqual([
      '.dsh-alpha1/packages/client/ui-chat/lib/types/client/index.d.ts',
    ])
    expect(readFileSync(new URL('../scripts/prepare-alpha1-types.mjs', import.meta.url), 'utf8')).toContain(
      'packages/client/ui-chat/lib/types/client/index.d.ts',
    )
  })

  it('exercises packed Host and optional invariant lifecycle smoke', () => {
    const source = readFileSync(new URL('../scripts/check-pack.mjs', import.meta.url), 'utf8')
    expect(source).toContain("const host = new (await import('@deepseek-ai/cordis')).Context()")
    expect(source).toContain('const hostFiber = host.plugin(hostPlugin)')
    expect(source).toContain("packageManifest.exports?.['./invariant']")
    expect(source).toContain('for (const disposer of smokeCleanups.reverse())')
    expect(source).toContain('const client = registrations[0].factory(createRequire(clientEntry))')
  })

  it('uses only the real Alpha1 peer lane and keeps DSH packages out of runtime dependencies', () => {
    const manifest = json<Manifest>('../package.json')
    const dshPeers = Object.entries(manifest.peerDependencies ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    const runtimeDsh = Object.keys(manifest.dependencies ?? {})
      .filter((name) => name.startsWith('@deepseek-ai/dsh-'))
    const developmentDsh = Object.keys(manifest.devDependencies ?? {})
      .filter((name) => name.startsWith('@deepseek-ai/dsh-'))

    expect(dshPeers.length).toBeGreaterThan(0)
    expect(dshPeers.every(([, range]) => range === '0.1.2-alpha.1')).toBe(true)
    expect(manifest.peerDependencies?.['@deepseek-ai/dsh-client-ui-chat']).toBe('0.1.2-alpha.1')
    const clientInject = (manifest as Manifest & { dsh?: { client?: { inject?: string[] } } }).dsh?.client?.inject ?? []
    expect(clientInject).toContain('@deepseek-ai/dsh-client-ui-chat')
    expect(runtimeDsh).toEqual([])
    expect(developmentDsh).toEqual([])
  })

  it('accepts pnpm pack json from current and historical pnpm formats', () => {
    const pack = { files: [{ path: 'lib/types/client/index.d.ts' }] }
    expect(packFilePaths(pack)).toEqual(['lib/types/client/index.d.ts'])
    expect(packFilePaths([pack])).toEqual(['lib/types/client/index.d.ts'])
    expect(assertPackContainsClientTypes({
      root: '/pkg',
      manifest: { exports: { './client': { types: './lib/types/client/index.d.ts' } } },
      packJson: pack,
      fileExists: () => true,
    })).toBe('lib/types/client/index.d.ts')
  })

  it('rejects an export target absent from the packed files', () => {
    const root = temporaryPackage({ 'lib/index.js': 'export const value = 1\n' })
    expect(() => assertPackedPackageLayout({
      manifest: { exports: { '.': './lib/index.js', './client': './lib/client.js' } },
      packedFiles: ['lib/index.js'],
      packageRoot: root,
    })).toThrow(/missing from the tarball/)
  })

  it('rejects a packed JavaScript import absent from declarations', () => {
    const root = temporaryPackage({ 'lib/index.js': "require('not-declared')\n" })
    expect(() => assertPackedJavaScriptClosure({
      manifest: { dependencies: {} },
      packageRoot: root,
      packedFiles: ['lib/index.js'],
      entryPaths: ['lib/index.js'],
    })).toThrow(/undeclared package not-declared/)
  })

  it('rejects an unavailable local fixture', () => {
    expect(() => assertLocalFixture('missing-fixture', undefined)).toThrow(/missing local fixture/)
  })

  it('rejects a missing persisted fixture archive', () => {
    const { bundleRoot } = temporaryFixtureBundle()
    rmSync(join(bundleRoot, 'tarballs', 'zod-4.4.3.tgz'))
    expect(() => assertPersistedFixtureArchive(bundleRoot, { key: 'zod@4.4.3', archive: 'tarballs/zod-4.4.3.tgz', bytes: 759412, sha256: '0'.repeat(64), integrity: 'sha512-missing' })).toThrow(/unavailable/)
  })

  it('preserves an existing fixture bundle when persistence fails', () => {
    const { root, bundleRoot, archive } = temporaryFixtureBundle()
    const keep = join(bundleRoot, 'KEEP')
    writeFileSync(keep, 'preserve this bundle\n')
    const graph = {
      root: { key: 'fixture@1.0.0', name: 'fixture', version: '1.0.0' },
      records: new Map([['zod@4.4.3', {
        key: 'zod@4.4.3',
        name: 'zod',
        version: '4.4.3',
        archiveIntegrity: archiveDigest(archive),
        provenance: { kind: 'registry-consumer-store', source: 'node_modules/.pnpm/zod@4.4.3/node_modules/zod', lockfile: 'pnpm-lock.yaml', integrity: archiveDigest(archive) },
      }]]),
      edges: [],
    }
    expect(() => persistFixtureBundle({ root, graph, archivePaths: new Map() })).toThrow(/fixture archive disappeared/)
    expect(readFileSync(keep, 'utf8')).toBe('preserve this bundle\n')
    expect(readFileSync(join(bundleRoot, 'tarballs', 'zod-4.4.3.tgz')).length).toBeGreaterThan(0)
  })

  it('rejects a tampered persisted fixture archive', () => {
    const { bundleRoot, archive } = temporaryFixtureBundle()
    const integrity = archiveDigest(archive)
    const size = archiveByteSize(archive)
    const sha256 = archiveSha256(archive)
    const bytes = Buffer.from(readFileSync(archive))
    bytes[0] = bytes[0] ^ 1
    writeFileSync(archive, bytes)
    expect(() => assertPersistedFixtureArchive(bundleRoot, { key: 'zod@4.4.3', archive: 'tarballs/zod-4.4.3.tgz', bytes: size, sha256, integrity })).toThrow(/SHA-256 mismatch/)
  })

  it('rejects a fixture archive ignored by repository rules', () => {
    const { root } = temporaryFixtureBundle()
    writeFileSync(join(root, '.gitignore'), 'fixtures/alpha1/tarballs/zod-4.4.3.tgz\n')
    expect(() => assertPersistedFixtureFilesVisible(root, ['fixtures/alpha1/tarballs/zod-4.4.3.tgz'])).toThrow(/ignored/)
  })

  it('continues past an unusable Corepack candidate', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-codex-sidebar-pnpm-contract-'))
    temporaryRoots.push(root)
    const corepack = join(root, 'corepack', 'dist', 'pnpm.js')
    mkdirSync(dirname(corepack), { recursive: true })
    writeFileSync(corepack, '#!/bin/sh\n')
    chmodSync(corepack, 0o755)
    const brokenPackagePath = join(root, 'pnpm')
    writeFileSync(brokenPackagePath, 'not-a-directory')
    const first = join(root, 'first')
    const second = join(root, 'second')
    mkdirSync(first)
    mkdirSync(second)
    symlinkSync(corepack, join(first, 'pnpm'))
    const usable = join(second, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
    mkdirSync(dirname(usable), { recursive: true })
    writeFileSync(join(second, 'node_modules', 'pnpm', 'package.json'), JSON.stringify({ name: 'pnpm', version: '11.0.0' }))
    writeFileSync(usable, '#!/usr/bin/env node\n')
    chmodSync(usable, 0o755)
    symlinkSync(usable, join(second, 'pnpm'))
    expect(realPnpmInvocation({ Path: [first, second].join(delimiter) })).toEqual({ command: process.execPath, prefix: [usable] })
  })

  it('rejects an executable that is not pnpm', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-codex-sidebar-fake-pnpm-contract-'))
    temporaryRoots.push(root)
    symlinkSync(process.execPath, join(root, 'pnpm'))
    expect(() => realPnpmInvocation({ PATH: root })).toThrow(/real pnpm executable is unavailable/)
  })

  it('asserts the exact supported pnpm offline policy', () => {
    const args = [
      'install',
      '--offline',
      '--ignore-scripts',
      '--strict-peer-dependencies',
      '--lockfile=false',
      '--registry',
      'http://127.0.0.1:9/',
      '--store-dir',
      '/tmp/fresh-pnpm-store',
      '--config.audit=false',
      '--config.fund=false',
    ]
    expect(assertOfflineInstallArgs(args)).toEqual(args)
    expect(() => assertOfflineInstallArgs(args.filter((flag) => flag !== '--offline'))).toThrow(/--offline/)
    expect(() => assertOfflineInstallArgs(args.filter((flag) => flag !== '--config.audit=false'))).toThrow(/--config.audit=false/)
    expect(() => assertOfflineInstallArgs(args.filter((flag) => flag !== '--config.fund=false'))).toThrow(/--config.fund=false/)
    expect(() => assertOfflineInstallArgs([...args, '--no-audit'])).toThrow(/npm-only/)
    expect(() => assertOfflineInstallArgs([...args, '--no-fund'])).toThrow(/npm-only/)
  })

  it('rejects conflicting or duplicate pnpm policy flags', () => {
    const valid = [
      'install',
      '--offline',
      '--ignore-scripts',
      '--strict-peer-dependencies',
      '--lockfile=false',
      '--registry',
      'http://127.0.0.1:9/',
      '--store-dir',
      '/tmp/fresh-pnpm-store',
      '--config.audit=false',
      '--config.fund=false',
    ]
    expect(() => assertOfflineInstallArgs([...valid, '--offline'])).toThrow(/exactly one --offline/)
    expect(() => assertOfflineInstallArgs([...valid, '--offline=false'])).toThrow(/conflicting/)
    expect(() => assertOfflineInstallArgs([...valid, '--config.audit=true'])).toThrow(/conflicting/)
    expect(() => assertOfflineInstallArgs([...valid, '--registry', 'https://evil.invalid/'])).toThrow(/registry/)
    expect(() => assertOfflineInstallArgs([...valid, '--store-dir', '/tmp/other-store'])).toThrow(/exactly one --store-dir/)
  })

  it('rejects escaped and nonregular packed entries', () => {
    const root = temporaryPackage({
      'lib/index.js': 'export {}\n',
      'lib/client.js': 'export {}\n',
      'lib/types/client/index.d.ts': 'export {}\n',
    })
    const manifest = { name: 'fixture', version: '1.0.0', main: './lib/index.js', types: './lib/types/client/index.d.ts', exports: { './client': { types: './lib/types/client/index.d.ts' } } }
    expect(() => assertNoForbiddenPackedFiles(['../escape.js'], root)).toThrow(/escapes/)
    expect(() => assertPackedJavaScriptClosure({ manifest, packageRoot: root, packedFiles: ['../escape.js'], entryPaths: ['../escape.js'] })).toThrow(/escapes/)
    expect(() => assertPackContainsClientTypes({ root, manifest: { exports: { './client': { types: '../outside.d.ts' } } }, packJson: { files: [] }, fileExists: () => true })).toThrow(/escapes/)
  })

  it('rejects persisted fixture destinations outside the repository', () => {
    const root = temporaryPackage({ 'package.json': '{\"name\":\"fixture\",\"version\":\"1.0.0\"}\n' })
    expect(() => persistFixtureBundle({ root, graph: { records: new Map(), edges: [], root: { key: 'fixture@1.0.0', name: 'fixture', version: '1.0.0' } }, archivePaths: new Map(), destination: '../outside' })).toThrow(/escapes repository root/)
  })

  it('rejects symlinked exported files', () => {
    const root = temporaryPackage({ 'lib/index.js': 'export {}\n', 'lib/types.d.ts': 'export {}\n' })
    const outside = join(dirname(root), 'dsh-codex-sidebar-export-outside.js')
    temporaryRoots.push(outside)
    writeFileSync(outside, 'export {}\n')
    symlinkSync(outside, join(root, 'lib', 'client.js'))
    const manifest = { name: 'fixture', version: '1.0.0', main: './lib/index.js', types: './lib/types.d.ts', exports: { './client': './lib/client.js' } }
    expect(() => assertPackedPackageLayout({ manifest, packageRoot: root, packedFiles: ['lib/index.js', 'lib/types.d.ts', 'lib/client.js'] })).toThrow(/canonical file/)
  })

  it('scrubs credentials and config from captured child environments', () => {
    const source = {
      ...process.env,
      DSH_TEST_API_KEY: 'secret',
      DSH_TEST_PRIVATE_CERT: 'secret',
      DSH_TEST_AUTH_TOKEN: 'secret',
      DSH_TEST_SESSION_ID: 'secret',
      AWS_PROFILE: 'profile',
      NPM_CONFIG_USERCONFIG: '/home/user/.npmrc',
      NODE_PATH: '/tmp/node-path',
      NODE_OPTIONS: '--require hostile',
      GIT_CONFIG_PARAMETERS: 'core.sshCommand=hostile',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.sshCommand',
      GIT_CONFIG_VALUE_0: 'hostile',
      XDG_CONFIG_HOME: '/home/user/.config',
      XDG_CONFIG_DIRS: '/etc/xdg',
      XDG_CACHE_HOME: '/home/user/.cache',
      DSH_TEST_VISIBLE: 'yes',
    }
    const env = sanitizedSubprocessEnv({
      NODE_OPTIONS: '--require hostile',
      npm_config_registry: 'http://127.0.0.1:9/',
      pnpm_config_userconfig: '/tmp/empty-npmrc',
      pnpm_config_store_dir: '/tmp/fresh-store',
    }, source)
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { encoding: 'utf8', env })
    expect(child.status).toBe(0)
    const captured = JSON.parse(child.stdout) as Record<string, string>
    expect(captured.DSH_TEST_VISIBLE).toBe('yes')
    expect(captured.NODE_OPTIONS).toBeUndefined()
    for (const name of ['DSH_TEST_API_KEY', 'DSH_TEST_PRIVATE_CERT', 'DSH_TEST_AUTH_TOKEN', 'DSH_TEST_SESSION_ID', 'AWS_PROFILE', 'NPM_CONFIG_USERCONFIG', 'NODE_PATH', 'NODE_OPTIONS', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'XDG_CONFIG_HOME', 'XDG_CONFIG_DIRS', 'XDG_CACHE_HOME']) expect(captured[name]).toBeUndefined()
    expect(captured.npm_config_registry).toBe('http://127.0.0.1:9/')
    expect(captured.pnpm_config_userconfig).toBe('/tmp/empty-npmrc')
    expect(captured.pnpm_config_store_dir).toBe('/tmp/fresh-store')
  })

  it('rejects unsafe fixture trees before recursive operations', () => {
    const root = temporaryPackage({ 'package.json': '{"name":"fixture","version":"1.0.0"}\n' })
    const outside = join(dirname(root), 'dsh-codex-sidebar-outside-fixture-' + process.pid)
    temporaryRoots.push(outside)
    writeFileSync(outside, 'outside\n')
    symlinkSync(outside, join(root, 'escape'))
    expect(() => assertSafeDirectoryTree(root, 'fixture tree')).toThrow(/symlink or junction/)
    expect(() => removeTemporaryTree(root, 'fixture tree')).toThrow(/symlink or junction/)
  })

  it('rejects ignored fixture symlink roots', () => {
    const root = temporaryPackage({ 'package.json': '{\"name\":\"fixture\",\"version\":\"1.0.0\"}\n' })
    const outside = join(dirname(root), 'dsh-codex-sidebar-ignored-outside-' + process.pid)
    temporaryRoots.push(outside)
    mkdirSync(outside, { recursive: true })
    symlinkSync(outside, join(root, 'node_modules'))
    expect(() => assertLocalFixture('fixture', root)).toThrow(/symlink or junction/)
  })

  it('rejects nested external links inside ignored fixture trees', () => {
    const root = temporaryPackage({ 'package.json': '{\"name\":\"fixture\",\"version\":\"1.0.0\"}\n' })
    const outside = join(dirname(root), 'dsh-codex-sidebar-nested-outside-' + process.pid)
    temporaryRoots.push(outside)
    mkdirSync(outside, { recursive: true })
    mkdirSync(join(root, 'node_modules', 'nested'), { recursive: true })
    symlinkSync(outside, join(root, 'node_modules', 'nested', 'escape'))
    expect(() => assertLocalFixture('fixture', root)).toThrow(/outside approved roots/)
  })

  it('rejects a non-directory temporary root', () => {
    const root = temporaryPackage({ 'file.txt': 'content\n' })
    expect(() => assertSafeDirectoryRoot(join(root, 'file.txt'))).toThrow(/not a directory/)
  })

  it('preserves the primary failure while attempting every cleanup', () => {
    const primary = new Error('primary')
    const cleanupOne = new Error('cleanup one')
    const cleanupTwo = new Error('cleanup two')
    const attempted: string[] = []
    try {
      withCleanup(() => { throw primary }, [
        () => { attempted.push('one'); throw cleanupOne },
        () => { attempted.push('two'); throw cleanupTwo },
      ], 'teardown failed')
      throw new Error('expected cleanup failure')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors).toEqual([primary, cleanupOne, cleanupTwo])
    }
    expect(attempted).toEqual(['one', 'two'])
  })
})