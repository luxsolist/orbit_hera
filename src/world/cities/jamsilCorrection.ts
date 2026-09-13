import spec from './jamsil-correction.json';
import type {Cell,WorldChunk} from '../chunkManifest';
const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
function distance(x:number,z:number,s:number[]){const dx=s[2]-s[0],dz=s[3]-s[1],d=dx*dx+dz*dz;const t=d?Math.max(0,Math.min(1,((x-s[0])*dx+(z-s[1])*dz)/d)):0;return Math.hypot(x-s[0]-dx*t,z-s[1]-dz*t)-s[4]/2;}
/** Explicit local repair, shared by terrain preloading, rendering and collision.
 * Road elevation is a DEM-derived estimate, not a surveyed road profile.
 */
export function correctJamsilChunk(cell:Cell,raw:WorldChunk,chunkSize=1024):WorldChunk {
 if(cell[0]!==spec.cell[0]||cell[1]!==spec.cell[1])return raw;
 const [cx,cz]=spec.center;
 const x0=raw.cx*chunkSize,z0=raw.cz*chunkSize;
 if(Math.hypot(Math.max(x0-cx,0,cx-x0-chunkSize),Math.max(z0-cz,0,cz-z0-chunkSize))>spec.outerRadius)return raw;
 const candidates=raw.objects.buildings.filter(b=>{
  if(b.h!==spec.towerHeight)return false;
  let x=0,z=0;for(let i=0;i<b.p.length;i+=2){x+=b.p[i];z+=b.p[i+1];}
  return Math.hypot(x/(b.p.length/2)-cx,z/(b.p.length/2)-cz)<spec.towerRadius;
 });
 const area=(p:number[])=>{let a=0;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)a+=p[j]*p[i+1]-p[i]*p[j+1];return Math.abs(a)/2;};
 const outline=candidates.reduce<typeof candidates[number]|undefined>((best,b)=>!best||area(b.p)>area(best.p)?b:best,undefined);
 // Apply only to the known malformed cluster, never arbitrary neighboring high-rises.
 const repair=candidates.length>0;
 const keep=outline&&area(outline.p)>=spec.towerMinArea?outline:undefined;
 const marker=candidates.find(b=>b.lm);
 const consolidated=repair?raw.objects.buildings.filter(b=>!candidates.includes(b)||b===keep).map(b=>b===keep?{...b,h:spec.towerHeight,lm:marker?.lm??'relay' as const,n:marker?.n??'Lotte World Tower'}:b):raw.objects.buildings;
 const buildings=consolidated.map(b=>{
  const fix=spec.heightOverrides.find(f=>f.cx===raw.cx&&f.cz===raw.cz&&b.h===f.expectedHeight&&f.poly.length===b.p.length&&f.poly.every((v,i)=>v===b.p[i]));
  return fix?{...b,h:fix.height}:b;
 });
 const t=raw.terrain,n=t.size,heights=[...t.heights];
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  const x=x0+i*chunkSize/(n-1),z=z0+j*chunkSize/(n-1),r=Math.hypot(x-cx,z-cz);
  if(r>=spec.outerRadius)continue;
  let d=Infinity;for(const s of spec.roads)d=Math.min(d,distance(x,z,s));
  const weight=(1-smooth(spec.innerRadius,spec.outerRadius,r))*(1-smooth(32,96,d));
  heights[j*n+i]+=(spec.roadHeight-heights[j*n+i])*weight;
 }
 return {...raw,terrain:{...t,heights},objects:{...raw.objects,buildings}};
}
