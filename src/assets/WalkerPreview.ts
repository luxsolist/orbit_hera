import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { exportWalkerGLB } from "./exportWalker";
import { loadWalkerSkins, type WalkerSkin } from "./WalkerSkin";
import { WalkerMech } from "./WalkerMech";
import { WalkerThrusters } from "./WalkerThrusters";
import { WalkerMotionAnimator } from "./WalkerMotion";
import { PlayerController, directionalSpeed } from "../player/PlayerController";
import type { DroneSpec } from "../player/DroneSpec";
import type { Input } from "../core/Input";
import type { GameWorld } from "../world/GameWorld";

const stage=document.querySelector<HTMLElement>("#stage")!;
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.12;stage.prepend(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x081019);
scene.fog=new THREE.FogExp2(0x081019,.045);
const camera=new THREE.PerspectiveCamera(22,1,.05,100);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1.45,.18);
controls.enableDamping=true;controls.minDistance=3;controls.maxDistance=15;controls.maxPolarAngle=Math.PI*.53;
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
const environment=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();scene.environment=environment.texture;scene.environmentIntensity=.7;
scene.add(new THREE.HemisphereLight(0xb6d8ee,0x27313a,1.4));
const key=new THREE.DirectionalLight(0xffe3bf,3.5);key.position.set(4,7,5);key.castShadow=true;
key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.5,far:20});key.shadow.normalBias=.015;scene.add(key);
const rim=new THREE.DirectionalLight(0x7aafdb,3);rim.position.set(-3,4,-4);scene.add(rim);
const ground=new THREE.Mesh(new THREE.CylinderGeometry(2.6,2.7,.10,96),new THREE.MeshStandardMaterial({color:0x1e2b36,metalness:.5,roughness:.48}));ground.position.y=-.09;ground.receiveShadow=true;scene.add(ground);
const ring=new THREE.Mesh(new THREE.TorusGeometry(2.58,.008,6,96),new THREE.MeshBasicMaterial({color:0x46616c}));ring.rotation.x=Math.PI/2;ring.position.y=-.035;scene.add(ring);
const mech=new WalkerMech();scene.add(mech);
const thrusters=new WalkerThrusters(mech);
const stats={triangles:0,meshes:0,joints:0};
function refreshStats(){stats.triangles=stats.meshes=stats.joints=0;mech.traverse(o=>{if(o instanceof THREE.Mesh){stats.meshes++;stats.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}if(o instanceof THREE.Group)stats.joints++;});
document.getElementById("stats")!.textContent="RIGID ARTICULATED / PBR\n"+stats.triangles.toLocaleString()+" triangles\n"+stats.meshes+" mesh batches\n"+stats.joints+" articulated groups\n6 attachment sockets";
}
refreshStats();
let selectedSkin:WalkerSkin|undefined;
try{
  const catalog=await loadWalkerSkins();
  const skinPanel=document.getElementById("skins")!,description=document.getElementById("skinDescription")!;
  const buttons=new Map<string,HTMLButtonElement>();
  const choose=(skin:WalkerSkin)=>{
    mech.applySkin(skin);selectedSkin=skin;refreshStats();description.textContent=skin.description;
    for(const [id,button] of buttons)button.setAttribute("aria-pressed",String(id===skin.id));
  };
  const baseButton=document.createElement("button");baseButton.className="skin-choice";baseButton.dataset.skin="base";baseButton.textContent="기본형 · 골격 / 외피";
  const chooseBase=()=>{mech.clearSkin();selectedSkin=undefined;description.textContent="장식·가니쉬·무늬 없는 기본 골격과 외피";for(const [id,button] of buttons)button.setAttribute("aria-pressed",String(id==="base"));refreshStats();};
  baseButton.onclick=chooseBase;buttons.set("base",baseButton);skinPanel.append(baseButton);
  for(const skin of catalog.skins){
    const button=document.createElement("button");button.className="skin-choice";button.dataset.skin=skin.id;
    for(const slot of ["armor","trim","sensor"] as const){const swatch=document.createElement("span");swatch.className="swatch";swatch.style.backgroundColor=skin.materials[slot].color;swatch.setAttribute("aria-hidden","true");button.append(swatch);}
    button.append(document.createTextNode(" "+skin.name));button.onclick=()=>choose(skin);buttons.set(skin.id,button);skinPanel.append(button);
  }
  if(catalog.defaultSkin==="base")chooseBase();else choose(catalog.skins.find(s=>s.id===catalog.defaultSkin)!);
}catch(error){document.getElementById("skinDescription")!.textContent="스킨을 불러오지 못했습니다. 새로고침해 주세요.";console.error(error);}
let mode:"idle"|"walk"|"aim"="idle",phase=0,frozen=false;
// Flat inspection arena: movement is performed by the game controller itself.
const response=await fetch("/drones/walker.json");
if(!response.ok)throw new Error("보행 드론 설정을 불러오지 못했습니다.");
const spec:DroneSpec=await response.json();
if(spec.move.mode!=="walk")throw new Error("보행 드론 설정이 필요합니다.");
const held=new Set<string>(),pressed=new Set<string>();
let autoKey="",motionMode=false,followHeight=0;
const input={moveScale:1,consumeMouse:()=>({dx:0,dy:0}),isDown:(key:string)=>held.has(key)||autoKey===key,wasPressed:(key:string)=>pressed.has(key)} as Input;
const arena={spawn:{x:0,z:0,yaw:Math.PI},bounds:1e9,heightAt:()=>0,topAt:()=>0,resolveCollision:(x:number,z:number)=>({x,z})} as unknown as GameWorld;
let player=new PlayerController(input,arena,1,spec),animator=new WalkerMotionAnimator();
const tile=document.createElement("canvas");tile.width=tile.height=128;
const ink=tile.getContext("2d")!;ink.fillStyle="#101e29";ink.fillRect(0,0,128,128);ink.strokeStyle="#658693";ink.lineWidth=2;ink.strokeRect(0,0,128,128);
const floorMap=new THREE.CanvasTexture(tile);floorMap.colorSpace=THREE.SRGBColorSpace;floorMap.wrapS=floorMap.wrapT=THREE.RepeatWrapping;floorMap.repeat.set(100,100);floorMap.anisotropy=renderer.capabilities.getMaxAnisotropy();
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({map:floorMap,roughness:.9}));floor.rotation.x=-Math.PI/2;floor.position.y=-.04;floor.receiveShadow=true;floor.visible=false;scene.add(floor);
const readout=document.getElementById("motionStats")!;
document.getElementById("parameters")!.textContent=`전진 ${spec.move.speed.toFixed(2)} · 후진 ${(directionalSpeed(0,1,{x:0,z:-1},spec.move.speed,spec.move.backSpeed,spec.move.strafeSpeed)).toFixed(2)} · 좌우 ${(directionalSpeed(1,0,{x:0,z:-1},spec.move.speed,spec.move.backSpeed,spec.move.strafeSpeed)).toFixed(2)} m/s\n점프 ${spec.move.jump.velocity} m/s · 대시 최고 전 ${spec.dash!.speed} / 후 ${spec.dash!.backSpeed} / 옆 ${spec.dash!.strafeSpeed} m/s · 추진 ${spec.dash!.duration}초\n대시 재사용 ${spec.dash!.cooldown}초 · 격자 2m`;
function startMotion(){
  frozen=false;mode="walk";
  for(const id of ["idle","walk","aim"])document.getElementById(id)!.setAttribute("aria-pressed",String(id==="walk"));
  if(motionMode)return;
  motionMode=true;ground.visible=ring.visible=false;floor.visible=true;
  camera.fov=38;camera.updateProjectionMatrix();camera.position.set(8,5,10);controls.target.set(0,2,0);controls.update();
}
function stopMotion(){
  motionMode=false;held.clear();pressed.clear();autoKey="";
  for(const id of ["idle","walk","aim"])document.getElementById(id)!.setAttribute("aria-pressed",String(id==="idle"));
  player=new PlayerController(input,arena,1,spec);animator=new WalkerMotionAnimator();
  mech.position.y=0;followHeight=0;thrusters.update(1,{dashPowered:false,dashDirectionX:0,dashDirectionZ:0});floor.visible=false;ground.visible=ring.visible=true;
  controls.target.set(0,1.45,.18);camera.fov=22;camera.updateProjectionMatrix();view("threeQuarter");
}
for(const [id,key] of [["forward","KeyW"],["backward","KeyS"],["left","KeyA"],["right","KeyD"]]){
  document.getElementById(id)!.onclick=()=>{startMotion();autoKey=key;};
}
for(const [id,key] of [["jump","Space"],["dash","ShiftLeft"]])document.getElementById(id)!.onclick=()=>{startMotion();pressed.add(key);};
document.getElementById("stop")!.onclick=()=>{held.clear();autoKey="";};
document.getElementById("resetMotion")!.onclick=()=>{stopMotion();mode="idle";};
const motionKeys=new Set(["KeyW","KeyS","KeyA","KeyD","Space","ShiftLeft","ShiftRight"]);
window.addEventListener("keydown",event=>{
  if(!motionKeys.has(event.code)||(event.target instanceof HTMLInputElement))return;
  event.preventDefault();startMotion();autoKey="";
  if(!held.has(event.code))pressed.add(event.code);held.add(event.code);
});
window.addEventListener("keyup",event=>held.delete(event.code));
window.addEventListener("blur",()=>{held.clear();pressed.clear();autoKey="";});
const yaw=document.querySelector<HTMLInputElement>("#yaw")!,crouch=document.querySelector<HTMLInputElement>("#crouch")!;
function view(name:string){camera.position.set(...(name==="front"?[0,1.95,10.4]:name==="rear"?[0,1.95,-10.4]:name==="side"?[10.4,1.8,.18]:[8.6,2.25,6.0]) as [number,number,number]);controls.update();}
function resize(){renderer.setSize(stage.clientWidth,stage.clientHeight);camera.aspect=stage.clientWidth/stage.clientHeight;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(stage);resize();view("threeQuarter");
for(const name of ["front","rear","side","threeQuarter"])document.getElementById(name)!.onclick=()=>view(name);
for(const name of ["idle","walk","aim"] as const)document.getElementById(name)!.onclick=()=>{
  stopMotion();mode=name;frozen=false;
  if(name==="walk"){startMotion();autoKey="KeyW";}
  for(const id of ["idle","walk","aim"])document.getElementById(id)!.setAttribute("aria-pressed",String(name===id));
};
const exportBuffer=()=>exportWalkerGLB({skin:selectedSkin});
document.getElementById("export")!.onclick=async()=>{
  const button=document.querySelector<HTMLButtonElement>("#export")!;button.disabled=true;
  try{
    const bytes=await exportBuffer(),url=URL.createObjectURL(new Blob([bytes],{type:"model/gltf-binary"}));
    const link=document.createElement("a");link.href=url;link.download=`android-01-${selectedSkin?.id??"default"}.glb`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){button.textContent="내보내기 실패 · 다시 시도";console.error(error);}finally{button.disabled=false;}
};
declare global { interface Window { mechReview: { stats:typeof stats; motion():unknown; freeze(phase:number):void; exportBuffer():Promise<number[]>; }; } }
window.mechReview={stats,motion:()=>({...player.motionState,skinId:mech.userData.skinId,height:mech.position.y,phase:animator.phase,jets:thrusters.ports.filter(p=>p.flame.visible).length,jumpJets:thrusters.ports.filter(p=>p.normal.y<0&&p.flame.visible).length,x:player.worldPosition.x,z:player.worldPosition.z}),freeze(p){phase=p;animator.phase=p;frozen=true;},async exportBuffer(){return [...new Uint8Array(await exportBuffer())];}};
const clock=new THREE.Clock();
renderer.setAnimationLoop(()=>{
  const dt=Math.min(clock.getDelta(),.05);
  if(motionMode){
    if(!frozen){player.update(dt);pressed.clear();}
    const state=player.motionState,pos=player.worldPosition;
    mech.position.y=pos.y-spec.body.eyeHeight;
    floorMap.offset.set((pos.x%2)/2,-(pos.z%2)/2);
    // Floating origin keeps the subject framed; the metric floor shows real displacement.
    const h=mech.position.y*.65,delta=h-followHeight;followHeight=h;
    camera.position.y+=delta;controls.target.y+=delta;
    const pose=animator.update(frozen?0:dt,state);
    mech.setPose({...pose,aimYaw:Number(yaw.value),aim:mode==="aim"?1:0});
    thrusters.update(frozen?0:dt,state);
    readout.textContent=`${state.dashing?"대시":state.grounded?"지상":"공중"} · ${Math.hypot(state.velocityX,state.velocityZ).toFixed(2)} m/s\n높이 ${mech.position.y.toFixed(2)}m · 수직 ${state.velocityY.toFixed(2)} m/s\n대시 재사용 ${state.dashCooldown.toFixed(2)}초`;
  }else{
    if(!frozen)phase+=dt*Math.PI*2/1.5;
    mech.setPose({phase,aim:mode==="aim"?1:0,aimYaw:Number(yaw.value),crouch:Number(crouch.value)});
    readout.textContent="대기 · 이동 버튼 또는 WASD로 시작";
  }
  controls.update();renderer.render(scene,camera);
});
