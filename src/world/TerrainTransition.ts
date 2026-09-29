export interface TerrainTransition {
 innerMargin:number; minimumWidth:number; maximumWidth:number; targetGrade:number;
}
/** A high edge needs a longer approach than a nearly level edge. The same weight
 * must blend ground and road so their ordering and shared tile vertices survive.
 * targetGrade budgets the blend contribution, not the source terrain gradient.
 */
export function terrainTransitionWeight(distance:number,halfSize:number,ground:number,road:number,design:number,settings:TerrainTransition):number {
 const offset=Math.max(Math.abs(ground-design),Math.abs(road-design));
 const width=Math.min(settings.maximumWidth,Math.max(settings.minimumWidth,1.5*offset/settings.targetGrade));
 const t=Math.max(0,Math.min(1,(distance-halfSize-settings.innerMargin)/width));
 return 1-t*t*(3-2*t);
}
