"""Solve a connected riverside cross-section before producing any render surfaces.
OSM centerlines are layout references, not surveyed road widths. No mesh patches.
"""
import math,bisect

def interpolate(rows,x,column):
 i=max(0,min(len(rows)-2,bisect.bisect_right([p[0] for p in rows],x)-1))
 a,b=rows[i:i+2];t=max(0,min(1,(x-a[0])/(b[0]-a[0])))
 return a[column]+(b[column]-a[column])*t

def solve_layout(chunks,channel,center,design):
 cx,cz=center;lo,hi=cx-660,cx+660
 segments={}
 for chunk in chunks:
  for road in chunk['objects']['roads']:
   if road.get('tunnel') or (road.get('layer') or 0)<0:continue
   for i in range(2,len(road['p']),2):
    p=road['p'][i-2:i+2];key=tuple(sorted((tuple(p[:2]),tuple(p[2:]))))
    if key not in segments:segments[key]={'p':p,'w':road.get('w',6),'bridge':bool(road.get('bridge'))}
 source=list(segments.values());parallel=[]
 for road in source:
  ax,az,bx,bz=road['p']
  if abs(bx-ax)>abs(bz-az)*1.5 and road['w']>=6 and max(ax,bx)>=lo-80 and min(ax,bx)<=hi+80:parallel.append(road)
 xs=sorted(set([lo,hi]+[lo+i*8 for i in range(1,math.ceil((hi-lo)/8))]+[p[0] for p in channel if lo<p[0]<hi]))
 guides=[]
 for x in xs:
  old=interpolate(channel,x,1);north=[];south=[]
  for road in parallel:
   ax,az,bx,bz=road['p']
   if min(ax,bx)<=x<=max(ax,bx):
    z=az+(bz-az)*(x-ax)/(bx-ax)
    if 3<old-z<75:north.append(z)
    if 3<z-old<75:south.append(z)
  guides.append([x,old,max(north) if north else None,min(south) if south else None])
 for col in (2,3):
  available=[[p[0],p[col]] for p in guides if p[col] is not None]
  assert len(available)>2,'Missing river road guides'
  for p in guides:
   if p[col] is None:p[col]=interpolate(available,p[0],1)
 # Smooth the desired axis over 48m, so survey rounding and minor branches do not create zigzags.
 rows=[];half=design['section']['bank']+design['roads']['bankClearance']+design['roads']['riverRoadWidth']/2+.6
 for x,old,n,s in guides:
  nearby=[p for p in guides if abs(p[0]-x)<=24]
  mid=sum((p[2]+p[3])/2 for p in nearby)/len(nearby)
  t=max(0,min(1,(abs(x-cx)-500)/160));weight=1-t*t*(3-2*t)
  axis=old+(mid-old)*weight
  tn=n+min(0,axis-half-n)*weight;ts=s+max(0,axis+half-s)*weight
  assert max(abs(tn-n),abs(ts-s))<=design['roads']['maxRoadShift'],f'Road corridor needs manual review at {x}'
  rows.append([x,old,axis,n,s,tn,ts])
 def warp(x,z):
  if x<lo or x>hi:return z
  old,axis,n,s,tn,ts=[interpolate(rows,x,c) for c in range(1,7)]
  anchors=sorted([(old-110,old-110),(n,tn),(old,axis),(s,ts),(old+110,old+110)])
  return interpolate(anchors,z,1) if anchors[0][0]<z<anchors[-1][0] else z
 replacements=[];network=[];max_shift=0
 for road in source:
  ax,az,bx,bz=road['p'];w=road['w'];length=math.hypot(bx-ax,bz-az)
  if length<.01:continue
  nearby=max(ax,bx)>=lo and min(ax,bx)<=hi and min(abs(az-interpolate(channel,ax,1)),abs(bz-interpolate(channel,bx,1)))<110
  if not nearby:network.append({**road,'layout':False});continue
  count=max(1,math.ceil(length/design['roads']['layoutStep']))
  samples=[]
  for i in range(count+1):
   t=i/count;x=ax+(bx-ax)*t;z=az+(bz-az)*t;zz=warp(x,z);max_shift=max(max_shift,abs(zz-z));samples.append([round(x,5),round(zz,5),z])
  bridge=road.get('bridge',False) or ((az-interpolate(channel,ax,1))*(bz-interpolate(channel,bx,1))<0 and abs(bz-az)>abs(bx-ax)*.5)
  pieces=[]
  for a,b in zip(samples,samples[1:]):
   x=(a[0]+b[0])/2;original_z=(a[2]+b[2])/2;old=interpolate(channel,x,1)
   n,s=interpolate(rows,x,3),interpolate(rows,x,4)
   guide_gap=min(abs(original_z-n),abs(original_z-s))
   along=abs(bx-ax)>abs(bz-az)*1.5 and w>=6 and guide_gap<5
   t=max(0,min(1,(abs(x-cx)-500)/160));weight=1-t*t*(3-2*t)
   width=w+(design['roads']['riverRoadWidth']-w)*weight if along and lo<=x<=hi else w
   pieces.append({'p':a[:2]+b[:2],'w':round(width,3),'bridge':bridge,'layout':True})
  replacements.append({'p':road['p'],'pieces':pieces});network.extend(pieces)
 # Outside the pilot blend retain the source channel; each adjacent tile consumes the same stations.
 new_channel=[p for p in channel if p[0]<lo]+[[p[0],p[2]] for p in rows]+[p for p in channel if p[0]>hi]
 extend_bridge_approaches(network,new_channel,design['section']['bank'])
 return new_channel,replacements,network,{'stations':rows,'maxRoadDisplacement':max_shift,'riverRoadWidth':design['roads']['riverRoadWidth']}


def extend_bridge_approaches(network,channel,bank):
 # OSM splits bridge decks from ground approaches. Propagate deck support only along
 # connected, aligned transverse roads near the bank; never promote parallel bank roads.
 ends={}
 for i,r in enumerate(network):
  for p in (r['p'][:2],r['p'][2:]):ends.setdefault(tuple(p),[]).append(i)
 queue=[i for i,r in enumerate(network) if r.get('bridge')];seen=set(queue)
 for i in queue:
  r=network[i];a,b=r['p'][:2],r['p'][2:];dx,dz=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dz)
  if length<.01:continue
  for end in (a,b):
   for j in ends[tuple(end)]:
    if j in seen:continue
    q=network[j];c,d=q['p'][:2],q['p'][2:];qx,qz=d[0]-c[0],d[1]-c[1];ql=math.hypot(qx,qz)
    if ql<.01 or abs(qz)<=abs(qx)*.5 or abs((dx*qx+dz*qz)/(length*ql))<.85:continue
    clearance=min(abs(z-interpolate(channel,x,1)) for x,z in (c,d))
    if clearance>bank+q['w']/2+1:continue
    q['bridge']=True;seen.add(j);queue.append(j)
