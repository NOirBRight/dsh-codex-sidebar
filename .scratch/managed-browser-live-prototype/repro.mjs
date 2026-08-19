import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'

const frontPort=9336, profile='/tmp/dcs-front-repro-'+process.pid
const wait=ms=>new Promise(r=>setTimeout(r,ms))
class Cdp{constructor(url){this.url=url;this.n=1;this.p=new Map()}async connect(){this.ws=new WebSocket(this.url);await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true})});this.ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(!m.id)return;const p=this.p.get(m.id);if(!p)return;this.p.delete(m.id);m.error?p.j(new Error(m.error.message)):p.r(m.result)})}send(method,params={}){const id=this.n++;this.ws.send(JSON.stringify({id,method,params}));return new Promise((r,j)=>this.p.set(id,{r,j}))}async eval(expression,awaitPromise=false){const x=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise});return x.result.value}}
async function target(port,title){const list=await fetch('http://127.0.0.1:'+port+'/json').then(r=>r.json());const t=list.find(x=>x.type==='page'&&x.title.includes(title));if(!t)throw new Error('target not found '+title);const c=new Cdp(t.webSocketDebuggerUrl);await c.connect();return c}
async function waitPort(port){for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:'+port+'/json')).ok)return}catch{}await wait(100)}throw new Error('port '+port+' unavailable')}
async function post(data){await fetch('http://127.0.0.1:3093/input',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})}
let frontChrome
try{
 const managed=await target(9335,'Northstar Live Workspace')
 frontChrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-allow-origins=*','--remote-debugging-port='+frontPort,'--user-data-dir='+profile,'--window-size=1440,900','http://127.0.0.1:3093/'],{stdio:'ignore'})
 await waitPort(frontPort);await wait(700)
 const front=await target(frontPort,'Real CDP Screencast')
 const health=await fetch('http://127.0.0.1:3093/health').then(r=>r.json())
 const budget=health.sourceFps<=35&&health.sourceKbps<=1800
 console.log('stream-budget',budget?'PASS':'FAIL',health)

 await managed.eval('scrollTo(0,0)');await wait(80)
 await post({type:'down',x:716,y:120});await post({type:'move',x:716,y:520,pressed:true});await post({type:'up',x:716,y:520});await wait(180)
 const dragY=await managed.eval('scrollY')
 console.log('scrollbar-drag',dragY>80?'PASS':'FAIL','scrollY='+dragY)

 await managed.eval('scrollTo(0,0)');
 const pencil=await front.eval(`(()=>{const r=document.querySelector('#pencil').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`)
 await front.send('Input.dispatchMouseEvent',{type:'mousePressed',x:pencil.x,y:pencil.y,button:'left',clickCount:1});await front.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pencil.x,y:pencil.y,button:'left',clickCount:1});await wait(250)
 const vp=await front.eval(`(()=>{const r=document.querySelector('#viewport').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`)
 await front.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:vp.x,y:vp.y,deltaX:0,deltaY:420});await wait(450)
 const annotationY=await managed.eval('scrollY')
 const pencilOn=await front.eval("document.querySelector('#pencil').classList.contains('on')")
 console.log('annotation-scroll',annotationY>80&&pencilOn?'PASS':'FAIL','scrollY='+annotationY,'pencil='+pencilOn)

 await front.eval("document.querySelector('#pencil').click()")
 const rafProbe=front.eval(`new Promise(resolve=>{const ds=[],start=performance.now();let last=start;function f(t){ds.push(t-last);last=t;if(t-start<1800)requestAnimationFrame(f);else{ds.sort((a,b)=>a-b);resolve({p95:ds[Math.floor(ds.length*.95)]||0,max:Math.max(...ds),n:ds.length})}}requestAnimationFrame(f)})`,true)
 for(let i=0;i<45;i++){await front.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:vp.x,y:vp.y,deltaX:0,deltaY:i%2?35:-35});await wait(28)}
 const raf=await rafProbe
 const smooth=raf.p95<35&&raf.max<100
 console.log('scroll-frame-gaps',smooth?'PASS':'FAIL',raf)
 await front.eval("performance.clearResourceTimings()")
 const mutationProbe=front.eval(`new Promise(resolve=>{let n=0;const c=document.querySelector('#screen');const o=new MutationObserver(xs=>{n+=xs.filter(x=>x.attributeName==='width'||x.attributeName==='height').length});o.observe(c,{attributes:true});setTimeout(()=>{o.disconnect();resolve(n)},1400)})`,true)
 for(let i=0;i<100;i++){await front.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:vp.x,y:vp.y,deltaX:0,deltaY:i%2?18:-18});await wait(7)}
 const canvasMutations=await mutationProbe
 const inputRequests=await front.eval("performance.getEntriesByType('resource').filter(x=>x.name.endsWith('/input')).length")
 const efficient=canvasMutations<=4&&inputRequests<=4
 console.log('allocation-pressure',efficient?'PASS':'FAIL',{canvasMutations,inputRequests})
 const ok=budget&&dragY>80&&annotationY>80&&pencilOn&&smooth&&efficient
 front.ws.close();managed.ws.close();process.exitCode=ok?0:1
}finally{try{frontChrome?.kill('SIGTERM')}catch{};await wait(150);await rm(profile,{recursive:true,force:true}).catch(()=>{})}
