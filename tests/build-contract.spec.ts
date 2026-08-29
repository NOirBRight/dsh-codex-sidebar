import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, { types?: string } | string>
  peerDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

function json<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T
}

describe('Alpha1 build contract', () => {
  it('typechecks the client face and emits its public declaration', () => {
    const manifest = json<Manifest>('../package.json')
    const client = json<{ include?: string[]; compilerOptions?: { emitDeclarationOnly?: boolean; outDir?: string } }>(
      '../tsconfig.client.json',
    )

    expect(manifest.scripts?.typecheck).toContain('tsconfig.client.check.json')
    expect(manifest.scripts?.build).toContain('tsconfig.client.json')
    expect(client.include).toContain('src/client/index.ts')
    expect(client.compilerOptions).toMatchObject({ emitDeclarationOnly: true, outDir: 'lib/types' })
    expect(manifest.exports?.['./client']).toMatchObject({ types: './lib/types/client/index.d.ts' })
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
    expect(dshPeers.every(([, range]) => range === '>=0.1.2-alpha.1 <0.1.3')).toBe(true)
    expect(runtimeDsh).toEqual([])
    expect(developmentDsh).toEqual([])
  })
})
