import * as THREE from 'three';
import type {Cell,WorldChunk} from '../chunkManifest';
import type {Ring} from '../MapData';
export interface LandmarkAppearance {p:number[];source:string|null;height:number|null;levels:number|null;roofShape:string;roofHeight:number|null;wallColor:string|null;roofColor:string|null;wallMaterial:string|null;buildingType:string|null;status:string;}
export interface LandmarkAppearancePatch {version:number;buildings:LandmarkAppearance[];}
export function applySeoulLandmarkAppearance(cell:Cell,raw:WorldChunk,patch:LandmarkAppearancePatch|null):WorldChunk {
 if(cell[0]!==37||cell[1]!==126||patch?.version!==1||!Array.isArray(patch.buildings))return raw;
 const matches=new Map(patch.buildings.map(d=>[JSON.stringify(d.p),d]));
 return {...raw,objects:{...raw.objects,buildings:raw.objects.buildings.map(b=>{
  if(!b.lm||b.statueModel||b.landmarkModel||b.palaceBuildingId||b.seoulArchitecture)return b;
  const d=matches.get(JSON.stringify(b.p));if(!d)return b;
  const height=d.height??(d.levels!=null?d.levels*3.3:null);
  return {...b,landmarkAppearance:d,...(height!=null&&height>0&&height<830?{h:height,heightSource:d.height!=null?'osm-height' as const:'levels-estimate' as const}:{})};
 })}};
}
/** Source-tagged roof silhouette, only on a reliably rectangular footprint.
 * Complex footprints retain their source shell; we never cover courtyards with a box.
 */
export function landmarkRoof(b:Ring,p:number[],base:number,top:number):{geometry:THREE.BufferGeometry;height:number}|null {
 const d=b.landmarkAppearance;if(!d||b.holes?.length||!['gabled','hipped','pyramidal'].includes(d.roofShape))return null;
 let longest=0,angle=0,area=0;
 for(let i=0;i<p.length;i+=2){const j=(i+2)%p.length,dx=p[j]-p[i],dz=p[j+1]-p[i+1],length=dx*dx+dz*dz;area+=p[i]*p[j+1]-p[j]*p[i+1];if(length>longest){longest=length;angle=Math.atan2(dz,dx);}}
 const c=Math.cos(angle),s=Math.sin(angle),xs:number[]=[],zs:number[]=[];
 for(let i=0;i<p.length;i+=2){xs.push(p[i]*c+p[i+1]*s);zs.push(-p[i]*s+p[i+1]*c);}
 const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),W=(maxX-minX)/2,D=(maxZ-minZ)/2;
 if(W<1||D<1||Math.abs(area)*.5/(W*D*4)<.94)return null;
 const height=Math.min(d.roofHeight??Math.min(W,D)*.48,(top-base)*.35,8);if(height<=0)return null;
 const ridge=d.roofShape==='gabled'?W:d.roofShape==='hipped'?W*.55:0,low=top-height,u=(minX+maxX)/2,v=(minZ+maxZ)/2;
 const a=[-W,low,-D],bb=[W,low,-D],cc=[W,low,D],dd=[-W,low,D],r0=[-ridge,top,0],r1=[ridge,top,0];
 const vertices=[...a,...r0,...r1,...a,...r1,...bb,...dd,...cc,...r1,...dd,...r1,...r0,...a,...dd,...r0,...bb,...r1,...cc];
 for(let i=0;i<vertices.length;i+=3){const x=vertices[i]+u,z=vertices[i+2]+v;vertices[i]=x*c-z*s;vertices[i+2]=x*s+z*c;}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();
 return {geometry,height};
}
