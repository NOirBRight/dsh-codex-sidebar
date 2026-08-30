/** Loopback-only STUN so GUI Chrome and the encoder Page can ICE on 127.0.0.1. */

import { createSocket, type Socket } from 'node:dgram'

const BINDING_REQUEST = 0x0001
const BINDING_SUCCESS = 0x0101
const MAGIC_COOKIE = 0x2112a442
const XOR_MAPPED_ADDRESS = 0x0020
const IPV4 = 0x01

export type LoopbackStunServer = {
  url: string
  close: () => Promise<void>
}

/** Bind a STUN responder on 127.0.0.1 so both WebRTC peers share a loopback srflx pair. */
export function startLoopbackStunServer(): Promise<LoopbackStunServer> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createSocket('udp4')
    const close = () => new Promise<void>((done) => { socket.close(() => done()) })
    socket.once('error', reject)
    socket.on('message', (message, remote) => {
      const response = stunBindingSuccess(message, remote.address, remote.port)
      if (response !== undefined) socket.send(response, remote.port, remote.address)
    })
    socket.bind(0, '127.0.0.1', () => {
      socket.removeListener('error', reject)
      const address = socket.address()
      resolve({ url: 'stun:127.0.0.1:' + address.port, close })
    })
  })
}

export function stunBindingSuccess(request: Uint8Array, ip: string, port: number): Buffer | undefined {
  if (request.byteLength < 20) return undefined
  const view = Buffer.from(request.buffer, request.byteOffset, request.byteLength)
  if (view.readUInt16BE(0) !== BINDING_REQUEST || view.readUInt32BE(4) !== MAGIC_COOKIE) return undefined
  const [a, b, c, d] = ip.split('.').map((part) => Number(part))
  if (a === undefined || b === undefined || c === undefined || d === undefined
    || [a, b, c, d].some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined
  const response = Buffer.alloc(32)
  response.writeUInt16BE(BINDING_SUCCESS, 0)
  response.writeUInt16BE(12, 2)
  response.writeUInt32BE(MAGIC_COOKIE, 4)
  view.copy(response, 8, 8, 20)
  response.writeUInt16BE(XOR_MAPPED_ADDRESS, 20)
  response.writeUInt16BE(8, 22)
  response.writeUInt8(0, 24)
  response.writeUInt8(IPV4, 25)
  response.writeUInt16BE(port ^ (MAGIC_COOKIE >>> 16), 26)
  response.writeUInt8((a ^ (MAGIC_COOKIE >>> 24)) & 0xff, 28)
  response.writeUInt8((b ^ (MAGIC_COOKIE >>> 16)) & 0xff, 29)
  response.writeUInt8((c ^ (MAGIC_COOKIE >>> 8)) & 0xff, 30)
  response.writeUInt8((d ^ MAGIC_COOKIE) & 0xff, 31)
  return response
}
