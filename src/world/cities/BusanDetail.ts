import type {Cell,WorldChunk} from '../chunkManifest';
import {applyRegionalDetail,type SeoulDetail} from './SeoulDetail';
export function applyBusanDetail(cell:Cell,raw:WorldChunk,detail:SeoulDetail):WorldChunk {
 return cell[0]===35&&cell[1]===129?applyRegionalDetail(raw,detail):raw;
}
