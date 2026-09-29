import {readMapFixture} from './mapFixture';
import {terrainFootprint} from '../src/world/StreetGeometry';
import {it,expect} from 'vitest';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {applyMapCorrections} from '../src/world/MapCorrections';
import {applyCheonggyePilot,CHEONGGYE_PILOT as recipe,inPilot,channelDistance,pilotStreetHeight,pilotGroundHeight,pilotInRiver,pilotBridgeAt,pilotSupportHeight} from '../src/world/cities/CheonggyePilot';
import {chunkTerrainEntry,sampleChunkHeight,buildingGroundRange,buildChunkMesh,disposeChunkGroup} from '../src/world/chunkMesh';
import {paintedSeoul} from '../src/world/cities/painted';
const read=(p:string)=>readMapFixture(p);
function load(cx:number,cz:number){const raw=read(`public/maps/37/126/5_2/${cx}_${cz}.json`),overlays={roadGrade:read(`public/maps/road-grade/37/126/${cx}_${cz}.json`),detail:read(`public/maps/details/seoul/${cx}_${cz}.json`),appearance:read(`public/maps/landmark-appearance/seoul/${cx}_${cz}.json`)};// This suite covers the legacy terrain recipe; compiled mesh gates run separately.
delete overlays.roadGrade.streetPlan;return {raw,before:applyMapCorrections([37,126],raw,overlays,{streetPilot:false}),after:applyMapCorrections([37,126],raw,overlays)};}
it('repairs the entire pilot, retains the channel and continuous seams, without mutating source or other cities',()=>{
 const loaded=[load(84,46),load(85,46),load(84,47),load(85,47)];
 let roads=0,beforeMax=0,afterMax=0,buriedBefore=0,buildings=0,gradeBefore=0,gradeAfter=0,allRoadGrade=0;let worstRoad:number[]=[];
 for(const {raw,before,after} of loaded){
  const snapshot=JSON.stringify(before);expect(applyCheonggyePilot([37,126],after)).toBe(after);expect(applyCheonggyePilot([35,129],raw)).toBe(raw);expect(JSON.stringify(before)).toBe(snapshot);
  const b=chunkTerrainEntry(before,1024)!,a=chunkTerrainEntry(after,1024)!;
  if(after.cx===85&&after.cz===46){const poly:[number,number][]=[[87300,47800],[87400,47800],[87400,47820],[87300,47820]];const face=terrainFootprint(poly,a,0,0,false,true,false);expect(face.length%9).toBe(0);expect(face.length).toBeGreaterThan(0);let area=0;for(let i=0;i<face.length;i+=9)area+=Math.abs((face[i+3]-face[i])*(face[i+8]-face[i+2])-(face[i+6]-face[i])*(face[i+5]-face[i+2]))/2;expect(area).toBeCloseTo(2000,2);for(let i=0;i<face.length;i+=3)expect(face[i+1]).toBeCloseTo(sampleChunkHeight(a,face[i],face[i+2]),4);}
  for(const r of raw.objects.roads)for(let i=2;i<r.p.length;i+=2){const [ax,az,bx,bz]=r.p.slice(i-2,i+2),len=Math.hypot(bx-ax,bz-az);if(len<1)continue;
   for(let d=8;d<len;d+=8){const p=[ax+(bx-ax)*(d-8)/len,az+(bz-az)*(d-8)/len],q=[ax+(bx-ax)*d/len,az+(bz-az)*d/len];if(inPilot(...p as [number,number])&&inPilot(...q as [number,number])&&[p,q].every(([x,z])=>!pilotInRiver(x,z)||pilotBridgeAt(x,z))){const g=Math.abs(pilotSupportHeight(...q as [number,number])-pilotSupportHeight(...p as [number,number]))/8;if(g>allRoadGrade){allRoadGrade=g;worstRoad=q;}}if(!inPilot(...p as [number,number])||!inPilot(...q as [number,number])||Math.min(channelDistance(...p as [number,number]),channelDistance(...q as [number,number]))<32)continue;
    roads++;const old=Math.abs(sampleChunkHeight(b,...q as [number,number])-sampleChunkHeight(b,...p as [number,number]))/8,next=Math.abs(sampleChunkHeight(a,...q as [number,number])-sampleChunkHeight(a,...p as [number,number]))/8;gradeBefore=Math.max(gradeBefore,old);gradeAfter=Math.max(gradeAfter,next);
   }
  }
  for(const building of before.objects.buildings){const p=building.p as number[],x=p.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0)/(p.length/2),z=p.filter((_,i)=>i%2===1).reduce((a,b)=>a+b,0)/(p.length/2);if(!p.every((_,i)=>i%2||inPilot(p[i],p[i+1]))||channelDistance(x,z)<35)continue;
   const old=buildingGroundRange(b,p),next=buildingGroundRange(a,p),occlusion=old.max-sampleChunkHeight(b,x,z);buildings++;if(occlusion>1)buriedBefore++;
   // Pilot roof starts a full h above the maximum foundation contact, not the centroid.
   beforeMax=Math.max(beforeMax,old.max-old.min);afterMax=Math.max(afterMax,next.max-next.min);
  }
 }
 expect(roads).toBeGreaterThan(100);expect(buildings).toBeGreaterThan(100);expect(gradeAfter).toBeLessThan(.05);expect(gradeAfter).toBeLessThan(gradeBefore);expect(afterMax).toBeLessThan(beforeMax);
 for(const [left,right,axis] of [[0,1,'x'],[2,3,'x'],[0,2,'z'],[1,3,'z']] as const){const a=loaded[left].after,b=loaded[right].after,n=a.terrain.size;let delta=0;for(let i=0;i<n;i++){const av=axis==='x'?a.terrain.heights[i*n+n-1]:a.terrain.heights[(n-1)*n+i],bv=axis==='x'?b.terrain.heights[i*n]:b.terrain.heights[i];delta=Math.max(delta,Math.abs(av-bv));}expect(delta).toBeLessThan(.01);}
 const middle=recipe.channel.find(([x])=>x>recipe.center[0]+100)!;expect(pilotStreetHeight(...middle as [number,number])-pilotGroundHeight(...middle as [number,number])).toBeGreaterThan(4);
 const report={allRoadGrade,worstRoad,roadSamples:roads,buildings,maximumRoadGradeBefore:gradeBefore,maximumRoadGradeAfter:gradeAfter,maximumBuildingGroundRangeBefore:beforeMax,maximumBuildingGroundRangeAfter:afterMax,centroidFoundationBurialOver1mBefore:buriedBefore,foundationPolicy:'Full height above highest footprint contact',recipeBytes:Buffer.byteLength(JSON.stringify(recipe)),recipeGzipBytes:gzipSync(JSON.stringify(recipe)).length,terrainSamplesPerAffectedChunk:loaded[0].after.terrain.heights.length};
 mkdirSync('build',{recursive:true});writeFileSync('build/cheonggye-pilot-audit.json',JSON.stringify(report,null,2));console.log(report);
 expect(allRoadGrade).toBeLessThan(.05);
},30000);
it('builds the pilot using the game mesh path with finite geometry and a full exposed building height',()=>{
 const {after}=load(85,46),started=performance.now(),mesh=buildChunkMesh(after,1024,85*1024,46*1024,paintedSeoul);expect(mesh.group.children.some(c=>c.name==='pilot_street_details')).toBe(true);console.log({pilotChunkBuildMs:Math.round(performance.now()-started),meshes:mesh.group.children.length});
 for(const b of mesh.buildings){const p=b.poly.flatMap((v,i)=>[v+(i%2?46:85)*1024]),x=p[0],z=p[1];if(p.every((_,i)=>i%2||inPilot(p[i],p[i+1]))&&channelDistance(x,z)>35){expect(b.top-buildingGroundRange(mesh.terrain,p).max).toBeGreaterThan(0);}}
 mesh.group.traverse((o:any)=>{const a=o.geometry?.attributes.position?.array;if(a)expect(a.every((v:number)=>Number.isFinite(v))).toBe(true);});disposeChunkGroup(mesh.group);
},60000);
