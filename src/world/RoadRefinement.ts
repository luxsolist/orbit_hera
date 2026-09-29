import type {WorldChunk} from './chunkManifest';
export interface RoadRefinement {version:1;size:number;source:string;deltas:[number,number][]}
/** Fingerprint final coarse land, street and source road topology. */
export function refinementSource(c:WorldChunk):string {
 let h=2166136261;const add=(v:number)=>{h=Math.imul(h^(Math.round(v*10000)|0),16777619);};
 add(c.cx);add(c.cz);add(c.terrain.size);
 for(const v of c.terrain.heights)add(v);for(const v of c.roadHeights??c.terrain.heights)add(v);
 for(const r of c.objects.roads){add(r.w??6);add(r.bridge?1:0);add(r.tunnel?1:0);add(r.layer??0);for(const v of r.p)add(v);}
 return (h>>>0).toString(16);
}
/** Same diagonal as the terrain mesh, rather than bilinear interpolation. */
export function subdivideHeights(values:readonly number[],from:number,to:number):number[]{
 const out:number[]=[];
 for(let z=0;z<to;z++)for(let x=0;x<to;x++){
  const gx=x/(to-1)*(from-1),gz=z/(to-1)*(from-1),i=Math.min(from-2,Math.floor(gx)),j=Math.min(from-2,Math.floor(gz)),fx=gx-i,fz=gz-j;
  const a=values[j*from+i],b=values[j*from+i+1],c=values[(j+1)*from+i],d=values[(j+1)*from+i+1];
  out.push(fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz));
 }return out;
}
/** Replace the terrain lattice. No second ground mesh or independent collision surface. */
export function applyRoadRefinement(c:WorldChunk,r:RoadRefinement|undefined):WorldChunk{
 if(!r||r.version!==1||c.roadRefinementSource===r.source)return c;
 if(r.size!==129||c.terrain.size!==33||refinementSource(c)!==r.source||!Array.isArray(r.deltas)||!r.deltas.length)return c;
 const n=r.size,ids=new Set<number>();
 if(!r.deltas.every(([i,d])=>{const x=i%n,z=Math.floor(i/n),valid=Number.isInteger(i)&&!ids.has(i)&&x>=4&&x<n-4&&z>=4&&z<n-4&&Number.isFinite(d)&&Math.abs(d)<=8.001;ids.add(i);return valid;}))return c;
 const heights=subdivideHeights(c.terrain.heights,c.terrain.size,n),roadHeights=subdivideHeights(c.roadHeights??c.terrain.heights,c.terrain.size,n);
 for(const [i,d] of r.deltas){heights[i]+=d;roadHeights[i]+=d;}
 return {...c,roadRefinementSource:r.source,terrain:{...c.terrain,size:n,heights},roadHeights};
}
