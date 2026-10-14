// Visual review of elevated roads: render the worst audited spots with the game's own renderer.
//
//   npm run maps:review-decks -- <city> [--url http://localhost:5173] [--limit 4] [--out build/review/<city>]
//
// Needs the dev server (npm run dev) and a fresh audit (npm run maps:audit-roads -- <city>) plus,
// for the tallest approach ramps, a repair report (build/<city>-deck-repair.json). Picks the worst
// deck-above and road-above steps, the tallest approach lifts and the highest floating ends, then
// opens the city viewer with ?review and shoots each spot from two aerial sides and one low angle.
// Numbers say where to look; these pictures say whether the street reads as a natural street.
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {loadMapCities,selectMapCities} from './map-city-config.mjs';

const args=process.argv.slice(2),flag=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const positional=args.filter((a,i)=>!a.startsWith('--')&&!['--url','--limit','--out'].includes(args[i-1]));
const cities=await loadMapCities(),[city]=selectMapCities(cities,positional[0]);
const [lat0,lon0]=cities[city],url=flag('--url')??'http://localhost:5173',limit=Number(flag('--limit')??4),out=flag('--out')??`build/review/${city}`;
const auditPath=`build/${city}-elevated-audit.json`,repairPath=`build/${city}-deck-repair.json`;
if(!existsSync(auditPath))throw new Error(`${auditPath} missing — run npm run maps:audit-roads -- ${city} first`);
const audit=JSON.parse(readFileSync(auditPath,'utf8')).decks,repair=existsSync(repairPath)?JSON.parse(readFileSync(repairPath,'utf8')):undefined;

const sites=[],far=p=>sites.every(s=>Math.hypot(s.x-p.x,s.z-p.z)>250);
const take=(list,label,value)=>{let n=0;for(const p of list??[]){if(n>=limit)break;if(far(p)){sites.push({id:`${label}${n}-${Math.round(value(p))}m`,x:p.x,z:p.z});n++;}}};
take(audit.steps?.filter(s=>!s.roadAbove),'step',p=>p.step);
take(audit.steps?.filter(s=>s.roadAbove),'roadAbove',p=>p.step);
take(repair?.approach?.tallest,'lift',p=>p.step);
take(audit.floating,'float',p=>p.height);

mkdirSync(out,{recursive:true});
const mapId=`${city}-stream`,browser=await chromium.launch({args:['--use-gl=angle','--enable-gpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),shots=[];
try{
 await page.goto(`${url}/tools/asset-editor.html?review#city`);
 await page.waitForFunction(()=>window.cityReview,null,{timeout:120000});
 // Settled = no chunk fetch pending for three seconds.
 const settle=async()=>{let ok=0;for(let i=0;i<240&&ok<6;i++){await page.waitForTimeout(500);ok=await page.evaluate(()=>window.cityReview.pending())===0?ok+1:0;}await page.waitForTimeout(1500);};
 for(const s of sites){
  const lat=lat0+1-s.z/111320,lon=lon0+s.x/(111320*Math.cos((lat0+.5)*Math.PI/180));
  try{
   await page.evaluate(([c,a,b])=>window.cityReview.open(c,a,b,'day'),[mapId,lat,lon]);
   for(const [i,v] of [{d:70,h:40,a:0},{d:70,h:40,a:Math.PI},{d:45,h:8,a:Math.PI/2}].entries()){
    const ty=await page.evaluate(()=>window.cityReview.heightAt(0,0)),cx=Math.sin(v.a)*v.d,cz=Math.cos(v.a)*v.d;
    const cy=Math.max(await page.evaluate(([x,z])=>window.cityReview.heightAt(x,z,.5),[cx,cz]),0)+v.h;
    await page.evaluate(([x,y,z,yaw,pitch])=>window.cityReview.view(x,y,z,yaw,pitch),[cx,cy,cz,Math.atan2(cx,cz),Math.atan2(ty-cy,Math.hypot(cx,cz))]);
    await settle();
    const file=`${out}/${s.id}-${i}.png`;await page.locator('.stage canvas').screenshot({path:file});shots.push(file);
   }
  }catch(e){console.error(`skipped ${s.id}: ${e.message}`);}
 }
}finally{await browser.close();}
writeFileSync(`${out}/sites.json`,JSON.stringify(sites.map(s=>({...s,lat:+(lat0+1-s.z/111320).toFixed(6),lon:+(lon0+s.x/(111320*Math.cos((lat0+.5)*Math.PI/180))).toFixed(6)})),null,1));
console.log(JSON.stringify({city,sites:sites.length,shots:shots.length,out}));
