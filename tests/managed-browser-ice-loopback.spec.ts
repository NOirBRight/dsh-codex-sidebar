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
    const out = sdpWithLoopbackHostCandidates(sdp, ['127.0.0.1', '192.168.50.75'])
    expect(out).toContain('198.18.0.1 35366 typ host')
    expect(out).toContain('127.0.0.1 35366 typ host')
    expect(out).toContain('192.168.50.75 35366 typ host')
    expect(candidateWithLoopbackHost('candidate:1 1 udp 1 198.18.0.1 35366 typ host generation 0', ['127.0.0.1'])).toEqual([
      'candidate:1x0 1 udp 1 127.0.0.1 35366 typ host generation 0',
    ])
    expect(candidateWithLoopbackHost('candidate:3 1 udp 1 178.1.2.3 4 typ srflx raddr 198.18.0.1 rport 35366')).toEqual([])
  })
})
