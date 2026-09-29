import * as THREE from 'three';
import {readMapBundle} from '../world/MapBundles';
import {applyMapCorrections} from '../world/MapCorrections';
import {buildChunkMesh,disposeChunkGroup,type ChunkBuild} from '../world/chunkMesh';
import {paintedSeoul} from '../world/cities/painted';
import {SkyEnvironment} from '../world/SkyEnvironment';
import {addPaintedSky} from '../world/PaintedCityStyle';
import {cityDateAtHour} from '../world/CityTime';
import {CHEONGGYE_PILOT as recipe,pilotStreetHeight,pilotChannelZ,pilotWaterHeight} from '../world/cities/CheonggyePilot';
const status=document.querySelector<HTMLElement>('#status')!;
async function start(){
 const [ox,oz]=recipe.center;
 const views=['before','after'].map(id=>{const pane=document.getElementById(id)!,scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;pane.append(renderer.domElement);const camera=new THREE.PerspectiveCamera(62,1,.2,3500);const environment=new SkyEnvironment(scene,{x:0,z:0,yaw:0},2600,paintedSeoul.environment);environment.setTime(cityDateAtHour(new Date(),12,'Asia/Seoul'));addPaintedSky(scene,undefined,paintedSeoul.environment.night);return {pane,scene,renderer,camera,environment,chunks:[] as ChunkBuild[]};});
 for(const [cx,cz] of [[84,46],[85,46],[84,47],[85,47]]){
  status.textContent=`지도 ${cx}/${cz} 준비 중…`;await new Promise(r=>setTimeout(r,0));const packed=await readMapBundle([37,126],cx,cz);if(!packed)throw new Error('압축 지도 없음');
  for(let i=0;i<2;i++){const input=i?packed:(packed.raw.mapBuild?.input??packed);const raw=applyMapCorrections([37,126],input.raw,input,{streetPilot:!!i});const profile=paintedSeoul;const chunk=buildChunkMesh(raw,1024,ox,oz,profile);views[i].scene.add(chunk.group);views[i].chunks.push(chunk);}
 }
 function render(){for(const v of views){if(v.pane.clientWidth===0)continue;v.environment.update(v.camera.position.x,v.camera.position.z);v.renderer.render(v.scene,v.camera);}}
 function resize(){for(const v of views){const w=v.pane.clientWidth,h=v.pane.clientHeight;if(!w||!h)continue;v.renderer.setSize(w,h);v.camera.aspect=w/h;v.camera.updateProjectionMatrix();}render();}
 const ground=pilotStreetHeight(ox,oz);
 function view(kind:string){for(const v of views){if(kind==='wide'){v.camera.position.set(180,ground+520,490);v.camera.lookAt(0,ground,0);}else if(kind==='river'){v.camera.position.set(-40,ground+28,pilotChannelZ(ox-40)-oz);v.camera.lookAt(170,ground-3,pilotChannelZ(ox+170)-oz);}else if(kind==='roadReport'){const x=(126.986881-126)*88316.0938412203;v.camera.position.set(x-ox-65,ground+52,pilotChannelZ(x-65)-oz+5);v.camera.lookAt(x-ox+30,ground-2,pilotChannelZ(x+30)-oz);}else if(kind==='reported'||kind==='path'||kind==='underpass'){const x=kind==='underpass'?87218:(126.990929-126)*88316.0938412203;const z=pilotChannelZ(x);const y=kind==='reported'?pilotStreetHeight(x,z)+15:pilotWaterHeight(x)+2.2;v.camera.position.set(x-ox,y,z-oz+(kind==='reported'?22:6));v.camera.lookAt(x-ox+80,y-.7,pilotChannelZ(x+80)-oz+6);}else{const x=ox-220;const roadZ=(at:number)=>{const candidates=recipe.roadNetwork.filter(r=>Math.min(r.p[0],r.p[2])<at&&Math.max(r.p[0],r.p[2])>at&&Math.abs(r.p[2]-r.p[0])>Math.abs(r.p[3]-r.p[1])*1.5).map(r=>r.p[1]+(r.p[3]-r.p[1])*(at-r.p[0])/(r.p[2]-r.p[0])).filter(z=>z>pilotChannelZ(at));return Math.min(...candidates);};const z=roadZ(x),targetZ=roadZ(x+70);v.camera.position.set(x-ox,pilotStreetHeight(x,z)+1.9,z-oz+1.5);v.camera.lookAt(x-ox+70,pilotStreetHeight(x+70,targetZ)+1,targetZ-oz+1.5);}}render();}
 for(const id of ['wide','river','street','roadReport','reported','path','underpass'])document.getElementById(id)!.onclick=()=>view(id);
 document.getElementById('split')!.onclick=()=>{document.getElementById('views')!.classList.remove('single');views[0].pane.classList.remove('hidden');resize();};
 document.getElementById('afterOnly')!.onclick=()=>{document.getElementById('views')!.classList.add('single');views[0].pane.classList.add('hidden');resize();};
 window.addEventListener('resize',resize);view(new URLSearchParams(location.search).get('view')==='roads'?'roadReport':'river');resize();status.textContent='청계천 1×1km 시범 구역 · 원본 압축 지도 재사용 · 비교 화면은 고정 구도이며 이동은 도시 탐색에서 가능합니다.';
 let frames=0;const warm=()=>{render();if(++frames<90)requestAnimationFrame(warm);};warm();
 window.addEventListener('pagehide',()=>{for(const v of views){for(const c of v.chunks)disposeChunkGroup(c.group);v.renderer.dispose();}},{once:true});
}
start().catch(e=>{status.textContent='비교 로딩 실패: '+String(e);console.error(e);});
