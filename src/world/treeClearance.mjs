// One rule for "may a tree stand here relative to the road surfaces", shared by the runtime
// placement (Vegetation.ts) and the build/audit gate (scripts/audit-elevated-roads.mjs).
// Keeping it in one module is the regression guard: the audit can never pass a tree the
// renderer would reject, or the reverse.
//
// Tree templates (Vegetation.treeTemplates) top out near 10 m per unit height scale (the
// cypress column) and spread up to ~3.4 m per unit width scale (the stone pine parasol).
export const TREE_TOP_PER_SCALE=10;
export const CROWN_RADIUS_PER_SCALE=3.4;
/** Air gap kept between a crown and the underside of an elevated deck slab. */
export const DECK_TREE_GAP=1.5;
/** Deck slab depth below its driving surface (the rendered girder). */
export const DECK_SLAB_DEPTH=1.2;

/** True when a tree of height scale `h` at ground `groundY` would reach a deck surface at `deckY`. */
export function deckTreeConflict(groundY,h,deckY){
 return groundY+h*TREE_TOP_PER_SCALE+DECK_TREE_GAP>deckY-DECK_SLAB_DEPTH;
}
/** Points tested for a crown of width scale `w`: trunk plus an 8-point ring at the crown edge. */
export function crownProbe(x,z,w){
 const r=w*CROWN_RADIUS_PER_SCALE,out=[[x,z]];
 for(let i=0;i<8;i++){const a=i*Math.PI/4;out.push([x+Math.cos(a)*r,z+Math.sin(a)*r]);}
 return out;
}
