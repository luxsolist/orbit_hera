import {canNavigate} from './navigation';
import './studio.css';
import {mountMissionEditor} from './missions';
import {mountCityViewer} from './city';
import {mountIntroViewer} from './intro';
const app=document.getElementById('app')!;
app.innerHTML='<header><h1>CORE / 에셋 스튜디오</h1><span>뷰어 · 도시 탐색 · 미션 편집</span></header><div id="shell"><nav id="categories" aria-label="에셋 분류"></nav><main id="main"></main></div>';
const main=document.getElementById('main')!;let dispose:()=>void=()=>{};let serial=0;
const entries=[['drone','드론'],['plasmoid','플라즈모이드'],['intro','인트로'],['city','도시'],['mission','미션']];
let navigating=false;
async function open(id:string){if(navigating)return;navigating=true;let allowed=false;try{allowed=await canNavigate(main);}finally{navigating=false;}if(!allowed)return;const run=++serial;dispose();dispose=()=>{};main.replaceChildren();document.querySelectorAll('#categories button').forEach(b=>b.classList.toggle('active',(b as HTMLElement).dataset.id===id));history.replaceState(null,'','#'+id);
 if(id==='drone'||id==='plasmoid'){
 const frame=document.createElement('iframe');frame.title=id==='drone'?'드론 뷰어':'플라즈모이드 뷰어';frame.src=id==='drone'?'/tools/mech-preview.html':'/tools/plasmoid-preview.html';main.append(frame);
 frame.onload=()=>{const doc=frame.contentDocument;if(!doc)return;const style=doc.createElement('style');style.textContent='body{background:#0a1521;color:#dce9f3;font-family:system-ui}aside{background:#101f2e;border-color:#2b3e50}button,select,input{border-radius:6px}main{grid-template-columns:minmax(0,1fr) 320px}.stamp{top:18px;left:22px}';if(id==='plasmoid')style.textContent+='body{display:grid;grid-template-columns:minmax(0,1fr) 320px;grid-template-rows:1fr auto;height:100vh}body>header{grid-column:2;grid-row:1;overflow:auto;background:#101f2e;padding:22px}body>header nav{flex-direction:column;gap:18px}body>header label{display:grid;gap:7px}body>header select{width:100%}body>header h1{font-size:20px}main{grid-column:1;grid-row:1 / 3;grid-template-columns:repeat(2,minmax(0,1fr));overflow:auto;align-content:start}footer{grid-column:2;grid-row:2;font-size:12px;padding:18px;background:#101f2e}.view{height:245px}@media(max-width:700px){body{display:block;height:auto}main{grid-template-columns:1fr}body>header nav{flex-direction:row}}';doc.head.append(style);};dispose=()=>frame.remove();return;
 }
 try{const cleanup=await (id==='city'?mountCityViewer(main):id==='intro'?mountIntroViewer(main):mountMissionEditor(main));if(run!==serial)cleanup();else dispose=cleanup;}catch(e){if(run===serial)main.textContent=String(e);}
}
for(const [id,label] of entries){const b=document.createElement('button');b.textContent=label;b.dataset.id=id;b.onclick=()=>open(id);document.getElementById('categories')!.append(b);}
open(entries.some(e=>e[0]===location.hash.slice(1))?location.hash.slice(1):'drone');
