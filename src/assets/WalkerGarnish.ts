import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WalkerMech } from "./WalkerMech";
import type { WalkerSkinSlot } from "./WalkerSkin";
export const WALKER_GARNISH_FEATURES=["panels","vents","markings","fasteners","footGuards","weaponPods","viking"] as const;
export type WalkerGarnishFeature=typeof WALKER_GARNISH_FEATURES[number];

/** Skin-owned surface geometry. It never modifies the base hull or animated joints. */
export class WalkerGarnish {
  private roots:THREE.Group[]=[];
  private geometries=new Set<THREE.BufferGeometry>();
  constructor(mech:WalkerMech,features:readonly WalkerGarnishFeature[],hullScale:readonly [number,number,number]){
    const enabled=new Set(features);
    const attach=(host:THREE.Object3D,scale:readonly [number,number,number])=>{
      const root=new THREE.Group();root.name="skin_garnish";root.userData.skinGarnish=true;root.scale.set(...scale);host.add(root);this.roots.push(root);return root;
    };
    const add=(root:THREE.Group,slot:WalkerSkinSlot,geometry:THREE.BufferGeometry,pos:number[])=>{
      this.geometries.add(geometry);const m=new THREE.Mesh(geometry,mech.getSkinMaterial(slot));m.position.fromArray(pos);m.castShadow=m.receiveShadow=true;root.add(m);return m;
    };
    const box=(root:THREE.Group,slot:WalkerSkinSlot,size:number[],pos:number[])=>add(root,slot,new THREE.BoxGeometry(...size as [number,number,number]),pos);
    const bolt=(root:THREE.Group,pos:number[])=>{const g=new THREE.CylinderGeometry(.015,.015,.028,6);g.rotateX(Math.PI/2);add(root,"steel",g,pos);};
    const hull=attach(mech.torso,hullScale);
    if(enabled.has("viking")){
      // Faceted helmet plates and swept ivory horns, clear of the propulsion outlets.
      for(const side of [-1,1]){
        const brow=box(hull,"trim",[.16,.09,.92],[side*.27,.96,-.08]);brow.rotation.x=.11;
        const points=[[side*.54,.91,-.38],[side*.76,1.08,-.43],[side*.91,1.34,-.50],[side*.86,1.60,-.59]];
        for(let i=1;i<points.length;i++){
          const a=new THREE.Vector3(...points[i-1]),b=new THREE.Vector3(...points[i]),d=b.clone().sub(a);
          const horn=add(hull,"accent",new THREE.CylinderGeometry(i===3?.008:.13-i*.035,.165-(i-1)*.045,d.length(),8),a.add(b).multiplyScalar(.5).toArray());
          horn.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
        }
      }
    }
    for(const side of [-1,1]){
      if(enabled.has("panels")){
        const roof=[[-.55,.997],[.38,.89],[.55,.787]];
        for(let i=1;i<roof.length;i++){
          const [z0,y0]=roof[i-1],[z1,y1]=roof[i],dz=z1-z0,dy=y1-y0;
          const rail=box(hull,"trim",[.18,.028,Math.hypot(dz,dy)],[side*.39,(y0+y1)/2+.012,(z0+z1)/2]);
          rail.rotation.x=Math.atan2(-dy,dz);
        }
        box(hull,"trim",[.055,.08,.75],[side*.82,.64,.02]);
      }
      if(enabled.has("vents"))for(let i=0;i<6;i++)box(hull,"frame",[.33,.020,.035],[side*.38,.43-i*.045,-.945]);
      if(enabled.has("markings"))for(let i=0;i<3;i++)box(hull,"accent",[.025,.045,.02],[side*(.25+i*.045),.39,.94]);
      if(enabled.has("fasteners"))for(let i=0;i<3;i++)bolt(hull,[side*(.24+i*.06),.39,.94]);
    }
    for(const [side,leg] of [[-1,mech.legs.left],[1,mech.legs.right]] as const){
      const hip=attach(leg.hip,[1.18,1.15,1.12]),knee=attach(leg.knee,[1.18,1.15,1.12]);
      if(enabled.has("viking")){
        for(let i=0;i<3;i++)box(knee,i===1?"trim":"armor",[.38-i*.035,.23,.055],[0,-.27-i*.23,.245]);
        // Angular inlaid rune: a stem and two diagonal branches.
        box(knee,"sensor",[.018,.19,.014],[0,-.50,.282]);
        for(const sign of [-1,1]){const rune=box(knee,"sensor",[.018,.11,.014],[.032,-.46+sign*.035,.282]);rune.rotation.z=sign*.72;}
      }
      if(enabled.has("footGuards")){
        const foot=attach(leg.ankle,[1.18,1,1.20]);
        for(const edge of [-1,1])box(foot,"frame",[.27,.045,.25],[edge*.23,-.102,.42]);
      }
      if(enabled.has("panels")){
        box(hip,"trim",[.20,.36,.032],[side*.06,-.30,.232]);
        box(knee,"trim",[.20,.72,.032],[side*.035,-.53,.225]);
      }
      if(enabled.has("vents"))for(let i=0;i<6;i++)box(knee,"frame",[.20,.020,.025],[0,-.25-i*.085,.255]);
      if(enabled.has("markings"))for(let i=0;i<3;i++){
        const stripe=box(knee,"accent",[.16,.025,.02],[0,-.63-i*.065,.265]);stripe.rotation.z=-.25;
      }
      if(enabled.has("fasteners"))for(const y of [-.26,-.69])bolt(knee,[side*.13,y,.233]);
    }
    for(const [side,arm] of [[-1,mech.arms.left],[1,mech.arms.right]] as const){
      const gun=attach(arm.elbow,[.94,.94,.94]);
      if(enabled.has("viking")){
        const shield=add(gun,"trim",new THREE.CylinderGeometry(.29,.29,.055,16),[side*.27,0,.22]);shield.rotation.z=Math.PI/2;
        const face=add(gun,"frame",new THREE.CylinderGeometry(.245,.245,.064,16),[side*.30,0,.22]);face.rotation.z=Math.PI/2;
        const boss=add(gun,"steel",new THREE.SphereGeometry(.09,12,8),[side*.35,0,.22]);boss.scale.x=.5;
        for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
          const stud=add(gun,"accent",new THREE.SphereGeometry(.024,8,6),[side*.34,Math.sin(angle)*.21,.22+Math.cos(angle)*.21]);
          stud.scale.x=.5;
        }
      }
      if(enabled.has("weaponPods"))box(gun,"frame",[.19,.21,.34],[side*.25,-.035,.13]);
      if(enabled.has("panels"))box(gun,"trim",[.23,.035,.48],[0,.26,.25]);
      if(enabled.has("markings"))for(let i=0;i<3;i++)box(gun,"accent",[.05,.018,.025],[-.08+i*.08,.20,.65]);
    }
    // Batch attachments independently so the plain hull can be exported without them.
    for(const root of this.roots){
      const batches=new Map<THREE.Material,THREE.Mesh[]>();
      for(const node of root.children){const mesh=node as THREE.Mesh;const mat=mesh.material as THREE.Material;const list=batches.get(mat)??[];list.push(mesh);batches.set(mat,list);}
      for(const [material,nodes] of batches){
        const transformed=nodes.map(node=>{node.updateMatrix();return node.geometry.clone().applyMatrix4(node.matrix);});
        const geometry=mergeGeometries(transformed);transformed.forEach(g=>g.dispose());
        if(!geometry)throw new Error("Cannot batch skin garnish");
        for(const node of nodes){root.remove(node);node.geometry.dispose();this.geometries.delete(node.geometry);}
        this.geometries.add(geometry);const mesh=new THREE.Mesh(geometry,material);mesh.name="skin_"+material.name;mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);
      }
    }
  }
  dispose():void {this.roots.forEach(root=>root.removeFromParent());this.geometries.forEach(g=>g.dispose());this.geometries.clear();this.roots=[];}
}
