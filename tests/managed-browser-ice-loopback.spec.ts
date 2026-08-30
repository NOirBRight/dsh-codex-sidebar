import { describe, expect, it } from 'vitest'
import { candidateWithLoopbackHost, sdpWithLoopbackHostCandidates } from '../src/managed-browser-ice-loopback.ts'

describe('loopback host ICE candidates', () => {
  it('duplicates IPv4 host candidates onto 127.0.0.1 and leaves loopback/srflx alone', () => {
    const sdp = [
      'v=0',
      'a=candidate:1 1 udp 1 198.18.0.1 35366 typ host generation 0',
      'a=candidate:2 1 udp 1 127.0.0.1 9 typ host generation 0',
      'a=candidate:3 1 udp 1 178.1.2.3 4 typ srflx raddr 198.18.0.1 rport 35366',
      '',
    ].join('\r\n')
    const out = sdpWithLoopbackHostCandidates(sdp)
    expect(out).toContain('198.18.0.1 35366 typ host')
    expect(out).toContain('127.0.0.1 35366 typ host')
    expect(out.match(/127\.0\.0\.1 35366/g)).toHaveLength(1)
    expect(candidateWithLoopbackHost('candidate:1 1 udp 1 198.18.0.1 35366 typ host generation 0')).toBe(
      'candidate:1loop 1 udp 1 127.0.0.1 35366 typ host generation 0',
    )
    expect(candidateWithLoopbackHost('candidate:3 1 udp 1 178.1.2.3 4 typ srflx raddr 198.18.0.1 rport 35366')).toBeUndefined()
  })
})
