"""Build a small reviewed pilot recipe. Elevations are DEM estimates, not surveyed levels."""
import json,math,hashlib,sys,subprocess
from cheonggye_layout import solve_layout
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
cx0,cz0=(126.987684-126)*88316.0938412203,(38-37.568149)*111320
chunks=[]; hashes={}; patch_status={}
for implementation in ('scripts/build-cheonggye-pilot.py','scripts/cheonggye_layout.py','scripts/resolved-street-layout.mjs','src/world/streetSpace.mjs','src/world/streetSection.mjs','src/world/MapCorrections.ts'):
 hashes[implementation]=hashlib.sha256((ROOT/implementation).read_bytes()).hexdigest()
# Design is authored separately; rebuilding source data must not reset reviewed settings.
design_path=ROOT/'scripts/data/cheonggye-design.json'
design_raw=design_path.read_bytes();design=json.loads(design_raw)
hashes[str(design_path.relative_to(ROOT))]=hashlib.sha256(design_raw).hexdigest()
for cx in (84,85):
 for cz in (46,47):
  p=ROOT/f'public/maps/37/126/5_2/{cx}_{cz}.json'; raw=p.read_bytes();hashes[str(p.relative_to(ROOT))]=hashlib.sha256(raw).hexdigest();d=json.loads(raw)
  patch_path=ROOT/f'public/maps/road-grade/37/126/{cx}_{cz}.json'
  patch=json.loads(patch_path.read_bytes())
  # Final network correction consumes this recipe; it is not an input to pilot generation.
  patch_input=json.dumps({k:v for k,v in patch.items() if k not in ('network','refinement')},sort_keys=True,separators=(',',':')).encode()
  hashes[str(patch_path.relative_to(ROOT))+'#base']=hashlib.sha256(patch_input).hexdigest()
  source=d['terrain']['heights']
  compatible=patch.get('version')==1 and patch.get('size')==d['terrain']['size'] and all(isinstance(i,int) and 0<=i<len(source) and math.isfinite(old) and math.isfinite(h) and (abs(source[i]-old)<.01 or abs(source[i]-h)<.01) for i,old,h in patch['points'])
  patch_status[f'{cx}_{cz}']='applied' if compatible else 'stale-overlay-ignored'
  if compatible:
   for i,old,h in patch['points']:source[i]=h
  chunks.append(d)
# The source recipe must consume FINAL semantic/clearance widths, not raw class defaults.
resolved=json.loads(subprocess.check_output(['node','scripts/resolved-street-layout.mjs','seoul',*[str(d['cx'])+'_'+str(d['cz']) for d in chunks]],cwd=ROOT))
hashes['resolved-street-layout']=hashlib.sha256(json.dumps(resolved,sort_keys=True,separators=(',',':')).encode()).hexdigest()
lines=[w['p'] for d in chunks for w in d['objects']['water'] if w.get('w')==24 and abs(w['p'][1]-cz0)<200]
points=sorted({tuple(p[i:i+2]) for p in lines for i in range(0,len(p),2)})
assert len(points)>1 and all(b[0]>a[0] for a,b in zip(points,points[1:])), 'Pilot channel topology changed: review monotonic centerline before rebuilding'
def distance(x,z,a,b):
 dx,dz=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz or 1)));return math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)
def river(x,z):return min(distance(x,z,a,b) for a,b in zip(points,points[1:]))
samples=[]
for d in chunks:
 n=d['terrain']['size'];step=1024/(n-1)
 for j in range(n):
  for i in range(n):
   x=d['cx']*1024+i*step;z=d['cz']*1024+j*step
   if abs(x-cx0)<650 and abs(z-cz0)<650 and river(x,z)>45:samples.append((x,z,d['terrain']['heights'][j*n+i]))
anchors=[]
for dz in (-400,0,400):
 for dx in (-400,0,400):
  vals=sorted(h for x,z,h in samples if abs(x-cx0-dx)<180 and abs(z-cz0-dz)<180)
  assert len(vals)>20
  anchors.append([dx,dz,vals[int(len(vals)*.2)]])
# Least squares to lower local DEM quantiles: suppress roof returns, retain broad grade.
rows=[[1,x,z] for x,z,h in anchors];rhs=[h for x,z,h in anchors]
a=[[sum(r[i]*r[j] for r in rows) for j in range(3)]+[sum(r[i]*h for r,h in zip(rows,rhs))] for i in range(3)]
for i in range(3):
 pivot=a[i][i];a[i]=[v/pivot for v in a[i]]
 for j in range(3):
  if i!=j:
   f=a[j][i];a[j]=[v-f*w for v,w in zip(a[j],a[i])]
plane=[a[i][3] for i in range(3)];assert max(abs(plane[1]),abs(plane[2]))<.04
cross=[]
for d in chunks:
 for r in d['objects']['roads']:
  for i in range(2,len(r['p']),2):
   ax,az,bx,bz=r['p'][i-2:i+2];length=math.hypot(bx-ax,bz-az)
   if length<1 or abs(bz-az)/length<.6:continue
   def crosses(a,b):
    dx,dz=bx-ax,bz-az;ex,ez=b[0]-a[0],b[1]-a[1];det=dx*ez-dz*ex
    if abs(det)<1e-6:return False
    rx,rz=a[0]-ax,a[1]-az;u=(rx*ez-rz*ex)/det;v=(rx*dz-rz*dx)/det
    return 0<=u<=1 and 0<=v<=1
   if not any(crosses(a,b) for a,b in zip(points,points[1:])):continue
   if abs((ax+bx)/2-cx0)>750 or abs((az+bz)/2-cz0)>250:continue
   cross.append([ax,az,bx,bz,r.get('w',6)])
source_channel=points
points,replacements,network,layout=solve_layout(chunks,source_channel,[cx0,cz0],design)
# Authored river/bridge corridors own their designed cross section. Ordinary streets
# retain source centre lines but take the final common clearance width.
def road_key(p):return tuple(sorted((tuple(p[:2]),tuple(p[2:]))))
widths={}
for roads in resolved.values():
 for road in roads:
  for i in range(2,len(road['p']),2):
   key=road_key(road['p'][i-2:i+2]);widths[key]=min(widths.get(key,float('inf')),road.get('w',6))
for road in network:
 if not road.get('layout') and road_key(road['p']) in widths:road['w']=widths[road_key(road['p'])]
streets=[r['p']+[r['w']] for r in network if max(r['p'][0],r['p'][2])>=cx0-700 and min(r['p'][0],r['p'][2])<=cx0+700 and abs((r['p'][1]+r['p'][3])/2-cz0)<200]
config=dict(streets=streets,id='cheonggye-1km-v3',center=[cx0,cz0],halfSize=500,blend=160,plane=plane,channel=points,crossings=cross,channelDepth=5.0,design=design,roadNetwork=network,roadReplacements=replacements,layout=layout)
config['roadSource']={'layout':'OSM-derived tile centerlines', 'width':'designed continuous 8m river roads; ordinary roads use final shared semantic/clearance widths; designed river corridors retain authored cross sections', 'markings':'procedural layout, not surveyed lane paint'}
config['provenance']='OSM layout; designed smooth land and river profiles for natural traversal, not survey reconstruction'
p=ROOT/'src/world/cities/cheonggye-pilot.json'
recipe_text=json.dumps(config,indent=2)+'\n'
audit=dict(designVersion=config['id'],design=config['design'],centerGeo=[37.568149,126.987684],coreMeters=[1000,1000],transitionMeters=160,sourceHashes=hashes,roadGradeOverlays=patch_status,roadSource=config['roadSource'],roadSegments=len(network),layoutSummary={k:v for k,v in layout.items() if k!='stations'},anchors=anchors,plane=plane,crossings=len(cross),reference='https://data.si.re.kr/photo/03X00164Bb7000',limitations=['2005 reference photograph is morphology reference, not current survey','Road elevation and 5m channel depth are estimates','V3 jointly solves river and road layout; DEM plane only supplies the baseline height'])
audit_path=ROOT/'docs/cheonggye-pilot-source-audit.json'
audit_text=json.dumps(audit,indent=2)+'\n'
if '--check' in sys.argv:
 if p.read_text()!=recipe_text or audit_path.read_text()!=audit_text:
  raise SystemExit('Cheonggye source/design changed. Run: node scripts/build-city-surfaces.mjs seoul')
else:
 p.write_text(recipe_text);audit_path.write_text(audit_text)
print(json.dumps(dict(plane=plane,crossings=len(cross),anchors=anchors)))
