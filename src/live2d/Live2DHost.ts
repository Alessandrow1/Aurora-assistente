import { CubismFramework, Option } from '@framework/live2dcubismframework';
import * as LAppDefine from './sdk/lappdefine';
import { LAppPal } from './sdk/lapppal';
import { LAppSubdelegate } from './sdk/lappsubdelegate';

// AURORA_LIVE2D_ZOOM: esta aplicaÃ§Ã£o mantÃ©m uma Ãºnica personagem Live2D.
let activeSubdelegate: LAppSubdelegate | null = null;

export function adjustLive2DZoom(factor: number): number {
  return activeSubdelegate?.adjustZoom(factor) ?? 1;
}

// AURORA_LIPSYNC_HOST: nivel de abertura da boca (0 a 1) vindo do audio real.
export function setLive2DLipSync(level: number): void {
  activeSubdelegate?.setLipSyncLevel(level);
}
/** Inicializa o Cubism em um canvas pertencente ao componente React da Aurora. */
export function mountLive2D(canvas: HTMLCanvasElement): () => void {
  let disposed = false;
  let frame = 0;
  const option = new Option();
  option.logFunction = LAppPal.printMessage;
  option.loggingLevel = LAppDefine.CubismLoggingLevel;

  CubismFramework.startUp(option);
  CubismFramework.initialize();

  const subdelegate = new LAppSubdelegate();
  if (!subdelegate.initialize(canvas)) {
    CubismFramework.dispose();
    throw new Error('O Live2D nÃ£o conseguiu inicializar o WebGL 2.');
  }

  activeSubdelegate = subdelegate;

  const render = (): void => {
    if (disposed) return;
    LAppPal.updateTime();
    subdelegate.update();
    frame = requestAnimationFrame(render);
  };
  render();

  return (): void => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    if (activeSubdelegate === subdelegate) activeSubdelegate = null;
    subdelegate.release();
    CubismFramework.dispose();
  };
}