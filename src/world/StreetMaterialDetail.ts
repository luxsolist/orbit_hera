/** Shared by mesh streets, bridge decks and the baked ground texture fallback.
 * Metre-based grain/paving detail fades with pixel footprint; base colour comes
 * only from the city profile, never a geographic review rectangle.
 */
export const STREET_MATERIAL_DETAIL_GLSL=`
vec3 streetMaterialDetail(vec3 base,vec2 p,float roadSurface,float walkSurface,float wear){
 vec2 grainCoord=p*12.0;
 float grainFade=1.0-smoothstep(.3,1.0,max(fwidth(grainCoord.x),fwidth(grainCoord.y)));
 float grain=fract(sin(dot(floor(grainCoord),vec2(127.1,311.7)))*43758.5453)-.5;
 base*=1.0+grain*.16*roadSurface*grainFade;
 vec2 tile=p/vec2(.6,.4),edge=abs(fract(tile)-.5),aa=max(fwidth(tile),vec2(.002));
 float tileFade=1.0-smoothstep(.3,.8,max(aa.x,aa.y));
 float joint=max(smoothstep(.475-aa.x,.475+aa.x,edge.x),smoothstep(.46-aa.y,.46+aa.y,edge.y));
 base*=1.0-joint*.18*walkSurface*tileFade;
 vec2 patchCell=p/vec2(7.0,4.0),patchEdge=abs(fract(patchCell)-.5);
 float seed=fract(sin(dot(floor(patchCell),vec2(12.9898,78.233)))*43758.5453);
 vec2 patchAA=max(fwidth(patchCell),vec2(.015));
 vec2 repairMask=1.0-smoothstep(vec2(.35)-patchAA,vec2(.35)+patchAA,patchEdge);
 float wearFade=1.0-smoothstep(.2,.6,max(patchAA.x,patchAA.y));
 return base*(1.0-wear*roadSurface*step(.9,seed)*repairMask.x*repairMask.y*wearFade);
}
`;
