import {loadWalkerSkins,parseWalkerSkin,type WalkerSkin} from "./WalkerSkin";
export type FlyerSkin=Omit<WalkerSkin,"modelId">&{modelId:"drone-v1"};
/** Reuse the canonical palettes, while validating flyer ownership at the asset boundary. */
export function parseFlyerSkin(value:FlyerSkin):FlyerSkin {
 if(value.modelId!=="drone-v1")throw new Error("Skin is not for the flyer");
 return {...parseWalkerSkin({...value,modelId:"android-01"}),modelId:"drone-v1"};
}
export async function loadFlyerSkins():Promise<FlyerSkin[]> {
 const catalog=await loadWalkerSkins();
 return catalog.skins.map(s=>({...s,modelId:"drone-v1"}));
}
