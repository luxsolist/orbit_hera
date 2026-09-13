import type {AreaRing,Ring} from './MapData';
import {seoulAppearance,type CityAppearance} from './cities';

/** OSM areas override inferred building aprons; coordinates are absolute cell metres. */
export function paintUrbanGround(ctx:CanvasRenderingContext2D,buildings:Ring[],areas:AreaRing[],scale:number,x0:number,z0:number,config:CityAppearance['ground']=seoulAppearance.ground):void {
 const trace=(p:number[])=>{
  ctx.beginPath();ctx.moveTo((p[0]-x0)*scale,(p[1]-z0)*scale);
  for(let i=2;i<p.length;i+=2)ctx.lineTo((p[i]-x0)*scale,(p[i+1]-z0)*scale);
  ctx.closePath();
 };
 ctx.save();ctx.lineJoin='round';
 // A six-metre apron joins narrow inter-building gaps without painting entire bounding boxes.
 ctx.fillStyle=config.apronColor;ctx.strokeStyle=config.apronColor;ctx.lineWidth=config.apronWidth*2*scale;
 for(const building of buildings){if(building.p.length<6)continue;trace(building.p);ctx.fill();ctx.stroke();}
 const colors=config.areas;
 // Preserve mapped green areas even when their polygons overlap a building apron or plaza.
 for(const green of [false,true])for(const area of areas){
  if(area.p.length<6||!colors[area.k])continue;
  const vegetation=['park','garden','grass','pitch','wood','scrub'].includes(area.k);
  if(vegetation!==green)continue;
  ctx.fillStyle=colors[area.k];trace(area.p);ctx.fill();
 }
 ctx.restore();
}
