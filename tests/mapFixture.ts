import {readFileSync,existsSync} from 'node:fs';
/** Algorithm regressions use preserved clean inputs; completed chunks are tested separately. */
export function readMapFixture(path:string):any {
 if(existsSync(path)){const data=JSON.parse(readFileSync(path,'utf8'));return data.mapBuild?.input.raw??data;}
 const m=path.match(/public\/maps\/(road-grade\/37\/126|details\/seoul|landmark-appearance\/seoul)\/(-?\d+)_(-?\d+)\.json$/);
 if(!m)return null;const x=Number(m[2]),z=Number(m[3]);const c=JSON.parse(readFileSync('public/maps/37/126/'+Math.floor(x/16)+'_'+Math.floor(z/16)+'/'+x+'_'+z+'.json','utf8'));
 if(!c.mapBuild)return null;const field=m[1].startsWith('road-grade')?'roadGrade':m[1].startsWith('details')?'detail':'appearance';
 const value=c.mapBuild.input[field];
 if(field!=='roadGrade'||!c.compiledStreet)return value;
 return {...value,streetPlan:{...c.compiledStreet,terrainHeights:c.terrain.heights,roadHeights:c.roadHeights,resolvedBuildings:c.objects.buildings,resolvedStructures:c.objects.structures,resolvedWater:c.objects.water,walls:c.objects.walls}};
}
