import * as THREE from 'three';
const cache=new Map<string,Record<string,THREE.Texture>>();
/** Shared across streamed chunks; intentionally retained for the application lifetime. */
export function citySurfaceMaps(path="textures/city/seoul"):Record<string,THREE.Texture>{
 const cached=cache.get(path);if(cached)return cached;
 const maps:Record<string,THREE.Texture>={};
 cache.set(path,maps);
 const loader=typeof document==='undefined'?null:new THREE.TextureLoader();
 for(const kind of ['concrete','brick','roof'])for(const channel of ['color','normal','roughness']){
  const t=loader?loader.load(`${import.meta.env.BASE_URL}${path}/${kind}-${channel}.png`):new THREE.Texture();
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=channel==='color'?THREE.SRGBColorSpace:THREE.NoColorSpace;
  t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.anisotropy=4;
  maps[kind+channel]=t;
 }
 return maps;
}
