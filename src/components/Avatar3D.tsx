import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

type Props = { speaking: boolean; thinking: boolean };

/** Renderiza a personagem anime VRM da Aurora e anima suas expressões. */
export default function Avatar3D({ speaking, thinking }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ speaking, thinking });
  const [modelFailed, setModelFailed] = useState(false);
  stateRef.current = { speaking, thinking };

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;

    let disposed = false;
    let frame = 0;
    let vrm: any = null;
    let head: THREE.Object3D | null = null;
    let baseY = 0;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 1.35, 6.2);
    camera.lookAt(0, 1.25, 0);

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
      const { speaking: isSpeaking, thinking: isThinking } = stateRef.current;

      fallback.position.y = Math.sin(time * 1.2) * 0.035;
      halo.rotation.z = Math.sin(time * 0.2) * 0.12;
      orb.scale.setScalar(1 + Math.sin(time * 1.8) * 0.018);

      if (vrm) {
        vrm.scene.position.y = baseY + Math.sin(time * 1.1) * 0.018 + (isThinking ? 0.012 : 0);
        if (head) {
          head.rotation.y = Math.sin(time * 0.42) * 0.035;
          head.rotation.z = Math.sin(time * 0.62) * 0.012;
        }
        const blink = Math.sin(time * 0.72 + 0.4) > 0.994 ? 1 : 0;
        vrm.expressionManager?.setValue('blink', blink);
        vrm.expressionManager?.setValue('aa', isSpeaking ? 0.16 + Math.abs(Math.sin(time * 9.5)) * 0.3 : 0);
        vrm.expressionManager?.setValue('happy', isThinking ? 0.08 : 0.12);
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
