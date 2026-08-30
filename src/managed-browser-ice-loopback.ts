/** Clone IPv4 host ICE candidates onto addresses both peers can actually reach. */

import { networkInterfaces } from 'node:os'

const HOST_LINE = /^(a=candidate:)(\S+) (\d+) (udp|UDP) (\d+) (\d+\.\d+\.\d+\.\d+) (\d+) (typ host)(.*)$/
const HOST_CAND = /^(candidate:)(\S+) (\d+) (udp|UDP) (\d+) (\d+\.\d+\.\d+\.\d+) (\d+) typ host(.*)$/

/** 127.0.0.1 plus non-fake-ip, non-internal IPv4s (Clash uses 198.18.0.0/15). */
export function extraHostIceAddresses(): string[] {
  const extras = ['127.0.0.1']
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal || isClashFakeIp(addr.address)) continue
      if (!extras.includes(addr.address)) extras.push(addr.address)
    }
  }
  return extras
}

/** Insert extra host lines next to each IPv4 host candidate in an SDP blob. */
export function sdpWithLoopbackHostCandidates(sdp: string, extras: readonly string[] = extraHostIceAddresses()): string {
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n'
  const lines = sdp.split(/\r?\n/)
  const extraLines: string[] = []
  let last = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const match = HOST_LINE.exec(line)
    if (match === null) continue
    last = i
    const port = match[7]!
    for (const ip of extras) {
      if (ip === match[6]) continue
      extraLines.push(match[1]! + match[2]! + 'x' + extraLines.length + ' ' + match[3]! + ' ' + match[4]! + ' ' + match[5]! + ' ' + ip + ' ' + port + ' ' + match[8]! + (match[9] ?? ''))
    }
  }
  if (extraLines.length === 0 || last < 0) return sdp
  lines.splice(last + 1, 0, ...extraLines)
  return lines.join(nl)
}

/** Clone one trickle host candidate onto shared addresses. */
export function candidateWithLoopbackHost(candidate: string, extras: readonly string[] = extraHostIceAddresses()): string[] {
  const match = HOST_CAND.exec(candidate)
  if (match === null) return []
  const port = match[7]!
  return extras.filter((ip) => ip !== match[6]).map((ip, index) => (
    match[1]! + match[2]! + 'x' + index + ' ' + match[3]! + ' ' + match[4]! + ' ' + match[5]! + ' ' + ip + ' ' + port + ' typ host' + (match[8] ?? '')
  ))
}

function isClashFakeIp(ip: string): boolean {
  const [a, b] = ip.split('.').map((part) => Number(part))
  return a === 198 && b !== undefined && b >= 18 && b <= 19
}
