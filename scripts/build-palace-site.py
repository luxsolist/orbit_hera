"""OSM-derived palace site layers; heights and unspecified architectural details remain estimates.
Download first: https://api.openstreetmap.org/api/0.6/map?bbox=126.973,37.5748,126.9815,37.5858
"""
from pathlib import Path
import json,xml.etree.ElementTree as E,math,hashlib,statistics
source=Path('build/gyeongbokgung-complex.osm');root=E.parse(source).getroot()
nodes={n.attrib['id']:n for n in root.findall('node')};ways={w.attrib['id']:w for w in root.findall('way')};rels={r.attrib['id']:r for r in root.findall('relation')}
def tags(e):return {t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
def point(n):return [round((float(n.attrib['lon'])-126)*88316.0938412203,3),round((38-float(n.attrib['lat']))*111320,3)]
def points(w):return [point(nodes[n.attrib['ref']]) for n in w.findall('nd')]
def flat(p):return [a for x in p for a in x]
def join(rel,role):
 chains=[[n.attrib['ref'] for n in ways[m.attrib['ref']].findall('nd')] for m in rel.findall('member') if m.attrib['type']=='way' and m.attrib.get('role','outer')==role and m.attrib['ref'] in ways];out=[]
 while chains:
  chain=chains.pop()
  while chain[0]!=chain[-1]:
   found=False
   for i,c in enumerate(chains):
    if c[0]==chain[-1]:chain+=c[1:];chains.pop(i);found=True;break
    if c[-1]==chain[-1]:chain+=list(reversed(c))[1:];chains.pop(i);found=True;break
   if not found:raise ValueError('Incomplete relation '+rel.attrib['id'])
  out.append(flat([point(nodes[n]) for n in chain[:-1]]))
 return out
def inside(x,z,p):
 hit=False
 for i in range(0,len(p),2):
  j=(i-2)%len(p)
  if (p[i+1]>z)!=(p[j+1]>z) and x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i]:hit=not hit
 return hit
def center(p):return (sum(p[::2])/(len(p)/2),sum(p[1::2])/(len(p)/2))
boundary=join(rels['5501517'],'outer')[0]
def at_site(p):return any(inside(p[i],p[i+1],boundary) for i in range(0,len(p),2))
features=[];memberBuildings=set()
for id,r in rels.items():
 t=tags(r)
 if not(t.get('building') or t.get('natural')=='water'):continue
 try:polys=join(r,'outer');holes=join(r,'inner')
 except ValueError:continue
 for p in polys:
  if at_site(p):features.append({'id':'relation/'+id,'tags':t,'p':p,'holes':holes})
 if t.get('building'):memberBuildings.update(m.attrib['ref'] for m in r.findall('member') if m.attrib['type']=='way')
for id,w in ways.items():
 t=tags(w);p=flat(points(w))
 if len(p)<4 or not at_site(p):continue
 if t.get('building') and id in memberBuildings:continue
 if p[:2]==p[-2:]:p=p[:-2]
 features.append({'id':'way/'+id,'tags':t,'p':p,'holes':[]})
modern=[f['p'] for f in features if f['tags'].get('tourism') in ['museum','gallery'] or '박물관' in f['tags'].get('name','')]
construction=[f['p'] for f in features if f['tags'].get('landuse')=='construction']
buildings=[];water=[];areas=[];paths=[];walls=[]
for f in features:
 t=f['tags'];p=f['p'];name=t.get('name:ko',t.get('name',''));x,z=center(p)
 if t.get('building'):
  if not inside(x,z,boundary) or any(inside(x,z,a) for a in modern+construction):continue
  if t.get('building') in ['construction','no']:continue
  # Explicit source identity and geometry; do not infer Chinese style from a bad civilization tag.
  roof=t.get('roof:shape','hipped-and-gabled' if name else 'gabled')
  height=float(t['height']) if t.get('height','').replace('.','',1).isdigit() else (9 if name in ['흥례문','근정문'] else 6 if name else 4.2)
  buildings.append({'id':f['id'],'name':name,'p':p,'holes':f['holes'],'roof':roof,'height':height,'heightSource':'osm-height' if 'height' in t else 'estimate','gate':t.get('building')=='gatehouse' or name.endswith('문')})
 if t.get('natural')=='water':water.append({'id':f['id'],'name':name,'p':p,'holes':f['holes']})
 if t.get('natural') in ['wood','scrub','grassland','sand'] or t.get('landuse') in ['forest','grass'] or t.get('leisure')=='garden':areas.append({'p':p,'kind':'wood' if t.get('natural')=='wood' or t.get('landuse')=='forest' else 'grass' if t.get('natural')=='grassland' or t.get('landuse')=='grass' else 'garden' if t.get('leisure')=='garden' else 'sand','holes':f['holes']})
 if t.get('highway') in ['footway','path','pedestrian','steps']:
  width=float(t['width']) if t.get('width','').replace('.','',1).isdigit() else 4 if t['highway']=='pedestrian' else 2.2
  paths.append({'p':p,'width':width,'bridge':t.get('bridge') not in [None,'no'],'surface':t.get('surface','unknown')})
 if t.get('barrier')=='wall':walls.append({'p':p,'height':float(t['height']) if t.get('height','').replace('.','',1).isdigit() else 2.5})
trees=[{'p':point(n),'source':'osm-node','id':id} for id,n in nodes.items() if tags(n).get('natural')=='tree' and inside(*point(n),boundary)]
# Match baked buildings conservatively. Geometry changes/new source buildings are recorded, not guessed over existing ones.
raw=[]
for cx in range(83,86):
 for cz in range(44,47):
  p=Path(f'public/maps/37/126/{cx//16}_{cz//16}/{cx}_{cz}.json')
  if p.exists():raw += [(cx,cz,b) for b in json.loads(p.read_text())['objects']['buildings']]
def bounds(p):return [min(p[::2]),min(p[1::2]),max(p[::2]),max(p[1::2])]
for b in buildings:
 box=bounds(b['p']);matches=[(cx,cz,r) for cx,cz,r in raw if max(abs(a-v) for a,v in zip(box,bounds(r['p'])))<2]
 if len(matches)==1:b['match']={'cx':matches[0][0],'cz':matches[0][1],'p':matches[0][2]['p']}
 else:b['match']=None
result={'cell':[37,126],'source':'https://api.openstreetmap.org/api/0.6/map?bbox=126.973,37.5748,126.9815,37.5858','sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'boundary':boundary,'buildings':buildings,'water':water,'areas':areas,'paths':paths,'walls':walls,'trees':trees,'modern':modern,'construction':construction}
# Preserve a gentle north-south DEM trend, explicitly an estimate rather than a surveyed terrain replacement.
bins={}
for cx in range(83,86):
 for cz in range(44,47):
  path=Path(f'public/maps/37/126/{cx//16}_{cz//16}/{cx}_{cz}.json')
  if not path.exists():continue
  c=json.loads(path.read_text());n=c['terrain']['size']
  if n<2:continue
  for j in range(n):
   for i in range(n):
    x=cx*1024+i*1024/(n-1);z=cz*1024+j*1024/(n-1)
    if 86000<x<86520 and 46350<z<47220:bins.setdefault(int(z//150)*150,[]).append(c['terrain']['heights'][j*n+i])
result['elevationProfile']=[[z+75,round(statistics.median(v),2)] for z,v in sorted(bins.items())]
result['terrainSource']='Existing 32m DEM band medians, visual approximation, not surveyed elevations'
Path('src/world/cities/gyeongbokgung-site.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
print({k:len(result[k]) for k in ['buildings','water','areas','paths','walls','trees','modern','construction']});print('matched',sum(b['match'] is not None for b in buildings));print('unmatched',[(b['id'],b['name']) for b in buildings if b['match'] is None])
