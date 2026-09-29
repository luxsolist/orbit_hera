import {it,expect} from 'vitest';
import {solveRoadNetwork,resolveRoadContext,roadSegmentKey,corridorFootprint} from '../src/world/RoadNetwork';
it('final carriageway widths override stale context before joined cross sections are computed',()=>{
 const stale=solveRoadNetwork([{p:[0,0,60,0,120,12],w:28}]);
 const roads=[{p:[0,0,60,0],w:8},{p:[60,0,120,12],w:8}];const final=resolveRoadContext(roads,stale);
 expect([...final.values()].map(c=>c.w)).toEqual([8,8]);
 const a=final.get(roadSegmentKey(roads[0].p))!,b=final.get(roadSegmentKey(roads[1].p))!;
 expect(a.endWidth).toBe(8);expect(b.startWidth).toBe(8);
 expect(corridorFootprint(a)[1]).toEqual(corridorFootprint(b)[0]);
 expect([...stale.values()].every(c=>c.w===28)).toBe(true);
 expect(resolveRoadContext(roads,final)).toBe(final);
});
it('source priority is independent of direction and source order and retains contextual neighbours',()=>{
 const stale=solveRoadNetwork([{p:[0,0,60,0,120,0],w:28}]);
 const roads=[{p:[60,0,0,0],w:8},{p:[0,0,60,0],w:10}];
 expect([...resolveRoadContext(roads,stale)]).toEqual([...resolveRoadContext([...roads].reverse(),stale)]);
 const n=resolveRoadContext(roads,stale);expect(n.get(roadSegmentKey([0,0,60,0]))!.w).toBe(8);expect(n.get(roadSegmentKey([60,0,120,0]))!.w).toBe(28);
});
