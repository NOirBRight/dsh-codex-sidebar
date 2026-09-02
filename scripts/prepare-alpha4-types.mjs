import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sanitizedSubprocessEnv } from './subprocess-env.mjs'

export const ALPHA4_REVISION = '4e84901e6471b79ec0338099867ebb4606d12bb5'
export const ALPHA4_TAG = 'dsh-v0.1.2-alpha.4'
export const ALPHA4_VERSION = '0.1.2-alpha.4'
const OFFICIAL_REPOSITORY = 'deepseek-ai/deepseek-harness'
export const REQUIRED_TYPES = [
  'packages/api/remotes/lib/types/client/index.d.ts',
  'packages/api/session-controller/lib/types/client/index.d.ts',
  'packages/api/workspace-controller/lib/types/client/index.d.ts',
  'packages/client/connection/lib/types/client/index.d.ts',
  'packages/client/locale/lib/types/client/index.d.ts',
  'packages/client/store/lib/types/index.d.ts',
  'packages/client/ui-conversation/lib/types/client/index.d.ts',
  'packages/client/ui-chat/lib/types/client/index.d.ts',
  'packages/client/ui-layout/lib/types/client/index.d.ts',
  'packages/client/ui-renderer/lib/types/client/index.d.ts',
  'packages/client/ui-session/lib/types/client/index.d.ts',
  'packages/client/ui-slots/lib/types/index.d.ts',
  'packages/client/ui-workspace/lib/types/client/index.d.ts',
  'packages/core/session/lib/types/index.d.ts',
]

function repositoryOf(remote) {
  return remote
    .trim()
    .replace(/^git@github\.com:/, '')
    .replace(/^ssh:\/\/git@github\.com\//, '')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
}

export function assessAlpha4Checkout({ remote, status, head, tag, missingTypes = [] }) {
  const reasons = []
  if (repositoryOf(remote) !== OFFICIAL_REPOSITORY) reasons.push('origin is not deepseek-ai/deepseek-harness')
  if (status.trim() !== '') reasons.push('official DSH checkout has local changes')
  if (head.trim() !== ALPHA4_REVISION) reasons.push('official DSH revision is not ' + ALPHA4_REVISION)
  if (tag?.trim() !== ALPHA4_TAG) reasons.push('official DSH tag is not ' + ALPHA4_TAG)
  if (missingTypes.length > 0) reasons.push(`official DSH declarations are missing: ${missingTypes.join(', ')}`)
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

function git(checkout, env, ...args) {
  return execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', timeout: 10_000, env }).trim()
}

function inspect(checkout, env) {
  const missingTypes = REQUIRED_TYPES.filter((path) => !existsSync(resolve(checkout, path)))
  return assessAlpha4Checkout({
    remote: git(checkout, env, 'config', '--get', 'remote.origin.url'),
    status: git(checkout, env, 'status', '--porcelain'),
    head: git(checkout, env, 'rev-parse', 'HEAD'),
    tag: git(checkout, env, 'describe', '--exact-match', '--tags', 'HEAD'),
    missingTypes,
  })
}

function currentTarget(link) {
  try {
    const raw = readlinkSync(link)
    return isAbsolute(raw) ? raw : resolve(dirname(link), raw)
  } catch {
    return undefined
  }
}

export function prepareAlpha4Types({ root, requested = process.env.DSH_ALPHA4_CHECKOUT }) {
  const link = resolve(root, '.dsh-alpha4')
  const existing = currentTarget(link)
  const candidates = [requested === undefined ? undefined : resolve(requested), existing]
  const failures = []
  const env = sanitizedSubprocessEnv({ GIT_CONFIG_NOSYSTEM: '1' })
  let target
  for (const candidate of candidates) {
    if (candidate === undefined || !existsSync(candidate)) continue
    try {
      const actual = realpathSync(candidate)
      const result = inspect(actual, env)
      if (result.ok) {
        target = actual
        break
      }
      failures.push(`${candidate}: ${result.reasons.join('; ')}`)
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (target === undefined) {
    throw new Error([
      'dsh-codex-sidebar: provide DSH_ALPHA4_CHECKOUT pointing to a clean, built official dsh-v0.1.2-alpha.4 checkout.',
      'Build that checkout with `pnpm install --frozen-lockfile && pnpm run build` first.',
      ...failures,
    ].join('\n'))
  }
  if (existing === target) return target
  if (existsSync(link)) {
    if (!lstatSync(link).isSymbolicLink()) throw new Error(`${link} exists and is not a symbolic link`)
    rmSync(link)
  }
  symlinkSync(target, link, 'dir')
  return target
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  console.log(`dsh-codex-sidebar: .dsh-alpha4 -> ${prepareAlpha4Types({ root })}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
