from pathlib import Path
import json,urllib.request,time,hashlib,concurrent.futures
out=Path('build/seoul-reference');out.mkdir(exist_ok=True)
targets=json.loads(Path('scripts/data/landmark-catalog.json').read_text())['cities']['서울']
targets=[dict(t,id='seoul-'+str(i)) for i,t in enumerate(targets)]+[dict(t,id=k) for k,t in json.loads(Path('public/maps/landmarks.json').read_text()).items()]
# Full 600m bounding boxes around every registered landmark; runtime scope is a 500m circle.
for t in targets:
 dx=600/88316.0938412203;dy=600/111320
 t['bbox']=[t['lon']-dx,t['lat']-dy,t['lon']+dx,t['lat']+dy]
 t['url']='https://api.openstreetmap.org/api/0.6/map?bbox='+','.join(f'{v:.7f}' for v in t['bbox'])
def fetch(t):
 p=out/(t['id']+'.osm')
 if not p.exists():
  for attempt in range(3):
   try:
    req=urllib.request.Request(t['url'],headers={'User-Agent':'OrbitHeraLandmarkReview/1.0'})
    with urllib.request.urlopen(req,timeout=90) as r:raw=r.read()
    if b'<osm' not in raw:raise ValueError('Not OSM XML')
    p.write_bytes(raw);break
   except Exception as e:
    if attempt==2:return dict(t,error=str(e))
    time.sleep(3*(attempt+1))
 t['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();t['file']=str(p)
 print(t['id'],t['name'],p.stat().st_size,flush=True);return t
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(fetch,targets))
(out/'index.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
errors=[t for t in rows if 'error' in t]
print('COMPLETE',len(rows)-len(errors),'ERRORS',errors,flush=True)
if errors:raise SystemExit(1)
