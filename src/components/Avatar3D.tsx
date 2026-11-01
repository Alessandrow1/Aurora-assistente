import { useEffect, useRef, useState } from 'react';

type AvatarEmotion = 'neutral' | 'happy' | 'sad' | 'surprised' | 'curious' | 'angry' | 'affectionate' | 'laughing';
type Props = {
  speaking: boolean;
  thinking: boolean;
  laughing: boolean;
  emotion: AvatarEmotion;
  audioAnalyser: AnalyserNode | null;
};

/** Renderiza localmente a personagem Live2D 6xb dentro da janela transparente. */
export default function Avatar3D(props: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const hitZoneRef = useRef<HTMLDivElement>(null);
  const [modelFailed, setModelFailed] = useState('');
  const emotionRef = useRef(props.emotion);
  emotionRef.current = props.emotion;

  useEffect(() => {
    const host = mountRef.current;
    const hitZone = hitZoneRef.current;
    if (!host || !hitZone) return;

    let active = true;
    let disposeLive2D: (() => void) | null = null;
    let disposeCursor: (() => void) | null = null;
    let adjustZoom: ((factor: number) => number) | null = null;
    let pointerInside = false;
    let uiOpen = document.body.classList.contains('aurora-ui-open');
    let draggingPointerId: number | null = null;
    let lastScreenX = 0;
    let lastScreenY = 0;

    const onAutomaticZoom = (event: Event) => {
      const scale = (event as CustomEvent<number>).detail;
      if (Number.isFinite(scale) && scale > 0) {
        hitZone.style.setProperty('--aurora-hit-scale', String(scale));
      }
    };
    window.addEventListener('aurora:zoom-updated', onAutomaticZoom);

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
      .then(({ mountLive2D, adjustLive2DZoom, setLive2DCursorPosition, setLive2DEmotion }) => {
        if (!active) return;
        adjustZoom = adjustLive2DZoom;
        disposeLive2D = mountLive2D(canvas);
        setLive2DEmotion(emotionRef.current);
        disposeCursor = window.aurora.onCursorPosition((position) => {
          if (!active) return;
          const rect = canvas.getBoundingClientRect();
          setLive2DCursorPosition(position.x - rect.left, position.y - rect.top);
        });
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
      window.removeEventListener('aurora:zoom-updated', onAutomaticZoom);
      window.aurora.setMousePassthrough(false);
      disposeCursor?.();
      disposeLive2D?.();
      canvas.remove();
    };
  }, []);


  useEffect(() => {
    let active = true;
    import('../live2d/Live2DHost').then(({ setLive2DEmotion }) => {
      if (active) setLive2DEmotion(props.emotion);
    }).catch((error) => console.warn('[Aurora Live2D] Nao foi possivel aplicar a emocao.', error));
    return () => { active = false; };
  }, [props.emotion]);
  // AURORA_LIPSYNC_REACT: analisa o audio reproduzido e anima ParamMouthOpenY.
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let sendLevel: ((level: number) => void) | null = null;
    let smoothed = 0;
    let fallbackPhase = 0;
    const analyser = props.audioAnalyser;
    const samples = analyser ? new Uint8Array(analyser.fftSize) : null;

    const start = async () => {
      try {
        const live2d = await import('../live2d/Live2DHost');
        if (cancelled) return;
        sendLevel = live2d.setLive2DLipSync;

        const update = () => {
          if (cancelled) return;
          let target = 0;

          if (analyser && samples) {
            try {
              analyser.getByteTimeDomainData(samples);
              let sumSquares = 0;
              for (let index = 0; index < samples.length; index++) {
                const sample = (samples[index] - 128) / 128;
                sumSquares += sample * sample;
              }
              const rms = Math.sqrt(sumSquares / samples.length);
              const intensity = Math.max(0, Math.min(1, (rms - 0.012) * 7.5));
              target = Math.pow(intensity, 0.82) * 0.86;
            } catch {
              target = 0;
            }
          } else if (props.speaking) {
            // Fallback visual para a voz do Windows, que nao passa pelo AudioAnalyser.
            fallbackPhase += 0.17;
            target = 0.10 + ((Math.sin(fallbackPhase * 2.2) + 1) * 0.5) * 0.24;
          }

          const smoothing = target > smoothed ? 0.48 : 0.20;
          smoothed += (target - smoothed) * smoothing;
          sendLevel?.(Math.max(0, Math.min(0.88, smoothed)));
          frame = requestAnimationFrame(update);
        };

        update();
      } catch (error) {
        console.warn('[Aurora lip-sync] Nao foi possivel iniciar o controle da boca.', error);
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      sendLevel?.(0);
    };
  }, [props.audioAnalyser, props.speaking]);

  return (
    <div className="avatar-stage">
      <div className="avatar-canvas" ref={mountRef} aria-label="Aurora, personagem Live2D em fundo transparente" />
      <div className="avatar-hit-zone" ref={hitZoneRef} aria-label="Ãrea interativa da Aurora" />
      {modelFailed && <div className="avatar-fallback-note">Falha ao carregar o Live2D: {modelFailed}</div>}
    </div>
  );
}