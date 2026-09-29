
import {expect,it} from 'vitest';
import {applyMapCorrections} from '../src/world/MapCorrections';
import {regionalDetailMatcher,restoreRegionalArchitecture,seoulArchitectureGeometry} from '../src/world/cities/SeoulDetail';
const p=[0,0,10,0,10,10,0,10];
const detail=(id='relation/123/0',poly=p)=>({id,p:poly,holes:[],name:'Tower',h:236.7,kind:'n-tower',roof:'',heightSource:'osm-height'} as any);
it('binds changed rings through source identity, rejects remote and ambiguous relation parts',()=>{
 const d=detail(),match=regionalDetailMatcher([d]);
 expect(match({osmId:'relation/123',p:[10,10,0,10,0,0,5,0,10,0]})).toBe(d);
 expect(match({osmId:'relation/123',p:p.map(v=>v+100)})).toBeUndefined();
 expect(regionalDetailMatcher([d,detail('relation/123/1',p.map(v=>v+.1))])({osmId:'relation/123',p:p.map(v=>v+.2)})).toBeUndefined();
});
it('repairs completed authored models and classification without altering compiled ground or ordinary structures',()=>{
 const d=detail(),shelter={osmId:'way/2',p:p.map(v=>v+100),h:4,structureKind:'shelter'},palace={...shelter,osmId:'way/3',seoulArchitecture:{...detail('way/3'),kind:'korean',h:8}};
 const c:any={cx:0,cz:0,terrain:{size:2,heights:[0,0,0,0]},compiledStreet:{version:1},objects:{buildings:[{osmId:'relation/123',p:[0,0,5,0,10,0,10,10,0,10],h:9}],structures:[shelter,palace],roads:[],water:[]},mapBuild:{version:1,input:{detail:{buildings:[d]}}}};
 const before=JSON.stringify(c),out=applyMapCorrections([37,126],c,{detail:null,appearance:null,roadGrade:null});
 expect(JSON.stringify(c)).toBe(before);expect(out.terrain).toBe(c.terrain);expect(out.compiledStreet).toBe(c.compiledStreet);expect(out.mapBuild).toBe(c.mapBuild);expect(out.objects.roads).toBe(c.objects.roads);
 expect(out.objects.buildings).toHaveLength(2);expect(out.objects.structures).toEqual([shelter]);expect(out.objects.buildings[1].structureKind).toBeUndefined();
 const tower=out.objects.buildings[0];expect(tower.h).toBe(236.7);expect(tower.seoulArchitecture).toBe(d);
 const g=seoulArchitectureGeometry(tower,0,0,0)!;g.computeBoundingBox();expect(g.boundingBox!.max.y).toBeCloseTo(236.7,1);expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);g.dispose();
 expect(restoreRegionalArchitecture(out)).toBe(out);expect(restoreRegionalArchitecture(c)).toBe(out);
});
