import { CubismFramework, Option } from '@framework/live2dcubismframework';
import * as LAppDefine from './sdk/lappdefine';
import { LAppPal } from './sdk/lapppal';
import { LAppSubdelegate } from './sdk/lappsubdelegate';

// AURORA_LIVE2D_ZOOM: esta aplicaÃ§Ã£o mantÃ©m uma Ãºnica personagem Live2D.
let activeSubdelegate: LAppSubdelegate | null = null;
let activeCanvas: HTMLCanvasElement | null = null;
let pendingSnapshot: {
  resolve: (dataUrl: string) => void;
  reject: (error: Error) => void;
  timeout: number;
} | null = null;

export function captureLive2DSnapshot(): Promise<string> {
  if (!activeCanvas || !activeSubdelegate) {
    return Promise.reject(new Error('A personagem Live2D ainda não está pronta para ser observada.'));
  }
  if (pendingSnapshot) {
    return Promise.reject(new Error('Já estou preparando uma captura do avatar.'));
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (pendingSnapshot?.resolve !== resolve) return;
      pendingSnapshot = null;
      reject(new Error('A captura do avatar demorou mais do que o esperado.'));
    }, 2500);
    pendingSnapshot = { resolve, reject, timeout };
  });
}

export function adjustLive2DZoom(factor: number): number {
  return activeSubdelegate?.adjustZoom(factor) ?? 1;
}

export function setLive2DCursorPosition(x: number, y: number): void {
  activeSubdelegate?.setCursorPosition(x, y);
}

export function setLive2DEmotion(emotion: 'neutral' | 'happy' | 'sad' | 'surprised' | 'curious' | 'angry' | 'affectionate' | 'laughing'): void {
  activeSubdelegate?.setAuroraEmotion(emotion);
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
  activeCanvas = canvas;

  const render = (): void => {
    if (disposed) return;
    LAppPal.updateTime();
    subdelegate.update();
    if (pendingSnapshot) {
      const request = pendingSnapshot;
      pendingSnapshot = null;
      window.clearTimeout(request.timeout);
      try {
        const dataUrl = canvas.toDataURL('image/png');
        if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length < 1500) {
          throw new Error('A captura do avatar retornou uma imagem vazia.');
        }
        request.resolve(dataUrl);
      } catch {
        request.reject(new Error('Não consegui ler a imagem renderizada do avatar Live2D.'));
      }
    }
    frame = requestAnimationFrame(render);
  };
  render();

  return (): void => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    if (pendingSnapshot) {
      window.clearTimeout(pendingSnapshot.timeout);
      pendingSnapshot.reject(new Error('A personagem foi fechada antes da captura terminar.'));
      pendingSnapshot = null;
    }
    if (activeSubdelegate === subdelegate) {
      activeSubdelegate = null;
      activeCanvas = null;
    }
    subdelegate.release();
    CubismFramework.dispose();
  };
}