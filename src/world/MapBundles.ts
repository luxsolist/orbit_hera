import cities from '../../config/map-cities.json';
import type {Cell,WorldChunk} from './chunkManifest';
import type {SeoulDetail} from './cities/SeoulDetail';
import type {RoadGradePatch} from './RoadGradePatch';
import type {LandmarkAppearancePatch} from './cities/SeoulLandmarkAppearance';
export interface BundleChunk {raw:WorldChunk;detail:SeoulDetail|null;roadGrade:RoadGradePatch|null;appearance:LandmarkAppearancePatch|null}
interface Bundle {version:number;cell:number[];key:string;chunks:Record<string,BundleChunk>}
interface Entry {file:string;bytes:number;rawBytes:number;sha256:string;chunks:string[]}
export interface BundlePayload {url:string;data:ArrayBuffer}
// Vite discovers registered city indices without adding a source import per city.
const modules=import.meta.glob<{default:{cell:number[];size:number;bundles:Record<string,Entry>}}>('./*-bundles.json',{eager:true});
const byCell=new Map<string,{city:string;size:number;bundles:Record<string,Entry>}>();
for(const [city,cell] of Object.entries(cities)){
 const index=modules[`./${city}-bundles.json`]?.default;
 if(!index||index.cell.join('/')!==cell.join('/')||index.size!==2||byCell.has(cell.join('/')))throw new Error(`Invalid map registration: ${city}`);
 byCell.set(cell.join('/'),{city,...index});
}
const cityOf=(cell:Cell)=>byCell.get(cell.join('/'))?.city;
const compressed=new Map<string,BundlePayload>(),decoded=new Map<string,{value:Bundle;size:number}>();
const downloading=new Map<string,Promise<BundlePayload>>(),decoding=new Map<string,Promise<Bundle>>();
const COMPRESSED_LIMIT=16*1024*1024,DECODED_LIMIT=32*1024*1024;
function trim<T>(cache:Map<string,T>,size:(v:T)=>number,limit:number){let total=0;for(const v of cache.values())total+=size(v);while(total>limit&&cache.size){const key=cache.keys().next().value!;total-=size(cache.get(key)!);cache.delete(key);}}
function touch<T>(cache:Map<string,T>,key:string){const v=cache.get(key);if(v){cache.delete(key);cache.set(key,v);}return v;}
export function bundleEntry(cell:Cell,cx:number,cz:number){const index=byCell.get(cell.join('/'));const entry=index?.bundles[`${Math.floor(cx/2)}_${Math.floor(cz/2)}`];return entry?.chunks.includes(`${cx}_${cz}`)?entry:undefined;}
/** Requests are shared, not cancelled when just one of the four consumers leaves view. */
export function fetchMapBundle(cell:Cell,cx:number,cz:number,baseUrl?:string):Promise<BundlePayload>|undefined {
 const entry=bundleEntry(cell,cx,cz);if(!entry||typeof DecompressionStream==='undefined')return;
 const path=`maps/bundles/${cityOf(cell)}/${entry.file}`,url=baseUrl?new URL(path,baseUrl).href:`${import.meta.env.BASE_URL}${path}`;
 const cached=touch(compressed,url);if(cached)return Promise.resolve(cached);
 const active=downloading.get(url);if(active)return active;
 const request=(async()=>{const response=await fetch(url,{cache:'force-cache'});if(!response.ok)throw new Error(`Map bundle HTTP ${response.status}`);
 const data=await response.arrayBuffer();if(data.byteLength!==entry.bytes)throw new Error('Map bundle size mismatch');
 const value={url,data};compressed.set(url,value);trim(compressed,v=>v.data.byteLength,COMPRESSED_LIMIT);return value;})();
 downloading.set(url,request);void request.finally(()=>downloading.delete(url)).catch(()=>{});return request;
}
export async function readMapBundle(cell:Cell,cx:number,cz:number,baseUrl?:string,payload?:BundlePayload):Promise<BundleChunk|undefined>{
 const entry=bundleEntry(cell,cx,cz);if(!entry)return;
 const packed=payload??await fetchMapBundle(cell,cx,cz,baseUrl);if(!packed)return;
 let bundle=touch(decoded,packed.url)?.value;
 if(!bundle){
  let pending=decoding.get(packed.url);
  if(!pending){pending=(async()=>{
   const stream=new Blob([packed.data]).stream().pipeThrough(new DecompressionStream('gzip'));
   const text=await new Response(stream).text();if(new TextEncoder().encode(text).byteLength!==entry.rawBytes)throw new Error('Map bundle decoded size mismatch');
   const value=JSON.parse(text) as Bundle;
   if(value.version!==1||value.cell?.join('/')!==cell.join('/')||value.key!==`${Math.floor(cx/2)}_${Math.floor(cz/2)}`||!entry.chunks.every(k=>value.chunks?.[k]?.raw))throw new Error('Invalid map bundle');
   decoded.set(packed.url,{value,size:entry.rawBytes*3});trim(decoded,v=>v.size,DECODED_LIMIT);return value;
  })();decoding.set(packed.url,pending);void pending.finally(()=>decoding.delete(packed.url)).catch(()=>{});}
  try{bundle=await pending;}catch(error){compressed.delete(packed.url);decoded.delete(packed.url);throw error;}
 }
 return bundle.chunks[`${cx}_${cz}`];
}
