import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const port = 3093
const cdpPort = 9335
const viewport = { width: 720, height: 860 }
const profile = '/tmp/dcs-cdp-prototype-' + process.pid
const sockets = new Set()
let chrome
let cdp
let lastWire = null
let sequence = 0
let sourceFrames = 0
let sourceFps = 0
let sourceBytes = 0
let sourceKbps = 0

class Cdp {
  constructor(url) { this.url=url; this.next=1; this.pending=new Map(); this.ws=null }
  async connect() {
    this.ws=new WebSocket(this.url)
    await new Promise((resolve,reject)=>{this.ws.addEventListener('open',resolve,{once:true});this.ws.addEventListener('error',reject,{once:true})})
    this.ws.addEventListener('message',event=>this.onMessage(JSON.parse(String(event.data))))
  }
  onMessage(msg) {
    if (msg.id) { const p=this.pending.get(msg.id); if(!p)return; this.pending.delete(msg.id); msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result); return }
    if (msg.method==='Page.screencastFrame') this.onFrame(msg.params)
  }
  onFrame(params) {
    this.send('Page.screencastFrameAck',{sessionId:params.sessionId}).catch(()=>{})
    const jpeg=Buffer.from(params.data,'base64')
    const header=Buffer.allocUnsafe(16)
    header.writeUInt32BE(++sequence,0)
    header.writeDoubleBE(Date.now(),4)
    header.writeUInt16BE(Math.min(65535,Math.round(params.metadata?.deviceWidth||viewport.width)),12)
    header.writeUInt16BE(Math.min(65535,Math.round(params.metadata?.deviceHeight||viewport.height)),14)
    sourceFrames++; sourceBytes+=jpeg.length
    lastWire=websocketFrame(Buffer.concat([header,jpeg]),2)
    for(const socket of sockets){if(socket.destroyed||socket.writableLength>512_000)continue;socket.write(lastWire)}
  }
  send(method,params={}) {
    if(!this.ws||this.ws.readyState!==WebSocket.OPEN)return Promise.reject(new Error('CDP unavailable'))
    const id=this.next++;this.ws.send(JSON.stringify({id,method,params}))
    return new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}))
  }
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/','http://127.0.0.1')
    if(url.pathname==='/input'&&req.method==='POST')return input(req,res)
    if(url.pathname==='/dom')return dom(res)
    if(url.pathname==='/health')return json(res,{ok:Boolean(cdp),sourceFps,sourceKbps,clients:sockets.size,transport:'binary-websocket'})
    const file=url.pathname==='/remote.html'?'remote.html':'index.html'
    const body=await readFile(join(root,file))
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(body)
  }catch(error){res.writeHead(500,{'content-type':'text/plain'});res.end(String(error))}
})
server.on('upgrade',(req,socket)=>{
  const url=new URL(req.url||'/','http://127.0.0.1')
  const key=req.headers['sec-websocket-key']
  if(url.pathname!=='/frames'||typeof key!=='string'){socket.destroy();return}
  const accept=createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n')
  sockets.add(socket);socket.on('data',chunk=>readClientFrames(socket,chunk));socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>sockets.delete(socket))
  if(lastWire)socket.write(lastWire)
})
function websocketFrame(payload,opcode){
  const n=payload.length;let head
  if(n<126){head=Buffer.allocUnsafe(2);head[1]=n}
  else if(n<65536){head=Buffer.allocUnsafe(4);head[1]=126;head.writeUInt16BE(n,2)}
  else{head=Buffer.allocUnsafe(10);head[1]=127;head.writeBigUInt64BE(BigInt(n),2)}
  head[0]=0x80|opcode
  return Buffer.concat([head,payload])
}
const clientBuffers=new WeakMap()
function readClientFrames(socket,chunk){
  let buf=Buffer.concat([clientBuffers.get(socket)||Buffer.alloc(0),chunk])
  while(buf.length>=2){let len=buf[1]&0x7f;let at=2;if(len===126){if(buf.length<4)break;len=buf.readUInt16BE(2);at=4}else if(len===127){if(buf.length<10)break;len=Number(buf.readBigUInt64BE(2));at=10}const masked=(buf[1]&0x80)!==0;if(!masked||buf.length<at+4+len)break;const mask=buf.subarray(at,at+4);at+=4;const payload=Buffer.from(buf.subarray(at,at+len));for(let i=0;i<payload.length;i++)payload[i]^=mask[i&3];const opcode=buf[0]&0x0f;buf=buf.subarray(at+len);if(opcode===8){socket.end();break}if(opcode!==1)continue;try{const value=JSON.parse(payload.toString('utf8'));if(value.kind==='input')void dispatchInput(value.input).catch(()=>{})}catch{}}
  clientBuffers.set(socket,buf)
}
async function input(req,res){const data=JSON.parse((await body(req)).toString('utf8'));if(!cdp)return json(res,{ok:false},503);await dispatchInput(data);json(res,{ok:true})}
async function dispatchInput(data){
  if(!cdp)return
  if(data.type==='wheel')await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:data.x,y:data.y,deltaX:data.deltaX||0,deltaY:data.deltaY||0})
  if(data.type==='down')await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:data.x,y:data.y,button:'left',buttons:1,clickCount:1})
  if(data.type==='up')await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:data.x,y:data.y,button:'left',buttons:0,clickCount:1})
  if(data.type==='move'){const pressed=data.pressed===true;await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:data.x,y:data.y,button:pressed?'left':'none',buttons:pressed?1:0})}
  if(data.type==='text')await cdp.send('Input.insertText',{text:String(data.text||'')})
}
async function dom(res){
  if(!cdp)return json(res,[],503)
  const expression=`Array.from(document.querySelectorAll('[data-annotate],button,input,a,h1,h2')).map((el,i)=>{const r=el.getBoundingClientRect();if(r.width<2||r.height<2||r.bottom<0||r.top>innerHeight)return null;return{id:el.id||('node-'+i),label:(el.innerText||el.getAttribute('placeholder')||el.tagName).trim().replace(/\s+/g,' ').slice(0,60),selector:el.id?'#'+el.id:el.tagName.toLowerCase()+':nth-of-type('+(Array.from(el.parentElement?.children||[]).filter(x=>x.tagName===el.tagName).indexOf(el)+1)+')',rect:{x:r.left,y:r.top,w:r.width,h:r.height}}}).filter(Boolean)`
  const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true});json(res,result.result.value||[])
}
function json(res,value,status=200){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value))}
async function body(req){const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks)}
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function waitForChrome(){for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:'+cdpPort+'/json/version');if(r.ok)return}catch{}await wait(100)}throw new Error('Chrome CDP did not start')}
async function launch(){
  chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-allow-origins=*','--disable-background-timer-throttling','--disable-renderer-backgrounding','--force-device-scale-factor=1','--remote-debugging-port='+cdpPort,'--user-data-dir='+profile,'--window-size='+viewport.width+','+viewport.height,'about:blank'],{stdio:['ignore','ignore','pipe']})
  chrome.stderr.on('data',chunk=>{const line=String(chunk);if(line.includes('DevTools listening'))console.log(line.trim())})
  await waitForChrome();const target=await fetch('http://127.0.0.1:'+cdpPort+'/json/new?'+encodeURIComponent('http://127.0.0.1:'+port+'/remote.html'),{method:'PUT'}).then(r=>r.json())
  cdp=new Cdp(target.webSocketDebuggerUrl);await cdp.connect();await cdp.send('Page.enable');await cdp.send('Runtime.enable')
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:62,maxWidth:viewport.width,maxHeight:viewport.height,everyNthFrame:2});console.log('CDP screencast target ready')
}
setInterval(()=>{sourceFps=sourceFrames;sourceKbps=Math.round(sourceBytes/1024);sourceFrames=0;sourceBytes=0;const wire=websocketFrame(Buffer.from(JSON.stringify({type:'stats',sourceFps,sourceKbps,clients:sockets.size})),1);for(const socket of sockets)if(!socket.destroyed)socket.write(wire)},1000).unref()
server.listen(port,'127.0.0.1',async()=>{console.log('Prototype: http://127.0.0.1:'+port);try{await launch()}catch(error){console.error(error);process.exitCode=1}})
async function shutdown(){try{chrome?.kill('SIGTERM')}catch{};await wait(250);await rm(profile,{recursive:true,force:true}).catch(()=>{});process.exit()}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown)
