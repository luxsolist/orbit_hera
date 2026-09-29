import {ChunkPreparation} from '../src/world/ChunkPreparation';
import {paintedSeoul} from '../src/world/cities/painted';
import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import busan from '../src/world/busan-bundles.json';
import athensDetails from '../src/world/cities/athens-detail-index.json';
import romeDetails from '../src/world/cities/rome-detail-index.json';
import {applyMapCorrections} from '../src/world/MapCorrections';
import {fetchMapBundle,readMapBundle,bundleEntry} from '../src/world/MapBundles';
import {fetchWorldChunk} from '../src/world/mapLocator';
afterEach(()=>vi.unstubAllGlobals());
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

it('loads Busan bridge/coast corrections from bundles through the shared correction path',async()=>{
 const fetcher=vi.fn(async(input:any)=>new Response(readFileSync('public/'+new URL(String(input)).pathname.slice(1))));vi.stubGlobal('fetch',fetcher);
 let bridges=0,negative=0,partial=0;
 for(const entry of Object.values(busan.bundles)){
  const payload=JSON.parse(gunzipSync(readFileSync(`public/maps/bundles/busan/${entry.file}`)).toString());
  if(entry.chunks.length<4)partial++;
  for(const [key,value] of Object.entries(payload.chunks) as [string,any][]){
   const [x,z]=key.split('_').map(Number);expect(bundleEntry([35,129],x,z)?.file).toBe(entry.file);if(x<0||z<0)negative++;
   if(!value.detail)continue;
   bridges+=(value.detail.bridges?.length??0);
   const expected=applyMapCorrections([35,129],value.raw,value);
   expect(await fetchWorldChunk([35,129],x,z,16,'http://busan.test/')).toEqual(expected);
  }
 }
 expect(bridges).toBeGreaterThan(0);expect(negative).toBeGreaterThan(0);expect(partial).toBeGreaterThan(0);
},30000);

it('loads all Rome landmark overlays and additions through the bundled correction path',async()=>{
 const fetcher=vi.fn(async(input:any)=>{const path=new URL(String(input)).pathname;expect(path).toMatch(/^\/maps\/bundles\/rome\/.*\.bin$/);return new Response(readFileSync('public'+path));});vi.stubGlobal('fetch',fetcher);
 let additions=0,sites=0;
 for(const key of romeDetails.chunks){const [x,z]=key.split('_').map(Number),base='http://rome-packed.test/';const packed=(await readMapBundle([41,12],x,z,base))!;
  const result=await fetchWorldChunk([41,12],x,z,16,base);
  expect(result).toEqual(applyMapCorrections([41,12],packed.raw,packed));
  additions+=((packed.detail??packed.raw.mapBuild?.input.detail) as any)?.add?.length??0;sites+=(packed.detail??packed.raw.mapBuild?.input.detail)?.romeSites?.length??0;
 }
 expect(additions).toBeGreaterThan(0);expect(sites).toBe(3);expect(fetcher).toHaveBeenCalled();
});

it('loads Athens landmarks through bundles without separate detail requests',async()=>{
 const fetcher=vi.fn(async(input:any)=>{const path=new URL(String(input)).pathname;expect(path).toMatch(/^\/maps\/bundles\/athens\/.*\.bin$/);return new Response(readFileSync('public'+path));});vi.stubGlobal('fetch',fetcher);
 let sites=0;
 for(const key of athensDetails.chunks){const [x,z]=key.split('_').map(Number),base='http://athens-packed.test/';const packed=(await readMapBundle([37,23],x,z,base))!;
  expect(await fetchWorldChunk([37,23],x,z,16,base)).toEqual(applyMapCorrections([37,23],packed.raw,packed));
  sites+=(packed.detail??packed.raw.mapBuild?.input.detail)?.athensSites?.length??0;
 }
 expect(sites).toBeGreaterThan(0);
});
