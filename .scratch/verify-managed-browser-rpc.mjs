import crypto from 'node:crypto'
import WebSocket from 'ws'

const origin = 'http://127.0.0.1:3082'
const sessionId = 'managed-browser-lab-verification'
const gate = { sessionId, cwd: '/home/noirbright/Workstation/dsh-codex-sidebar-host-wire', busy: false, turnWrites: [], roster: [], logs: {} }

async function rpc(endpoint, payload) {
  const rpcId = crypto.randomUUID()
  const response = await fetch(origin + '/codex-sidebar/' + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + JSON.stringify(body))
  if (body.rpcId !== rpcId) throw new Error('rpc id mismatch')
  if (!body.result?.ok) throw new Error(body.result?.error?.message ?? JSON.stringify(body.result))
  return body.result.value
}

const opened = await rpc('sidebar/dispatch', { ...gate, intent: { type: 'open-url', url: 'http://127.0.0.1:3094', reveal: false } })
const tabId = opened.snapshot.tabs.find((tab) => tab.kind === 'Browser')?.id
if (!tabId) throw new Error('Browser Tab was not created')
const ticket = await rpc('sidebar/browser-stream-ticket', { ...gate, tabId })
const ws = new WebSocket('ws://127.0.0.1:3082' + ticket.path, { headers: { Origin: origin } })
const stream = await new Promise((resolve, reject) => {
  let ready = false
  let state = false
  let binary = false
  const timer = setTimeout(() => reject(new Error('stream timeout')), 15_000)
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      console.error('binary', data.length)
      const frame = Buffer.from(data)
      if (frame.length < 20 || frame.readUInt8(0) !== 1 || frame.readUInt8(17) !== 0xff || frame.readUInt8(18) !== 0xd8) return reject(new Error('invalid binary JPEG frame'))
      binary = true
    } else {
      const message = JSON.parse(data.toString())
      console.error('text', message.type, message.projection?.status ?? '')
      ready ||= message.type === 'ready'
      state ||= message.type === 'state' && message.projection?.status === 'ready'
    }
    if (ready && state && binary) { clearTimeout(timer); resolve({ ready, state, binary }) }
  })
  ws.on('error', reject)
  ws.on('close', (code, reason) => console.error('close', code, reason.toString()))
})
ws.send(JSON.stringify({ type: 'resize', width: 700, height: 800 }))
ws.send(JSON.stringify({ type: 'input', input: { type: 'wheel', x: 300, y: 300, deltaX: 0, deltaY: 120 } }))
const capture = await rpc('sidebar/browser-capture', { ...gate, tabId })
if (!capture.nodes.some((node) => node.selector === '#save')) throw new Error('capture is missing DOM boxes')
const evidence = await rpc('sidebar/browser-evidence-commit', { ...gate, captureId: capture.captureId })
const image = await rpc('sidebar/browser-evidence-read', { sessionId, evidence })
if (image.mediaType !== 'image/jpeg' || image.data.length < 100) throw new Error('evidence image was not readable')
await rpc('sidebar/dispatch', { ...gate, intent: { type: 'browser-set-annotate', on: true } })
await rpc('sidebar/dispatch', { ...gate, intent: { type: 'browser-click-content', mark: 'Save', x: 300, y: 180, captureId: capture.captureId, documentId: capture.documentId, selector: '#save', rect: { x: 0, y: 0, w: 20, h: 20 } } })
await rpc('sidebar/dispatch', { ...gate, intent: { type: 'browser-set-note-draft', text: 'lab screenshot' } })
const added = await rpc('sidebar/dispatch', { ...gate, intent: { type: 'browser-note-add', evidence } })
if (added.snapshot.attachments[0]?.evidence?.id !== evidence.id) throw new Error('annotation did not retain evidence')
ws.close(1000)
console.log(JSON.stringify({ tabId, stream, documentId: capture.documentId, nodes: capture.nodes.length, imageBytes: Buffer.from(image.data, 'base64').length, annotationEvidence: evidence.id }, null, 2))
