import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {WalkerMech} from "../src/assets/WalkerMech";
import {WalkerThrusters} from "../src/assets/WalkerThrusters";
import {parseWalkerSkin,WALKER_SKIN_SLOTS} from "../src/assets/WalkerSkin";
const skins=["obsidian","polar","dune"].map(id=>parseWalkerSkin(JSON.parse(readFileSync(`public/models/skins/walker/${id}.json`,"utf8"))));
const baseNodes=(mech:WalkerMech)=>{const result:unknown[]=[];const visit=(n:import("three").Object3D)=>{if(n.userData.skinGarnish)return;result.push(n);n.children.forEach(visit);};visit(mech);return result;};
describe("walker material skins",()=>{
 it("ships a plain hull and removes all skin-owned garnish when cleared",()=>{
  const mech=new WalkerMech();const base=baseNodes(mech);
  try{
   expect(mech.userData.skinId).toBe("base");expect(mech.getSkinMaterial("armor").roughnessMap).toBeNull();
   mech.applySkin(skins[1]);let garnish=0;mech.traverse(n=>{if(n.userData.skinGarnish)garnish++;});expect(garnish).toBeGreaterThan(0);
   mech.clearSkin();let remaining=0;mech.traverse(n=>{if(n.userData.skinGarnish)remaining++;});expect(remaining).toBe(0);expect(baseNodes(mech)).toEqual(base);expect(mech.getSkinMaterial("armor").roughnessMap).toBeNull();
  }finally{mech.dispose();}
 });
 it("switches all six slots without rebuilding geometry or disturbing pose",()=>{
  const mech=new WalkerMech();mech.setPose({walk:.6,phase:1,legTrailX:.1});
  const joint=mech.legs.left.hip.quaternion.clone(),material=mech.getSkinMaterial("armor");
  const nodes=baseNodes(mech);
  try{for(const skin of [...skins,...skins]){
   mech.applySkin(skin);expect(mech.userData.skinId).toBe(skin.id);
   expect(mech.getSkinMaterial("armor")).toBe(material);expect(material.roughnessMap).not.toBeNull();
   expect(mech.legs.left.hip.quaternion.angleTo(joint)).toBeLessThan(1e-6);
   const current=baseNodes(mech);expect(current).toEqual(nodes);
   for(const slot of WALKER_SKIN_SLOTS){const mat=mech.getSkinMaterial(slot);expect('#'+mat.color.getHexString()).toBe(skin.materials[slot].color);expect(mat.roughness).toBe(skin.materials[slot].roughness);expect(mat.userData.skinSlot).toBe(slot);}
  }}finally{mech.dispose();}
 });
 it("keeps skins isolated between instances and shares nozzle material without double disposal",()=>{
  const a=new WalkerMech({skin:skins[0]}),b=new WalkerMech({skin:skins[0]}),jets=new WalkerThrusters(a);
  const steel=a.getSkinMaterial("steel");let disposals=0;steel.addEventListener("dispose",()=>disposals++);
  try{a.applySkin(skins[1]);expect(b.getSkinMaterial("armor").color.getHexString()).toBe('202830');
   let borrowed=false;jets.root.traverse(n=>{if('material' in n && n.material===steel)borrowed=true;});expect(borrowed).toBe(true);
   jets.dispose();expect(disposals).toBe(0);a.dispose();expect(disposals).toBe(1);
  }finally{a.dispose();b.dispose();}
 });
 it("rejects malformed or incompatible definitions before modifying materials",()=>{
  const mech=new WalkerMech({skin:skins[0]});
  try{for(const invalid of [{...skins[1],modelId:'other'},{...skins[1],materials:{...skins[1].materials,sensor:{color:'invalid'}}}]){
   expect(()=>mech.applySkin(invalid as typeof skins[number])).toThrow();expect(mech.userData.skinId).toBe('obsidian');expect(mech.getSkinMaterial('armor').color.getHexString()).toBe('202830');
  }}finally{mech.dispose();}
 });
});
