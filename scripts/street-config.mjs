import {readFileSync,existsSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
/** Shared policy resolution; missing cities must never silently skip street design. */
export function streetRegions(city,selected,options={}){
 const registry=read('config/street-regions.json')[city];
 if(!registry)throw Error('No street design registered for '+city);
 const names=selected?[selected]:Object.keys(registry).filter(k=>registry[k].enabled!==false);
 if(!names.length)throw Error('No enabled street design for '+city);
 if(options.requireCityCoverage&&!names.some(k=>registry[k]?.coverage==='manifest'))throw Error('Only pilot coverage registered for '+city+'; full city build is not validated');
 const profiles=read('config/street-profiles.json');
 return Object.fromEntries(names.map(name=>{
  const region=registry[name];if(!region)throw Error('Unknown street region: '+city+'/'+name);
  const profile=profiles[region.profile??'default'];if(!profile)throw Error('Unknown street profile: '+region.profile);
  const cfg={...profiles.default,...profile,...region};
  for(const key of ['sidewalk','buildingClearance','medianJoin','propSpacing','centerlineMinWidth','pedestrianWidth'])if(!Number.isFinite(cfg[key])||cfg[key]<0)throw Error('Invalid street policy '+key);
  if(options.requireSource&&!existsSync(process.env.MAP_OSM_PBF??cfg.source))throw Error('Missing OSM extract: '+cfg.source);
  if(cfg.coverage!=='manifest'&&(!Array.isArray(cfg.bounds)||cfg.bounds.length!==4||!cfg.bounds.every(Number.isFinite)||cfg.bounds[0]>=cfg.bounds[2]||cfg.bounds[1]>=cfg.bounds[3]))throw Error('Invalid street bounds');
  if(cfg.refreshObjects&&cfg.coverage!=='manifest'&&cfg.bounds.some(v=>v%1024!==0))throw Error('Source refresh requires complete chunk coverage');
  return [name,cfg];
 }));
}
