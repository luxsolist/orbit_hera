import {it,expect} from 'vitest';
import {buildChunkMesh,disposeChunkGroup} from '../src/world/chunkMesh';
import {facadeStyle} from '../src/world/BuildingFacade';
import {BuildingCombat} from '../src/world/BuildingCombat';
import type {WorldChunk} from '../src/world/chunkManifest';
const chunk:WorldChunk={cx:0,cz:0,terrain:null,underground:null,objects:{buildings:[{p:[10,10,30,10,30,30,10,30],h:12},{p:[60,10,90,10,90,30,60,30],h:70}],roads:[],water:[]}};
it('selects all four dimensional archetypes',()=>{
 expect([facadeStyle(9,200),facadeStyle(30,300),facadeStyle(90,800),facadeStyle(8,1200)]).toEqual([0,1,2,3]);
});
it('preserves shell geometry and collision heights through decoration and collapse',()=>{
 const plain=buildChunkMesh(chunk,1024,0,0),dressed=buildChunkMesh(chunk,1024,0,0,true);
 expect(dressed.buildings.map(b=>[b.poly,b.top,b.baseY])).toEqual(plain.buildings.map(b=>[b.poly,b.top,b.baseY]));
 const geometry=dressed.buildingMesh!.geometry,pos=geometry.getAttribute('position');
 expect(geometry.getAttribute('facadePosition').count).toBe(pos.count);
 for(let i=0;i<2;i++)expect(dressed.buildings[i].vCount).toBe(plain.buildings[i].vCount);
 const second=dressed.buildings[1],saved=Array.from(pos.array).slice(second.vStart*3);
 const first=dressed.buildings[0],bc=new BuildingCombat();
 bc.registerBuilding(dressed.buildingMesh!,first.vStart,first.vCount,first.poly,first.baseY,first.top);
 bc.damage(bc.nearestTarget(20,20,100)!.id,1e9);for(let i=0;i<50;i++)bc.update(.1);
 for(let i=0;i<first.vCount;i++)expect(pos.getY(first.vStart+i)).toBeLessThan(first.baseY);
 expect(Array.from(pos.array).slice(second.vStart*3)).toEqual(saved);
 disposeChunkGroup(plain.group);disposeChunkGroup(dressed.group);
});
it('facade patterns stay stable when the streaming origin changes',()=>{
 const a=buildChunkMesh(chunk,1024,0,0,true),b=buildChunkMesh(chunk,1024,100,200,true);
 const av=a.buildingMesh!.geometry.getAttribute('facadePosition').array,bv=b.buildingMesh!.geometry.getAttribute('facadePosition').array;
 expect(Array.from(a.buildingMesh!.geometry.getAttribute('color').array)).toEqual(Array.from(b.buildingMesh!.geometry.getAttribute('color').array));
 expect(av.length).toBe(bv.length);for(let i=0;i<av.length;i++)expect(av[i]).toBeCloseTo(bv[i],4);
 disposeChunkGroup(a.group);disposeChunkGroup(b.group);
});
