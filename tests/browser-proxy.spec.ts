import { describe, expect, it } from 'vitest'
import { DCS_PICK_HIT, DCS_PICK_TYPE, injectPickScript, pickProxyPath } from '../src/browser-pick.ts'
import { DCS_PICK_SCRIPT } from '../src/browser-pick-script.ts'
import { createLocalPickProxy, stripProxyResponseHeaders } from '../src/host-browser-proxy.ts'

describe('localhost pick proxy', () => {
  it('injects a postMessage picker and never binds a real port in tests', () => {
    expect(DCS_PICK_SCRIPT).toContain(DCS_PICK_TYPE)
    expect(DCS_PICK_SCRIPT).toContain(DCS_PICK_HIT)
    expect(DCS_PICK_SCRIPT).toContain('elementFromPoint')
    expect(DCS_PICK_SCRIPT).toContain('dcs-nav')
    expect(DCS_PICK_SCRIPT).toContain('/__dcs/drive/wait')
    expect(injectPickScript('<html><body>app</body></html>')).toContain('/__dcs/pick.js')
    expect(injectPickScript('<html><head><meta http-equiv="Content-Security-Policy" content="script-src none"></head><body></body></html>')).not.toContain('Content-Security-Policy')

    const proxy = createLocalPickProxy({
      listen: () => 9,
    })
    expect(proxy.frameUrl('http://127.0.0.1:1420/chat')).toBe(
      `http://127.0.0.1:9${pickProxyPath('http://127.0.0.1:1420/chat')}`,
    )
    expect(proxy.frameUrl('https://example.com')).toBeUndefined()
    proxy.close()
  })

  it('strips framing and CSP headers so the injected picker can run', () => {
    const headers = stripProxyResponseHeaders({
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "script-src 'self'",
      'x-frame-options': 'DENY',
      'content-encoding': 'gzip',
      'content-length': '12',
      'cache-control': 'no-cache',
    })
    expect(headers['content-type']).toBe('text/html; charset=utf-8')
    expect(headers['cache-control']).toBe('no-cache')
    expect(headers['content-security-policy']).toBeUndefined()
    expect(headers['x-frame-options']).toBeUndefined()
    expect(headers['content-encoding']).toBeUndefined()
  })
})
