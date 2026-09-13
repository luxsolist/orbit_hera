import {discardPreparedChunk,type PreparedChunk} from './PreparedChunk';
import type {Cell} from './chunkManifest';
import type {CityAppearance} from './cities';
export interface ChunkPreparationJob {baseUrl?:string;cell:Cell;cx:number;cz:number;block:number;size:number;ox:number;oz:number;profile:CityAppearance;}
type Job={id:number;key:string;job:ChunkPreparationJob;resolve:(p:PreparedChunk|null)=>void;reject:(e:Error)=>void;cleanup:()=>void};
/** One bounded worker, with re-prioritizable queued jobs and cancellable in-flight work. */
export class ChunkPreparation {
 private worker?:Worker;private active?:Job;private queue:Job[]=[];private next=0;private dead=false;private priorities=new Map<string,number>();
 static get supported(){return typeof Worker!=='undefined'&&typeof OffscreenCanvas!=='undefined';}
 prioritize(keys:string[]){this.priorities=new Map(keys.map((k,i)=>[k,i]));this.queue.sort((a,b)=>(this.priorities.get(a.key)??Infinity)-(this.priorities.get(b.key)??Infinity));}
 prepare(key:string,job:ChunkPreparationJob,signal?:AbortSignal):Promise<PreparedChunk|null>{
  if(this.dead||signal?.aborted)return Promise.reject(new Error('Chunk preparation cancelled'));
  return new Promise((resolve,reject)=>{
   const entry:Job={id:++this.next,key,job,resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)};
   const abort=()=>{entry.cleanup();this.queue=this.queue.filter(j=>j!==entry);if(this.active===entry){this.active=undefined;this.worker?.terminate();this.worker=undefined;}reject(new Error('Chunk preparation cancelled'));this.pump();};
   signal?.addEventListener('abort',abort,{once:true});this.queue.push(entry);this.prioritize([...this.priorities.keys()]);this.pump();
  });
 }
 private pump(){
  if(this.dead||this.active||!this.queue.length)return;
  if(!this.worker){
   this.worker=new Worker(new URL('./chunk.worker.ts',import.meta.url),{type:'module'});
   this.worker.onmessage=(event:MessageEvent<{id:number;packet:PreparedChunk|null;error?:string}>)=>{
    const entry=this.active;if(!entry||entry.id!==event.data.id){if(event.data.packet)discardPreparedChunk(event.data.packet);return;}
    this.active=undefined;entry.cleanup();if(event.data.error)entry.reject(new Error(event.data.error));else entry.resolve(event.data.packet);this.pump();
   };
   this.worker.onerror=()=>{const entry=this.active;this.active=undefined;this.worker?.terminate();this.worker=undefined;entry?.cleanup();entry?.reject(new Error('Chunk worker failed'));this.pump();};
  }
  this.active=this.queue.shift()!;this.worker.postMessage({id:this.active.id,job:this.active.job});
 }
 dispose(){this.dead=true;this.worker?.terminate();this.worker=undefined;for(const j of [...this.queue,...(this.active?[this.active]:[])]){j.cleanup();j.reject(new Error('Chunk preparation disposed'));}this.queue=[];this.active=undefined;}
}
