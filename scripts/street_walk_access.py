"""Reserve authored outdoor stair/terrace openings in final generic building solids."""
import json,sys
from pathlib import Path
from street_compile import ring,polygons,union,Point,box,LineString,constrained_delaunay_triangles,lines,route_levels
from shapely.strtree import STRtree
from shapely import segmentize

def resolve_walk_access(part,upper_corridors=()):
    changed=0
    hosts={}
    for b in part.get('resolvedBuildings',[]):
        if b.get('walkableProfile'):hosts.setdefault(b.get('osmId'),[]).append(ring(b))
    regions=[]
    for r in part.get('regions',[]):
        if r['kind']!='walkdeck' or r.get('source') not in hosts:regions.append(r);continue
        shape=ring(r);fitted=shape.intersection(union(hosts[r['source']]))
        if abs(shape.area-fitted.area)<.000001:regions.append(r);continue
        changed+=1
        for p in polygons(fitted):
            if p.area<.001:continue
            triangles=[[round(v,4) for xy in list(t.exterior.coords)[:3] for v in xy] for t in constrained_delaunay_triangles(p).geoms]
            regions.append(dict(r,p=[v for xy in p.exterior.coords for v in xy],holes=[[v for xy in h.coords for v in xy] for h in p.interiors],triangles=triangles))
    part['regions']=regions
    if upper_corridors:
        clear=union(upper_corridors)
        for b in part.get('resolvedBuildings',[])+part.get('resolvedStructures',[]):
            if 'supportPoints' not in b:continue
            sites=b['supportPoints'];filtered=[v for x,z in zip(sites[::2],sites[1::2]) if not clear.covers(Point(x,z)) for v in (x,z)]
            if filtered!=sites:changed+=1;b['supportPoints']=filtered
    access=[ring(r).buffer(.06,quad_segs=2) for r in part.get('regions',[]) if r['kind']=='walkdeck' and ('offset' in r.get('profile',{}) or 'offsets' in r.get('profile',{}) or len(r.get('profile',{}).get('levels',[]))>1)]
    if not access:return changed
    tree=STRtree(access)
    for field in ('resolvedBuildings','buildings'):
        output=[]
        for b in part.get(field,[]):
            if b.get('walkableProfile') or any(b.get(k) for k in ('landmarkModel','statueModel','palaceBuildingId','seoulArchitecture')):
                output.append(b);continue
            shape=ring(b);hits=tree.query(shape,predicate='intersects')
            if not len(hits):output.append(b);continue
            clipped=shape.difference(union([access[i] for i in hits]))
            if abs(shape.area-clipped.area)<.000001:output.append(b);continue
            changed+=1
            for p in polygons(clipped):
                if p.area<.01:continue
                piece=dict(b,p=[v for xy in p.exterior.coords for v in xy],holes=[[v for xy in h.coords for v in xy] for h in p.interiors],walkAccessOpening=True)
                if 'supportPoints' in b:
                    sites=b['supportPoints'];piece['supportPoints']=[v for x,z in zip(sites[::2],sites[1::2]) if p.buffer(.0001).covers(Point(x,z)) for v in (x,z)]
                output.append(piece)
        part[field]=output
    return changed

def flatten_low_plinths(part,hosts):
    """A sub-step plinth belongs to the ground walking layer, not an upper floor."""
    low={b.get('osmId'):b for b in hosts if 0<b.get('walkableProfile',{}).get('height',100)<=.18}
    shapes=[ring(b) for b in low.values()]+[ring(z) for z in part.get('groundWalkZones',[])];kept=[];removed=0
    for r in part.get('regions',[]):
        offsets=r.get('profile',{}).get('offsets',[])
        if r['kind']=='walkdeck' and (r.get('source') in low or offsets and max(offsets)<=.18):shapes.append(ring(r));removed+=1
        else:kept.append(r)
    if not shapes:return 0
    zone=union(shapes).intersection(box(*part['bounds']))
    blockers=[ring(b) for b in part.get('resolvedBuildings',[]) if not b.get('walkableProfile') and not b.get('groundClearance')]
    blockers += [ring(r) for r in kept if r['kind']=='walkdeck']
    for w in part.get('resolvedWater',[]):blockers.append(LineString(list(zip(w['p'][::2],w['p'][1::2]))).buffer(w['w']/2) if w.get('w') else ring(w))
    zone=zone.difference(union(blockers))
    zones=[dict(p=[v for xy in p.exterior.coords for v in xy],holes=[[v for xy in h.coords for v in xy] for h in p.interiors]) for p in polygons(zone)]
    changed=bool(removed) or part.get('groundWalkZones')!=zones
    part['groundWalkZones']=zones
    existing=union([ring(r) for r in kept if r['kind'] in ('asphalt','pavement','curb')])
    for p in polygons(zone.difference(existing)):
        if p.area<.001:continue
        changed=True
        kept.append(dict(kind='pavement',p=[v for xy in p.exterior.coords for v in xy],holes=[[v for xy in h.coords for v in xy] for h in p.interiors],triangles=[[round(v,4) for xy in list(t.exterior.coords)[:3] for v in xy] for t in constrained_delaunay_triangles(p).geoms]))
    part['regions']=kept
    return int(changed)

def ground_route_transitions(routes,zones,eligible):
    tree=STRtree(zones);out=[]
    for r in routes:
        if not r.get('elevated') or r['id'] not in eligible:out.append(r);continue
        line=LineString(r['p']);hits=tree.query(line,predicate='intersects')
        if not len(hits):out.append(r);continue
        ground=union([zones[i] for i in hits]);lower=line.intersection(ground)
        if lower.length<.00001:out.append(r);continue
        for piece in lines(lower):
            if piece.length>.00001:out.append(dict(r,p=list(piece.coords),elevated=False,level=0))
        for piece in lines(line.difference(ground)):
            if piece.length>.00001:out.append(dict(r,p=list(piece.coords)))
    return out

def attach_ground_entries(part,paths):
    if not paths:return 0
    groups={}
    for r in part.get('regions',[]):
        if r['kind']=='walkdeck' and 'offset' in r.get('profile',{}):groups.setdefault(r.get('source'),[]).append(r)
    changed=0
    for source,regions in groups.items():
        shape=union([ring(r) for r in regions]);anchors=[]
        for path in paths:
            hit=path.intersection(shape.boundary)
            stack=[hit]
            while stack:
                g=stack.pop()
                if g.is_empty:continue
                if g.geom_type=='Point':anchors.append([round(g.x,4),round(g.y,4)])
                elif g.geom_type in ('MultiPoint','GeometryCollection'):stack.extend(g.geoms)
        anchors=sorted({tuple(p) for p in anchors})
        if not anchors:continue
        anchors=[list(p) for p in anchors]
        for r in regions:
            if r['profile'].get('accessAnchors')==anchors:continue
            def refine(flat):
                ps=list(zip(flat[::2],flat[1::2]));out=[]
                for a,b in zip(ps,ps[1:]+ps[:1]):
                    dx,dz=b[0]-a[0],b[1]-a[1];length2=dx*dx+dz*dz
                    if length2<1e-16:continue
                    ts=[0]
                    for x,z in anchors:
                        t=((x-a[0])*dx+(z-a[1])*dz)/length2
                        if 0<t<1 and (a[0]+t*dx-x)**2+(a[1]+t*dz-z)**2<.001**2:ts.append(t)
                    out.extend((a[0]+t*dx,a[1]+t*dz) for t in sorted(set(ts)))
                return [v for p in out for v in p]
            refined=segmentize(ring(dict(p=refine(r['p']),holes=[refine(h) for h in r.get('holes',[])])),2)
            r['p']=[v for xy in refined.exterior.coords for v in xy];r['holes']=[[v for xy in h.coords for v in xy] for h in refined.interiors]
            r['triangles']=[[round(v,4) for xy in list(t.exterior.coords)[:3] for v in xy] for t in constrained_delaunay_triangles(refined).geoms]
            r['profile']['accessAnchors']=anchors;changed+=1
    return changed

def main():
    city,region=sys.argv[1:3];path=Path('build/streets')/(city+'-'+region+'-regions.json');index=json.loads(path.read_text());changed=0
    route_path=path.with_name(city+'-'+region+'-routes.json');routes=json.loads(route_path.read_text())
    upper={}
    for r in routes:
        if r.get('elevated') and len(r['p'])>1:upper.setdefault(r['id'],[]).append(LineString(r['p']))
    routes=[r for r in routes if r.get('elevated') or not (r['id'] in upper and LineString(r['p']).length<.05 and min(LineString(r['p']).distance(p) for p in upper[r['id']])<.01)]
    route_path.write_text(json.dumps(routes,separators=(',',':')))
    source=json.loads(path.with_name(city+'-'+region+'-resolved-input.json').read_text())
    widths={r['id']:r.get('w',2.5) for r in source.get('walking',[])}
    eligible={r['id'] for r in source.get('walking',[]) if not r.get('bridge') and not any(v>0 for v in route_levels(r))}
    hosts={str(c['cx'])+'_'+str(c['cz']):[b for b in c['objects'].get('buildings',[]) if b.get('walkableProfile',{}).get('height',100)<=.18] for c in source['chunks']}
    zones=[]
    access_paths=[LineString(list(zip(r['p'][::2],r['p'][1::2]))) for r in source.get('walking',[]) if r['id'] in eligible and not r.get('area') and not r.get('tunnel')]
    access_tree=STRtree(access_paths)
    corridors=[p.buffer(widths[id]/2+.2,quad_segs=3) for id,paths in upper.items() if id in widths for p in paths];tree=STRtree(corridors)
    del source
    def resolve(part):
        bounds=part['bounds'];key=str(int(bounds[0]//1024))+'_'+str(int(bounds[1]//1024))
        n=flatten_low_plinths(part,hosts.get(key,[]))+resolve_walk_access(part,[corridors[i] for i in tree.query(box(*bounds))])
        n+=attach_ground_entries(part,[access_paths[i] for i in access_tree.query(box(*bounds))])
        zones.extend(ring(z) for z in part.get('groundWalkZones',[]))
        return n
    if index.get('format')=='chunk-files':
        for file in index['chunks'].values():
            p=Path(file);part=json.loads(p.read_text());n=resolve(part);changed+=n
            if n:p.write_text(json.dumps(part,separators=(',',':')))
    else:
        for part in index.values():changed+=resolve(part)
        path.write_text(json.dumps(index,separators=(',',':')))
    routes=ground_route_transitions(routes,zones,eligible)
    route_path.write_text(json.dumps(routes,separators=(',',':')))
    print(json.dumps(dict(walkAccessBuildingOpenings=changed)),flush=True)
if __name__=='__main__':main()
