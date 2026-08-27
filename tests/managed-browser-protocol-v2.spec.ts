import { describe, expect, it } from 'vitest'
import {
  decodeBrowserClientMessage,
  decodeBrowserStreamJsonFrameV2,
  decodeBrowserStreamFrameV2,
  encodeBrowserStreamFrameV2,
  encodeBrowserStreamJsonFrameV2,
  MANAGED_BROWSER_PROTOCOL_VERSION,
  type BrowserStreamFrameV2,
} from '../src/managed-browser-protocol.ts'

describe('managed Browser protocol v2', () => {
  it('round-trips layout identity separately from encoded JPEG dimensions', () => {
    const frame: BrowserStreamFrameV2 = {
      version: 2,
      sequence: 17,
      sentAt: 1_725_000_000_123,
      revision: 4,
      mediaGeneration: 3,
      viewport: { width: 1280, height: 800 },
      encodedSize: { width: 960, height: 600 },
      jpeg: new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]),
    }

    expect(MANAGED_BROWSER_PROTOCOL_VERSION).toBe(2)
    expect(decodeBrowserStreamFrameV2(encodeBrowserStreamFrameV2(frame))).toEqual(frame)
    expect(decodeBrowserStreamJsonFrameV2(encodeBrowserStreamJsonFrameV2(frame))).toEqual(frame)
  })

  it('validates revisioned client messages at the wire boundary', () => {
    expect(decodeBrowserClientMessage(JSON.stringify({
      type: 'layout-propose',
      proposalSequence: 8,
      mode: 'fit',
      viewport: { width: 900, height: 700 },
    }))).toEqual({
      type: 'layout-propose',
      proposalSequence: 8,
      mode: 'fit',
      viewport: { width: 900, height: 700 },
    })
    expect(decodeBrowserClientMessage(JSON.stringify({
      type: 'frame-ack', sequence: 9, revision: 3, mediaGeneration: 2,
    }))).toEqual({ type: 'frame-ack', sequence: 9, revision: 3, mediaGeneration: 2 })
    expect(decodeBrowserClientMessage(JSON.stringify({
      type: 'input', revision: 3, input: { type: 'tap', x: 4, y: 5 },
    }))).toEqual({ type: 'input', revision: 3, input: { type: 'tap', x: 4, y: 5 } })
    expect(decodeBrowserClientMessage('{"type":"input","revision":3,"input":{"type":"tap","x":"bad","y":5}}')).toBeUndefined()
    expect(decodeBrowserClientMessage('{"type":"hello","version":1,"frameEncodings":[],"flowControl":[]}')).toBeUndefined()
  })
})
