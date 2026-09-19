"""Conservative source-to-baked footprint matching shared by city detail builders."""
import math
def ring_matches(a,b,tolerance=3):
 if min(len(a),len(b))<6 or len(a)%2 or len(b)%2:return False
 if not all(math.isfinite(v) for v in a+b):return False
 def bounds(p):return [min(p[::2]),min(p[1::2]),max(p[::2]),max(p[1::2])]
 if max(abs(x-y) for x,y in zip(bounds(a),bounds(b)))>tolerance:return False
 def directed(p,q):
  for i in range(0,len(p),2):
   distance=math.inf
   for j in range(0,len(q),2):
    k=(j+2)%len(q);dx=q[k]-q[j];dz=q[k+1]-q[j+1];t=max(0,min(1,((p[i]-q[j])*dx+(p[i+1]-q[j+1])*dz)/(dx*dx+dz*dz or 1)))
    distance=min(distance,math.hypot(p[i]-q[j]-t*dx,p[i+1]-q[j+1]-t*dz))
   if distance>tolerance:return False
  return True
 return directed(a,b) and directed(b,a)
