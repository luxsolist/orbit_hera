import * as THREE from 'three';
import type {GameWorld} from '../world/GameWorld';
import type {PlayerController} from '../player/PlayerController';
import type {CoreEnemy} from './CoreEnemy';
import type {Vec3} from '../core/math';

export const RIFT_RULES={radius:100,warningRadius:140,count:2,activationSec:4,formationSec:1.2,arrivalWarningSec:3,recoverySec:1,damageFractionPerSecond:.12} as const;
export interface RiftSite extends Vec3 {radius:number;age:number}
/** Fraction of a movement segment inside a sphere; includes stationary and complete-through crossings. */
export function sphereInterval(a:Vec3,b:Vec3,c:Vec3,r:number):[number,number]|null {
 const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,x=a.x-c.x,y=a.y-c.y,z=a.z-c.z;
 const aa=dx*dx+dy*dy+dz*dz,cc=x*x+y*y+z*z-r*r;
 if(aa<1e-12)return cc<=0?[0,1]:null;
 const bb=2*(x*dx+y*dy+z*dz),disc=bb*bb-4*aa*cc;if(disc<=0)return null;
 const root=Math.sqrt(disc),lo=Math.max(0,(-bb-root)/(2*aa)),hi=Math.min(1,(-bb+root)/(2*aa));
 return hi>lo?[lo,hi]:null;
}
/** Union, not sum: overlapping fields never multiply damage. Activation can happen partway through a frame. */
export function riftExposure(a:Vec3,b:Vec3,sites:readonly RiftSite[],dt:number):number {
 if(dt<=0)return 0;
 const intervals: [number,number][]=[];
 for(const s of sites){const span=sphereInterval(a,b,s,s.radius);if(!span)continue;span[0]=Math.max(span[0],1-(s.age-RIFT_RULES.activationSec)/dt);if(span[1]>span[0])intervals.push(span);}
 intervals.sort((a,b)=>a[0]-b[0]);let end=0,total=0;
 for(const [lo,hi] of intervals){total+=Math.max(0,hi-Math.max(lo,end));end=Math.max(end,hi);}
 return total*dt;
}
interface Departure {site:RiftSite;age:number;destination:THREE.Vector3;exit:THREE.Vector3;size:THREE.Vector3;marker:THREE.Mesh;released:boolean}
export class GravityRifts {
 readonly sites:RiftSite[]=[];
 private root=new THREE.Group();
 private departures=new Map<CoreEnemy,Departure>();
 private previous=new Map<PlayerController,{position:THREE.Vector3;revision:number}>();
 private meshes:THREE.Mesh<THREE.SphereGeometry,THREE.ShaderMaterial>[]=[];
 private serial=0;
 private feedbackCooldown=0;
 private geo=new THREE.SphereGeometry(1,24,16);
 private markerMaterial=new THREE.MeshBasicMaterial({color:0x8edfff,wireframe:true,transparent:true,opacity:.6,depthWrite:false});
 private disposed=false;
 onLeap?:(from:Vec3,to:Vec3,color:number,strength:number)=>void;
 onHit?:(damage:number,source:Vec3)=>void;
 onWarning?:()=>void;
 warning='';
 constructor(private scene:THREE.Scene,private world:GameWorld,private players:PlayerController[],private random:()=>number){this.root.name='gravity-rifts';scene.add(this.root);}
 private ensureSites(cx:number,cz:number,zoneRadius:number){
  if(this.sites.length)return;
  this.disposed=false;this.scene.add(this.root);
  const origin=this.players.find(p=>!p.isDead)?.worldPosition??new THREE.Vector3(cx,0,cz);
  const margin=RIFT_RULES.warningRadius+20;
  const bound=Math.max(0,this.world.bounds-margin),available=zoneRadius>0?Math.max(0,zoneRadius-margin):700;
  for(let i=0;i<RIFT_RULES.count;i++){
   let chosen:RiftSite|undefined;
   for(let attempt=0;attempt<48;attempt++){
    const angle=this.random()*Math.PI*2,dist=Math.min(available,350+this.random()*350);
    const x=THREE.MathUtils.clamp(cx+Math.cos(angle)*dist,-bound,bound),z=THREE.MathUtils.clamp(cz+Math.sin(angle)*dist,-bound,bound);
    if(zoneRadius>0&&Math.hypot(x-cx,z-cz)+margin>zoneRadius)continue;
    if(this.sites.some(s=>Math.hypot(x-s.x,z-s.z)<300))continue;
    // Conservatively keep the entire sphere above roofs and terrain across its footprint.
    let top=this.world.heightAt(x,z);
    for(let dx=-100;dx<=100;dx+=25)for(let dz=-100;dz<=100;dz+=25){
     const roof=this.world.topAt(x+dx,z+dz),ground=this.world.heightAt(x+dx,z+dz);
     top=Math.max(top,ground,Number.isFinite(roof)?roof:ground);
    }
    const above=i===0?250+this.random()*150:600+this.random()*300;
    const y=Math.max(this.world.heightAt(x,z)+above,top+120);
    if(new THREE.Vector3(x,y,z).distanceTo(origin)<margin+100)continue;
    chosen={x,y,z,radius:RIFT_RULES.radius,age:0};break;
   }
   // Small arenas can use one safe site instead of overlapping spheres.
   if(!chosen)continue;
   this.sites.push(chosen);this.addVisual(chosen);
  }
  if(!this.sites.length)throw new Error('중력이상지대를 안전하게 배치할 공간이 없습니다. 작전구역을 넓혀주세요.');
 }
 private addVisual(site:RiftSite){
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{time:{value:0},armed:{value:0},near:{value:0}},
   vertexShader:'varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
   fragmentShader:'varying vec3 n;varying vec3 v;uniform float time;uniform float armed;uniform float near;void main(){float rim=pow(1.0-abs(dot(normalize(n),normalize(v))),2.5);float wave=.5+.5*sin(n.y*28.0-time*3.0);vec3 c=mix(vec3(.23,.55,.85),vec3(.65,.35,.95),armed);gl_FragColor=vec4(c,rim*(.15+.22*near)+wave*.025);}' });
  const mesh=new THREE.Mesh(this.geo,mat);mesh.position.set(site.x,site.y,site.z);mesh.scale.setScalar(site.radius);this.root.add(mesh);this.meshes.push(mesh);
 }
 enqueue(enemy:CoreEnemy,cx:number,cz:number,zoneRadius:number){
  this.ensureSites(cx,cz,zoneRadius);
  const site=this.sites[Math.floor(this.serial++/3)%this.sites.length];
  const destination=enemy.group.position.clone();
  // Move malformed/occluded destinations above local solids rather than warp into a building.
  const top=this.world.topAt(destination.x,destination.z);
  destination.y=Math.max(destination.y,this.world.heightAt(destination.x,destination.z)+3,Number.isFinite(top)?top+3:-Infinity);
  const angle=this.random()*Math.PI*2,exit=new THREE.Vector3(Math.cos(angle),-.3,Math.sin(angle)).normalize().multiplyScalar(site.radius+12).add(new THREE.Vector3(site.x,site.y,site.z));
  const marker=new THREE.Mesh(this.geo,this.markerMaterial);marker.position.copy(destination);marker.scale.setScalar(8);marker.visible=false;this.root.add(marker);
  this.departures.set(enemy,{site,age:0,destination,exit,size:enemy.group.scale.clone(),marker,released:false});
  enemy.spawning=true;enemy.group.position.set(site.x,site.y,site.z);enemy.group.scale.setScalar(Math.min(20,enemy.group.scale.x));
 }
 update(dt:number){
  this.feedbackCooldown=Math.max(0,this.feedbackCooldown-dt);
  for(let i=0;i<this.sites.length;i++){
   const s=this.sites[i];s.age+=dt;const u=this.meshes[i].material.uniforms;
   u.time.value=s.age;u.armed.value=s.age>=RIFT_RULES.activationSec?1:0;
   u.near.value=this.players.some(p=>!p.isDead&&p.worldPosition.distanceTo(new THREE.Vector3(s.x,s.y,s.z))<RIFT_RULES.warningRadius)?1:0;
  }
  const wasWarning=!!this.warning;this.warning='';
  for(const p of this.players){
   const now=p.worldPosition,previous=this.previous.get(p),revision=p.teleportRevision??0;
   const old=previous?.revision===revision?previous.position:now;
   if(!p.isDead){
    const seconds=riftExposure(old,now,this.sites,dt),damage=p.spec.vitals.maxHp*RIFT_RULES.damageFractionPerSecond*seconds;
    if(damage>0&&p.takeEnvironmentalDamage(damage)&&this.feedbackCooldown<=0){
     const source=this.sites.find(s=>sphereInterval(old,now,s,s.radius))!;
     this.onHit?.(damage,source);this.feedbackCooldown=.35;
    }
    const nearest=this.sites.map(s=>({s,d:now.distanceTo(new THREE.Vector3(s.x,s.y,s.z))})).sort((a,b)=>a.d-b.d)[0];
    if(nearest&&nearest.d<RIFT_RULES.warningRadius+100){const inside=nearest.d<nearest.s.radius;
     this.warning=nearest.s.age<RIFT_RULES.activationSec?'중력이상지대 활성화 예고 — 이탈하세요':inside?'중력이상지대 내부 — 중심 반대 방향으로 이탈하세요':`중력이상지대 경고 · 위험 경계까지 ${Math.max(0,Math.round(nearest.d-nearest.s.radius))}m`;
    }
   }
   this.previous.set(p,{position:now.clone(),revision});
  }
  if(this.warning&&!wasWarning)this.onWarning?.();
  let visibleMarkers=0;
  for(const [e,d] of this.departures){
   if(e.state!=='alive'){d.marker.removeFromParent();this.departures.delete(e);continue;}
   const activeDt=Math.max(0,Math.min(dt,d.site.age-RIFT_RULES.activationSec));d.age+=activeDt;
   if(d.age<RIFT_RULES.formationSec){e.group.position.lerpVectors(new THREE.Vector3(d.site.x,d.site.y,d.site.z),d.exit,Math.min(1,d.age/RIFT_RULES.formationSec));continue;}
   d.marker.visible=visibleMarkers++<12;
   if(d.age<RIFT_RULES.formationSec+RIFT_RULES.arrivalWarningSec)continue;
   if(!d.released){this.onLeap?.(e.group.position,d.destination,e.color,.6);e.group.position.copy(d.destination);e.group.scale.copy(d.size);e.spawning=false;e.leapRecover=RIFT_RULES.recoverySec;e.stagger(RIFT_RULES.recoverySec);d.released=true;}
   d.marker.removeFromParent();this.departures.delete(e);
  }
 }
 get lenses(){return this.sites.map(s=>({...s,radiusWorld:s.radius,strength:.35,volume:true}));}
 clear(){
  for(const [e,d] of this.departures){e.spawning=false;e.group.scale.copy(d.size);}
  this.departures.clear();this.previous.clear();this.sites.length=0;this.serial=0;this.feedbackCooldown=0;this.warning='';
  for(const mesh of this.meshes)mesh.material.dispose();this.meshes=[];this.root.clear();this.root.removeFromParent();
 }
 dispose(){if(this.disposed)return;this.clear();this.geo.dispose();this.markerMaterial.dispose();this.disposed=true;}
}
