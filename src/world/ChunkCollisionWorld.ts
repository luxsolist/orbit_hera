import {CollisionWorld} from './CollisionWorld';
/** Persistent per-tile indexes: activation never rebuilds neighbouring tiles. */
export class ChunkCollisionWorld extends CollisionWorld {
 private chunks=new Map<string,CollisionWorld>();
 setChunk(key:string,collision:CollisionWorld){this.chunks.set(key,collision);}
 removeChunk(key:string){this.chunks.delete(key);}
 override resolveCollision(x:number,z:number,r:number,y:number){for(const c of this.chunks.values()){const p=c.resolveCollision(x,z,r,y);x=p.x;z=p.z;}return {x,z};}
 override topAt(x:number,z:number){let top=-Infinity;for(const c of this.chunks.values())top=Math.max(top,c.topAt(x,z));return top;}
 override segmentBlocked(sx:number,sy:number,sz:number,ex:number,ey:number,ez:number){let t=Infinity;for(const c of this.chunks.values())t=Math.min(t,c.segmentBlocked(sx,sy,sz,ex,ey,ez));return t;}
 override forEachBuildingNear(...args:Parameters<CollisionWorld['forEachBuildingNear']>){for(const c of this.chunks.values())c.forEachBuildingNear(...args);}
 override forEachTriNear(...args:Parameters<CollisionWorld['forEachTriNear']>){for(const c of this.chunks.values())c.forEachTriNear(...args);}
 override forEachCircleNear(...args:Parameters<CollisionWorld['forEachCircleNear']>){for(const c of this.chunks.values())c.forEachCircleNear(...args);}
 override openBuildingAt(x:number,z:number){for(const c of this.chunks.values())c.openBuildingAt(x,z);}
 override closeBuildingAt(x:number,z:number){for(const c of this.chunks.values())c.closeBuildingAt(x,z);}
}
