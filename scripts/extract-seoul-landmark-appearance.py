from pathlib import Path
import sys,json,hashlib
sys.path.insert(0,str(Path('build/osm-lib').resolve()))
import osmium
M=88316.0938412203
rows=json.loads(Path('build/seoul-landmark-rendering-audit.json').read_text());cells=set()
for r in rows:
 x=(r['lon']-126)*M;z=(38-r['lat'])*111320
 for dx in range(-1,2):
  for dz in range(-1,2):cells.add((int(x//100)+dx,int(z//100)+dz))
class Extract(osmium.SimpleHandler):
 def __init__(self):super().__init__();self.elements=[]
 def way(self,w):
  if not w.tags.get('building') or len(w.nodes)<3:return
  try:
   first=w.nodes[0].location
   if not (126.6<first.lon<127.4 and 37.1<first.lat<37.9):return
   points=[{'lat':n.lat,'lon':n.lon} for n in w.nodes]
  except osmium.InvalidLocationError:return
  x=sum((p['lon']-126)*M for p in points)/len(points);z=sum((38-p['lat'])*111320 for p in points)/len(points)
  if (int(x//100),int(z//100)) not in cells:return
  self.elements.append({'type':'way','id':w.id,'tags':dict(w.tags),'geometry':points})
h=Extract();p=Path('build/seoul-reference/south-korea-260912.osm.pbf');h.apply_file(str(p),locations=True,idx='flex_mem')
out=Path('build/seoul-reference/landmark-appearance.json');out.write_text(json.dumps({'source':'https://download.geofabrik.de/asia/south-korea-260912.osm.pbf','sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'elements':h.elements}))
print('Extracted',len(h.elements),'source buildings')
