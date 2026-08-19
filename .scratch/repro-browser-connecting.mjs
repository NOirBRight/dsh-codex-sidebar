import crypto from 'node:crypto'
import WebSocket from 'ws'
const origin='http://127.0.0.1:3082'
const sessionId='repro-browser-connecting-'+Date.now()
const gate={sessionId,cwd:'/home/noirbright/Workstation/dsh-codex-sidebar',busy:false,turnWrites:[],roster:[],logs:{}}
async function rpc(endpoint,payload){
 const rpcId=crypto.randomUUID(); const started=Date.now()
 const response=await fetch(origin+'/codex-sidebar/'+endpoint,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({type:'client-request',rpcId,method:endpoint,payload})})
 const body=await response.json(); if(!response.ok||!body.result?.ok) throw new Error(endpoint+' failed after '+(Date.now()-started)+'ms: '+JSON.stringify(body))
 console.error(endpoint,(Date.now()-started)+'ms'); return body.result.value
}
const opened=await rpc('sidebar/dispatch',{...gate,intent:{type:'open-url',url:'https://www.baidu.com',reveal:false}})
const tabId=opened.snapshot.tabs.find(tab=>tab.kind==='Browser')?.id
if(!tabId) throw new Error('no Browser tab')
const ticket=await rpc('sidebar/browser-stream-ticket',{...gate,tabId})
const socket=new WebSocket('ws://127.0.0.1:3082'+ticket.path,{headers:{Origin:origin}})
const seen=await new Promise((resolve,reject)=>{
 const probe={x:521,y:136}
 const state={ready:false,projection:null,binary:false,bytes:0,outline:null,hoverTarget:null,tracked:null,boundaryStable:false,wheelSent:false}
 const timer=setTimeout(()=>reject(new Error('Browser hover/track response missing after 5s: '+JSON.stringify(state))),5000)
 socket.on('open',()=>socket.send(JSON.stringify({type:'outline'})))
 socket.on('message',(data,isBinary)=>{
  if(isBinary){state.binary=true;state.bytes=data.length}
  else {
   const msg=JSON.parse(data.toString())
   if(msg.type==='ready')state.ready=true
   if(msg.type==='state')state.projection=msg.projection
   if(msg.type==='outline'){
    state.outline=msg
    state.hoverTarget=msg.nodes?.filter(node=>node.rect&&probe.x>=node.rect.x&&probe.x<=node.rect.x+node.rect.w&&probe.y>=node.rect.y&&probe.y<=node.rect.y+node.rect.h).sort((a,b)=>a.rect.w*a.rect.h-b.rect.w*b.rect.h)[0]??null
    if(state.hoverTarget&&!state.wheelSent){
     const rect=state.hoverTarget.rect
     state.wheelSent=true
     socket.send(JSON.stringify({type:'input',input:{type:'wheel',x:probe.x,y:probe.y,deltaX:0,deltaY:-120,selector:state.hoverTarget.selector}}))
     state.initialRect=rect
    }
   }
   if(msg.type==='tracked-rect'){
    state.tracked=msg
    state.boundaryStable=JSON.stringify(msg.rect)===JSON.stringify(state.initialRect)
   }
  }
  if(state.projection?.status==='ready'&&state.binary&&state.hoverTarget&&state.boundaryStable){clearTimeout(timer);resolve(state)}
 })
 socket.on('error',reject)
 socket.on('close',(code,reason)=>{if(!(state.ready&&state.binary&&state.hoverTarget&&state.boundaryStable))reject(new Error('socket closed '+code+' '+reason))})
})
socket.close(1000)
console.log(JSON.stringify({sessionId,tabId,seen},null,2))
