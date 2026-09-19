"""OSM coastline → sea polygons in landmark reference windows. Requires shapely>=2.
Sea side follows OSM land-on-left orientation; no fabricated shoreline or bathymetry.
Run after build-busan-details.py. Coordinates use x east / z south, reversing cross sign.
"""
from pathlib import Path
import json,math,xml.etree.ElementTree as E
from shapely.geometry import LineString,box,Point,Polygon
from shapely.ops import unary_union,polygonize
idx=json.loads(Path('src/world/cities/busan-detail-index.json').read_text());M=111320*math.cos(math.radians(35.5))
nodes={};ways={}
for t in idx['targets']:
 for e in E.parse(t['file']).getroot():
  if e.tag=='node':nodes[e.get('id')]=e
  elif e.tag=='way':ways[e.get('id')]=e
lines=[];bridge_polygons=[]
for id in ['382760140','496277558']:
 w=ways.get(id)
 if w is not None:
  pts=[((float(nodes[n.get("ref")].get("lon"))-129)*M,(36-float(nodes[n.get("ref")].get("lat")))*111320) for n in w.findall("nd")]
  bridge_polygons.append(Polygon(pts))
bridge_area=unary_union(bridge_polygons)
for w in ways.values():
 tags={t.get('k'):t.get('v') for t in w.findall('tag')}
 if tags.get('natural')!='coastline':continue
 refs=[n.get('ref') for n in w.findall('nd')]
 if any(r not in nodes for r in refs):continue
 pts=[((float(nodes[r].get('lon'))-129)*M,(36-float(nodes[r].get('lat')))*111320) for r in refs]
 if len(pts)>1:lines.append(LineString(pts))
sea=[]
for t in idx['targets']:
 x,z=t['x'],t['z'];window=box(x-625,z-625,x+625,z+625)
 cuts=[line.intersection(window) for line in lines if line.intersects(window)]
 if not cuts:continue
 network=unary_union([window.boundary,*cuts])
 for poly in polygonize(network):
  pt=poly.representative_point()
  if not window.covers(pt):continue
  line=min(lines,key=lambda a:a.distance(pt));u=line.project(pt);epsilon=.1
  a=line.interpolate(max(0,u-epsilon));b=line.interpolate(min(line.length,u+epsilon))
  cross=(b.x-a.x)*(pt.y-a.y)-(b.y-a.y)*(pt.x-a.x)
  if cross>0:sea.append(poly)
if not sea:raise SystemExit('No source coast polygons')
sea=unary_union(sea);count=0;terrain=0
for key in idx['chunks']:
 path=Path('public/maps/details/busan')/(key+'.json');d=json.loads(path.read_text());cx,cz=map(int,key.split('_'));d['water']=[a for a in d['water'] if not a['id'].startswith('coast/')];old=set(d.get('coastTerrainIndices',[]));d['terrain']=[r for r in d['terrain'] if r[0] not in old];d['coastTerrainIndices']=[];clip=sea.intersection(box(cx*1024,cz*1024,(cx+1)*1024,(cz+1)*1024))
 parts=[clip] if clip.geom_type=='Polygon' else list(clip.geoms) if hasattr(clip,'geoms') else []
 for i,p in enumerate(parts):
  if p.geom_type!='Polygon' or p.area<1:continue
  ring=lambda r:[round(v,3) for q in list(r.coords)[:-1] for v in q]
  d['water'].append(dict(id='coast/'+key+'/'+str(i),p=ring(p.exterior),holes=[ring(r) for r in p.interiors],kind='water',level=0,levelSource='sea-level-render-reference'))
  count+=1
 raw=json.loads(Path(f'public/maps/35/129/{cx//16}_{cz//16}/{key}.json').read_text());n=raw['terrain']['size']
 d['roadReplacements']=[]
 for road in raw['objects']['roads']:
  line=LineString(list(zip(road['p'][::2],road['p'][1::2])))
  if not line.intersects(bridge_area) or line.intersection(bridge_area).length<1:continue
  remaining=line.difference(bridge_area);segments=[remaining] if remaining.geom_type=='LineString' else list(remaining.geoms) if hasattr(remaining,'geoms') else []
  d['roadReplacements'].append(dict(p=road['p'],pieces=[[round(v,3) for q in seg.coords for v in q] for seg in segments if seg.geom_type=='LineString' and seg.length>1]))
 for i,y in enumerate(raw['terrain']['heights']):
  x=cx*1024+(i%n)*1024/(n-1);z=cz*1024+(i//n)*1024/(n-1)
  if sea.covers(Point(x,z)) and y>-.5:d['terrain'].append([i,-.5]);d['coastTerrainIndices'].append(i);terrain+=1
 path.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')))
idx['coast']=dict(source='OpenStreetMap natural=coastline; land-on-left',polygons=count,loweredSeaGridPoints=terrain,seaLevel=0,note='Visual sea datum; not bathymetry or surveyed tidal elevation')
Path('src/world/cities/busan-detail-index.json').write_text(json.dumps(idx,ensure_ascii=False,indent=2))
print(idx['coast'])
