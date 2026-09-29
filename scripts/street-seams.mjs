/** One height profile per city tile edge, independent of bake order. */
export function createStreetSeamSampler(terrains,sample,step=32){
 const cache=new Map();
 function point(x,z){const key=x+','+z;if(cache.has(key))return cache.get(key);
  const cx=Math.floor(x/1024),cz=Math.floor(z/1024),xs=Math.abs(x/1024-Math.round(x/1024))<1e-8?[cx-1,cx]:[cx],zs=Math.abs(z/1024-Math.round(z/1024))<1e-8?[cz-1,cz]:[cz];
  const values=[];for(const a of xs)for(const b of zs){const t=terrains.get(a+'_'+b);if(t)values.push(sample(t,x,z));}
  const y=values.length?values.reduce((s,v)=>s+v,0)/values.length:undefined;cache.set(key,y);return y;
 }
 return (x,z)=>{const vertical=Math.abs(x/1024-Math.round(x/1024))<1e-8,horizontal=Math.abs(z/1024-Math.round(z/1024))<1e-8;if(!vertical&&!horizontal)return;
  const u=vertical?z:x,lo=Math.floor(u/step)*step,f=(u-lo)/step;
  const a=vertical?point(x,lo):point(lo,z),b=vertical?point(x,lo+step):point(lo+step,z);
  return a===undefined||b===undefined?undefined:a+(b-a)*f;
 };
}

/** Reconcile both physical ground and street grid edges before mesh baking.
 * Interior elevations remain untouched; no surface patch is added. */
export function reconcileStreetTerrain(terrains,sample){
 const edge=createStreetSeamSampler(terrains,sample),result=new Map();
 for(const [key,t] of terrains){if(!t)continue;const land=Array.from(t.heights),road=Array.from(t.roadHeights??t.heights);
  for(let j=0;j<t.size;j++)for(let i=0;i<t.size;i++){if(i&&j&&i<t.size-1&&j<t.size-1)continue;
   const y=edge(t.cellX0+i*t.step,t.cellZ0+j*t.step);if(y!==undefined){land[j*t.size+i]=y;road[j*t.size+i]=y;}}
  result.set(key,{land,road});
 }
 return result;
}
