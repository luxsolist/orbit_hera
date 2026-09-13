import {it,expect,vi,afterEach} from 'vitest';
import {StreetPreparation} from '../src/world/StreetPreparation';
import {seoulAppearance} from '../src/world/cities';
const terrain={size:2,step:10,cellX0:0,cellZ0:0,heights:new Float32Array(4)};
afterEach(()=>vi.unstubAllGlobals());
it('matches worker responses and terminates outstanding work on world disposal',async()=>{
 let instance:Fake;
 class Fake {
  onmessage!:(e:unknown)=>void;onerror!:()=>void;
  messages:{id:number}[]=[];terminated=false;
  constructor(){instance=this;}
  postMessage(m:{id:number}){this.messages.push(m);}
  terminate(){this.terminated=true;}
 }
 vi.stubGlobal('Worker',Fake);
 const worker=new StreetPreparation();
 const a=worker.prepare([],terrain,0,0,seoulAppearance.street),b=worker.prepare([],terrain,0,0,seoulAppearance.street);
 instance!.onmessage({data:{id:instance!.messages[1].id,data:[]}});expect(await b).toEqual([]);
 const rejection=expect(a).rejects.toThrow('World disposed');worker.dispose();await rejection;
 expect(instance!.terminated).toBe(true);await expect(worker.prepare([],terrain,0,0,seoulAppearance.street)).rejects.toThrow('World disposed');
});
