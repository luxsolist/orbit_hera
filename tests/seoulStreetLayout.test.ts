import {readMapFixture} from './mapFixture';
import {it,expect} from 'vitest';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import * as THREE from 'three';
import {applyMapCorrections} from '../src/world/MapCorrections';
import {chunkTerrainEntry,disposeChunkGroup} from '../src/world/chunkMesh';
import {addStreetGeometry} from '../src/world/StreetGeometry';
import {streetPropSites} from '../src/world/StreetProps';
import {paintedSeoul} from '../src/world/cities/painted';
import {streetContext} from '../src/world/StreetLayout';
import {roadSegmentKey} from '../src/world/RoadNetwork';
import {pilotRoadNetwork,inPilot,channelDistance} from '../src/world/cities/CheonggyePilot';
const read=(p:string)=>readMapFixture(p);
function covers(mesh:THREE.Mesh,ox:number,oz:number){
 const p=mesh.geometry.getAttribute('position'),grid=new Map<string,number[]>();
 for(let i=0;i<p.count;i+=3){const xs=[0,1,2].map(k=>p.getX(i+k)),zs=[0,1,2].map(k=>p.getZ(i+k));
  for(let x=Math.floor(Math.min(...xs)/16);x<=Math.floor(Math.max(...xs)/16);x++)for(let z=Math.floor(Math.min(...zs)/16);z<=Math.floor(Math.max(...zs)/16);z++){const key=x+','+z,v=grid.get(key)??[];v.push(i);grid.set(key,v);}
 }
 return (wx:number,wz:number)=>{const x=wx-ox,z=wz-oz;return (grid.get(Math.floor(x/16)+','+Math.floor(z/16))??[]).some(i=>{
  const ax=p.getX(i),az=p.getZ(i),bx=p.getX(i+1),bz=p.getZ(i+1),cx=p.getX(i+2),cz=p.getZ(i+2),det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(det)<1e-8)return false;
  const a=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/det,b=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/det;return Math.min(a,b,1-a-b)>=-1e-6;
 });};
}
it('keeps final street widths, visible sidewalks and furniture consistent across the four pilot tiles',()=>{
 let sites=0,targetSites=0;
 for(const [cx,cz] of [[84,46],[85,46],[84,47],[85,47]]){
  const key=cx+'_'+cz,c=applyMapCorrections([37,126],read(`public/maps/37/126/5_2/${key}.json`),{roadGrade:read(`public/maps/road-grade/37/126/${key}.json`),detail:read(`public/maps/details/seoul/${key}.json`),appearance:read(`public/maps/landmark-appearance/seoul/${key}.json`)});
  const terrain=chunkTerrainEntry(c,1024)!,g=new THREE.Group(),ox=cx*1024,oz=cz*1024;
  addStreetGeometry(g,c.objects.roads,terrain,ox,oz,paintedSeoul.street);
  const asphalt=covers(g.getObjectByName('street_asphalt') as THREE.Mesh,ox,oz),pavement=covers(g.getObjectByName('street_pavement') as THREE.Mesh,ox,oz);
  for(const p of streetPropSites(c,1024,{...paintedSeoul.props,enabled:true,trees:true,lamps:true,maxPerChunk:160,spacing:26,minSpacing:19,offset:1.4})){
   if(!inPilot(p.x,p.z)||channelDistance(p.x,p.z)<26)continue;
   expect(asphalt(p.x,p.z),`furniture inside asphalt ${p.x},${p.z}`).toBe(false);
   expect(pavement(p.x,p.z),`furniture outside sidewalk ${p.x},${p.z}`).toBe(true);
   for(const dx of [-.85,.85])for(const dz of [-.85,.85])expect(asphalt(p.x+dx,p.z+dz),`planter overlaps asphalt ${p.x},${p.z}`).toBe(false);
   sites++;if(Math.hypot(p.x-87224.595,p.z-47765.742)<70)targetSites++;
  }
  if(cx===85&&cz===46){
   // The source-derived regional builder relocates the sidewalk to the outside
   // of the shared carriageway; obsolete per-way sidewalk coordinates are not a contract.
   for(const x of [87213,87238]){
    expect(pavement(x,47753.24782)).toBe(true);expect(asphalt(x,47753.24782)).toBe(false);
   }
   for(let x=87217;x<=87234;x++)expect(asphalt(x,47753.24782)).toBe(true);
  }
  disposeChunkGroup(g);
 }
 expect(sites).toBeGreaterThan(100);expect(targetSites).toBeGreaterThan(3);
 mkdirSync('build',{recursive:true});writeFileSync('build/seoul-street-layout-audit.json',JSON.stringify({tiles:4,sites,targetSites,renderedAsphaltConflicts:0,missingSidewalkSites:0,sharedCarriagewayContinuous:true},null,2));
},60000);

it('rendering cannot restore stale recipe width after a later common width correction',()=>{
 const roads=[{p:[87224,47823,87220,47715],w:6}],ox=85*1024,oz=46*1024;
 const terrain={size:33,step:32,cellX0:ox,cellZ0:oz,heights:new Float32Array(1089).fill(38),streetPilot:true};
 const g=new THREE.Group();addStreetGeometry(g,roads,terrain,ox,oz,paintedSeoul.street);
 const asphalt=covers(g.getObjectByName('street_asphalt') as THREE.Mesh,ox,oz),pavement=covers(g.getObjectByName('street_pavement') as THREE.Mesh,ox,oz);
 const c=pilotRoadNetwork.get(roadSegmentKey(roads[0].p))!,nx=-(c.b[1]-c.a[1])/c.length,nz=(c.b[0]-c.a[0])/c.length,x=(c.a[0]+c.b[0])/2,z=(c.a[1]+c.b[1])/2;
 expect(c.w).toBeGreaterThanOrEqual(6);
 expect(asphalt(x,z)).toBe(true);
 for(const side of [-1,1]){expect(asphalt(x+nx*3.6*side,z+nz*3.6*side)).toBe(false);expect(pavement(x+nx*3.6*side,z+nz*3.6*side)).toBe(true);}
 disposeChunkGroup(g);
});

it('keeps rendered asphalt and pavement outside buildings at 37.569006,126.987573',()=>{
 const c=applyMapCorrections([37,126],read('public/maps/37/126/5_2/85_46.json'),{roadGrade:read('public/maps/road-grade/37/126/85_46.json'),detail:read('public/maps/details/seoul/85_46.json'),appearance:read('public/maps/landmark-appearance/seoul/85_46.json')});
 const ox=85*1024,oz=46*1024,g=new THREE.Group();addStreetGeometry(g,c.objects.roads,chunkTerrainEntry(c,1024)!,ox,oz,paintedSeoul.street);
 const asphalt=covers(g.getObjectByName('street_asphalt') as THREE.Mesh,ox,oz),pavement=covers(g.getObjectByName('street_pavement') as THREE.Mesh,ox,oz);
 const x=87218.58974305524,z=47978.25207999982;let samples=0,buildings=0;
 const inside=(x:number,z:number,p:number[])=>{let hit=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)if((p[i+1]>z)!==(p[j+1]>z)&&x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i])hit=!hit;return hit;};
 for(const b of c.objects.buildings){if(!b.p.some((v,i)=>i%2===0&&Math.hypot(v-x,b.p[i+1]-z)<32))continue;buildings++;
  const xs=b.p.filter((_,i)=>i%2===0),zs=b.p.filter((_,i)=>i%2===1);
  for(let a=Math.min(...xs)+.25;a<Math.max(...xs);a+=.5)for(let d=Math.min(...zs)+.25;d<Math.max(...zs);d+=.5){if(!inside(a,d,b.p))continue;samples++;
   expect(asphalt(a,d),`asphalt enters ${b.osmId} at ${a},${d}`).toBe(false);expect(pavement(a,d),`pavement enters ${b.osmId} at ${a},${d}`).toBe(false);
  }
 }
 expect(buildings).toBeGreaterThan(5);expect(samples).toBeGreaterThan(500);
 // A useful continuous road must remain, not simply disappear to pass the overlap test.
 for(let d=-15;d<=15;d++)expect(asphalt(87230,z+d)).toBe(true);
 writeFileSync('build/seoul-street-section-target.json',JSON.stringify({coordinate:[37.569006,126.987573],buildings,samples,asphaltBuildingConflicts:0,pavementBuildingConflicts:0},null,2));disposeChunkGroup(g);
},60000);
