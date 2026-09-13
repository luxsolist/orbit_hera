import {it,expect,vi,afterEach} from 'vitest';
import {fetchCityTiles,manifestChunkAt,fetchWorldChunkAt} from '../src/world/mapLocator';
import {cellMLon} from '../src/world/chunkManifest';
vi.mock('../src/world/maps',()=>({fetchCatalog:async()=>[
 {id:'seoul-stream',stream:true,lat:37.5665,lon:126.978},
 {id:'boundary-stream',stream:true,lat:40.9,lon:-74.1}
]}));
afterEach(()=>vi.unstubAllGlobals());
const manifest=(cell:[number,number])=>({cell,originLat:cell[0]+1,originLon:cell[1],mLon:cellMLon(cell[0]),chunkSize:1024,terrainSize:33,block:16,chunks:[{cx:95,cz:52,terrain:true,objects:true}]});
it('uses the Seoul build grid for Lotte World Tower across longitude 127',async()=>{
 const m=manifest([37,126]),fetch=vi.fn(async(_path:string)=>({ok:true,json:async()=>m}));vi.stubGlobal('fetch',fetch);
 expect(await fetchCityTiles(37.5125537,127.102679,'seoul-stream')).toEqual(m);
 expect(fetch.mock.calls[0][0]).toBe('/maps/37/126/tiles.json');
 expect(manifestChunkAt(m,37.5125537,127.102679)).toEqual({cx:95,cz:52});
});
it('uses catalog origin for latitude and negative longitude boundaries',async()=>{
 const m=manifest([40,-75]),fetch=vi.fn(async(_path:string)=>({ok:true,json:async()=>m}));vi.stubGlobal('fetch',fetch);
 await fetchCityTiles(41.01,-73.99,'boundary-stream');expect(fetch.mock.calls[0][0]).toBe('/maps/40/-75/tiles.json');
});
it('loads chunks using manifest block and grid, and rejects uncovered coordinates',async()=>{
 const m=manifest([37,126]),fetch=vi.fn(async(path:string)=>({ok:true,json:async()=>path.endsWith('tiles.json')?m:{cx:95,cz:52,terrain:{size:0,heights:[],seaLevel:0},objects:{buildings:[],roads:[],water:[]}}}));vi.stubGlobal('fetch',fetch);
 expect(await fetchWorldChunkAt(37.5125537,127.102679,1024,'seoul-stream')).toMatchObject({cx:95,cz:52});
 expect(fetch.mock.calls[1][0]).toBe('/maps/37/126/5_3/95_52.json');
 expect(await fetchWorldChunkAt(36,127,1024,'seoul-stream')).toBeNull();
});
it('reports missing selected city manifest without silently switching grids',async()=>{
 const fetch=vi.fn(async()=>({ok:false}));vi.stubGlobal('fetch',fetch);
 await expect(fetchCityTiles(37.5,127.1,'seoul-stream')).rejects.toThrow('maps/37/126/tiles.json');expect(fetch).toHaveBeenCalledTimes(1);
});
it('retains geographic lookup when no city is selected',async()=>{
 const fetch=vi.fn(async(_path:string)=>({ok:true,json:async()=>manifest([37,127])}));vi.stubGlobal('fetch',fetch);
 await fetchCityTiles(37.5,127.1);expect(fetch.mock.calls[0][0]).toBe('/maps/37/127/tiles.json');
});
