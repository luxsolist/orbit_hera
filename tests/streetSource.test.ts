import {it,expect} from 'vitest';
import {collectStreetSource,refreshStreetObjects} from '../scripts/street-source.mjs';
import {streetRegions} from '../scripts/street-config.mjs';
const project=(x:number,z:number)=>[x,z];
it('rejects unregistered cities before any map mutation',()=>{expect(()=>streetRegions('unregistered')).toThrow('No street design');expect(streetRegions('rome',undefined,{requireCityCoverage:true})['city-wide'].coverage).toBe('manifest');});
it('preserves courtyard and separates pedestrian area from vehicle carriageway',()=>{
 const source=collectStreetSource([{type:'way',id:1,tags:{highway:'pedestrian',area:'yes'},geometry:[{lat:0,lon:0},{lat:10,lon:0},{lat:10,lon:10},{lat:0,lon:0}]},{type:'way',id:2,tags:{highway:'primary',bridge:'yes',layer:'1'},geometry:[{lat:0,lon:0},{lat:20,lon:20}]},{type:'way',id:3,tags:{building:'yes','min_height':'4',height:'12'},geometry:[{lat:10,lon:10},{lat:20,lon:10},{lat:20,lon:20},{lat:10,lon:10}]}],project);
 expect(source.walking[0].area).toBe(true);expect(source.roads).toHaveLength(1);expect(source.roads[0]).toMatchObject({bridge:true,layer:1});expect(source.buildings[0]).toMatchObject({osmId:'way/3',groundClearance:4});
 const c=refreshStreetObjects({cx:0,cz:0,objects:{roads:[],buildings:[],water:[],walls:[]}},source);expect(c.objects.buildings[0].groundClearance).toBe(4);expect(c.objects.roads[0].osmId).toBe('way/2');
});
it('selects historic street rules as data without city-specific compiler code',()=>{for(const city of ['rome','athens'])expect(streetRegions(city)['city-wide']).toMatchObject({sidewalk:1.5,refreshObjects:true});});

it('keeps a museum site as a landmark without treating its grounds as a solid building',()=>{
 const source={roads:[],walking:[],buildings:[{osmId:'way/2',p:[10,10,20,10,20,20],h:10}],roles:{'way/1':'site'}};
 const chunk={cx:0,cz:0,terrain:{heights:[3]},objects:{buildings:[{osmId:'way/1',p:[0,0,100,0,100,100],h:22,lm:'archive',n:'museum',seoulArchitecture:{kind:'rome-courtyard'}}],roads:[]}};
 const result=refreshStreetObjects(chunk,source);expect(result.objects.buildings.map(b=>b.osmId)).toEqual(['way/2']);expect(result.objects.sites[0]).toMatchObject({osmId:'way/1',n:'museum',lm:'archive'});
});

it('preserves an elevated outline inside an aggregate building relation',()=>{
 const geometry=[{lat:0,lon:0},{lat:10,lon:0},{lat:10,lon:3},{lat:0,lon:3},{lat:0,lon:0}];
 const source=collectStreetSource([{type:'way',id:1,tags:{building:'bridge',layer:'1'},geometry},{type:'relation',id:2,tags:{type:'building',building:'university'},members:[{type:'way',ref:'1',role:'outline',geometry}]}],project);
 expect(source.buildings.find(b=>b.osmId==='relation/2').groundClearance).toBe(5);
});
it('retains explicit car wash access evidence for shared passage classification',()=>{
 const source=collectStreetSource([{type:'way',id:3,tags:{building:'service',amenity:'car_wash'},geometry:[{lat:0,lon:0},{lat:10,lon:0},{lat:10,lon:10},{lat:0,lon:0}]}],project);
 expect(source.buildings[0].vehiclePassage).toBe(true);
});

it('refreshes water from the same source and preserves crossing semantics',()=>{
 const source=collectStreetSource([{type:'way',id:8,tags:{waterway:'stream',width:'4'},geometry:[{lat:5,lon:0},{lat:5,lon:30}]},{type:'way',id:9,tags:{highway:'path',ford:'yes',level:'0;1',incline:'up'},geometry:[{lat:0,lon:10},{lat:20,lon:10}]},{type:'way',id:10,tags:{waterway:'stream',tunnel:'culvert'},geometry:[{lat:6,lon:0},{lat:6,lon:30}]}],project);
 const chunk=refreshStreetObjects({cx:0,cz:0,objects:{buildings:[],roads:[],water:[{p:[0,0,20,0],w:24}]}},source);
 expect(chunk.objects.water).toHaveLength(1);expect(chunk.objects.water[0]).toMatchObject({osmId:'way/8',w:4,waterInfo:{kind:'stream',widthSource:'tag'}});
 expect(source.walking[0]).toMatchObject({ford:'yes',level:'0;1',incline:'up'});
});
it('does not close an open platform edge into a solid footprint',()=>{
 const source=collectStreetSource([{type:'way',id:11,tags:{public_transport:'platform',railway:'platform_edge'},geometry:[{lat:0,lon:0},{lat:20,lon:0},{lat:20,lon:3},{lat:30,lon:3}]}],project);
 expect(source.buildings).toHaveLength(0);
});

it('retains an explicitly elevated building floor independently of road layer',()=>{
 const source=collectStreetSource([{type:'way',id:3,tags:{building:'yes',level:'1'},geometry:[{lat:0,lon:0},{lat:10,lon:0},{lat:10,lon:10},{lat:0,lon:0}]}],project);
 expect(source.buildings[0]).toMatchObject({groundClearance:3.3,clearanceSource:'level',sourceLevel:'1'});
});
