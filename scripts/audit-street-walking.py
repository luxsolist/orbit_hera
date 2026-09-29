"""Classify failed pedestrian samples against source ground ownership, for review."""
import json,sys,collections
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import street_compile as s
city,region=sys.argv[1:3];base=Path('build/streets')/(city+'-'+region)
d=json.loads(Path(str(base)+'-resolved-input.json').read_text());a=json.loads(Path(str(base)+'-design-progress.json').read_text())
chunks={(c['cx'],c['cz']):c for c in d['chunks']};walking={r['id']:r for r in d.get('walking',[])};rows=[]
for failure in a.get('walkingBlocked',[]):
 r=walking.get(failure['id'],{});hits={};categories=set()
 for x,z in failure.get('points',[]):
  point=s.Point(x,z);cx,cz=int(x//1024),int(z//1024)
  for xx in range(cx-1,cx+2):
   for zz in range(cz-1,cz+2):
    c=chunks.get((xx,zz))
    if not c:continue
    for kind in ('buildings','structures','water'):
     for o in c['objects'].get(kind,[]):
      if kind!='water' and o.get('groundClearance',0)>0:continue
      pad=.3+(o.get('w',0)/2 if kind=='water' else 0)
      if not s.nearby(o['p'],(x-pad,z-pad,x+pad,z+pad)):continue
      shape=s.LineString(s.points(o['p'])).buffer(o['w']/2) if kind=='water' and o.get('w') else s.ring(o)
      if shape.distance(point)>.1:continue
      categories.add(kind);key=o.get('osmId') or kind+str(shape.bounds)
      hits[key]={'kind':kind,'id':o.get('osmId'),'height':o.get('h'),'authored':bool(o.get('landmarkModel') or o.get('seoulArchitecture') or o.get('palaceBuildingId'))}
 rows.append({'id':failure['id'],'highway':r.get('highway'),'footway':r.get('footway'),'access':r.get('access'),'level':r.get('level'),'covered':r.get('covered'),'missingSamples':failure.get('count'),'categories':sorted(categories) or ['geometry-or-clearance'],'hits':list(hits.values()),'points':failure.get('points')})
counts=collections.Counter('+'.join(r['categories']) for r in rows)
report={'city':city,'region':region,'counts':dict(counts),'routes':rows,'note':'Source ownership classification; verify adjusted geometry and source semantics before repair.'}
Path(str(base)+'-walking-review.json').write_text(json.dumps(report,ensure_ascii=False))
print(json.dumps({'city':city,'counts':dict(counts),'routes':len(rows)}))
