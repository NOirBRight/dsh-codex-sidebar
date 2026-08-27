import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findBrowserExecutable, ManagedBrowserRuntime, PLAYWRIGHT_IGNORE_DEFAULT_ARGS } from '../src/managed-browser-runtime.ts'
import { ManagedBrowserWebRtcEncoder, type BrowserMediaSignal, type BrowserRtcCandidate, type BrowserRtcDescription } from '../src/managed-browser-webrtc.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

describe('real managed Browser WebRTC encoder', () => {
  it.skipIf(process.env.DSH_BROWSER_E2E !== '1')('replays the latest pre-connect frame and changes encoded size without leaking its Page', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-webrtc-'))
    const context = await launchContext(profileDir)
    const runtime = new ManagedBrowserRuntime({ executablePath: '/bin/true', profileDir, launch: async () => context as never })
    cleanups.push(async () => { await runtime.dispose(); await rm(profileDir, { recursive: true, force: true }) })
    const receiver = await context.newPage()
    const pageCountWithReceiver = context.pages().length
    const signals: BrowserMediaSignal[] = []
    const encoder = new ManagedBrowserWebRtcEncoder({
      identity: { ownerId: 'real-owner', generation: 1 },
      pageFactory: () => runtime.createMediaPage(),
      width: 640,
      height: 480,
      frameRate: 12,
      maxBitrate: 1_500_000,
      onSignal: (signal) => { signals.push(signal) },
    })
    cleanups.push(async () => { await encoder.dispose() })

    const offer = await encoder.start()
    encoder.submit({ sequence: 1, width: 640, height: 480, jpeg: await solidJpeg(receiver, 640, 480, '#e11d48') })
    await vi.waitFor(() => { expect(signals.some((value) => value.signal.type === 'candidate' && value.signal.candidate === null)).toBe(true) }, { timeout: 10_000 })
    const candidates = signals.flatMap((value) => value.signal.type === 'candidate' && value.signal.candidate !== null ? [value.signal.candidate] : [])
    const answer = await receiverAnswer(receiver, offer, candidates)
    await encoder.acceptAnswer(answer)

    await vi.waitFor(() => { expect(signals.some((value) => value.signal.type === 'connection-state' && value.signal.state === 'connected')).toBe(true) }, { timeout: 10_000 })
    await receiver.waitForFunction(() => {
      const video = (globalThis as unknown as { __dcsReceiver: { video: HTMLVideoElement } }).__dcsReceiver.video
      return video.readyState >= 2 && video.videoWidth === 640 && video.videoHeight === 480
    }, undefined, { timeout: 10_000 })
    const firstPixel = await centerPixel(receiver)
    expect(firstPixel[0]).toBeGreaterThan(180)
    expect(firstPixel[1]).toBeLessThan(80)
    expect(firstPixel[2]).toBeLessThan(120)

    encoder.submit({ sequence: 2, width: 320, height: 240, jpeg: await solidJpeg(receiver, 320, 240, '#2563eb') })
    await receiver.waitForFunction(() => {
      const video = (globalThis as unknown as { __dcsReceiver: { video: HTMLVideoElement } }).__dcsReceiver.video
      return video.videoWidth === 320 && video.videoHeight === 240
    }, undefined, { timeout: 10_000 })
    const secondPixel = await centerPixel(receiver)
    expect(secondPixel[2]).toBeGreaterThan(180)
    expect(secondPixel[0]).toBeLessThan(80)
    const stats = await receiverStats(receiver)
    expect(stats.framesDecoded).toBeGreaterThanOrEqual(2)
    expect(stats.keyFramesDecoded).toBeGreaterThanOrEqual(1)

    await encoder.dispose()
    await vi.waitFor(() => { expect(context.pages()).toHaveLength(pageCountWithReceiver) })
  }, 30_000)
})

async function launchContext(profileDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir, {
    executablePath: await findBrowserExecutable(),
    headless: true,
    viewport: { width: 640, height: 480 },
    ignoreDefaultArgs: PLAYWRIGHT_IGNORE_DEFAULT_ARGS,
  })
}

async function solidJpeg(page: Page, width: number, height: number, color: string): Promise<Uint8Array> {
  const base64 = await page.evaluate(({ width, height, color }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('missing JPEG test context')
    context.fillStyle = color
    context.fillRect(0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.9).slice('data:image/jpeg;base64,'.length)
  }, { width, height, color })
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

async function receiverAnswer(page: Page, offer: BrowserRtcDescription, candidates: BrowserRtcCandidate[]): Promise<BrowserRtcDescription> {
  return page.evaluate(async ({ offer, candidates }) => {
    document.body.innerHTML = '<video autoplay muted playsinline></video>'
    const video = document.querySelector('video')
    if (video === null) throw new Error('missing receiver video')
    const peer = new RTCPeerConnection()
    ;(globalThis as unknown as { __dcsReceiver: unknown }).__dcsReceiver = { peer, video }
    peer.ontrack = (event) => {
      video.srcObject = event.streams[0] ?? new MediaStream([event.track])
      void video.play()
    }
    await peer.setRemoteDescription(offer)
    for (const candidate of candidates) await peer.addIceCandidate(candidate)
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    await new Promise<void>((resolve) => {
      if (peer.iceGatheringState === 'complete') {
        resolve()
        return
      }
      const listener = (): void => {
        if (peer.iceGatheringState !== 'complete') return
        peer.removeEventListener('icegatheringstatechange', listener)
        resolve()
      }
      peer.addEventListener('icegatheringstatechange', listener)
    })
    const description = peer.localDescription
    if (description === null) throw new Error('missing receiver answer')
    return description.toJSON() as BrowserRtcDescription
  }, { offer, candidates })
}

async function centerPixel(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const { video } = (globalThis as unknown as { __dcsReceiver: { video: HTMLVideoElement } }).__dcsReceiver
    const canvas = new OffscreenCanvas(1, 1)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('missing receiver sample context')
    context.drawImage(video, 0, 0, 1, 1)
    return Array.from(context.getImageData(0, 0, 1, 1).data)
  })
}

async function receiverStats(page: Page): Promise<{ framesDecoded: number; keyFramesDecoded: number }> {
  return page.evaluate(async () => {
    const { peer } = (globalThis as unknown as { __dcsReceiver: { peer: RTCPeerConnection } }).__dcsReceiver
    const report = [...(await peer.getStats()).values()].find((value) => value.type === 'inbound-rtp' && value.kind === 'video')
    return {
      framesDecoded: Number(report?.framesDecoded ?? 0),
      keyFramesDecoded: Number(report?.keyFramesDecoded ?? 0),
    }
  })
}
