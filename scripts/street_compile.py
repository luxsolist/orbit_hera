"""Common offline street-region compiler. Shapely is build-only; no runtime planning.
A region is solved with a halo, then clipped into delivery chunks. OSM ways are
logical routes; surfaces are a single partition shared by all consumers.
"""
import json, math, hashlib, sys, os, pickle, inspect
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/('build/busan-python' if os.name=='nt' else 'build/map-python')))
from shapely import make_valid, constrained_delaunay_triangles, get_num_coordinates, clip_by_rect, coverage_union_all, disjoint_subset_union_all, get_parts
from shapely.geometry import Polygon, LineString, Point, box, GeometryCollection, MultiPolygon, MultiLineString
from shapely.ops import unary_union, substring
from shapely.strtree import STRtree
from shapely.errors import GEOSException
from shapely.prepared import prep
ROOT=Path(__file__).resolve().parent.parent
def polygons(g):
    if g.is_empty:return []
    if g.geom_type=='Polygon':return [g]
    return [p for x in getattr(g,'geoms',[]) for p in polygons(x)]
def lines(g):
    if g is None or g.is_empty:return []
    if g.geom_type=='LineString':return [g]
    return [p for x in getattr(g,'geoms',[]) for p in lines(x)]
def points(p):return list(zip(p[::2],p[1::2]))
def union(items):
    if not items:return GeometryCollection()
    large=len(items)>1000 or any(get_num_coordinates(g)>50000 for g in items)
    return make_valid(disjoint_subset_union_all(get_parts(items)) if large else unary_union(items))
def stitch_tiles(parts):
    # Coverage union is unsuitable for independently clipped floating-point borders.
    # Disjoint subsets keep disconnected city blocks out of one global overlay.
    return make_valid(disjoint_subset_union_all([p for part in parts for p in polygons(part)]))
def metric_buffer(geometry,distance,quad_segs=4,limit=50000,tile_size=2048):
    """Finite-distance operation with overlapping tiles; clip only AFTER buffering.
    This is the same metric operation, not independent road design per chunk.
    """
    if geometry.is_empty or get_num_coordinates(geometry)<limit:return geometry.buffer(distance,quad_segs=quad_segs)
    parts=polygons(geometry) or lines(geometry)
    if not parts:return geometry.buffer(distance,quad_segs=quad_segs)
    tree=STRtree(parts);pad=abs(distance)+1;x0,z0,x1,z1=geometry.bounds;out=[]
    tasks=[(x,z) for x in range(math.floor((x0-pad)/tile_size),math.floor((x1+pad)/tile_size)+1) for z in range(math.floor((z0-pad)/tile_size),math.floor((z1+pad)/tile_size)+1)]
    def work(task):
        x,z=task;tile=box(x*tile_size,z*tile_size,(x+1)*tile_size,(z+1)*tile_size);bounds=tile.buffer(pad).bounds
        local=union([make_valid(clip_by_rect(parts[i],*bounds)) for i in tree.query(box(*bounds))])
        return local.buffer(distance,quad_segs=quad_segs).intersection(tile) if not local.is_empty else None
    # GEOS operations release the GIL. map retains deterministic tile ordering.
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i,piece in enumerate(pool.map(work,tasks)):
            if piece is not None:out.append(piece)
            if len(tasks)>100 and (i+1)%100==0:print('street compiler: metric buffer',distance,i+1,'/',len(tasks),flush=True)
    return stitch_tiles(out)
def overlay(a,b,operation,limit=50000,tile_size=2048):
    """Pointwise polygon boolean operation, tiled exactly (no metric halo needed)."""
    if a.is_empty:return a
    if b.is_empty:return a if operation=='difference' else GeometryCollection()
    if get_num_coordinates(a)+get_num_coordinates(b)<limit:return getattr(a,operation)(b)
    ap=polygons(a);bp=polygons(b);at=STRtree(ap);bt=STRtree(bp)
    x0,z0,x1,z1=a.bounds
    tasks=[(x,z) for x in range(math.floor(x0/tile_size),math.floor(x1/tile_size)+1) for z in range(math.floor(z0/tile_size),math.floor(z1/tile_size)+1)]
    def work(task):
        x,z=task;tile=box(x*tile_size,z*tile_size,(x+1)*tile_size,(z+1)*tile_size)
        left=union([make_valid(clip_by_rect(ap[i],*tile.bounds)) for i in at.query(tile)])
        if left.is_empty:return GeometryCollection()
        right=union([make_valid(clip_by_rect(bp[i],*tile.bounds)) for i in bt.query(tile)])
        return getattr(left,operation)(right)
    with ThreadPoolExecutor(max_workers=4) as pool:parts=[p for piece in pool.map(work,tasks) for p in polygons(piece)]
    # Clipped floating-point edges are not guaranteed to be a noded coverage.
    # The subset union handles them without the pathological coverage-union pass.
    return stitch_tiles(parts)
def rounded(g):return make_valid(g)
def ring(r):
    if len(r.get('p',[]))<6:return GeometryCollection()
    shell=make_valid(Polygon(points(r['p'])))
    holes=[make_valid(Polygon(points(h))) for h in r.get('holes',[]) if len(h)>=6]
    return shell.difference(union(holes)) if holes else shell

def route_guides(roads,obstacle,core,max_shift=12,protected=None):
    """Bounded joint-node relocation + free-space routing. Obstacles are never cut.
    Shared OSM nodes get exactly one adjusted position. No coordinate exceptions.
    """
    import heapq
    from shapely.ops import nearest_points
    from shapely.prepared import prep
    if protected is None:protected=metric_buffer(obstacle,.8,quad_segs=3)
    prepared=prep(protected);protected_parts=polygons(protected);protected_tree=STRtree(protected_parts);base_parts=polygons(obstacle);base_tree=STRtree(base_parts);nodes={};failures=[];changes=[]
    def local_obstacles(area):
        bounds=area.buffer(.1).bounds
        return union([make_valid(clip_by_rect(protected_parts[i],*bounds)) for i in protected_tree.query(box(*bounds))])
    def node(p):
        key=tuple(p)
        if key in nodes:return nodes[key]
        q=Point(p)
        if prepared.covers(q):
            circle=q.buffer(max_shift,quad_segs=12)
            free=circle.difference(local_obstacles(circle).buffer(.04))
            if free.is_empty:return key
            q=nearest_points(q,free)[1]
        nodes[key]=(q.x,q.y);return nodes[key]
    def path(a,b,original,shared=False):
        blocked=prepared;get_obstacles=local_obstacles
        if shared:
            bounds=original.buffer(max_shift*2+1).bounds
            local=union([make_valid(clip_by_rect(base_parts[i],*bounds)) for i in base_tree.query(box(*bounds))]).buffer(.15,quad_segs=3)
            blocked=prep(local);get_obstacles=lambda area:local
        direct=LineString([a,b])
        if not blocked.intersects(direct):return [a,b]
        search=original.buffer(max_shift*2 if shared else max_shift)
        band=search.difference(get_obstacles(search))
        if band.is_empty:return None
        a,b=node(a),node(b)
        if not any(p.buffer(.001).covers(Point(a)) and p.buffer(.001).covers(Point(b)) for p in polygons(band)):return None
        # Navigate the actual free-space mesh. A fixed grid misses narrow but valid
        # links between expanded obstacles and can report false disconnections.
        spaces=[p for p in polygons(band) if p.covers(Point(a)) and p.covers(Point(b))]
        if not spaces:return None
        space=max(spaces,key=lambda p:p.area)
        triangles=list(constrained_delaunay_triangles(space).geoms)
        start=next((i for i,t in enumerate(triangles) if t.covers(Point(a))),None)
        end=next((i for i,t in enumerate(triangles) if t.covers(Point(b))),None)
        if start is None or end is None:return None
        owners={};neighbors=[[] for t in triangles]
        for i,t in enumerate(triangles):
            vs=list(t.exterior.coords)[:3]
            for u,v in zip(vs,vs[1:]+vs[:1]):
                key=tuple(sorted((u,v)))
                if key in owners:
                    j=owners[key];middle=((u[0]+v[0])/2,(u[1]+v[1])/2)
                    neighbors[i].append((j,middle));neighbors[j].append((i,middle))
                else:owners[key]=i
        queue=[start];previous={start:None}
        for i in queue:
            if i==end:break
            for j,middle in neighbors[i]:
                if j not in previous:previous[j]=(i,middle);queue.append(j)
        if end not in previous:return None
        out=[b];at=end
        while at!=start:
            at,middle=previous[at];out.append(middle)
        out.append(a);out.reverse()
        simple=[out[0]];i=0
        while i<len(out)-1:
            j=len(out)-1
            while j>i+1 and blocked.intersects(LineString([out[i],out[j]])):j-=1
            if blocked.intersects(LineString([out[i],out[j]])):return None
            simple.append(out[j]);i=j
        return simple
    result=[]
    for road_index,r in enumerate(roads):
        if road_index%10000==0:print('street compiler: routing',road_index,'/',len(roads),flush=True)
        if r.get('bridge') or r.get('tunnel') or r.get('layer',0)!=0:result.append(r);continue
        original=LineString(points(r['p']))
        if not original.intersects(core) or not prepared.intersects(original):result.append(r);continue
        coords=points(r['p']);out=[];failed=False;shared_passages=[]
        for a,b in zip(coords,coords[1:]):
            aa,bb=node(a),node(b)
            segment=LineString([a,b])
            if not segment.intersects(core.buffer(max_shift)):
                part=[a,b]
            else:part=path(aa,bb,segment)
            if part is None and (r.get('highway') in ('service','residential','living_street','unclassified') or r.get('lanes')=='1'):
                part=path(aa,bb,segment,shared=True)
                if part:shared_passages.append([v for p in part for v in p])
            if part is None:failed=True;part=[aa,bb]
            out.extend(part if not out else part[1:])
        adjusted=LineString(out)
        # Halo-only failures must not reject a route whose delivered section is clear.
        if failed and prepared.intersects(adjusted.intersection(core)):failures.append(r['id'])
        changes.append(dict(id=r['id'],maxDeviation=round(adjusted.hausdorff_distance(original),3)))
        result.append({**r,'p':[v for p in out for v in p],'sharedPassages':shared_passages})
    return result,changes,failures

def nearby(p,bounds):
    xs=p[::2];ys=p[1::2];return bool(xs) and max(xs)>=bounds[0] and min(xs)<=bounds[2] and max(ys)>=bounds[1] and min(ys)<=bounds[3]
def cached_stage(data,name,functions,build):
    if not data.get('_sourceHash'):return build()
    signature=hashlib.sha256((data['_sourceHash']+hashlib.sha256(Path(__file__).read_bytes()).hexdigest()+''.join(inspect.getsource(f) if callable(f) else f for f in functions)).encode()).hexdigest()
    file=ROOT/'build/streets'/(data['city']+'-'+data['region']+'-'+name+'-'+signature[:16]+'.pickle')
    if file.exists():
        print('street compiler: cached',name,flush=True);return pickle.loads(file.read_bytes())
    value=build();tmp=file.with_suffix('.tmp');tmp.write_bytes(pickle.dumps(value));tmp.replace(file)
    print('street compiler: saved',name,flush=True);return value

def normalize_source(data):
    # Unknown widths are gameplay estimates, never treated as surveyed banks.
    # Keep tagged/outlined widths intact; cap broad fallback ribbons so nearby
    # mapped paths are not swallowed before the joint allocation stage.
    for c in data['chunks']:
        for w in c['objects'].get('water',[]):
            info=w.get('waterInfo',{})
            if w.get('w') and info.get('widthSource')=='estimate':
                maximum=data.get('estimatedRiverWidth',12) if info.get('kind')=='river' else data.get('estimatedStreamWidth',4)
                if w['w']>maximum:w['waterInfo']=dict(info,sourceEstimate=w['w'],designWidth=maximum);w['w']=maximum
    for c in data['chunks']:
        tile=box(c['cx']*1024,c['cz']*1024,(c['cx']+1)*1024,(c['cz']+1)*1024)
        for kind in ('buildings','structures'):
            result=[];seen=set()
            for b in c['objects'].get(kind,[]):
                if b.get('layer',0)<0 and not any(b.get(k) for k in ('landmarkModel','seoulArchitecture','statueModel')):continue
                sources=b.get('sourceFootprints')
                if not sources:result.append(b);continue
                for source in sources:
                    shape=ring(dict(p=source['outer'],holes=source.get('holes',[]))).intersection(tile)
                    for p in polygons(shape):
                        if p.area<.01:continue
                        signature=(b.get('osmId'),p.wkb)
                        if signature in seen:continue
                        seen.add(signature)
                        obj={k:v for k,v in b.items() if k!='sourceFootprints'}
                        obj.update(p=[v for xy in p.exterior.coords for v in xy],holes=[[v for xy in h.coords for v in xy] for h in p.interiors])
                        result.append(obj)
            c['objects'][kind]=result
    return data

def route_levels(route):
    values=[]
    for value in str(route.get('level','')).split(';'):
        try:
            number=float(value)
            if math.isfinite(number):values.append(number)
        except ValueError:pass
    return values

def normalize_walk_hosts(data):
    # Explicit stepped seating is a traversable terraced structure, not a box.
    for c in data['chunks']:
        for b in c['objects'].get('buildings',[]):
            levels=route_levels(dict(level=b.get('sourceLevel','')))
            if levels and all(v>0 for v in levels) and not b.get('groundClearance'):
                b['groundClearance']=min(levels)*3.3;b['clearanceSource']='level'
            low_slab=0<b.get('h',9)<=.35 and not any(b.get(k) for k in ('landmarkModel','seoulArchitecture','statueModel'))
            if b.get('buildingType')!='grandstand' and not low_slab:continue
            shape=ring(b);corners=list(shape.minimum_rotated_rectangle.exterior.coords)
            if len(corners)<4:continue
            edges=[(math.dist(corners[i],corners[i+1]),corners[i],corners[i+1]) for i in range(4)]
            _,a,z=min(edges,key=lambda e:e[0]);dx,dz=z[0]-a[0],z[1]-a[1];length=math.hypot(dx,dz)
            if length<1:continue
            b['walkableProfile']=dict(a=list(a),b=list(z),height=max(.01,b.get('h',3)),step=.18)
    return data

def upper_walking_surfaces(data,core,walking_obstacle):
    obstacle_parts=polygons(walking_obstacle);obstacle_tree=STRtree(obstacle_parts)
    wet_shapes=[LineString(points(w['p'])).buffer(w['w']/2) if w.get('w') else ring(w) for c in data['chunks'] for w in c['objects'].get('water',[])]
    wet_tree=STRtree(wet_shapes)
    all_buildings=[b for c in data['chunks'] for b in c['objects'].get('buildings',[]) if not b.get('walkableProfile')]
    roof_shapes=[ring(b) for b in all_buildings];roof_tree=STRtree(roof_shapes)
    hosts=[b for c in data['chunks'] for b in c['objects'].get('buildings',[]) if b.get('walkableProfile')]
    shapes=[ring(b) for b in hosts];tree=STRtree(shapes);surfaces=[];claimed=set();records=[]
    for i,b in enumerate(hosts):surfaces.append(dict(kind='walkhost-'+str(i),shape=shapes[i].intersection(core),profile=b['walkableProfile'],source=b.get('osmId')))
    for r in data.get('walking',[]):
        if r.get('area') or len(r['p'])<4 or r.get('indoor') in ('yes','room','corridor') or r.get('tunnel'):continue
        line=LineString(points(r['p']));levels=route_levels(r)
        boardwalk=r.get('surface') in ('wood','woodchips:boardwalk') and len(wet_tree.query(line,predicate='intersects'))>0
        if (r.get('bridge') or boardwalk) and not levels:levels=[0]
        hits=list(tree.query(line,predicate='intersects')) if hosts else []
        # Hosted steps are verified against the emitted terrace, not ground asphalt.
        if hits and not levels:
            support=union([shapes[i] for i in hits]);inside=line.intersection(support)
            records.extend(dict(r,line=l) for l in lines(inside))
            for outside in lines(line.difference(support)):
                for reverse in (False,True):
                    endpoint=Point(outside.coords[-1] if reverse else outside.coords[0]);offset=0
                    for i in hits:
                        if shapes[i].distance(endpoint)>.01:continue
                        profile=hosts[i]['walkableProfile'];a,b=profile['a'],profile['b'];dx,dz=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((endpoint.x-a[0])*dx+(endpoint.y-a[1])*dz)/(dx*dx+dz*dz)));steps=max(1,math.ceil(profile['height']/.18));offset=max(offset,max(1,math.ceil(t*steps))/steps*profile['height'])
                    if offset<=0:continue
                    length=min(outside.length,offset/.45+1)
                    ramp=substring(outside,max(0,outside.length-length),outside.length) if reverse else substring(outside,0,length)
                    if ramp.length<.05:continue
                    offsets=[0,offset] if reverse else [offset,0]
                    area=ramp.buffer(r['w']/2,quad_segs=3)
                    # Only intersecting obstacles can change this local difference.
                    local=union([obstacle_parts[i] for i in obstacle_tree.query(area,predicate='intersects')])
                    area=area.difference(local).intersection(core)
                    surfaces.append(dict(kind='walkramp-'+str(len(surfaces)),shape=area,profile=dict(path=[v for xy in ramp.coords for v in xy],offsets=offsets),source=r['id']))
                    records.append(dict(r,line=ramp))
            continue
        if not levels or not (any(level>0 for level in levels) or r.get('bridge') or boardwalk):continue
        corridor=line.buffer(r['w']/2,quad_segs=3).intersection(core)
        if len(levels)==1:
            roof=max([all_buildings[i].get('h',0)+.2 for i in roof_tree.query(corridor,predicate='intersects')]+[levels[0]*3.3])
            levels=[roof/3.3]
        # Explicit upper levels retain a separate support plane. Building roofs
        # are sampled during baking; an upper route cannot be buried in a roof.
        surfaces.append(dict(kind='walklevel-'+str(len(surfaces)),shape=corridor,profile=dict(path=r['p'],levels=levels),source=r['id']))
        claimed.add(r['id']);records.append(dict(r,line=line))
    return surfaces,claimed,records

def normalize_ruins(data):
    paths=[LineString(points(r['p'])) for r in data.get('walking',[]) if len(r['p'])>=4 and not r.get('tunnel') and not r.get('bridge') and not any(v!=0 for v in route_levels(r))]
    tree=STRtree(paths)
    for c in data['chunks']:
        output=[]
        for b in c['objects'].get('buildings',[]):
            if not b.get('ruin') or any(b.get(k) for k in ('landmarkModel','seoulArchitecture','statueModel')):output.append(b);continue
            shape=ring(b);walls=shape.boundary.buffer(.3,quad_segs=2).intersection(shape)
            openings=union([paths[i].buffer(1.5,quad_segs=3) for i in tree.query(shape,predicate='intersects')])
            for p in polygons(walls.difference(openings)):
                if p.area>.1:output.append(dict(b,p=[v for xy in p.exterior.coords for v in xy],holes=[[v for xy in h.coords for v in xy] for h in p.interiors],h=min(b.get('h',2),2) if b.get('heightSource')=='default-estimate' else b.get('h',2)))
        c['objects']['buildings']=output
    return data

def normalize_passages(data):
    """Split only evidenced covered/parking access into ground walls and an upper volume."""
    candidates=[r for r in data['roads']+data.get('walking',[]) if not any(v!=0 for v in route_levels(r)) and r.get('indoor') in (None,'','no') and not r.get('tunnel') and not r.get('bridge') and r.get('layer',0)==0 and (r.get('covered')=='yes' or r.get('highway') in ('service','residential','living_street','footway','pedestrian','steps','path','cycleway'))]
    paths=[LineString(points(r['p'])) for r in candidates];tree=STRtree(paths)
    count=0
    for c in data['chunks']:
        output=[]
        for b in c['objects'].get('buildings',[]):
            if b.get('walkableProfile') or b.get('groundClearance',0)>0 or b.get('statueModel'):
                output.append(b);continue
            shape=ring(b);hits=[]
            authored=any(b.get(k) for k in ('landmarkModel','seoulArchitecture','palaceBuildingId'))
            for i in tree.query(shape,predicate='intersects'):
                r=candidates[i];span=shape.intersection(paths[i]).length
                if authored and r.get('covered') not in ('yes','arcade'):continue
                explicit=r.get('covered') in ('yes','arcade') or r.get('service')=='parking_aisle'
                access=r.get('highway')=='service' and (b.get('h',12)>=6 or b.get('vehiclePassage'))
                # Conflicting small low volumes on mapped local access routes are
                # represented as inferred covered passages, never silently removed.
                compact=r.get('highway') in ('residential','living_street') and shape.area<=100 and 3.5<=b.get('h',12)<=(12 if b.get('heightSource')=='default-estimate' else 8)
                # A mapped non-sidewalk path penetrating a volume is retained as an
                # inferred playable passage. Shallow facade offsets are routed outside.
                pedestrian=r.get('highway') in ('footway','pedestrian','steps','path','cycleway') and r.get('footway')!='sidewalk' and not r.get('area')
                interior=shape.buffer(-2).intersection(paths[i]).length if pedestrian else 0
                pedestrian=pedestrian and interior>1 and b.get('h',12)>=4
                if span>(1 if explicit else 3) and (explicit or access or compact or pedestrian):hits.append(i)
            if not hits:output.append(b);continue
            reserved=union([paths[i].buffer(max(3,candidates[i]['w'])/2+1.6,quad_segs=3) for i in hits])
            low=shape.difference(reserved)
            clearance=min(6,max(3,(b.get('h') or 12)*.5),(b.get('h') or 12)-.4)
            if authored:
                b=dict(b,passageGroundParts=[dict(p=[v for xy in part.exterior.coords for v in xy],holes=[[v for xy in h.coords for v in xy] for h in part.interiors]) for part in polygons(low)],passageClearance=clearance,passageSourceIds=[candidates[i]['id'] for i in hits]);output.append(b);count+=1;continue
            output.append(dict(b,groundClearance=clearance,clearanceSource='access-route-estimate',passageRole='upper-volume',passageSourceIds=[candidates[i]['id'] for i in hits]))
            for part in polygons(low):
                if part.area<1:continue
                output.append(dict(b,p=[v for xy in part.exterior.coords for v in xy],holes=[[v for xy in h.coords for v in xy] for h in part.interiors],h=clearance,passageRole='ground-pier'))
            count+=1
        c['objects']['buildings']=output
    print('street compiler: classified building passages',count,flush=True)
    return data

def prepare_obstacles(data,core,halo):
    # Allocate a minimum connected route before fitting approximate block frontages.
    reserve_bounds=core.buffer(20)
    reserves=[LineString(points(r['p'])).buffer(1.4,quad_segs=3).intersection(reserve_bounds) for r in data['roads'] if not r.get('bridge') and not r.get('tunnel') and r.get('layer',0)==0]
    reserves.extend(LineString(points(r['p'])).buffer(r['w']/2+.25,quad_segs=3).intersection(reserve_bounds) for r in data.get('walking',[]) if r.get('footway')=='sidewalk' and not any(v!=0 for v in route_levels(r)) and not r.get('bridge') and not r.get('tunnel'))
    walk_access=[r for r in data.get('walking',[]) if not r.get('area') and r.get('footway')!='sidewalk' and r.get('indoor') in (None,'','no') and not r.get('bridge') and not r.get('tunnel') and not any(v!=0 for v in route_levels(r))]
    walk_access_lines=[LineString(points(r['p'])) for r in walk_access];walk_access_tree=STRtree(walk_access_lines)
    reserve_tree=STRtree(reserves)
    print('street compiler: route reservations ready',len(reserves),flush=True)
    fitted=[];walking_fitted=[];frontages=[];frontage_conflicts=[]
    for c in data['chunks']:
        for b in c['objects'].get('buildings',[])+c['objects'].get('structures',[]):
            if b.get('bridge') or b.get('tunnel') or b.get('groundClearance',0)>0 or b.get('structureKind') in ('canopy','shelter','platform') or not nearby(b['p'],halo.bounds):continue
            shape=union([ring(p) for p in b['passageGroundParts']]) if 'passageGroundParts' in b else ring(b);hits=reserve_tree.query(shape,predicate='intersects')
            requested=[reserves[i] for i in hits]
            for i in walk_access_tree.query(shape,predicate='intersects'):
                line=walk_access_lines[i]
                if not shape.covers(Point(line.coords[0])) and not shape.covers(Point(line.coords[-1])):requested.append(line.buffer(walk_access[i]['w']/2+.25,quad_segs=3))
            cut=shape.difference(union(requested)) if requested else shape
            if not cut.equals(shape) and b.get('osmId') and not any(b.get(k) for k in ('landmarkModel','seoulArchitecture','palaceBuildingId','statueModel')):
                parts=[p for p in polygons(cut) if p.area>=1];cut=union(parts);loss=1-cut.area/max(shape.area,.001)
                # Keep at least 75% of the source mass, retaining all components and courtyards.
                if parts and loss<=.25 and cut.area>=12 and all(p.area>=1 for p in parts):
                    shape=cut;largest=max(parts,key=lambda p:p.area);frontages.append(dict(id=b['osmId'],chunk=[c['cx'],c['cz']],sourceP=b['p'],p=[round(v,4) for xy in largest.exterior.coords for v in xy],holes=[[round(v,4) for xy in h.coords for v in xy] for h in largest.interiors],parts=[dict(p=[round(v,4) for xy in p.exterior.coords for v in xy],holes=[[round(v,4) for xy in h.coords for v in xy] for h in p.interiors]) for p in parts],areaLoss=round(loss,5)))
                else:frontage_conflicts.append(dict(id=b.get('osmId'),areaLoss=round(loss,5)))
            fitted.append(shape)
            if not b.get('walkableProfile'):walking_fitted.append(shape)
            if len(fitted)%10000==0:print('street compiler: fitted buildings',len(fitted),flush=True)
    buildings=union(fitted)
    # Walls are placed after the transport envelope; gates do not erase road continuity.
    # Water crossings share one classification for vehicles and pedestrians.
    ground_roads=[dict(r,pedestrian=False) for r in data['roads'] if not r.get('tunnel') and r.get('layer',0)>=0]
    ground_roads.extend(dict(r,pedestrian=True) for r in data.get('walking',[]) if not r.get('area') and not r.get('tunnel') and r.get('layer',0)>=0 and r.get('indoor') in (None,'','no'))
    road_lines=[LineString(points(r['p'])) for r in ground_roads];road_tree=STRtree(road_lines)
    water_parts=[];crossings=[];water_updates={}
    for c in data['chunks']:
        resolved_water=[]
        for w in c['objects'].get('water',[]):
            if not nearby(w['p'],halo.bounds):continue
            shape=LineString(points(w['p'])).buffer(w['w']/2) if w.get('w') else ring(w)
            apertures=[];bank_cuts=[]
            for i in road_tree.query(shape.buffer(8),predicate='intersects'):
                r=ground_roads[i];line=road_lines[i]
                # A bank-following path can turn across a river while the wet
                # source interval remains long. Keep the bank intact and open
                # only a transverse crossing at a proven centreline side change.
                if r.get('pedestrian') and w.get('w'):
                    axis=LineString(points(w['p']));intersections=line.intersection(axis)
                    nodes=[intersections] if intersections.geom_type=='Point' else [p for p in getattr(intersections,'geoms',[]) if p.geom_type=='Point']
                    for node in nodes:
                        t=axis.project(node);a=axis.interpolate(max(0,t-.5));b=axis.interpolate(min(axis.length,t+.5));dx,dz=b.x-a.x,b.y-a.y;length=math.hypot(dx,dz)
                        if length<.1:continue
                        nx,nz=-dz/length,dx/length;station=line.project(node);reach=min(20,w['w']*1.5)
                        before=line.interpolate(max(0,station-reach));after=line.interpolate(min(line.length,station+reach))
                        left=(before.x-node.x)*nx+(before.y-node.y)*nz;right=(after.x-node.x)*nx+(after.y-node.y)*nz
                        if left*right>=0 or min(abs(left),abs(right))<min(.5,w['w']*.05):continue
                        half=w['w']/2+r['w']/2+1
                        cross=LineString([(node.x-nx*half,node.y-nz*half),(node.x+nx*half,node.y+nz*half)])
                        apertures.append(cross.buffer(r['w']/2+1,quad_segs=3))
                        crossings.append(dict(id=r['id'],p=[v for xy in cross.coords for v in xy],w=r['w'],pedestrian=True,source='centreline-side-change'))
                for span in lines(line.intersection(shape.buffer(8))):
                    # Short untagged crossings need a deck/culvert, not a sideways detour.
                    # Long crossings require explicit bridge evidence.
                    bank=bool(w.get('w') and LineString(points(w['p'])).distance(span)>w['w']*.1)
                    if bank and span.length>30 and not r.get('pedestrian'):
                        gap=span.buffer(r['w']/2+4,quad_segs=3);apertures.append(gap);bank_cuts.append(gap)
                        continue
                    # Classify each actual wet crossing separately. A nearby road
                    # may follow the bank for kilometres but cross only a culvert.
                    for wet in lines(span.intersection(shape)):
                        # Pedestrian-only inferred crossings stay short. A long
                        # riverside path must never drain a river to pass an audit.
                        limit=(min(80,max(6,w['w']*1.5+4)) if w.get('w') else 20) if r.get('pedestrian') else 300
                        opposite=False
                        if w.get('w') and r.get('pedestrian') and wet.length<=80:
                            axis=LineString(points(w['p']))
                            def bank_side(point):
                                distance=axis.project(point);q=axis.interpolate(distance);a=axis.interpolate(max(0,distance-.5));b=axis.interpolate(min(axis.length,distance+.5))
                                return (b.x-a.x)*(point.y-q.y)-(b.y-a.y)*(point.x-q.x)
                            a,b=Point(wet.coords[0]),Point(wet.coords[-1])
                            opposite=shape.boundary.distance(a)<.15 and shape.boundary.distance(b)<.15 and bank_side(a)*bank_side(b)<-.01
                        if wet.length>.1 and (wet.length<=limit or opposite or r.get('bridge') or r.get('layer',0)>0 or r.get('ford')=='yes'):
                            apertures.append(wet.buffer(r['w']/2+4,quad_segs=3))
                            crossings.append(dict(id=r['id'],p=[v for xy in wet.coords for v in xy],w=r['w'],pedestrian=r.get('pedestrian',False),source='ford' if r.get('ford')=='yes' else 'tag' if r.get('bridge') else 'opposite-bank-crossing' if opposite else 'short-water-crossing'))
            water_parts.append(shape.difference(union(apertures)))
            if bank_cuts or w.get('holes'):
                fixed=shape.difference(union(bank_cuts))
                for p in polygons(fixed):
                    if p.area>=.01:resolved_water.append(dict({k:v for k,v in w.items() if k not in ('p','w','holes')},p=[v for xy in p.exterior.coords for v in xy],holes=[[v for xy in h.coords for v in xy] for h in p.interiors]))
            else:resolved_water.append(w)
        water_updates[str(c['cx'])+'_'+str(c['cz'])]=resolved_water
    water=union(water_parts)
    islands=union([ring(i) for i in data.get('islands',[])])
    building_clearance=metric_buffer(buildings,.4,quad_segs=3)
    obstacle=union([building_clearance,islands])
    ground_obstacle=union([obstacle,water])
    print('street compiler: source and obstacles ready',flush=True)
    return buildings,ground_obstacle,building_clearance,frontages,frontage_conflicts,crossings,water_updates,union([union(walking_fitted),water])

def fill_sliver_holes(asphalt,pavement,obstacle):
    # Modify hole rings directly; avoid re-noding the entire city for small fills.
    obstacles=polygons(obstacle);tree=STRtree(obstacles);filled=[];rebuilt=[]
    for p in polygons(asphalt):
        holes=[]
        for h in p.interiors:
            hole=Polygon(h)
            local=union([make_valid(clip_by_rect(obstacles[i],*hole.bounds)) for i in tree.query(hole)]) if hole.area<250 else None
            if hole.area<250 and hole.intersection(local).area<.01 and hole.buffer(-1.4).is_empty:filled.append(hole)
            else:holes.append(h)
        rebuilt.append(Polygon(p.exterior,holes))
    if not filled:return asphalt,pavement
    tree=STRtree(filled)
    # Existing asphalt islands inside a filled hole are already included by its parent.
    kept=[p for p in rebuilt if not any(filled[i].covers(p) for i in tree.query(p.representative_point()))]
    result=MultiPolygon(kept)
    if not result.is_valid:result=make_valid(result,method='structure')
    return result,overlay(pavement,union(filled),'difference')

def buffered_overlay(a,b,operation,distance,linear=False,exclude=None,tile_size=2048):
    # Buffer the operand with a metric halo, then apply the boolean locally.
    # Lines stay segmented; the following stroke union resolves shared endpoints.
    if a.is_empty:return a
    ap=lines(a) if linear else polygons(a)
    if linear and a.geom_type=='LinearRing':ap=[LineString(a.coords)]
    bp=polygons(b);at=STRtree(ap);bt=STRtree(bp);pad=abs(distance)+1
    x0,z0,x1,z1=a.bounds
    tasks=[(x,z) for x in range(math.floor(x0/tile_size),math.floor(x1/tile_size)+1) for z in range(math.floor(z0/tile_size),math.floor(z1/tile_size)+1)]
    def work(task):
        x,z=task;tile=box(x*tile_size,z*tile_size,(x+1)*tile_size,(z+1)*tile_size)
        bounds=tile.buffer(.00001).bounds if linear else tile.bounds
        left=union([make_valid(clip_by_rect(ap[i],*bounds)) for i in at.query(tile)])
        if linear:left=left.intersection(tile)
        if left.is_empty:return GeometryCollection()
        expanded=tile.buffer(pad);bounds=expanded.bounds
        right=union([make_valid(clip_by_rect(bp[i],*bounds)) for i in bt.query(expanded)])
        if distance:right=right.buffer(distance,quad_segs=4)
        result=getattr(left,operation)(right)
        return result.difference(exclude) if exclude is not None else result
    pieces=[]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i,piece in enumerate(pool.map(work,tasks)):
            pieces.append(piece)
            if len(tasks)>100 and (i+1)%100==0:print('street compiler: buffered overlay',distance,i+1,'/',len(tasks),flush=True)
    return MultiLineString([line for piece in pieces for line in lines(piece)]) if linear else stitch_tiles(pieces)

def clip_surface(geometry,bounds):
    clipped=clip_by_rect(geometry,*bounds)
    if not clipped.is_valid:clipped=make_valid(clipped,method='structure')
    return clipped if clipped.geom_type in ('Polygon','MultiPolygon') else MultiPolygon(polygons(clipped))

def audit_route_coverage(road_records,asphalt,core):
    # Test the prepared surface directly; buffer only local failed candidates.
    # Whole-city tolerance buffers duplicate millions of edges just for a predicate.
    queries=[prep(g) for g in asphalt.geoms] if asphalt.geom_type=='GeometryCollection' else [prep(asphalt)]
    covers=lambda geometry:any(q.covers(geometry) for q in queries)
    parts=polygons(asphalt);tree=STRtree(parts);tiles={};combined={};buffered={}
    def local(geometry):
        x0,z0,x1,z1=geometry.bounds;selected=[]
        for x in range(math.floor(x0/1024),math.floor(x1/1024)+1):
            for z in range(math.floor(z0/1024),math.floor(z1/1024)+1):
                key=(x,z)
                if key not in tiles:
                    tile=box(x*1024-1,z*1024-1,(x+1)*1024+1,(z+1)*1024+1)
                    tiles[key]=union([delivery_clip(parts[i],tile.bounds) for i in tree.query(tile)])
                selected.append(tiles[key])
        if len(selected)==1:return selected[0]
        key=tuple((math.floor(v/1024)) for v in geometry.bounds)
        if key not in combined:combined[key]=union(selected)
        return combined[key]
    blocked=[];samples=missing=0;uncovered=0
    for r in road_records:
        line=r['line'].intersection(core)
        if line.is_empty:continue
        if covers(line):
            samples+=sum(max(1,math.ceil(part.length/2))+1 for part in lines(line))
            continue # Exact whole-line containment proves every sample is covered.
        key=tuple(math.floor(v/1024) for v in line.bounds)
        if key not in buffered:buffered[key]=local(line).buffer(.001,quad_segs=4)
        uncovered+=line.difference(buffered[key]).length
        for part in lines(line):
            n=max(1,math.ceil(part.length/2));absent=[]
            for i in range(n+1):
                p=part.interpolate(i/n,normalized=True);samples+=1
                if not covers(p):
                    surface=local(p)
                    if surface.is_empty or surface.distance(p)>.06:
                        missing+=1;absent.append([round(p.x,2),round(p.y,2)])
            if absent:blocked.append(dict(id=r['id'],highway=r['highway'],points=absent[:6],count=len(absent)))
    return samples,missing,uncovered,blocked

def reserve_final_routes(asphalt,pavement,road_records,obstacle,core):
    # Width erosion can leave centimetre gaps where the old provisional 5cm
    # coverage query accepted a route. Reserve the actual corridor in the final
    # partition before curbs/paint/props; never relax the continuity audit.
    query=prep(asphalt);parts=polygons(obstacle);tree=STRtree(parts);reservations=[]
    for r in road_records:
        if r['elevated']:continue
        line=r['line'].intersection(core)
        if line.is_empty or query.covers(line):continue
        corridor=line.buffer(min(r['w']/2,1.5),quad_segs=4).intersection(core)
        mask=union([make_valid(clip_by_rect(parts[i],*corridor.bounds)) for i in tree.query(corridor)])
        reservations.append(corridor.difference(mask))
    if not reservations:return asphalt,pavement
    allocated=union(reservations)
    return union([asphalt,allocated]),overlay(pavement,allocated,'difference')

def compile_region(data):
    bounds=data['bounds']; core=box(*bounds); halo=core.buffer(data.get('halo',160),join_style=2)
    walk=data.get('sidewalk',2.3)
    def stage(name,build):
        return cached_stage(data,name,[inspect.getsource(compile_region).split('\n    # Tiny residual slivers')[0],normalize_source,normalize_passages,prepare_obstacles,route_guides,overlay,metric_buffer,stitch_tiles,ring,union],build)
    buildings,ground_obstacle,building_clearance,frontages,frontage_conflicts,crossings,water_updates,walking_obstacle=cached_stage(data,'obstacles',[normalize_source,normalize_passages,prepare_obstacles,metric_buffer,stitch_tiles,ring,union],lambda:prepare_obstacles(data,core,halo))
    protected=cached_stage(data,'protected',[normalize_source,normalize_passages,prepare_obstacles,metric_buffer,stitch_tiles,ring,union],lambda:metric_buffer(ground_obstacle,data.get('buildingClearance',.8),quad_segs=3))
    guides,guide_changes,guide_failures=cached_stage(data,'guides',[normalize_source,normalize_passages,prepare_obstacles,metric_buffer,stitch_tiles,route_guides,ring,union],lambda:route_guides(data['roads'],ground_obstacle,core,protected=protected))
    print('street compiler: guides ready',len(guide_changes),len(guide_failures),flush=True)
    if data.get('coverage')=='manifest':
        (ROOT/'build/streets'/(data['city']+'-'+data['region']+'-guide-audit.json')).write_text(json.dumps(dict(sourceWays=len(data['roads']),adjusted=len(guide_changes),failures=guide_failures)))
    if data.get('coverage')=='manifest' and guide_failures:
        raise ValueError(str(len(guide_failures))+' unresolved route guides; city activation blocked. See the guide-audit report and classify-street-conflicts.py.')
    road_records=[];families={}
    for r in guides:
        if r.get('tunnel') or r.get('layer',0)<0:continue
        line=LineString(points(r['p'])).intersection(halo)
        if line.is_empty:continue
        elevated=bool(r.get('bridge') or r.get('layer',0)>0)
        for part in lines(line):
            if part.length<.2:continue
            record=dict(r,line=part,elevated=elevated)
            road_records.append(record)
            # Only opposing carriageways sharing semantic road identity can close a median gap.
            identity=(r.get('name') or r['id'],r.get('highway','unknown'),r.get('layer',0),elevated)
            families.setdefault(identity,[]).append(record)
    surfaces=[];group_info=[];family_areas={};elevated_masks=[]
    for identity,rs in sorted(families.items()):
        parts=[r['line'].buffer(r['w']/2,quad_segs=4) for r in rs]
        area=union(parts)
        directional=[r for r in rs if r.get('oneway') in ('yes','-1','1')]
        # Closing is restricted to same-named directional street families; real
        # barriers/water/islands remain excluded. Preserve unrelated parallel routes.
        if len(directional)>1:
            band=union([r['line'].buffer(r['w']/2,quad_segs=4) for r in directional])
            area=union([area,metric_buffer(metric_buffer(band,data.get('medianJoin',5)),-data.get('medianJoin',5))])
        elevated=identity[-1]
        if elevated:elevated_masks.append(area)
        surfaces.append((area,elevated));family_areas[identity]=area
        group_info.append(dict(id='street-'+hashlib.sha256(str(identity).encode()).hexdigest()[:12],name=identity[0],members=sorted({r['id'] for r in rs}),layer=identity[2],elevated=elevated))
    # Joint space allocation: reserve a shared sidewalk from the whole envelope,
    # rather than wrapping each lane/way in its own sidewalk.
    print('street compiler: families ready',len(families),flush=True)
    ground=stage('ground',lambda:union([a for a,e in surfaces if not e]))
    decks=stage('decks',lambda:overlay(union(elevated_masks),building_clearance,'difference'))
    envelope=stage('envelope',lambda:overlay(metric_buffer(ground,walk),ground_obstacle,'difference'))
    asphalt=stage('initial-asphalt',lambda:overlay(ground,metric_buffer(envelope,-walk),'intersection'))
    # Intersections are union surfaces; narrow links can be shared streets (no
    # raised sidewalk) when the desired sidewalk would erase a valid route.
    shared=[]
    obstacle_parts=polygons(ground_obstacle);obstacle_tree=STRtree(obstacle_parts)
    coverage_initial=prep(stage('initial-coverage',lambda:metric_buffer(asphalt,.05)))
    for r in road_records:
        if r['elevated']:continue
        line=r['line']
        if coverage_initial.covers(line.intersection(core)):continue
        footprint=line.buffer(min(r['w']/2,1.5),quad_segs=4)
        local_mask=union([make_valid(clip_by_rect(obstacle_parts[i],*footprint.bounds)) for i in obstacle_tree.query(footprint)])
        free=footprint.difference(local_mask)
        if not free.is_empty:shared.append(free)
    asphalt=stage('shared-asphalt',lambda:overlay(union([asphalt,*shared]),envelope,'intersection'))
    asphalt=stage('all-asphalt',lambda:union([asphalt,decks]))
    pavement=stage('pavement',lambda:overlay(overlay(envelope,asphalt,'difference'),decks,'difference'))
    # Tiny residual slivers of pavement inside a same-level carriageway are not
    # authored traffic islands. Turn only enclosed, non-protected holes into road.
    # Ground allocation and elevated decks have different owners. A building
    # footprint must never erase a road above it.
    asphalt=stage('ground-layer-only',lambda:overlay(asphalt,ground,'intersection'))
    elevated_surfaces={level:clip_surface(union([a for identity,a in family_areas.items() if identity[-1] and max(1,identity[2])==level]),bounds) for level in sorted({max(1,k[2]) for k in family_areas if k[-1]})}
    decks=union(list(elevated_surfaces.values()))
    elevated_roofs=[]
    upper_query=prep(decks)
    for c in data['chunks']:
        for b in c['objects'].get('buildings',[])+c['objects'].get('structures',[]):
            if upper_query.intersects(ring(b)):
                elevated_roofs.append(dict(p=b['p'],holes=b.get('holes',[]),h=max(b.get('h',3),b.get('groundClearance',0)+.4)))
    final_sources=[inspect.getsource(compile_region).split('\n    # Tiny residual slivers')[0],normalize_source,normalize_passages,prepare_obstacles,route_guides,overlay,metric_buffer,stitch_tiles,ring,union,fill_sliver_holes,'separate-elevated-v1']
    asphalt,pavement=cached_stage(data,'filled-surfaces',final_sources,lambda:fill_sliver_holes(asphalt,pavement,ground_obstacle))
    asphalt,pavement=cached_stage(data,'clipped-surfaces',final_sources+[clip_surface],lambda:(clip_surface(asphalt,bounds),clip_surface(pavement,bounds)))
    asphalt,pavement=cached_stage(data,'reserved-surfaces',final_sources+[clip_surface,reserve_final_routes],lambda:reserve_final_routes(asphalt,pavement,road_records,ground_obstacle,core))
    walk_surfaces,upper_walk_ids,host_walk_records=upper_walking_surfaces(data,core,walking_obstacle)
    # Pedestrian areas retain their own ownership: never painted as asphalt.
    walk_parts=[];walking_records=[];interior_walks=[]
    walking_obstacles=polygons(walking_obstacle);walking_tree=STRtree(walking_obstacles)
    eligible=[r for r in data.get('walking',[]) if r['id'] not in upper_walk_ids and not r.get('area') and r.get('indoor') not in ('yes','room','corridor') and not r.get('tunnel') and not r.get('bridge') and r.get('layer',0)==0]
    exterior=[];entry_parts=polygons(buildings);entry_tree=STRtree(entry_parts);entry_query=prep(buildings)
    for r in eligible:
        line=LineString(points(r['p']));ends=[Point(line.coords[0]),Point(line.coords[-1])]
        if r.get('footway')=='sidewalk' or r.get('covered') in ('yes','arcade') or not any(entry_query.covers(p) for p in ends):exterior.append(r);continue
        local=union([entry_parts[i] for i in entry_tree.query(line)])
        lost=lines(line.intersection(local))
        if lost and all(any(piece.distance(p)<.01 for p in ends) for piece in lost):
            interior_walks.append(dict(id=r['id'],reason='building-interior-terminal',meters=sum(p.length for p in lost)))
            exterior.extend(dict(r,p=[v for xy in piece.coords for v in xy]) for piece in lines(line.difference(local)))
        else:exterior.append(r)
    eligible=exterior
    walking_guides,walking_adjustments,walking_guide_failures=route_guides(eligible,walking_obstacle,core,max_shift=data.get('pedestrianMaxShift',6),protected=metric_buffer(walking_obstacle,.2,quad_segs=3))
    if walking_guide_failures:
        # Re-solve the joint graph in a larger bounded band, retaining shared
        # nodes. This is a real detour around obstacles, never erased water.
        walking_guides,walking_adjustments,walking_guide_failures=route_guides(eligible,walking_obstacle,core,max_shift=data.get('pedestrianFallbackShift',16),protected=metric_buffer(walking_obstacle,.2,quad_segs=3))
    walking_paths=walking_guides+[r for r in data.get('walking',[]) if r.get('area')]
    for path in walking_paths:
        if path['id'] in upper_walk_ids or path.get('indoor') in ('yes','room','corridor') or path.get('tunnel') or path.get('layer',0)!=0 or path.get('bridge'):continue
        if len(path['p'])<4:continue
        line=LineString(points(path['p']))
        shape=Polygon(points(path['p'])) if path.get('area') and len(path['p'])>=6 else line.buffer(path['w']/2,quad_segs=4)
        local_obstacles=union([walking_obstacles[i] for i in walking_tree.query(shape)])
        shape=make_valid(shape).difference(local_obstacles).intersection(core)
        walk_parts.append(shape)
        # Public paths often end a short distance inside an entrance footprint.
        # End only that terminal stub at the facade; interior gaps remain failures.
        free=line.difference(local_obstacles)
        lost=lines(line.difference(free))
        endpoints=[Point(line.coords[0]),Point(line.coords[-1])]
        # An exterior route ends at the facade. A mapped interior tail is not
        # an outdoor street: retain its ID/reason instead of cutting a building.
        # Explicit sidewalks and covered passages never use this classification.
        terminal=bool(lost) and path.get('footway')!='sidewalk' and path.get('covered') not in ('yes','arcade') and all(any(piece.distance(end)<.01 and buildings.covers(end) for end in endpoints) for piece in lost)
        if terminal:interior_walks.append(dict(id=path['id'],reason='building-interior-terminal',meters=sum(p.length for p in lost)))
        if terminal:
            walking_records.extend(dict(path,line=part) for part in lines(free))
        else:walking_records.append(dict(path,line=line))
    pedestrian=union(walk_parts)
    if walk_parts:pavement=overlay(union([pavement,pedestrian]),asphalt,'difference')
    # Terraced hosts supply actual baked support; remove their footprint from
    # the ground route audit only after checking the same emitted surface.
    host_surface=union([s['shape'] for s in walk_surfaces if s['kind'].startswith(('walkhost-','walkramp-'))])
    hosted_samples,hosted_missing,hosted_uncovered,hosted_blocked=audit_route_coverage(host_walk_records,union([s['shape'] for s in walk_surfaces]),core)
    walking_records=[dict(r,line=piece) for r in walking_records for piece in lines(r['line'].difference(host_surface))]
    walking_samples,walking_missing,walking_uncovered,walking_blocked=audit_route_coverage([r for r in walking_records if not r.get('area')],GeometryCollection([pavement,asphalt]),core)
    walking_samples+=hosted_samples;walking_missing+=hosted_missing;walking_uncovered+=hosted_uncovered;walking_blocked+=hosted_blocked
    # Clearances and continuity measured on final surfaces, not proposed widths.
    route_samples,missing,uncovered_length,blocked=audit_route_coverage([r for r in road_records if not r['elevated']],asphalt,core)
    upper_samples,upper_missing,upper_uncovered,upper_blocked=audit_route_coverage([r for r in road_records if r['elevated']],decks,core)
    route_samples+=upper_samples;missing+=upper_missing;uncovered_length+=upper_uncovered;blocked+=upper_blocked
    print('street compiler: partition audited',missing,flush=True)
    if data.get('coverage')=='manifest':
        report=dict(interiorWalking=interior_walks,missingRouteSamples=missing,uncoveredRouteMeters=uncovered_length,blockedRoutes=blocked,walkingSamples=walking_samples,walkingMissing=walking_missing,walkingUncoveredMeters=walking_uncovered,walkingBlocked=walking_blocked,walkingGuideFailures=walking_guide_failures)
        (ROOT/'build/streets'/(data['city']+'-'+data['region']+'-design-progress.json')).write_text(json.dumps(report))
        if missing or uncovered_length>.01 or walking_missing or walking_uncovered>.01:
            raise ValueError('Disconnected city routes; see design-progress.json. Geometry generation and publishing stopped.')
    pavement=overlay(pavement,host_surface,'difference')
    road_building=overlay(asphalt,buildings,'intersection').area
    overlap=overlay(asphalt,pavement,'intersection').area
    # Curbs follow the actual partition boundary; never source-way interior edges.
    def build_curbs():
        curb_lines=buffered_overlay(asphalt.boundary,pavement,'intersection',.03,linear=True,exclude=core.boundary.buffer(.06))
        return overlay(metric_buffer(curb_lines,.12),GeometryCollection([asphalt,pavement]),'intersection')
    curbs=cached_stage(data,'curbs',final_sources+[clip_surface,reserve_final_routes,buffered_overlay,build_curbs],build_curbs)
    # Paint from a single simplified axis per family. Collapse nearby opposite
    # directions to one centre axis; endpoints/junctions get a deliberate gap.
    paint=[];axes=[];paint_tiles={}
    def local_asphalt(area):
        x0,z0,x1,z1=area.bounds;parts=[]
        for x in range(math.floor(x0/1024),math.floor(x1/1024)+1):
            for z in range(math.floor(z0/1024),math.floor(z1/1024)+1):
                if not area.intersects(box(x*1024,z*1024,(x+1)*1024,(z+1)*1024)):continue
                key=(x,z)
                if key not in paint_tiles:paint_tiles[key]=make_valid(clip_by_rect(asphalt,x*1024,z*1024,(x+1)*1024,(z+1)*1024))
                if not paint_tiles[key].is_empty:
                    local=make_valid(clip_by_rect(paint_tiles[key],*area.bounds))
                    if not local.is_empty:parts.append(local)
        return parts[0] if len(parts)==1 else union(parts)
    for fi,(family,rs) in enumerate(sorted(families.items())):
        if fi%10000==0:print('street compiler: paint families',fi,'/',len(families),flush=True)
        # Bus lanes and connector ramps belong to the carriageway but do not
        # introduce another yellow street centreline.
        if family[-1] or family[1]=='busway' or family[1].endswith('_link') or (data.get('centerlineHighways') is not None and family[1] not in data['centerlineHighways']) or not any(r['w']>=data.get('centerlineMinWidth',6) for r in rs):continue
        family_area=family_areas[family]
        area=family_area.intersection(local_asphalt(family_area))
        used=[]
        for r in sorted(rs,key=lambda r:(-r['line'].length,r['id'])):
            l=r['line']
            if l.length<12 or r['w']<data.get('centerlineMinWidth',6):continue
            coords=[];count=max(2,math.ceil(l.length/4))
            for i in range(count+1):
                d=i/count*l.length;p=l.interpolate(d)
                before=l.interpolate(max(0,d-1));after=l.interpolate(min(l.length,d+1))
                dx,dy=after.x-before.x,after.y-before.y;n=math.hypot(dx,dy)
                if n<.01:continue
                nx,ny=-dy/n,dx/n
                cut=LineString([(p.x-nx*45,p.y-ny*45),(p.x+nx*45,p.y+ny*45)])
                spans=lines(area.intersection(cut))
                if not spans:continue
                span=min(spans,key=lambda s:s.distance(p))
                if span.distance(p)>4:continue
                mid=span.interpolate(.5,normalized=True);coords.append((mid.x,mid.y))
            if len(coords)<2:continue
            axis=LineString(coords).simplify(.35)
            near=[used[i] for i in STRtree(used).query(axis.buffer(1.5))] if used else []
            remaining=axis.difference(union(near).buffer(1.5)) if near else axis
            pieces=[p for p in lines(remaining) if p.length>8]
            used.extend(pieces);axes.extend(pieces)
    # Paint is wholly inside final asphalt and avoids intersections of unrelated roads.
    junctions=[]
    axis_tree=STRtree(axes)
    for i,a in enumerate(axes):
        for j in axis_tree.query(a,predicate='intersects'):
            if j<=i:continue
            hit=a.intersection(axes[j])
            if not hit.is_empty:junctions.append(hit.buffer(4))
    paint=buffered_overlay(union([a.buffer(.075,cap_style=2) for a in axes]),asphalt,'intersection',-.7)
    paint=overlay(paint,union(junctions),'difference')
    # Sites derived from final continuous sidewalk boundaries, with footprint and
    # walking clear space rather than lane offsets. Stable global spacing.
    props=[];prop_grid={}
    road_boundary=asphalt.boundary
    boundary_parts=[]
    for boundary in lines(road_boundary):
        coords=list(boundary.coords)
        boundary_parts.extend(LineString(coords[i:i+65]) for i in range(0,len(coords)-1,64))
    boundary_tree=STRtree(boundary_parts)
    pavement_query=prep(pavement);prop_core=prep(core.buffer(-2))
    for edge in lines(pavement.boundary):
        for d in range(12,int(edge.length),28):
            p=edge.interpolate(d)
            edge_near=boundary_parts[boundary_tree.nearest(p)] if boundary_parts else None
            q=edge_near.interpolate(edge_near.project(p)) if edge_near is not None else p
            dx,dy=p.x-q.x,p.y-q.y;norm=math.hypot(dx,dy)
            if norm<.1:continue
            candidate=Point(q.x+dx/norm*1.35,q.y+dy/norm*1.35)
            footprint=box(candidate.x-.9,candidate.y-.9,candidate.x+.9,candidate.y+.9)
            if not pavement_query.covers(footprint) or not prop_core.covers(candidate):continue
            spacing=data.get('propSpacing',19)
            gx,gz=math.floor(candidate.x/spacing),math.floor(candidate.y/spacing)
            if any(math.hypot(candidate.x-v['x'],candidate.y-v['z'])<spacing for dx in (-1,0,1) for dz in (-1,0,1) for v in prop_grid.get((gx+dx,gz+dz),[])):continue
            site=dict(x=round(candidate.x,3),z=round(candidate.y,3),tree=(len(props)%3==0))
            props.append(site);prop_grid.setdefault((gx,gz),[]).append(site)
    return dict(walkingRoutes=[dict(r,elevated=False,layer=0) for r in walking_records]+[dict(r,elevated=True,layer=1) for r in host_walk_records],walkSurfaces=walk_surfaces,elevatedRoofs=elevated_roofs,elevatedSurfaces=elevated_surfaces,waterUpdates=water_updates,crossings=crossings,asphalt=asphalt,pavement=pavement,curbs=curbs,paint=paint,props=props,groups=group_info,roads=road_records,decks=decks,
        audit=dict(interiorWalking=interior_walks,walkingGuideAdjustments=walking_adjustments,walkingGuideFailures=walking_guide_failures,walkingSources=len(data.get('walking',[])),walkingSamples=walking_samples,walkingMissing=walking_missing,walkingUncoveredMeters=walking_uncovered,walkingBlocked=walking_blocked,frontageAdjustments=frontages,frontageConflicts=frontage_conflicts,guideAdjustments=guide_changes,guideFailures=guide_failures,sourceWays=len(data['roads']),streetGroups=len(group_info),routeSamples=route_samples,missingRouteSamples=missing,uncoveredRouteMeters=round(uncovered_length,6),blockedRoutes=blocked,buildingOverlap=road_building,surfaceOverlap=overlap,carriagewayComponents=len(polygons(asphalt)),pavementComponents=len(polygons(pavement)),props=len(props)))
def delivery_clip(geometry,bounds):
    # GEOS rectangle clipping can produce a three-coordinate degenerate ring
    # where a sliver touches the delivery boundary. Fall back to exact overlay;
    # do not discard the feature or change the ownership mask.
    try:return make_valid(clip_by_rect(geometry,*bounds))
    except GEOSException:return make_valid(geometry).intersection(box(*bounds))

def encode_region(data,result,output_dir=None):
    core=box(*data['bounds']);output={}
    wall_parts=[r['line'].buffer(r.get('w',2.5)/2+.35,quad_segs=3) for r in result.get('walkingRoutes',[]) if not r.get('area') and not r.get('elevated')]
    wall_tree=STRtree(wall_parts)
    layer_parts={kind:polygons(result[name]) for kind,name in [('asphalt','asphalt'),('pavement','pavement'),('curb','curbs'),('center','paint')]}
    layer_parts.update({'deck-'+str(level):polygons(g) for level,g in result.get('elevatedSurfaces',{}).items()})
    layer_trees={kind:STRtree(parts) for kind,parts in layer_parts.items()}
    frontage_by_id={}
    for p in result['audit']['frontageAdjustments']:frontage_by_id.setdefault(p['id'],[]).append(p)
    for c in data['chunks']:
        cx,cz=c['cx'],c['cz'];tile=box(cx*1024,cz*1024,(cx+1)*1024,(cz+1)*1024);extent=tile.intersection(core)
        if extent.area<.01:continue
        regions=[];clearance_tile=tile.buffer(1);source_tile=tile.buffer(2)
        local_asphalt=union([delivery_clip(layer_parts['asphalt'][i],source_tile.bounds) for i in layer_trees['asphalt'].query(source_tile)])
        local_wall_cut=union([local_asphalt.buffer(.35,quad_segs=4)]+[delivery_clip(wall_parts[i],clearance_tile.bounds) for i in wall_tree.query(clearance_tile)])
        for kind,parts in layer_parts.items():
            geo=union([delivery_clip(parts[i],tile.bounds) for i in layer_trees[kind].query(tile)])
            for p in polygons(geo.intersection(tile)):
                if p.area<.001:continue
                # Triangulate the valid partition before coordinate quantization. Complex
                # junction polygons can contain dozens of touching/nearby holes.
                triangles=[[round(v,4) for xy in list(t.exterior.coords)[:3] for v in xy] for t in constrained_delaunay_triangles(p).geoms]
                regions.append(dict(kind=kind,p=[round(v,4) for xy in p.exterior.coords for v in xy],holes=[[round(v,4) for xy in h.coords for v in xy] for h in p.interiors],triangles=triangles))
        for surface in result.get('walkSurfaces',[]):
            geometry=surface['shape'].intersection(tile)
            if geometry.is_empty:continue
            profile=surface['profile'];bands=[]
            if 'a' in profile:
                ax,az=profile['a'];bx,bz=profile['b'];dx,dz=bx-ax,bz-az;length=math.hypot(dx,dz);ux,uz=dx/length,dz/length
                steps=max(1,math.ceil(profile['height']/.18));reach=max(core.bounds[2]-core.bounds[0],core.bounds[3]-core.bounds[1])+10
                for j in range(steps):
                    lo=j/steps*length-.000001;hi=(j+1)/steps*length+.000001
                    band=Polygon([(ax+ux*t-uz*s,az+uz*t+ux*s) for t,s in [(lo,-reach),(hi,-reach),(hi,reach),(lo,reach)]])
                    bands.append((geometry.intersection(band),dict(offset=(j+1)/steps*profile['height'])))
            else:bands=[(geometry,profile)]
            for geo,heights in bands:
                for p in polygons(geo):
                    if p.area<.001:continue
                    triangles=[[round(v,4) for xy in list(t.exterior.coords)[:3] for v in xy] for t in constrained_delaunay_triangles(p).geoms]
                    regions.append(dict(kind='walkdeck',profile=heights,source=surface.get('source'),p=[v for xy in p.exterior.coords for v in xy],holes=[[v for xy in h.coords for v in xy] for h in p.interiors],triangles=triangles))
        part=dict(version=1,region=data['region'],bounds=list(extent.bounds),regions=regions,buildings=[f for b in c['objects'].get('buildings',[]) for f in frontage_by_id.get(b.get('osmId'),[]) if (f.get('chunk')==[cx,cz] if 'chunk' in f else ring(b).buffer(.001).covers(ring(f)))],walls=[dict(w,p=[round(v,4) for xy in piece.coords for v in xy]) for w in c['objects'].get('walls',[]) for piece in lines(LineString(points(w['p'])).difference(local_wall_cut)) if piece.length>.15],props=[p for p in result['props'] if cx*1024<=p['x']<(cx+1)*1024 and cz*1024<=p['z']<(cz+1)*1024],crossings=[r for r in result['crossings'] if nearby(r['p'],tile.bounds)])
        def resolve_objects(kind):
            resolved=[]
            for source in c['objects'].get(kind,[]):
                b=dict(source)
                for fit in frontage_by_id.get(b.get('osmId'),[]):
                    if fit.get('sourceP')==b['p'] and fit.get('chunk')==[cx,cz]:
                        pieces=fit.get('parts',[dict(p=fit['p'],holes=fit.get('holes',[]))])
                        for extra in pieces[1:]:resolved.append(dict(b,**extra))
                        b.update(pieces[0]);break
                if b.get('groundClearance',0)>0 or b.get('structureKind') in ('canopy','shelter','platform'):
                    sites=[];path=points(b['p'])
                    for a,d in zip(path,path[1:]+path[:1]):
                        length=math.dist(a,d);steps=max(1,math.ceil(length/6))
                        for j in range(steps):
                            x=a[0]+(d[0]-a[0])*j/steps;z=a[1]+(d[1]-a[1])*j/steps
                            if not local_wall_cut.intersects(box(x-.1,z-.1,x+.1,z+.1)):sites.extend([round(x,4),round(z,4)])
                    b['supportPoints']=sites
                resolved.append(b)
            return resolved
        part['resolvedSites']=c['objects'].get('sites',[])
        part['resolvedWater']=result['waterUpdates'].get(str(cx)+'_'+str(cz),c['objects'].get('water',[]))
        part['resolvedBuildings']=resolve_objects('buildings')
        part['resolvedStructures']=resolve_objects('structures')
        key=f'{cx}_{cz}'
        if output_dir:
            dest=output_dir/(key+'.json');dest.write_text(json.dumps(part,separators=(',',':')))
            output[key]=str(dest)
        else:output[key]=part
        if len(output)%100==0:print('street compiler: encoded',len(output),flush=True)
    return dict(format='chunk-files',chunks=output) if output_dir else output
def main():
    city=sys.argv[1] if len(sys.argv)>1 else 'seoul';region=sys.argv[2] if len(sys.argv)>2 else 'jongno-cheonggye'
    path=ROOT/f'build/streets/{city}-{region}-input.json';raw=path.read_bytes();data=json.loads(raw)
    data['_sourceHash']=hashlib.sha256(raw).hexdigest()
    del raw
    data=normalize_passages(normalize_ruins(normalize_source(normalize_walk_hosts(data))))
    path.with_name(city+'-'+region+'-resolved-input.json').write_text(json.dumps(data,separators=(',',':')))
    import pickle
    checkpoint=path.with_name(city+'-'+region+'-partition.pickle')
    from street_checkpoint import load_design,save_design
    result=load_design(path,Path(__file__),checkpoint) if data.get('coverage')=='manifest' else None
    if '--encode-only' in sys.argv and result is None:raise ValueError('No matching verified design checkpoint; run the full compiler.')
    if result is None:
        result=compile_region(data)
        if data.get('coverage')=='manifest':save_design(path,Path(__file__),checkpoint,result)
    else:print('street compiler: verified design checkpoint reused; encoding regenerated',flush=True)
    directory=path.parent/(city+'-'+region+'-regions') if data.get('coverage')=='manifest' else None
    if directory:directory.mkdir(exist_ok=True)
    path.with_name(city+'-'+region+'-elevated-roofs.json').write_text(json.dumps(result.get('elevatedRoofs',[]),separators=(',',':')))
    output=encode_region(data,result,directory)
    audit=result['audit'];audit['bounds']=data['bounds'];audit['chunks']=len(output.get('chunks',output))
    # Publishing is a separate atomic step after geometry/runtime audits.
    path.with_name(city+'-'+region+'-regions.json').write_text(json.dumps(output,separators=(',',':')))
    path.with_name(city+'-'+region+'-routes.json').write_text(json.dumps([dict(id=r['id'],area=bool(r.get('area')),p=list(r['line'].coords),elevated=r['elevated'],level=max(1,r.get('layer',0)) if r['elevated'] else 0) for r in result['roads']+result.get('walkingRoutes',[])],separators=(',',':')))
    path.with_name(city+'-'+region+'-audit.json').write_text(json.dumps(audit,indent=2))
    print(json.dumps({k:v for k,v in audit.items() if k not in ('blockedRoutes','frontageAdjustments','frontageConflicts','guideAdjustments','guideFailures','walkingGuideAdjustments','walkingBlocked')}),flush=True)
if __name__=='__main__':main()
