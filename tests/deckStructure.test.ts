import {it,expect,describe} from 'vitest';
// @ts-expect-error build script module
import {createDeckProfile,deckStructures,planCityDecks,meshPieces,refitDeckSplits,approachRamps,liftSkirts,liftTriangles,hideUnderDeck,trimDeckTriangles,TRIM_CORE,WELD_GRADE,limitDeckGrade,holdsDeckEnd,DECK_SURFACE_GRADE,TRIM_HEADROOM,LIFT_SPLIT_MIN,LIFT_STEEP_NY,nodeKey,DECK_CLEARANCE,RAMP_GRADE,MAX_GRADE,PORTAL_LIFT,DECK_SLAB_DEPTH,DECK_HEADROOM,LAYER_HOLD,streamClearance,clearBuildingsOfRoads,ROAD_GATE_HEADROOM} from '../scripts/deck-structure.mjs';

const flat=()=>0;
const keys=(...pts:number[][])=>new Set(pts.map(([x,z])=>nodeKey(x,z)));
const line=(x0:number,z0:number,x1:number,z1:number,level=1,w=10)=>({p:[x0,z0,x1,z1],level,w});

describe('deck height profile',()=>{
 it('ramps an overpass down to both joined roads and keeps clearance over the crossing',()=>{
  const prof=createDeckProfile({lines:[line(0,0,300,0)],groundKeys:keys([0,0],[300,0]),terrain:flat,portalHeight:()=>0,
   beneath:(x:number)=>x>140&&x<160?DECK_CLEARANCE:undefined});
  expect(prof.height(0,0,1)).toBeCloseTo(PORTAL_LIFT,2);
  expect(prof.height(300,0,1)).toBeCloseTo(PORTAL_LIFT,2);
  expect(prof.height(150,0,1)).toBeCloseTo(DECK_CLEARANCE,1);
  // No vertical cliff anywhere: neighbouring samples never exceed the steepest allowed grade.
  for(let x=0;x<300;x+=4)expect(Math.abs(prof.height(x+4,0,1)-prof.height(x,0,1))/4).toBeLessThanOrEqual(MAX_GRADE+1e-6);
  expect(prof.conflicts).toEqual([]);
 });
 it('treats a source layer as stacking order, not metres (layer 18 with nothing beneath)',()=>{
  const prof=createDeckProfile({lines:[line(0,0,400,0,18)],groundKeys:keys([0,0]),terrain:flat,portalHeight:()=>0,interior:()=>false});
  expect(prof.height(400,0,18)).toBeCloseTo(DECK_CLEARANCE,5); // one level, never 18 × 5 m
  expect(prof.height(0,0,18)).toBeCloseTo(PORTAL_LIFT,2);
  expect(prof.height(30,0,18)).toBeCloseTo(PORTAL_LIFT+30*RAMP_GRADE,1);
 });
 it('stacks a deck one clearance above the deck actually running underneath',()=>{
  const prof=createDeckProfile({lines:[line(-200,0,200,0,1),line(0,-200,0,200,2)],groundKeys:new Set(),terrain:flat,interior:()=>false});
  expect(prof.height(0,-200,2)).toBeCloseTo(DECK_CLEARANCE,5);          // nothing under its far end
  expect(prof.height(0,0,2)).toBeCloseTo(prof.height(0,0,1)+DECK_CLEARANCE,1);
 });
 it('lands an interior dead end on the terrain but leaves a clipped edge alone',()=>{
  const inside=createDeckProfile({lines:[line(0,0,200,0)],groundKeys:new Set(),terrain:()=>10});
  expect(inside.height(0,0,1)).toBeCloseTo(10+PORTAL_LIFT,2);
  const clipped=createDeckProfile({lines:[line(0,0,200,0)],groundKeys:new Set(),terrain:()=>10,interior:()=>false});
  expect(clipped.height(0,0,1)).toBeCloseTo(10+DECK_CLEARANCE,5);
 });
 it('measures each portal against its own road on a hillside (a lower portal never sets its target)',()=>{
  // 200 m deck down a 10% slope: the upper portal's road is 20 m above the lower one's.
  const slope=(x:number)=>20-.1*x;
  const prof=createDeckProfile({lines:[line(0,0,200,0)],groundKeys:keys([0,0],[200,0]),terrain:slope,portalHeight:slope,
   beneath:(x:number)=>x>8&&x<16?DECK_CLEARANCE:undefined});
  const top=prof.nodes.find((n:{x:number,z:number})=>n.x===0&&n.z===0);
  expect(top.target).toBeCloseTo(20+PORTAL_LIFT,5);
  expect(top.h-top.target).toBeLessThan(DECK_CLEARANCE); // the real step, not 20 m
 });
 it('meets a crossing at grade when the portal cones cannot climb to its clearance',()=>{
  // 40 m deck, crossing at its middle: 8 % from either portal plus what a ramp absorbs stays under 5 m.
  // Holding 5 m there stood as a hump whose slab edges hung 1–4 m over the streets around it.
  const short=createDeckProfile({lines:[line(0,0,40,0)],groundKeys:keys([0,0],[40,0]),terrain:flat,portalHeight:()=>0,
   beneath:(x:number)=>x>15&&x<25?DECK_CLEARANCE:undefined});
  expect(short.height(20,0,1)).toBeCloseTo(PORTAL_LIFT,2);
  expect(short.conflicts).toEqual([]);
  expect(short.stats.flushCrossings).toBeGreaterThan(0);
  // 120 m: the cones reach 4.8 m at the middle, the approach ramps take the rest — the clearance holds.
  const long=createDeckProfile({lines:[line(0,0,120,0)],groundKeys:keys([0,0],[120,0]),terrain:flat,portalHeight:()=>0,
   beneath:(x:number)=>x>55&&x<65?DECK_CLEARANCE:undefined});
  expect(long.height(60,0,1)).toBeCloseTo(DECK_CLEARANCE,1);
  expect(long.stats.flushCrossings).toBe(0);
 });
 it('welds the roads of one deck to a cross fall: each slab keeps its own height, the overlap slides between',()=>{
  // Two parallel 10 m decks 8 m apart; the z = 8 one clears a street 8 m below it: 5 m and 8 m mid-span.
  const prof=createDeckProfile({lines:[line(0,0,300,0),line(0,8,300,8)],groundKeys:keys([0,0],[300,0],[0,8],[300,8]),
   terrain:flat,portalHeight:()=>0,beneath:(x:number,z:number)=>z>4&&x>100&&x<200?3+DECK_CLEARANCE:undefined});
  const both=new Set([0,1]);
  // The lower one rises to within WELD_GRADE of its neighbour: a cross fall, not a fold.
  expect(prof.height(150,0,1,undefined,both)).toBeCloseTo(3+DECK_CLEARANCE-WELD_GRADE*8,2);
  expect(prof.height(150,8,1,undefined,both)).toBeCloseTo(3+DECK_CLEARANCE,2);
  const gore=prof.height(150,4,1,undefined,both);
  expect(gore).toBeGreaterThan(DECK_CLEARANCE+.5);expect(gore).toBeLessThan(3+DECK_CLEARANCE-.5);
 });
 it('carries a bridge on when OSM raises its layer mid-span (no 5 m jump over itself)',()=>{
  const prof=createDeckProfile({lines:[{p:[0,0,100,0],level:1,w:26},{p:[100,0,300,0],level:2,w:26}],groundKeys:keys([0,0],[300,0]),terrain:flat,portalHeight:()=>0,interior:()=>false});
  expect(Math.abs(prof.height(108,0,2)-prof.height(100,0,1))).toBeLessThanOrEqual(8*MAX_GRADE+.05);
 });
 it('stacks two same-layer decks that cross without a shared vertex',()=>{
  // Both tagged layer=1; B crosses over A at (100,0). A crossing street keeps B up there first.
  const ground=[{p:[-50,0,0,0],w:8},{p:[200,0,250,0],w:8},{p:[100,-150,100,-100],w:8},{p:[100,100,100,150],w:8}];
  const plan=planCityDecks({terrain:()=>0,portalHeight:()=>0,interior:()=>true,ground,elevated:[{p:[0,0,200,0],level:1,w:10},{p:[100,-100,100,100],level:1,w:10}]});
  expect(plan.stats.sameLevelStacks).toBe(1);
  const a=plan.height(100,0,1,undefined,new Set([0])),b=plan.height(100,0,1,undefined,new Set([1]));
  expect(Math.abs(a-b)).toBeGreaterThanOrEqual(DECK_CLEARANCE-.01);
 });
 it('stacks a wide deck over a narrower one running beside its axis',()=>{
  // Upper slab 24 m wide, lower 12 m wide, centrelines 10 m apart: the slabs overlap by 8 m.
  const prof=createDeckProfile({lines:[{p:[0,10,200,10],level:1,w:12},{p:[-100,0,300,0],level:2,w:24}],groundKeys:keys([0,10],[200,10],[-100,0],[300,0]),terrain:flat,portalHeight:()=>0,interior:()=>false});
  expect(prof.height(100,0,2)-prof.height(100,10,1)).toBeGreaterThanOrEqual(DECK_CLEARANCE-.01);
 });
 it('gives each deck strip the height of its own road, not the neighbour beside it',()=>{
  // Strip A (24 m, axis z 0) runs low; strip B (12 m, axis z 18) clears a crossing at x 100.
  const ground=[{p:[-50,0,0,0],w:8},{p:[200,0,250,0],w:8},{p:[-50,18,0,18],w:8},{p:[200,18,250,18],w:8},{p:[100,14,100,80],w:4}]; // the crossing passes under B only
  const plan=planCityDecks({terrain:()=>0,portalHeight:()=>0,interior:()=>true,elevated:[{p:[0,0,60,0],level:1,w:24},{p:[60,0,200,0],level:1,w:24,bridge:false},{p:[0,18,200,18],level:1,w:12}],ground});
  const strip=(z0:number,z1:number)=>[[0,0,z0,200,0,z0,200,0,z1],[0,0,z0,200,0,z1,0,0,z1]];
  const pieces=meshPieces([...strip(-12,12),...strip(12.5,24)]);
  expect(pieces.length).toBe(2);
  const ownA=plan.linesThrough(strip(-12,12),1),ownB=plan.linesThrough(strip(12.5,24),1);
  expect(ownA?.size).toBe(2);expect(ownB?.size).toBe(1);
  // A's far edge lies 6 m from B's axis and 12 m from its own: it must keep A's height.
  const edgeA=plan.height(100,11.9,1,undefined,ownA),axisA=plan.height(100,0,1),axisB=plan.height(100,18,1);
  expect(axisB-axisA).toBeGreaterThan(1);
  expect(edgeA).toBeCloseTo(axisA,1);
 });
 it('continues a branching deck from its junction height',()=>{
  // The ramp joins at an interior vertex of the mainline, as OSM junctions do.
  const prof=createDeckProfile({lines:[{p:[0,0,100,0,200,0],level:1,w:10},line(100,0,100,150,2)],groundKeys:keys([100,150]),terrain:flat,portalHeight:()=>0,interior:()=>false});
  const junction=prof.height(100,0,1),next=prof.height(100,8,2);
  expect(Math.abs(next-junction)).toBeLessThanOrEqual(8*MAX_GRADE+.05);
  expect(prof.stats.deadEnds).toBe(0); // the junction is a continuation, not a stub
  expect(prof.height(100,150,2)).toBeCloseTo(PORTAL_LIFT,2);
 });
});

describe('deck structures',()=>{
 const tri=(y:number)=>[[0,y,0,10,y,0,10,y,10],[0,y,0,10,y,10,0,y,10]];
 it('closes girders on open edges only and skips seam cuts',()=>{
  const {faces}=deckStructures({tris:tri(8),lines:[],height:()=>8,terrain:flat,blocked:()=>false,edgeOfChunk:(x:number)=>x===10});
  // 2 undersides (3 verts) + 3 open edges × 2 outward tris × 3 verts; the x=10 seam edge has none.
  expect(faces.length/3).toBe(2*3+3*2*3);
  const lowest=Math.min(...faces.filter((_:number,i:number)=>i%3===1));
  expect(lowest).toBeCloseTo(8-DECK_SLAB_DEPTH,5);
 });
 it('faces a low slab edge standing on the street in asphalt, not concrete',()=>{
  // Slab .6 m over a street that covers x<5 only: the x=0 edge is a lip, the others stay girders.
  const r=deckStructures({tris:tri(.6),lines:[],height:()=>.6,terrain:(x:number)=>x<5?0:-.5,blocked:()=>false,edgeOfChunk:()=>false,street:(x:number)=>x<5?0:undefined});
  expect(r.lips.length/9).toBe(2);
  for(let i=0;i<r.lips.length;i+=3)expect(r.lips[i]).toBeCloseTo(0,5);
  expect(r.faces.length/9).toBe(2+3*2); // undersides + the three edges reaching over land
  // Deeper than the slab (1.6 m over the street): the lip still reaches the street, no slit under it.
  const deep=deckStructures({tris:tri(1.6),lines:[],height:()=>1.6,terrain:(x:number)=>x<5?0:-.5,blocked:()=>false,edgeOfChunk:()=>false,street:(x:number)=>x<5?0:undefined});
  expect(Math.min(...deep.lips.filter((_:number,i:number)=>i%3===1))).toBeCloseTo(0,5);
 });
 it('turns a cliff between two welded roads into a slope, keeping a locked deck end',()=>{
  // A 1 m strip of vertices x = 0..20: heights 10 for x ≥ 10, 8 below; x = 0 is met at grade (locked).
  const P:number[]=[],idx:number[]=[];
  for(let x=0;x<=20;x++)P.push(x,x>=10?10:8,0,x,x>=10?10:8,1);
  for(let x=0;x<20;x++){const a=x*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);}
  const raised=limitDeckGrade(P,idx,(v:number)=>P[v*3]===0);
  expect(raised).toBeGreaterThan(0);
  for(let x=0;x<20;x++)expect(Math.abs(P[(x+1)*6+1]-P[x*6+1])).toBeLessThanOrEqual(DECK_SURFACE_GRADE+.011);
  expect(P[1]).toBe(8);expect(P[9*6+1]).toBeCloseTo(10-DECK_SURFACE_GRADE,5);
 });
 it('lowers a span into a slope down to a deck pinned flush to its junction',()=>{
  // x = 0 is met at grade at 8 m (locked); the span beside it holds 11 m from x = 2 on — a 3 m cliff raising cannot fix.
  const P:number[]=[],idx:number[]=[];
  for(let x=0;x<=20;x++)P.push(x,x>=2?11:8,0,x,x>=2?11:8,1);
  for(let x=0;x<20;x++){const a=x*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);}
  const locked=(v:number)=>P[v*3]===0;
  expect(limitDeckGrade(P,idx,locked)).toBeGreaterThan(0);
  for(let x=0;x<20;x++)expect(Math.abs(P[(x+1)*6+1]-P[x*6+1])).toBeLessThanOrEqual(DECK_SURFACE_GRADE+.011);
  expect(P[1]).toBe(8);expect(P[4*6+1]).toBeCloseTo(8+4*DECK_SURFACE_GRADE,5);expect(P[20*6+1]).toBe(11);
 });
 it('pins only deck vertices that ramp from a nearby deck end',()=>{
  const end:[number,number,number]=[0,0,10];
  expect(holdsDeckEnd(end,4,10.5,0)).toBe(true);   // on the ramp
  expect(holdsDeckEnd(end,4,9,0)).toBe(true);      // below the end
  expect(holdsDeckEnd(end,4,13,0)).toBe(false);    // a span standing 3 m above it, 4 m away
  expect(holdsDeckEnd(end,12,10,0)).toBe(false);   // out of reach
 });
 it('places piers only where the column fits and never on a blocked footprint',()=>{
  const lines=[line(0,0,120,0)];
  const open=deckStructures({tris:[],lines,height:()=>8,terrain:flat,blocked:()=>false,edgeOfChunk:()=>false});
  expect(open.volumes.length).toBe(4);
  for(const v of open.volumes){expect(v.top).toBeCloseTo(8-DECK_SLAB_DEPTH,5);expect(v.base).toBeLessThan(0);}
  const road=deckStructures({tris:[],lines,height:()=>8,terrain:flat,blocked:(x:number)=>x>40&&x<80,edgeOfChunk:()=>false});
  expect(road.volumes.length).toBe(2);
  const low=deckStructures({tris:[],lines,height:()=>2,terrain:flat,blocked:()=>false,edgeOfChunk:()=>false});
  expect(low.volumes.length).toBe(0);
 });
});

describe('city deck plan',()=>{
 const base={terrain:()=>0,portalHeight:()=>0,interior:()=>true};
 it('holds clearance over a transverse road but ramps along the road it joins',()=>{
  // Deck x 0..300 joins an at-grade road at both ends and passes over a road at x=150.
  const plan=planCityDecks({...base,elevated:[{p:[0,0,300,0],level:1,w:10}],
   ground:[{p:[-100,0,0,0],w:8},{p:[300,0,400,0],w:8},{p:[150,-80,150,80],w:12}]});
  expect(plan.stats.crossings).toBe(1);
  expect(plan.height(150,0,1)).toBeCloseTo(DECK_CLEARANCE,1);
  expect(plan.height(0,0,1)).toBeCloseTo(PORTAL_LIFT,2);
  expect(plan.conflicts).toEqual([]);
 });
 it('does not mistake a ramp merging alongside its road for a crossing',()=>{
  const plan=planCityDecks({...base,elevated:[{p:[0,0,200,0],level:1,w:8}],
   ground:[{p:[-50,2,0,0,80,6],w:8}]}); // shallow-angle merge near the portal
  expect(plan.stats.crossings).toBe(0);
 });
 it('keeps clearance over water; a building under a deck never lifts it',()=>{
  const water=planCityDecks({...base,elevated:[{p:[0,0,400,0],level:1,w:10}],ground:[{p:[-10,0,0,0]},{p:[400,0,410,0]}],
   water:[{p:[150,-50,250,-50,250,50,150,50]}]});
  expect(water.height(200,0,1)).toBeCloseTo(DECK_CLEARANCE,1);
  // Roof riding left decks hanging between towers at roof height; buildings are no longer an input.
  const roof=planCityDecks({...base,elevated:[{p:[0,0,400,0],level:1,w:10}],ground:[{p:[-10,0,0,0]},{p:[400,0,410,0]}],
   buildings:[{p:[180,-20,220,-20,220,20,180,20],h:60}]} as any);
  expect(roof.height(200,0,1)).toBeLessThanOrEqual(DECK_CLEARANCE+.01);
 });
 it('bridges a narrow stream low, a river area at full clearance',()=>{
  const lines=[{p:[0,0,60,0],level:1,w:6}],ground=[{p:[-10,0,0,0]},{p:[60,0,70,0]}];
  const stream=planCityDecks({...base,elevated:lines,ground,water:[{p:[30,-40,30,40],w:6}]});
  const mid=stream.height(30,0,1);expect(mid).toBeGreaterThanOrEqual(streamClearance(6)-.01);expect(mid).toBeLessThan(RAMP_GRADE*30+.1); // a gentle arch, not a 5 m hump
  expect(streamClearance(6)).toBeLessThan(DECK_CLEARANCE);
  const river=planCityDecks({...base,elevated:[{p:[0,0,400,0],level:1,w:10}],ground:[{p:[-10,0,0,0]},{p:[400,0,410,0]}],water:[{p:[150,-50,250,-50,250,50,150,50]}]});
  expect(river.height(200,0,1)).toBeCloseTo(DECK_CLEARANCE,1);
 });
 it('keeps clearance over a street running under the slab, not over the road it joins',()=>{
  // 160 m deck along a 12 m street 3 m off its axis; approaches join at both ends.
  const ground=[{p:[-50,0,0,0],w:8},{p:[160,0,210,0],w:8}],street={p:[-100,3,300,3],w:12};
  const alone=planCityDecks({...base,elevated:[{p:[0,0,160,0],level:1,w:10}],ground});
  expect(alone.height(80,0,1)).toBeLessThanOrEqual(DECK_CLEARANCE+.01);     // nothing under: the plain 5 m deck
  expect(alone.stats.streetsUnder).toBe(0);
  const over=planCityDecks({...base,elevated:[{p:[0,0,160,0],level:1,w:10}],ground:[...ground,street]});
  expect(over.height(80,0,1)).toBeGreaterThanOrEqual(DECK_CLEARANCE-.01);    // the street below keeps it up
  expect(over.stats.streetsUnder).toBeGreaterThan(0);
  const raised=planCityDecks({...base,terrain:(_x:number,z:number)=>z>=2?3:0,elevated:[{p:[0,0,160,0],level:1,w:10}],ground:[...ground,street]});
  expect(raised.height(80,0,1)).toBeGreaterThanOrEqual(3+DECK_CLEARANCE-.01);  // measured from the street, 3 m above the median
  const joined=planCityDecks({...base,elevated:[{p:[0,0,160,0],level:1,w:10}],ground:[{p:[-50,0,0,0,160,3,210,3],w:12}]});
  expect(joined.stats.streetsUnder).toBe(0);                                    // its own approach road is not under it
 });
 it('arches a short bridge over a river area within its portal ramps (no step, no ramp)',()=>{
  // A 38 m city bridge over a channel drawn as a water area: both banks are at-grade portals.
  const ground=[{p:[-50,0,0,0],w:10},{p:[38,0,90,0],w:10}];
  const plan=planCityDecks({...base,elevated:[{p:[0,0,38,0],level:1,w:20}],ground,water:[{p:[-200,8,200,8,200,30,-200,30]}]});
  expect(plan.height(19,0,1)).toBeLessThanOrEqual(PORTAL_LIFT+RAMP_GRADE*19+.01);
  expect(plan.conflicts).toEqual([]);
  expect(approachRamps(plan,ground).lifts).toEqual([]);
 });
 it('returns a layer-only way to grade away from its crossing (estate roads over car parks)',()=>{
  // layer=1 without a bridge tag, 400 m between two portals, one road crossing at x=100.
  const lines=[{p:[0,0,400,0],level:1,w:6,bridge:false}];
  const estate=planCityDecks({...base,elevated:lines,ground:[{p:[-10,0,0,0]},{p:[400,0,410,0]},{p:[100,-40,100,40]}]});
  expect(estate.height(100,0,1)).toBeCloseTo(DECK_CLEARANCE,1);
  expect(estate.height(100+LAYER_HOLD,0,1)).toBeCloseTo(DECK_CLEARANCE,1);
  expect(estate.height(300,0,1)).toBeLessThan(.2); // back on the ground, not at clearance
  // Nothing underneath: the whole way stays at grade.
  const plain=planCityDecks({...base,elevated:lines,ground:[{p:[-10,0,0,0]},{p:[400,0,410,0]}]});
  for(const x of [50,200,350])expect(plain.height(x,0,1)).toBeLessThan(.2);
  // The same geometry tagged as a bridge keeps its span up between the portals.
  const bridge=planCityDecks({...base,elevated:[{...lines[0],bridge:true}],ground:[{p:[-10,0,0,0]},{p:[400,0,410,0]}]});
  expect(bridge.height(200,0,1)).toBeCloseTo(DECK_CLEARANCE,1);
 });
 it('carries a layer-only continuation off a bridge before returning to grade',()=>{
  const plan=planCityDecks({...base,elevated:[{p:[0,0,200,0],level:1,w:8,bridge:true},{p:[200,0,500,0],level:1,w:8,bridge:false}],
   ground:[{p:[-10,0,0,0]},{p:[500,0,510,0]},{p:[100,-40,100,40]}]});
  const at=plan.height(200,0,1);expect(at).toBeGreaterThan(3);
  expect(plan.height(200+LAYER_HOLD-4,0,1)).toBeCloseTo(at,1);
  expect(Math.abs(plan.height(200+LAYER_HOLD+20,0,1)-(at-RAMP_GRADE*20))).toBeLessThan(RAMP_GRADE*8);
  expect(plan.height(450,0,1)).toBeLessThan(.2);
 });
});

describe('deck geometry orientation and tower refit',()=>{
 it('winds girder faces outward and undersides downward',()=>{
  const t=[[0,8,0,10,8,0,0,8,10]];
  const {faces}=deckStructures({tris:t,lines:[],height:()=>8,terrain:flat,blocked:()=>false,edgeOfChunk:()=>false});
  const centroid=[10/3,10/3];
  for(let i=0;i<faces.length;i+=9){
   const a=faces.slice(i,i+3),b=faces.slice(i+3,i+6),c=faces.slice(i+6,i+9);
   const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
   const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
   if(Math.abs(n[1])>1e-9){expect(n[1]).toBeLessThan(0);continue;} // underside faces down
   const mx=(a[0]+b[0]+c[0])/3-centroid[0],mz=(a[2]+b[2]+c[2])/3-centroid[1];
   expect(n[0]*mx+n[2]*mz).toBeGreaterThan(0);                       // girder faces outward
  }
 });
 it('refits a split tower around a lowered deck',()=>{
  const strip={level:1,p:[0,0,20,0,20,10,0,10]};
  const parts=[{deckSplit:'t',passageRole:'upper-volume',deckStrips:[strip],h:100,groundClearance:145,p:strip.p},
   {deckSplit:'t',passageRole:'ground-pier',h:145,p:[0,0,1,0,1,1,0,1]},
   {deckSplit:'t',passageRole:'deck-podium',h:30,p:strip.p},{passageRole:'upper-volume',h:50,groundClearance:20,p:strip.p}];
  const {buildings,changed}=refitDeckSplits(parts,()=>5,()=>0);
  expect(changed).toBe(3);
  expect(buildings[0].groundClearance).toBeCloseTo(5+.15+DECK_HEADROOM,2);
  expect(buildings[1].h).toBeCloseTo(5+.15+DECK_HEADROOM,2);
  expect(buildings[2].h).toBeCloseTo(5-.3,2);
  expect(buildings[3]).toBe(parts[3]); // not deck-split: untouched
 });
});

describe('approach ramps',()=>{
 const base={terrain:()=>0,portalHeight:()=>0,interior:()=>true};
 it('raises the at-grade approaches of a span-only bridge into ramps that meet the deck',()=>{
  // A 100 m layer-2 span over a layer-1 deck at its middle: 10 m there, still 2.5 m up at the portals.
  // (A street crossing is met at grade instead when the span is this short — see the profile tests.)
  const ground=[{p:[-300,0,0,0],w:10},{p:[100,0,400,0],w:10},{p:[50,-300,50,-200],w:10},{p:[50,200,50,300],w:10}];
  const plan=planCityDecks({...base,elevated:[{p:[0,0,100,0],level:2,w:10},{p:[50,-200,50,200],level:1,w:10}],ground});
  const {lifts,residual,lift}=approachRamps(plan,ground);
  expect(lifts.length).toBe(2);expect(residual).toEqual([]);
  for(const [x,dir] of [[0,-1],[100,1]] as const){
   const deckY=plan.height(x,0,2),roadAtPortal=lift(x,0);
   expect(Math.abs(deckY-PORTAL_LIFT-roadAtPortal)).toBeLessThan(.05);       // no step at the portal
   expect(Math.abs(lift(x+dir*6,0)-roadAtPortal)).toBeLessThan(.05);        // held under the slab overhang
   for(let s=0;s<120;s+=4)expect(lift(x+dir*s,0)-lift(x+dir*(s+4),0)).toBeLessThanOrEqual(4*MAX_GRADE+1e-6);
   expect(lift(x+dir*150,0)).toBe(0);                                         // back on the ground
  }
  expect(lift(-20,30)).toBe(0); // the lift stays on the approach corridor
 });
 it('steepens a short approach and reports the step it cannot absorb',()=>{
  // 15 m to a junction: the 7 m slab overhang leaves an 8 m run for the ramp.
  const ground=[{p:[-15,0,0,0],w:10},{p:[-15,-50,-15,0,-15,50],w:10},{p:[100,0,400,0],w:10},{p:[50,-300,50,-200],w:10},{p:[50,200,50,300],w:10}];
  const plan=planCityDecks({...base,elevated:[{p:[0,0,100,0],level:2,w:10},{p:[50,-200,50,200],level:1,w:10}],ground});
  const {lifts,residual}=approachRamps(plan,ground);
  const short=lifts.find((l:{path:number[]})=>l.path[0]===0);
  expect(short.grade).toBeCloseTo(MAX_GRADE,5);
  expect(residual.length).toBe(1);
  expect(residual[0].x).toBe(0);
 });
 it('lifts only its own road: a street under the slab and the far bank road keep their height',()=>{
  // Layer-2 deck x 0–100 held at the portal by the deck under it at x 50; a street crosses the approach at x −4.
  const ground=[{p:[-300,0,0,0],w:10},{p:[100,0,400,0],w:10},{p:[50,-300,50,-200],w:10},{p:[50,200,50,300],w:10},{p:[-4,-80,-4,80],w:10}];
  const plan=planCityDecks({...base,elevated:[{p:[0,0,100,0],level:2,w:10},{p:[50,-200,50,200],level:1,w:10}],ground});
  const {lift}=approachRamps(plan,ground);
  expect(lift(-4,40)).toBe(0);                       // the other street, outside the corridor
  expect(lift(-4,3)).toBe(0);                        // and inside it: nearer its own centreline
  expect(lift(-12,0)).toBeGreaterThan(.3);           // the approach beyond it still ramps
 });
 it('never lifts a through road a ramp merges into',()=>{
  const ground=[{p:[-300,0,0,0,300,0],w:12},{p:[60,-80,60,80],w:10}];
  const plan=planCityDecks({...base,elevated:[{p:[0,0,80,0],level:1,w:8}],ground});
  const {lifts}=approachRamps(plan,ground);
  expect(lifts).toEqual([]);
 });
});

describe('trimming deck slabs over streets',()=>{
 // A 20 m deck along x (z −10..10) beside a 12 m street centred at z = 12 (edges 6..18), street surface 0.
 const deckAt=(y:number)=>[0,y,-10,40,y,10,40,y,-10, 0,y,-10,0,y,10,40,y,10];
 const tests={core:(_x:number,z:number)=>Math.abs(z)-TRIM_CORE,over:(_x:number,z:number)=>Math.abs(z-12)-6,gap:(_x:number,_z:number,y:number)=>y};
 const area=(t:number[])=>{let a=0;for(let i=0;i<t.length;i+=9)a+=Math.abs((t[i+3]-t[i])*(t[i+8]-t[i+2])-(t[i+6]-t[i])*(t[i+5]-t[i+2]))/2;return a;};
 it('cuts the edge hanging 1–4 m over the street back to the street edge',()=>{
  const {tris,cut}=trimDeckTriangles(deckAt(2),tests);
  expect(cut).toBeGreaterThan(0);
  for(let i=0;i<tris.length;i+=9)expect((tris[i+2]+tris[i+5]+tris[i+8])/3).toBeLessThanOrEqual(6+1e-6);
  expect(area(tris)).toBeCloseTo(40*16,0);
 });
 it('keeps a slab with full clearance, and one lying on the street (met at grade)',()=>{
  expect(trimDeckTriangles(deckAt(TRIM_HEADROOM+1),tests).tris).toEqual(deckAt(TRIM_HEADROOM+1));
  expect(trimDeckTriangles(deckAt(PORTAL_LIFT),tests).tris).toEqual(deckAt(PORTAL_LIFT));
 });
 it('leaves no hole where the street surface stops short of its drawn width',()=>{
  // The street surface ends at z = 8 (its centreline width says 18): only z 6..8 may go.
  const {tris}=trimDeckTriangles(deckAt(2),{...tests,gap:(_x:number,z:number,y:number)=>z<=8?y:undefined});
  expect(area(tris)).toBeGreaterThanOrEqual(40*18-1);
  expect(area(tris)).toBeLessThan(40*20);
 });
 it('never cuts into the core around its own centreline',()=>{
  const {tris}=trimDeckTriangles(deckAt(2),{...tests,over:()=>-1});
  expect(area(tris)).toBeCloseTo(40*2*TRIM_CORE,0);
 });
});

describe('approach retaining walls',()=>{
 it('walls only the outer outline of the lifted carriageway + pavement, never their shared edge',()=>{
  // Carriageway z 0–10 and pavement z 10–13, both lifted 2 m, along x 0–20.
  const strip=(z0:number,z1:number)=>[[0,2,z0,20,2,z0,20,2,z1],[0,2,z0,20,2,z1,0,2,z1]];
  const faces=liftSkirts([...strip(0,10),...strip(10,13)],()=>2,()=>false);
  const walls=faces.length/18; // two triangles per wall quad
  expect(walls).toBe(6);      // z=0 and z=13 long sides + 4 short ends; the z=10 seam has none
  for(let i=0;i<faces.length;i+=9)expect(faces[i+2]===10&&faces[i+5]===10&&faces[i+8]===10).toBe(false); // no wall along the seam
 });
});

describe('T-junction portals',()=>{
 it('lands a deck end on the middle of a road segment it meets without a shared vertex',()=>{
  const plan=planCityDecks({terrain:()=>0,portalHeight:()=>0,interior:()=>true,
   elevated:[{p:[0,0,200,0],level:1,w:8}],ground:[{p:[200.8,-100,200.8,100],w:10},{p:[-60,0,0,0],w:8}]});
  expect(plan.stats.deadEnds).toBe(0);
  expect(plan.height(200,0,1)).toBeCloseTo(PORTAL_LIFT,2);
 });
 it('still treats an end far from any road as a dead end',()=>{
  const plan=planCityDecks({terrain:()=>0,portalHeight:()=>0,interior:()=>true,
   elevated:[{p:[0,0,200,0],level:1,w:8}],ground:[{p:[230,-100,230,100],w:10},{p:[-60,0,0,0],w:8}]});
  expect(plan.stats.deadEnds).toBe(1);
 });
});

describe('elevated topology gaps and ramp width',()=>{
 it('continues a deck that stops just short of the next elevated piece, even over a road',()=>{
  const plan=planCityDecks({terrain:()=>0,portalHeight:()=>0,interior:()=>false,
   elevated:[{p:[0,0,100,0],level:1,w:10},{p:[101,.5,300,0],level:1,w:10}],ground:[{p:[100,-50,100,50],w:12}]});
  expect(plan.stats.portals).toBe(0);expect(plan.stats.deadEnds).toBe(0);
  expect(plan.height(100,0,1)).toBeCloseTo(DECK_CLEARANCE,1);
 });
 it('lifts the approach across the full deck width, not just the narrower joined road',()=>{
  const ground=[{p:[-300,0,0,0],w:3},{p:[40,0,340,0],w:3},{p:[20,-80,20,80],w:10}];
  const plan=planCityDecks({terrain:()=>0,portalHeight:()=>0,interior:()=>true,elevated:[{p:[0,0,40,0],level:1,w:12}],ground});
  const {lift}=approachRamps(plan,ground);
  expect(lift(-8,5)).toBeCloseTo(lift(-8,0),2); // 5 m off-centre is still under the deck width
 });
});

describe('lifting at-grade triangles onto a ramp',()=>{
 // A 40 × 20 m road quad (two coarse triangles); the ramp lifts only the strip z 0–6, up to 1 m
 // (a gentle edge that stays road) or 5 m (a cliff that becomes a retaining wall).
 const quad=[0,0,0,40,0,0,40,0,20, 0,0,0,40,0,20,0,0,20];
 const ramp=(top:number)=>(x:number,z:number)=>z<=6?top*(x/40):z>=7.5?0:top*(x/40)*(1-(z-6)/1.5);
 const lift=ramp(1);
 const out=liftTriangles(quad,lift);
 const tris:number[][]=[];for(let i=0;i<out.length;i+=9)tris.push(out.slice(i,i+9));
 const area=(t:number[])=>Math.abs((t[3]-t[0])*(t[8]-t[2])-(t[6]-t[0])*(t[5]-t[2]))/2;
 it('keeps the footprint and the winding',()=>{
  expect(tris.reduce((s,t)=>s+area(t),0)).toBeCloseTo(800,3);
  for(const t of tris)expect((t[3]-t[0])*(t[8]-t[2])-(t[6]-t[0])*(t[5]-t[2])).toBeGreaterThan(0);
 });
 it('follows the ramp inside every triangle (no warped slab) without splitting a plain grade',()=>{
  // Barycentric samples inside each emitted triangle vs the lift itself.
  let worst=0;
  for(const t of tris){const big=Math.max(...[0,1,2].map(k=>Math.hypot(t[((k+1)%3)*3]-t[k*3],t[((k+1)%3)*3+2]-t[k*3+2])));if(big<=LIFT_SPLIT_MIN*2)continue;
   for(const [u,v] of [[.25,.25],[.5,.25],[.25,.5],[1/3,1/3]]){const w=1-u-v,x=u*t[0]+v*t[3]+w*t[6],z=u*t[2]+v*t[5]+w*t[8],y=u*t[1]+v*t[4]+w*t[7];worst=Math.max(worst,Math.abs(y-lift(x,z)));}}
  expect(worst).toBeLessThanOrEqual(.35);
  for(const t of tris)for(let k=0;k<9;k+=3)expect(t[k+1]).toBeCloseTo(lift(t[k],t[k+2]),6);
  // A uniform grade over the whole quad stays two triangles.
  expect(liftTriangles(quad,(x:number)=>x*.08).length).toBe(quad.length);
 });
 it('hides only the part of a pavement triangle the deck covers (no hole beside the deck)',()=>{
  const tri=[0,0,0, 20,0,0, 0,0,20],covered=(x:number)=>x<8; // deck over x<8
  const out=hideUnderDeck(tri,covered),area=(t:number[])=>Math.abs((t[3]-t[0])*(t[8]-t[2])-(t[6]-t[0])*(t[5]-t[2]))/2;
  const inside=(t:number[],x:number,z:number)=>{const d=(t[5]-t[8])*(t[0]-t[6])+(t[6]-t[3])*(t[2]-t[8]),a=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))/d,b=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))/d;return a>=-1e-9&&b>=-1e-9&&a+b<=1+1e-9;};
  let kept=0;for(let i=0;i<out.length;i+=9)kept+=area(out.slice(i,i+9));
  for(let x=8.05;x<20;x+=.5)for(let z=.05;x+z<20;z+=.5)expect([...Array(out.length/9).keys()].some(i=>inside(out.slice(i*9,i*9+9),x,z))).toBe(true); // nothing beside the deck is lost
  expect(kept).toBeLessThan(200*.5);expect(kept).toBeGreaterThan(72);
  // A sliver whose ends and centroid are under a curving deck keeps the middle that is beside it.
  const sliver=[0,0,0, 40,0,0, 0,0,1],curve=(x:number)=>x<3||x>37||Math.abs(x-40/3)<1,mid=hideUnderDeck(sliver,curve);
  expect([...Array(mid.length/9).keys()].some(i=>inside(mid.slice(i*9,i*9+9),25,.1))).toBe(true);
  expect(hideUnderDeck(tri,()=>false)).toEqual(tri);
  expect(hideUnderDeck(tri,()=>true)).toEqual([]);
 });
 it('keeps a hillside path that was already steep before any lift',()=>{
  const cliff=[0,0,0, 4,0,0, 0,10,1]; // ~84° pavement face on a mountain trail, no ramp near it
  expect(liftTriangles(cliff,()=>0)).toEqual(cliff);
 });
 it('drops a cliff-steep feather so a retaining wall closes it instead of an asphalt slope',()=>{
  const tall=ramp(5),soup=liftTriangles(quad,tall);
  let kept=0;for(let i=0;i<soup.length;i+=9){const t=soup.slice(i,i+9);kept+=area(t);
   const ux=t[3]-t[0],uy=t[4]-t[1],uz=t[5]-t[2],vx=t[6]-t[0],vy=t[7]-t[1],vz=t[8]-t[2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
   expect(Math.abs(ny)/Math.hypot(nx,ny,nz)).toBeGreaterThanOrEqual(LIFT_STEEP_NY);}
  expect(kept).toBeLessThan(800);expect(kept).toBeGreaterThan(800-40*1.5-1);
  const asTris:number[][]=[];for(let i=0;i<soup.length;i+=9)asTris.push(soup.slice(i,i+9));
  expect(liftSkirts(asTris,tall,()=>false).length).toBeGreaterThan(0);
 });
 it('opens no crack: every interior edge is shared by exactly two triangles',()=>{
  const key=(x:number,z:number)=>x.toFixed(4)+','+z.toFixed(4),edges=new Map<string,number>();
  for(const t of tris)for(let k=0;k<3;k++){const a=key(t[k*3],t[k*3+2]),b=key(t[((k+1)%3)*3],t[((k+1)%3)*3+2]),e=a<b?a+'|'+b:b+'|'+a;edges.set(e,(edges.get(e)??0)+1);}
  const onBoundary=(e:string)=>e.split('|').map(p=>p.split(',').map(Number)).every(([x,z])=>x===0||x===40||z===0||z===20)&&(()=>{const [[x1,z1],[x2,z2]]=e.split('|').map(p=>p.split(',').map(Number));return x1===x2&&(x1===0||x1===40)||z1===z2&&(z1===0||z1===20);})();
  for(const [e,n] of edges)expect(onBoundary(e)?n:2).toBe(n);
 });
});

describe('roads never run through buildings',()=>{
 // A 10 m road strip along x (z 20..30) at height y, as two triangles per 10 m.
 const road=(y:number,x0=-20,x1=80)=>{const t:number[][]=[];for(let x=x0;x<x1;x+=10)t.push([x,y,20,x+10,y,20,x+10,y,30],[x,y,20,x+10,y,30,x,y,30]);return t;};
 const square=(x0:number,z0:number,s:number)=>[x0,z0,x0+s,z0,x0+s,z0+s,x0,z0+s];
 const area=(p:number[])=>{let s=0;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)s+=p[j]*p[i+1]-p[i]*p[j+1];return Math.abs(s/2);};
 const inside=(p:number[],x:number,z:number)=>{let c=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){const xi=p[i],zi=p[i+1],xj=p[j],zj=p[j+1];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;};
 it('leaves a building beside the road untouched',()=>{
  const b={p:square(0,40,20),h:30};
  expect(clearBuildingsOfRoads([b],road(0),flat).buildings).toEqual([b]);
 });
 it('cuts a low building along an at-grade road and drops the part over it',()=>{
  const r=clearBuildingsOfRoads([{p:square(0,10,30),h:6}],road(0),flat);
  expect(r.cut).toBe(1);
  for(const b of r.buildings){expect(b.groundClearance).toBeUndefined();for(const [x,z] of [[15,25],[5,21],[25,29]])expect(inside(b.p,x,z)).toBe(false);}
  expect(r.buildings.reduce((s,b)=>s+area(b.p),0)).toBeGreaterThan(900-10*30-3*30);
 });
 it('lowers a building a deck crosses just under its roof below the slab instead of notching it',()=>{
  const r=clearBuildingsOfRoads([{p:square(0,10,30),h:10}],road(9.5),flat);
  expect(r.buildings).toHaveLength(1);expect(r.buildings[0].h).toBeCloseTo(9.5-DECK_SLAB_DEPTH,2);
  expect(r.buildings[0].p).toEqual(square(0,10,30));
 });
 it('keeps a tower over the road as a gate above the headroom',()=>{
  const r=clearBuildingsOfRoads([{p:square(0,10,30),h:40}],road(5),flat),gate=r.buildings.find(b=>b.passageRole==='road-gate');
  expect(gate?.groundClearance).toBeCloseTo(5+ROAD_GATE_HEADROOM,1);
  expect(inside(gate!.p,15,25)).toBe(true);
  expect(r.buildings.filter(b=>!b.groundClearance).every(b=>!inside(b.p,15,25))).toBe(true);
 });
 it('raises a gate over every stacked deck inside it',()=>{
  const r=clearBuildingsOfRoads([{p:square(0,10,30),h:40}],[...road(0),...road(10,0,30)],flat),gate=r.buildings.find(b=>b.passageRole==='road-gate');
  expect(gate?.groundClearance).toBeGreaterThanOrEqual(10+ROAD_GATE_HEADROOM-.01);
 });
 it('lifts a raised volume to clear a deck instead of cutting it',()=>{
  const r=clearBuildingsOfRoads([{p:square(0,10,30),h:30,groundClearance:6,supportPoints:[15,25,2,12]}],road(5),flat);
  expect(r.raised).toBe(1);expect(r.buildings).toHaveLength(1);
  expect(r.buildings[0].groundClearance).toBeCloseTo(5+ROAD_GATE_HEADROOM,1);
  expect(r.buildings[0].supportPoints).toEqual([2,12]); // no column on the carriageway
 });
 it('drops a column standing on a road under a high building',()=>{
  const r=clearBuildingsOfRoads([{p:square(0,10,30),h:30,groundClearance:12,supportPoints:[15,25,2,12]}],road(0),flat);
  expect(r.columns).toBe(1);expect(r.buildings[0].supportPoints).toEqual([2,12]);expect(r.buildings[0].groundClearance).toBe(12);
 });
 it('leaves an existing 3 m passage over an at-grade road as it is',()=>{
  const b={p:square(0,10,30),h:20,groundClearance:3.3};
  expect(clearBuildingsOfRoads([b],road(0),flat).buildings).toEqual([b]);
 });
 it('leaves a road that ends inside a building entering it (car park ramp)',()=>{
  const b={p:square(0,10,30),h:20},r=clearBuildingsOfRoads([b],road(5,-20,15),flat,[[15,25]]);
  expect(r.buildings).toEqual([b]);
 });
 it('never touches authored models',()=>{
  const b={p:square(0,10,30),h:20,landmarkModel:'x'};
  const r=clearBuildingsOfRoads([b],road(0),flat);expect(r.buildings).toEqual([b]);expect(r.kept).toHaveLength(1);
 });
 it('cuts a crossing pair of roads out of a large podium',()=>{
  const cross:number[][]=[...road(0)];for(let z=-20;z<80;z+=10)cross.push([40,0,z,50,0,z,50,0,z+10],[40,0,z,50,0,z+10,40,0,z+10]);
  const r=clearBuildingsOfRoads([{p:square(0,0,60),h:8}],cross,flat);
  for(const b of r.buildings)for(const [x,z] of [[45,5],[45,55],[5,25],[55,25],[45,25]])expect(inside(b.p,x,z)&&!b.groundClearance).toBe(false);
  // Four corner blocks stay at full height: the cut follows each road, not one diagonal box.
  const solid=r.buildings.filter(b=>!b.groundClearance);
  for(const [x,z] of [[15,8],[55,8],[15,45],[55,45]])expect(solid.some(b=>inside(b.p,x,z))).toBe(true);
 });
});
