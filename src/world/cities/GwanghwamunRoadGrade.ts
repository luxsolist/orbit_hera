import type {Cell,WorldChunk} from '../chunkManifest';
// Local DEM repair at Sejong-daero/Jong-ro, south of Admiral Yi.
// Approximate grade from surrounding low samples, not surveyed absolute elevation.
const centerX=86300,centerZ=47845;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function gwanghwamunRoadGrade(x:number,z:number):number {
 return 41-(z-centerZ)*.008+(x-centerX)*.002;
}
export function correctGwanghwamunRoadGrade(cell:Cell,raw:WorldChunk,chunkSize=1024):WorldChunk {
 if(cell[0]!==37||cell[1]!==126)return raw;
 const x0=raw.cx*chunkSize,z0=raw.cz*chunkSize;
 if(Math.hypot(Math.max(x0-centerX,0,centerX-x0-chunkSize),Math.max(z0-centerZ,0,centerZ-z0-chunkSize))>=480)return raw;
 const t=raw.terrain,n=t.size,heights=t.heights.slice();let changed=false;
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  const x=x0+i*chunkSize/(n-1),z=z0+j*chunkSize/(n-1),dx=x-centerX,dz=z-centerZ;
  // Cover both carriageways, sidewalks and the terrain triangles crossing their edges.
  const side=Math.min(Math.abs(dx),Math.abs(dz));
  const weight=(1-smooth(64,144,side))*(1-smooth(260,480,Math.hypot(dx,dz)));
  if(weight<=0)continue;
  heights[j*n+i]+=(gwanghwamunRoadGrade(x,z)-heights[j*n+i])*weight;changed=true;
 }
 return changed?{...raw,terrain:{...t,heights}}:raw;
}
