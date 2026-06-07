import { Game } from "./core/Game";

/**
 * CORE — 진입점.
 * 캔버스를 잡고 게임 루프를 시작한다. (HUD/오버레이는 index.html 에 정적 배치)
 */
const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (!canvas) throw new Error("#game canvas not found");

const game = new Game(canvas);
game.start();
