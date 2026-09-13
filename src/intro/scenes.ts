import type { WalkerMech } from "../assets/WalkerMech";
import * as THREE from "three";
import type { CutScene, SceneCtx } from "./CinematicPlayer";
import { atmosphere, box, drone, entity, glow, material, street, type Street } from "./cinematicAssets";
import { observationState, sharedPulse } from "./sequence";

function camera(ctx: SceneCtx, p: number[], target: number[], fov = 48): void {
  ctx.scene.userData.introCityUpdate?.();
  ctx.camera.fov = fov;
  ctx.camera.updateProjectionMatrix();
  ctx.camera.position.fromArray(p);
  ctx.camera.lookAt(new THREE.Vector3().fromArray(target));
}
function damageStreet(set:Street,t:number):void {
  if(set.damage){set.damage(t);return;}
  const loss=THREE.MathUtils.smoothstep(t,1,4);
  set.details.traverse(o=>{
    if(o instanceof THREE.Mesh && o.position.x<.8) {
      o.visible=loss<.98;
      // Shrinking fine mouldings precedes masonry loss; the right-hand lamp stays powered.
      o.scale.setScalar(1-loss);
    }
  });
  set.fragments.forEach((f,i)=>{
    if(f.home.x>=.8)return;
    const k=THREE.MathUtils.smoothstep(t,3+i%5*.28,8.5);
    f.mesh.position.copy(f.home);
    f.mesh.position.y=Math.max(.22,f.home.y-k*(f.home.y-.22));
    f.mesh.position.z+=Math.sin(i)*k*.8;
    f.mesh.scale.setScalar(1-k*.7);
    f.mesh.rotation.set(k*f.spin,k*f.spin*.7,k*.25);
  });
}
function alley(name:string,duration:number,collapse=false):CutScene {
  let set:Street, visitor:THREE.Group | undefined;
  return {name,duration,build({scene}){
    set=street(scene);
    if(name==="place" || collapse) {visitor=entity(scene);visitor.position.set(-2,2.4,-6.7);}
  },
    update(t,_dt,ctx){
      const shot=collapse?t+9:t;
      if(ctx.scene.userData.introCityAnchor)camera(ctx,[18-shot*.16,42,24-shot*.26],[0,0,0],55);
      else camera(ctx,[3.8-shot*.16,2.3,2-shot*.26],[0,1.7,-9]);
      set.dust.rotation.y=t*.006;
      if(visitor){
        visitor.visible=collapse || t>=4.5;
        visitor.position.x=collapse ? -2 : -5+Math.min(1,(t-4.5)/4.5)*3;
        visitor.scale.setScalar(sharedPulse((collapse?9:0)+t)*(collapse?1+t*.035:.75));
      }
      if(collapse)damageStreet(set,t);
    }};
}
function observations(): CutScene {
  let bodies: THREE.Group[];
  let city: THREE.Group, harbour: THREE.Group, remote: THREE.Group;
  return {name:"observations", duration:10,
    build({scene}) {
      street(scene, 1);
      const concrete = material("stone", 0x82959b, 4);
      for (let i = 0; i < 5; i++) box(scene, concrete, [3, 10 + i * 2, 4], [-18 + i * 8, 5 + i, -40]);
      city=new THREE.Group(); for(const child of [...scene.children]) if(!(child instanceof THREE.Light)) city.add(child); scene.add(city);
      harbour=new THREE.Group();scene.add(harbour);
      box(harbour,material("metal",0x3b5967,6),[55,.1,60],[0,-.3,-15]);
      box(harbour,concrete,[15,.8,40],[-13,0,-10]);
      const crane=material("metal",0x958163,2);
      for(let i=0;i<3;i++){
        box(harbour,crane,[.3,12,.3],[-10+i*8,6,-20]);
        box(harbour,crane,[10,.3,.3],[-6+i*8,12,-20]);
        box(harbour,crane,[.03,8,.03],[-2+i*8,8,-20]);
        box(harbour,material("metal",i%2?0x715049:0x657c83,4),[5,2.4,2.6],[-13+i*6,1.5,-8]);
      }
      bodies = [entity(scene), entity(scene, 0xffa251, "spindle"), entity(scene, 0xff7040)];
      bodies.forEach((b, i) => b.position.set(-6 + i * 6, 6 + i, -22 - i * 6));
      bodies.forEach(b=>city.add(b));
      remote=entity(scene,0xffa251,"spindle");remote.position.set(0,5,-13);bodies.push(remote);
    },
    update(t, _dt, ctx) {
      // Two remote observation angles share exactly the same pulse.
      camera(ctx, t < 5 ? [16 - t * .2, 11, 14] : [15, 9, 10 - (t - 5) * .5], t<5 ? [0, 6, -24] : [0,5,-13], 52);
      city.visible=t<5; harbour.visible=remote.visible=t>=5;
      bodies.forEach(b => b.scale.setScalar(sharedPulse(18 + t)));
    }
  };
}
function safety():CutScene {
  let bot:WalkerMech, danger:THREE.Group;
  return {name:"safety",duration:8,
    build({scene}){
      damageStreet(street(scene),9);
      const paint=material("metal",0xc79b39),dark=material("metal",0x293238);
      // A clearly closed street; the robot crosses the barrier in place of a person.
      for(const side of [-1,1]){
        box(scene,paint,[3,.18,.12],[side*3.2,1.2,.5],true);
        for(const x of [side*3.2-1,side*3.2+1]){
          box(scene,dark,[.12,1.3,.16],[x,.55,.5]);
          box(scene,dark,[.55,.12,.65],[x,.05,.5],true);
        }
        const warning=box(scene,glow(0xff5533,1.5),[.13,.2,.13],[side*3.2,1.4,.5],true);
        warning.name="barrier-warning";
      }
      danger=entity(scene);danger.position.set(-2,2.4,-6.7);
      bot=drone(scene);bot.position.set(.3,0,3);bot.rotation.y=Math.PI;
    },
    update(t,_dt,ctx){
      bot.visible=t>=4;
      const elapsed=Math.max(0,t-4),distance=elapsed*.65;
      bot.position.z=3-distance;
      const ground=(x:number,z:number):number=>ctx.scene.userData.introGroundHeight?.(x,z)??0;
      bot.position.y=ground(bot.position.x,bot.position.z);
      // 0.24 m half-stride, half-cycle stance: one gait cycle travels 0.96 m.
      bot.setPose({phase:distance/.96*Math.PI*2,walk:elapsed>0?1:0,stride:.24,stance:.5,
        footHeights:{left:ground(bot.position.x+.87,bot.position.z)-bot.position.y,right:ground(bot.position.x-.87,bot.position.z)-bot.position.y}});
      danger.scale.setScalar(sharedPulse(28+t));
      // Wider physical camera distance preserves road/building scale cues without shrinking the model.
      camera(ctx,[9,6.5+bot.position.y,16-t*.15],[0,1.8+bot.position.y,-2],50);
    },
    dispose(){bot.dispose();}
  };
}
function link(): CutScene {
  let bot: WalkerMech, indicator: THREE.Mesh;
  return {name:"link",duration:10,
    build({scene}) {
      atmosphere(scene);
      const steel = material("metal",0x63717a,3), rubber = material("stone",0x20272d,3);
      box(scene,steel,[16,.2,18],[0,-.3,0]);
      box(scene,steel,[16,7,.3],[0,3,-5]);
      for(let i=0;i<8;i++) box(scene,rubber,[.06,7,.15],[-7+i*2,3,-4.8]);
      box(scene,rubber,[2.4,1,1.4],[0,.35,0],true);
      bot=drone(scene); bot.position.set(0,.85,0);
      box(scene,steel,[2.8,.25,1.6],[2,1,3],true);
      box(scene,rubber,[1.3,.08,.8],[2,1.18,3],true);
      indicator=box(scene,glow(0x6dcddd,.2),[.7,.03,.5],[2,1.23,3]);
      // Gloved hand resting on the physical remote-control grip.
      box(scene,rubber,[.33,.2,.55],[2.7,1.3,3.25],true);
      for(let i=0;i<4;i++) box(scene,rubber,[.075,.15,.32],[2.56+i*.08,1.34,2.97],true);
      const light=new THREE.PointLight(0x92dfff,35,12); light.position.set(0,4,2);scene.add(light);
    },
    update(t,_dt,ctx) {
      camera(ctx,t<5 ? [3.8,2.4,5.5-t*.08] : [4.8-(t-5)*.26,3.5-(t-5)*.04,7.6-(t-5)*.22],t<5 ? [2,1.15,3] : [0,2.45,.1],t<5?43:48);
      (indicator.material as THREE.MeshStandardMaterial).emissiveIntensity=t>2 ? 2 : .2;
      bot.setPose({aimYaw:Math.max(0,t-5)*.035});
    },
    dispose(){bot.dispose();}
  };
}
function encounter(): CutScene {
  let target:THREE.Group, other:THREE.Group, beam:THREE.Mesh, mote:THREE.Points;
  return {name:"encounter",duration:16,
    build({scene}) {
      damageStreet(street(scene),9);
      target=entity(scene); other=entity(scene,0xffa855,"spindle");other.position.set(3.1,3,-6);
      beam=new THREE.Mesh(new THREE.CylinderGeometry(.018,.035,1,12),glow(0x89edff,4));scene.add(beam);
      const points=new Float32Array(180*3);
      for(let i=0;i<180;i++){points[i*3]=Math.sin(i*13)*.8;points[i*3+1]=Math.cos(i*7)*.6;points[i*3+2]=Math.sin(i*3)*.6;}
      const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(points,3));
      mote=new THREE.Points(geo,new THREE.PointsMaterial({color:0xffb57c,size:.035,transparent:true,opacity:.8,depthWrite:false}));scene.add(mote);
    },
    update(t,_dt,ctx) {
      const state=observationState(t);
      const x=t<3.2 ? Math.sin(t*1.4)*.6 : t<6 ? Math.sin(3.2*1.4)*.6 : t<8.2 ? -.58+(t-6)*.44 : .388;
      target.position.set(x,2.4,-7);
      target.visible=!state.dissolved;
      target.scale.setScalar(sharedPulse(46+t));
      other.scale.setScalar(sharedPulse(46+t)*(state.recoil?.8:1));
      other.rotation.z=state.recoil?.13:0;
      camera(ctx,[0,1.75,2],[t>=6&&t<7 ? -2 : x,2.4,-7],58);
      beam.visible=state.firing&&!state.dissolved;
      const start=new THREE.Vector3(.32,1.45,1.3), end=target.position.clone(), delta=end.sub(start);
      beam.position.copy(start).addScaledVector(delta,.5);beam.scale.y=delta.length();
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
      mote.visible=state.dissolved;mote.position.set(.388+(t-12)*.7,2.4+(t-12)*.07,-7-(t-12)*1.5);
      mote.scale.setScalar(1+Math.max(0,t-12)*.45);
      (mote.material as THREE.PointsMaterial).opacity=Math.max(0,.8-(t-12)*.18);
    }
  };
}
function remains():CutScene {
  let dust:THREE.Points, distant:THREE.Group;
  return {name:"remains",duration:9,
    build({scene}) {const set=street(scene); damageStreet(set,9); dust=set.dust; distant=entity(scene,0xffa855,"spindle"); distant.position.set(-2,3,-18);},
    update(t,_dt,ctx) {camera(ctx,[.4+t*.2,2,1-t*.3],[1.9,2.5,-8],44);dust.position.x=t*.18;dust.position.z=-t*.5;distant.scale.setScalar(sharedPulse(62+t));}
  };
}
export function introScenes():CutScene[] {
  return [alley("place",9),alley("loss",9,true),observations(),safety(),link(),encounter(),remains(),
    {name:"title",duration:4,build({scene}){scene.background=new THREE.Color(0x03080c);scene.fog=null;},update(){}}];
}
/** Quiet scenery only: narrative clues are never replayed behind the menu. */
export function menuScenes():CutScene[] {return [alley("menu-place",22)];}
