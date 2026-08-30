/** Duplicate IPv4 host ICE candidates onto 127.0.0.1 when the socket is bound to 0.0.0.0. */

const HOST_LINE = /^(a=candidate:)(\S+) (\d+) (udp|UDP) (\d+) (?!127\.0\.0\.1)(\d+\.\d+\.\d+\.\d+) (\d+) (typ host)(.*)$/
const HOST_CAND = /^(candidate:)(\S+) (\d+) (udp|UDP) (\d+) (?!127\.0\.0\.1)(\d+\.\d+\.\d+\.\d+) (\d+) typ host(.*)$/

/** Insert 127.0.0.1 host lines next to non-loopback IPv4 host candidates in an SDP blob. */
export function sdpWithLoopbackHostCandidates(sdp: string): string {
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n'
  const lines = sdp.split(/\r?\n/)
  const extras: string[] = []
  let last = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const match = HOST_LINE.exec(line)
    if (match === null) continue
    last = i
    extras.push(match[1]! + match[2]! + 'loop ' + match[3]! + ' ' + match[4]! + ' ' + match[5]! + ' 127.0.0.1 ' + match[7]! + ' ' + match[8]! + (match[9] ?? ''))
  }
  if (extras.length === 0 || last < 0) return sdp
  lines.splice(last + 1, 0, ...extras)
  return lines.join(nl)
}

/** Clone one trickle host candidate onto 127.0.0.1; leave other candidates unchanged. */
export function candidateWithLoopbackHost(candidate: string): string | undefined {
  const match = HOST_CAND.exec(candidate)
  if (match === null) return undefined
  return match[1]! + match[2]! + 'loop ' + match[3]! + ' ' + match[4]! + ' ' + match[5]! + ' 127.0.0.1 ' + match[7]! + ' typ host' + (match[8] ?? '')
}
