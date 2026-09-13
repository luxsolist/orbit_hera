import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {correctPalaceSite,palaceSiteBuilding} from '../src/world/cities/PalaceSite';
import {correctGyeongbokgungChunk} from '../src/world/cities/Gyeongbokgung';
import {addStreetGeometry} from '../src/world/StreetGeometry';
import {chunkTerrainEntry} from '../src/world/chunkMesh';
import {seoulAppearance} from '../src/world/cities';
it('bounds geometry memory in the palace spawn chunks',()=>{
 for(const key of ['84_45','84_46','83_45','83_46']){
 const raw=JSON.parse(readFileSync(`public/maps/37/126/5_2/${key}.json`,'utf8'));
 const c=correctPalaceSite([37,126],correctGyeongbokgungChunk([37,126],raw));let bytes=0;
 for(const b of c.objects.buildings){if(!b.palaceBuildingId)continue;const g=palaceSiteBuilding(b.palaceBuildingId,c.cx*1024,c.cz*1024,30,b)!;for(const a of Object.values(g.attributes))bytes+=a.array.byteLength;g.dispose();}
 const group=new THREE.Group();addStreetGeometry(group,c.objects.roads,chunkTerrainEntry(c,1024)!,c.cx*1024,c.cz*1024,seoulAppearance.street);
 group.traverse(o=>{if(o instanceof THREE.Mesh){for(const a of Object.values(o.geometry.attributes))bytes+=a.array.byteLength;o.geometry.dispose();}});
 expect(bytes,key).toBeLessThan(32*1048576);
 }
},30000);
