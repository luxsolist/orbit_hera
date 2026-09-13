import {RenderMetrics} from '../core/RenderMetrics';
import * as THREE from 'three';
import {StreamingWorld} from '../world/StreamingWorld';
import {fetchCatalog} from '../world/maps';
import type {LandmarkIndex} from '../world/chunkManifest';
const AIR_ENTRY_HEIGHT=100; // 지면 기준 높이(m)
const AIR_SPEED_MULTIPLIER=2;
export async function mountCityViewer(host:HTMLElement){
 host.innerHTML='<div class="workspace"><div class="stage" tabindex="0" aria-label="도시 1인칭 탐색"></div><aside class="panel"><h2>도시 탐색</h2><label>도시<select id="city"></select></label><label>랜드마크<select id="landmark"><option value="">랜드마크 선택</option></select></label><label>위도<input id="lat" type="number" step="any"></label><label>경도<input id="lon" type="number" step="any"></label><button id="goto">위경도로 이동</button><div class="row"><button id="walk">1인칭 보행</button><button id="fly">공중 탐색</button></div><p>화면을 드래그해 시선을 돌립니다.<br>WASD / 방향키: 이동 · Shift: 빠르게<br>공중 탐색: Q 하강 / E 상승 · 기본 48m/s, 빠르게 320m/s<br>진입 높이: 지면 위 100m<br>보행은 지면 높이와 건물 충돌을 반영합니다.</p><div class="status" id="cityStatus">도시 목록 로딩 중…</div></aside></div>';
 const stage=host.querySelector<HTMLElement>('.stage')!,status=host.querySelector<HTMLElement>('#cityStatus')!;
 const field=(id:string)=>host.querySelector<HTMLInputElement>('#'+id)!;
 const city=host.querySelector<HTMLSelectElement>('#city')!,landmark=host.querySelector<HTMLSelectElement>('#landmark')!;
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;stage.append(renderer.domElement);
 const metrics=new RenderMetrics(host.querySelector<HTMLElement>('.panel')!);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(65,1,.1,5500);let world:StreamingWorld|undefined,dead=false,request=0,flying=true,yaw=0,pitch=-.7,frame=0;
 const events=new AbortController(),held=new Set<string>();
 // Opt-in, repeatable flight input uses the same movement and world update path.
 let flightTest:{until:number;last:number;frames:number[];label:string}|undefined;
 let flightStatus:HTMLElement|undefined;
 function stopFlightTest(){
  if(!flightTest)return;const test=flightTest;flightTest=undefined;held.clear();
  const values=test.frames.slice().sort((a,b)=>a-b),sum=values.reduce((a,b)=>a+b,0);
  if(flightStatus)flightStatus.textContent=`${test.label}: ${sum?(1000*values.length/sum).toFixed(1):'—'} FPS · p95 ${(values[Math.ceil(values.length*.95)-1]??0).toFixed(1)}ms · 최대 ${(values[values.length-1]??0).toFixed(1)}ms · 100ms 초과 ${values.filter(v=>v>100).length}회`;
 }
 if(new URLSearchParams(location.search).has('stream-review')){
  const panel=host.querySelector<HTMLElement>('.panel')!,controls=document.createElement('div');
  flightStatus=document.createElement('p');flightStatus.textContent='동쪽으로 20초 이동합니다. 수동 조작 시 측정을 중단합니다.';
  for(const [label,fast] of [['일반 이동 측정',false],['고속 이동 측정',true]] as const){const button=document.createElement('button');button.textContent=label;button.onclick=()=>{stopFlightTest();stage.focus();held.clear();yaw=0;held.add('KeyD');if(fast)held.add('ShiftLeft');flightTest={until:performance.now()+20000,last:performance.now(),frames:[],label};flightStatus!.textContent=label+' 중…';};controls.append(button);}
  const stop=document.createElement('button');stop.textContent='측정 중지';stop.onclick=stopFlightTest;controls.append(stop);panel.append(controls,flightStatus);
 }

 const catalog=(await fetchCatalog()).filter(c=>c.stream&&Number.isFinite(c.lat)&&Number.isFinite(c.lon));
 let index:LandmarkIndex={};try{const r=await fetch('/maps/landmarks.json');if(r.ok)index=await r.json();}catch{}
 try{const r=await fetch('/api/editor/landmarks');if(r.ok)Object.assign(index,await r.json());}catch{}
 for(const c of catalog)city.add(new Option(c.name,c.id));
 const selected=()=>catalog.find(c=>c.id===city.value)!;
 function landmarks(){const c=selected();landmark.replaceChildren(new Option('랜드마크 선택',''));for(const [name,l] of Object.entries(index)){const nearest=catalog.reduce((a,b)=>Math.hypot((b.lat!-l.lat), (b.lon!-l.lon)*Math.cos(l.lat*Math.PI/180))<Math.hypot((a.lat!-l.lat),(a.lon!-l.lon)*Math.cos(l.lat*Math.PI/180))?b:a);if(l.mapId===c.id||l.mapId===c.id.replace('-stream','')||(nearest.id===c.id&&Math.hypot(c.lat!-l.lat,c.lon!-l.lon)<.4))landmark.add(new Option(l.name??name,name));}}
 async function go(lat:number,lon:number){if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180){status.textContent='올바른 위도(-85~85), 경도(-180~180)를 입력하세요.';return;}
 const n=++request;stopFlightTest();metrics.reset();held.clear();status.textContent='지도 로딩 중…';world?.dispose();world=undefined;scene.clear();scene.background=new THREE.Color('#bcd9eb');scene.fog=null;
 try{const next=await StreamingWorld.create(scene,lat,lon,0,selected().id,true);if(dead||n!==request){next.dispose();next.group.removeFromParent();return;}world=next;camera.position.set(0,world.heightAt(0,0)+(flying?AIR_ENTRY_HEIGHT:1.7),0);yaw=0;pitch=flying?-.7:0;field('lat').value=String(lat);field('lon').value=String(lon);status.textContent=selected().name+' · 지도 로드 완료';}catch(e){if(n===request)status.textContent='지도를 불러오지 못했습니다: '+String(e);}}
 city.onchange=()=>{landmarks();go(selected().lat!,selected().lon!);};landmark.onchange=()=>{const l=index[landmark.value];if(l)go(l.lat,l.lon);};host.querySelector<HTMLButtonElement>('#goto')!.onclick=()=>go(+field('lat').value,+field('lon').value);
 host.querySelector<HTMLButtonElement>('#walk')!.onclick=()=>{flying=false;if(world)camera.position.y=world.heightAt(camera.position.x,camera.position.z)+1.7;pitch=0;stage.focus();};host.querySelector<HTMLButtonElement>('#fly')!.onclick=()=>{if(!flying&&world)camera.position.y=world.heightAt(camera.position.x,camera.position.z)+AIR_ENTRY_HEIGHT;flying=true;pitch=-.6;stage.focus();};
 stage.addEventListener('keydown',e=>{stopFlightTest();if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();held.add(e.code);}},{signal:events.signal});window.addEventListener('keyup',e=>held.delete(e.code),{signal:events.signal});stage.addEventListener('blur',()=>{stopFlightTest();held.clear();},{signal:events.signal});
 let drag=false;stage.addEventListener('pointerdown',e=>{stopFlightTest();drag=true;stage.focus();stage.setPointerCapture(e.pointerId);},{signal:events.signal});stage.addEventListener('pointerup',()=>drag=false,{signal:events.signal});stage.addEventListener('pointercancel',()=>drag=false,{signal:events.signal});stage.addEventListener('pointermove',e=>{if(drag){yaw-=e.movementX*.003;pitch=THREE.MathUtils.clamp(pitch-e.movementY*.003,-1.5,1.5);}},{signal:events.signal});
 const resize=new ResizeObserver(()=>{const w=stage.clientWidth,h=stage.clientHeight;if(w&&h){renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}});resize.observe(stage);
 const clock=new THREE.Clock();let reading=0;
 function render(){if(dead)return;const frameNow=performance.now();if(flightTest){flightTest.frames.push(frameNow-flightTest.last);flightTest.last=frameNow;if(frameNow>=flightTest.until)stopFlightTest();}metrics.begin(renderer);const dt=Math.min(.05,clock.getDelta());try{if(world){const f=Number(held.has('KeyW')||held.has('ArrowUp'))-Number(held.has('KeyS')||held.has('ArrowDown')),r=Number(held.has('KeyD')||held.has('ArrowRight'))-Number(held.has('KeyA')||held.has('ArrowLeft'));const speed=(held.has('ShiftLeft')?160:24)*(flying?AIR_SPEED_MULTIPLIER:1)*dt/Math.max(1,Math.hypot(f,r));let x=camera.position.x+(-Math.sin(yaw)*f+Math.cos(yaw)*r)*speed,z=camera.position.z+(-Math.cos(yaw)*f-Math.sin(yaw)*r)*speed;if(!flying){const hit=world.resolveCollision(x,z,.35,camera.position.y-1.7);x=hit.x;z=hit.z;}camera.position.x=x;camera.position.z=z;if(flying)camera.position.y+=(Number(held.has('KeyE'))-Number(held.has('KeyQ')))*speed;else camera.position.y=world.heightAt(x,z)+1.7;world.update(x,z,camera.position.y);if((reading+=dt)>.5){reading=0;const geo=world.geoPosition(x,z);status.textContent=`${selected().name}\n${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)} · 높이 ${camera.position.y.toFixed(1)}m`;}}
 camera.rotation.set(pitch,yaw,0,'YXZ');renderer.render(scene,camera);}catch(error){held.clear();world?.dispose();world=undefined;renderer.renderLists.dispose();status.textContent='도시 표시 중 오류가 발생했습니다. 랜드마크를 다시 선택하거나 위경도로 이동을 눌러 재시도하세요: '+String(error);}metrics.end(renderer,world?.performanceMetrics);frame=requestAnimationFrame(render);}render();landmarks();await go(selected().lat!,selected().lon!);
 return ()=>{dead=true;request++;cancelAnimationFrame(frame);events.abort();resize.disconnect();world?.dispose();metrics.dispose();renderer.dispose();};
}
