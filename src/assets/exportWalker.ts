import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { WalkerMech, type WalkerOptions } from "./WalkerMech";

/** Browser export adapter. Runtime asset construction itself does not require a DOM. */
export async function exportWalkerGLB(options:WalkerOptions={}):Promise<ArrayBuffer>{
  const mech=new WalkerMech(options),converted=new Map<THREE.DataTexture,THREE.CanvasTexture>();
  try{
    // r169 combines roughness/metalness through drawImage, which cannot read DataTexture.
    mech.traverse(o=>{
      if(!(o instanceof THREE.Mesh))return;
      const materials=Array.isArray(o.material)?o.material:[o.material];
      for(const material of materials){
        if(!(material instanceof THREE.MeshStandardMaterial))continue;
        const texture=material.roughnessMap;
        if(!(texture instanceof THREE.DataTexture))continue;
        let canvasTexture=converted.get(texture);
        if(!canvasTexture){
          const {width,height,data}=texture.image;
          const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
          const context=canvas.getContext("2d");
          if(!context)throw new Error("Canvas context unavailable for GLB export");
          context.putImageData(new ImageData(new Uint8ClampedArray(data),width,height),0,0);
          canvasTexture=new THREE.CanvasTexture(canvas);
          canvasTexture.wrapS=texture.wrapS;canvasTexture.wrapT=texture.wrapT;
          canvasTexture.repeat.copy(texture.repeat);converted.set(texture,canvasTexture);
        }
        material.roughnessMap=canvasTexture;
      }
    });
    const result=await new GLTFExporter().parseAsync(mech,{binary:true,animations:mech.createAnimationClips(),onlyVisible:false});
    if(!(result instanceof ArrayBuffer))throw new Error("Expected binary glTF");
    return result;
  }finally{converted.forEach(t=>t.dispose());mech.dispose();}
}
