import * as THREE from "three";
import {parseFlyerSkin,type FlyerSkin} from "./FlyerSkin";
import {BLUE_EXHAUST_LAYERS,createExhaustGeometry,createExhaustMaterial} from "./BlueExhaust";

/** Metres, +Z forward, +Y up; origin at the flight centre. */
export const FLYER_ASSET={id:"drone-v1",version:8,droneId:"flyer",units:"metres",forward:"+Z",up:"+Y"} as const;
export const FLYER_PROPORTIONS={length:2.8,span:1.96,hullHeight:.42,engineOffset:.59} as const;

/** Editable A-wing-inspired interceptor blockout. Owns all render resources. */
export class FlyerDrone extends THREE.Group {
  readonly sockets:Record<string,THREE.Object3D>={};
  private geometries=new Set<THREE.BufferGeometry>();
  private materials=new Set<THREE.Material>();
  private exhausts:THREE.Mesh[]=[];
  private skinRoot?:THREE.Group;
  private skinGeometry:THREE.BufferGeometry[]=[];
  private baseMaterials=new Map<THREE.MeshStandardMaterial,THREE.MeshStandardMaterial>();
  constructor(skin?:FlyerSkin){
    super();this.name="FLYER_DRONE_V1";this.userData.asset={...FLYER_ASSET};
    const mat=(name:string,color:number,metalness:number,roughness:number)=>{
      const m=new THREE.MeshStandardMaterial({name,color,metalness,roughness});this.materials.add(m);return m;
    };
    // Same untextured PBR values as the plain WalkerMech.
    const armor=mat("flyer.armor",0x68737b,.48,.57);
    mat("flyer.trim",0x68737b,.38,.5);mat("flyer.accent",0xd99135,.35,.52);
    const frame=mat("flyer.frame",0x151e26,.65,.58),steel=mat("flyer.steel",0x71858e,.88,.3);
    const lensMaterial=mat("flyer.sensor",0xea332b,.25,.25);lensMaterial.emissive.setHex(0xd9150d);lensMaterial.emissiveIntensity=1.4;
    const add=(g:THREE.BufferGeometry,m:THREE.Material,p:number[],name:string)=>{
      this.geometries.add(g);const mesh=new THREE.Mesh(g,m);mesh.name=name;mesh.position.fromArray(p);mesh.castShadow=mesh.receiveShadow=true;this.add(mesh);return mesh;
    };
    const plume=(radius:number,length:number,pos:number[],name:string,down:boolean,strength:number)=>{
      return BLUE_EXHAUST_LAYERS.map(([color,width,extent,opacity],i)=>{
        const material=createExhaustMaterial(color,opacity*strength);this.materials.add(material);
        const geometry=createExhaustGeometry(radius*width,length*extent);
        if(down)geometry.rotateX(Math.PI/2);else geometry.rotateY(Math.PI);
        const mesh=add(geometry,material,pos,name+"_layer_"+i);
        mesh.userData.runtimeEffect=true;mesh.userData.baseOpacity=opacity;mesh.castShadow=mesh.receiveShadow=false;return mesh;
      });
    };
    const cylinder=(m:THREE.Material,r:number,length:number,p:number[],name:string)=>{
      const g=new THREE.CylinderGeometry(r,r,length,24);g.rotateX(Math.PI/2);return add(g,m,p,name);
    };
    // Smooth sections end in a broad horizontal nose: thin in profile, wide in plan.
    const sections=new THREE.CatmullRomCurve3([
      new THREE.Vector3(.53,.11,-1.04),new THREE.Vector3(.68,.19,-.66),
      new THREE.Vector3(.64,.205,-.22),new THREE.Vector3(.47,.155,.40),
      new THREE.Vector3(.40,.07,1.02),new THREE.Vector3(.34,.006,1.40)
    ],false,"centripetal");
    const vertices:number[]=[],uvs:number[]=[],indices:number[]=[],rings=48,sides=40;
    for(let j=0;j<=rings;j++){
      const section=sections.getPoint(j/rings);
      for(let i=0;i<=sides;i++){
        const angle=i/sides*Math.PI*2;
        vertices.push(Math.cos(angle)*section.x,Math.sin(angle)*section.y,section.z);
        uvs.push(i/sides,j/rings);
        if(j<rings&&i<sides){const a=j*(sides+1)+i,b=a+sides+1;indices.push(a,a+1,b,a+1,b+1,b);}
      }
    }
    const hull=new THREE.BufferGeometry();hull.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));hull.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));hull.setIndex(indices);hull.computeVertexNormals();
    add(hull,armor,[0,0,0],"curved_pointed_hull");
    const noseCap=new THREE.CircleGeometry(1,40);noseCap.scale(.34,.006,1);add(noseCap,armor,[0,0,1.40],"wide_nose_edge");
    const rearCap=new THREE.CircleGeometry(1,40);rearCap.scale(.53,.11,1);rearCap.rotateY(Math.PI);add(rearCap,armor,[0,0,-1.04],"hull_rear_cap");
    for(const side of [-1,1]){
      const wing=new THREE.Shape();wing.moveTo(.36,-.68);wing.quadraticCurveTo(.70,-.36,.95,.12);wing.quadraticCurveTo(.99,.44,.89,.84);wing.quadraticCurveTo(.68,.95,.45,.88);wing.closePath();
      const wg=new THREE.ExtrudeGeometry(wing,{depth:.035,bevelEnabled:true,bevelSize:.025,bevelThickness:.018,bevelSegments:3,curveSegments:16,steps:1});wg.rotateX(-Math.PI/2);
      const wm=add(wg,armor,[0,-.05,0],"curved_wing_"+side);wm.scale.x=side;
      cylinder(frame,.19,1.12,[side*.59,0,-.76],"engine_core_"+side);
      cylinder(armor,.207,.59,[side*.59,0,-.57],"engine_cowling_"+side);
      cylinder(steel,.18,.18,[side*.59,0,-1.30],"exhaust_collar_"+side);
      cylinder(frame,.143,.015,[side*.59,0,-1.397],"exhaust_aperture_"+side);
      // Original receiver rear stays at -0.20m; 0.46m body extends forward to 0.69m.
      cylinder(frame,.073,.69,[side*.94,-.03,.145],"beam_emitter_body_"+side);
      cylinder(steel,.079,.026,[side*.94,-.03,.497],"beam_lens_rim_"+side);
      cylinder(frame,.068,.006,[side*.94,-.03,.512],"beam_lens_seat_"+side);
      const lens=add(new THREE.SphereGeometry(.062,32,16),lensMaterial,[side*.94,-.03,.510],"beam_emitter_lens_"+side);lens.scale.z=.14;
      // Swept vertical tail plates, outboard of each engine.
      const fin=new THREE.Shape();fin.moveTo(-.55,0);fin.quadraticCurveTo(-.79,.12,-.95,.43);fin.quadraticCurveTo(-1.02,.47,-1.22,.36);fin.quadraticCurveTo(-1.24,.14,-1.27,0);fin.closePath();
      const fg=new THREE.ExtrudeGeometry(fin,{depth:.035,bevelEnabled:true,bevelSize:.008,bevelThickness:.008,bevelSegments:2,curveSegments:12});fg.rotateY(-Math.PI/2);
      add(fg,armor,[side*.70,.16,0],"tail_fin_"+side);
      this.exhausts.push(...plume(.12,.65,[side*.59,0,-1.41],"exhaust_preview_"+side,false,0));
      const socket=new THREE.Object3D();socket.name=side<0?"socket_muzzle_left":"socket_muzzle";socket.position.set(side*.94,-.03,.521);this.add(socket);this.sockets[socket.name]=socket;
    }
    for(const [name,p] of [["camera",[0,.4,.5]],["focus",[0,0,0]],["engine_left",[-.59,0,-1.4]],["engine_right",[.59,0,-1.4]]] as const){
      const node=new THREE.Object3D();node.name="socket_"+name;node.position.fromArray(p);this.add(node);this.sockets[node.name]=node;
    }
    // Fore/aft lift jets attach directly to the curved underside; hover never switches off.
    this.updateMatrixWorld(true);
    const body=this.getObjectByName("curved_pointed_hull")!;
    for(const [name,z] of [["front",.65],["rear",-.60]] as const){
      const ray=new THREE.Raycaster();
      const surfaceAt=(x:number,dz:number)=>{
        ray.set(new THREE.Vector3(x,-2,z+dz),new THREE.Vector3(0,1,0));
        const hit=ray.intersectObject(body,false)[0];if(!hit)throw new Error("Hover nozzle must meet hull");return hit.point.y;
      };
      const segments=64,outerHeights:number[]=[];let lowest=surfaceAt(0,0);
      for(let i=0;i<=segments;i++){
        const angle=i/segments*Math.PI*2;
        outerHeights.push(surfaceAt(Math.cos(angle)*.26,Math.sin(angle)*.26));
        for(const r of [.065,.13,.195,.26])lowest=Math.min(lowest,surfaceAt(Math.cos(angle)*r,Math.sin(angle)*r));
      }
      const y=lowest-.012;
      // Closed contoured flange: the outer lip follows the skin; the outlet stays planar below it.
      const positions:number[]=[],texcoords:number[]=[],faces:number[]=[];
      const radii=[.26,.26,.21,.164,.164,.21];
      for(let ring=0;ring<radii.length;ring++)for(let i=0;i<=segments;i++){
        const angle=i/segments*Math.PI*2;
        const h=ring===0?outerHeights[i]+.002:ring===1?outerHeights[i]-.006:ring<4?y:y+.006;
        positions.push(Math.cos(angle)*radii[ring],h,Math.sin(angle)*radii[ring]);texcoords.push(i/segments,ring/(radii.length-1));
        if(i<segments){const a=ring*(segments+1)+i,b=((ring+1)%radii.length)*(segments+1)+i;faces.push(a,a+1,b,a+1,b+1,b);}
      }
      const flange=new THREE.BufferGeometry();flange.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));flange.setAttribute("uv",new THREE.Float32BufferAttribute(texcoords,2));flange.setIndex(faces);flange.computeVertexNormals();
      add(flange,steel,[0,0,z],"hover_housing_"+name);
      add(new THREE.CylinderGeometry(.164,.164,.004,32),frame,[0,y-.002,z],"hover_aperture_"+name);
      const rim=new THREE.TorusGeometry(.21,.004,8,32);rim.rotateX(Math.PI/2);add(rim,steel,[0,y,z],"hover_rim_"+name);
      plume(.146,.12,[0,y-.004,z],"hover_flame_"+name,true,.55);
      const socket=new THREE.Object3D();socket.name="socket_hover_"+name;socket.position.set(0,y-.004,z);socket.rotation.x=Math.PI/2;this.add(socket);this.sockets[socket.name]=socket;
    }
    this.setThrottle(0);
    for(const material of this.materials)if(material instanceof THREE.MeshStandardMaterial)this.baseMaterials.set(material,material.clone());
    this.userData.skinId="base";
    if(skin)this.applySkin(skin);
  }
  private clearGarnish():void {this.skinRoot?.removeFromParent();this.skinRoot=undefined;this.skinGeometry.forEach(g=>g.dispose());this.skinGeometry=[];}
  clearSkin():void {this.clearGarnish();for(const [material,base] of this.baseMaterials)material.copy(base);this.userData.skinId="base";}
  applySkin(definition:FlyerSkin):void {
    const skin=parseFlyerSkin(definition);this.clearGarnish();
    const slots:Record<string,THREE.MeshStandardMaterial>={};
    for(const material of this.baseMaterials.keys()){
      const slot=material.name.split(".")[1] as keyof FlyerSkin["materials"],source=skin.materials[slot];slots[slot]=material;
      material.color.set(source.color);material.roughness=source.roughness;material.metalness=source.metalness;material.emissive.set(source.emissive??"#000000");material.emissiveIntensity=source.emissiveIntensity??0;
    }
    const root=new THREE.Group();root.name="flyer_skin_garnish";root.userData.skinGarnish=true;this.add(root);this.skinRoot=root;
    const mesh=(g:THREE.BufferGeometry,slot:string,p:number[])=>{this.skinGeometry.push(g);const m=new THREE.Mesh(g,slots[slot]);m.position.fromArray(p);m.castShadow=m.receiveShadow=true;root.add(m);return m;};
    const box=(slot:string,size:number[],p:number[])=>mesh(new THREE.BoxGeometry(...size as [number,number,number]),slot,p);
    const features=new Set(skin.garnish);
    this.updateMatrixWorld(true);
    // Sample in model space so applying a skin while banked cannot move the fittings.
    const body=this.getObjectByName("curved_pointed_hull") as THREE.Mesh;
    const localHull=new THREE.Mesh(body.geometry,body.material);localHull.updateMatrixWorld(true);
    for(const side of [-1,1]){
      if(features.has("panels"))for(let i=0;i<6;i++){
        const x=side*.29,z=-.60+i*.16;
        const hit=new THREE.Raycaster(new THREE.Vector3(x,2,z),new THREE.Vector3(0,-1,0)).intersectObject(localHull,false)[0];
        if(hit){const rail=box("trim",[.055,.016,.14],[x,hit.point.y+.008,z]);rail.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),hit.face!.normal);}
      }
      if(features.has("vents"))for(let i=0;i<5;i++)box("frame",[.13,.018,.025],[side*.59,.207,-.76+i*.07]);
      if(features.has("markings"))for(let i=0;i<3;i++)box("accent",[.11,.01,.022],[side*.85,.009,-.30-i*.05]);
      if(features.has("fasteners"))for(const z of [-.70,-.35]){const bolt=mesh(new THREE.SphereGeometry(.017,8,6),"steel",[side*.59,.212,z]);bolt.scale.y=.45;}
      if(features.has("viking")){
        const points=[new THREE.Vector3(side*.59,.20,-.62),new THREE.Vector3(side*.76,.38,-.69),new THREE.Vector3(side*.83,.60,-.83)];
        for(let i=1;i<points.length;i++){
          const a=points[i-1],b=points[i],d=b.clone().sub(a);
          const horn=mesh(new THREE.CylinderGeometry(i===2?.008:.055,i===2?.055:.085,d.length(),10),"accent",a.clone().add(b).multiplyScalar(.5).toArray());horn.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
        }
        const rim=mesh(new THREE.CylinderGeometry(.105,.105,.024,20),"trim",[side*1.018,-.03,.06]);rim.rotation.z=Math.PI/2;
        const shield=mesh(new THREE.CylinderGeometry(.083,.083,.026,20),"frame",[side*1.034,-.03,.06]);shield.rotation.z=Math.PI/2;
        const boss=mesh(new THREE.SphereGeometry(.034,12,8),"steel",[side*1.05,-.03,.06]);boss.scale.x=.45;
        for(let i=0;i<3;i++){const rune=box("sensor",[.018,.008,.055],[side*.59,.216,-.38-i*.065]);rune.rotation.y=side*.6;}
      }
    }
    this.userData.skinId=skin.id;
  }
  setThrottle(value:number):void {const t=THREE.MathUtils.clamp(value,0,1);for(const mesh of this.exhausts){mesh.visible=t>.01;mesh.scale.z=.25+t; (mesh.material as THREE.ShaderMaterial).uniforms.opacity.value=mesh.userData.baseOpacity*t;}}
  dispose():void {this.clearGarnish();this.baseMaterials.forEach(m=>m.dispose());this.baseMaterials.clear();this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.geometries.clear();this.materials.clear();this.removeFromParent();}
}
