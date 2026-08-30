import { createSocket } from 'node:dgram'
import { describe, expect, it } from 'vitest'
import { startLoopbackStunServer, stunBindingSuccess } from '../src/managed-browser-loopback-stun.ts'

describe('loopback STUN', () => {
  it('answers a Binding request with XOR-MAPPED-ADDRESS of the source', () => {
    const request = Buffer.alloc(20)
    request.writeUInt16BE(0x0001, 0)
    request.writeUInt16BE(0, 2)
    request.writeUInt32BE(0x2112a442, 4)
    request.write('txidtxidtxid', 8, 12, 'ascii')
    const response = stunBindingSuccess(request, '127.0.0.1', 54321)
    expect(response?.readUInt16BE(0)).toBe(0x0101)
    expect(response?.subarray(8, 20).toString('ascii')).toBe('txidtxidtxid')
    const port = response!.readUInt16BE(26) ^ 0x2112
    expect(port).toBe(54321)
    expect([
      (response!.readUInt8(28) ^ 0x21) & 0xff,
      (response!.readUInt8(29) ^ 0x12) & 0xff,
      (response!.readUInt8(30) ^ 0xa4) & 0xff,
      (response!.readUInt8(31) ^ 0x42) & 0xff,
    ]).toEqual([127, 0, 0, 1])
  })

  it('binds 127.0.0.1 and maps a real Binding request', async () => {
    const server = await startLoopbackStunServer()
    const port = Number(server.url.split(':').at(-1))
    const socket = createSocket('udp4')
    try {
      const request = Buffer.alloc(20)
      request.writeUInt16BE(0x0001, 0)
      request.writeUInt32BE(0x2112a442, 4)
      request.write('loopbacktxid', 8, 12, 'ascii')
      const reply = await new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('STUN timeout')), 1000)
        socket.once('message', (message) => { clearTimeout(timer); resolve(message) })
        socket.send(request, port, '127.0.0.1')
      })
      expect(reply.readUInt16BE(0)).toBe(0x0101)
      expect(server.url.startsWith('stun:127.0.0.1:')).toBe(true)
    } finally {
      socket.close()
      await server.close()
    }
  })
})
