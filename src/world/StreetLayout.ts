import {resolveRoadContext,solveRoadNetwork,roadSegmentKey,type RoadSource,type RoadCorridor} from './RoadNetwork';
import {pilotRoadNetwork,pilotWeight} from './cities/CheonggyePilot';
const caches=[new WeakMap<readonly RoadSource[],Map<string,RoadCorridor>>(),new WeakMap<readonly RoadSource[],Map<string,RoadCorridor>>()];
/** Render geometry and furniture share the same final source priority and corridor joins. */
export function streetContext(roads:readonly RoadSource[],pilot:boolean):Map<string,RoadCorridor>|undefined {
 // A flagged tile or a synthetic preview outside the authored area does not need
 // the complete river context (and its paint plan).
 pilot=pilot&&roads.some(r=>r.p.some((x,i)=>i%2===0&&pilotWeight(x,r.p[i+1])>0));
 const cache=caches[pilot?1:0];let n=cache.get(roads);if(!n){const local=solveRoadNetwork(roads);n=pilot?resolveRoadContext(roads,pilotRoadNetwork):local;
  if(pilot)n=solveRoadNetwork([...n.values()].filter(c=>!local.has(c.key)).map(c=>({p:[...c.a,...c.b],w:c.w})).concat([...local.values()].map(c=>({p:[...c.a,...c.b],w:c.w}))));cache.set(roads,n);}return n;
}
export function streetCorridor(network:Map<string,RoadCorridor>|undefined,p:number[]):RoadCorridor|undefined {
 const c=network?.get(roadSegmentKey(p));
 return c;
}
