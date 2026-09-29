"""Whole-surface ownership gate; chunk streaming keeps city builds bounded."""
import json,sys,hashlib,os
from pathlib import Path
from functools import lru_cache
from concurrent.futures import ProcessPoolExecutor
sys.path.insert(0,str(Path(__file__).resolve().parent))
from street_compile import ring,union
from shapely.geometry import Polygon,box,GeometryCollection

def read_part(root,key):
 if root.get('format')!='chunk-files':return root[key]
 entry=root['chunks'][key];file=entry if isinstance(entry,str) else entry['file'];raw=Path(file).read_bytes()
 if isinstance(entry,dict) and entry.get('sha256')!=hashlib.sha256(raw).hexdigest():raise ValueError('Changed artifact '+file)
 return json.loads(raw)
def init(plans,regions):
 global PLANS,REGIONS
 PLANS=plans;REGIONS=regions
@lru_cache(maxsize=4)
def region_part(key):return read_part(REGIONS,key)
@lru_cache(maxsize=12)
def expected(key,kind):
 keys=REGIONS.get('chunks',REGIONS)
 if key not in keys:return GeometryCollection()
 return union([ring(r) for r in region_part(key)['regions'] if r['kind']==kind])
def check(key):
 plan=read_part(PLANS,key);errors=[];reports=[];surfaces={};count=0
 meshes={(m['layer'],m.get('level',0)):m for m in plan['meshes']}
 for layer,kind,level in [(1,'pavement',0),(2,'curb',0),(3,'asphalt',0),(4,'center',0),(1,'walkdeck',1)]+[(3,kind,int(kind[5:])) for kind in sorted({r['kind'] for r in region_part(key)['regions'] if r['kind'].startswith('deck-')})]:
  mesh=meshes.get((layer,level));triangles=[]
  if mesh:
   pos=mesh['position'];idx=mesh['index'];ox,oz=plan['origin']
   triangles=[Polygon([(pos[k*3]+ox,pos[k*3+2]+oz) for k in idx[i:i+3]]) for i in range(0,len(idx),3)]
  actual=union([t for t in triangles if t.area>1e-10]);surfaces[(layer,level)]=actual;target=expected(key,kind)
  extra=actual.difference(target.buffer(.002)).area;absent=target.difference(actual.buffer(.002)).area
  report=dict(chunk=key,layer=kind,extra=round(extra,6),missing=round(absent,6));reports.append(report)
  if extra>.02 or absent>.02:errors.append(report)
 pavement_margin=surfaces[(1,0)].buffer(.002)
 for p in plan['props']:
  footprint=box(p['x']-.85,p['z']-.85,p['x']+.85,p['z']+.85);count+=1
  asphalt,pavement=surfaces[(3,0)],surfaces[(1,0)];margin=pavement_margin
  if not box(*plan['bounds']).covers(footprint):
   # Other chunks are independently verified against these same partitions.
   keys=[str(x)+'_'+str(z) for x in range(int((p['x']-.85)//1024),int((p['x']+.85)//1024)+1) for z in range(int((p['z']-.85)//1024),int((p['z']+.85)//1024)+1)]
   asphalt=union([asphalt]+[expected(k,'asphalt') for k in keys if k!=key]);pavement=union([pavement]+[expected(k,'pavement') for k in keys if k!=key]);margin=pavement.buffer(.002)
  if footprint.intersection(asphalt).area>.001 or footprint.difference(margin).area>.001:errors.append(dict(chunk=key,prop=p))
 return dict(layers=reports,props=count,errors=errors)
def main():
 city=sys.argv[1] if len(sys.argv)>1 else 'seoul';region=sys.argv[2] if len(sys.argv)>2 else 'jongno-cheonggye';base=Path('build/streets')/(city+'-'+region)
 raw=base.with_name(base.name+'-plans.json').read_bytes();plans=json.loads(raw);regions=json.loads(base.with_name(base.name+'-regions.json').read_text());keys=list(plans.get('chunks',plans))
 result=dict(planHash=hashlib.sha256(raw).hexdigest(),layers=[],props=0,errors=[])
 with ProcessPoolExecutor(max_workers=min(4,len(keys)),initializer=init,initargs=(plans,regions)) as pool:
  for i,report in enumerate(pool.map(check,keys,chunksize=1)):
   result['layers'].extend(report['layers']);result['props']+=report['props'];result['errors'].extend(report['errors'])
   if (i+1)%100==0:print(json.dumps(dict(auditedChunks=i+1,errors=len(result['errors']))),flush=True)
 base.with_name(base.name+'-surface-audit.json').write_text(json.dumps(result,indent=2));print(json.dumps(dict(chunks=len(keys),props=result['props'],errors=result['errors'][:20])),flush=True)
 if result['errors']:raise SystemExit('Baked surface ownership validation failed')
if __name__=='__main__':main()
