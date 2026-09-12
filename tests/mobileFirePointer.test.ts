import {it,expect,vi} from 'vitest';
import {MobileControls} from '../src/core/MobileControls';
it('screen fire tap remains pending after release, and capture loss releases held input',()=>{
 const handlers=new Map<string,(e:unknown)=>void>();
 const fire={style:{},classList:{add(){},remove(){}},setPointerCapture:vi.fn(),addEventListener:(name:string,fn:(e:unknown)=>void)=>handlers.set(name,fn)};
 const dummy={...fire,addEventListener:()=>{}};
 const controls=Object.assign(Object.create(MobileControls.prototype),{input:{fireHeld:false,firePressed:false},btnFire:fire,btnSpecial:dummy,btnAct1:dummy,btnAct2:dummy});
 controls.bindButtons();
 const event={pointerId:1,button:0,stopPropagation(){},preventDefault(){}};
 handlers.get('pointerdown')!(event);handlers.get('pointerup')!(event);
 expect(controls.input.fireHeld).toBe(false);expect(controls.input.firePressed).toBe(true);
 controls.input.firePressed=false;handlers.get('pointerdown')!(event);
 handlers.get('lostpointercapture')!(event);expect(controls.input.fireHeld).toBe(false);
 handlers.get('pointerdown')!({...event,button:2});expect(controls.input.fireHeld).toBe(false);
});
