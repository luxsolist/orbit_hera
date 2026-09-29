import * as THREE from 'three';
import {readMapBundle} from '../world/MapBundles';
import {applyMapCorrections} from '../world/MapCorrections';
import {buildChunkMesh} from '../world/chunkMesh';
import {paintedRome} from '../world/cities/rome';
import {paintedAthens} from '../world/cities/athens';
import {SkyEnvironment} from '../world/SkyEnvironment';
import {addPaintedSky} from '../world/PaintedCityStyle';
import {cityDateAtHour} from '../world/CityTime';
const status=document.getElementById('status')!;
async function start(){
 const city=new URLSearchParams(location.search).get('city')==='athens'?'athens':'rome',base='/build/streets/'+city+'-historic-pilot';
 const get=async(p:string)=>{const r=await fetch(p);if(!r.ok)throw Error(p+' '+r.status);return r.json();};
 const [input,plans,audit]=await Promise.all([get(base+'-resolved-input.json'),get(base+'-plans.json'),get(base+'-audit.json')]);
 const profile=city==='rome'?paintedRome:paintedAthens,[x0,z0,x1,z1]=input.bounds,ox=(x0+x1)/2,oz=(z0+z1)/2;
 const views=['before','after'].map(id=>{const pane=document.getElementById(id)!,scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;pane.append(renderer.domElement);const camera=new THREE.PerspectiveCamera(60,1,.5,5000),environment=new SkyEnvironment(scene,{x:0,z:0,yaw:0},4000,profile.environment);environment.setTime(cityDateAtHour(new Date(),12,profile.environment.clock!.timeZone));addPaintedSky(scene,undefined,profile.environment.night);return {pane,scene,renderer,camera,environment};});
 let ground=0;
 for(const [key,plan] of Object.entries(plans) as [string,any][]){const [cx,cz]=key.split('_').map(Number),source=input.chunks.find((c:any)=>c.cx===cx&&c.cz===cz);if(!source)continue;const packed=await readMapBundle(input.cell,cx,cz);if(!packed)throw Error('기존 청크 없음 '+key);const before=applyMapCorrections(input.cell,packed.raw,packed),after={...source,compiledStreet:plan,terrain:{...source.terrain,heights:plan.terrainHeights??source.terrain.heights},roadHeights:plan.roadHeights??source.roadHeights,objects:{...source.objects,buildings:plan.resolvedBuildings??source.objects.buildings,structures:plan.resolvedStructures??source.objects.structures,water:plan.resolvedWater??source.objects.water,walls:plan.walls??source.objects.walls}};ground=Math.max(ground,source.terrain.heights[Math.floor(source.terrain.heights.length/2)]);for(const [i,c] of [before,after].entries()){const near=(b:any)=>{const n=b.p.length/2;let x=0,z=0;for(let j=0;j<b.p.length;j+=2){x+=b.p[j];z+=b.p[j+1];}return Math.hypot(x/n-ox,z/n-oz)<250;};const limited={...c,objects:{...c.objects,buildings:c.objects.buildings.filter(near),structures:c.objects.structures?.filter(near),roads:c.objects.roads.filter(near),walls:c.objects.walls?.filter(near)}};views[i].scene.add(buildChunkMesh(limited,1024,ox,oz,{...profile,buildings:{...profile.buildings,windowContrast:0}}).group);}status.textContent='지도 준비 '+key;await new Promise(r=>setTimeout(r,0));}
 let angle=.7,close=false;
 const render=()=>{for(const v of views){const w=v.pane.clientWidth,h=v.pane.clientHeight;v.renderer.setSize(w,h,false);v.camera.aspect=w/h;v.camera.updateProjectionMatrix();const d=close?100:320;v.camera.position.set(Math.sin(angle)*d,ground+(close?35:240),Math.cos(angle)*d);v.camera.lookAt(0,ground,0);v.environment.update(v.camera.position.x,v.camera.position.z);v.renderer.render(v.scene,v.camera);}};
 document.getElementById('wide')!.onclick=()=>{close=false;render();};document.getElementById('close')!.onclick=()=>{close=true;render();};document.getElementById('rotate')!.onclick=()=>{angle+=Math.PI/4;render();};window.addEventListener('resize',render);render();
 status.textContent=city+' · 차도 누락 '+audit.missingRouteSamples+' / 보행 연결 검토 '+audit.walkingMissing+' / 경로 충돌 '+audit.guideFailures.length+' · 기존 배포 지도는 유지됩니다.';
 window.addEventListener('pagehide',()=>views.forEach(v=>v.renderer.dispose()),{once:true});
}
start().catch(e=>{status.textContent='검토 자료 로딩 실패: '+e;console.error(e);});
