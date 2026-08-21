/** Cheap URL/title checks so the managed Browser cannot nest DSH Web or sit on Cloudflare PoW. */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'])
const SELF_PORTS = new Set(['3080', '3082'])
const SELF_HOSTS = new Set(['dsh.noirbright.top', 'dshlab.noirbright.top'])

export const HARNESS_SELF_BLOCK_MESSAGE = '拒绝在托管 Browser 打开 DSH Web 自身，避免 GUI 套娃空转'
export const CHALLENGE_BLOCK_MESSAGE = 'Cloudflare 挑战页会打满 CPU，已停止加载'

export function harnessSelfBlockReason(url: string): string | undefined {
  let parsed: URL
  try { parsed = new URL(url) } catch { return undefined }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  const host = parsed.hostname.toLowerCase()
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  if (SELF_HOSTS.has(host)) return HARNESS_SELF_BLOCK_MESSAGE
  if (LOOPBACK.has(host) && SELF_PORTS.has(port)) return HARNESS_SELF_BLOCK_MESSAGE
  return undefined
}

export function isChallengePage(url: string, title: string): boolean {
  if (title.trim() === 'Just a moment...') return true
  try {
    const parsed = new URL(url)
    return parsed.searchParams.has('__cf_chl_rt_tk') || parsed.searchParams.has('__cf_chl_tk')
  } catch {
    return url.includes('__cf_chl')
  }
}
