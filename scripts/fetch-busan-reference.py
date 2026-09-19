"""Cache OSM reference extracts for every geocoded Busan landmark (ODbL)."""
from pathlib import Path
import json, urllib.request, hashlib, math, concurrent.futures
out=Path('build/busan-reference');out.mkdir(exist_ok=True)
rows=json.loads(Path('scripts/data/landmark-catalog.json').read_text())['cities']['부산']
def fetch(pair):
 i,t=pair;t=dict(t,id='busan-'+str(i))
 if t.get('lat') is None or t.get('lon') is None:return dict(t,status='unresolved-coordinate')
 dx=650/(111320*math.cos(math.radians(t['lat'])));dy=650/111320
 t['url']='https://api.openstreetmap.org/api/0.6/map?bbox='+','.join(f'{v:.7f}' for v in [t['lon']-dx,t['lat']-dy,t['lon']+dx,t['lat']+dy])
 p=out/(t['id']+'.osm')
 try:
  if not p.exists():
   req=urllib.request.Request(t['url'],headers={'User-Agent':'OrbitHeraLandmarkReview/1.0'})
   with urllib.request.urlopen(req,timeout=55) as r:raw=r.read()
   if b'<osm' not in raw:raise ValueError('Not OSM XML')
   p.write_bytes(raw)
  t.update(file=str(p),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),status='cached')
 except Exception as e:t.update(status='error',error=str(e))
 print(t['id'],t['name'],t['status'],flush=True);return t
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(fetch,enumerate(rows)))
(out/'index.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('DONE',flush=True)

# Approach corridors exceed the 650m landmark window; keep repeatable references for both shores.
corridors=[]
for i in range(4):
 south=35.127+i*.012;bounds=[129.1,south,129.152,south+.012]
 url='https://api.openstreetmap.org/api/0.6/map?bbox='+','.join(f'{v:.7f}' for v in bounds)
 p=out/f'bridge-corridor-{i}.osm'
 if not p.exists():
  req=urllib.request.Request(url,headers={'User-Agent':'OrbitHeraLandmarkReview/1.0'})
  with urllib.request.urlopen(req,timeout=90) as response:p.write_bytes(response.read())
 corridors.append(dict(file=str(p),url=url,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
(out/'bridge-corridor-index.json').write_text(json.dumps(corridors,indent=2))
