import {it,expect} from 'vitest';
import {auditRoadProfile} from '../scripts/road-profile.mjs';
it('distinguishes a continuous hillside from oscillation and checks the road sides',()=>{
 const roads=[{p:[0,0,128,0],w:12}];
 const slope=auditRoadProfile(roads,(x:number)=>x*.2);
 expect(slope.steepSegments).toBe(1);expect(slope.roughSegments).toBe(0);
 const wave=auditRoadProfile(roads,(x:number)=>4*Math.sin(x/8));
 expect(wave.roughSegments).toBe(1);
 const side=auditRoadProfile(roads,(x:number,z:number)=>z<0?8*Math.sin(x/8):0);
 expect(side.roughSegments).toBe(1);
 expect(auditRoadProfile([{...roads[0],tunnel:true}],()=>NaN).samples).toBe(0);
 expect(auditRoadProfile(roads,()=>NaN).invalidSamples).toBeGreaterThan(0);
});
