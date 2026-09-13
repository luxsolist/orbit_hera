"""Read-only source comparison. Run with --fetch to refresh OSM extracts first.
OSM attribution: OpenStreetMap contributors, ODbL. No surveyed-height certification.
"""
import argparse, collections, hashlib, json, math, re, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
SOURCES = {
 'seoul-station': '126.9667,37.5515,126.9781,37.5607',
 'city-hall': '126.9705,37.5610,126.9836,37.5708',
 'sungnyemun': '126.9696,37.5554,126.9811,37.5646',
}
parser=argparse.ArgumentParser(); parser.add_argument('--fetch',action='store_true'); args=parser.parse_args()
Path('build').mkdir(exist_ok=True)
manifest=json.loads(Path('public/maps/37/126/tiles.json').read_text())
sources={}; buildings={}; roads={}
for name,bbox in SOURCES.items():
 path=Path('build/audit-'+name+'.osm'); url='https://api.openstreetmap.org/api/0.6/map?bbox='+bbox
 if args.fetch:
  request=urllib.request.Request(url,headers={'User-Agent':'OrbitHeraMapAudit/1.0'})
  with urllib.request.urlopen(request,timeout=60) as response: path.write_bytes(response.read())
 raw=path.read_bytes(); root=ET.fromstring(raw)
 sources[name]={'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'osmBase':root.find('meta').attrib if root.find('meta') is not None else {}}
 nodes={n.attrib['id']:((float(n.attrib['lon'])-manifest['originLon'])*manifest['mLon'],(manifest['originLat']-float(n.attrib['lat']))*111320) for n in root.findall('node')}
 for way in root.findall('way'):
  tags={t.attrib['k']:t.attrib['v'] for t in way.findall('tag')}; id=way.attrib['id']
  if 'highway' in tags: roads[id]=tags
  if 'building' not in tags: continue
  refs=[n.attrib['ref'] for n in way.findall('nd')]
  if any(r not in nodes for r in refs): continue
  points=[nodes[r] for r in refs]
  if points and points[0]==points[-1]:points.pop()
  if len(points)<3:continue
  bounds=[min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]
  buildings[id]={'tags':tags,'points':points,'bbox':bounds}
def point_segment(p,a,b):
 dx=b[0]-a[0]; dz=b[1]-a[1]; length=dx*dx+dz*dz
 t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/length)) if length else 0
 return math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t)
def close_shape(a,b):
 return all(min(point_segment(p,b[i-1],b[i]) for i in range(len(b)))<2 for p in a) and all(min(point_segment(p,a[i-1],a[i]) for i in range(len(a)))<2 for p in b)
def numeric(value):
 return float(value.removesuffix(' m')) if re.fullmatch(r'[0-9]+(?:\.[0-9]+)?(?: m)?',value or '') else None
grid=collections.defaultdict(list)
for id,b in buildings.items():
 x,z,X,Z=b['bbox'];grid[(math.floor((x+X)/100),math.floor((z+Z)/100))].append(id)
rows=[]; seen=set()
for cx in range(83,86):
 for cz in range(46,50):
  path=Path(f'public/maps/37/126/{cx//manifest["block"]}_{cz//manifest["block"]}/{cx}_{cz}.json')
  if not path.exists():continue
  for b in json.loads(path.read_text())['objects']['buildings']:
   p=b['p']; a=list(zip(p[::2],p[1::2]));bounds=[min(p[::2]),min(p[1::2]),max(p[::2]),max(p[1::2])]
   gx=math.floor((bounds[0]+bounds[2])/100);gz=math.floor((bounds[1]+bounds[3])/100); candidates=[]
   for dx in [-1,0,1]:
    for dz in [-1,0,1]:
     for id in grid[(gx+dx,gz+dz)]:
      s=buildings[id]
      if max(abs(v-w) for v,w in zip(bounds,s['bbox']))<2 and close_shape(a,s['points']):candidates.append(id)
   if len(candidates)!=1 or candidates[0] in seen:continue
   id=candidates[0];seen.add(id);tags=buildings[id]['tags'];height=numeric(tags.get('height'));levels=numeric(tags.get('building:levels'))
   source='unverified'; expected=None
   if height and 0<height<=830:source='osm-height';expected=height
   elif levels and 0<levels<=200:source='levels-estimate';expected=round(max(3,levels*3.3),1)
   rows.append({'osmId':'way/'+id,'cx':cx,'cz':cz,'height':b.get('h',9),'source':source,'sourceHeight':expected,'tags':tags,'poly':p})
valid=[r for r in rows if r['sourceHeight'] is not None]
summary={'matched':len(rows),'heightTagged':sum(r['source']=='osm-height' for r in rows),'levelsEstimated':sum(r['source']=='levels-estimate' for r in rows),'differentHeights':sum(abs(r['height']-r['sourceHeight'])>.11 for r in valid),'unverifiedAbove45m':sum(r['source']=='unverified' and r['height']>45 for r in rows),'roadWays':len(roads),'roadWithElevation':sum('ele' in t for t in roads.values()),'bridges':sum(t.get('bridge') not in [None,'no'] for t in roads.values()),'tunnels':sum(t.get('tunnel') not in [None,'no'] for t in roads.values())}
result={'sources':sources,'summary':summary,'limitations':['Way footprints only; matching tolerance 2m, ambiguous matches excluded.','Extract rectangles extend outside 500m landmark circles.','OSM height is a source claim; levels multiplied by 3.3m is an estimate.','No real-world height inferred for missing tags.','Road layer and bridge tags are not surveyed elevation.'],'rows':rows,'roadElevationTags':{id:t for id,t in roads.items() if 'ele' in t}}
Path('build/seoul-source-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=1))
print(json.dumps(summary,ensure_ascii=False,indent=2))
