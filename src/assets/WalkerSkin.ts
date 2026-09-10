import type * as THREE from "three";
import { WALKER_GARNISH_FEATURES, type WalkerGarnishFeature } from "./WalkerGarnish";

export const WALKER_SKIN_SLOTS = ["armor","trim","frame","steel","accent","sensor"] as const;
export type WalkerSkinSlot = typeof WALKER_SKIN_SLOTS[number];
export interface WalkerSkinMaterial {
  color: string;
  roughness: number;
  metalness: number;
  emissive?: string;
  emissiveIntensity?: number;
}
export interface WalkerSkin {
  schemaVersion: 1;
  modelId: "android-01";
  id: string;
  name: string;
  description: string;
  materials: Record<WalkerSkinSlot,WalkerSkinMaterial>;
  garnish?: WalkerGarnishFeature[];
}
export type WalkerSkinMaterials = Record<WalkerSkinSlot,THREE.MeshStandardMaterial>;
const record=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid walker skin object");
  return value as Record<string,unknown>;
};
const color=(value:unknown):string=>{
  if(typeof value!=="string"||!/^#[0-9a-f]{6}$/i.test(value))throw new Error("Skin colors must be #RRGGBB");
  return value;
};
const number=(value:unknown,max=1):number=>{
  if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>max)throw new Error("Invalid skin material value");
  return value;
};
/** Validate before mutation, producing a detached material definition. */
export function parseWalkerSkin(value:unknown):WalkerSkin {
  const data=record(value);
  if(data.schemaVersion!==1||data.modelId!=="android-01")throw new Error("Unsupported walker skin version or model");
  if(typeof data.id!=="string"||!/^[a-z0-9-]+$/.test(data.id)||typeof data.name!=="string"||typeof data.description!=="string")throw new Error("Invalid skin metadata");
  const source=record(data.materials),materials={} as WalkerSkin["materials"];
  for(const slot of WALKER_SKIN_SLOTS){
    const mat=record(source[slot]);
    materials[slot]={color:color(mat.color),roughness:number(mat.roughness),metalness:number(mat.metalness),emissive:color(mat.emissive??"#000000"),emissiveIntensity:number(mat.emissiveIntensity??0,10)};
  }
  const garnish=data.garnish??[];
  if(!Array.isArray(garnish)||garnish.some(v=>!WALKER_GARNISH_FEATURES.includes(v as WalkerGarnishFeature)))throw new Error("Invalid skin garnish features");
  return {garnish:[...new Set(garnish)] as WalkerGarnishFeature[],schemaVersion:1,modelId:"android-01",id:data.id,name:data.name,description:data.description,materials};
}
export function applyWalkerSkin(materials:WalkerSkinMaterials,definition:WalkerSkin):WalkerSkin {
  const skin=parseWalkerSkin(definition);
  for(const slot of WALKER_SKIN_SLOTS){
    const target=materials[slot],source=skin.materials[slot];
    target.color.set(source.color);target.roughness=source.roughness;target.metalness=source.metalness;
    target.emissive.set(source.emissive!);target.emissiveIntensity=source.emissiveIntensity!;
  }
  return skin;
}
/** Catalog/assets are separate from geometry: adding a skin requires JSON only. */
export async function loadWalkerSkins(url="/models/skins/walker/index.json"):Promise<{defaultSkin:string;skins:WalkerSkin[]}> {
  const read=async(path:string)=>{const response=await fetch(path);if(!response.ok)throw new Error(`Skin load failed: ${response.status}`);return response.json() as Promise<unknown>;};
  const catalog=record(await read(url));
  if(catalog.schemaVersion!==1||catalog.modelId!=="android-01"||!Array.isArray(catalog.skins)||typeof catalog.defaultSkin!=="string")throw new Error("Invalid walker skin catalog");
  const skins=await Promise.all(catalog.skins.map(async entry=>{
    const item=record(entry);if(typeof item.url!=="string")throw new Error("Invalid skin URL");
    const skin=parseWalkerSkin(await read(item.url));if(skin.id!==item.id)throw new Error("Skin catalog ID mismatch");return skin;
  }));
  if(new Set(skins.map(s=>s.id)).size!==skins.length||(catalog.defaultSkin!=="base"&&!skins.some(s=>s.id===catalog.defaultSkin)))throw new Error("Invalid skin catalog IDs");
  return {defaultSkin:catalog.defaultSkin,skins};
}
