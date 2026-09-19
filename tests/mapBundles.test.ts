import {ChunkPreparation} from '../src/world/ChunkPreparation';
import {paintedSeoul} from '../src/world/cities/painted';
import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import index from '../src/world/seoul-bundles.json';
import {fetchMapBundle,readMapBundle,bundleEntry} from '../src/world/MapBundles';
import {fetchWorldChunk} from '../src/world/mapLocator';
afterEach(()=>vi.unstubAllGlobals());
it('packs all 1600 Seoul chunks and every runtime landmark/road overlay without changing data',()=>{
 const seen=new Set<string>();expect(Object.keys(index.bundles)).toHaveLength(400);
 for(const [key,entry] of Object.entries(index.bundles)){
  const bytes=readFileSync(`public/maps/bundles/seoul/${entry.file}`);expect(bytes.length).toBe(entry.bytes);
  const data=gunzipSync(bytes);expect(data.length).toBe(entry.rawBytes);const bundle=JSON.parse(data.toString());expect(bundle.key).toBe(key);
  for(const [k,value] of Object.entries(bundle.chunks) as [string,any][]){
   expect(seen.has(k)).toBe(false);seen.add(k);const [x,z]=k.split('_').map(Number);
   const original=JSON.parse(readFileSync(`public/maps/37/126/${Math.floor(x/16)}_${Math.floor(z/16)}/${k}.json`,'utf8'));expect(value.raw).toEqual(original);
   for(const [field,path] of [['detail',`details/seoul/${k}`],['roadGrade',`road-grade/37/126/${k}`],['appearance',`landmark-appearance/seoul/${k}`]]){
    const p=`public/maps/${path}.json`;expect(value[field]).toEqual(existsSync(p)?JSON.parse(readFileSync(p,'utf8')):null);
   }
  }
 }expect(seen.size).toBe(1600);
},30000);
it('shares a compressed download across four requests, decodes it and retains the correction path',async()=>{
 const entry=bundleEntry([37,126],84,46)!;const bytes=readFileSync(`public/maps/bundles/seoul/${entry.file}`);
 const fetcher=vi.fn(async()=>new Response(bytes));vi.stubGlobal('fetch',fetcher);
 const base='http://bundles.test/';const requests=[[84,46],[85,46],[84,47],[85,47]];
 const packed=await Promise.all(requests.map(([x,z])=>fetchMapBundle([37,126],x,z,base)!));expect(fetcher).toHaveBeenCalledTimes(1);expect(packed[0]).toBe(packed[3]);
 const rows=await Promise.all(requests.map(([x,z])=>readMapBundle([37,126],x,z,base)));expect(rows.every(r=>r?.raw)).toBe(true);
 const result=await fetchWorldChunk([37,126],84,46,16,base);expect(result?.cx).toBe(84);expect(result?.seoulDetail).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(1);
 expect(bundleEntry([35,129],84,46)).toBeUndefined();
});
it('does not retain failed transfers and retries safely',async()=>{
 const entry=bundleEntry([37,126],84,46)!;const bytes=readFileSync(`public/maps/bundles/seoul/${entry.file}`);
 const fn=vi.fn().mockResolvedValueOnce(new Response('bad')).mockResolvedValueOnce(new Response(bytes));vi.stubGlobal('fetch',fn);
 await expect(fetchMapBundle([37,126],84,46,'http://retry.test/')).rejects.toThrow('size mismatch');
 expect(await readMapBundle([37,126],84,46,'http://retry.test/')).toBeTruthy();expect(fn).toHaveBeenCalledTimes(2);
});

it('downloads queued chunks together and preserves shared transfer when one consumer cancels',async()=>{
 const instances:Fake[]=[];class Fake{onmessage!:(e:any)=>void;onerror!:()=>void;messages:any[]=[];constructor(){instances.push(this);}postMessage(m:any){this.messages.push(m);}terminate(){}}
 vi.stubGlobal('Worker',Fake);const entry=bundleEntry([37,126],84,46)!;const bytes=readFileSync(`public/maps/bundles/seoul/${entry.file}`);
 let complete!:(r:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{complete=resolve;}));vi.stubGlobal('fetch',fetcher);
 const prep=new ChunkPreparation(),abort=new AbortController();const job={cell:[37,126] as [number,number],cx:84,cz:46,block:16,size:1024,ox:0,oz:0,profile:paintedSeoul,baseUrl:'http://queue.test/'};
 const a=prep.prepare('a',job,abort.signal),b=prep.prepare('b',{...job,cx:85});expect(fetcher).toHaveBeenCalledTimes(1);expect(instances).toHaveLength(0);
 const rejected=expect(a).rejects.toThrow('cancelled');abort.abort();await rejected;complete(new Response(bytes));
 await vi.waitFor(()=>expect(instances[0]?.messages.length).toBe(1));const message=instances[0].messages[0];expect(message.job.bundlePayload.data.byteLength).toBe(bytes.length);
 instances[0].onmessage({data:{id:message.id,packet:null}});expect(await b).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);prep.dispose();
});
