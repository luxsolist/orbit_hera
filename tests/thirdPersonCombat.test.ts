import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {CoreEnemy} from '../src/enemies/CoreEnemy';
import {EnemyManager} from '../src/enemies/EnemyManager';
import {DEFAULT_PLASMOID} from '../src/enemies/PlasmoidSpec';
import {bestVisibleAlignedDir} from '../src/weapons/targeting';

const origin={x:0,y:0,z:0},aim={x:0,y:0,z:-1};
describe('third-person combat visibility',()=>{
  it('2000 irrelevant enemies require no building queries; best visible target requires one',()=>{
    const positions=Array.from({length:2000},(_,i)=>({x:i,y:0,z:100}));
    positions.push({x:0,y:0,z:-20},{x:1,y:0,z:-20});
    const blocked=vi.fn(()=>false);
    expect(bestVisibleAlignedDir(origin,aim,positions,100,.95,blocked)).toEqual(aim);
    expect(blocked).toHaveBeenCalledTimes(1);
    expect(blocked).toHaveBeenCalledWith(2000);
  });
  it('blocked best target falls back to next visible candidate, preserving original indices',()=>{
    const blocked=vi.fn((i:number)=>i===1);
    const result=bestVisibleAlignedDir(origin,aim,[{x:1,y:0,z:-10},{x:0,y:0,z:-10}],100,.95,blocked);
    expect(result!.x).toBeGreaterThan(0);
    expect(blocked.mock.calls.map(c=>c[0])).toEqual([1,0]);
  });
  for(const role of ['rusher','kiter'] as const)it(`${role}: wall prevents damage/growth, opening allows immediate attack`,()=>{
    const enemy=new CoreEnemy(new THREE.Vector3(),{maxHp:100,diameter:2,color:0xff3b30},0);
    enemy.role=role;
    const manager=Object.create(EnemyManager.prototype) as any;
    manager.spec=DEFAULT_PLASMOID;
    manager.kiterArche=DEFAULT_PLASMOID.archetypes.kiter;
    const wall=vi.fn(()=>.5);
    manager.world={segmentHitsBuilding:wall};
    manager.drain={spawn:vi.fn()};
    const player={takeDamage:vi.fn(()=>true)};
    const target=new THREE.Vector3(0,0,-2);
    manager.attack(enemy,target,enemy.group.position,player,null);
    expect(player.takeDamage).not.toHaveBeenCalled();
    expect(enemy.maxHp).toBe(100);
    wall.mockReturnValue(Infinity);
    manager.attack(enemy,target,enemy.group.position,player,null);
    expect(player.takeDamage).toHaveBeenCalledTimes(1);
    expect(enemy.maxHp).toBeGreaterThan(100);
    wall.mockClear();
    manager.attack(enemy,target,enemy.group.position,player,null);
    expect(wall).not.toHaveBeenCalled();
    expect(player.takeDamage).toHaveBeenCalledTimes(1);
    enemy.dispose();
  });
});
