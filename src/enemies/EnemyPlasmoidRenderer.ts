import * as THREE from 'three';
import {PlasmoidVisual,type PlasmoidKind,type PlasmoidPose} from '../assets/PlasmoidVisual';
import type {CoreEnemy} from './CoreEnemy';
import type {EnemyVisibility} from './EnemyVisibility';

type Part={source:THREE.Mesh;mesh:THREE.InstancedMesh;alpha:THREE.InstancedBufferAttribute};
type Batch={model:PlasmoidVisual;parts:Part[]};
export function plasmoidKind(e:CoreEnemy):PlasmoidKind {
 return e.deployRole==='boss'?'boss':e.deployRole==='elite'?'elite':e.role==='marker'?'brander':e.role==='kiter'?'skeeter':'leech';
}
/** Shared component batches. Decorative geometry is never added to hitMeshes. */
export class EnemyPlasmoidRenderer {
 private batches=new Map<PlasmoidKind,Batch>();
 private states=new WeakMap<CoreEnemy,{pose:PlasmoidPose;since:number;position:THREE.Vector3;rotation:THREE.Quaternion}>();
 private matrix=new THREE.Matrix4();private root=new THREE.Matrix4();
 private color=new THREE.Color();private direction=new THREE.Vector3();private scale=new THREE.Vector3();
 private white=new THREE.Color(1,1,1);
 private forward=new THREE.Vector3(0,0,1);
 constructor(private scene:THREE.Scene,private capacity:number,private visibility:EnemyVisibility){}
 private batch(kind:PlasmoidKind){
  let batch=this.batches.get(kind);if(batch)return batch;
  const model=new PlasmoidVisual(kind),parts:Part[]=[];
  model.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
   const geo=o.geometry instanceof THREE.SphereGeometry?new THREE.SphereGeometry(o.geometry.parameters.radius,16,12):o.geometry.clone(),alpha=new THREE.InstancedBufferAttribute(new Float32Array(this.capacity),1);
   geo.setAttribute('visualAlpha',alpha);
   const material=(o.material as THREE.ShaderMaterial).clone();material.uniforms.tint.value.set('#ffffff');
   material.vertexShader='attribute float visualAlpha; varying float fadeInstance; varying vec3 colorInstance;\n'+material.vertexShader;
   material.vertexShader=material.vertexShader.replace('tex=uv;', 'tex=uv;fadeInstance=visualAlpha;colorInstance=instanceColor;');
   material.vertexShader=material.vertexShader.replace('vec4 mv=modelViewMatrix*vec4(position,1.);','vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);');
   material.vertexShader=material.vertexShader.replace('normalMatrix*normal','normalMatrix*mat3(instanceMatrix)*(normal/vec3(dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz),dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz),dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz)))');
   material.fragmentShader='varying float fadeInstance; varying vec3 colorInstance;\n'+material.fragmentShader;
   material.fragmentShader=material.fragmentShader.replace('vec3 c=mix(tint,vec3(1.),', 'vec3 c=mix(colorInstance,vec3(1.),');
   material.fragmentShader=material.fragmentShader.replace('fade*strength*','fade*fadeInstance*');
   this.visibility.applySoft(material);
   const mesh=new THREE.InstancedMesh(geo,material,this.capacity);mesh.count=0;mesh.frustumCulled=false;
   mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.setColorAt(0,new THREE.Color());
   this.scene.add(mesh);parts.push({source:o,mesh,alpha});
  });
  batch={model,parts};this.batches.set(kind,batch);return batch;
 }
 update(enemies:readonly CoreEnemy[],time:number,combatPose:(e:CoreEnemy)=>PlasmoidPose,eye?:THREE.Vector3,emphasis:(e:CoreEnemy)=>'front'|'tail'|'both'=()=> 'both'){
  this.clear();
  for(const e of enemies){
   if(e.state==='dead')continue;
   e.hitMesh.visible=false; // Dying shells must not restore the obsolete silhouette.
   let pose=combatPose(e);
   if(e.isPhased||e.isStaggered||e.leapRecover>0)pose='recover';
   else if(e.visualAttackLeft>0||e.isDashing)pose='attack';
   else if(e.markerAimLeft>0||e.leapCastLeft>0)pose='charge';
   else if(e.visualRecoverLeft>0)pose='recover';
   let state=this.states.get(e);
   if(!state){state={pose,since:time,position:e.group.position.clone(),rotation:new THREE.Quaternion()};this.states.set(e,state);}
   if(state.pose!==pose){state.pose=pose;state.since=time;}
   this.direction.copy(e.group.position).sub(state.position);
   if((pose==='charge'||e.role==='marker'||e.role==='kiter')&&eye)this.direction.copy(eye).sub(e.group.position);
   if(this.direction.lengthSq()>.000001)state.rotation.setFromUnitVectors(this.forward,this.direction.normalize());
   state.position.copy(e.group.position);
   const kind=plasmoidKind(e),batch=this.batch(kind);
   const day=THREE.MathUtils.clamp(Number(this.scene.userData.cityDaylight??1),0,1);
   batch.model.setLighting(day);batch.model.setDistance(eye?e.group.position.distanceTo(eye)/Math.max(.1,e.group.scale.x):0);
   batch.model.update(time,pose,time-state.since,emphasis(e));batch.model.updateMatrixWorld(true);
   const s=e.group.scale.x*(e.state==='dissolving'?e.coreScale:1);
   this.scale.setScalar(Math.max(0,s));this.root.compose(e.group.position,state.rotation,this.scale);
   this.color.set(e.color).multiplyScalar(Math.min(1.5,.85+e.glow*.15)).lerp(this.white,Math.min(1,e.flash+(pose==='charge'?.08:pose==='attack'?.15:0)));
   const far=eye?e.group.position.distanceToSquared(eye)>250*250:false;
   batch.parts.forEach((part,index)=>{
    // Keep the nucleus, one envelope and role silhouette at long range.
    if(far&&(index===0||index===1))return;
    const slot=part.mesh.count;if(slot>=this.capacity)return;
    this.matrix.multiplyMatrices(this.root,part.source.matrixWorld);part.mesh.setMatrixAt(slot,this.matrix);part.mesh.setColorAt(slot,this.color);
    const source=part.source.material as THREE.ShaderMaterial;
    part.alpha.setX(slot,source.uniforms.strength.value*(e.isPhased?.12:1)*(e.state==='dissolving'?Math.min(1,e.coreScale):1));
    const mat=part.mesh.material as THREE.ShaderMaterial;
    mat.uniforms.daylight.value=day;mat.uniforms.time.value=time; // Per-instance pose whitening is carried by the color, not shared uniforms.
    part.mesh.count++;
   });
  }
  for(const b of this.batches.values())for(const p of b.parts){p.mesh.instanceMatrix.needsUpdate=true;p.mesh.instanceColor!.needsUpdate=true;p.alpha.needsUpdate=true;}
 }
 clear(){for(const b of this.batches.values())for(const p of b.parts)p.mesh.count=0;}
 dispose(){for(const b of this.batches.values()){for(const p of b.parts){p.mesh.removeFromParent();p.mesh.geometry.dispose();(p.mesh.material as THREE.Material).dispose();}b.model.dispose();}this.batches.clear();this.states=new WeakMap();}
}
