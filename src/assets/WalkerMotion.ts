import type { WalkerMech, WalkerPose } from "./WalkerMech";

export interface WalkerMotionState {
  velocityX: number; velocityZ: number; velocityY: number;
  dashDirectionX?: number; dashDirectionZ?: number; dashRemaining?: number;
  grounded: boolean; dashing: boolean; dashPowered?: boolean; yaw: number;
}

/** Distance-driven procedural rig. Feed PlayerController.motionState after update(). */
export class WalkerMotionAnimator {
  phase = 0;
  private wasGrounded = true;
  private landingTime = Infinity;
  private airExtension = 0;
  private dashBlend = 0;
  private legTrailX = 0;
  private legTrailZ = 0;
  update(dt: number, state: WalkerMotionState): WalkerPose {
    const speed = Math.hypot(state.velocityX, state.velocityZ);
    const c = Math.cos(state.yaw), s = Math.sin(state.yaw);
    const x = speed > .001 ? (-c*state.velocityX+s*state.velocityZ)/speed : 0;
    const z = speed > .001 ? (-s*state.velocityX-c*state.velocityZ)/speed : 1;
    const powered=state.dashPowered??state.dashing;
    // Recover during braking, before the controller exits its dash state.
    const recovery=Math.max(0,Math.min(1,(speed-3)/12));
    const dashTarget=powered?1:state.dashing?recovery*.75:0;
    this.dashBlend+=(dashTarget-this.dashBlend)*(1-Math.exp(-dt*(powered?18:10)));
    const dx=state.dashDirectionX??state.velocityX,dz=state.dashDirectionZ??state.velocityZ;
    const length=Math.hypot(dx,dz)||1;
    const endWeight=powered?Math.min(1,(state.dashRemaining??1)/.25):0;
    const trailWeight=this.dashBlend*endWeight;
    const response=1-Math.exp(-dt*14);
    this.legTrailX+=((c*dx-s*dz)/length*.28*trailWeight-this.legTrailX)*response;
    this.legTrailZ+=((s*dx+c*dz)/length*.28*trailWeight-this.legTrailZ)*response;
    const walk = state.grounded && !powered ? Math.min(1,speed/2)*(1-this.dashBlend) : 0;
    // Bound reach to avoid crossing the feet during lateral travel.
    const stride = Math.min(.85, .42/Math.max(.001,Math.abs(x)));
    if (walk > .001) this.phase = (this.phase + dt*Math.min(1.25,speed/(4*stride*walk))*Math.PI*2)%(Math.PI*2);
    if (state.grounded && !this.wasGrounded) this.landingTime = 0;
    else if(state.grounded) this.landingTime += dt;
    else this.landingTime = Infinity;
    // Load the suspension over 120ms, then recover over 420ms without a pose snap.
    const t=this.landingTime;
    const landing=t<.12?Math.sin(t/.12*Math.PI/2):t<.54?(1+Math.cos((t-.12)/.42*Math.PI))*.5:0;
    this.airExtension += ((state.grounded?0:1)-this.airExtension)*(1-Math.exp(-dt*(state.grounded?18:8)));
    this.wasGrounded = state.grounded;
    return { phase:this.phase, walk, travelX:x, travelZ:z, stride,
      lift:.12+.10*Math.min(1,speed/3.2),
      airborne:this.airExtension,
      dash:this.dashBlend, legTrailX:this.legTrailX, legTrailZ:this.legTrailZ,
      crouch:landing };
  }
  apply(mech: WalkerMech, dt: number, state: WalkerMotionState): void {
    mech.setPose(this.update(dt,state));
  }
}
