/** Highest ground under a footprint: its vertices and an interior grid (terrain can crest inside). */
function footprintGround(ground,p){
 const xs=p.filter((_,i)=>i%2===0),zs=p.filter((_,i)=>i%2===1);
 let y=Math.max(...xs.map((x,i)=>ground(x,zs[i])??0));
 const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs),step=Math.max(4,Math.min(16,Math.max(x1-x0,z1-z0)/8));
 for(let x=x0+step/2;x<x1;x+=step)for(let z=z0+step/2;z<z1;z+=step)if(insideRing(p,x,z))y=Math.max(y,ground(x,z)??y);
 return y;
}
function insideRing(p,x,z){let c=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){const xi=p[i],zi=p[i+1],xj=p[j],zj=p[j+1];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;}

/** Continuous inferred upper-road profile; source layer is ordering, not metres. */
// Deck triangles span ~10m; holding the roof level past its edge keeps their
// interpolation from dipping under the roof near the outline.
const ROOF_PLATEAU=16;
/** roofGround: roof bases use the highest ground model, so no model sees the deck under a roof. */
export function createElevatedStreetSampler(ground,roofs=[],roofGround=ground){
 const cell=128,grid=new Map();
 for(const r of roofs){
  const xs=r.p.filter((_,i)=>i%2===0),zs=r.p.filter((_,i)=>i%2===1);
  const b={x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};
  const y=footprintGround(roofGround,r.p)+r.h+.15,margin=ROOF_PLATEAU+Math.max(30,r.h*6);
  const item={...b,y};
  for(let x=Math.floor((b.x0-margin)/cell);x<=Math.floor((b.x1+margin)/cell);x++)for(let z=Math.floor((b.z0-margin)/cell);z<=Math.floor((b.z1+margin)/cell);z++){const k=x+':'+z,list=grid.get(k)??[];list.push(item);grid.set(k,list);}
 }
 return (x,z,level)=>{
  const base=ground(x,z)??0;let y=base+5;
  for(const r of grid.get(Math.floor(x/cell)+':'+Math.floor(z/cell))??[]){const d=Math.hypot(Math.max(r.x0-x,0,x-r.x1),Math.max(r.z0-z,0,z-r.z1));y=Math.max(y,r.y-Math.max(0,d-ROOF_PLATEAU)/6);}
  return y+(Math.max(1,level)-1)*5;
 };
}

export const DECK_HEADROOM=6; // m above the deck surface to the volume resuming over it
/**
 * Deck-split volumes (street_compile split_deck_towers) get their slot from the baked
 * deck heights: the upper volume resumes DECK_HEADROOM above the highest deck point
 * relative to every ground model, and the podium stays below the lowest one.
 */
export function fitDeckSlots(buildings=[],deckHeight,grounds){
 const slots=new Map();
 for(const b of buildings)if(b.deckStrips&&b.passageRole==='upper-volume'){
  let high=-Infinity,low=Infinity;
  for(const s of b.deckStrips){
   const xs=s.p.filter((_,i)=>i%2===0),zs=s.p.filter((_,i)=>i%2===1),points=xs.map((x,i)=>[x,zs[i]]);
   const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
   for(let x=x0+1;x<x1;x+=3)for(let z=z0+1;z<z1;z+=3)if(insideRing(s.p,x,z))points.push([x,z]);
   for(const [x,z] of points){const y=deckHeight(x,z,s.level);for(const g of grounds){const base=g(x,z);if(base==null)continue;high=Math.max(high,y-base);low=Math.min(low,y-base);}}
  }
  if(Number.isFinite(high))slots.set(b.deckSplit,{top:Math.round((high+.15+DECK_HEADROOM)*100)/100,floor:Math.round((low-.3)*100)/100,h:b.h});
 }
 return buildings.flatMap(b=>{
  const slot=slots.get(b.deckSplit);if(!slot)return [b];
  const top=Math.max(slot.top,b.passageRole==='upper-volume'?b.groundClearance:0);
  if(b.passageRole==='upper-volume')return top<b.h-1?[{...b,groundClearance:top}]:[];
  if(b.passageRole==='ground-pier')return [{...b,h:Math.min(top,slot.h)}];
  // Podium (and its ground passage) stay under the deck.
  const h=Math.min(b.h,slot.floor);return h>(b.groundClearance??0)+.5?[{...b,h}]:[];
 });
}
