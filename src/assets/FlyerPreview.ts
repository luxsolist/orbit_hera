import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";
import {RoomEnvironment} from "three/examples/jsm/environments/RoomEnvironment.js";
import {GLTFExporter} from "three/examples/jsm/exporters/GLTFExporter.js";
import {PlayerController} from "../player/PlayerController";
import type {DroneSpec} from "../player/DroneSpec";
import type {Input} from "../core/Input";
import type {GameWorld} from "../world/GameWorld";
import {loadFlyerSkins,type FlyerSkin} from "./FlyerSkin";
import {FlyerDrone} from "./FlyerDrone";
const stage=document.querySelector<HTMLElement>("#stage")!;
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;stage.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x081019);
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);scene.environment=env.texture;room.dispose();pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xc9e9ff,0x253444,2));const key=new THREE.DirectionalLight(0xffe2ba,3);key.position.set(3,5,4);scene.add(key);
const drone=new FlyerDrone();scene.add(drone);
const grid=new THREE.GridHelper(10,20,0x365664,0x182a36);grid.position.y=-.55;scene.add(grid);
const camera=new THREE.PerspectiveCamera(34,1,.05,100),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=2;controls.maxDistance=12;
function view(name:string){camera.up.set(0,1,0);camera.position.set(...(name==="front"?[0,1,6]:name==="rear"?[0,1,-6]:name==="top"?[0,6,.001]:name==="bottom"?[0,-6,.001]:name==="side"?[6,1,0]:[4,3.3,4]) as [number,number,number]);controls.target.set(0,0,0);controls.update();}
view("three");document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(b=>b.onclick=()=>view(b.dataset.view!));
const throttle=document.querySelector<HTMLInputElement>("#throttle")!,bank=document.querySelector<HTMLInputElement>("#bank")!;
throttle.oninput=()=>drone.setThrottle(+throttle.value);bank.oninput=()=>drone.rotation.z=THREE.MathUtils.degToRad(+bank.value);
function refreshStats(){let triangles=0;drone.traverse(n=>{if(n instanceof THREE.Mesh)triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;});document.querySelector("#stats")!.textContent=`초안 크기 약 2.8 × 2.0m\n${triangles.toLocaleString()} triangles · ${Object.keys(drone.sockets).length} sockets`;}
refreshStats();let selectedSkin:FlyerSkin|undefined;
const skinMenu=document.querySelector("#flyerSkins")!,skinDescription=document.querySelector("#skinDescription")!;
function addSkinChoice(id:string,name:string,skin?:FlyerSkin){
 const button=document.createElement("button");button.dataset.skin=id;button.setAttribute("aria-pressed",String(id==="base"));
 if(skin)for(const slot of ["armor","trim","sensor"] as const){const swatch=document.createElement("span");swatch.className="skin-swatch";swatch.style.background=skin.materials[slot].color;button.append(swatch);}
 button.append(document.createTextNode(name));button.onclick=()=>{if(skin)drone.applySkin(skin);else drone.clearSkin();selectedSkin=skin;refreshStats();skinDescription.textContent=skin?.description??"장식 없는 기본 골격 / 외피";skinMenu.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",String(b===button)));};skinMenu.append(button);
}
addSkinChoice("base","기본형 · 골격 / 외피");
loadFlyerSkins().then(skins=>skins.forEach(s=>addSkinChoice(s.id,s.name,s))).catch(()=>{skinDescription.textContent="스킨을 불러오지 못했습니다. 새로고침해 주세요.";});
const response=await fetch("/drones/flyer.json");if(!response.ok)throw new Error("비행 스펙 로드 실패");
const spec:DroneSpec=await response.json();if(spec.move.mode!=="fly")throw new Error("비행 스펙이 필요합니다.");
const flight=spec.move;
bank.min=String(-flight.rollDeg);bank.max=String(flight.rollDeg);
document.querySelector("#spec")!.textContent=`게임 비행 스펙\n최고 ${(flight.speed*3.6).toFixed(0)}km/h · 수직 ${flight.verticalSpeed}m/s\n고도 ${flight.minAltitude}–${flight.ceiling}m · 선회 기울기 ±${flight.rollDeg}°\nHP ${spec.vitals.maxHp} · 주파수 ${spec.vitals.maxFreq}\n${spec.weapons.primary}`;
const held=new Set<string>(),events=new AbortController();let autoKey="",motion=false,lastYaw=0,lastPitch=0;
const heading=document.querySelector<HTMLInputElement>("#heading")!,pitch=document.querySelector<HTMLInputElement>("#pitch")!;
const input={moveScale:1,isDown:(key:string)=>held.has(key)||autoKey===key,wasPressed:()=>false,consumeMouse:()=>{
 const y=THREE.MathUtils.degToRad(+heading.value),p=THREE.MathUtils.degToRad(+pitch.value);
 const delta={dx:(lastYaw-y)/spec.view.mouseSensitivity,dy:(lastPitch-p)/spec.view.mouseSensitivity};lastYaw=y;lastPitch=p;return delta;
}} as unknown as Input;
const arena={spawn:{x:0,z:0,yaw:Math.PI},bounds:1e9,heightAt:()=>0,topAt:()=>0,resolveCollision:(x:number,z:number)=>({x,z})} as unknown as GameWorld;
let player=new PlayerController(input,arena,1,spec);
const flightGrids=Array.from({length:7},()=>{const g=new THREE.GridHelper(60,30,0x355461,0x152d3a);g.visible=false;scene.add(g);return g;});
const readout=document.querySelector<HTMLElement>("#motionStats")!;
function startMotion(){if(motion)return;motion=true;grid.visible=false;throttle.disabled=bank.disabled=true;camera.fov=44;camera.updateProjectionMatrix();view("three");}
function clearInput(){held.clear();autoKey="";document.querySelectorAll("#movement button").forEach(b=>b.setAttribute("aria-pressed","false"));}
function resetMotion(){clearInput();motion=false;lastYaw=lastPitch=0;heading.value=pitch.value=bank.value=throttle.value="0";player=new PlayerController(input,arena,1,spec);drone.quaternion.identity();drone.setThrottle(0);grid.visible=true;flightGrids.forEach(g=>g.visible=false);throttle.disabled=bank.disabled=false;camera.fov=34;camera.updateProjectionMatrix();view("three");readout.textContent="초기화 · 이동 버튼 또는 키보드로 시작";}
for(const [id,key] of [["forward","KeyW"],["backward","KeyS"],["left","KeyA"],["right","KeyD"],["up","Space"],["down","ShiftLeft"]]){
 document.getElementById(id)!.onclick=()=>{clearInput();startMotion();autoKey=key;document.getElementById(id)!.setAttribute("aria-pressed","true");};
}
document.getElementById("stop")!.onclick=clearInput;document.getElementById("resetMotion")!.onclick=resetMotion;
heading.oninput=pitch.oninput=startMotion;
const keys=new Set(["KeyW","KeyS","KeyA","KeyD","Space","ShiftLeft","ShiftRight","KeyC"]);
window.addEventListener("keydown",e=>{if(!keys.has(e.code)||e.target instanceof HTMLInputElement)return;e.preventDefault();startMotion();autoKey="";held.add(e.code);},{signal:events.signal});
window.addEventListener("keyup",e=>held.delete(e.code),{signal:events.signal});window.addEventListener("blur",clearInput,{signal:events.signal});
async function exportBuffer(){const asset=new FlyerDrone(selectedSkin);asset.traverse(n=>{if(n.userData.runtimeEffect)n.visible=false;});try{return await new GLTFExporter().parseAsync(asset,{binary:true}) as ArrayBuffer;}finally{asset.dispose();}}
document.querySelector<HTMLButtonElement>("#export")!.onclick=async()=>{const data=await exportBuffer(),url=URL.createObjectURL(new Blob([data],{type:"model/gltf-binary"}));const a=document.createElement("a");a.href=url;a.download=`drone-v1-${selectedSkin?.id??"base"}.glb`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const resize=new ResizeObserver(()=>{camera.aspect=stage.clientWidth/stage.clientHeight;camera.updateProjectionMatrix();renderer.setSize(stage.clientWidth,stage.clientHeight);});resize.observe(stage);
const clock=new THREE.Clock(),forwardCorrection=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);
renderer.setAnimationLoop(()=>{
 const dt=Math.min(clock.getDelta(),.05);
 if(motion){
  player.update(dt);const state=player.motionState,pos=player.worldPosition;
  drone.quaternion.copy(player.camera.quaternion).multiply(forwardCorrection);
  const speed=Math.hypot(state.velocityX,state.velocityZ);drone.setThrottle(Math.min(1,speed/flight.speed+Math.abs(state.velocityY)/flight.verticalSpeed*.4));
  flightGrids.forEach((g,i)=>{g.visible=true;g.position.set(-pos.x%2,i===3?-1.1:(Math.floor(pos.y/20)+i-3)*20-pos.y,-pos.z%2);});
  readout.textContent=`${speed<.1&&Math.abs(state.velocityY)<.1?"호버":"비행"} · ${speed.toFixed(2)}m/s (${(speed*3.6).toFixed(1)}km/h)\n고도 ${(pos.y-spec.body.eyeHeight).toFixed(1)}m · 수직 ${state.velocityY.toFixed(2)}m/s\nX ${pos.x.toFixed(1)} / Z ${pos.z.toFixed(1)}m`;
 }
 controls.update();renderer.render(scene,camera);
});
Object.assign(window,{flyerReview:{asset:drone.userData.asset,motion:()=>({...player.motionState,active:motion,skinId:drone.userData.skinId,x:player.worldPosition.x,z:player.worldPosition.z,height:player.worldPosition.y-spec.body.eyeHeight,bank:drone.rotation.z}),exportBuffer:async()=>Array.from(new Uint8Array(await exportBuffer()))}});
window.addEventListener("pagehide",()=>{renderer.setAnimationLoop(null);events.abort();flightGrids.forEach(g=>{g.geometry.dispose();(g.material as THREE.Material).dispose();});resize.disconnect();controls.dispose();drone.dispose();env.dispose();grid.geometry.dispose();(grid.material as THREE.Material).dispose();renderer.dispose();},{once:true});
