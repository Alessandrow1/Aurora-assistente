import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

type Props = { speaking: boolean; thinking: boolean; laughing: boolean };

/** Renderiza a personagem anime VRM da Aurora e anima suas expressões. */
export default function Avatar3D({ speaking, thinking, laughing }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ speaking, thinking, laughing });
  const [modelFailed, setModelFailed] = useState(false);
  stateRef.current = { speaking, thinking, laughing };

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;

    let disposed = false;
    let frame = 0;
    let vrm: any = null;
    let head: THREE.Object3D | null = null;
    let leftUpperArm: THREE.Object3D | null = null;
    let rightUpperArm: THREE.Object3D | null = null;
    let leftLowerArm: THREE.Object3D | null = null;
    let rightLowerArm: THREE.Object3D | null = null;
    let spine: THREE.Object3D | null = null;
    let chest: THREE.Object3D | null = null;
    let neck: THREE.Object3D | null = null;
    let leftHand: THREE.Object3D | null = null;
    let rightHand: THREE.Object3D | null = null;
    let baseY = 0;
    let leftArmBase = 0;
    let rightArmBase = 0;
    let leftForearmBase = 0;
    let rightForearmBase = 0;
    let spineBaseY = 0;
    let chestBaseX = 0;
    let neckBaseX = 0;
    let leftHandBaseZ = 0;
    let rightHandBaseZ = 0;

    const scene = new THREE.Scene();
    // Enquadramento mais próximo: personagem ocupa mais espaço na área de trabalho.
    const camera = new THREE.PerspectiveCamera(29, 1, 0.1, 100);
    camera.position.set(0, 1.52, 4.75);
    camera.lookAt(0, 1.48, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xf4edff, 0x352444, 2.1));
    const key = new THREE.DirectionalLight(0xffe5f1, 3.2);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const rim = new THREE.PointLight(0x9678ff, 18, 12);
    rim.position.set(3, 1.5, -2);
    scene.add(rim);
    const fill = new THREE.PointLight(0x75dfff, 7, 10);
    fill.position.set(-3, -1, 3);
    scene.add(fill);

    const fallback = new THREE.Group();
    scene.add(fallback);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 48, 36),
      new THREE.MeshPhysicalMaterial({ color: 0x9d83f5, emissive: 0x4f2b88, emissiveIntensity: 0.8, roughness: 0.24, metalness: 0.12, clearcoat: 0.9 }),
    );
    orb.position.set(0, 1.15, 0);
    fallback.add(orb);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.018, 10, 100),
      new THREE.MeshBasicMaterial({ color: 0xc9b8ff, transparent: true, opacity: 0.7 }),
    );
    halo.position.set(0, 1.15, -0.12);
    halo.rotation.x = 0.18;
    fallback.add(halo);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const modelUrl = new URL('models/aurora-anime.vrm', document.baseURI).toString();
    loader.load(
      modelUrl,
      (gltf) => {
        if (disposed) return;
        const loaded = gltf.userData.vrm;
        if (!loaded) {
          setModelFailed(true);
          return;
        }
        try {
          VRMUtils.removeUnnecessaryVertices(loaded.scene);
          VRMUtils.removeUnnecessaryJoints(loaded.scene);
          if (loaded.meta?.metaVersion === '0') VRMUtils.rotateVRM0(loaded);
          loaded.scene.traverse((object: THREE.Object3D) => { object.frustumCulled = false; });

          const boundsBeforeScale = new THREE.Box3().setFromObject(loaded.scene);
          const originalHeight = Math.max(0.1, boundsBeforeScale.max.y - boundsBeforeScale.min.y);
          loaded.scene.scale.setScalar(2.65 / originalHeight);
          const bounds = new THREE.Box3().setFromObject(loaded.scene);
          const center = bounds.getCenter(new THREE.Vector3());
          loaded.scene.position.set(-center.x, -bounds.min.y, -center.z);
          baseY = loaded.scene.position.y;
          scene.add(loaded.scene);
          vrm = loaded;
          head = loaded.humanoid?.getNormalizedBoneNode('head') ?? null;
          leftUpperArm = loaded.humanoid?.getNormalizedBoneNode('leftUpperArm') ?? null;
          rightUpperArm = loaded.humanoid?.getNormalizedBoneNode('rightUpperArm') ?? null;
          leftLowerArm = loaded.humanoid?.getNormalizedBoneNode('leftLowerArm') ?? null;
          rightLowerArm = loaded.humanoid?.getNormalizedBoneNode('rightLowerArm') ?? null;
          spine = loaded.humanoid?.getNormalizedBoneNode('spine') ?? null;
          chest = loaded.humanoid?.getNormalizedBoneNode('chest') ?? null;
          neck = loaded.humanoid?.getNormalizedBoneNode('neck') ?? null;
          leftHand = loaded.humanoid?.getNormalizedBoneNode('leftHand') ?? null;
          rightHand = loaded.humanoid?.getNormalizedBoneNode('rightHand') ?? null;
          // O modelo-base vem em T-pose. Abaixamos os braços para uma pose de descanso.
          if (leftUpperArm) { leftArmBase = leftUpperArm.rotation.z; leftUpperArm.rotation.z = leftArmBase + 1.25; }
          if (rightUpperArm) { rightArmBase = rightUpperArm.rotation.z; rightUpperArm.rotation.z = rightArmBase - 1.25; }
          if (leftLowerArm) leftLowerArm.rotation.z += -0.12;
          if (rightLowerArm) rightLowerArm.rotation.z += 0.12;
          leftForearmBase = leftLowerArm?.rotation.z ?? 0;
          rightForearmBase = rightLowerArm?.rotation.z ?? 0;
          spineBaseY = spine?.rotation.y ?? 0;
          chestBaseX = chest?.rotation.x ?? 0;
          neckBaseX = neck?.rotation.x ?? 0;
          leftHandBaseZ = leftHand?.rotation.z ?? 0;
          rightHandBaseZ = rightHand?.rotation.z ?? 0;
          fallback.visible = false;
          loaded.expressionManager?.setValue('happy', 0.12);
        } catch (error) {
          console.warn('Não consegui preparar o modelo VRM da Aurora.', error);
          setModelFailed(true);
        }
      },
      undefined,
      (error) => {
        console.warn('Modelo VRM da Aurora não foi encontrado.', error);
        setModelFailed(true);
      },
    );

    const clock = new THREE.Clock();
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const time = clock.elapsedTime;
      const { speaking: isSpeaking, thinking: isThinking, laughing: isLaughing } = stateRef.current;

      fallback.position.y = Math.sin(time * 1.2) * 0.035;
      halo.rotation.z = Math.sin(time * 0.2) * 0.12;
      orb.scale.setScalar(1 + Math.sin(time * 1.8) * 0.018);

      if (vrm) {
        vrm.scene.position.y = baseY + Math.sin(time * 1.1) * 0.018 + (isThinking ? 0.012 : 0);
        const laughBounce = isLaughing ? Math.abs(Math.sin(time * 8.5)) : 0;
        const talkGesture = isSpeaking ? 1 : 0;
        if (head) {
          head.rotation.y = Math.sin(time * 0.42) * 0.055 + Math.sin(time * 0.19) * 0.025;
          head.rotation.x = (isThinking ? -0.10 : 0) - laughBounce * 0.035;
          head.rotation.z = Math.sin(time * 0.62) * 0.022 + (isLaughing ? Math.sin(time * 7) * 0.025 : 0);
        }
        if (neck) neck.rotation.x = neckBaseX + Math.sin(time * 0.8) * 0.018 - (isThinking ? 0.035 : 0);
        if (spine) spine.rotation.y = spineBaseY + Math.sin(time * 0.52) * 0.018;
        if (chest) chest.rotation.x = chestBaseX + Math.sin(time * 1.15) * 0.012 + (isSpeaking ? Math.sin(time * 5.2) * 0.012 : 0);
        if (leftUpperArm) leftUpperArm.rotation.z = leftArmBase + 1.25 + Math.sin(time * 0.85) * 0.045 + talkGesture * Math.sin(time * 4.8) * 0.035;
        if (rightUpperArm) rightUpperArm.rotation.z = rightArmBase - 1.25 - Math.sin(time * 0.85) * 0.045 - talkGesture * Math.sin(time * 4.4) * 0.045;
        if (leftLowerArm) leftLowerArm.rotation.z = leftForearmBase - Math.sin(time * 0.9) * 0.025 - (isLaughing ? laughBounce * 0.10 : 0);
        if (rightLowerArm) rightLowerArm.rotation.z = rightForearmBase + Math.sin(time * 0.9) * 0.025 + (isLaughing ? laughBounce * 0.10 : 0);
        if (leftHand) leftHand.rotation.z = leftHandBaseZ + (isSpeaking ? Math.sin(time * 5.2) * 0.08 : Math.sin(time * 0.7) * 0.02);
        if (rightHand) rightHand.rotation.z = rightHandBaseZ + (isSpeaking ? Math.sin(time * 4.7) * 0.07 : Math.sin(time * 0.7) * 0.02);
        const blink = Math.sin(time * 0.72 + 0.4) > 0.994 ? 1 : 0;
        vrm.expressionManager?.setValue('blink', blink);
        vrm.expressionManager?.setValue('aa', isSpeaking ? 0.16 + Math.abs(Math.sin(time * 9.5)) * 0.3 : 0);
        vrm.expressionManager?.setValue('happy', isLaughing ? 0.82 : isThinking ? 0.08 : 0.16);
        vrm.expressionManager?.setValue('relaxed', isLaughing ? 0.25 : 0.08);
        vrm.update(delta);
      }
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(host);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="avatar-stage">
      <div className="avatar-canvas" ref={mountRef} aria-label="Aurora, personagem 3D em estilo anime" />
      {modelFailed && <div className="avatar-fallback-note">Não consegui carregar o modelo anime. Execute ATUALIZAR-AURORA.bat.</div>}
    </div>
  );
}
