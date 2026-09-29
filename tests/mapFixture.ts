import {readFileSync,existsSync} from 'node:fs';
/** Algorithm regressions use preserved clean inputs; completed chunks are tested separately. */
export function readMapFixture(path:string):any {
 if(existsSync(path)){const data=JSON.parse(readFileSync(path,'utf8'));return data.mapBuild?.input.raw??data;}
 const m=path.match(/public\/maps\/(road-grade\/\d+\/\d+|details\/[a-z-]+|landmark-appearance\/[a-z-]+)\/(-?\d+)_(-?\d+)\.json$/);
 if(!m)return null;const x=Number(m[2]),z=Number(m[3]);const catalog=JSON.parse(readFileSync('public/maps/index.json','utf8'));const city=catalog.find((v:any)=>v.id===m[1].split('/')[1]+'-stream');const cell=m[1].startsWith('road-grade')?m[1].slice('road-grade/'.length):city?Math.floor(city.lat)+'/'+Math.floor(city.lon):null;if(!cell)return null;const c=JSON.parse(readFileSync('public/maps/'+cell+'/'+Math.floor(x/16)+'_'+Math.floor(z/16)+'/'+x+'_'+z+'.json','utf8'));
 if(!c.mapBuild)return null;const field=m[1].startsWith('road-grade')?'roadGrade':m[1].startsWith('details')?'detail':'appearance';
 const value=c.mapBuild.input[field];
 if(field!=='roadGrade'||!c.compiledStreet)return value;
 return {...value,streetPlan:{...c.compiledStreet,terrainHeights:c.terrain.heights,roadHeights:c.roadHeights,resolvedBuildings:c.objects.buildings,resolvedStructures:c.objects.structures,resolvedWater:c.objects.water,walls:c.objects.walls}};
}
