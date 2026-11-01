import { useEffect, useRef, useState } from 'react';

type AvatarEmotion = 'neutral' | 'happy' | 'sad' | 'surprised' | 'curious';
type Props = {
  speaking: boolean;
  thinking: boolean;
  laughing: boolean;
  emotion: AvatarEmotion;
  audioAnalyser: AnalyserNode | null;
};

/** Renderiza localmente a personagem Live2D 6xb dentro da janela transparente. */
export default function Avatar3D(_props: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const hitZoneRef = useRef<HTMLDivElement>(null);
  const [modelFailed, setModelFailed] = useState('');

  useEffect(() => {
    const host = mountRef.current;
    const hitZone = hitZoneRef.current;
    if (!host || !hitZone) return;

    let active = true;
    let disposeLive2D: (() => void) | null = null;
    let adjustZoom: ((factor: number) => number) | null = null;
    let pointerInside = false;
    let uiOpen = document.body.classList.contains('aurora-ui-open');
    let draggingPointerId: number | null = null;
    let lastScreenX = 0;
    let lastScreenY = 0;

    const syncMouseMode = () => {
      window.aurora.setMousePassthrough(!(uiOpen || pointerInside || draggingPointerId !== null));
    };

    const onPointerEnter = () => {
      pointerInside = true;
      syncMouseMode();
    };

    const onPointerLeave = () => {
      if (draggingPointerId === null) pointerInside = false;
      syncMouseMode();
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!adjustZoom || event.deltaY === 0) return;
      const steps = Math.max(-3, Math.min(3, event.deltaY / 100));
      const hitScale = adjustZoom(Math.pow(1.10, -steps));
      if (Number.isFinite(hitScale)) {
        hitZone.style.setProperty('--aurora-hit-scale', String(hitScale));
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (uiOpen || event.button !== 0) return;
      draggingPointerId = event.pointerId;
      lastScreenX = event.screenX;
      lastScreenY = event.screenY;
      pointerInside = true;
      try { hitZone.setPointerCapture(event.pointerId); } catch { /* captura pode nÃ£o estar disponÃ­vel */ }
      syncMouseMode();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (draggingPointerId !== event.pointerId) return;
      const deltaX = Math.round(event.screenX - lastScreenX);
      const deltaY = Math.round(event.screenY - lastScreenY);
      lastScreenX = event.screenX;
      lastScreenY = event.screenY;
      if (deltaX !== 0 || deltaY !== 0) window.aurora.moveWindowBy(deltaX, deltaY);
    };

    const finishDrag = (event: PointerEvent) => {
      if (draggingPointerId !== event.pointerId) return;
      try { if (hitZone.hasPointerCapture(event.pointerId)) hitZone.releasePointerCapture(event.pointerId); } catch { /* ignorar */ }
      draggingPointerId = null;
      requestAnimationFrame(() => {
        pointerInside = hitZone.matches(':hover');
        syncMouseMode();
      });
    };

    const bodyObserver = new MutationObserver(() => {
      uiOpen = document.body.classList.contains('aurora-ui-open');
      syncMouseMode();
    });
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    hitZone.addEventListener('pointerenter', onPointerEnter);
    hitZone.addEventListener('pointerleave', onPointerLeave);
    hitZone.addEventListener('wheel', onWheel, { passive: false });
    hitZone.addEventListener('pointerdown', onPointerDown);
    hitZone.addEventListener('pointermove', onPointerMove);
    hitZone.addEventListener('pointerup', finishDrag);
    hitZone.addEventListener('pointercancel', finishDrag);

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', 'Aurora, personagem Live2D');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.background = 'transparent';
    host.replaceChildren(canvas);

    import('../live2d/Live2DHost')
      .then(({ mountLive2D, adjustLive2DZoom }) => {
        if (!active) return;
        adjustZoom = adjustLive2DZoom;
        disposeLive2D = mountLive2D(canvas);
      })
      .catch((error: unknown) => {
        console.error('Falha ao carregar a personagem Live2D.', error);
        if (active) setModelFailed(error instanceof Error ? error.message : 'NÃ£o consegui carregar a personagem Live2D.');
      });

    syncMouseMode();

    return () => {
      active = false;
      bodyObserver.disconnect();
      hitZone.removeEventListener('pointerenter', onPointerEnter);
      hitZone.removeEventListener('pointerleave', onPointerLeave);
      hitZone.removeEventListener('wheel', onWheel);
      hitZone.removeEventListener('pointerdown', onPointerDown);
      hitZone.removeEventListener('pointermove', onPointerMove);
      hitZone.removeEventListener('pointerup', finishDrag);
      hitZone.removeEventListener('pointercancel', finishDrag);
      window.aurora.setMousePassthrough(false);
      disposeLive2D?.();
      canvas.remove();
    };
  }, []);

  return (
    <div className="avatar-stage">
      <div className="avatar-canvas" ref={mountRef} aria-label="Aurora, personagem Live2D em fundo transparente" />
      <div className="avatar-hit-zone" ref={hitZoneRef} aria-label="Ãrea interativa da Aurora" />
      {modelFailed && <div className="avatar-fallback-note">Falha ao carregar o Live2D: {modelFailed}</div>}
    </div>
  );
}