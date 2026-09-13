/** NOAA fractional-year approximation: UTC instant, east-positive longitude.
 * https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 */
export interface CityClock {latitude:number;longitude:number;timeZone:string}
const rad=Math.PI/180;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function solarState(date:Date,city:CityClock){
 const year=date.getUTCFullYear(),start=Date.UTC(year,0,1),days=(Date.UTC(year+1,0,1)-start)/86400000;
 const day=Math.floor((date.getTime()-start)/86400000),hour=date.getUTCHours()+date.getUTCMinutes()/60+date.getUTCSeconds()/3600;
 const g=2*Math.PI/days*(day+(hour-12)/24);
 const eq=229.18*(.000075+.001868*Math.cos(g)-.032077*Math.sin(g)-.014615*Math.cos(2*g)-.040849*Math.sin(2*g));
 const dec=.006918-.399912*Math.cos(g)+.070257*Math.sin(g)-.006758*Math.cos(2*g)+.000907*Math.sin(2*g)-.002697*Math.cos(3*g)+.00148*Math.sin(3*g);
 const ha=(hour*60+eq+4*city.longitude)/4*rad-Math.PI,lat=city.latitude*rad;
 const x=-Math.cos(dec)*Math.sin(ha),y=Math.sin(lat)*Math.sin(dec)+Math.cos(lat)*Math.cos(dec)*Math.cos(ha);
 const z=Math.sin(lat)*Math.cos(dec)*Math.cos(ha)-Math.cos(lat)*Math.sin(dec);
 const elevation=Math.asin(Math.max(-1,Math.min(1,y)))/rad;
 const dayLight=smooth(-6,18,elevation),twilight=smooth(-8,0,elevation)*(1-smooth(6,22,elevation));
 return {x,y,z,elevation,dayLight,twilight,night:1-smooth(-6,3,elevation)};
}
/** Resolve the selected civil hour on today's date in the city's IANA timezone. */
export function cityDateAtHour(now:Date,hour:number,timeZone:string):Date {
 const parts=(date:Date)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 const p=parts(now),target=Date.UTC(+p.year,+p.month-1,+p.day,0,Math.round(hour*60));
 let guess=target;
 for(let i=0;i<3;i++){const q=parts(new Date(guess));guess+=target-Date.UTC(+q.year,+q.month-1,+q.day,+q.hour,+q.minute,+q.second);}
 return new Date(guess);
}
