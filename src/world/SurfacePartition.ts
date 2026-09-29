/** Convex surface partitioning. Vertices keep all interpolated attributes (x,y,z,uv…). */
export type SurfaceVertex = number[];
export type SurfacePolygon = SurfaceVertex[];
export function clipSurface(poly: SurfacePolygon, side: (v:SurfaceVertex)=>number): SurfacePolygon {
 const out:SurfacePolygon=[];
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],da=side(a),db=side(b);
  if(da>=0)out.push(a);
  if((da>=0)!==(db>=0)){const u=da/(da-db);out.push(a.map((v,k)=>v+(b[k]-v)*u));}
 }
 return out;
}
/** Remove a CCW convex XZ footprint; returned pieces share exact cut vertices. */
export function subtractSurface(poly:SurfacePolygon,cut:readonly (readonly number[])[]):SurfacePolygon[]{
 let rest=poly;const out:SurfacePolygon[]=[];
 for(let i=0;i<cut.length&&rest.length>=3;i++){
  const a=cut[i],b=cut[(i+1)%cut.length];
  const side=(v:SurfaceVertex)=>(b[0]-a[0])*(v[2]-a[1])-(b[1]-a[1])*(v[0]-a[0]);
  const outside=clipSurface(rest,v=>-side(v));if(outside.length>=3)out.push(outside);
  rest=clipSurface(rest,side);
 }
 return out;
}
export function surfaceTriangles(poly:SurfacePolygon):SurfaceVertex[]{
 const out:SurfaceVertex[]=[];
 for(let i=1;i<poly.length-1;i++){
  const a=poly[0],b=poly[i],c=poly[i+1];
  const area=(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
  if(Math.abs(area)>1e-9)out.push(...(area<0?[a,b,c]:[a,c,b]));
 }
 return out;
}
