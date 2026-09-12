import * as THREE from 'three';
import { PlayerController } from '../player/PlayerController';
import { DronePresentation } from '../player/DronePresentation';
import { EnemyVisibility } from '../enemies/EnemyVisibility';
import { SHELL_GEOS, CORE_GEO } from '../enemies/CoreEnemy';
import type { GameWorld } from '../world/GameWorld';
import type { Input } from '../core/Input';
const scene = new THREE.Scene();scene.background = new THREE.Color('#526776');
scene.add(new THREE.HemisphereLight(0xffffff,0x555555,3));
const renderer = new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(1);document.body.append(renderer.domElement);
scene.add(new THREE.GridHelper(200,40));
const world = {spawn:{x:0,z:0,yaw:0},bounds:1000,heightAt:()=>0,topAt:()=>0,resolveCollision:(x:number,z:number)=>({x,z}),segmentHitsBuilding:()=>Infinity} as unknown as GameWorld;
const input = {isDown:()=>false,wasPressed:()=>false,consumeMouse:()=>({dx:0,dy:0}),moveScale:1} as unknown as Input;
const visibility = new EnemyVisibility();
let player:PlayerController, view:DronePresentation, enabled=true, inside=false, id='walker';
const group = new THREE.Group();scene.add(group);
const mats=[new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),new THREE.MeshBasicMaterial()];mats.forEach(m=>visibility.apply(m));
const shells=new THREE.InstancedMesh(SHELL_GEOS.rusher,mats[0],3),cores=new THREE.InstancedMesh(CORE_GEO,mats[1],3);group.add(shells,cores);shells.frustumCulled=cores.frustumCulled=false;
function place(){
 const mid=view.camera.position.clone().lerp(player.worldPosition,.55);
 for(let i=0;i<3;i++){
  const radius=inside?12:3;
  const p=inside?player.worldPosition.clone():mid.clone().add(new THREE.Vector3((i-1)*2.5,0,0));
  const matrix=new THREE.Matrix4().makeScale(radius,radius,radius).setPosition(p);
  shells.setMatrixAt(i,matrix);cores.setMatrixAt(i,new THREE.Matrix4().makeScale(radius*.3,radius*.3,radius*.3).setPosition(p));
  const color=new THREE.Color([0xe63824,0xff9230,0x3a93ee][i]);shells.setColorAt(i,color);cores.setColorAt(i,color);
 }
 shells.count=cores.count=inside?1:3;shells.instanceMatrix.needsUpdate=cores.instanceMatrix.needsUpdate=true;
 if(shells.instanceColor)shells.instanceColor.needsUpdate=true;if(cores.instanceColor)cores.instanceColor.needsUpdate=true;
 document.querySelector('#status')!.textContent=`${id} · ${inside?'대형 적 내부':'근접 밀집'} · 시야 보조 ${enabled?'ON':'OFF'}`;
}
async function select(next:string){id=next;view?.dispose();player=new PlayerController(input,world,innerWidth/innerHeight,await (await fetch(`/drones/${id}.json`)).json());view=new DronePresentation(scene,player,renderer);place();}
for(const name of ['walker','flyer'])document.getElementById(name)!.onclick=()=>{void select(name);};
document.getElementById('effect')!.onclick=()=>{enabled=!enabled;visibility.setEnabled(enabled);document.getElementById('effect')!.textContent=enabled?'시야 보조 끄기':'시야 보조 켜기';place();};
document.getElementById('near')!.onclick=()=>{inside=false;place();};document.getElementById('inside')!.onclick=()=>{inside=true;place();};
await select(id);
renderer.setAnimationLoop(()=>{renderer.setSize(innerWidth,innerHeight);view.camera.aspect=innerWidth/innerHeight;view.camera.updateProjectionMatrix();visibility.update(view.camera,player.worldPosition);renderer.render(scene,view.camera);});

