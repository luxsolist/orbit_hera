// Elevated vehicle decks — one height profile and one structure generator for every city.
//
// Used by the street bake (new builds) and by repair-elevated-decks.mjs (already completed
// chunks), so a rebuilt city and a repaired city get the same geometry from the same rules.
//
// Height rules (the source `layer` is stacking order, never metres):
//  1. Upper bound: one DECK_CLEARANCE above the terrain, plus one more for each lower deck
//     actually running underneath at that point — never `layer × 5 m`. The caller's own bound
//     (roof plateau / previously baked height) caps it further.
//  2. Required clearance only where something lies underneath: an at-grade carriageway, water,
//     or a lower deck. A building never lifts a deck: riding a roof left decks hanging between
//     towers at roof height; a deck over a building passes it at its own height (split towers
//     are refit around it).
//  2b. A `layer`-only way (no bridge tag) is not a bridge: Korean estate roads carry layer=1 over
//     their underground car parks. It holds a required clearance (or the bridge it continues)
//     for LAYER_HOLD, then returns to grade at RAMP_GRADE instead of staying up between portals.
//  3. Every portal — a deck end joining an at-grade road — descends to that road at RAMP_GRADE.
//     An interior dead end descends to the terrain (a deck never stops in mid-air).
//  4. Where a portal ramp would undercut a required clearance, the ramp steepens up to MAX_GRADE.
//     A clearance that still cannot be met is reported as a conflict, never hidden.
import {DECK_SLAB_DEPTH} from '../src/world/treeClearance.mjs';
export {DECK_SLAB_DEPTH};
export const DECK_CLEARANCE=5;   // m per stacking level
export const RAMP_GRADE=.08;     // descent toward a portal
export const MAX_GRADE=.15;      // steepest ramp kept to hold clearance over a crossing
export const NODE_STEP=8;        // m between profile samples
export const PORTAL_LIFT=.05;
export const PORTAL_REACH=1.5;
export const ELEVATED_GAP=1.5;   // m — a deck end this close to another elevated piece continues onto it (OSM topology gap)   // m — a deck end this close to an at-grade centreline (or within its half width) joins it    // m above the joined carriageway (no coplanar fighting)
export const STREAM_CLEARANCE_MIN=1.5; // m over a narrow linear waterway (a footbridge over a 6 m stream is not a flyover)
/** Clearance over a linear waterway of width w: grows with the channel, never above DECK_CLEARANCE. */
export const streamClearance=(w)=>Math.min(DECK_CLEARANCE,Math.max(STREAM_CLEARANCE_MIN,w/4));
export const UNDER_STEP=4;        // m between street-under samples along a deck
export const UNDER_OVERLAP=1;     // m the deck and street slabs must overlap to count as stacked
export const UNDER_MIN_WIDTH=3;   // m — narrower ways (footways) under a deck do not hold it up
export const UNDER_MAX_SIN=Math.sin(30*Math.PI/180); // streets within 30° of the deck heading run along it
export const UNDER_END_REACH=15;  // m before a true deck end where it may come down regardless
export const CROSSING_REACH_SLACK=2; // m of a crossing clearance the approach ramps may absorb beyond the 8 % portal cone
export const PIER_SPACING=30;    // m along a deck centreline
export const PIER_SIZE=1.4;      // m square column
export const PIER_MIN_CLEARANCE=3.5;
export const DECK_STRUCTURE_VERSION=3; // 3: roads cut through no building (clearBuildingsOfRoads)
export const LAYER_HOLD=15;     // m a layer-only way stays at a clearance / joined bridge before returning to grade
export const DECK_HEADROOM=6;    // m above the deck to a split tower's upper volume (street-elevation.mjs)
const KEY=.5;
/** Numeric vertex key (0.5 m grid): no per-vertex string allocation on million-vertex cities. */
export const nodeKey=(x,z)=>(Math.round(x/KEY)+2e6)*1e7+(Math.round(z/KEY)+2e6);

class SegmentGrid{
 constructor(cell=32){this.cell=cell;this.cells=new Map();}
 add(seg){const c=this.cell,x0=Math.min(seg.a.x,seg.b.x)-seg.reach,x1=Math.max(seg.a.x,seg.b.x)+seg.reach,z0=Math.min(seg.a.z,seg.b.z)-seg.reach,z1=Math.max(seg.a.z,seg.b.z)+seg.reach;
  for(let i=Math.floor(x0/c);i<=Math.floor(x1/c);i++)for(let j=Math.floor(z0/c);j<=Math.floor(z1/c);j++){const k=i+':'+j;(this.cells.get(k)??this.cells.set(k,[]).get(k)).push(seg);}}
 near(x,z){return this.cells.get(Math.floor(x/this.cell)+':'+Math.floor(z/this.cell))??[];}
}
function project(seg,x,z){const dx=seg.b.x-seg.a.x,dz=seg.b.z-seg.a.z,l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-seg.a.x)*dx+(z-seg.a.z)*dz)/l));return {t,d:Math.hypot(x-seg.a.x-t*dx,z-seg.a.z-t*dz)};}

/**
 * @param o.lines        elevated centrelines [{p:[x,z,...], level, w, bridge}] (cell metres, every piece;
 *                       bridge defaults to true)
 * @param o.groundKeys   Set of nodeKey() for every at-grade road vertex (portal detection)
 * @param o.onGroundRoad optional (x,z) → true when a deck end lies on an at-grade carriageway
 *                       without sharing a vertex (a T-junction onto the middle of a road segment)
 * @param o.portalHeight (x,z) → at-grade carriageway surface at a portal (undefined → terrain)
 * @param o.terrain      (x,z) → land height
 * @param o.bound        (x,z,level) → caller's upper bound (roof plateau / baked height)
 * @param o.beneath      (x,z,level,w) → clearance (m above the terrain) needed by what lies under, or undefined
 * @param o.aim          (x,z,level,w) → clearance wanted but never forced (water): it rises only as far as
 *                       the portal ramps reach, so it never leaves a step at a portal
 * @param o.interior     (x,z) → false near the map's data edge (dead ends there are clipped, not stubs)
 */
export function createDeckProfile(o){
 const terrain=(x,z)=>o.terrain(x,z)??0,nodes=[],edges=[],touches=new Map(),vertexNode=new Map();
 let lineLevel=1,lineBridge=true,lineId=0;
 const link=(a,b)=>{const d=Math.hypot(a.x-b.x,a.z-b.z);a.edges.push([b,d]);b.edges.push([a,d]);edges.push({a,b,level:lineLevel,len:d,line:lineId});};
 const lines=o.lines.map((l,src)=>({...l,src})).filter(l=>l.p.length>=4).map(l=>({...l,level:Math.max(1,l.level|0),w:l.w??8,bridge:l.bridge!==false}));
 for(const line of lines){
  const p=line.p,chain=[];lineLevel=line.level;lineBridge=line.bridge;lineId=line.src;
  for(let i=0;i<p.length;i+=2){
   // Source vertices merge across pieces: seams share ends, and a ramp joins its mainline
   // at one of the mainline's interior vertices.
   const end=i===0||i===p.length-2,key=nodeKey(p[i],p[i+1]);
   let node=vertexNode.get(key);
   if(!node){node={x:p[i],z:p[i+1],level:line.level,w:line.w,bridge:line.bridge,edges:[],end,src:line.src};nodes.push(node);vertexNode.set(key,node);}
   else{node.level=Math.min(node.level,line.level);node.end||=end;node.bridge||=line.bridge;}
   touches.set(key,(touches.get(key)??0)+1);
   const prev=chain.at(-1);
   if(prev){const n=Math.ceil(Math.hypot(node.x-prev.x,node.z-prev.z)/NODE_STEP);let last=prev;
    for(let k=1;k<n;k++){const t=k/n,mid={x:prev.x+(node.x-prev.x)*t,z:prev.z+(node.z-prev.z)*t,level:line.level,w:line.w,bridge:line.bridge,edges:[],src:line.src};nodes.push(mid);link(last,mid);last=mid;}
    link(last,node);}
   chain.push(node);
  }
  line.nodes=chain;
 }
 // Topology gaps: an end that stops just short of another elevated piece (no shared vertex)
 // continues onto it — it is neither a portal nor a dead end, and heights flow across the gap.
 const gapGrid=new SegmentGrid();for(const e of edges)gapGrid.add({a:e.a,b:e.b,reach:ELEVATED_GAP});
 for(const n of nodes){if(!n.end||(touches.get(nodeKey(n.x,n.z))??0)>1)continue;let best,bd=ELEVATED_GAP;
  for(const sg of gapGrid.near(n.x,n.z)){if(sg.a===n||sg.b===n||n.edges.some(([m])=>m===sg.a||m===sg.b))continue;const {t,d}=project(sg,n.x,n.z);if(d<=bd){bd=d;best=t<.5?sg.a:sg.b;}}
  if(best){const d=Math.hypot(best.x-n.x,best.z-n.z);n.edges.push([best,d]);best.edges.push([n,d]);n.joined=true;if(best.end)best.joined=true;}}
 // Process levels upward: a deck's stacking bound reads the final heights of the decks below it.
 const segments=new SegmentGrid(),levels=[...new Set(nodes.map(n=>n.level))].sort((a,b)=>a-b);
 // Any overlap of the two slabs stacks them: a centreline-only test let a wide upper deck sink onto
 // the edge of a narrower one running beside its axis. Near a junction where a deck branches off
 // a lower one the slabs overlap by design; there only the centreline test applies.
 const junctions=new SegmentGrid();
 for(const n of nodes)for(const [m] of n.edges)if(m.level<n.level)junctions.add({a:m,b:m,reach:48,j:m});
 const nearJunction=(n,s)=>junctions.near(n.x,n.z).some(({j})=>Math.hypot(j.x-n.x,j.z-n.z)<=s.w/2+n.w/2+NODE_STEP&&project(s,j.x,j.z).d<=.5);
 const lowerDeckTop=(n)=>{let top;for(const s of segments.near(n.x,n.z)){if(s.level>=n.level)continue;const {t,d}=project(s,n.x,n.z);
   if(d>s.w/2+n.w/2||d>s.w/2+n.w/2*.25+.5&&nearJunction(n,s)||continues(n,s)||pastEnd(n,s))continue;const y=s.a.h+(s.b.h-s.a.h)*t;top=Math.max(top??-Infinity,y);}return top;};
 // A lower piece ending at the vertex where this deck carries on (OSM raising `layer` mid-bridge,
 // or a branch's own junction) is the same road, not one passing underneath.
 const isJunction=m=>m.edges.some(([k])=>k.level>m.level);
 // Only beside a segment, never off its ends: past an interior vertex the next segment answers,
 // and past a piece's last vertex there is no deck underneath (a round cap there stacked a deck
 // continuing straight on at a higher OSM layer 5 m above itself).
 const pastEnd=(n,s)=>{const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,t=((n.x-s.a.x)*dx+(n.z-s.a.z)*dz)/(dx*dx+dz*dz||1);return t<-.01||t>1.01;};
 const continues=(n,s)=>[s.a,s.b].some(j=>isJunction(j)&&Math.hypot(j.x-n.x,j.z-n.z)<=s.w/2+n.w/2+NODE_STEP);
 const conflicts=[];let weldedNodes=0;
 for(const level of levels){
  const group=nodes.filter(n=>n.level===level);
  for(const n of group){
   n.ground=terrain(n.x,n.z);
   // The cap reads the land around the slab, not the point under the axis: on a hillside two welded
   // carriageways each followed their own strip of slope and met as a fold across the junction.
   const r=Math.max(GROUND_SPAN,n.w/2),ring=[0,1,2,3,4,5,6,7].map(k=>terrain(n.x+r*Math.cos(k*Math.PI/4),n.z+r*Math.sin(k*Math.PI/4))).filter(Number.isFinite);
   const land=(n.ground+ring.reduce((a,b)=>a+b,0))/(1+ring.length);
   const below=lowerDeckTop(n),stack=Math.max(land,below??-Infinity)+DECK_CLEARANCE;
   const bound=n.bound=o.bound?o.bound(n.x,n.z,n.level):Infinity,stackTop=o.beneathLine?.(n.x,n.z,n.src);let under=o.beneath?.(n.x,n.z,n.level,n.w);
   n.upper=Math.min(bound,stack);
   // A street the deck cannot clear by TRIM_HEADROOM is met at grade: half a clearance (1–4 m over
   // the street, slab edges hanging into it) reads as broken asphalt, a crossing reads as a junction.
   if(below===undefined&&under!==undefined&&bound<n.ground+under-(DECK_CLEARANCE-TRIM_HEADROOM)){under=undefined;n.flush=true;n.upper=Math.min(n.upper,n.ground+PORTAL_LIFT);}
   n.require=below!==undefined?n.upper:under!==undefined?Math.min(bound,Math.max(n.upper,n.ground+under)):undefined;
   n.why=below!==undefined?'lower-deck':under!==undefined?'crossing':undefined;
   if(stackTop!==undefined&&stackTop>(n.require??-Infinity)){n.require=Math.min(bound,stackTop);n.why='same-level-deck';}
   if(n.require!==undefined)n.upper=Math.max(n.upper,n.require);
   else{const aim=o.aim?.(n.x,n.z,n.level,n.w);if(aim!==undefined)n.aim=Math.min(n.upper,n.ground+aim);}
  }
  for(const n of group)n.require0=n.require;
  let low,high,origin;
  const solve=()=>{
   for(const n of group){n.require=n.require0;if(n.require===undefined)delete n.why;}
   // Portal / dead-end sources for the descending cone (multi-source Dijkstra, min-plus).
   // A deck branching off a lower deck continues from that junction's final height.
   low=new Map();high=new Map();
   for(const n of group)for(const [m] of n.edges)if(m.level<level&&m.h!==undefined&&!low.has(m))low.set(m,m.h);
   for(const n of group){if(!n.end||n.joined)continue;const key=nodeKey(n.x,n.z);if((touches.get(key)??0)>1)continue;
    if(o.groundKeys.has(key)||o.onGroundRoad?.(n.x,n.z)){const y=o.portalHeight?.(n.x,n.z);n.portal=true;n.seed=(y??n.ground)+PORTAL_LIFT;low.set(n,n.seed);}
    else if(!o.interior||o.interior(n.x,n.z)){n.deadEnd=true;n.seed=n.ground+PORTAL_LIFT;low.set(n,n.seed);}
   }
   for(const n of group)if(n.flush&&!low.has(n))low.set(n,n.flushAt??n.ground+PORTAL_LIFT);
   spread(low,(h,d)=>h+RAMP_GRADE*d,(a,b)=>a<b,level);
   // A clearance the portal cones cannot climb to (8 % plus what an approach ramp absorbs) would stand
   // as a short hump with slab edges 1–4 m over the streets around it. Such a crossing is met at grade.
   let dropped=0;
   for(const n of group)if(n.why==='crossing'&&!n.flush&&(low.get(n)??Infinity)+CROSSING_REACH_SLACK<n.require){
    n.flush=true;n.require=n.require0=undefined;delete n.why;n.flushAt=(o.streetUnder?.(n.x,n.z,n.w)??n.ground)+PORTAL_LIFT;n.upper=Math.min(n.upper,n.flushAt);dropped++;}
   if(dropped){for(const n of group)if(n.flush&&!(low.get(n)<=n.flushAt))low.set(n,n.flushAt);spread(low,(h,d)=>h+RAMP_GRADE*d,(a,b)=>a<b,level);}
   // Water is aimed at within the portal cones: a short stream bridge arches gently instead of
   // standing 5 m up and pushing ramps into the streets at both banks.
   for(const n of group)if(n.aim!==undefined){const y=Math.min(n.aim,low.get(n)??Infinity);if(y>n.ground+PORTAL_LIFT){n.require=y;n.why='water';}}
   for(const n of group)if(n.require!==undefined)high.set(n,n.require);
   origin=new Map();for(const n of high.keys())origin.set(n,n);
   spread(high,(h,d)=>h-MAX_GRADE*d,(a,b)=>a>b,level,origin);
   const settle=(n,reach)=>{
    // A portal's target is its own road: a lower portal's cone reaching it must not replace that
    // (on a hillside the far end is lower, and the step would be measured against the wrong road).
    const descend=low.get(n)??Infinity,hold=high.get(n)??-Infinity;if(n.portal||n.deadEnd)n.target=n.seed;
    // At a portal the floor is the joined road surface itself (a road in a cut sits below the land).
    const floor=n.portal&&n.target!==undefined?Math.min(n.ground+PORTAL_LIFT,n.target):n.ground+PORTAL_LIFT;
    n.h=Math.max(floor,hold,Math.min(n.upper,descend,reach));
   };
   // Bridges first; layer-only ways then return to grade from their clearances / joined bridges.
   for(const n of group)if(n.bridge)settle(n,Infinity);
   const reach=new Map();
   for(const n of group){if(n.bridge)reach.set(n,{h:n.h,hold:LAYER_HOLD});else if(n.require!==undefined)reach.set(n,{h:n.require,hold:LAYER_HOLD});}
   for(const n of group)if(!n.bridge)for(const [m] of n.edges)if(m.level<level&&m.h!==undefined){const r=reach.get(n);if(!r||m.h>r.h)reach.set(n,{h:m.h,hold:LAYER_HOLD});}
   spreadHold(reach,level);
   for(const n of group)if(!n.bridge)settle(n,reach.get(n)?.h??-Infinity);
  };
  solve();
  // A deck left .3–4 m over a street it crosses (a portal cone, an old low bake) comes down onto
  // that street instead, unless its own clearance holds it there; then the level is solved again.
  for(let pass=0;pass<3&&o.streetUnder;pass++){let added=0;
   for(const n of group){if(n.portal||n.deadEnd||n.flush||n.require!==undefined)continue;const st=o.streetUnder(n.x,n.z,n.w);if(st===undefined)continue;
    const gap=n.h-st;if(gap<=.3||gap>=TRIM_HEADROOM||(high.get(n)??-Infinity)>st+1)continue;
    n.flush=true;n.flushAt=st+PORTAL_LIFT;n.upper=Math.min(n.upper,n.flushAt);added++;}
   if(!added)break;solve();}
  // Welded carriageways meet level across: one beside another of its level, slabs overlapping, is raised
  // to within WELD_GRADE of it (never past its portal cone or bound, never into a street's headroom band).
  // On a hillside each followed its own strip of slope and the welded deck folded 3 m across the gore.
  const weld=new SegmentGrid();for(const e of edges)if(e.level===level)weld.add({a:e.a,b:e.b,line:e.line,reach:24});
  let welded=0;
  for(let pass=0;pass<4;pass++){let moved=0;
   for(const n of group){if(n.portal||n.deadEnd||n.flush||n.why==='same-level-deck')continue;let want=-Infinity;
    const [m]=n.edges.find(([k])=>k.level===level)??[];if(!m)continue;const ml=Math.hypot(m.x-n.x,m.z-n.z)||1,ux=(m.x-n.x)/ml,uz=(m.z-n.z)/ml;
    for(const s of weld.near(n.x,n.z)){if(s.line===n.src||s.a===n||s.b===n||s.a.h===undefined||s.b.h===undefined)continue;
     const sl=Math.hypot(s.b.x-s.a.x,s.b.z-s.a.z)||1;if(Math.abs(ux*(s.b.x-s.a.x)+uz*(s.b.z-s.a.z))/sl<WELD_ALIGN)continue; // a crossing deck stacks, it does not weld
     const {t,d}=project(s,n.x,n.z);
     if(d>(Math.max(s.a.w,s.b.w)+n.w)/2)continue;want=Math.max(want,s.a.h+(s.b.h-s.a.h)*t-WELD_GRADE*d);}
    const y=Math.min(want,low.get(n)??Infinity,n.bound);if(!(y>n.h+.05))continue;
    const st=o.streetUnder?.(n.x,n.z,n.w);if(st!==undefined&&y-st>.3&&y-st<TRIM_HEADROOM)continue;
    n.h=y;moved++;welded++;}
   if(!moved)break;}
  weldedNodes+=welded;
  for(const n of group){
   if(n.portal||n.deadEnd){n.target=n.seed??n.ground;if(n.h-n.target>1){const by=origin.get(n);conflicts.push({x:+n.x.toFixed(2),z:+n.z.toFixed(2),level,step:+(n.h-n.target).toFixed(2),kind:n.portal?'portal':'dead-end',heldBy:by?.why??'none',heldFrom:by?+Math.hypot(by.x-n.x,by.z-n.z).toFixed(1):undefined});}}
  }
  for(const e of edges)if(e.level===level)segments.add({...e,w:Math.max(e.a.w,e.b.w),reach:Math.max(e.a.w,e.b.w)/2+16});
 }
 /** Max-plus spread over layer-only nodes: a value holds for `hold` metres, then falls at RAMP_GRADE. */
 function spreadHold(seed,level){
  const better=(a,b)=>a.h>b.h+1e-9||Math.abs(a.h-b.h)<=1e-9&&a.hold>b.hold+1e-9,heap=[...seed].map(([n,v])=>({n,v}));
  while(heap.length){
   let bi=0;for(let i=1;i<heap.length;i++)if(better(heap[i].v,heap[bi].v))bi=i;
   const {n,v}=heap[bi];heap[bi]=heap[heap.length-1];heap.pop();
   if(seed.get(n)!==v)continue;
   for(const [m,d] of n.edges){if(m.level!==level||m.bridge)continue;const w=v.hold>=d?{h:v.h,hold:v.hold-d}:{h:v.h-RAMP_GRADE*(d-v.hold),hold:0};
    const cur=seed.get(m);if(!cur||better(w,cur)){seed.set(m,w);heap.push({n:m,v:w});}}
  }
 }
 function spread(seed,step,better,level,origin){
  const heap=[...seed].map(([n,h])=>({n,h}));
  while(heap.length){
   let bi=0;for(let i=1;i<heap.length;i++)if(better(heap[i].h,heap[bi].h))bi=i;
   const {n,h}=heap[bi];heap[bi]=heap[heap.length-1];heap.pop();
   if(seed.get(n)!==h)continue;
   for(const [m,d] of n.edges){if(m.level!==level)continue;const v=step(h,d);if(!seed.has(m)||better(v,seed.get(m))){seed.set(m,v);origin?.set(m,origin.get(n));heap.push({n:m,h:v});}}
  }
 }
 /**
  * Final deck surface at (x,z) for a deck mesh of `level`; `fallback` when no centreline is near.
  * `own` (from linesThrough) limits the choice to the roads that piece of deck belongs to.
  */
 function height(x,z,level,fallback,own){
  // Several roads through one welded piece blend: a point on one slab keeps that road's height, a
  // point where slabs overlap (a ramp's gore) slides between them. Taking only the nearest axis
  // folded the gore at 30–50°, and cutting the fold out tore the deck open.
  for(const pass of own?[own,undefined]:[undefined]){
   const byLine=new Map();
   for(const s of segments.near(x,z)){if(pass&&!pass.has(s.line))continue;const {t,d}=project(s,x,z);if(d>s.w/2+12)continue;
    const c={d,w:s.w,h:s.a.h+(s.b.h-s.a.h)*t,same:s.level===level},prev=byLine.get(s.line);if(!Number.isFinite(c.h))continue;
    if(!prev||c.same&&!prev.same||c.same===prev.same&&d<prev.d)byLine.set(s.line,c);}
   let cands=[...byLine.values()];if(!cands.length)continue;
   if(cands.some(c=>c.same))cands=cands.filter(c=>c.same);
   let sw=0,sh=0;for(const c of cands){const wt=(Math.max(0,c.d-c.w/2)+.5+.1*c.d)**-4;sw+=wt;sh+=wt*c.h;}
   return sh/sw;}
  return fallback;
 }
 /** Nearest centreline of `level` (own roads first): lateral distance, half width and heading. */
 function nearest(x,z,level,own){
  for(const pass of own?[own,undefined]:[undefined]){let best;
   for(const s of segments.near(x,z)){if(s.level!==level||pass&&!pass.has(s.line))continue;const {d}=project(s,x,z);if(d>s.w/2+12||best&&d>=best.d)continue;
    const len=Math.hypot(s.b.x-s.a.x,s.b.z-s.a.z)||1;best={d,w:s.w,dx:(s.b.x-s.a.x)/len,dz:(s.b.z-s.a.z)/len};}
   if(best)return best;}
 }
 /**
  * Roads whose centreline runs through one connected piece of deck mesh (`tris` [x,y,z]*3, cell metres):
  * a vertex near a neighbouring deck's axis must still take its own road's height, or two decks side
  * by side (or stacked on one OSM layer) fold into each other. Undefined when no centreline crosses it.
  */
 function linesThrough(tris,level){
  const cells=new Map();let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
  for(const t of tris){const a=Math.min(t[0],t[3],t[6]),b=Math.max(t[0],t[3],t[6]),c=Math.min(t[2],t[5],t[8]),d=Math.max(t[2],t[5],t[8]);x0=Math.min(x0,a);x1=Math.max(x1,b);z0=Math.min(z0,c);z1=Math.max(z1,d);
   for(let i=Math.floor(a/8);i<=Math.floor(b/8);i++)for(let j=Math.floor(c/8);j<=Math.floor(d/8);j++){const k=i*1e6+j;(cells.get(k)??cells.set(k,[]).get(k)).push(t);}}
  const inside=(x,z)=>(cells.get(Math.floor(x/8)*1e6+Math.floor(z/8))??[]).some(t=>{const det=(t[5]-t[8])*(t[0]-t[6])+(t[6]-t[3])*(t[2]-t[8]);if(Math.abs(det)<1e-9)return false;
   const a=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))/det,b=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))/det;return a>=-1e-6&&b>=-1e-6&&1-a-b>=-1e-6;});
  const hits=new Map(),seen=new Set();
  for(let gx=Math.floor(x0/segments.cell);gx<=Math.floor(x1/segments.cell);gx++)for(let gz=Math.floor(z0/segments.cell);gz<=Math.floor(z1/segments.cell);gz++)
   for(const s of segments.cells.get(gx+':'+gz)??[]){if(seen.has(s)||s.level!==level)continue;seen.add(s);
    const n=Math.max(1,Math.ceil(s.len/2));for(let k=0;k<=n;k++){const x=s.a.x+(s.b.x-s.a.x)*k/n,z=s.a.z+(s.b.z-s.a.z)*k/n;if(x>=x0&&x<=x1&&z>=z0&&z<=z1&&inside(x,z))hits.set(s.line,(hits.get(s.line)??0)+1);}}
  return hits.size?new Set(hits.keys()):undefined;
 }
 return {height,nearest,linesThrough,lines,nodes,conflicts,
  stats:{nodes:nodes.length,flushCrossings:nodes.filter(n=>n.flush).length,portals:nodes.filter(n=>n.portal).length,deadEnds:nodes.filter(n=>n.deadEnd).length,conflicts:conflicts.length,welded:weldedNodes}};
}

/**
 * Connected pieces of a triangle soup ([x,y,z]*3 each, any frame): triangles sharing a vertex
 * position (mm) belong together. Returns arrays of triangle indices — one per deck strip, so each
 * strip can take its heights from its own roads (profile.linesThrough).
 */
export function meshPieces(tris){
 const parent=tris.map((_,i)=>i),find=i=>{while(parent[i]!==i)i=parent[i]=parent[parent[i]];return i;},at=new Map();
 tris.forEach((t,i)=>{for(let k=0;k<9;k+=3){const key=Math.round(t[k]*1e3)+','+Math.round(t[k+2]*1e3)+','+Math.round(t[k+1]*1e3);const j=at.get(key);if(j===undefined)at.set(key,i);else parent[find(i)]=find(j);}});
 const groups=new Map();tris.forEach((_,i)=>{const r=find(i);(groups.get(r)??groups.set(r,[]).get(r)).push(i);});
 return [...groups.values()];
}

/**
 * Girder faces, a closed underside and piers for one chunk's deck triangles.
 * `tris` are [x,y,z]*3 in cell metres (final heights). `edgeOfChunk(x,z)` excludes seam-cut edges.
 * Returns cell-metre positions for a layer-6 mesh plus collision volumes for the piers.
 */
export function deckStructures({tris,lines,height,terrain,blocked,edgeOfChunk,street}){
 const faces=[],lips=[],volumes=[],edgeUse=new Map(),depth=(y,g)=>Math.max(0,Math.min(DECK_SLAB_DEPTH,y-g-.05));
 // Every face is wound so its normal points `out` (front face, same convention as computeVertexNormals).
 const face=(p0,p1,p2,out,to=faces)=>{const ux=p1[0]-p0[0],uy=p1[1]-p0[1],uz=p1[2]-p0[2],vx=p2[0]-p0[0],vy=p2[1]-p0[1],vz=p2[2]-p0[2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;if(nx*out[0]+ny*out[1]+nz*out[2]<0)to.push(...p0,...p2,...p1);else to.push(...p0,...p1,...p2);};
 const quad=(a,b,ya,yb,da,db,out,to=faces)=>{if(da<=.02&&db<=.02)return;
  const A=[a[0],ya,a[1]],B=[b[0],yb,b[1]],C=[b[0],yb-db,b[1]],D=[a[0],ya-da,a[1]];face(A,B,C,out,to);face(A,C,D,out,to);};
 // A low slab edge standing on a street is a kerb of the carriageway, not a girder: its face goes out as
 // asphalt (`lips`). In concrete it read as a white line across the junction where a deck meets the street.
 // The lip reaches down to the street (a slab ending up to LIP_MAX_DROP over it left a slit under its girder).
 const toStreet=(p,y)=>{const s=street?.(p[0],p[1]);return s!==undefined&&y-s>-.1&&y-s<=LIP_MAX_DROP?Math.max(0,y-s):undefined;};
 const lip=e=>{if(!street)return;const da=toStreet(e.a,e.ya),db=toStreet(e.b,e.yb);return da!==undefined&&db!==undefined&&{da,db};};
 for(const t of tris){
  const g=[terrain(t[0],t[2]),terrain(t[3],t[5]),terrain(t[6],t[8])],d=[depth(t[1],g[0]),depth(t[4],g[1]),depth(t[7],g[2])];
  // Underside: the deck's own triangle, lowered by the slab depth and facing down.
  if(d.some(v=>v>.02))face([t[0],t[1]-d[0],t[2]],[t[3],t[4]-d[1],t[5]],[t[6],t[7]-d[2],t[8]],[0,-1,0]);
  const cx=(t[0]+t[3]+t[6])/3,cz=(t[2]+t[5]+t[8])/3;
  for(let k=0;k<3;k++){const i=k*3,j=((k+1)%3)*3,ka=t[i].toFixed(3)+','+t[i+2].toFixed(3),kb=t[j].toFixed(3)+','+t[j+2].toFixed(3),key=ka<kb?ka+'|'+kb:kb+'|'+ka;
   const e=edgeUse.get(key);if(e)e.count++;else edgeUse.set(key,{count:1,a:[t[i],t[i+2]],b:[t[j],t[j+2]],ya:t[i+1],yb:t[j+1],da:d[k],db:d[(k+1)%3],out:[(t[i]+t[j])/2-cx,0,(t[i+2]+t[j+2])/2-cz]});}
 }
 // An edge used once is open only if nothing covers the ground just past it: a trimmed or lifted deck
 // has T-junctions (a diced triangle beside a whole one), whose inner edges must not grow girder strips.
 const cover=new Map(),cell=t=>{const ks=[];for(let a=Math.floor(Math.min(t[0],t[3],t[6])/8);a<=Math.floor(Math.max(t[0],t[3],t[6])/8);a++)for(let b=Math.floor(Math.min(t[2],t[5],t[8])/8);b<=Math.floor(Math.max(t[2],t[5],t[8])/8);b++)ks.push(a+':'+b);return ks;};
 for(const t of tris)for(const k of cell(t))(cover.get(k)??cover.set(k,[]).get(k)).push(t);
 const covered=(x,z)=>(cover.get(Math.floor(x/8)+':'+Math.floor(z/8))??[]).some(t=>{const det=(t[5]-t[8])*(t[0]-t[6])+(t[6]-t[3])*(t[2]-t[8]);if(Math.abs(det)<1e-9)return false;
  const a=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))/det,b=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))/det;return a>=0&&b>=0&&a+b<=1;});
 const open=e=>{const dx=e.b[0]-e.a[0],dz=e.b[1]-e.a[1],l=Math.hypot(dx,dz)||1;let nx=-dz/l,nz=dx/l;if(nx*e.out[0]+nz*e.out[2]<0){nx=-nx;nz=-nz;}
  return [.25,.5,.75].every(s=>!covered(e.a[0]+dx*s+nx*.05,e.a[1]+dz*s+nz*.05));}; // partly covered: an overlap with a neighbouring slab
 // A slab edge within GIRDER_MIN_DROP of what lies under it reads as one surface: a concrete sliver there
 // showed as a light sawtooth along decks laid on the street or on a neighbouring deck.
 for(const e of edgeUse.values()){if(e.count!==1||edgeOfChunk(...e.a)&&edgeOfChunk(...e.b))continue;
  const l=lip(e);if(l){if(open(e))quad(e.a,e.b,e.ya,e.yb,l.da,l.db,e.out,lips);}
  else if(Math.max(e.da,e.db)>=GIRDER_MIN_DROP&&open(e))quad(e.a,e.b,e.ya,e.yb,e.da,e.db,e.out);}
 // Piers: every PIER_SPACING along each centreline piece, starting half a span in.
 for(const line of lines){
  const p=line.p;let walked=0;
  for(let i=2;i<p.length;i+=2){
   const ax=p[i-2],az=p[i-1],bx=p[i],bz=p[i+1],len=Math.hypot(bx-ax,bz-az);if(!len)continue;
   const ux=(bx-ax)/len,uz=(bz-az)/len;
   for(let s=Math.ceil((walked+PIER_SPACING/2)/PIER_SPACING)*PIER_SPACING-PIER_SPACING/2-walked;s<len;s+=PIER_SPACING){
    const x=ax+ux*s,z=az+uz*s,y=height(x,z,line.level,undefined);if(y===undefined)continue;
    const g=terrain(x,z),top=y-DECK_SLAB_DEPTH;if(top-g<PIER_MIN_CLEARANCE-DECK_SLAB_DEPTH)continue;
    const r=PIER_SIZE/2,ring=[[-r,-r],[r,-r],[r,r],[-r,r]].map(([a,b])=>[x+ux*a-uz*b,z+uz*a+ux*b]);
    if([[x,z],...ring].some(([px,pz])=>blocked(px,pz)))continue;
    for(let k=0;k<4;k++){const a=ring[k],b=ring[(k+1)%4],ga=terrain(...a)-.3,gb=terrain(...b)-.3;quad(a,b,top,top,top-ga,top-gb,[(a[0]+b[0])/2-x,0,(a[1]+b[1])/2-z]);}
    volumes.push({p:ring.flat(),base:g-.3,top});
   }
   walked+=len;
  }
 }
 return {faces,lips,volumes};
}

/** Ground road crossing under an elevated centreline: transverse only (> 20°), never a ramp merging alongside. */
const CROSS_MIN_ANGLE=Math.sin(20*Math.PI/180);
function intersect(ax,az,bx,bz,cx,cz,dx,dz){
 const rx=bx-ax,rz=bz-az,sx=dx-cx,sz=dz-cz,den=rx*sz-rz*sx;if(Math.abs(den)<1e-9)return;
 const t=((cx-ax)*sz-(cz-az)*sx)/den,u=((cx-ax)*rz-(cz-az)*rx)/den;if(t<0||t>1||u<0||u>1)return;
 const sin=Math.abs(den)/(Math.hypot(rx,rz)*Math.hypot(sx,sz));return sin<CROSS_MIN_ANGLE?undefined:[ax+rx*t,az+rz*t];
}
function insideRing(p,x,z){let c=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){const xi=p[i],zi=p[i+1],xj=p[j],zj=p[j+1];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;}
function ringBox(p){let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(let i=0;i<p.length;i+=2){x0=Math.min(x0,p[i]);x1=Math.max(x1,p[i]);z0=Math.min(z0,p[i+1]);z1=Math.max(z1,p[i+1]);}return {x0,z0,x1,z1};}
class Boxes{constructor(c=64){this.c=c;this.m=new Map();}add(b,v){for(let i=Math.floor(b.x0/this.c);i<=Math.floor(b.x1/this.c);i++)for(let j=Math.floor(b.z0/this.c);j<=Math.floor(b.z1/this.c);j++){const k=i+':'+j;(this.m.get(k)??this.m.set(k,[]).get(k)).push(v);}}at(x,z){return this.m.get(Math.floor(x/this.c)+':'+Math.floor(z/this.c))??[];}}

/**
 * City-wide deck plan from source geometry. Both the street bake and the completed-chunk repair
 * call this with the same input shape, so a rebuilt city and a repaired city agree exactly.
 *
 * @param o.elevated  [{p, level, w, bridge}] elevated vehicle centrelines (bridge / layer > 0, not tunnels);
 *                   bridge:false marks a layer-only way (rule 2b)
 * @param o.ground    [{p, w}] at-grade road centrelines (vehicle and walking)
 * @param o.water     [{p, w?, holes?}] water areas (w → linear waterway)
 * plus terrain / portalHeight / bound / interior as in createDeckProfile.
 */
export function planCityDecks(o){
 const groundKeys=new Set(),segs=new Boxes(64),elevatedKeys=new Map();
 for(const e of o.elevated)for(let i=0;i<e.p.length;i+=2){const k=nodeKey(e.p[i],e.p[i+1]);elevatedKeys.set(k,(elevatedKeys.get(k)??0)+1);}
 for(const g of o.ground){let joined=false;for(let i=0;i<g.p.length;i+=2){const k=nodeKey(g.p[i],g.p[i+1]);groundKeys.add(k);joined||=elevatedKeys.has(k);}
  for(let i=2;i<g.p.length;i+=2){const b={x0:Math.min(g.p[i-2],g.p[i]),x1:Math.max(g.p[i-2],g.p[i]),z0:Math.min(g.p[i-1],g.p[i+1]),z1:Math.max(g.p[i-1],g.p[i+1])};segs.add(b,{a:[g.p[i-2],g.p[i-1]],b:[g.p[i],g.p[i+1]],w:g.w??8,joined});}}
 // Transverse crossings, ignoring the joined road within reach of each deck end.
 const crossings=new Boxes(64);let crossingCount=0;
 for(const e of o.elevated){const p=e.p,ends=[[p[0],p[1]],[p[p.length-2],p[p.length-1]]];
  for(let i=2;i<p.length;i+=2){const seen=new Set(),b={x0:Math.min(p[i-2],p[i]),x1:Math.max(p[i-2],p[i]),z0:Math.min(p[i-1],p[i+1]),z1:Math.max(p[i-1],p[i+1])};
   for(let a=Math.floor(b.x0/64);a<=Math.floor(b.x1/64);a++)for(let c=Math.floor(b.z0/64);c<=Math.floor(b.z1/64);c++)for(const s of segs.m.get(a+':'+c)??[]){if(seen.has(s)||s.w<UNDER_MIN_WIDTH)continue;seen.add(s); // a footpath under a bridge does not hold it 5 m up
    const hit=intersect(p[i-2],p[i-1],p[i],p[i+1],s.a[0],s.a[1],s.b[0],s.b[1]);if(!hit)continue;
    // Near a deck end only the road it joins may pass (the approach itself); another street
    // crossing right at the end still needs the slab up — the ramp lifts the approach instead.
    const onEnd=([x,z])=>{const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-s.a[0])*dx+(z-s.a[1])*dz)/l));return Math.hypot(x-s.a[0]-t*dx,z-s.a[1]-t*dz)<=Math.max(PORTAL_REACH,s.w/2);};
    if(ends.some(([x,z])=>Math.hypot(hit[0]-x,hit[1]-z)<15)&&(s.joined||ends.some(onEnd)))continue; // the T-junction road a deck ends on is joined too
    const r=s.w/2+3;crossings.add({x0:hit[0]-r,x1:hit[0]+r,z0:hit[1]-r,z1:hit[1]+r},{x:hit[0],z:hit[1],r,street:s});crossingCount++;}}}
 // Streets under the slab: a ground carriageway the deck runs along (within 30°, too shallow for a crossing)
 // needs the same clearance — without it, lowering a deck pressed it onto the street beneath.
 // A road the deck joins (sharing a vertex with any elevated piece) is an approach, not a street
 // under it, and the last UNDER_END_REACH before a true end (not a seam cut) may come down.
 let underCount=0;
 for(const e of o.elevated){const p=e.p,ew=e.w??8,ends=[0,p.length-2].filter(i=>elevatedKeys.get(nodeKey(p[i],p[i+1]))===1).map(i=>[p[i],p[i+1]]);
  for(let i=2;i<p.length;i+=2){const ax=p[i-2],az=p[i-1],len=Math.hypot(p[i]-ax,p[i+1]-az),n=Math.max(1,Math.ceil(len/UNDER_STEP));
   for(let k=0;k<=n;k++){const x=ax+(p[i]-ax)*k/n,z=az+(p[i+1]-az)*k/n;if(ends.some(([ex,ez])=>Math.hypot(ex-x,ez-z)<UNDER_END_REACH))continue;
    const seen=new Set();let under=false;
    for(let a=Math.floor((x-24)/64);a<=Math.floor((x+24)/64);a++)for(let c=Math.floor((z-24)/64);c<=Math.floor((z+24)/64);c++)for(const sg of segs.m.get(a+':'+c)??[]){
     if(seen.has(sg)||sg.joined||sg.w<UNDER_MIN_WIDTH)continue;seen.add(sg);
     const dx=sg.b[0]-sg.a[0],dz=sg.b[1]-sg.a[1],l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-sg.a[0])*dx+(z-sg.a[1])*dz)/l));
     // Along the deck only: a street crossing it is a crossing (angle and end rules above).
     const along=Math.abs(dx*(p[i+1]-az)-dz*(p[i]-ax))/(Math.sqrt(l)*(len||1));if(along>=UNDER_MAX_SIN)continue;
     if(Math.hypot(x-sg.a[0]-t*dx,z-sg.a[1]-t*dz)<=ew/2+sg.w/2-UNDER_OVERLAP){
      // Clearance counts from the street's own surface: side streets often sit above the median's land.
      const rise=Math.max(0,(o.terrain(sg.a[0]+t*dx,sg.a[1]+t*dz)??0)-(o.terrain(x,z)??0));under=Math.max(under||0,DECK_CLEARANCE+rise);}}
    if(under){crossings.add({x0:x-UNDER_STEP,x1:x+UNDER_STEP,z0:z-UNDER_STEP,z1:z+UNDER_STEP},{x,z,r:UNDER_STEP,clear:under});underCount++;}}}}
 const inWater=waterTest(o.water??[]),aim=waterClearance(o.water??[]);
 // Clearance counts from the crossing street's own surface: on a slope it passes above the deck's land.
 const streetRise=(sg,x,z)=>{const dx=sg.b[0]-sg.a[0],dz=sg.b[1]-sg.a[1],l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-sg.a[0])*dx+(z-sg.a[1])*dz)/l));return Math.max(0,(o.terrain(sg.a[0]+t*dx,sg.a[1]+t*dz)??0)-(o.terrain(x,z)??0));};
 const beneath=(x,z)=>{let clear;for(const c of crossings.at(x,z))if(Math.hypot(c.x-x,c.z-z)<=c.r)clear=Math.max(clear??0,c.clear??DECK_CLEARANCE+(c.street?streetRise(c.street,x,z):0));return clear;};
 // A deck end on a carriageway without a shared vertex still joins that road (T-junction).
 const onGroundRoad=(x,z)=>segs.at(x,z).some(sg=>{const ax=sg.a[0],az=sg.a[1],dx=sg.b[0]-ax,dz=sg.b[1]-az,l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l));return Math.hypot(x-ax-t*dx,z-az-t*dz)<=Math.max(PORTAL_REACH,sg.w/2);});
 // Highest street (not joined to a deck, 3 m or wider) whose slab reaches into the deck's core at (x,z).
 const streetUnder=(x,z,w)=>{let top;const core=Math.min(w/2,TRIM_CORE);
  for(const sg of segs.at(x,z)){if(sg.joined||sg.w<UNDER_MIN_WIDTH)continue;const ax=sg.a[0],az=sg.a[1],dx=sg.b[0]-ax,dz=sg.b[1]-az,l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l));
   if(Math.hypot(x-ax-t*dx,z-az-t*dz)>sg.w/2+core-UNDER_OVERLAP)continue;const y=o.terrain(ax+t*dx,az+t*dz);if(y!==undefined)top=Math.max(top??-Infinity,y);}
  return top;};
 const input={lines:o.elevated,groundKeys,onGroundRoad,terrain:o.terrain,portalHeight:o.portalHeight,bound:o.bound,beneath,aim,interior:o.interior,streetUnder};
 let profile=createDeckProfile(input);
 // Same-layer decks crossing without a shared vertex are stacked in reality (OSM often tags both
 // layer=1): after a first plan, the one that came out higher clears the other by a full level.
 const stacked=sameLevelCrossings(o.elevated);
 if(stacked.length){const over=new Boxes(64);
  for(const c of stacked){const ha=profile.height(c.x,c.z,c.level,undefined,new Set([c.a])),hb=profile.height(c.x,c.z,c.level,undefined,new Set([c.b]));if(ha===undefined||hb===undefined)continue;
   const [upper,low]=ha>hb+.3?[c.a,hb]:hb>ha+.3?[c.b,ha]:(o.elevated[c.a].w??8)>=(o.elevated[c.b].w??8)?[c.a,hb]:[c.b,ha];
   const r=Math.max(o.elevated[c.a].w??8,o.elevated[c.b].w??8)/2+3;over.add({x0:c.x-r,x1:c.x+r,z0:c.z-r,z1:c.z+r},{x:c.x,z:c.z,r,top:low+DECK_CLEARANCE,line:upper});}
  // The requirement is per road: only the upper deck's nodes read it (by source line index).
  profile=createDeckProfile({...input,beneathLine:(x,z,line)=>{let top;for(const c of over.at(x,z))if(c.line===line&&Math.hypot(c.x-x,c.z-z)<=c.r)top=Math.max(top??-Infinity,c.top);return top;}});
 }
 return {...profile,inWater,onGroundRoad,stats:{...profile.stats,crossings:crossingCount,streetsUnder:underCount,sameLevelStacks:stacked.length}};
}
/** Transverse crossings between elevated pieces of one level that share no vertex there: {x,z,level,a,b} (piece indices). */
function sameLevelCrossings(elevated){
 const grid=new Boxes(64),out=[],seen=new Set();
 elevated.forEach((e,ei)=>{for(let i=2;i<e.p.length;i+=2)grid.add({x0:Math.min(e.p[i-2],e.p[i]),x1:Math.max(e.p[i-2],e.p[i]),z0:Math.min(e.p[i-1],e.p[i+1]),z1:Math.max(e.p[i-1],e.p[i+1])},[ei,i]);});
 for(const list of grid.m.values())for(let u=0;u<list.length;u++)for(let v=u+1;v<list.length;v++){
  const [ea,ia]=list[u],[eb,ib]=list[v];if(ea===eb)continue;const A=elevated[ea],B=elevated[eb];if(Math.max(1,A.level|0)!==Math.max(1,B.level|0))continue;
  const key=ea<eb?ea+':'+ia+':'+eb+':'+ib:eb+':'+ib+':'+ea+':'+ia;if(seen.has(key))continue;seen.add(key);
  const hit=intersect(A.p[ia-2],A.p[ia-1],A.p[ia],A.p[ia+1],B.p[ib-2],B.p[ib-1],B.p[ib],B.p[ib+1]);if(!hit)continue;
  // A shared or near vertex is a junction (ramp merge, seam), not a stack.
  const nearVertex=p=>{for(let i=0;i<p.length;i+=2)if(Math.hypot(p[i]-hit[0],p[i+1]-hit[1])<=ELEVATED_GAP*4)return true;return false;};
  if(nearVertex(A.p)&&nearVertex(B.p))continue;
  out.push({x:hit[0],z:hit[1],level:Math.max(1,A.level|0),a:ea,b:eb});}
 return out;
}
/**
 * Built in its own scope on purpose: the returned closure must not share a context with the
 * city-wide road indexes above, or keeping it for pier placement would keep those alive too.
 */
function waterTest(list){
 const water=new Boxes(64);for(const w of list){const b=ringBox(w.p),pad=(w.w??0)/2;water.add({x0:b.x0-pad,x1:b.x1+pad,z0:b.z0-pad,z1:b.z1+pad},w);}
 return (x,z)=>water.at(x,z).some(w=>w.w!=null?segmentNear(w.p,x,z,w.w/2):insideRing(w.p,x,z)&&!(w.holes??[]).some(h=>insideRing(h,x,z)));
}
/** Clearance a deck needs over the water at (x,z): areas take DECK_CLEARANCE, linear channels scale with width. */
function waterClearance(list){
 const water=new Boxes(64);for(const w of list){const b=ringBox(w.p),pad=(w.w??0)/2;water.add({x0:b.x0-pad,x1:b.x1+pad,z0:b.z0-pad,z1:b.z1+pad},w);}
 return (x,z)=>{let clear;for(const w of water.at(x,z)){
  const c=w.w!=null?(segmentNear(w.p,x,z,w.w/2)?streamClearance(w.w):undefined):insideRing(w.p,x,z)&&!(w.holes??[]).some(h=>insideRing(h,x,z))?DECK_CLEARANCE:undefined;
  if(c!==undefined)clear=Math.max(clear??0,c);}return clear;};
}
function segmentNear(p,x,z,r){for(let i=2;i<p.length;i+=2){const ax=p[i-2],az=p[i-1],dx=p[i]-ax,dz=p[i+1]-az,l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l));if(Math.hypot(x-ax-t*dx,z-az-t*dz)<=r)return true;}return false;}

/**
 * Re-fit deck-split tower parts (street_compile split_deck_towers) to the current deck surface.
 * Group members share `deckSplit`; the upper volume carries the deck strips. The slot opens
 * DECK_HEADROOM above the highest deck point, piers rise to it, podiums stay under the lowest.
 */
export function refitDeckSplits(buildings,deckHeight,ground){
 const slots=new Map();
 for(const b of buildings)if(b.deckStrips&&b.passageRole==='upper-volume'){
  let high=-Infinity,low=Infinity;
  for(const s of b.deckStrips){const xs=s.p.filter((_,i)=>i%2===0),zs=s.p.filter((_,i)=>i%2===1),pts=xs.map((x,i)=>[x,zs[i]]);
   const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
   for(let x=x0+1;x<x1;x+=3)for(let z=z0+1;z<z1;z+=3)if(insideRing(s.p,x,z))pts.push([x,z]);
   for(const [x,z] of pts){const y=deckHeight(x,z,s.level),g=ground(x,z);if(y===undefined||g===undefined)continue;high=Math.max(high,y-g);low=Math.min(low,y-g);}}
  if(Number.isFinite(high))slots.set(b.deckSplit,{top:Math.round((high+.15+DECK_HEADROOM)*100)/100,floor:Math.round((low-.3)*100)/100});
 }
 let changed=0;
 const out=buildings.flatMap(b=>{const slot=slots.get(b.deckSplit);if(!slot)return [b];
  let next=b;
  if(b.passageRole==='upper-volume')next=slot.top<b.h-1?{...b,groundClearance:slot.top}:b;
  else if(b.passageRole==='ground-pier')next={...b,h:slot.top};
  else if(b.passageRole==='deck-podium'||b.passageRole==='deck-podium-passage'){const h=Math.min(b.h,slot.floor);next=h>(b.groundClearance??0)+.5?{...b,h}:null;}
  if(next!==b)changed++;return next?[next]:[];});
 return {buildings:out,changed};
}

/**
 * Roads never run through a building. Wherever a carriageway (any level, final heights) lies inside a
 * footprint between the volume's base and roof, the building gives way — the road is the playable
 * surface and the footprint the background:
 *  · a raised volume (groundClearance) is lifted to ROAD_GATE_HEADROOM over the road when enough of
 *    it remains above; otherwise it is carved like a solid one;
 *  · a solid volume is cut along the road: the rectangle covering the road inside the footprint is
 *    removed, the remaining pieces keep the source volume, and the part over the road stays as an
 *    upper volume (a gate) only when the building rises ROAD_GATE_MIN_VOLUME above the headroom.
 * Curved or crossing roads are cut piece by piece (ROAD_CUT_PASSES). Authored models and buildings
 * with explicit passages are left alone and returned in `kept`.
 *
 * @param buildings  chunk buildings (cell metres)
 * @param roadTris   carriageway triangles [x,y,z]*3, every level, final heights
 * @param ground     (x,z) → terrain height
 * Columns (supportPoints) standing on a carriageway are dropped from every building (`columns`).
 * @returns {buildings, cut, raised, removed, columns, kept}
 */
export const ROAD_PASS_HEADROOM=3;   // m under a volume over a road that is already a passage (normalize_passages uses 3)
export const ROAD_GATE_HEADROOM=4.5; // m from the road to a volume lifted or kept over it
export const ROAD_GATE_MIN_VOLUME=3; // m of building that must remain above the headroom to keep a gate
export const ROAD_GATE_MIN_CLEARANCE=.1; // m — a road in a cut under a hillside building needs no lift, but 0 would read as a solid volume
export const ROAD_ENTRY_REACH=25; // m of a road ending inside a footprint left entering it
export const ROAD_ENTRY_LIFT=2; // m above ground an entering road end must be to be left uncut
export const ROOF_SLACK=.1; // m — a road this close under a roof (or above it) is clear; the surface audit allows .15
export const ROOF_DIP=3; // m — a road this far under a roof lowers the building under its slab instead of cutting it
export const ROOF_MIN_HEIGHT=2.5; // m — a building left lower than this is cut instead
const ROAD_CUT_PASSES=8,ROAD_CUT_MIN_AREA=2;
const AUTHORED=['landmarkModel','seoulArchitecture','palaceBuildingId','statueModel','walkableProfile','passageGroundParts'];
function roadBlockers(roadTris,ground,entries=[]){
 const grid=new Map(),C=16;
 for(const t of roadTris){const x0=Math.min(t[0],t[3],t[6]),x1=Math.max(t[0],t[3],t[6]),z0=Math.min(t[2],t[5],t[8]),z1=Math.max(t[2],t[5],t[8]);
  for(let a=Math.floor(x0/C);a<=Math.floor(x1/C);a++)for(let b=Math.floor(z0/C);b<=Math.floor(z1/C);b++){const k=a+':'+b;(grid.get(k)??grid.set(k,[]).get(k)).push(t);}}
 const roadsAt=(x,z)=>{const ys=[];for(const t of grid.get(Math.floor(x/C)+':'+Math.floor(z/C))??[]){const det=(t[5]-t[8])*(t[0]-t[6])+(t[6]-t[3])*(t[2]-t[8]);if(Math.abs(det)<1e-9)continue;
  const a=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))/det,b=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))/det,c=1-a-b;if(Math.min(a,b,c)<-1e-6)continue;ys.push(a*t[1]+b*t[4]+c*t[7]);}return ys;};
 const touchesRoad=box=>{for(let a=Math.floor(box.x0/C);a<=Math.floor(box.x1/C);a++)for(let b=Math.floor(box.z0/C);b<=Math.floor(box.z1/C);b++)for(const t of grid.get(a+':'+b)??[])
  if(Math.max(t[0],t[3],t[6])>=box.x0&&Math.min(t[0],t[3],t[6])<=box.x1&&Math.max(t[2],t[5],t[8])>=box.z0&&Math.min(t[2],t[5],t[8])<=box.z1)return true;return false;};
 // Same vertical extent as chunkMesh: base on the highest boundary ground, roof from the centroid ground.
 const volume=b=>{let max=-Infinity,cx=0,cz=0;const p=b.p,n=p.length/2;
  for(let i=0;i<p.length;i+=2){const j=(i+2)%p.length,len=Math.hypot(p[j]-p[i],p[j+1]-p[i+1]),steps=Math.max(1,Math.ceil(len/2));
   for(let s=0;s<steps;s++){const g=ground(p[i]+(p[j]-p[i])*s/steps,p[i+1]+(p[j+1]-p[i+1])*s/steps);if(g!==undefined)max=Math.max(max,g);}cx+=p[i];cz+=p[i+1];}
  if(!Number.isFinite(max))max=0;const g=ground(cx/n,cz/n)??max;
  return {contact:max,centre:g,base:b.groundClearance?max+b.groundClearance:-Infinity,top:Math.max(g+(b.h??9),max+Math.min(b.h??9,2.8))};};
 // Road points inside the footprint that the volume blocks.
 // A road that ends inside a footprint enters the building (a car park ramp, a podium deck): the
 // last ROAD_ENTRY_REACH of it is not cut — cutting would leave the deck hanging in a gap.
 // Ends within the reach of the footprint, not only inside it: once a cut removes the part holding
 // the end, the pieces left beside the gap must still see it (and the audit sees the same pieces).
 // Only a raised end can hang: a road entering at grade (a layer-only podium road now laid on the
 // ground) is cut around like any other, or the building keeps standing on it.
 const raisedEnd=([x,z])=>{const ys=roadsAt(x,z),g=ground(x,z);return !ys.length||g===undefined||Math.max(...ys)-g>ROAD_ENTRY_LIFT;};
 const entriesIn=b=>{const box=ringBox(b.p),R=ROAD_ENTRY_REACH;
  return entries.filter(([x,z])=>x>=box.x0-R&&x<=box.x1+R&&z>=box.z0-R&&z<=box.z1+R&&(insideRing(b.p,x,z)||ringDistance(b.p,x,z)<R)&&raisedEnd([x,z]));};
 const conflicts=(b,near=entriesIn(b))=>{const box=ringBox(b.p),area=(box.x1-box.x0)*(box.z1-box.z0),step=area>40000?2:1;
  const {base,top}=volume(b),out=[],entering=(x,z)=>near.some(([ex,ez])=>Math.hypot(x-ex,z-ez)<ROAD_ENTRY_REACH),
   inFoot=(x,z)=>insideRing(b.p,x,z)&&!(b.holes??[]).some(h=>insideRing(h,x,z))&&!entering(x,z),blocks=y=>y+ROAD_PASS_HEADROOM>base&&y<top-ROOF_SLACK;
  for(let x=box.x0+step/2;x<box.x1;x+=step)for(let z=box.z0+step/2;z<box.z1;z+=step){
   const ys=roadsAt(x,z);if(!ys.length||!inFoot(x,z))continue;
   for(const y of ys)if(blocks(y)){out.push([x,y,z]);break;}}
  // The road's own points too: a carriageway edge thinner than the grid still counts.
  const seen=new Set();
  for(let a=Math.floor(box.x0/C);a<=Math.floor(box.x1/C);a++)for(let c=Math.floor(box.z0/C);c<=Math.floor(box.z1/C);c++)for(const t of grid.get(a+':'+c)??[]){
   if(seen.has(t))continue;seen.add(t);
   const cx=(t[0]+t[3]+t[6])/3,cy=(t[1]+t[4]+t[7])/3,cz=(t[2]+t[5]+t[8])/3;
   for(const [w0,w1,w2] of [[1,1,1],[4,1,1],[1,4,1],[1,1,4],[3,3,1],[1,3,3],[3,1,3]]){const W=w0+w1+w2,x=(t[0]*w0+t[3]*w1+t[6]*w2)/W,y=(t[1]*w0+t[4]*w1+t[7]*w2)/W,z=(t[2]*w0+t[5]*w1+t[8]*w2)/W;
    if(x>=box.x0&&x<=box.x1&&z>=box.z0&&z<=box.z1&&blocks(y)&&inFoot(x,z))out.push([x,y,z]);}
  }
  return {points:out,step,top};};
 return {roadsAt,touchesRoad,volume,conflicts,entriesIn};
}
/** Structures (canopies, shelters) keep no column (supportPoints) standing on a carriageway or deck. */
export function structuresOffRoads(structures,roadTris){
 if(!structures?.some(b=>b.supportPoints?.length))return {structures,columns:0};
 const {roadsAt}=roadBlockers(roadTris,()=>0);let columns=0;
 const out=structures.map(b=>{const c=withoutRoadSupports(b,roadsAt);if(c!==b)columns+=(b.supportPoints.length-(c.supportPoints?.length??0))/2;return c;});
 return {structures:columns?out:structures,columns};
}
/** Buildings a carriageway runs through (same test as clearBuildingsOfRoads) — for the audit. */
export function roadsThroughBuildings(buildings,roadTris,ground,entries=[]){
 const {touchesRoad,conflicts}=roadBlockers(roadTris,ground,entries),out=[];
 for(const b of buildings){if(b.p.length<6||!touchesRoad(ringBox(b.p)))continue;const c=conflicts(b).points;
  if(c.length)out.push({osmId:b.osmId,x:+c[0][0].toFixed(1),z:+c[0][2].toFixed(1),samples:c.length,authored:AUTHORED.some(k=>b[k])});}
 return out;
}
export function clearBuildingsOfRoads(buildings,roadTris,ground,entries=[]){
 const {roadsAt,touchesRoad,volume,conflicts,entriesIn}=roadBlockers(roadTris,ground,entries);
 const result=[];let cut=0,raised=0,removed=0,columns=0;const kept=[];
 for(const b of buildings){
  if(b.p.length<6||!touchesRoad(ringBox(b.p))){result.push(b);continue;}
  const near=entriesIn(b),first=conflicts(b,near);
  if(!first.points.length){const clear=withoutRoadSupports(b,roadsAt);if(clear!==b&&!AUTHORED.some(k=>b[k]))columns++;result.push(AUTHORED.some(k=>b[k])?b:clear);continue;}
  if(AUTHORED.some(k=>b[k])){result.push(b);kept.push(b);continue;}
  // A pier the compiler stood under its estimated deck height stops under the slab of the baked deck.
  if(b.passageRole==='ground-pier'){const {contact}=volume(b),h=Math.min(b.h??9,Math.min(...first.points.map(p=>p[1]))-DECK_SLAB_DEPTH-contact);
   if(h>=1){result.push(withoutRoadSupports({...b,h:Math.round(h*100)/100},roadsAt));cut++;}else removed++;continue;}
  // A deck crossing just over a roof: the building ducks under the slab instead of being notched.
  if(!b.groundClearance){const {top,centre,contact}=volume(b),low=Math.min(...first.points.map(p=>p[1]));
   if(top-low<=ROOF_DIP){const h=low-DECK_SLAB_DEPTH-Math.max(centre,contact);
    if(h>=ROOF_MIN_HEIGHT){result.push(withoutRoadSupports({...b,h:Math.round(h*100)/100},roadsAt));cut++;continue;}}}
  // A raised volume clears the road by lifting its underside.
  if(b.groundClearance){const {contact,top}=volume(b),need=Math.max(...first.points.map(p=>p[1]))+ROAD_GATE_HEADROOM-contact;
   if(top-(contact+need)>=ROAD_GATE_MIN_VOLUME){result.push(withoutRoadSupports({...b,groundClearance:Math.round(Math.max(need,ROAD_GATE_MIN_CLEARANCE)*100)/100,clearanceSource:'road-clearance'},roadsAt));raised++;continue;}}
  let queue=[{b,...first}],pass=0,done=[];
  while(queue.length){
   const next=[];
   for(const item of queue){
    if(!item.points.length){done.push(item.b);continue;}
    if(pass>=ROAD_CUT_PASSES){removed++;continue;} // still blocking after every pass: drop the remnant
    for(const piece of cutAround(item.b,item.points,item.step)){
     // The gate clears every road inside it (stacked decks included), not just the one it was cut for.
     if(piece.gate){const {groundClearance,...solid}=piece.b,under=conflicts(solid,near).points,{contact,top}=volume(piece.b);
      const need=Math.max(piece.roadTop,...under.map(p=>p[1]))+ROAD_GATE_HEADROOM-contact;
      if(top-(contact+need)>=ROAD_GATE_MIN_VOLUME)done.push({...withoutRoadSupports(piece.b,roadsAt),groundClearance:Math.round(Math.max(need,groundClearance??0,ROAD_GATE_MIN_CLEARANCE)*100)/100,clearanceSource:'road-clearance',passageRole:'road-gate'});
      continue;}
     next.push({b:piece.b,...conflicts(piece.b,near)});}
   }
   queue=next;pass++;
  }
  cut++;result.push(...done);
 }
 return {buildings:result,cut,raised,removed,columns,kept};
}
/**
 * Road ends that join no other road (every road, any level, tunnels included): `add(p)` per road
 * centreline, then `byChunk()` → Map chunkKey → [[x,z]] (an end near a seam goes to both chunks).
 */
export class RoadDeadEnds{
 constructor(){this.ends=new Map();this.inner=new Set();}
 add(p){if(p.length<4)return;for(let i=2;i<p.length-2;i+=2)this.inner.add(nodeKey(p[i],p[i+1]));
  for(const i of [0,p.length-2]){const k=nodeKey(p[i],p[i+1]),e=this.ends.get(k);if(e)e.n++;else this.ends.set(k,{x:p[i],z:p[i+1],n:1});}}
 byChunk(margin=64){const out=new Map();
  for(const [k,e] of this.ends){if(e.n>1||this.inner.has(k))continue;
   for(let a=Math.floor((e.x-margin)/1024);a<=Math.floor((e.x+margin)/1024);a++)for(let b=Math.floor((e.z-margin)/1024);b<=Math.floor((e.z+margin)/1024);b++){const c=a+'_'+b;(out.get(c)??out.set(c,[]).get(c)).push([e.x,e.z]);}}
  this.ends.clear();this.inner.clear();return out;}
}
/** Supporting columns (supportPoints) never stand on a road. */
function withoutRoadSupports(b,roadsAt){
 if(!b.supportPoints)return b;const s=[];
 for(let i=0;i<b.supportPoints.length;i+=2){const x=b.supportPoints[i],z=b.supportPoints[i+1];if(!roadsAt(x,z).length)s.push(x,z);}
 if(s.length===b.supportPoints.length)return b;
 const {supportPoints,...rest}=b;return s.length?{...rest,supportPoints:s}:rest;
}
/**
 * Cut the oriented rectangle around the densest straight run of `points` (road samples) out of a building.
 * Returns the outside pieces (≤ 4, convex half-plane slices of the footprint) and the gate piece over
 * the road; each keeps the source attributes with its own ring and clipped holes.
 */
function cutAround(b,points,step){
 // Orientation: the narrow band holding the densest straight run of road points (a crossing or a
 // curve is not one rectangle; what this band misses is cut on the next pass).
 let best;
 for(let deg=0;deg<180;deg+=5){
  const a=deg*Math.PI/180,ux=Math.cos(a),uz=Math.sin(a),nx=-uz,nz=ux,bins=new Map();
  for(const p of points){const k=Math.floor((p[0]*nx+p[2]*nz)/step);bins.set(k,(bins.get(k)??0)+1);}
  let top=-1,kTop=0;for(const [k,c] of bins)if(c>top){top=c;kTop=k;}
  let ka=kTop,kb=kTop;while((bins.get(ka-1)??0)>=top/2)ka--;while((bins.get(kb+1)??0)>=top/2)kb++;
  let u0=Infinity,u1=-Infinity,n=0;
  for(const p of points){const k=Math.floor((p[0]*nx+p[2]*nz)/step);if(k<ka||k>kb)continue;const u=p[0]*ux+p[2]*uz;u0=Math.min(u0,u);u1=Math.max(u1,u);n++;}
  const cells=(kb-ka+1)*((u1-u0)/step+1),score=n-Math.max(0,cells-n); // every empty cell in the cut costs as much as a covered one
  if(!best||score>best.score)best={score,ux,uz,nx,nz,s0:ka*step,s1:(kb+1)*step,u0,u1};
 }
 const {ux,uz,nx,nz}=best;let {u0,u1,s0,s1}=best,roadTop=-Infinity;
 for(const p of points){const s=p[0]*nx+p[2]*nz,u=p[0]*ux+p[2]*uz;if(s>=s0&&s<=s1&&u>=u0&&u<=u1)roadTop=Math.max(roadTop,p[1]);}
 s0+=step/2;s1-=step/2; // bins are aligned to the grid; the margin below restores the half step
 const m=step*.75+.3;u0-=m;u1+=m;s0-=m;s1+=m;
 // Half-planes as a·x + c·z ≤ d; the rectangle is their intersection.
 const planes=[[-nx,-nz,-s0],[nx,nz,s1],[-ux,-uz,-u0],[ux,uz,u1]],flip=([a,c,d])=>[-a,-c,-d];
 const piece=chain=>{let p=b.p;for(const h of chain){p=clipRing(p,h);if(!p)return;}if(Math.abs(ringArea(p))<ROAD_CUT_MIN_AREA)return;
  const holes=(b.holes??[]).map(h=>{let q=h;for(const pl of chain){q=q&&clipRing(q,pl);}return q&&Math.abs(ringArea(q))>=1?q:undefined;}).filter(Boolean);
  const {holes:_h,supportPoints,...rest}=b,sp=supportPoints?.filter((_,i)=>i%2===0).map((x,i)=>[x,supportPoints[i*2+1]]).filter(([x,z])=>insideRing(p,x,z)).flat();
  return {...rest,p,...(holes.length?{holes}:{}),...(sp?.length?{supportPoints:sp}:{}),roadCut:true};};
 const out=[];
 for(let k=0;k<4;k++){const r=piece([...planes.slice(0,k),flip(planes[k])]);if(r)out.push({b:r});}
 const gate=piece(planes);if(gate)out.push({b:gate,gate:true,roadTop});
 return out;
}
/** Sutherland–Hodgman: the part of a ring with a·x + c·z ≤ d (flat [x,z,...]); undefined when empty. */
function clipRing(p,[a,c,d]){
 const o=[],n=p.length/2,inside=i=>a*p[i*2]+c*p[i*2+1]<=d+1e-9;
 for(let i=0;i<n;i++){const j=(i+1)%n,ii=inside(i),ij=inside(j);
  if(ii)o.push(p[i*2],p[i*2+1]);
  if(ii!==ij){const vi=a*p[i*2]+c*p[i*2+1]-d,vj=a*p[j*2]+c*p[j*2+1]-d,t=vi/(vi-vj);o.push(p[i*2]+(p[j*2]-p[i*2])*t,p[i*2+1]+(p[j*2+1]-p[i*2+1])*t);}}
 return o.length>=6?dedupe(o.map(v=>Math.round(v*1e4)/1e4)):undefined;
}
function ringDistance(p,x,z){let d=Infinity;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){const ax=p[j],az=p[j+1],dx=p[i]-ax,dz=p[i+1]-az,l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l));d=Math.min(d,Math.hypot(x-ax-t*dx,z-az-t*dz));}return d;}
function ringArea(p){let s=0;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)s+=p[j]*p[i+1]-p[i]*p[j+1];return s/2;}

/**
 * Approach ramps: where a deck must stay up at its portal (a crossing / roof / lower deck right
 * next to it — typical OSM tags only the span itself as a bridge), the at-grade approach road is
 * raised into a ramp up to the deck instead of leaving a step. The ramp follows the joined road
 * away from the deck, never lifts a junction (≥ 3 roads), and climbs at RAMP_GRADE, steepening
 * to MAX_GRADE when the approach is short. Whatever cannot be absorbed stays a reported residual.
 * Only the approach itself rises: a carriageway of any other road inside the ramp corridor (the
 * crossing the deck clears, a street running under the slab, the far bank road) keeps its height,
 * and the retaining wall closes the edge — lifting it pressed streets up into the deck above.
 *
 * @returns {lifts:[{path,w,step,length,grade}], residual:[{x,z,step}], lift(x,z)}
 */
export const APPROACH_FEATHER=1.5; // m beyond the carriageway edge where the lift tapers to zero (wider warps the
                                   // other half of a divided road; the retaining wall takes the rest)
export const DECK_OVERHANG_MARGIN=2;
export const RAMP_OTHER_MIN_WIDTH=3; // m — narrower ways (footways, crossings) inside a ramp corridor ride the ramp // m beyond a deck end's half width that the slab still covers
export function approachRamps(plan,ground){
 const pieces=ground.filter(g=>g.p.length>=4),byVertex=new Map(),degree=new Map();
 pieces.forEach((g,gi)=>{for(let i=0;i<g.p.length;i+=2){const k=nodeKey(g.p[i],g.p[i+1]);(byVertex.get(k)??byVertex.set(k,[]).get(k)).push([gi,i]);}
  for(const i of [0,g.p.length-2]){const k=nodeKey(g.p[i],g.p[i+1]);degree.set(k,(degree.get(k)??0)+1);}});
 // Interior vertices count twice (a road passing through is two arms).
 for(const [k,list] of byVertex)for(const [gi,i] of list){const g=pieces[gi];if(i>0&&i<g.p.length-2)degree.set(k,(degree.get(k)??0)+2);}
 const lifts=[],residual=[],elevatedVertices=new Set(plan.nodes.map(o=>nodeKey(o.x,o.z)));
 const carriageways=new Boxes(64);
 pieces.forEach((g,gi)=>{if((g.w??8)<RAMP_OTHER_MIN_WIDTH)return;for(let i=2;i<g.p.length;i+=2){const r=(g.w??8)/2;carriageways.add({x0:Math.min(g.p[i-2],g.p[i])-r,x1:Math.max(g.p[i-2],g.p[i])+r,z0:Math.min(g.p[i-1],g.p[i+1])-r,z1:Math.max(g.p[i-1],g.p[i+1])+r},[gi,g.p[i-2],g.p[i-1],g.p[i],g.p[i+1],r]);}});
 for(const n of plan.nodes){
  if(!n.portal||n.target===undefined)continue;const step=n.h-PORTAL_LIFT-n.target;if(step<=.3)continue;
  const key=nodeKey(n.x,n.z),arms=byVertex.get(key)??[];
  // Deck heading at its end: away from its only deck neighbour.
  const nb=n.edges.find(([m])=>m.level===n.level)?.[0];if(!nb){residual.push({x:n.x,z:n.z,step:+step.toFixed(2)});continue;}
  const hx=n.x-nb.x,hz=n.z-nb.z,hl=Math.hypot(hx,hz)||1;
  // A ramp merging into a road mid-way would lift a through road: only a road ending here continues it.
  let best,score=-Infinity;
  for(const [gi,i] of arms){const g=pieces[gi];if(i!==0&&i!==g.p.length-2)continue;const j=i===0?2:i-2,dx=g.p[j]-g.p[i],dz=g.p[j+1]-g.p[i+1],c=(dx*hx+dz*hz)/((Math.hypot(dx,dz)||1)*hl);if(c>score){score=c;best=[gi,i];}}
  if(!best||score<.5){residual.push({x:n.x,z:n.z,step:+step.toFixed(2)});continue;}
  // Walk the approach until a junction, a deck, or the full ramp length.
  // The deck slab extends past its end node (buffered by half its width): hold the deck height
  // under that overhang, then descend — otherwise the visible step just moves to the slab edge.
  const overhang=n.w/2+DECK_OVERHANG_MARGIN;
  const want=overhang+step/RAMP_GRADE,path=[n.x,n.z];let [gi,i]=best,walked=0,w=Math.max(n.w,pieces[gi].w??8); // the ramp carries the deck's full width
  const own=new Set([gi]);
  outer:for(let guard=0;guard<64;guard++){
   const g=pieces[gi],dir=i===0?2:-2;let k=i;
   for(;;k+=dir){
    const nk=k+dir;if(nk<0||nk>=g.p.length)break; // reached this piece's far end
    const ax=g.p[k],az=g.p[k+1],bx=g.p[nk],bz=g.p[nk+1],len=Math.hypot(bx-ax,bz-az),take=Math.min(len,want-walked);
    path.push(ax+(bx-ax)*take/(len||1),az+(bz-az)*take/(len||1));walked+=take;
    if(take<len||walked>=want)break outer;
    const vk=nodeKey(bx,bz);if((degree.get(vk)??0)>=3||elevatedVertices.has(vk))break outer;
   }
   // Continue only through a plain continuation (a seam cut or a way split), never a junction.
   const ek=nodeKey(g.p[k],g.p[k+1]);if((degree.get(ek)??0)!==2)break;
   const next=(byVertex.get(ek)??[]).find(([gj,j])=>gj!==gi&&(j===0||j===pieces[gj].p.length-2));if(!next)break;
   [gi,i]=next;own.add(gi);w=Math.max(w,pieces[gi].w??8);
  }
  const run=Math.max(walked-overhang,1e-6),grade=Math.min(MAX_GRADE,Math.max(RAMP_GRADE,step/run)),absorbed=Math.min(step,grade*run);
  if(walked>overhang){const p=dedupe(path),b=ringBox(p),r=w/2+APPROACH_FEATHER,others=[],seen=new Set();
   for(let a=Math.floor((b.x0-r)/64);a<=Math.floor((b.x1+r)/64);a++)for(let c=Math.floor((b.z0-r)/64);c<=Math.floor((b.z1+r)/64);c++)
    for(const sg of carriageways.m.get(a+':'+c)??[])if(!own.has(sg[0])&&!seen.has(sg)){seen.add(sg);others.push(sg.slice(1));}
   lifts.push({path:p,w,step:absorbed,overhang,length:overhang+absorbed/grade,grade,others});}
  if(step-absorbed>1)residual.push({x:+n.x.toFixed(2),z:+n.z.toFixed(2),step:+(step-absorbed).toFixed(2)});
 }
 return {lifts,residual,lift:rampLift(lifts)};
}
/**
 * Lift at-grade street triangles onto the approach ramps, splitting any triangle the lift boundary
 * runs through. A coarse street triangle often spans both a lifted ramp and the at-grade road it
 * leaves (a diverging slip road, the far half of a divided road): lifting only its vertices tilts
 * the whole triangle into a warped slab. Edges split on their own endpoints (length and lift
 * change), so two triangles sharing an edge split it identically and no crack opens between them;
 * a lift bump wholly inside a triangle splits it from the centroid, which leaves its edges intact.
 * `soup` is [x,y,z]*3 per triangle at the at-grade height; returns a new soup with the lift added.
 * Triangles left steeper than LIFT_STEEP_NY (the feather between a tall ramp and the road beside
 * it) are dropped: an asphalt cliff is not a road. liftSkirts then closes the opened edge with a
 * concrete retaining wall, and the terrain shows at its foot.
 */
export const LIFT_STEEP_NY=.55; // normal y below this (steeper than ~57°) → retaining wall, not road
export const LIFT_SPLIT_MIN=1.5; // m — shortest edge that is still split
export const LIFT_TOLERANCE=.15; // m a split surface may deviate from the ramp along a long edge
export function liftTriangles(soup,lift,out=[],dropped){
 // A constant ramp grade is planar and needs no split; only a bend in the lift along an edge does.
 const need=(p,q)=>{const l=Math.hypot(q[0]-p[0],q[2]-p[2]);if(l<=LIFT_SPLIT_MIN)return false;const lp=lift(p[0],p[2]),lq=lift(q[0],q[2]);
  for(const t of [.25,.5,.75])if(Math.abs(lift(p[0]+(q[0]-p[0])*t,p[2]+(q[2]-p[2])*t)-(lp+(lq-lp)*t))>LIFT_TOLERANCE)return true;return false;};
 const mid=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2,(p[2]+q[2])/2];
 const steep=p=>{const ux=p[1][0]-p[0][0],uy=p[1][1]-p[0][1],uz=p[1][2]-p[0][2],vx=p[2][0]-p[0][0],vy=p[2][1]-p[0][1],vz=p[2][2]-p[0][2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,len=Math.hypot(nx,ny,nz);return len>1e-9&&Math.abs(ny)/len<LIFT_STEEP_NY;};
 // Only a face the lift itself tipped up (the ramp's side) is dropped; a steep hillside path is kept.
 const emit=(a,b,c)=>{const p=[a,b,c].map(v=>[v[0],v[1]+lift(v[0],v[2]),v[2]]);
  if(steep(p)&&!steep([a,b,c])){dropped?.push(a[0],a[2],b[0],b[2],c[0],c[2]);return;}
  for(const v of p)out.push(v[0],v[1],v[2]);};
 const split=(a,b,c,depth)=>{
  if(depth>14)return emit(a,b,c);
  const sab=need(a,b),sbc=need(b,c),sca=need(c,a),n=sab+sbc+sca;
  if(!n){
   const g=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3],big=Math.max(Math.hypot(b[0]-a[0],b[2]-a[2]),Math.hypot(c[0]-b[0],c[2]-b[2]),Math.hypot(a[0]-c[0],a[2]-c[2]))>LIFT_SPLIT_MIN*2;
   if(big&&Math.abs(lift(g[0],g[2])-(lift(a[0],a[2])+lift(b[0],b[2])+lift(c[0],c[2]))/3)>LIFT_TOLERANCE){split(a,b,g,depth+1);split(b,c,g,depth+1);split(c,a,g,depth+1);return;}
   return emit(a,b,c);}
  if(n===3){const m1=mid(a,b),m2=mid(b,c),m3=mid(c,a);split(a,m1,m3,depth+1);split(m1,b,m2,depth+1);split(m3,m2,c,depth+1);split(m1,m2,m3,depth+1);return;}
  // Rotate so the split edges come first (winding is preserved).
  if(n===1){const [p,q,r]=sab?[a,b,c]:sbc?[b,c,a]:[c,a,b],m=mid(p,q);split(p,m,r,depth+1);split(m,q,r,depth+1);return;}
  const [p,q,r]=!sca?[a,b,c]:!sab?[b,c,a]:[c,a,b]; // splits on pq and qr
  const m1=mid(p,q),m2=mid(q,r);split(m1,q,m2,depth+1);split(p,m1,m2,depth+1);split(p,m2,r,depth+1);
 };
 for(let i=0;i+8<soup.length;i+=9)split([soup[i],soup[i+1],soup[i+2]],[soup[i+3],soup[i+4],soup[i+5]],[soup[i+6],soup[i+7],soup[i+8]],0);
 return out;
}
export const TRIM_HEADROOM=4; // m — a deck edge lower than this over a street running along it is cut back
export const TRIM_CORE=3.5;   // m each side of the deck's own centreline that is never cut
export const WELD_GRADE=.15; // cross fall allowed between welded carriageways of one level
export const WELD_ALIGN=Math.cos(Math.PI/6); // only carriageways within 30° of each other weld
export const GROUND_SPAN=8; // m — radius of the land a deck's height cap reads around each node
export const LIP_MAX_DROP=2; // m — a slab edge this low over the street it ends on is faced in asphalt, down to the street
export const GIRDER_MIN_DROP=.35; // m — no girder face along a slab edge lying this close to the surface under it
export const UNDER_DECK_LAYERS=[1,2,4]; // pavement, curb, paint: hidden under a deck lying within 1 m above them
const HIDE_DEPTH=8,HIDE_MIN_EDGE=.5,HIDE_WHOLE=2;
/**
 * Keep the parts of an at-grade triangle ([x,y,z]*3, cell metres) that a deck does not cover; push them to `out`.
 * `covered(x,z,y)` says a point lies just under a deck; removed pieces go to `dropped` as [x,z]*3. Whole-triangle tests by centroid cut pavement
 * beside the deck too (holes along the deck edge), so a triangle the deck edge crosses is split and only
 * the fully covered pieces go. Pieces still crossed at the depth limit are kept: under the slab edge
 * they are hidden by the lip/girder, beside it they are needed.
 */
export function hideUnderDeck(t,covered,out=[],depth=0,dropped){
 const c=[(t[0]+t[3]+t[6])/3,(t[1]+t[4]+t[7])/3,(t[2]+t[5]+t[8])/3];
 const hits=[covered(t[0],t[2],t[1]),covered(t[3],t[5],t[4]),covered(t[6],t[8],t[7]),covered(c[0],c[2],c[1])];
 for(const [i,j] of [[0,3],[3,6],[6,0]])hits.push(covered((t[i]+t[j])/2,(t[i+2]+t[j+2])/2,(t[i+1]+t[j+1])/2));
 const edge=Math.max(Math.hypot(t[3]-t[0],t[5]-t[2]),Math.hypot(t[6]-t[3],t[8]-t[5]),Math.hypot(t[0]-t[6],t[2]-t[8]));
 // A long sliver can have both ends and its centroid under a curving deck and its middle beside it:
 // only small pieces are judged whole.
 if(hits.every(Boolean)&&(edge<=HIDE_WHOLE||depth>=HIDE_DEPTH)){dropped?.push(t[0],t[2],t[3],t[5],t[6],t[8]);return out;}
 if(!hits.some(Boolean)||depth>=HIDE_DEPTH||edge<HIDE_MIN_EDGE){out.push(...t);return out;}
 const m=(i,j)=>[(t[i]+t[j])/2,(t[i+1]+t[j+1])/2,(t[i+2]+t[j+2])/2],a=t.slice(0,3),b=t.slice(3,6),d=t.slice(6,9),ab=m(0,3),bc=m(3,6),ca=m(6,0);
 for(const q of [[a,ab,ca],[ab,b,bc],[ca,bc,d],[ab,bc,ca]])hideUnderDeck(q.flat(),covered,out,depth+1,dropped);
 return out;
}
export const TRIM_FLUSH=.3;   // m — a slab lying on the street (a crossing met at grade) is one surface, not cut
const TRIM_PIECE=3,TRIM_PROBE=2;
export const GRADE_LOCK_REACH=10; // m — deck vertices this close to a portal or dead end keep their height in limitDeckGrade
export const DECK_SURFACE_GRADE=.35; // a deck surface never climbs faster than this between two of its vertices (≈ the 20° audit limit)
/**
 * Raise deck vertices so no mesh edge climbs faster than DECK_SURFACE_GRADE (max-plus cone from the
 * highest vertex down). Where two welded roads held different heights the blend stood as a 1–2 m
 * cliff across the junction; raised, it is a slope. `P` flat xyz, `idx` triangle indices (vertices
 * at the same position are joined), `locked(v)` true for a vertex that must keep its height (a deck
 * met at grade on its street). Returns the number of vertices raised.
 */
export function limitDeckGrade(P,idx,locked){
 const n=P.length/3,id=new Int32Array(n),key=new Map();
 for(let v=0;v<n;v++){const k=Math.round(P[v*3]*100)+','+Math.round(P[v*3+1]*100)+','+Math.round(P[v*3+2]*100);const r=key.get(k);if(r===undefined){key.set(k,v);id[v]=v;}else id[v]=r;}
 const adj=new Map(),link=(a,b)=>{if(a===b)return;(adj.get(a)??adj.set(a,[]).get(a)).push(b);};
 for(let i=0;i+2<idx.length;i+=3)for(let k=0;k<3;k++){const a=id[idx[i+k]],b=id[idx[i+(k+1)%3]];link(a,b);link(b,a);}
 const y=new Map();for(const v of adj.keys())y.set(v,P[v*3+1]);
 const heap=[...adj.keys()].map(v=>[y.get(v),v]),up=i=>{while(i>0){const p=(i-1)>>1;if(heap[p][0]>=heap[i][0])break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}},
  down=i=>{for(;;){const l=2*i+1,r=l+1;let b=i;if(l<heap.length&&heap[l][0]>heap[b][0])b=l;if(r<heap.length&&heap[r][0]>heap[b][0])b=r;if(b===i)return;[heap[b],heap[i]]=[heap[i],heap[b]];i=b;}};
 for(let i=(heap.length>>1)-1;i>=0;i--)down(i);
 const lock=new Map();
 while(heap.length){const [h,v]=heap[0];const last=heap.pop();if(heap.length){heap[0]=last;down(0);}if(h<y.get(v))continue;
  for(const u of adj.get(v)){const d=Math.hypot(P[u*3]-P[v*3],P[u*3+2]-P[v*3+2]),w=h-DECK_SURFACE_GRADE*d;if(w<=y.get(u)+.01)continue;
   if(!lock.has(u))lock.set(u,locked(u));if(lock.get(u))continue;y.set(u,w);heap.push([w,u]);up(heap.length-1);}}
 let raised=0;for(let v=0;v<n;v++){const r=y.get(id[v]);if(r!==undefined&&r>P[v*3+1]+.01){P[v*3+1]=Math.round(r*1e4)/1e4;raised++;}}
 return raised;
}
/**
 * Cut a deck slab back to its core where it hangs low over a street running along it (`soup`
 * [x,y,z]*3 with final heights). OSM widths are generous, and a 26 m ramp slab coming down between
 * frontage roads lay 1–2 m over them, reading as shattered asphalt. Real ramps narrow between the
 * side roads, with a wall on each side (girder faces on the new open edges).
 *   core(x,z)  > 0 outside the kept core of the deck's own road
 *   over(x,z)  < 0 over a street running along the deck (signed distance to its edge)
 *   gap(x,z,y) deck height y minus that street's surface; undefined where no street surface
 * Triangles touching a cut region are diced to ~3 m and clipped along core = 0 and over = 0.
 * Returns {tris, cut} (cut = pieces removed).
 */
export function trimDeckTriangles(soup,{core,over,gap}){
 const out=[];let cut=0;
 const drop=(x,z,y)=>{if(core(x,z)<=0||over(x,z)>=0)return false;const g=gap(x,z,y);return g!==undefined&&g>TRIM_FLUSH&&g<TRIM_HEADROOM;};
 const near=(x,z,y)=>{if(core(x,z)<-.05||over(x,z)>.05)return false;const g=gap(x,z,y);return g!==undefined&&g>TRIM_FLUSH-.05&&g<TRIM_HEADROOM+.05;};
 const at=(t,a,b)=>[t[0]+(t[3]-t[0])*a+(t[6]-t[0])*b,t[1]+(t[4]-t[1])*a+(t[7]-t[1])*b,t[2]+(t[5]-t[2])*a+(t[8]-t[2])*b];
 const lerp=(p,q,s)=>[p[0]+(q[0]-p[0])*s,p[1]+(q[1]-p[1])*s,p[2]+(q[2]-p[2])*s];
 const clip=(poly,fn)=>{const v=poly.map(p=>Math.max(-1e3,Math.min(1e3,fn(p[0],p[2])))),neg=[],pos=[];
  for(let i=0;i<poly.length;i++){const j=(i+1)%poly.length,p=poly[i];(v[i]<0?neg:pos).push(p);if((v[i]<0)!==(v[j]<0))neg.push(lerp(p,poly[j],v[i]/(v[i]-v[j]))),pos.push(neg[neg.length-1]);}
  return [neg,pos].filter(q=>q.length>=3);};
 const emit=poly=>{for(let i=1;i+1<poly.length;i++)out.push(...poly[0],...poly[i],...poly[i+1]);};
 const dice=(a,b,c,list)=>{const e=[[a,b,c],[b,c,a],[c,a,b]].map(([p,q,r])=>({p,q,r,l:Math.hypot(q[0]-p[0],q[2]-p[2])})).sort((u,w)=>w.l-u.l)[0];
  if(e.l<=TRIM_PIECE){list.push([a,b,c]);return;}const m=lerp(e.p,e.q,.5);dice(e.p,m,e.r,list);dice(m,e.q,e.r,list);};
 for(let i=0;i+8<soup.length;i+=9){const t=soup.slice(i,i+9);
  // Probe on a 2 m lattice: most triangles touch no cut region and keep their shape.
  const l=Math.max(Math.hypot(t[3]-t[0],t[5]-t[2]),Math.hypot(t[6]-t[0],t[8]-t[2]),Math.hypot(t[6]-t[3],t[8]-t[5])),n=Math.max(1,Math.ceil(l/TRIM_PROBE));let hit=false;
  for(let a=0;a<=n&&!hit;a++)for(let b=0;a+b<=n&&!hit;b++){const p=at(t,a/n,b/n);hit=drop(p[0],p[2],p[1]);}
  if(!hit){out.push(...t);continue;}
  const pieces=[];dice([t[0],t[1],t[2]],[t[3],t[4],t[5]],[t[6],t[7],t[8]],pieces);
  // The gap limits are cut along too (y is planar on a piece), or the edge steps piece by piece.
  const plane=(p=>{const [a,b,c]=p,ux=b[0]-a[0],uz=b[2]-a[2],vx=c[0]-a[0],vz=c[2]-a[2],det=ux*vz-uz*vx;
   return (x,z)=>{if(Math.abs(det)<1e-12)return a[1];const s=((x-a[0])*vz-(z-a[2])*vx)/det,r=(ux*(z-a[2])-uz*(x-a[0]))/det;return a[1]+(b[1]-a[1])*s+(c[1]-a[1])*r;};});
  const gapCut=(y,limit)=>(x,z)=>{const g=gap(x,z,y(x,z));return g===undefined?1e3:g-limit;};
  for(const piece of pieces){const y=plane(piece);
   for(const a of clip(piece,core))for(const b of clip(a,over))for(const c of clip(b,gapCut(y,TRIM_FLUSH)))for(const b2 of clip(c,gapCut(y,TRIM_HEADROOM))){const b=b2;
   const g=b.reduce((s,p)=>[s[0]+p[0]/b.length,s[1]+p[1]/b.length,s[2]+p[2]/b.length],[0,0,0]);
   // Every corner must lie in the cut region too (clipped corners sit on its border): a piece reaching
   // past the street surface left a hole in the slab with grass showing through.
   if(drop(g[0],g[2],g[1])&&b.every(p=>near(p[0],p[2],p[1])))cut++;else emit(b);}}
 }
 return {tris:out,cut};
}
/**
 * Closures for trimDeckTriangles over one chunk: `roads` its source roads (at-grade ones 3 m and wider
 * count), `streetTop(x,z)` the final at-grade carriageway surface, `nearest` the plan's centreline query.
 * Returns (level, own) => {core, over, gap}; only streets within 30° of the deck heading cut it.
 */
export function deckTrimTests(roads,streetTop,nearest){
 const grid=new Boxes(16);
 for(const r of roads){if(r.bridge||r.tunnel||(r.layer??0)!==0||(r.w??8)<UNDER_MIN_WIDTH)continue;const h=(r.w??8)/2;
  for(let i=2;i<r.p.length;i+=2){const sg=[r.p[i-2],r.p[i-1],r.p[i],r.p[i+1],h];grid.add({x0:Math.min(sg[0],sg[2])-h,x1:Math.max(sg[0],sg[2])+h,z0:Math.min(sg[1],sg[3])-h,z1:Math.max(sg[1],sg[3])+h},sg);}}
 const along=(x,z,dir)=>{let best=Infinity;for(const [ax,az,bx,bz,h] of grid.at(x,z)){const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz)||1e-9;if(Math.abs(dir.dx*dz-dir.dz*dx)/len>=UNDER_MAX_SIN)continue;
  const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(len*len)));best=Math.min(best,Math.hypot(x-ax-t*dx,z-az-t*dz)-h);}return best;};
 return (level,own)=>({core:(x,z)=>{const n=nearest(x,z,level,own);return n?n.d-Math.min(n.w/2,TRIM_CORE):-1;},
  over:(x,z)=>{const n=nearest(x,z,level,own);return n?along(x,z,n):Infinity;},
  gap:(x,z,y)=>{const top=streetTop(x,z);return top===undefined?undefined:y-top;}});
}
/** Separate scope: the lift is used for every street vertex later, the walk indexes are not. */
function rampLift(lifts){
 const grid=new Boxes(64);
 for(const l of lifts){const b=ringBox(l.path),r=l.w/2+APPROACH_FEATHER;grid.add({x0:b.x0-r,x1:b.x1+r,z0:b.z0-r,z1:b.z1+r},l);}
 /** Height added to the at-grade street surface at (x,z): the highest ramp covering the point. */
 return (x,z)=>{let best=0;for(const l of grid.at(x,z)){let s=0,bestD=Infinity,along=0;const p=l.path;
   for(let i=2;i<p.length;i+=2){const ax=p[i-2],az=p[i-1],dx=p[i]-ax,dz=p[i+1]-az,len=Math.hypot(dx,dz)||1e-9,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(len*len))),d=Math.hypot(x-ax-t*dx,z-az-t*dz);if(d<bestD){bestD=d;along=s+t*len;}s+=len;}
   if(along>l.length||l.others.some(([ax,az,bx,bz,r])=>{const dx=bx-ax,dz=bz-az,q=dx*dx+dz*dz||1e-9,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/q)),d=Math.hypot(x-ax-t*dx,z-az-t*dz);return d<=r&&d<bestD;}))continue;const half=l.w/2,f=bestD<=half?1:bestD>=half+APPROACH_FEATHER?0:1-(bestD-half)/APPROACH_FEATHER;
   best=Math.max(best,(l.step-l.grade*Math.max(0,along-l.overhang))*f);}
  return best;};
}
function dedupe(p){const o=[p[0],p[1]];for(let i=2;i<p.length;i+=2)if(Math.hypot(p[i]-o[o.length-2],p[i+1]-o[o.length-1])>.01)o.push(p[i],p[i+1]);return o;}

/**
 * Retaining-wall skirts for a lifted at-grade street mesh: every open edge whose vertices were
 * raised gets a vertical face down to the original surface, so a ramp never shows a slot.
 * `tris` are the lifted triangles of all SKIRT_LAYERS together ([x,y,z]*3, cell metres), so an edge
 * shared by two layers (carriageway | pavement) is interior and gets no wall; `lift(x,z)` the amount added.
 */
/** Ground layers whose shared outline gets retaining walls: pavement, curb, carriageway (paint lies on top). */
export const SKIRT_LAYERS=[1,2,3];
export function liftSkirts(tris,lift,edgeOfChunk){
 const edges=new Map(),faces=[];
 for(const t of tris){const cx=(t[0]+t[3]+t[6])/3,cz=(t[2]+t[5]+t[8])/3;
  for(let k=0;k<3;k++){const i=k*3,j=((k+1)%3)*3,ka=t[i].toFixed(3)+','+t[i+2].toFixed(3),kb=t[j].toFixed(3)+','+t[j+2].toFixed(3),key=ka<kb?ka+'|'+kb:kb+'|'+ka;
   const e=edges.get(key);if(e)e.count++;else edges.set(key,{count:1,a:[t[i],t[i+1],t[i+2]],b:[t[j],t[j+1],t[j+2]],out:[(t[i]+t[j])/2-cx,0,(t[i+2]+t[j+2])/2-cz]});}}
 const face=(p0,p1,p2,out)=>{const ux=p1[0]-p0[0],uy=p1[1]-p0[1],uz=p1[2]-p0[2],vx=p2[0]-p0[0],vy=p2[1]-p0[1],vz=p2[2]-p0[2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;if(nx*out[0]+ny*out[1]+nz*out[2]<0)faces.push(...p0,...p2,...p1);else faces.push(...p0,...p1,...p2);};
 for(const e of edges.values()){if(e.count!==1||edgeOfChunk(e.a[0],e.a[2])&&edgeOfChunk(e.b[0],e.b[2]))continue;
  const la=lift(e.a[0],e.a[2]),lb=lift(e.b[0],e.b[2]);if(la<=.05&&lb<=.05)continue;
  const A=e.a,B=e.b,C=[B[0],B[1]-lb,B[2]],D=[A[0],A[1]-la,A[2]];face(A,B,C,e.out);face(A,C,D,e.out);}
 return faces;
}

/**
 * Height-only copy of a chunkTerrainEntry: the full entry also references the chunk's whole
 * compiledStreet, obstacle rings and road list, so keeping one per chunk city-wide pins every
 * street mesh in memory. sampleChunkLandHeight reads only these fields.
 */
export function slimTerrain(t){return t?{size:t.size,step:t.step,cellX0:t.cellX0,cellZ0:t.cellZ0,heights:t.heights,...(t.roadHeights?{roadHeights:t.roadHeights}:{})}:null;}
