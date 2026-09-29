import {streetFreeFootprints} from './StreetEnvelope';
import {streetSidewalk} from './streetSection.mjs';
import type {Ring} from './MapData';
import {streetContext,streetCorridor} from './StreetLayout';
import {roadPaintCorners,planRoadMarkings,centerLineOffsets,DEFAULT_MARKINGS} from './RoadMarkings';
import {STREET_MATERIAL_DETAIL_GLSL} from './StreetMaterialDetail';
import bakedMarkings from './cities/cheonggye-markings.json';
import {solveRoadNetwork,roadJunctionCandidate,roadSegmentKey,corridorOffsetPoint,corridorOutline,insideRoadOutline,type RoadCorridor} from './RoadNetwork';
import {surfaceTriangles,subtractSurface} from './SurfacePartition';
import {inPilot,pilotStreetHeight,cutPilotRiver,pilotBridgeRoad,pilotRoadNetwork,pilotInRiver} from './cities/CheonggyePilot';
import * as THREE from 'three';
import type {ChunkTerrain} from './chunkMesh';
import type {CityAppearance} from './cities';
const pilotMarkings=new Map(bakedMarkings.segments as [string,number[][]][]);
type Point=[number,number];
type Road=Pick<Ring,"p"|"w"|"streetSection"|"bridge"|"layer">;
/** Two left/right world-space road cross sections; elevated roads share ground street layers. */
export interface ElevatedStreet {a:number[];b:number[];distance?:number}

/** Clip a convex footprint against each actual terrain triangle, avoiding bilinear height drift. */
export function terrainFootprint(poly:Point[],t:ChunkTerrain,ox:number,oz:number,bridge=false,street=true,clipObstacles=true):number[]{
 if(t.compiledStreet&&street){const [x0,z0,x1,z1]=t.compiledStreet.bounds;return subtractSurface(poly.map(p=>[p[0],0,p[1]]),[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]).flatMap(p=>terrainFootprint(p.map(v=>[v[0],v[2]]),{...t,compiledStreet:undefined},ox,oz,bridge,street,clipObstacles));}
 if(!bridge&&street&&clipObstacles){const parts=streetFreeFootprints(poly,t.streetObstacles);return parts.flatMap(p=>terrainFootprintRaw(p,t,ox,oz,bridge,street));}
 return terrainFootprintRaw(poly,t,ox,oz,bridge,street);
}
function terrainFootprintRaw(poly:Point[],t:ChunkTerrain,ox:number,oz:number,bridge=false,street=true):number[]{
 const output:number[]=[],n=t.size,step=t.step,hGrid=street?(t.roadHeights??t.heights):t.heights;
 // All of this convex road polygon lies on the pilot's exact planar land surface.
 // Keep dense clipping only at the river, chunk boundaries and the transition belt.
 const endX=t.cellX0+(n-1)*step,endZ=t.cellZ0+(n-1)*step;
 if(t.streetPilot&&poly.length>=3&&poly.every(([x,z])=>inPilot(x,z)&&x>=t.cellX0&&x<=endX&&z>=t.cellZ0&&z<=endZ)){
  for(let i=1;i<poly.length-1;i++)for(const [x,z] of [poly[0],poly[i+1],poly[i]])output.push(x-ox,pilotStreetHeight(x,z),z-oz);
  return partitionRoad(output,t,ox,oz,bridge);
 }
 const minX=Math.max(0,Math.floor((Math.min(...poly.map(p=>p[0]))-t.cellX0)/step));
 const maxX=Math.min(n-2,Math.floor((Math.max(...poly.map(p=>p[0]))-t.cellX0)/step));
 const minZ=Math.max(0,Math.floor((Math.min(...poly.map(p=>p[1]))-t.cellZ0)/step));
 const maxZ=Math.min(n-2,Math.floor((Math.max(...poly.map(p=>p[1]))-t.cellZ0)/step));
 for(let j=minZ;j<=maxZ;j++)for(let i=minX;i<=maxX;i++){
  const x=t.cellX0+i*step,z=t.cellZ0+j*step;
  const a:Point=[x,z],b:Point=[x+step,z],c:Point=[x,z+step],d:Point=[x+step,z+step];
  for(const tri of [[a,b,c],[b,d,c]]){
   let clipped=poly;
   for(let edge=0;edge<3;edge++){
    const u=tri[edge],v=tri[(edge+1)%3];
    const side=(p:Point)=>(v[0]-u[0])*(p[1]-u[1])-(v[1]-u[1])*(p[0]-u[0]);
    const next:Point[]=[];
    for(let k=0;k<clipped.length;k++){
     const p=clipped[k],q=clipped[(k+1)%clipped.length],dp=side(p),dq=side(q);
     if(dp>=0)next.push(p);
     if((dp>=0)!==(dq>=0)){const f=dp/(dp-dq);next.push([p[0]+(q[0]-p[0])*f,p[1]+(q[1]-p[1])*f]);}
    }
    clipped=next;if(clipped.length<3)break;
   }
   const h=(p:Point)=>{
    const fx=(p[0]-x)/step,fz=(p[1]-z)/step;
    const ha=hGrid[j*n+i],hb=hGrid[j*n+i+1],hc=hGrid[(j+1)*n+i],hd=hGrid[(j+1)*n+i+1];
    return tri[0]===a?ha+(hb-ha)*fx+(hc-ha)*fz:hd+(hc-hd)*(1-fx)+(hb-hd)*(1-fz);
   };
   for(let k=1;k<clipped.length-1;k++){
    const p=clipped[0],q=clipped[k],r=clipped[k+1];
    if(Math.abs((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]))<1e-8)continue;
    // Upward winding: X/Z plane reverses the usual 2D orientation.
    for(const v of [p,r,q])output.push(v[0]-ox,h(v),v[1]-oz);
   }
  }
 }
 return partitionRoad(output,t,ox,oz,bridge);
}
function partitionRoad(data:number[],t:ChunkTerrain,ox:number,oz:number,bridge:boolean):number[]{
 if(!t.streetPilot||bridge)return data;
 const out:number[]=[];
 for(let i=0;i<data.length;i+=9){const poly=[0,3,6].map(k=>[data[i+k]+ox,data[i+k+1],data[i+k+2]+oz]);for(const p of cutPilotRiver(poly))for(const v of surfaceTriangles(p))out.push(v[0]-ox,v[1],v[2]-oz);}
 return out;
}
function capsule(ax:number,az:number,bx:number,bz:number,r:number):Point[]{
 const angle=Math.atan2(bz-az,bx-ax),points:Point[]=[];
 for(let i=0;i<=8;i++){const a=angle-Math.PI/2+i*Math.PI/8;points.push([bx+Math.cos(a)*r,bz+Math.sin(a)*r]);}
 for(let i=0;i<=8;i++){const a=angle+Math.PI/2+i*Math.PI/8;points.push([ax+Math.cos(a)*r,az+Math.sin(a)*r]);}
 return points;
}
type Segment={ax:number;az:number;bx:number;bz:number;w:number;sidewalk?:number;clipObstacles?:boolean;bridge?:boolean;len:number;key?:string;corridor?:RoadCorridor};
function segmentDistance(x:number,z:number,s:Segment):number {
 const u=Math.max(0,Math.min(1,((x-s.ax)*(s.bx-s.ax)+(z-s.az)*(s.bz-s.az))/(s.len*s.len)));
 return Math.hypot(x-s.ax-u*(s.bx-s.ax),z-s.az-u*(s.bz-s.az));
}
/** Spatial index shared by junction detection and exposed curb selection. */
function streetSegments(roads:Road[],network?:Map<string,RoadCorridor>){
 const segments:Segment[]=[],grid=new Map<string,Segment[]>(),seen=new Set<string>();
 const make=(p:number[],w:number):Segment=>{
  const key=roadSegmentKey(p),c=streetCorridor(network,p);
  return c?{ax:c.a[0],az:c.a[1],bx:c.b[0],bz:c.b[1],w:c.w,len:c.length,key,corridor:c}:
   {ax:p[0],az:p[1],bx:p[2],bz:p[3],w,len:Math.hypot(p[2]-p[0],p[3]-p[1]),key};
 };
 for(const r of roads)for(let k=2;k<r.p.length;k+=2){
  const s=make(r.p.slice(k-2,k+2),r.w??6);s.sidewalk=streetSidewalk(r);s.clipObstacles=!r.streetSection||r.streetSection.mode==='conflict';s.bridge=!!r.bridge||(r.layer??0)>0;
  if(!Number.isFinite(s.len)||s.len<.01||!Number.isFinite(s.w)||s.w<=0||seen.has(s.key!))continue;
  seen.add(s.key!);segments.push(s);
 }
 // Authored neighbours supplement the actual rendered roads; they must never
 // replace them. Mixed tiles otherwise leave ordinary endcap curbs inside roads.
 // Local geometry takes precedence when a source segment is present in both.
 const indexed=new Map<string,Segment>();
 if(network)for(const c of network.values()){const s=make([...c.a,...c.b],c.w);indexed.set(s.key!,s);}
 for(const s of segments)indexed.set(s.key!,s);
 for(const s of indexed.values()){const {ax,az,bx,bz,w}=s;
  const pad=w*.8+3;
  for(let x=Math.floor((Math.min(ax,bx)-pad)/32);x<=Math.floor((Math.max(ax,bx)+pad)/32);x++)for(let z=Math.floor((Math.min(az,bz)-pad)/32);z<=Math.floor((Math.max(az,bz)+pad)/32);z++){
   const key=x+':'+z;let list=grid.get(key);if(!list){list=[];grid.set(key,list);}list.push(s);
  }
 }
 const nearby=(x:number,z:number)=>grid.get(Math.floor(x/32)+':'+Math.floor(z/32))??[];
 return {segments,nearby};
}
/** Intersection distances measured along one road; ignore nearly parallel continuations. */
export function junctions(s:Segment,others:Segment[]):{distance:number;clearance:number}[]{
 const result:{distance:number;clearance:number}[]=[];
 const dx=s.bx-s.ax,dz=s.bz-s.az;
 for(const q of others){
  if(q===s||(s.key&&q.key===s.key))continue;
  if(!roadJunctionCandidate([s.ax,s.az],[s.bx,s.bz],[q.ax,q.az],[q.bx,q.bz]))continue;
  const ex=q.bx-q.ax,ez=q.bz-q.az,det=dx*ez-dz*ex,sine=Math.abs(det)/(s.len*q.len);
  if(sine<.35)continue;
  const rx=q.ax-s.ax,rz=q.az-s.az,u=(rx*ez-rz*ex)/det,v=(rx*dz-rz*dx)/det;
  if(u<-.001||u>1.001||v<-.001||v>1.001)continue;
  const distance=Math.max(0,Math.min(s.len,u*s.len));
  if((distance<.01&&s.corridor?.startJoined)||(distance>s.len-.01&&s.corridor?.endJoined))continue;
  const clearance=(q.w/2+1)/sine;
  const old=result.find(p=>Math.abs(p.distance-distance)<1);
  if(old)old.clearance=Math.max(old.clearance,clearance);else result.push({distance,clearance});
 }
 return result.sort((a,b)=>a.distance-b.distance);
}
function raisedFootprint(poly:Point[],t:ChunkTerrain,ox:number,oz:number,height:number,bridge=false,clipObstacles=true):number[]{
 const top=terrainFootprint(poly,t,ox,oz,bridge,true,clipObstacles),out:number[]=[];
 const edges=new Map<string,{a:number[];b:number[];count:number}>();
 const key=(p:number[])=>p.map(v=>v.toFixed(5)).join(',');
 for(let i=0;i<top.length;i+=9){
  const points=[top.slice(i,i+3),top.slice(i+3,i+6),top.slice(i+6,i+9)];
  for(const p of points)out.push(p[0],p[1]+height,p[2]);
  for(let e=0;e<3;e++){const a=points[e],b=points[(e+1)%3],k=[key(a),key(b)].sort().join('|'),old=edges.get(k);if(old)old.count++;else edges.set(k,{a,b,count:1});}
 }
 for(const {a,b,count} of edges.values())if(count===1){
  const at=[a[0],a[1]+height,a[2]],bt=[b[0],b[1]+height,b[2]];
  out.push(...a,...b,...bt,...a,...bt,...at);
 }
 return out;
}
function surfaceMaterial(color:string,layer:number,wear=0):THREE.MeshStandardMaterial {
 const material=new THREE.MeshStandardMaterial({color,roughness:layer===3?.97:.9,polygonOffset:true,polygonOffsetFactor:-1-layer,polygonOffsetUnits:-1-layer});
 if(layer===1||layer===3){
  material.onBeforeCompile=shader=>{
   shader.uniforms.roadWear={value:wear};
   shader.vertexShader='attribute vec2 streetCoord; varying vec2 streetUV;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nstreetUV=streetCoord;');
   shader.fragmentShader='uniform float roadWear; varying vec2 streetUV;\n'+STREET_MATERIAL_DETAIL_GLSL+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    diffuseColor.rgb=streetMaterialDetail(diffuseColor.rgb,streetUV,${layer===3?'1.0,0.0':'0.0,1.0'},roadWear);
   `);
  };
  material.customProgramCacheKey=()=> 'street-geometry-common-v2-'+layer;
 }
 return material;
}
const cache=new WeakMap<CityAppearance['street'],THREE.MeshStandardMaterial[]>();
/** Layered opaque footprints form road unions at intersections, with no curb across the carriageway. */
export interface StreetMeshData {layer:number;position:Float32Array;normal:Float32Array;coord:Float32Array;bounds?:{min:number[];max:number[];center:number[];radius:number}}
export function addStreetGeometry(group:THREE.Group,roads:Road[],t:ChunkTerrain,ox:number,oz:number,colors:CityAppearance['street'],prepared?:StreetMeshData[],elevated:ElevatedStreet[]=[]):void {
 let materials=cache.get(colors);
 if(!materials){materials=[colors.curb,colors.pavement,colors.curb,colors.asphalt,colors.center,colors.marking,colors.curb].map((c,i)=>surfaceMaterial(c,i,colors.wearStrength??0));cache.set(colors,materials);}
 const attach=(data:StreetMeshData)=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(data.position,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(data.normal,3));
  geometry.setAttribute('streetCoord',new THREE.BufferAttribute(data.coord,2));
  if(data.bounds){const b=data.bounds;geometry.boundingBox=new THREE.Box3(new THREE.Vector3().fromArray(b.min),new THREE.Vector3().fromArray(b.max));geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3().fromArray(b.center),b.radius);}
  const i=data.layer,mesh=new THREE.Mesh(geometry,materials![i]);
  mesh.name=['street_outer_edge','street_pavement','street_curb','street_asphalt','street_center_lines','street_lane_lines','street_raised_curbs'][i];
  mesh.userData.streetLayer=i;mesh.receiveShadow=true;mesh.renderOrder=i+1;group.add(mesh);
 };
 if(prepared){for(const data of prepared)attach(data);return;}
 const buffers:number[][]=Array.from({length:7},()=>[]);
 if(t.compiledStreet){const plan=t.compiledStreet;for(const m of plan.meshes){const pos=buffers[m.layer];for(let i=0;i<(m.index?.length??m.position.length/3);i++){const k=(m.index?.[i]??i)*3;pos.push(m.position[k]+plan.origin[0]-ox,m.position[k+1],m.position[k+2]+plan.origin[1]-oz);}}}
 let bridge=false,clipObstacles=true;
 const add=(layer:number,poly:Point[])=>{const data=terrainFootprint(poly,t,ox,oz,bridge,true,clipObstacles);for(const value of data)buffers[layer].push(value);};
 const bounds=t.compiledStreet?.bounds,endX=t.cellX0+(t.size-1)*t.step,endZ=t.cellZ0+(t.size-1)*t.step;
 // A fully compiled tile already owns every street surface. Avoid rebuilding
 // thousands of legacy pieces merely to subtract them again.
 const fullyCompiled=!!bounds&&bounds[0]<=t.cellX0&&bounds[1]<=t.cellZ0&&bounds[2]>=endX&&bounds[3]>=endZ;
 const legacyRoads=fullyCompiled?[]:roads;
 const context=legacyRoads.length?streetContext(legacyRoads,!!t.streetPilot):undefined;
 const {segments,nearby}=streetSegments(legacyRoads,context);
 // Baked paint is usable only while its exact source widths remain authoritative.
 const resolvedPaint=context&&context!==pilotRoadNetwork?planRoadMarkings(context,bakedMarkings.settings,(c,p)=>!t.streetPilot||pilotBridgeRoad([...c.a,...c.b])||!pilotInRiver(...p)):undefined;
 const ordinaryNetwork=solveRoadNetwork(segments.filter(s=>!s.corridor).map(s=>({p:[s.ax,s.az,s.bx,s.bz],w:s.w})));
 const ordinaryPaint=planRoadMarkings(ordinaryNetwork);
 for(const segment of segments){
   const {ax,az,bx,bz,len,w}=segment;const sidewalk=segment.sidewalk??0;clipObstacles=segment.clipObstacles??true;bridge=!!segment.bridge||!!t.streetPilot&&pilotBridgeRoad([ax,az,bx,bz]);
   const shape=(width:number)=>segment.corridor?corridorOutline(segment.corridor,width-w):capsule(ax,az,bx,bz,width/2);
   if(sidewalk){add(0,shape(w+sidewalk*2));add(1,shape(w+sidewalk*2));}
   add(2,shape(w+.45));add(3,shape(w));
   const ux=(bx-ax)/len,uz=(bz-az)/len;
   const point=(distance:number,side:number):Point=>segment.corridor?corridorOffsetPoint(segment.corridor,distance,side):[ax+ux*distance-uz*side,az+uz*distance+ux*side];
   if(segment.corridor){
    if(resolvedPaint){for(const m of resolvedPaint.get(segment.key!)??[])add(4,roadPaintCorners(segment.corridor,m));}
    else for(const [start,end,left,right,layer,,endLeft,endRight] of pilotMarkings.get(segment.key!)??[])if(layer===4)add(4,[point(start,left),point(end,endLeft??left),point(end,endRight??right),point(start,right)]);
   }else{
    const c=ordinaryNetwork.get(segment.key!)!;
    for(const m of ordinaryPaint.get(segment.key!)??[])add(4,roadPaintCorners(c,m));
   }
   const height=colors.curbHeight??0;
   if(height>0&&sidewalk){
    const outline=shape(w+.24);
    for(let e=0;e<outline.length;e++){
     const a=outline[e],b=outline[(e+1)%outline.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
     const steps=Math.max(1,Math.ceil(length/1.5)),nx=-(b[1]-a[1])/length*.10,nz=(b[0]-a[0])/length*.10;
     for(let k=0;k<steps;k++){
      const p:Point=[a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps],q:Point=[a[0]+(b[0]-a[0])*(k+1)/steps,a[1]+(b[1]-a[1])*(k+1)/steps];
      const mx=(p[0]+q[0])/2,mz=(p[1]+q[1])/2;
      // Keep the full short section clear of every neighbouring carriageway.
      if(nearby(mx,mz).some(other=>other.key!==segment.key&&[p,q,[mx,mz]].some(v=>other.corridor?insideRoadOutline([v[0],v[1]],corridorOutline(other.corridor,.5)):segmentDistance(v[0],v[1],other)<other.w/2+.25)))continue;
      const data=raisedFootprint([[p[0]-nx,p[1]-nz],[q[0]-nx,q[1]-nz],[q[0]+nx,q[1]+nz],[p[0]+nx,p[1]+nz]],t,ox,oz,height,bridge,clipObstacles);
      for(const value of data)buffers[6].push(value);
     }
    }
   }
 }
 // Bridge decks use exactly the same material, grain coordinates and paint layers as ground roads.
 for(const s of elevated){
  const width=(r:number[])=>Math.hypot(r[3]-r[0],r[5]-r[2]);
  const wa=width(s.a),wb=width(s.b),len=Math.hypot((s.b[0]+s.b[3]-s.a[0]-s.a[3])/2,(s.b[2]+s.b[5]-s.a[2]-s.a[5])/2);
  if(len<.01||wa<=0||wb<=0)continue;
  const point=(t:number,side:number,edge=false)=>{
   const row=s.a.map((v,i)=>v+(s.b[i]-v)*t),w=wa+(wb-wa)*t;
   const f=edge?side:.5-side/w;
   return [row[0]+(row[3]-row[0])*f-ox,row[1]+(row[4]-row[1])*f,row[2]+(row[5]-row[2])*f-oz];
  };
  const quad=(layer:number,a:number[],b:number[],c:number[],d:number[])=>{for(const p of [a,b,c,a,c,d])buffers[layer].push(...p);};
  quad(3,point(0,0,true),point(1,0,true),point(1,1,true),point(0,1,true));
  const half=DEFAULT_MARKINGS.lineWidth/2;
  for(const offset of centerLineOffsets(Math.min(wa,wb)))quad(4,point(0,offset+half),point(1,offset+half),point(1,offset-half),point(0,offset-half));
 }
 buffers.forEach((positions,i)=>{
  if(!positions.length)return;
  const geometry=new THREE.BufferGeometry();
  const position=new Float32Array(positions);
  geometry.setAttribute('position',new THREE.BufferAttribute(position,3));geometry.computeVertexNormals();
  const coord=new Float32Array(position.length/3*2);
  for(let k=0,j=0;k<position.length;k+=3,j+=2){coord[j]=position[k]+ox;coord[j+1]=position[k+2]+oz;}
  attach({layer:i,position,normal:geometry.getAttribute('normal').array as Float32Array,coord});
  geometry.dispose();buffers[i]=[];
 });
}

/** Road markings and raised kerbs are subpixel at long range; keep the actual road surface. */
export function updateStreetDetail(group:THREE.Group,x:number,z:number):void {
 for(const child of group.children){
  const mesh=child as THREE.Mesh,layer=mesh.userData.streetLayer;
  const smallProp=['street_lights','street_tree_trunks'].includes(mesh.name);
  const pilotLimit=mesh.userData.detailDistance as number|undefined;
  if(!pilotLimit&&!smallProp&&(layer===undefined||layer<4))continue;
  if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
  const box=mesh.geometry.boundingBox!;
  const distance=Math.hypot(Math.max(box.min.x-x,0,x-box.max.x),Math.max(box.min.z-z,0,z-box.max.z));
  const limit=pilotLimit??(smallProp?(mesh.visible?1200:1050):(mesh.visible?850:700));
  mesh.visible=distance<limit;
 }
}

/** Transferable road arrays for either worker pipeline. */
export function prepareStreetMeshes(roads:Road[],terrain:ChunkTerrain,ox:number,oz:number,colors:CityAppearance['street'],elevated:ElevatedStreet[]=[]):StreetMeshData[]{
 const group=new THREE.Group();addStreetGeometry(group,roads,terrain,ox,oz,colors,undefined,elevated);
 return group.children.map(child=>{const mesh=child as THREE.Mesh,g=mesh.geometry;g.computeBoundingBox();g.computeBoundingSphere();const data={bounds:{min:g.boundingBox!.min.toArray(),max:g.boundingBox!.max.toArray(),center:g.boundingSphere!.center.toArray(),radius:g.boundingSphere!.radius},layer:mesh.userData.streetLayer as number,position:g.getAttribute('position').array as Float32Array,normal:g.getAttribute('normal').array as Float32Array,coord:g.getAttribute('streetCoord').array as Float32Array};g.dispose();return data;});
}
