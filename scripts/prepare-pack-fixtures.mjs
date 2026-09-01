import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFixtureArchives, fixtureRecords, persistFixtureBundle } from './fixture-source.mjs'
import { assertSafeDirectoryRoot, removeTemporaryTree, sanitizedSubprocessEnv, withCleanup } from './check-pack.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const directory = mkdtempSync(join(root, '.tmp-pack-fixtures-'))
const userconfig = join(directory, 'empty-npmrc')
const gitconfig = join(directory, 'empty-gitconfig')
const npmCache = join(directory, 'empty-npm-cache')
const store = join(directory, 'empty-pnpm-store')
const env = sanitizedSubprocessEnv({
  npm_config_userconfig: userconfig,
  pnpm_config_userconfig: userconfig,
  npm_config_registry: 'http://127.0.0.1:9/',
  pnpm_config_registry: 'http://127.0.0.1:9/',
  npm_config_cache: npmCache,
  pnpm_config_store_dir: store,
  GIT_CONFIG_GLOBAL: gitconfig,
  GIT_CONFIG_NOSYSTEM: '1',
})

withCleanup(() => {
  writeFileSync(userconfig, '')
  writeFileSync(gitconfig, '')
  mkdirSync(npmCache, { recursive: true })
  mkdirSync(store, { recursive: true })
  assertSafeDirectoryRoot(directory, 'fixture preparation temporary root')
  assertSafeDirectoryRoot(npmCache, 'fixture preparation npm cache')
  assertSafeDirectoryRoot(store, 'fixture preparation pnpm store')
  const graph = fixtureRecords(root, manifest, env)
  const archives = createFixtureArchives(graph, directory, env)
  const destination = persistFixtureBundle({ root, graph, archivePaths: archives })
  console.log('persisted ' + archives.size + ' exact fixtures at ' + destination)
}, [() => removeTemporaryTree(directory, 'fixture preparation temporary root')], 'fixture preparation work and cleanup failed')
