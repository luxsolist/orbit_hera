import {fetchWorldChunk} from './mapLocator';
import {prepareChunk,chunkTransfers} from './PreparedChunk';
import type {ChunkPreparationJob} from './ChunkPreparation';
self.onmessage=async(event:MessageEvent<{id:number;job:ChunkPreparationJob}>)=>{
 const {id,job}=event.data;
 try {
  const raw=await fetchWorldChunk(job.cell,job.cx,job.cz,job.block,job.baseUrl,job.bundlePayload);
  const packet=raw?prepareChunk(raw,job.size,job.ox,job.oz,job.profile):null;
  (self as unknown as {postMessage:(data:unknown,transfer:Transferable[])=>void}).postMessage({id,packet},packet?chunkTransfers(packet):[]);
 }catch(error){self.postMessage({id,error:String(error)});}
};
