import { describe, expect, it } from 'vitest'
import {
  decodeBrowserClientMessage,
  decodeBrowserHostMessage,
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
    expect(decodeBrowserClientMessage(JSON.stringify({
      type: 'rtc-answer', ownerId: 'owner-1', revision: 3, mediaGeneration: 2,
      description: { type: 'answer', sdp: 'answer-sdp' },
    }))).toMatchObject({ type: 'rtc-answer', ownerId: 'owner-1', revision: 3, mediaGeneration: 2 })
    expect(decodeBrowserClientMessage(JSON.stringify({
      type: 'rtc-candidate', ownerId: 'owner-1', revision: 3, mediaGeneration: 2,
      candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
    }))).toMatchObject({ type: 'rtc-candidate', candidate: { candidate: 'candidate:1' } })
    expect(decodeBrowserClientMessage(JSON.stringify({
      type: 'media-retry', ownerId: 'owner-1', revision: 3, mediaGeneration: 2, trigger: 'network-change',
    }))).toMatchObject({ type: 'media-retry', trigger: 'network-change' })
    expect(decodeBrowserClientMessage(JSON.stringify({
      type: 'media-decline', ownerId: 'owner-1', revision: 3, mediaGeneration: 2, reason: 'presentation-failed',
    }))).toEqual({
      type: 'media-decline', ownerId: 'owner-1', revision: 3, mediaGeneration: 2, reason: 'presentation-failed',
    })
    expect(decodeBrowserClientMessage(JSON.stringify({
      type: 'media-decline', ownerId: 'owner-1', revision: 0, mediaGeneration: 2, reason: 'presentation-failed',
    }))).toBeUndefined()
    expect(decodeBrowserClientMessage(JSON.stringify({
      type: 'media-decline', ownerId: 'owner-1', revision: 3, mediaGeneration: 2, reason: 'unknown',
    }))).toBeUndefined()
    expect(decodeBrowserClientMessage('{"type":"hello","version":1,"frameEncodings":[],"flowControl":[],"media":{"webrtcVideo":true}}')).toBeUndefined()
    expect(decodeBrowserClientMessage('{"type":"rtc-answer","ownerId":"owner-1","revision":3,"mediaGeneration":2,"description":{"type":"offer","sdp":"bad"}}')).toBeUndefined()
    expect(decodeBrowserClientMessage(JSON.stringify({
      type: 'rtc-answer', ownerId: 'owner-1', revision: 3, mediaGeneration: 2,
      description: { type: 'answer', sdp: 'x'.repeat(64 * 1024 + 1) },
    }))).toBeUndefined()
    expect(decodeBrowserClientMessage(JSON.stringify({
      type: 'rtc-candidate', ownerId: 'owner-1', revision: 3, mediaGeneration: 2,
      candidate: { candidate: 'x'.repeat(4 * 1024 + 1) },
    }))).toBeUndefined()
  })

  it('strictly decodes Host WebRTC signaling with exact layout identity', () => {
    expect(decodeBrowserHostMessage(JSON.stringify({
      type: 'ready', version: 2, frameEncoding: 'binary-v2', flowControl: 'frame-ack-v2',
      fallback: { maxRawBytes: 1024 }, ownerId: 'owner-1',
      media: {
        preferredRoute: 'webrtc-direct', stunOnly: true, negotiationTimeoutMs: 5000, retryCooldownMs: 30000,
        frameRate: 10, maxBitrate: 2_000_000, idleTimeoutMs: 300_000, hideGraceMs: 15_000,
      },
      layoutPolicy: { minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 },
    }))).toMatchObject({
      type: 'ready', ownerId: 'owner-1',
      media: { preferredRoute: 'webrtc-direct', stunOnly: true, frameRate: 10, maxBitrate: 2_000_000, idleTimeoutMs: 300_000, hideGraceMs: 15_000 },
    })
    expect(decodeBrowserHostMessage(JSON.stringify({
      type: 'ready', version: 2, frameEncoding: 'binary-v2', flowControl: 'frame-ack-v2',
      fallback: { maxRawBytes: 1024 }, ownerId: 'owner-1',
      media: {
        preferredRoute: 'webrtc-direct', stunOnly: true, negotiationTimeoutMs: 5000, retryCooldownMs: 30000,
        frameRate: 10, maxBitrate: 2_000_000, idleTimeoutMs: 300_000, hideGraceMs: -1,
      },
      layoutPolicy: { minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 },
    }))).toBeUndefined()
    expect(decodeBrowserHostMessage(JSON.stringify({
      type: 'ready', version: 2, frameEncoding: 'binary-v2', flowControl: 'frame-ack-v2',
      fallback: { maxRawBytes: 1024 }, ownerId: 'owner-1',
      media: {
        preferredRoute: 'webrtc-direct', stunOnly: true, negotiationTimeoutMs: 5000, retryCooldownMs: 30000,
        frameRate: 10, maxBitrate: 2_000_000, idleTimeoutMs: 300_000,
      },
      layoutPolicy: { minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 },
    }))).toBeUndefined()
    expect(decodeBrowserHostMessage(JSON.stringify({
      type: 'rtc-offer', ownerId: 'owner-1', revision: 4, mediaGeneration: 3,
      description: { type: 'offer', sdp: 'offer-sdp' },
    }))).toEqual({
      type: 'rtc-offer', ownerId: 'owner-1', revision: 4, mediaGeneration: 3,
      description: { type: 'offer', sdp: 'offer-sdp' },
    })
    expect(decodeBrowserHostMessage(JSON.stringify({
      type: 'rtc-candidate', ownerId: 'owner-1', revision: 4, mediaGeneration: 3, candidate: null,
    }))).toEqual({ type: 'rtc-candidate', ownerId: 'owner-1', revision: 4, mediaGeneration: 3, candidate: null })
    expect(decodeBrowserHostMessage('{"type":"rtc-offer","ownerId":"","revision":4,"mediaGeneration":3,"description":{"type":"offer","sdp":"x"}}')).toBeUndefined()
  })
})
