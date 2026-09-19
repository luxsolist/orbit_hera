"""Rebuild Rome overlays from cached OSM geometry; never alter raw map or DEM.
Sources: scripts/data/rome-reference.json (OSM ODbL snapshot), docs/rome-landmark-details.md.
"""
import json,math,collections,re
from pathlib import Path
from landmark_geometry import ring_matches
ROOT=Path(__file__).resolve().parent.parent
source=json.loads((ROOT/'scripts/data/rome-reference.json').read_text())
manifest=json.loads((ROOT/'public/maps/41/12/tiles.json').read_text());M=manifest['mLon']
def xy(g):return [round((g['lon']-12)*M,3),round((42-g['lat'])*111320,3)]
def rings(e,role='outer'):
 if e['type']=='way':
  g=e.get('geometry',[])
  return [[v for n in g[:-1] for v in xy(n)]] if len(g)>3 and g[0]==g[-1] else []
 chains=[[xy(g) for g in m.get('geometry',[])] for m in e.get('members',[]) if m.get('role','outer')==role and m.get('geometry')];out=[]
 while chains:
  c=chains.pop()
  while c[0]!=c[-1]:
   for i,b in enumerate(chains):
    if b[0]==c[-1] or b[-1]==c[-1]:c+=(b if b[0]==c[-1] else b[::-1])[1:];chains.pop(i);break
   else:raise ValueError('Unclosed source relation '+str(e['id']))
  out.append([v for n in c[:-1] for v in n])
 return out

def center(p):return (sum(p[::2])/(len(p)//2),sum(p[1::2])/(len(p)//2))
def bounds(p):return min(p[::2]),min(p[1::2]),max(p[::2]),max(p[1::2])
def inside(x,z,p):
 hit=False
 for i in range(0,len(p),2):
  j=(i-2)%len(p)
  if (p[i+1]>z)!=(p[j+1]>z) and x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i]:hit=not hit
 return hit
raw={}
for c in manifest['chunks']:
 if 35<=c['cx']<=43 and 8<=c['cz']<=16:
  k=f"{c['cx']}_{c['cz']}";b=manifest.get('block',16);path=ROOT/f"public/maps/41/12/{c['cx']//b}_{c['cz']//b}/{k}.json"
  raw[k]=json.loads(path.read_text())
bins=collections.defaultdict(list)
for key,c in raw.items():
 for b in c['objects']['buildings']:
  a=bounds(b['p']);bins[int((a[0]+a[2])/32),int((a[1]+a[3])/32)].append((key,b))
def candidates(p):
 a=bounds(p);gx=int((a[0]+a[2])/32);gz=int((a[1]+a[3])/32)
 return [v for x in range(gx-1,gx+2) for z in range(gz-1,gz+2) for v in bins[x,z]]
patch={k:dict(buildings=[],add=[],remove=[],areas=[],paths=[],walls=[],water=[],trees=[],terrain=[]) for k in raw}
models={
 'relation/1834818':('colosseum',48.5,'콜로세움','published'),
 'relation/3374342':('pantheon',43.3,'판테온','published'),
 'way/244159210':('st-peter',136,'산 피에트로 대성당','published'),
 'way/8035487':('castle',48,'산탄젤로 성','photo-estimate'),
 'relation/13448560':('trevi',26,'트레비 분수','photo-estimate'),
 'way/23913953':('arch-one',15.4,'티투스 개선문','osm-height'),
 'way/23590989':('arch-three',21,'콘스탄티누스 개선문','osm-height'),
 'way/215289671':('chapel',20.7,'시스티나 성당','photo-estimate'),
 'way/131564482':('basilica',30,'산타 마리아 마조레 대성당','photo-estimate'),
 'relation/36444':('basilica',35,'산 조반니 인 라테라노 대성당','photo-estimate'),
 'way/24098531':('steps',24,'스페인 계단','photo-estimate'),
 'way/134399943':('stone-bridge',0,'산탄젤로 다리','terrain-endpoints'),
 'way/255959482':('courtyard',22,'바티칸 박물관','photo-estimate'),
}
rows=[]
for e in source['elements']:
 id=e['type']+'/'+str(e['id']);t=e.get('tags',{})
 if e['type']=='node':
  if e['id']==497186177:
   x,z=xy(e);k=f'{int(x//1024)}_{int(z//1024)}';patch[k].setdefault('romeSites',[]).append(dict(id=id,p=[x,z],holes=[],name='진실의 입',h=1.8,kind='rome-mask',roof='',heightSource=None))
   rows.append(dict(id=id,name='진실의 입',kind='mask',height=1.8,heightStatus='published-diameter',chunk=k,binding='landscape',source='https://www.openstreetmap.org/'+id))
  continue
 try:polys=rings(e)
 except ValueError as err:raise RuntimeError(str(err))
 if not polys:
  if id=='way/24098531':
   p=[v for g in e.get('geometry',[]) for v in xy(g)];x,z=center(p);k=f'{int(x//1024)}_{int(z//1024)}'
   patch[k].setdefault('romeSites',[]).append(dict(id=id,p=p,holes=[],name='스페인 계단',h=24,kind='rome-steps',roof='',heightSource=None))
   rows.append(dict(id=id,name='스페인 계단',kind='steps',height=24,heightStatus='photo-estimate',chunk=k,binding='landscape',source='https://www.openstreetmap.org/'+id))
  continue
 holes=rings(e,'inner') if e['type']=='relation' else []
 for p in polys:
  x,z=center(p);k=f'{int(x//1024)}_{int(z//1024)}'
  if k not in patch:continue
  if id in models:
   kind,h,name,status=models[id];a=bounds(p);hits=[]
   # Bind only matching source footprints, never nearest building or landmark radius.
   for key,b in candidates(p):
    if ring_matches(p,b['p']):hits.append((key,b))
   d=dict(id=id,p=p,holes=[q for q in holes if inside(*center(q),p)],name=name,h=h,kind='rome-'+kind,roof='',heightSource=None,status=status)
   if kind in ['steps','stone-bridge']:
    patch[k].setdefault('romeSites',[]).append(d)
    rows.append(dict(id=id,name=name,kind=kind,height=h,heightStatus=status,chunk=k,binding='landscape',source='https://www.openstreetmap.org/'+id));continue
   if len(hits)==1:
    key,b=hits[0];d['p']=b['p'];d['modelFootprint']=p;patch[key]['buildings'].append(d)
   elif len(hits)==0:patch[k]['add'].append(d);patch[k]['buildings'].append(d)
   else:raise ValueError('Ambiguous source binding '+id)
   rows.append(dict(id=id,name=name,kind=kind,height=h,heightStatus=status,chunk=k,binding='existing' if hits else 'new-source-footprint',source='https://www.openstreetmap.org/'+id))
   if kind=='colosseum':patch[k]['areas'].append(dict(id=id,p=p,holes=[],kind='paving'))
  elif t.get('highway')=='pedestrian' and t.get('area')=='yes' or id in source['surfaceIds']:
   a=dict(id=id,p=p,holes=holes,kind='paving' if t.get('highway') else 'sand')
   bb=bounds(p)
   for key,c in raw.items():
    if bb[0]<(c['cx']+1)*1024 and bb[2]>c['cx']*1024 and bb[1]<(c['cz']+1)*1024 and bb[3]>c['cz']*1024:patch[key]['areas'].append(a)
  elif t.get('historic')=='ruins' or t.get('building')=='ruins':
   # Existing surviving walls, not a solid building over an archaeological precinct.
   h=float(t['height']) if re.fullmatch(r'[0-9]+(?:\.[0-9]+)?',t.get('height','')) else 3
   patch[k]['walls'].append(dict(id=id,p=p+p[:2],h=h))
   # A mapped ruin is an open wall, not an intact roofed house. Remove only exact footprint matches.
   a=bounds(p)
   for key,b in candidates(p):
    if ring_matches(p,b['p'],1):patch[key]['remove'].append(b['p'])
out=ROOT/'public/maps/details/rome';out.mkdir(parents=True,exist_ok=True)
keys=[]
for k,d in patch.items():
 if not any(d.values()):continue
 (out/(k+'.json')).write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n');keys.append(k)
(ROOT/'src/world/cities/rome-detail-index.json').write_text(json.dumps({'chunks':sorted(keys)},indent=2)+'\n')
(ROOT/'docs/rome-landmark-model-audit.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print('Rome:',len(rows),'models;',len(keys),'detail chunks')
