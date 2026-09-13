"""Bind cached OSM attributes to every original Seoul landmark footprint.
No name-only matching and no height/style propagation from adjacent buildings.
"""
from pathlib import Path
import json,math,re,collections,xml.etree.ElementTree as E,hashlib
base=Path('public/maps/37/126');out=Path('public/maps/landmark-appearance/seoul')
M=88316.0938412203
nodes={};ways={}
for p in Path('build/seoul-reference').glob('*.osm'):
 for e in E.parse(p).getroot():
  if e.tag=='node':nodes[e.get('id')]=e
  elif e.tag=='way':ways[e.get('id')]=e
features=[]
for id,w in ways.items():
 tags={t.get('k'):t.get('v') for t in w.findall('tag')}
 if not tags.get('building'):continue
 refs=[v.get('ref') for v in w.findall('nd')]
 if not refs or any(v not in nodes for v in refs):continue
 p=[v for r in refs for v in [(float(nodes[r].get('lon'))-126)*M,(38-float(nodes[r].get('lat')))*111320]]
 if p[:2]==p[-2:]:p=p[:-2]
 if len(p)>=6:features.append(dict(id='way/'+id,p=p,tags=tags))
sourceInfo={}
extra=Path('build/seoul-reference/landmark-appearance.json')
if extra.exists():
 sourceDoc=json.loads(extra.read_text());sourceInfo={k:v for k,v in sourceDoc.items() if k!='elements'}
 for e in sourceDoc['elements']:
  if not e.get('geometry'):continue
  p=[v for q in e['geometry'] for v in [(q['lon']-126)*M,(38-q['lat'])*111320]]
  if p[:2]==p[-2:]:p=p[:-2]
  if len(p)>=6:features.append(dict(id=e['type']+'/'+str(e['id']),p=p,tags=e.get('tags',{})))
features=list({f['id']:f for f in features}.values())
cent=lambda p:(sum(p[::2])/(len(p)/2),sum(p[1::2])/(len(p)/2))
bounds=lambda p:[min(p[::2]),min(p[1::2]),max(p[::2]),max(p[1::2])]
grid=collections.defaultdict(list)
for f in features:
 x,z=cent(f['p']);grid[int(x//50),int(z//50)].append(f)
def dist(x,z,p):
 result=1e20
 for i in range(0,len(p),2):
  j=(i-2)%len(p);dx=p[i]-p[j];dz=p[i+1]-p[j+1];u=max(0,min(1,((x-p[j])*dx+(z-p[j+1])*dz)/(dx*dx+dz*dz or 1)))
  result=min(result,math.hypot(x-p[j]-u*dx,z-p[j+1]-u*dz))
 return result
def match(p):
 x,z=cent(p);box=bounds(p);hits=[]
 for gx in range(int(x//50)-1,int(x//50)+2):
  for gz in range(int(z//50)-1,int(z//50)+2):
   for f in grid[gx,gz]:
    q=f['p']
    if max(abs(a-b) for a,b in zip(box,bounds(q)))>2:continue
    if all(dist(p[i],p[i+1],q)<=2 for i in range(0,len(p),2)) and all(dist(q[i],q[i+1],p)<=2 for i in range(0,len(q),2)):hits.append(f)
 return hits[0] if len(hits)==1 else None
def number(s):
 if not re.fullmatch(r'[0-9]+(?:[.][0-9]+)?(?: m)?',s or ''):return None
 return float(s.removesuffix(' m'))
colors={'white':'#dedfda','grey':'#9fa4a5','gray':'#9fa4a5','black':'#454b50','red':'#9c6154','brown':'#927564','beige':'#c4b6a2','silver':'#a9b6bc','blue':'#738d9c','green':'#718b7b','yellow':'#cbb985'}
materials={'brick':'#a87868','stone':'#c5c6c0','concrete':'#bfc3c1','glass':'#8da8b6','metal':'#a9b4bc','wood':'#9b8170','plaster':'#d5d2c7','roof_tiles':'#6c7478','slate':'#606971','copper':'#698c80','asphalt':'#6b7376'}
def color(value):return value.lower() if re.fullmatch(r'#[a-fA-F0-9]{6}',value or '') else colors.get(value or '')
rows=[];keys=[];out.mkdir(parents=True,exist_ok=True)
for t in json.loads((base/'tiles.json').read_text())['chunks']:
 key=f"{t['cx']}_{t['cz']}";raw=json.loads((base/f"{t['cx']//16}_{t['cz']//16}"/(key+'.json')).read_text());entries=[]
 for b in raw['objects']['buildings']:
  if not b.get('lm'):continue
  f=match(b['p']);tags=f['tags'] if f else {};h=number(tags.get('height'));levels=number(tags.get('building:levels'))
  if h is not None and not 0<h<830:h=None
  if levels is not None and not 0<levels<200:levels=None
  roof=tags.get('roof:shape','flat');rh=number(tags.get('roof:height'))
  item={'p':b['p'],'source':('https://www.openstreetmap.org/'+f['id']) if f else None,'height':h,'levels':levels,'roofShape':roof,'roofHeight':rh if rh and rh<30 else None,'wallColor':color(tags.get('building:colour')) or materials.get(tags.get('building:material')),'roofColor':color(tags.get('roof:colour')) or materials.get(tags.get('roof:material')),'wallMaterial':tags.get('building:material'),'buildingType':tags.get('building'),'status':'source-footprint' if f else 'mapped-shell-estimate'}
  entries.append(item);x,z=cent(b['p']);rows.append({'name':b.get('n'),'key':key,'lat':38-z/111320,'lon':126+x/M,**{k:v for k,v in item.items() if k!='p'}})
 if entries:
  keys.append(key);(out/(key+'.json')).write_text(json.dumps({'version':1,'buildings':entries},ensure_ascii=False,separators=(',',':')))
summary={'total':len(rows),'sourceMatched':sum(bool(r['source']) for r in rows),'taggedHeight':sum(r['height'] is not None for r in rows),'taggedLevels':sum(r['levels'] is not None for r in rows),'pitchedRoofs':sum(r['roofShape']!='flat' for r in rows),'materialOrColor':sum(r['wallColor'] is not None for r in rows),'unverifiedShells':sum(not r['source'] for r in rows)}
Path('src/world/cities/seoul-landmark-appearance-index.json').write_text(json.dumps({'version':1,'chunks':keys,'summary':summary,'source':sourceInfo}))
(out/'audit.json').write_text(json.dumps({'summary':summary,'buildings':rows},ensure_ascii=False,indent=2))
print(json.dumps(summary))
