import type {StreetMeshData} from './StreetGeometry';
import type {ChunkTerrain} from './chunkMesh';
import type {CityAppearance} from './cities';
/** One worker per world; ChunkStreamer bounds the total queued jobs. */
export class StreetPreparation {
 private worker?:Worker;
 private next=0;
 private pending=new Map<number,{resolve:(data:StreetMeshData[]|undefined)=>void;reject:(error:Error)=>void}>();
 private disposed=false;
 prepare(roads:{p:number[];w?:number}[],terrain:ChunkTerrain,ox:number,oz:number,colors:CityAppearance['street']):Promise<StreetMeshData[]|undefined>{
  if(this.disposed)return Promise.reject(new Error('World disposed'));
  if(typeof Worker==='undefined')return Promise.resolve(undefined);
  if(!this.worker){
   this.worker=new Worker(new URL('./street.worker.ts',import.meta.url),{type:'module'});
   this.worker.onmessage=(event:MessageEvent<{id:number;data?:StreetMeshData[];error?:string}>)=>{
    const job=this.pending.get(event.data.id);if(!job)return;this.pending.delete(event.data.id);
    if(event.data.error)job.reject(new Error(event.data.error));else job.resolve(event.data.data);
   };
   this.worker.onerror=()=>this.fail(new Error('Road preparation worker failed'));
  }
  const id=++this.next;
  return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker!.postMessage({id,roads,terrain,ox,oz,colors});});
 }
 private fail(error:Error){this.worker?.terminate();this.worker=undefined;for(const job of this.pending.values())job.reject(error);this.pending.clear();}
 dispose(){this.disposed=true;this.fail(new Error('World disposed'));}
}
