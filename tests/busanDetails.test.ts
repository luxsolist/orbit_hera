import {it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {applyRoadGradePatch} from '../src/world/RoadGradePatch';
import {applyBusanDetail} from '../src/world/cities/BusanDetail';
import {seoulArchitectureGeometry,type SeoulDetail} from '../src/world/cities/SeoulDetail';
import {busanBridgeGeometry,busanBridgeApproachGeometry,type BusanBridgeApproach} from '../src/world/cities/BusanBridges';
import {cellLocalOf,type WorldChunk} from '../src/world/chunkManifest';
import index from '../src/world/cities/busan-detail-index.json';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const detail=(k:string)=>read(`public/maps/details/busan/${k}.json`) as SeoulDetail;
const raw=(k:string)=>{const [x,z]=k.split('_').map(Number);return read(`public/maps/35/129/${Math.floor(x/16)}_${Math.floor(z/16)}/${k}.json`) as WorldChunk;};
it('covers every geocoded Busan landmark, including western negative-x map tiles',()=>{
 expect(index.targets).toHaveLength(19);
 for(const t of index.targets){const p=cellLocalOf(t.lat,t.lon,[35,129]);expect(index.chunks,t.name).toContain(`${Math.floor(p.x/1024)}_${Math.floor(p.z/1024)}`);expect(t.sha256).toMatch(/^[0-9a-f]{64}$/);}
 for(const key of index.chunks){expect(raw(key)).toBeTruthy();expect(detail(key).terrain.every(([i,y])=>Number.isInteger(i)&&y===-.5)).toBe(true);}
});
it('preserves original map, unknown heights, terrain and other cities',()=>{
 for(const key of index.chunks){const a=raw(key),d=detail(key),before=JSON.stringify(a);expect(applyBusanDetail([37,126],a,d)).toBe(a);
 const b=applyBusanDetail([35,129],a,d);expect(JSON.stringify(a)).toBe(before);const changes=new Map(d.terrain);for(let i=0;i<a.terrain.heights.length;i++)expect(b.terrain.heights[i]).toBe(changes.get(i)??a.terrain.heights[i]);expect(applyBusanDetail([35,129],b,d)).toBe(b);
 for(const entry of d.buildings)if(entry.h==null){const shape=JSON.stringify(entry.p);expect(b.objects.buildings.find(v=>JSON.stringify(v.p)===shape)?.h).toBe(a.objects.buildings.find(v=>JSON.stringify(v.p)===shape)?.h);}
 }
});
it('builds finite source-aligned models with one 120m tower and separate bridges',()=>{
 let tower=0,models=0,bridges=0;
 for(const key of index.chunks){const a=applyBusanDetail([35,129],raw(key),detail(key));
  for(const b of a.objects.buildings){if(!b.seoulArchitecture)continue;const g=seoulArchitectureGeometry(b,a.cx*1024,a.cz*1024,0)!;
   expect(g,b.n).toBeTruthy();expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);g.computeBoundingBox();expect(g.boundingBox!.max.y).toBeLessThan(500);
   if(b.seoulArchitecture.kind==='busan-tower'){tower++;expect(g.boundingBox!.max.y).toBeCloseTo(120,2);}g.dispose();models++;
  }
  for(const bridge of detail(key).bridges??[]){const g=busanBridgeGeometry(bridge,a.cx*1024,a.cz*1024);expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);expect(g.getAttribute('position').count).toBeLessThan(100000);g.dispose();bridges++;}
 }expect(tower).toBe(1);expect(models).toBeGreaterThan(80);expect(bridges).toBe(2);
});

it('keeps coastline correction continuous across streamed tile borders',()=>{
 const chunks=new Map(index.chunks.map(k=>[k,applyBusanDetail([35,129],raw(k),detail(k))]));
 for(const c of chunks.values()){const n=c.terrain.size,e=chunks.get(`${c.cx+1}_${c.cz}`),s=chunks.get(`${c.cx}_${c.cz+1}`);
  for(let i=0;i<n;i++){if(e)expect(c.terrain.heights[i*n+n-1]).toBeCloseTo(e.terrain.heights[i*n],2);if(s)expect(c.terrain.heights[(n-1)*n+i]).toBeCloseTo(s.terrain.heights[i],2);}
 }
});


it('connects all six bridge deck ends to ground with continuous streamed approach surfaces',()=>{
 const routes=new Map<string,BusanBridgeApproach[]>();
 for(const k of index.chunks)for(const a of detail(k).bridgeApproaches??[]){
  const list=routes.get(a.id)??[];list.push(a);routes.set(a.id,list);
  const [x,z]=k.split('_').map(Number);const g=busanBridgeApproachGeometry(a,x*1024,z*1024);
  expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);
  expect(g.getAttribute('normal').getY(0)).toBeGreaterThan(.9);g.dispose();
 }
 expect(routes.size).toBe(6);
 const audit=read('public/maps/details/busan/bridge-approach-audit.json');
 for(const [id,segments] of routes){
  segments.sort((a,b)=>a.segment-b.segment);
  for(let i=1;i<segments.length;i++){expect(segments[i].segment).toBe(i);expect(segments[i].a).toEqual(segments[i-1].b);}
  const record=audit.find((r:{id:string})=>r.id===id);expect(record.maxGrade).toBeLessThan(.06);
  const [,bridgeId,level,side]=id.split('/');const bridge=index.chunks.flatMap(k=>detail(k).bridges??[]).find(b=>b.id===`way/${bridgeId}`)!;
  const first=segments[0].a;const direction=Number(side);const deck=bridge.deck-(bridge.tower&&level==='1'?8:0)+.08;
  expect((first[0]+first[3])/2).toBeCloseTo(bridge.x+Math.cos(bridge.angle)*direction*bridge.length/2,3);
  expect((first[2]+first[5])/2).toBeCloseTo(bridge.z+Math.sin(bridge.angle)*direction*bridge.length/2,3);
  expect(first[1]).toBeCloseTo(deck,3);expect(first[4]).toBeCloseTo(deck,3);
  expect(segments.at(-1)!.b).toEqual(record.landing);
  for(const offset of [0,3]){
   const x=record.landing[offset],z=record.landing[offset+2],key=`${Math.floor(x/1024)}_${Math.floor(z/1024)}`;
   const c=applyBusanDetail([35,129],raw(key),detail(key));const path=`public/maps/road-grade/35/129/${key}.json`;
   const t=applyRoadGradePatch(c,existsSync(path)?read(path):null).terrain,n=t.size,h=t.heights;
   const gx=(x-c.cx*1024)*(n-1)/1024,gz=(z-c.cz*1024)*(n-1)/1024,ix=Math.min(n-2,Math.floor(gx)),iz=Math.min(n-2,Math.floor(gz)),fx=gx-ix,fz=gz-iz;
   const a=h[iz*n+ix],b=h[iz*n+ix+1],cc=h[(iz+1)*n+ix],d=h[(iz+1)*n+ix+1];
   const ground=fx+fz<=1?a+(b-a)*fx+(cc-a)*fz:d+(cc-d)*(1-fx)+(b-d)*(1-fz);
   expect(record.landing[offset+1]).toBeCloseTo(ground+.025,2);
  }

  // A genuine map road must be present within the landing width, not an endpoint in the sea.
  const [lx,lz]=record.landingCenter;const k=`${Math.floor(lx/1024)}_${Math.floor(lz/1024)}`;
  const distance=(p:number[])=>{let best=Infinity;for(let i=2;i<p.length;i+=2){const ax=p[i-2],az=p[i-1],dx=p[i]-ax,dz=p[i+1]-az;const t=Math.max(0,Math.min(1,((lx-ax)*dx+(lz-az)*dz)/(dx*dx+dz*dz||1)));best=Math.min(best,Math.hypot(lx-ax-t*dx,lz-az-t*dz));}return best;};
  expect(Math.min(...raw(k).objects.roads.map(r=>distance(r.p)))).toBeLessThan(.01);
 }
});
