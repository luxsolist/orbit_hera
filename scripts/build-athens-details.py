"""Rebuild Athens overlays from cached OSM geometry; never alter raw map or DEM.
Sources: scripts/data/athens-reference.json (OSM ODbL snapshot), docs/athens-landmark-details.md.
"""
import json,math,collections,re
from pathlib import Path
from landmark_geometry import ring_matches
ROOT=Path(__file__).resolve().parent.parent
source=json.loads((ROOT/'scripts/data/athens-reference.json').read_text())
manifest=json.loads((ROOT/'public/maps/37/23/tiles.json').read_text());M=manifest['mLon']
def xy(g):return [round((g['lon']-23)*M,3),round((38-g['lat'])*111320,3)]
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
 if 60<=c['cx']<=65 and 0<=c['cz']<=4:
  k=f"{c['cx']}_{c['cz']}";b=manifest.get('block',16)
  raw[k]=json.loads((ROOT/f"public/maps/37/23/{c['cx']//b}_{c['cz']//b}/{k}.json").read_text())
patch={k:dict(buildings=[],add=[],remove=[],areas=[],paths=[],walls=[],water=[],trees=[],terrain=[],athensSites=[]) for k in raw}
models={
 'way/910010406':('parthenon',17,'파르테논 신전','published-plan/photo-height'),
 'way/910010334':('erechtheion',10,'에레크테이온','photo-estimate'),
 'way/975219800':('stoa',12.5,'아탈로스의 스토아','osm-height'),
 'way/10973697':('dionysus',12,'디오니소스 극장','photo-estimate'),
 'relation/13249184':('odeon',28,'헤로데스 아티쿠스 음악당','photo-estimate'),
 'way/63765671':('zeus',17,'제우스 신전','photo-estimate'),
 'way/175107932':('hadrian',18,'하드리아누스 문','published'),
 'relation/19023846':('stadium',22,'판아테나이코 경기장','photo-estimate'),
 'relation/2828':('national-museum',18,'국립고고학박물관','photo-estimate'),
 'way/983921252':('acropolis-museum',23,'아크로폴리스 박물관','photo-estimate'),
}
surfaces={'relation/4423249':('sand','아크로폴리스'),'relation/13139942':('grass','고대 아고라'),'relation/2903266':('grass','케라메이코스'),'relation/16363966':('paving','신타그마 광장'),'relation/6354054':('paving','모나스티라키 광장')}
rows=[]
for e in source['elements']:
 id=e['type']+'/'+str(e['id'])
 if e['type']=='node':continue
 polys=rings(e);holes=rings(e,'inner') if e['type']=='relation' else []
 for p in polys:
  x,z=center(p);key=f'{int(x//1024)}_{int(z//1024)}'
  if key not in patch:raise ValueError('Missing source tile '+id)
  hits=[(k,b) for k,c in raw.items() for b in c['objects']['buildings'] if ring_matches(p,b['p'])]
  if len(hits)>1:raise ValueError('Ambiguous source binding '+id)
  if id in models:
   kind,h,name,status=models[id];d=dict(id=id,p=p,modelFootprint=p,holes=[q for q in holes if inside(*center(q),p)],name=name,h=h,kind='athens-'+kind,roof='',heightSource=None)
   landscape=kind in ['dionysus','odeon','stadium','zeus','hadrian']
   if landscape:
    if hits:patch[hits[0][0]]['remove'].append(hits[0][1]['p'])
    patch[key]['athensSites'].append(d)
   else:
    if hits:
     key,b=hits[0];d['p']=b['p']
    else:patch[key]['add'].append(d)
    patch[key]['buildings'].append(d)
   rows.append(dict(id=id,name=name,kind=kind,height=h,heightStatus=status,binding='landscape' if landscape else 'existing' if hits else 'new-source-footprint',chunk=key,source='https://www.openstreetmap.org/'+id))
  elif id in surfaces:
   kind,name=surfaces[id]
   for k,b in hits:patch[k]['remove'].append(b['p'])
   a=dict(id=id,p=p,holes=holes,kind=kind);bb=bounds(p)
   for k,c in raw.items():
    if bb[0]<(c['cx']+1)*1024 and bb[2]>c['cx']*1024 and bb[1]<(c['cz']+1)*1024 and bb[3]>c['cz']*1024:patch[k]['areas'].append(a)
   rows.append(dict(id=id,name=name,kind='surface',binding='source-ground',chunk=key,source='https://www.openstreetmap.org/'+id))
out=ROOT/'public/maps/details/athens';out.mkdir(parents=True,exist_ok=True)
keys=[]
for k,d in patch.items():
 if any(d.values()):(out/(k+'.json')).write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n');keys.append(k)
(ROOT/'src/world/cities/athens-detail-index.json').write_text(json.dumps({'chunks':sorted(keys)},indent=2)+'\n')
(ROOT/'docs/athens-landmark-model-audit.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print('Athens:',len(rows),'models/sites;',len(keys),'detail chunks')
