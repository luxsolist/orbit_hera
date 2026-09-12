/** Cap 3D fill cost independently of CSS/HUD resolution; never supersample. */
export function renderPixelRatio(width:number,height:number,deviceRatio:number):number {
  const area=Math.max(1,width)*Math.max(1,height);
  return Math.min(Math.max(.1,deviceRatio),1,Math.sqrt(1920*1080/area));
}
