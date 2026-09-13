# Plasmoid visuals — gameplay integration

The game now uses `EnemyPlasmoidRenderer`, reusing `PlasmoidVisual` geometry/shaders through role/component instance batches. Leech, skeeter, brander, elite and boss are mapped separately; elite/boss appearances do not depend on their shared rusher behavior role.

Brander has three soft energy arcs and no satellites. Boss has a corona and six satellites, without a ring. Actual homing brand projectiles now share the three-arc silhouette. Body charge/attack/recovery follows marker charge and launch, elite combat state, boss blast state, dash and phase/leap fields. No new damage timing or attack delays are introduced. Ordinary skeeters retain their existing immediate-shot combat timing.

Existing shell instances remain invisible raycast proxies, with unchanged geometry and instance-to-enemy mapping. Decorative arcs, tails and halos are not hit targets. This intentionally preserves the old targeting tolerance, even where it differs from the spherical visual body. Dying enemies use shrinking energy visuals instead of restoring the old solid shell.

Materials and instance buffers are shared per component, with lower-resolution gameplay spheres. At >250m the outer two body layers are omitted while role features remain. This is an initial detail reduction, not a measured mobile performance guarantee. Main-camera visibility corridor alpha fading preserves drone visibility; no light is created per enemy. Clearing a deployment releases all new batch geometry/materials.

The standalone `/tools/plasmoid-preview.html` remains the art study. Its looping attack poses are illustrative; in-game state is driven by combat events. Test coverage includes unchanged ray hits, no decorative hit targets, death/reset cleanup and elite/boss appearance selection.

Daylight readability: cityDaylight now drives shared preview/game feature pigmentation and opacity; the nucleus remains white while appendages retain saturated color. Leech tips, separated skeeter tails, brander arcs and boss satellites have stronger silhouettes. Distance widening is capped at 40% and does not alter hit bounds. Elite attack preparation emphasizes the actual shot/rush/leap feature channel. Added tests cover reversible distance widening and lighting updates on existing instance batches. Browser verification was unavailable during this update.
