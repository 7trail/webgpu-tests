import { T1 } from './test1.js';
import { T2 } from './test2.js';
import { T3 } from './test3.js';
import { T4 } from './test4.js';
import { T5 } from './test5.js';
import { T6 } from './test6.js';
import { T7 } from './test7.js';
import { T8 } from './test8.js';
import { T9 } from './test9.js';
import { T10 } from './test10.js';
import { T11 } from './test11.js';
import { T12 } from './test12.js';
import { T13 } from './test13.js';
import { T14 } from './test14.js';
import { T15 } from './test15.js';
import { T16 } from './test16.js';
import { T17 } from './test17.js';
import { T18 } from './test18.js';
import { T19 } from './test19.js';
import { T20 } from './test20.js';

const TESTS = [T1,T2,T3,T4,T5,T6,T7,T8,T9,T10,T11,T12,T13,T14,T15,T16,T17,T18,T19,T20];
const canvas = document.getElementById('gpu-canvas');
const listEl = document.getElementById('test-list');
const logEl = document.getElementById('log');
const statusEl = document.getElementById('gpu-status');
const hudTest = document.getElementById('hud-test');
const hudFps = document.getElementById('hud-fps');
const hudFrame = document.getElementById('hud-frame');
const resultsBody = document.getElementById('results-body');
const hudLow = document.getElementById('hud-low');
const graph = document.getElementById('fps-graph');
const gtx = graph.getContext('2d');
let device=null, adapterInfo='n/a', currentCleanup=null, stopFlag=false, activeBtn=null;

export function log(msg, cls=''){ const d=document.createElement('div'); if(cls)d.className=cls; d.textContent=`[${new Date().toLocaleTimeString()}] ${msg}`; logEl.appendChild(d); logEl.scrollTop=logEl.scrollHeight; }
function setRow(i, patch){ const id=`row-${i}`; let tr=document.getElementById(id); if(!tr){ tr=document.createElement('tr'); tr.id=id; tr.innerHTML=`<td>${i+1}</td><td></td><td></td><td></td><td></td><td></td><td></td>`; resultsBody.appendChild(tr);} const c=tr.children; if(patch.title!==undefined)c[1].textContent=patch.title; if(patch.status!==undefined){c[2].textContent=patch.status;c[2].className=patch.status.startsWith('PASS')?'pass':patch.status.startsWith('FAIL')?'fail':'';} if(patch.fps!==undefined)c[3].textContent=patch.fps; if(patch.low!==undefined)c[4].textContent=patch.low; if(patch.frames!==undefined)c[5].textContent=patch.frames; if(patch.notes!==undefined)c[6].textContent=patch.notes; }

async function initGPU(){
  if(!navigator.gpu){ statusEl.textContent='WebGPU unavailable'; statusEl.classList.add('bad'); log('navigator.gpu missing — use a WebGPU browser + secure context.','err'); return false; }
  try{
    const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if(!adapter){ statusEl.textContent='no adapter'; statusEl.classList.add('bad'); log('requestAdapter returned null.','err'); return false; }
    adapterInfo=[adapter.info?.vendor,adapter.info?.device,adapter.info?.architecture].filter(Boolean).join(' ')||'adapter ok';
    device=await adapter.requestDevice();
    device.lost.then(i=>{ log(`device lost: ${i.reason} ${i.message}`,'err'); statusEl.textContent='device lost'; });
    statusEl.textContent='WebGPU ready'; statusEl.classList.add('ok');
    log(`WebGPU ready — ${adapterInfo}`,'ok');
    return true;
  }catch(e){ statusEl.textContent='init failed'; statusEl.classList.add('bad'); log('init failed: '+e.message,'err'); return false; }
}
function stopCurrent(){ if(currentCleanup){ try{currentCleanup();}catch(e){} currentCleanup=null; } stopFlag=true; document.getElementById('stop').disabled=true; }

async function runOne(i, secs=0){
  stopCurrent(); await new Promise(r=>setTimeout(r,60));
  stopFlag=false;
  if(!device){ log('No WebGPU device — cannot run tests in this browser. Try Chrome/Edge 113+ with hardware or SwiftShader.','err'); return false; }
  const t=TESTS[i];
  if(activeBtn)activeBtn.classList.remove('active');
  activeBtn=listEl.children[i]; activeBtn.classList.add('active');
  hudTest.textContent=`test ${i+1}: ${t.id}`;
  log(`—— Test ${i+1}/${TESTS.length}: ${t.title} ——`); log(t.description,'dim');
  setRow(i,{title:t.title,status:'RUN…',fps:'—',low:'—',frames:'—',notes:t.checks});
  document.getElementById('stop').disabled=false;
  const stats={frames:0,t0:performance.now(),last:performance.now(),tick:0,dts:[]};
  const currentFpsOf=(dts)=>{ const n=Math.min(60,dts.length); if(!n) return 0; let s=0; for(let k=dts.length-n;k<dts.length;k++) s+=dts[k]; return 1000/(s/n); };
  const low1Of=(dts)=>{ if(!dts.length) return 0; const s=[...dts].sort((a,b)=>b-a); const n=Math.max(1,Math.floor(s.length*0.01)); let t=0; for(let k=0;k<n;k++) t+=s[k]; return 1000/(t/n); };
  const drawGraph=(cur,low)=>{
    const W=graph.width,H=graph.height,maxF=144;
    const yOf=(f)=>H-8-(Math.min(Math.max(f,0),maxF)/maxF)*(H-30);
    gtx.fillStyle='#070a12'; gtx.fillRect(0,0,W,H);
    gtx.lineWidth=1; gtx.strokeStyle='#232c44'; gtx.fillStyle='#8b96b1'; gtx.font='10px monospace';
    for(const g of [30,60,120]){ gtx.beginPath(); gtx.moveTo(0,yOf(g)); gtx.lineTo(W,yOf(g)); gtx.stroke(); gtx.fillText(String(g),4,yOf(g)-3); }
    const d=stats.dts;
    if(d.length>1){
      const step=Math.max(1,Math.ceil(d.length/W));
      gtx.strokeStyle='#5aa9ff'; gtx.lineWidth=1.2; gtx.beginPath();
      let x=0; const start=d.length-Math.min(d.length,W*step);
      for(let k=start;k<d.length&&x<=W;k+=step,x++){ const f=1000/Math.max(d[k],0.01), y=yOf(f); if(x===0) gtx.moveTo(x,y); else gtx.lineTo(x,y); }
      gtx.stroke(); gtx.lineWidth=1;
    }
    if(low>0){ gtx.strokeStyle='#ff5a6a'; gtx.setLineDash([5,4]); gtx.beginPath(); gtx.moveTo(0,yOf(low)); gtx.lineTo(W,yOf(low)); gtx.stroke(); gtx.setLineDash([]); gtx.fillStyle='#ff5a6a'; gtx.fillText('1% low '+low.toFixed(0),6,12); }
    if(cur>0){ gtx.fillStyle='#5aa9ff'; gtx.fillText(cur.toFixed(0)+' fps',W-58,12); }
  };
  drawGraph(0,0);
  const onFrame=()=>{
    const now=performance.now();
    const dt=now-stats.last; stats.last=now; stats.frames++;
    if(dt>0&&dt<250){ stats.dts.push(dt); if(stats.dts.length>7200) stats.dts.splice(0,1024); }
    if(now-stats.tick>=500){
      stats.tick=now;
      const cur=currentFpsOf(stats.dts), low=low1Of(stats.dts);
      hudFps.textContent=`${cur?cur.toFixed(0):'—'} fps`;
      hudLow.textContent=`1% low ${low?low.toFixed(0):'—'} fps`;
      hudFrame.textContent=`f${stats.frames}`;
      drawGraph(cur,low);
    }
  };
  try{
    const r=await t.run(canvas, device, { log, onFrame, shouldStop:()=>stopFlag, secs });
    currentCleanup=r?.cleanup||null;
    if(secs>0){ // timed: keep rendering, then finalize
      await new Promise(res=>{ const end=performance.now()+secs*1000; const tick=()=>{ if(stopFlag||performance.now()>=end)res(); else requestAnimationFrame(tick); }; tick(); });
      stopCurrent();
    }
    const avg=(stats.frames/((performance.now()-stats.t0)/1000)).toFixed(1);
    const low=low1Of(stats.dts);
    const pass=r?.pass!==false && !stopFlag;
    setRow(i,{status:stopFlag?'STOPPED':(pass?'PASS ✓':'FAIL ✗'),fps:avg,low:low?low.toFixed(1):'—',frames:String(stats.frames),notes:r?.notes||t.checks});
    log(`Test ${i+1} ${pass?'PASSED':'FAILED'} — ${stats.frames} frames, avg ${avg} fps, 1% low ${low?low.toFixed(1):'n/a'} fps. ${r?.notes||''}`,pass?'ok':'err');
    hudFps.textContent=`${avg} fps`;
    hudLow.textContent=`1% low ${low?low.toFixed(1):'—'} fps`;
    return pass;
  }catch(e){ console.error(e); setRow(i,{status:'FAIL ✗',notes:String(e.message).slice(0,120)}); log(`Test ${i+1} ERROR: ${e.message}`,'err'); return false; }
}

TESTS.forEach((t,i)=>{
  const b=document.createElement('button'); b.className='test-btn secondary';
  b.innerHTML=`<b>${i+1}. ${t.title}</b><small>${t.description}</small>`;
  b.onclick=()=>runOne(i,0);
  listEl.appendChild(b);
  setRow(i,{title:t.title,status:'—',fps:'—',low:'—',frames:'—',notes:t.checks});
});
document.getElementById('run-all').onclick=async()=>{
  const secs=Math.max(2,Math.min(30,Number(document.getElementById('duration').value)||6));
  log(`Running full suite (${TESTS.length} tests), ${secs}s per test…`,'dim');
  for(let i=0;i<TESTS.length;i++){ const ok=await runOne(i,secs); if(stopFlag)break; await new Promise(r=>setTimeout(r,400)); if(!document.getElementById('auto-next').checked)break; }
  log('Suite finished.','ok');
};
document.getElementById('stop').onclick=()=>{ stopFlag=true; stopCurrent(); log('stopped by user.','dim'); };
initGPU();
