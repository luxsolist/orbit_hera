/** Offline-designed street surfaces. Runtime only displays/queries this artifact. */
export interface CompiledStreetPlan {
 version:1; region:string; bounds:number[]; sourceHash:string; compilerVersion:string;
 origin:number[]; meshes:{layer:number;level?:number;position:number[];index?:number[]}[];
 supportVolumes?:{p:number[];holes?:number[][];base:number;top:number;topPlane?:[number,number,number]}[];
 props:{x:number;z:number;tree:boolean}[];
 terrainHeights?:number[]; roadHeights?:number[];
 buildings?:{id:string;p:number[];holes?:number[][];groundClearance?:number}[];
 resolvedSites?:import("./MapData").SiteLandmark[];
 resolvedWater?:import("./MapData").Ring[];
 resolvedBuildings?:import("./MapData").Ring[];
 resolvedStructures?:import("./MapData").Ring[];
 walls?:import("./MapData").Ring[];
}
export function inCompiledStreet(p:CompiledStreetPlan|undefined,x:number,z:number):boolean {
 return !!p&&x>=p.bounds[0]&&x<=p.bounds[2]&&z>=p.bounds[1]&&z<=p.bounds[3];
}
type Triangle={v:number[];layer:number;level:number};
const support=new WeakMap<CompiledStreetPlan,Map<string,Triangle[]>>();
/** Exact same triangles as rendering; grid prevents a per-frame city-wide scan. */
export function compiledStreetHeight(plan:CompiledStreetPlan|undefined,x:number,z:number,feetY=Infinity,level?:number):number|undefined{
 if(!plan||!inCompiledStreet(plan,x,z))return;
 let grid=support.get(plan);
 if(!grid){grid=new Map();for(const m of plan.meshes){if(m.layer!==1&&m.layer!==3)continue;
  for(let i=0;i<(m.index?.length??m.position.length/3);i+=3){const v=[0,1,2].flatMap(k=>{const j=(m.index?.[i+k]??i+k)*3;return m.position.slice(j,j+3);});for(let k=0;k<9;k+=3){v[k]+=plan.origin[0];v[k+2]+=plan.origin[1];}
   const xs=[v[0],v[3],v[6]],zs=[v[2],v[5],v[8]],tri={v,layer:m.layer,level:m.level??0};
   for(let a=Math.floor((Math.min(...xs)-.0002)/16);a<=Math.floor((Math.max(...xs)+.0002)/16);a++)for(let b=Math.floor((Math.min(...zs)-.0002)/16);b<=Math.floor((Math.max(...zs)+.0002)/16);b++){const key=a+':'+b,list=grid.get(key)??[];list.push(tri);grid.set(key,list);}
  }}support.set(plan,grid);
 }
 let highest:number|undefined;
 for(const {v,level:triangleLevel} of grid.get(Math.floor(x/16)+':'+Math.floor(z/16))??[]){
  if(level!==undefined&&triangleLevel!==level)continue;
  const ax=v[0],az=v[2],bx=v[3],bz=v[5],cx=v[6],cz=v[8],det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
  if(Math.abs(det)<1e-9)continue;
  const a=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/det,b=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/det,c=1-a-b;
  // Baked vertices are quantized to 0.1mm. Use a metric edge tolerance;
  // a barycentric constant changes physical tolerance with triangle size.
  if(Math.min(a,b,c)<0){
   if(x<Math.min(ax,bx,cx)-.0002||x>Math.max(ax,bx,cx)+.0002||z<Math.min(az,bz,cz)-.0002||z>Math.max(az,bz,cz)+.0002)continue;
   const edgeDistance=(ux:number,uz:number,vx:number,vz:number)=>{const dx=vx-ux,dz=vz-uz,t=Math.max(0,Math.min(1,((x-ux)*dx+(z-uz)*dz)/(dx*dx+dz*dz||1)));return (x-ux-t*dx)**2+(z-uz-t*dz)**2;};
   if(Math.min(edgeDistance(ax,az,bx,bz),edgeDistance(bx,bz,cx,cz),edgeDistance(cx,cz,ax,az))>.0002**2)continue;
  }
  const h=a*v[1]+b*v[4]+c*v[7];if(feetY<h-.35)continue;highest=Math.max(highest??-Infinity,h);
 }return highest;
}
