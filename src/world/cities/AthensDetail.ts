import type {Cell,WorldChunk} from '../chunkManifest';
import {applyRegionalDetail,type SeoulDetail,type DetailBuilding} from './SeoulDetail';
export interface AthensDetail extends SeoulDetail {add?:DetailBuilding[]}
export function applyAthensDetail(cell:Cell,raw:WorldChunk,detail:AthensDetail):WorldChunk{
 if(cell[0]!==37||cell[1]!==23||raw.seoulDetail)return raw;
 const known=new Set(raw.objects.buildings.map(b=>JSON.stringify(b.p)));
 const additions=(detail.add??[]).filter(b=>!known.has(JSON.stringify(b.p))).map(b=>({p:b.p,holes:b.holes,h:b.h??undefined,n:b.name,lm:'deep-roots' as const}));
 return applyRegionalDetail({...raw,objects:{...raw.objects,buildings:[...raw.objects.buildings,...additions]}},detail);
}
