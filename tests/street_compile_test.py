import sys,unittest,tempfile
from unittest.mock import patch
import importlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'scripts'))
from street_compile import compile_region,route_guides,metric_buffer,overlay,LineString,Polygon,Point,box
def data(roads,buildings=[],water=[],islands=[]):
 return dict(bounds=[0,0,200,200],halo=20,roads=roads,islands=islands,chunks=[dict(cx=0,cz=0,objects=dict(buildings=buildings,roads=[],walls=[],water=water))])
def road(id,p,**kw):return dict(id=id,p=p,w=10,highway='primary',name=id,**kw)
class Streets(unittest.TestCase):
 def test_shelter_posts_leave_the_full_walking_corridor_clear(self):
  from street_compile import encode_region
  d=data([road("car",[0,20,200,20])]);d.update(region="test",walking=[dict(id="walk",p=[100,50,100,150],w=2,highway="footway")])
  d["chunks"][0]["objects"]["structures"]=[dict(p=[100,80,140,80,140,120,100,120],h=3,structureKind="shelter")]
  result=compile_region(d);part=encode_region(d,result)["0_0"]
  points=part["resolvedStructures"][0]["supportPoints"]
  self.assertTrue(points)
  for x,z in zip(points[::2],points[1::2]):self.assertGreater(abs(x-100),1.35)

 def test_long_riverside_path_can_turn_across_without_draining_the_bank(self):
  from street_compile import normalize_source,prepare_obstacles
  d=data([],water=[dict(p=[100,0,100,200],w=12)]);d['walking']=[dict(id='bank-turn',p=[96,20,96,120,120,130],w=2.5,highway='path')]
  result=compile_region(d)
  self.assertEqual(result['audit']['walkingMissing'],0)
  self.assertLess(result['audit']['walkingUncoveredMeters'],.01)
  self.assertTrue(any(c['source']=='centreline-side-change' for c in result['crossings']))
  _,obstacle,*_=prepare_obstacles(d,box(*d['bounds']),box(-20,-20,220,220))
  self.assertTrue(obstacle.covers(Point(100,60)))

 def test_path_along_river_centreline_does_not_infer_repeated_crossings(self):
  d=data([],water=[dict(p=[100,0,100,200],w=12)]);d['walking']=[dict(id='along',p=[100,20,100,180],w=2,highway='path')]
  result=compile_region(d)
  self.assertFalse(any(c['source']=='centreline-side-change' for c in result['crossings']))

 def test_indexed_ramp_clipping_matches_whole_obstacle_difference(self):
  from street_compile import normalize_walk_hosts,upper_walking_surfaces,union,points
  d=data([],buildings=[dict(p=[50,80,150,80,150,120,50,120],h=3,buildingType='grandstand')])
  d['walking']=[dict(id='stairs',p=[100,70,100,130],w=2,highway='steps')]
  normalize_walk_hosts(d)
  obstacles=union([box(99,123,101,125),box(100.5,74,102,78)]+[box(300+i*10,300,305+i*10,305) for i in range(50)])
  surfaces,_,_=upper_walking_surfaces(d,box(*d['bounds']),obstacles)
  ramps=[s for s in surfaces if s['kind'].startswith('walkramp-')]
  self.assertTrue(ramps)
  for s in ramps:
   expected=LineString(points(s['profile']['path'])).buffer(1,quad_segs=3).difference(obstacles).intersection(box(*d['bounds']))
   self.assertLess(s['shape'].symmetric_difference(expected).area,1e-9)

 def test_diagonal_opposite_bank_crossing_is_not_mistaken_for_a_riverside_path(self):
  d=data([],water=[dict(p=[100,0,100,200],w=4)]);d['walking']=[dict(id='diagonal',p=[95,30,105,100],highway='path',w=2)]
  result=compile_region(d)
  self.assertEqual(result['audit']['walkingMissing'],0)
  self.assertTrue(any(r['source']=='opposite-bank-crossing' for r in result['crossings']))

 def test_ruins_keep_walls_but_not_a_filled_interior(self):
  from street_compile import normalize_ruins,ring,union
  d=data([],buildings=[dict(p=[60,60,140,60,140,140,60,140],h=9,ruin=True,heightSource='default-estimate')]);d['walking']=[dict(id='ruin-path',p=[40,100,160,100],w=2,highway='footway')]
  normalize_ruins(d);walls=d['chunks'][0]['objects']['buildings'];shape=union([ring(b) for b in walls])
  self.assertFalse(shape.covers(Point(100,100)))
  self.assertFalse(shape.covers(Point(60,100)))
  self.assertTrue(shape.covers(Point(60.1,80)))
  self.assertTrue(all(b['h']==2 for b in walls))

 def test_low_slab_generates_low_support_instead_of_building_obstacle(self):
  from street_compile import normalize_walk_hosts
  d=data([],buildings=[dict(p=[60,60,140,60,140,140,60,140],h=.1)]);d['walking']=[dict(id='slab-walk',p=[40,100,160,100],w=2,highway='footway')]
  normalize_walk_hosts(d);result=compile_region(d)
  self.assertEqual(result['audit']['walkingMissing'],0)
  self.assertAlmostEqual(result['walkSurfaces'][0]['profile']['height'],.1)

 def test_explicit_footbridge_emits_support_and_is_audited(self):
  d=data([road('car',[0,20,200,20])],water=[dict(p=[100,40,100,160],w=6)])
  d['walking']=[dict(id='bridge',p=[80,100,120,100],w=2,highway='footway',bridge=True)]
  result=compile_region(d)
  self.assertEqual(result['audit']['walkingMissing'],0)
  self.assertGreater(result['audit']['walkingSamples'],0)
  self.assertTrue(result['walkSurfaces'])

 def test_authored_arcade_keeps_model_and_records_only_evidenced_ground_opening(self):
  from street_compile import normalize_passages,ring,union
  d=data([road('car',[0,20,200,20])],buildings=[dict(p=[60,60,140,60,140,140,60,140],h=30,landmarkModel='test')])
  d['walking']=[dict(id='arcade',p=[40,100,160,100],w=2,highway='footway',covered='yes',indoor='no')]
  normalize_passages(d);b=d['chunks'][0]['objects']['buildings'][0]
  self.assertEqual(b['landmarkModel'],'test')
  self.assertTrue(ring(b).contains(Point(100,100)))
  self.assertFalse(union([ring(p) for p in b['passageGroundParts']]).contains(Point(100,100)))
  self.assertEqual(compile_region(d)['audit']['walkingMissing'],0)

 def test_entrance_stops_at_facade_but_exterior_through_route_stays_blocked(self):
  for through in (False,True):
   d=data([road('car',[0,20,200,20])],buildings=[dict(p=[60,60,140,60,140,140,60,140],h=2.9)])
   d['walking']=[dict(id='entry',p=[40,100,160 if through else 100,100],w=2,highway='footway')]
   result=compile_region(d)
   self.assertEqual(result['audit']['walkingMissing']>0,through)
   self.assertEqual(bool(result['audit']['interiorWalking']),not through)

 def test_hosted_steps_emit_terraced_support_instead_of_a_solid_stand(self):
  from street_compile import normalize_walk_hosts,encode_region
  d=data([road('car',[0,20,200,20])],buildings=[dict(p=[50,80,150,80,150,120,50,120],h=3,buildingType='grandstand',osmId='stand')]);d.update(region='test',walking=[dict(id='steps',p=[100,70,100,130],w=2,highway='steps')])
  normalize_walk_hosts(d);result=compile_region(d)
  self.assertEqual(result['audit']['walkingMissing'],0)
  part=encode_region(d,result)['0_0'];decks=[r for r in part['regions'] if r['kind']=='walkdeck']
  self.assertGreater(len(decks),10)
  self.assertAlmostEqual(max(r['profile']['offset'] for r in decks if 'offset' in r['profile']),3)
  self.assertTrue(part['resolvedBuildings'][0]['walkableProfile'])

 def test_explicit_upper_route_has_its_own_emitted_surface(self):
  d=data([road('car',[0,20,200,20])],buildings=[dict(p=[50,80,150,80,150,120,50,120],h=3.3)])
  d['walking']=[dict(id='upper',p=[60,100,140,100],w=2,highway='footway',level='1')]
  result=compile_region(d)
  self.assertEqual(result['audit']['walkingMissing'],0)
  self.assertTrue(result['walkSurfaces'])
  self.assertFalse(result['pavement'].covers(Point(100,100)))

 def test_platform_is_walkable_not_a_filled_obstacle(self):
  d=data([road('car',[0,20,200,20])]);d['chunks'][0]['objects']['structures']=[dict(p=[50,80,150,80,150,120,50,120],h=3,structureKind='platform')]
  d['walking']=[dict(id='platform-walk',p=[30,100,170,100],w=2,highway='footway')]
  result=compile_region(d)
  self.assertEqual(result['audit']['walkingMissing'],0)
  self.assertTrue(result['pavement'].covers(Point(100,100)))

 def test_short_pedestrian_water_crossing_is_reserved_but_long_river_path_is_not(self):
  for long in (False,True):
   d=data([road('car',[0,20,200,20])],water=[dict(p=[100,30,100,180],w=6)])
   d['walking']=[dict(id='water-walk',p=[100,40,100,170] if long else [80,100,120,100],w=2,highway='path')]
   result=compile_region(d)
   self.assertEqual(result['audit']['walkingMissing'],0)
   if long:
    self.assertFalse(result['pavement'].covers(Point(100,100)))
    self.assertFalse(result['crossings'])
   else:self.assertTrue(any(r.get('pedestrian') for r in result['crossings']))

 def test_city_build_records_pedestrian_failure_before_generating_decoration(self):
  import street_compile as compiler,json
  d=data([road('car',[0,20,200,20])],buildings=[dict(p=[50,50,150,50,150,150,50,150],h=12,seoulArchitecture={'kind':'authored'})])
  d.update(coverage='manifest',city='test',region='blocked-walk',walking=[dict(id='walk',p=[80,100,120,100],highway='footway',footway='sidewalk',w=2)])
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);(root/'build/streets').mkdir(parents=True)
   with patch.object(compiler,'ROOT',root):
    with self.assertRaisesRegex(ValueError,'Disconnected city routes'):compile_region(d)
   report=json.loads((root/'build/streets/test-blocked-walk-design-progress.json').read_text())
   self.assertGreater(report['walkingUncoveredMeters'],0)
   self.assertEqual(report['missingRouteSamples'],0)

 def test_route_audit_survives_degenerate_fast_rectangle_clip(self):
  from street_compile import audit_route_coverage,GeometryCollection,GEOSException
  records=[dict(id='gap',highway='footway',line=LineString([(1,5),(19,5)]),w=2)]
  surface=GeometryCollection([box(0,0,9,10),box(11,0,20,10)]);core=box(0,0,20,20)
  expected=audit_route_coverage(records,surface,core)
  with patch('street_compile.clip_by_rect',side_effect=GEOSException('Invalid LinearRing')):
   self.assertEqual(audit_route_coverage(records,surface,core),expected)

 def test_coverage_collection_checks_cross_surface_paths_and_real_gaps(self):
  from street_compile import audit_route_coverage,GeometryCollection,union
  records=[dict(id='cross',highway='footway',line=LineString([(1,5),(19,5)]),w=2)]
  for right in (10,11):
   surfaces=[box(0,0,10,10),box(right,0,20,10)]
   actual=audit_route_coverage(records,GeometryCollection(surfaces),box(0,0,20,20))
   expected=audit_route_coverage(records,union(surfaces),box(0,0,20,20))
   self.assertEqual(actual,expected)
   if right==11:self.assertGreater(actual[2],.9)

 def test_cache_invalidates_when_compiler_changes_outside_listed_stage_functions(self):
  import street_compile as compiler
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);(root/'build/streets').mkdir(parents=True)
   code=root/'compiler.py';code.write_text('walking revision 1')
   d=dict(_sourceHash='same-input',city='test',region='all')
   with patch.object(compiler,'ROOT',root),patch.object(compiler,'__file__',str(code)):
    self.assertEqual(compiler.cached_stage(d,'curbs',['same-stage'],lambda:1),1)
    self.assertEqual(compiler.cached_stage(d,'curbs',['same-stage'],lambda:2),1)
    code.write_text('walking revision 2')
    self.assertEqual(compiler.cached_stage(d,'curbs',['same-stage'],lambda:2),2)

 def test_traffic_island_allows_pedestrians_but_excludes_cars(self):
  island=dict(p=[80,80,120,80,120,120,80,120])
  d=data([road('car',[0,20,200,20])],islands=[island]);d['walking']=[dict(id='crossing',p=[50,100,150,100],highway='footway',footway='sidewalk',w=2)]
  result=compile_region(d)
  self.assertEqual(result['audit']['walkingMissing'],0)
  self.assertTrue(result['pavement'].covers(Point(100,100)))
  self.assertFalse(result['asphalt'].covers(Point(100,100)))

 def test_sidewalk_axis_moves_outside_facade_without_cutting_building(self):
  b=dict(p=[60,60,140,60,140,100,60,100],h=12)
  d=data([road('car',[0,20,200,20])],buildings=[b]);d['walking']=[dict(id='walk',p=[50,99.5,150,99.5],highway='footway',footway='sidewalk',w=2)]
  result=compile_region(d)
  self.assertEqual(result['audit']['walkingMissing'],0)
  self.assertLess(result['audit']['walkingUncoveredMeters'],.01)
  self.assertFalse(result['pavement'].intersects(box(61,61,139,99)))
  self.assertEqual(b['p'],[60,60,140,60,140,100,60,100])

 def test_mapped_interior_access_keeps_upper_volume_and_ground_passage(self):
  from street_compile import normalize_passages,ring
  d=data([road('car',[0,20,200,20])],buildings=[dict(p=[60,60,140,60,140,140,60,140],h=12,osmId='test')])
  d['walking']=[dict(id='access',p=[40,100,160,100],highway='footway',access='customers',w=2)]
  normalize_passages(d)
  buildings=d['chunks'][0]['objects']['buildings']
  self.assertTrue(any(b.get('groundClearance') for b in buildings))
  self.assertTrue(all(not ring(b).contains(Point(100,100)) for b in buildings if not b.get('groundClearance')))
  self.assertEqual(compile_region(d)['audit']['walkingMissing'],0)

 def test_sidewalk_does_not_infer_passage_through_building(self):
  from street_compile import normalize_passages
  d=data([],buildings=[dict(p=[60,60,140,60,140,140,60,140],h=12)])
  d['walking']=[dict(id='bad',p=[40,100,160,100],highway='footway',footway='sidewalk',w=2)]
  normalize_passages(d)
  self.assertEqual(len(d['chunks'][0]['objects']['buildings']),1)
  self.assertFalse(d['chunks'][0]['objects']['buildings'][0].get('groundClearance'))

 def test_pedestrian_square_does_not_turn_into_carriageway(self):
  d=data([road('car',[0,20,200,20])]);d['walking']=[dict(id='square',p=[50,50,150,50,150,150,50,150,50,50],w=2.5,area=True)]
  result=compile_region(d)
  self.assertTrue(result['pavement'].covers(Point(100,100)))
  self.assertFalse(result['asphalt'].covers(Point(100,100)))
  self.assertFalse(result['paint'].covers(Point(100,100)))

 def test_profile_disables_markings_on_historic_residential_street(self):
  d=data([dict(id='lane',p=[0,100,200,100],w=8,highway='residential')]);d['centerlineHighways']=['primary']
  self.assertTrue(compile_region(d)['paint'].is_empty)

 def test_delivery_clip_falls_back_without_dropping_boundary_geometry(self):
  from street_compile import delivery_clip,GEOSException
  shape=box(0,0,20,20).difference(box(3,3,17,17));bounds=(10,0,25,25)
  with patch('street_compile.clip_by_rect',side_effect=GEOSException('Invalid number of points in LinearRing')):
   actual=delivery_clip(shape,bounds)
  self.assertTrue(actual.is_valid)
  self.assertLess(actual.symmetric_difference(shape.intersection(box(*bounds))).area,1e-9)

 def test_final_partition_reserves_route_instead_of_accepting_small_gap(self):
  from street_compile import reserve_final_routes,GeometryCollection,audit_route_coverage
  core=box(0,0,20,20);asphalt=box(0,0,20,4.98);pavement=core.difference(asphalt)
  records=[dict(id='edge',highway='service',line=LineString([(2,5),(18,5)]),w=4,elevated=False)]
  a,p=reserve_final_routes(asphalt,pavement,records,GeometryCollection(),core)
  self.assertEqual(audit_route_coverage(records,a,core)[1:3],(0,0))
  self.assertLess(a.intersection(p).area,1e-8)
  self.assertTrue(a.covers(box(4,4,16,6)))

 def test_upper_road_crossing_building_is_not_cut_by_ground_ownership(self):
  result=compile_region(data([road('upper',[10,100,190,100],layer=1,bridge=True)],buildings=[dict(p=[80,80,120,80,120,120,80,120],h=12)]))
  self.assertEqual(result['audit']['missingRouteSamples'],0)
  self.assertLess(result['audit']['uncoveredRouteMeters'],.001)
  self.assertTrue(result['elevatedSurfaces'][1].covers(Point(100,100)))
  self.assertFalse(result['asphalt'].covers(Point(100,100)))
  self.assertEqual(len(result['elevatedRoofs']),1)

 def test_buffered_overlay_matches_whole_operation_across_tile_edges(self):
  from street_compile import buffered_overlay
  a=box(0,0,100,100).difference(box(20,20,80,80));b=box(12,12,88,88)
  for distance in (-.7,.03):
   target=a.intersection(b.buffer(distance,quad_segs=4))
   actual=buffered_overlay(a,b,'intersection',distance,tile_size=16)
   self.assertLess(actual.symmetric_difference(target).area,1e-7)
  source=a.boundary;target=source.intersection(b.buffer(15,quad_segs=4))
  actual=buffered_overlay(source,b,'intersection',15,linear=True,tile_size=16)
  self.assertLess(actual.symmetric_difference(target).length,1e-7)

 def test_fast_rectangle_clip_preserves_courtyards_and_concave_edges(self):
  from street_compile import clip_surface
  shape=box(0,0,30,30).difference(box(5,5,25,25))
  for bounds in ((-1,-1,31,31),(10,0,20,30),(0,0,10,10),(6,6,20,20),(30,0,40,30)):
   result=clip_surface(shape,bounds)
   self.assertTrue(result.is_valid)
   self.assertLess(result.symmetric_difference(shape.intersection(box(*bounds))).area,1e-8)

 def test_local_coverage_audit_still_rejects_a_missing_link(self):
  from street_compile import audit_route_coverage,GeometryCollection
  routes=[dict(id='road',highway='primary',line=LineString([(1,5),(19,5)]))]
  complete=box(0,0,20,10);gap=complete.difference(box(9,0,11,10))
  self.assertEqual(audit_route_coverage(routes,complete,complete)[:3],(10,0,0))
  empty=audit_route_coverage(routes,GeometryCollection(),complete)
  self.assertGreater(empty[1],0);self.assertEqual(empty[2],18)
  report=audit_route_coverage(routes,gap,complete)
  self.assertEqual(report[1],0);self.assertGreater(report[2],1.99) # A gap between samples must still fail continuous coverage.

 def test_local_hole_fill_preserves_area_and_removes_nested_duplicate_surface(self):
  from street_compile import fill_sliver_holes,MultiPolygon,GeometryCollection
  outer=box(0,0,100,100);hole=box(20,20,22,60);island=box(20.5,30,21.5,40)
  asphalt=MultiPolygon([outer.difference(hole),island]);pavement=hole.difference(island)
  road,walk=fill_sliver_holes(asphalt,pavement,GeometryCollection())
  self.assertTrue(road.is_valid);self.assertAlmostEqual(road.symmetric_difference(outer).area,0)
  self.assertTrue(walk.is_empty)
  protected,walk=fill_sliver_holes(asphalt,pavement,hole)
  self.assertAlmostEqual(protected.symmetric_difference(asphalt).area,0)

 def test_long_bank_proximity_does_not_hide_a_short_water_crossing(self):
  from street_compile import prepare_obstacles
  d=data([dict(id='local',p=[0,105,90,105,100,95,110,105,500,105],w=3,highway='unclassified')],water=[dict(p=[0,100,500,100],w=6)])
  d['bounds']=[0,0,500,200]
  result=prepare_obstacles(d,box(*d['bounds']),box(*d['bounds']).buffer(20))
  self.assertTrue(result[5])
  self.assertLess(max(LineString(list(zip(c['p'][::2],c['p'][1::2]))).length for c in result[5]),30)

 def test_compact_access_conflict_is_explicit_estimate_and_preserves_volume(self):
  from street_compile import normalize_passages
  local=dict(id='local',p=[20,100,180,100],w=3,highway='residential')
  b=dict(p=[96,97,104,97,104,103,96,103],h=3.5,osmId='small')
  d=data([local],buildings=[b]);normalize_passages(d)
  upper=[b for b in d['chunks'][0]['objects']['buildings'] if b.get('groundClearance')]
  self.assertEqual(len(upper),1)
  self.assertEqual(upper[0]['h'],3.5)
  self.assertLess(upper[0]['groundClearance'],upper[0]['h'])
  self.assertEqual(upper[0]['clearanceSource'],'access-route-estimate')
  for fields in (dict(h=20),dict(landmarkModel='protected')):
   d=data([local],buildings=[dict(b,**fields)]);normalize_passages(d)
   self.assertFalse(d['chunks'][0]['objects']['buildings'][0].get('groundClearance'))

 def test_continuous_routing_finds_a_valid_link_smaller_than_grid_spacing(self):
  from street_compile import union
  obstacle=union([box(90,0,110,99.15),box(90,100.85,110,200)])
  guides,changes,failed=route_guides([road('a',[20,70,180,130])],obstacle,box(0,0,200,200))
  self.assertFalse(failed)
  path=LineString(list(zip(guides[0]['p'][::2],guides[0]['p'][1::2])))
  self.assertGreaterEqual(path.distance(obstacle),.79999)
  self.assertGreater(len(guides[0]['p']),4)


 def test_clipped_hole_never_becomes_extra_solid_land_or_water(self):
  from street_compile import ring
  p=ring(dict(p=[0,0,10,0,10,10,0,10],holes=[[5,5,15,5,15,15,5,15]]))
  self.assertAlmostEqual(p.area,75)
  self.assertFalse(p.covers(Point(7,7)))
  self.assertFalse(p.covers(Point(12,12)))

 def test_covered_access_splits_ground_walls_from_upper_building_volume(self):
  from street_compile import normalize_passages,ring,union
  d=data([road('a',[20,100,180,100],covered='yes')],buildings=[dict(p=[70,70,130,70,130,130,70,130],h=30,osmId='way/building')])
  normalize_passages(d);buildings=d['chunks'][0]['objects']['buildings']
  upper=[b for b in buildings if b.get('groundClearance')]
  lower=[b for b in buildings if not b.get('groundClearance')]
  self.assertEqual(len(upper),1)
  self.assertTrue(ring(upper[0]).covers(Point(100,100)))
  self.assertFalse(union([ring(b) for b in lower]).intersects(LineString([(20,100),(180,100)])))
  self.assertTrue(union([ring(b) for b in lower]).covers(Point(100,80)))
  self.assertEqual(upper[0]['h'],30)

 def test_long_parallel_bank_road_is_not_classified_as_a_bridge(self):
  from street_compile import encode_region
  d=data([road('a',[10,113,190,113])],water=[dict(p=[0,100,200,100],w=30)])
  d.update(region='test')
  r=compile_region(d);part=encode_region(d,r)['0_0']
  self.assertFalse(r['audit']['guideFailures'])
  self.assertFalse(r['crossings'])
  from street_compile import ring,union
  water=union([ring(w) for w in part['resolvedWater']])
  self.assertTrue(water.covers(Point(100,100)))
  self.assertFalse(water.covers(Point(100,113)))


 def test_restores_courtyard_and_splits_source_on_chunk_boundary_once(self):
  from street_compile import normalize_source,ring
  source=dict(outer=[1000,10,1050,10,1050,60,1000,60],holes=[[1005,20,1015,20,1015,30,1005,30]])
  b=dict(osmId='relation/court',p=source['outer'],sourceFootprints=[source])
  d=dict(chunks=[dict(cx=x,cz=0,objects=dict(buildings=[dict(b),dict(b)])) for x in (0,1)])
  normalize_source(d)
  self.assertEqual([len(c['objects']['buildings']) for c in d['chunks']],[1,1])
  shapes=[ring(c['objects']['buildings'][0]) for c in d['chunks']]
  self.assertAlmostEqual(sum(p.area for p in shapes),2400)
  self.assertFalse(shapes[0].covers(Point(1010,25)))
  self.assertLess(shapes[0].intersection(shapes[1]).area,.001)


 def test_roof_and_elevated_volume_do_not_block_ground_road(self):
  for fields in (dict(structureKind='canopy'),dict(groundClearance=6)):
   d=data([road('a',[10,100,190,100])],buildings=[dict(p=[70,70,130,70,130,130,70,130],**fields)])
   r=compile_region(d)
   self.assertFalse(r['audit']['guideFailures'])
   self.assertTrue(r['asphalt'].covers(Point(100,100)))

 def test_short_water_crossing_keeps_water_source_and_emits_deck(self):
  water=dict(p=[0,100,200,100],w=16)
  d=data([road('a',[100,10,100,190])],water=[water])
  r=compile_region(d)
  self.assertFalse(r['audit']['guideFailures'])
  self.assertTrue(r['crossings'])
  self.assertEqual(d['chunks'][0]['objects']['water'],[water])
  self.assertTrue(r['asphalt'].covers(Point(100,100)))

 def test_wall_is_cut_after_road_allocation(self):
  from street_compile import encode_region
  d=data([road('a',[10,100,190,100])])
  d.update(region='test')
  d['chunks'][0]['objects']['walls']=[dict(p=[100,0,100,200],h=2)]
  r=compile_region(d);part=encode_region(d,r)['0_0']
  self.assertFalse(r['audit']['guideFailures'])
  self.assertTrue(part['walls'])
  for w in part['walls']:
   self.assertFalse(LineString(list(zip(w['p'][::2],w['p'][1::2]))).intersects(r['asphalt']))


 def test_city_activation_rejects_unresolved_route_before_mesh_generation(self):
  d=data([road('a',[20,100,180,100])],buildings=[dict(p=[0,0,200,0,200,200,0,200])]);d.update(coverage='manifest',city='test',region='blocked')
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);(root/'build/streets').mkdir(parents=True)
   with patch.object(importlib.import_module('street_compile'),'ROOT',root):
    with self.assertRaisesRegex(ValueError,'unresolved route guides'):compile_region(d)
   self.assertTrue((root/'build/streets/test-blocked-guide-audit.json').exists())

 def test_tiled_boolean_partition_matches_direct_geometry(self):
  a=box(0,0,180,100).difference(box(25,20,155,80));b=LineString([(0,13),(180,91)]).buffer(9)
  for operation in ('intersection','difference'):
   result=overlay(a,b,operation,limit=0,tile_size=32)
   self.assertTrue(result.is_valid)
   self.assertLess(result.symmetric_difference(getattr(a,operation)(b)).area,.00001)

 def test_tiled_metric_operation_preserves_holes_and_cross_boundary_erosion(self):
  shape=box(0,0,180,100).difference(box(25,20,155,80))
  for distance in (2,-2):
   direct=shape.buffer(distance,quad_segs=4)
   tiled=metric_buffer(shape,distance,limit=0,tile_size=32)
   self.assertLess(tiled.symmetric_difference(direct).area,.00001)

 def test_parallel_carriageways_have_no_artificial_median(self):
  d=data([road('a',[10,90,190,90],oneway='yes'),road('b',[190,105,10,105],oneway='yes')]);d['roads'][1]['name']='a'
  r=compile_region(d)
  self.assertTrue(r['asphalt'].covers(LineString([(20,97.5),(180,97.5)])))
  self.assertEqual(r['audit']['missingRouteSamples'],0)
  self.assertLess(r['paint'].intersection(LineString([(100,80),(100,120)])).length,.2)
  self.assertLess(r['asphalt'].intersection(r['pavement']).area,.001)
 def test_bus_lane_inside_street_does_not_duplicate_centreline(self):
  d=data([road('a',[10,90,190,90],oneway='yes'),road('b',[190,105,10,105],oneway='yes'),dict(id='bus',p=[10,94,190,94],w=7,highway='busway',oneway='yes')]);d['roads'][1]['name']='a'
  r=compile_region(d)
  section=r['paint'].intersection(LineString([(100,80),(100,120)]))
  self.assertGreater(section.length,.1);self.assertLess(section.length,.2)
 def test_protected_island_stays(self):
  d=data([road('a',[10,90,190,90],oneway='yes'),road('b',[190,105,10,105],oneway='yes')],islands=[dict(p=[70,96,130,96,130,99,70,99])]);d['roads'][1]['name']='a'
  self.assertFalse(compile_region(d)['asphalt'].covers(Point(100,97)))
 def test_unrelated_parallel_roads_not_merged(self):
  r=compile_region(data([road('a',[10,70,190,70]),road('b',[10,100,190,100])]))
  self.assertFalse(r['asphalt'].covers(Point(100,85)))
 def test_intersection_no_internal_sidewalk(self):
  r=compile_region(data([road('a',[10,100,190,100]),road('b',[100,10,100,190])]))
  self.assertTrue(r['asphalt'].covers(box(97,97,103,103)))
  self.assertFalse(r['pavement'].intersects(box(98,98,102,102)))
 def test_building_corner_reroutes_shared_node_consistently(self):
  obstacle=box(95,98,105,110)
  guides,changes,failed=route_guides([road('a',[20,100,100,100]),road('b',[100,100,180,100])],obstacle,box(0,0,200,200))
  self.assertFalse(failed)
  self.assertEqual(guides[0]['p'][-2:],guides[1]['p'][:2])
  for r in guides:self.assertFalse(LineString(list(zip(r['p'][::2],r['p'][1::2]))).buffer(.75).intersects(obstacle))
 def test_bridge_and_river_preserved(self):
  d=data([road('a',[100,10,100,190],bridge=True,layer=1)],water=[dict(p=[0,100,200,100],w=20)])
  d['chunks'][0]['objects']['walls']=[dict(p=[0,110,200,110],w=.6,h=2.2)]
  r=compile_region(d);self.assertTrue(r['elevatedSurfaces'][1].covers(Point(100,100)));self.assertFalse(r['asphalt'].covers(Point(100,100)))
  self.assertTrue(r['elevatedSurfaces'][1].covers(Point(100,110)))
 def test_input_order_deterministic(self):
  roads=[road('a',[10,100,190,100]),road('b',[100,10,100,190])]
  a=compile_region(data(roads));b=compile_region(data(list(reversed(roads))))
  self.assertLess(a['asphalt'].symmetric_difference(b['asphalt']).area,.0001)
if __name__=='__main__':unittest.main()


class CheckpointIntegrity(unittest.TestCase):
 def test_reuses_only_matching_design_input_and_payload(self):
  from street_checkpoint import save_design,load_design
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);source=p/'input.json';compiler=p/'compiler.py';cache=p/'design.pickle'
   source.write_text('{}');compiler.write_text('def design(): return 1\ndef encode_region(): return 1\n')
   save_design(source,compiler,cache,{'ok':True})
   self.assertEqual(load_design(source,compiler,cache),{'ok':True})
   compiler.write_text('def design(): return 1\ndef encode_region(): return 2\n')
   self.assertIsNotNone(load_design(source,compiler,cache))
   compiler.write_text('def design(): return 2\ndef encode_region(): return 2\n')
   self.assertIsNone(load_design(source,compiler,cache))
   save_design(source,compiler,cache,{})
   source.write_text('{"changed":true}');self.assertIsNone(load_design(source,compiler,cache))
   save_design(source,compiler,cache,{})
   cache.write_bytes(b'broken');self.assertIsNone(load_design(source,compiler,cache))

class WalkAccessOpenings(unittest.TestCase):
 def test_reserves_stair_opening_in_both_render_and_collision_footprints(self):
  from street_walk_access import resolve_walk_access
  from street_compile import ring,union
  b=dict(p=[20,20,80,20,80,80,20,80],h=8,supportPoints=[20,20,50,20,80,80])
  part=dict(regions=[dict(kind='walkdeck',p=[45,10,55,10,55,90,45,90],profile=dict(levels=[0,1]))],resolvedBuildings=[dict(b)],buildings=[dict(b)])
  self.assertEqual(resolve_walk_access(part),2)
  for key in ('resolvedBuildings','buildings'):
   shape=union([ring(x) for x in part[key]])
   self.assertFalse(shape.covers(Point(50,50)));self.assertTrue(shape.covers(Point(30,50)))
   self.assertEqual(sum(len(x.get('supportPoints',[])) for x in part[key]),4)
  self.assertEqual(resolve_walk_access(part),0)
 def test_flat_upper_route_does_not_hollow_the_building_below(self):
  from street_walk_access import resolve_walk_access
  b=dict(p=[20,20,80,20,80,80,20,80],h=8)
  part=dict(regions=[dict(kind='walkdeck',p=b['p'],profile=dict(levels=[3]))],resolvedBuildings=[b])
  self.assertEqual(resolve_walk_access(part),0)
  self.assertEqual(part['resolvedBuildings'],[b])

class FinalHostPlacement(unittest.TestCase):
 def test_terrace_uses_the_fitted_host_footprint_and_leaves_the_road_clear(self):
  from street_walk_access import resolve_walk_access
  from street_compile import ring,union
  host=dict(osmId='stand',p=[20,20,40,20,40,80,20,80],walkableProfile=dict(height=3))
  part=dict(regions=[dict(kind='walkdeck',source='stand',p=[20,20,80,20,80,80,20,80],profile=dict(offset=3),triangles=[])],resolvedBuildings=[host])
  self.assertGreater(resolve_walk_access(part),0)
  shape=union([ring(r) for r in part['regions']])
  self.assertFalse(shape.covers(Point(60,50)));self.assertTrue(shape.covers(Point(30,50)))
  self.assertTrue(part['regions'][0]['triangles'])
  self.assertEqual(resolve_walk_access(part),0)
 def test_support_posts_clear_upper_walking_corridors_too(self):
  from street_walk_access import resolve_walk_access
  part=dict(regions=[],resolvedStructures=[dict(supportPoints=[50,50,70,70])])
  self.assertEqual(resolve_walk_access(part,[box(49,40,51,60)]),1)
  self.assertEqual(part['resolvedStructures'][0]['supportPoints'],[70,70])

class LowPlinthOwnership(unittest.TestCase):
 def test_low_plinth_becomes_ground_pavement_and_route_levels_follow(self):
  from street_walk_access import flatten_low_plinths,ground_route_transitions
  from street_compile import ring,union
  host=dict(osmId='low',p=[20,20,80,20,80,80,20,80],walkableProfile=dict(height=.1))
  part=dict(bounds=[0,0,200,200],regions=[dict(kind='walkdeck',source='low',p=host['p'],profile=dict(offset=.1))],resolvedBuildings=[host])
  self.assertEqual(flatten_low_plinths(part,[host]),1)
  self.assertTrue(all(r['kind']=='pavement' for r in part['regions']))
  self.assertEqual(flatten_low_plinths(part,[host]),0)
  routes=[dict(id='walk',p=[[10,50],[90,50]],elevated=True,level=1),dict(id='bridge',p=[[10,50],[90,50]],elevated=True,level=1)]
  out=ground_route_transitions(routes,[ring(z) for z in part['groundWalkZones']],{'walk'})
  self.assertTrue(any(r['id']=='walk' and not r['elevated'] for r in out))
  self.assertEqual([r for r in out if r['id']=='bridge'],[routes[1]])
  self.assertAlmostEqual(sum(LineString(r['p']).length for r in out if r['id']=='walk'),80)

class TerraceEntries(unittest.TestCase):
 def test_mapped_entry_is_inserted_in_mesh_boundary_and_reused(self):
  from street_walk_access import attach_ground_entries
  p=dict(regions=[dict(kind='walkdeck',source='stand',p=[20,20,80,20,80,80,20,80],profile=dict(offset=3),triangles=[])])
  paths=[LineString([(0,43.1234),(50,43.1234)])]
  self.assertEqual(attach_ground_entries(p,paths),1)
  r=p['regions'][0];self.assertIn([20,43.1234],r['profile']['accessAnchors'])
  self.assertTrue(any(abs(r['p'][i]-20)<.0001 and abs(r['p'][i+1]-43.1234)<.0001 for i in range(0,len(r['p']),2)))
  self.assertTrue(r['triangles']);self.assertEqual(attach_ground_entries(p,paths),0)
