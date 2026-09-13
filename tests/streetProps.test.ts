import {it,expect} from 'vitest';
import {streetPropSites} from '../src/world/StreetProps';
import type {WorldChunk} from '../src/world/chunkManifest';
const chunk={cx:0,cz:0,terrain:null,underground:null,objects:{roads:[{p:[5,50,195,50],w:10}],buildings:[{p:[0,40,40,40,40,60,0,60]}],water:[{p:[80,35,110,35,110,65,80,65]}],areas:[{k:'park',p:[120,30,195,30,195,70,120,70]}]}} as WorldChunk;
it('keeps sparse roadside props outside buildings, water and carriageways',()=>{
 const sites=streetPropSites(chunk,200);expect(sites.length).toBeGreaterThan(0);expect(sites.some(p=>p.tree)).toBe(true);
 for(const p of sites){expect(p.x).toBeGreaterThan(42);expect(p.x<80||p.x>110).toBe(true);expect(Math.abs(p.z-50)).toBeGreaterThan(5.7);}
 expect(streetPropSites(chunk,200)).toEqual(sites);
});
it('caps detail density per chunk',()=>{
 const roads=Array.from({length:30},(_,i)=>({p:[5,10+i*30,1010,10+i*30],w:6}));
 const sites=streetPropSites({...chunk,objects:{roads,buildings:[],water:[]}},1024);
 expect(sites.length).toBe(48);
 for(let i=0;i<sites.length;i++)for(let j=0;j<i;j++)expect(Math.hypot(sites[i].x-sites[j].x,sites[i].z-sites[j].z)).toBeGreaterThan(14);
});
