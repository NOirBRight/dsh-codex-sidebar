import crypto from 'node:crypto'
import WebSocket from 'ws'
const origin='http://127.0.0.1:3082'
const sessionId='repro-browser-connecting-'+Date.now()
const gate={sessionId,cwd:'/home/noirbright/Workstation/dsh-codex-sidebar-host-wire',busy:false,turnWrites:[],roster:[],logs:{}}
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
 const state={ready:false,projection:null,binary:false,bytes:0}; const timer=setTimeout(()=>reject(new Error('Connecting persisted for 20s: '+JSON.stringify(state))),20000)
 socket.on('message',(data,isBinary)=>{if(isBinary){state.binary=true;state.bytes=data.length}else{const msg=JSON.parse(data.toString());if(msg.type==='ready')state.ready=true;if(msg.type==='state')state.projection=msg.projection}if(state.ready&&state.projection?.status==='ready'&&state.binary){clearTimeout(timer);resolve(state)}})
 socket.on('error',reject); socket.on('close',(code,reason)=>{if(!(state.ready&&state.binary))reject(new Error('socket closed '+code+' '+reason))})
})
socket.close(1000)
console.log(JSON.stringify({sessionId,tabId,seen},null,2))
