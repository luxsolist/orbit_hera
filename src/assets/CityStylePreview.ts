import {seoulStudyTarget,SEOUL_STUDY_URL} from '../world/SeoulStudyLocation';
import {cityDateAtHour,solarState} from '../world/CityTime';
import * as THREE from 'three';
import {buildChunkMesh,disposeChunkGroup} from '../world/chunkMesh';
import {seoulAppearance} from '../world/cities';
import {paintedSeoul,addPaintedSky} from './CityPaintStudy';
import {SkyEnvironment} from '../world/SkyEnvironment';
import {createComposer,disposeComposer} from '../fx/postprocessing';
import {EXPOSURE} from '../world/palette';
import type {WorldChunk} from '../world/chunkManifest';
const referenceDialog=document.getElementById('referenceDialog') as HTMLDialogElement;
document.getElementById('referenceOpen')!.onclick=()=>referenceDialog.showModal();
document.getElementById('referenceClose')!.onclick=()=>referenceDialog.close();
async function start(){
 const response=await fetch(SEOUL_STUDY_URL);if(!response.ok)throw new Error('서울 지도 응답 '+response.status);
 const raw=await response.json() as WorldChunk;
 const views=[seoulAppearance,paintedSeoul].map((profile,index)=>{
  const pane=document.getElementById(index?'painted':'original')!;
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(1.5);renderer.setSize(600,600);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=EXPOSURE;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;pane.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(55,1,.5,5000);
  const chunk=buildChunkMesh(raw,1024,79.5*1024,47.5*1024,profile);scene.add(chunk.group);
  const environment=new SkyEnvironment(scene,{x:0,z:0,yaw:0},2600,{...profile.environment,clock:paintedSeoul.environment.clock});
  if(index){addPaintedSky(scene);}
  const composer=createComposer(renderer,scene,camera);
  if(index)composer.passes[1].enabled=false; // Painted surfaces should not glow like energy effects.
  return {pane,renderer,scene,camera,chunk,composer,environment};
 });
 const target=seoulStudyTarget(views[0].chunk);
 let wide=true,skyView=false;
 function render(){for(const v of views)if(v.pane.clientWidth>0){v.environment.update(target.x,target.z);v.composer.render();}}
 function resize(){for(const v of views){const w=v.pane.clientWidth,h=v.pane.clientHeight;if(!w||!h)continue;v.renderer.setSize(w,h);v.composer.setSize(w,h);v.camera.aspect=w/h;v.camera.updateProjectionMatrix();}render();}
 function setView(){for(const v of views){v.camera.position.copy(target).add(wide?new THREE.Vector3(35,65,50):new THREE.Vector3(18,42,24));v.camera.lookAt(skyView?target.clone().add(new THREE.Vector3(-80,65,-130)):target);}render();}
 function mode(name:string){document.body.className=name==='split'?'':'single '+name;for(const [id,n] of [['split','split'],['originalMode','original'],['paintedMode','painted']])document.getElementById(id)!.classList.toggle('active',n===name);resize();}
 document.getElementById('split')!.onclick=()=>mode('split');document.getElementById('originalMode')!.onclick=()=>mode('original');document.getElementById('paintedMode')!.onclick=()=>mode('painted');
 document.getElementById('streetView')!.onclick=()=>{wide=false;skyView=false;setView();};document.getElementById('wideView')!.onclick=()=>{wide=true;skyView=false;setView();};
 document.getElementById('skyView')!.onclick=()=>{wide=true;skyView=true;setView();};
 let fixedHour:number|undefined;
 const slider=document.getElementById('timeHour') as HTMLInputElement;
 function timeChange(hour?:number){
  fixedHour=hour;const date=hour===undefined?new Date():cityDateAtHour(new Date(),hour,'Asia/Seoul');
  for(const v of views)v.environment.setTime(hour===undefined?undefined:date);
  document.getElementById('timeLabel')!.textContent=(hour===undefined?'실시간 · ':'고정 · ')+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
  if(hour!==undefined)slider.value=String(hour);
  document.getElementById('timeLive')!.classList.toggle('active',hour===undefined);render();
 }
 // Find the morning/evening solar elevation for today's season instead of assuming a fixed sunset hour.
 function twilightHour(morning:boolean){let best=morning?6:18,error=Infinity;for(let h=morning?3:12;h<(morning?12:24);h+=.05){const e=Math.abs(solarState(cityDateAtHour(new Date(),h,'Asia/Seoul'),paintedSeoul.environment.clock!).elevation-3);if(e<error){error=e;best=h;}}return best;}
 document.getElementById('timeLive')!.onclick=()=>timeChange();
 document.getElementById('timeMorning')!.onclick=()=>timeChange(twilightHour(true));
 document.getElementById('timeDay')!.onclick=()=>timeChange(12);
 document.getElementById('timeEvening')!.onclick=()=>timeChange(twilightHour(false));
 document.getElementById('timeNight')!.onclick=()=>timeChange(22);
 slider.oninput=()=>timeChange(Number(slider.value));
 const clockTimer=window.setInterval(()=>{if(fixedHour===undefined)timeChange();},1000);
 timeChange();
 setView();resize();window.addEventListener('resize',resize);
 // Texture loaders complete asynchronously. Redraw briefly; no continuous idle GPU load.
 let frames=0;function warmup(){render();if(++frames<180)requestAnimationFrame(warmup);}requestAnimationFrame(warmup);
 document.getElementById('status')!.textContent='서울 79 / 47 · 동일한 교차로 고정 · 변경: 외벽·지붕·도로 팔레트, 명암, 재질, 녹지, 하늘 · 서울·부산 전체 지도에 적용';
 window.addEventListener('pagehide',()=>{clearInterval(clockTimer);for(const v of views){disposeComposer(v.composer);disposeChunkGroup(v.chunk.group);v.renderer.dispose();}},{once:true});
}
start().catch(error=>{document.getElementById('status')!.textContent='비교 화면을 불러오지 못했습니다: '+String(error);console.error(error);});
