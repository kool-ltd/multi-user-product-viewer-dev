// app.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { InteractionManager } from './InteractionManager.js';
import { setupUIControls, updateToggleUI } from './uiControls.js';
import { showHostRequestModal, showConfirmationModal } from './modalManager.js';

// Ensure your socket.io client library is loaded.
const io = window.io;

class App {
  constructor() {
    this.loadedModels = new Map();
    this.draggableObjects = [];
    this.isARMode = false;
    this.socket = io();
    this.isDragging = false;
    // For mouse/touch pointer coordinates (normalized device coordinates).
    this.pointerNDC = new THREE.Vector2(0, 0);

    // Default to viewer mode; host toggled via UI.
    this.isHost = false;

    // Create initial loading overlays.
    this.createLoadingOverlay();
    this.createUploadOverlay();

    this.loadingManager = new THREE.LoadingManager(() => {
      const overlay = document.getElementById('loading-overlay');
      if (overlay) {
        overlay.style.display = 'none';
      }
    });
    this.loadingManager.onProgress = (url, loaded, total) => {
      const loadingText = document.getElementById('loading-text');
      if (loadingText) {
        loadingText.textContent = `Loading ${Math.round((loaded / total) * 100)}%`;
      }
    };

    this.gltfLoader = new GLTFLoader(this.loadingManager);
    this.rgbeLoader = new RGBELoader(this.loadingManager);

    this.init();
    this.setupScene();
    this.setupLights();
    this.setupInitialControls();

    setupUIControls(this);

    this.setupSocketListeners();

    this.interactionManager = new InteractionManager(
      this.scene,
      this.camera,
      this.renderer,
      this.renderer.domElement
    );

    // Listen for pointer / touch events.
    window.addEventListener('pointermove', this.handlePointerMove.bind(this));

    this.animate();
  }

  handlePointerMove(event) {
    // Update normalized device coordinates for the pointer.
    this.pointerNDC.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointerNDC.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  /* --------------------------------------
     Overlay for Upload Progress
  ---------------------------------------*/
  createUploadOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'upload-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    overlay.style.color = 'white';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.fontSize = '24px';
    overlay.style.zIndex = '3000';
    overlay.textContent = 'Host is uploading a new product. Please wait.';
    document.body.appendChild(overlay);
    this.uploadOverlay = overlay;
  }

  showUploadOverlay() {
    if (this.uploadOverlay) {
      this.uploadOverlay.style.display = 'flex';
    }
  }

  hideUploadOverlay() {
    if (this.uploadOverlay) {
      this.uploadOverlay.style.display = 'none';
    }
  }

  /* --------------------------------------
     Create Loading Overlay for Startup
  ---------------------------------------*/
  createLoadingOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = '#cccccc';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '9999';
    overlay.innerHTML = `
      <div id="loading-spinner" style="
          border: 11px solid #d00024; 
          border-top: 11px solid #f3f3f3; 
          border-radius: 50%; 
          width: 84px; 
          height: 84px; 
          animation: spin 2s linear infinite;
      "></div>
      <div id="loading-text" style="color: #333; margin-top: 20px; font-size: 14px; font-family: sans-serif;">
          Loading...
      </div>
    `;
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
  }

  setupSocketListeners() {
    this.socket.on('host-transfer-request', (data) => {
      if (this.isHost) {
        showHostRequestModal(this, data, 30);
      }
    });

    this.socket.on('transfer-denied', (data) => {
      showConfirmationModal("Your request has been denied.");
      this.hostRequestPending = false;
      if (this.hostRequestTimer) {
        clearTimeout(this.hostRequestTimer);
        this.hostRequestTimer = null;
      }
    });

    this.socket.on('host-changed', (data) => {
      this.currentHostId = data.hostSocketId;
      this.isHost = data.hostSocketId ? (data.hostSocketId === this.socket.id) : false;
      console.log("Host changed; new hostSocketId:", data.hostSocketId, "isHost:", this.isHost);
      this.hostRequestPending = false;
      if (this.hostRequestTimer) {
        clearTimeout(this.hostRequestTimer);
        this.hostRequestTimer = null;
      }
      
      if (this.toggleUI) {
        updateToggleUI(this, this.toggleUI.viewerButton, this.toggleUI.hostButton, this.isHost);
      }
      
      if (this.isHost) {
        showConfirmationModal("You're now the host.");
      }
    });

    this.socket.on('product-upload-complete', async (data) => {
      console.log("Received complete product upload:", data);
      this.showUploadOverlay();
      if (!this.isHost) {
        this.clearExistingModels();
      }
      const loadPromises = data.parts.map((part) => {
        if (!this.loadedModels.has(part.name)) {
          return this.loadModel(part.url, part.name);
        } else {
          return Promise.resolve();
        }
      });
      try {
        await Promise.all(loadPromises);
      } catch (error) {
        console.error("Error loading parts:", error);
      }
      this.hideUploadOverlay();
    });

    this.socket.on('model-transform', (modelState) => {
      if (!this.isHost) {
        const object = this.loadedModels.get(modelState.customId);
        if (object) {
          object.position.fromArray(modelState.position);
          object.rotation.fromArray(modelState.rotation);
          object.scale.fromArray(modelState.scale);
        } else {
          console.log(`No matching model found for customId: ${modelState.customId}`);
        }
      }
    });

    this.socket.on('camera-update', (cameraState) => {
      if (!this.isHost) {
        this.camera.position.fromArray(cameraState.position);
        this.camera.rotation.fromArray(cameraState.rotation);
        if (this.orbitControls) {
          this.orbitControls.target.fromArray(cameraState.target);
          this.orbitControls.update();
        }
      }
    });

    // --- Pointer event listeners ---
    this.socket.on('host-pointer-toggle', (data) => {
      if (!this.isHost) {
        if (data.active) {
          if (!this.viewerPointer) {
            const pointerRadius = 0.005; // Same reduced size.
            const redMesh = new THREE.Mesh(
              new THREE.SphereGeometry(pointerRadius, 16, 16),
              new THREE.MeshBasicMaterial({ color: 0xff0000 })
            );
            const outlineMesh = redMesh.clone();
            outlineMesh.material = new THREE.MeshBasicMaterial({
              color: 0xffffff,
              side: THREE.BackSide
            });
            outlineMesh.scale.multiplyScalar(1.2); // Thicker white stroke.
            const pointerGroup = new THREE.Group();
            pointerGroup.add(outlineMesh);
            pointerGroup.add(redMesh);
      
            this.viewerPointer = pointerGroup;
            this.scene.add(this.viewerPointer);
          }
        } else {
          if (this.viewerPointer) {
            this.scene.remove(this.viewerPointer);
            this.viewerPointer = null;
          }
        }
      }
    });

    this.socket.on('host-pointer-update', (data) => {
      if (!this.isHost && this.viewerPointer) {
        this.viewerPointer.position.fromArray(data.position);
      }
    });
  }

  onWindowResize() {
    if (this.camera && this.renderer) {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  init() {
    this.container = document.getElementById('scene-container');
    this.scene = new THREE.Scene();
    this.productGroup = new THREE.Group();
    this.scene.add(this.productGroup);
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 0, 3);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.xr.enabled = true;
    this.container.appendChild(this.renderer.domElement);
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  setupScene() {
    this.scene.background = new THREE.Color(0xcccccc);
    this.rgbeLoader.load(
      'https://raw.githubusercontent.com/kool-ltd/product-viewer/main/assets/brown_photostudio_02_4k.hdr',
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.environment = texture;
        this.renderer.physicallyCorrectLights = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.7;
        this.renderer.outputEncoding = THREE.sRGBEncoding;
      }
    );
  }

  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    this.scene.add(directionalLight);
  }

  setupInitialControls() {
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.addEventListener('change', () => {
      if (this.isHost) {
        const cameraState = {
          position: this.camera.position.toArray(),
          rotation: this.camera.rotation.toArray(),
          target: this.orbitControls.target.toArray()
        };
        this.socket.emit('camera-update', cameraState);
      }
    });
    this.dragControls = new DragControls(this.draggableObjects, this.camera, this.renderer.domElement);
    this.dragControls.enabled = true;
    this.setupControlsEventListeners();
    this.renderer.domElement.addEventListener('touchstart', () => {});
  }

  setupControlsEventListeners() {
    this.dragControls.addEventListener('dragstart', () => {
      this.orbitControls.enabled = false;
      this.isDragging = true;
    });
    this.dragControls.addEventListener('dragend', () => {
      this.orbitControls.enabled = true;
      this.isDragging = false;
    });
    this.dragControls.addEventListener('drag', (event) => {
      const object = event.object;
      if (object.userData.originalScale) {
        object.scale.copy(object.userData.originalScale);
      }
      if (this.isHost) {
        const modelState = {
          customId: object.name,
          position: object.position.toArray(),
          rotation: object.rotation.toArray(),
          scale: object.scale.toArray()
        };
        this.socket.emit('model-transform', modelState);
      }
    });
  }

  updateDragControls() {
    const draggableObjects = Array.from(this.loadedModels.values());
    if (this.dragControls) {
      this.dragControls.dispose();
    }
    this.dragControls = new DragControls(draggableObjects, this.camera, this.renderer.domElement);
    this.setupControlsEventListeners();
  }

  clearExistingModels() {
    this.loadedModels.forEach((model) => {
      this.productGroup.remove(model);
    });
    this.loadedModels.clear();
    this.draggableObjects.length = 0;
    this.updateDragControls();
    if (this.isHost) {
      this.socket.emit('models-cleared');
    }
  }

  loadModel(url, name) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          const container = new THREE.Group();
          container.name = name;
          container.userData.isDraggable = true;
          container.add(model);
          container.raycast = function (raycaster, intersects) {
            const box = new THREE.Box3().setFromObject(container);
            if (!box.isEmpty()) {
              const intersectionPoint = new THREE.Vector3();
              if (raycaster.ray.intersectBox(box, intersectionPoint)) {
                const distance = raycaster.ray.origin.distanceTo(intersectionPoint);
                intersects.push({
                  distance: distance,
                  point: intersectionPoint.clone(),
                  object: container
                });
              }
            }
          };
          this.draggableObjects.push(container);
          this.productGroup.add(container);
          this.loadedModels.set(name, container);
          this.updateDragControls();
          this.interactionManager.setDraggableObjects(Array.from(this.loadedModels.values()));
          this.fitCameraToScene();
          console.log(`Loaded model: ${name}`);
          resolve(container);
        },
        (xhr) => {
          console.log(`${name} ${(xhr.loaded / xhr.total * 100).toFixed(2)}% loaded`);
        },
        (error) => {
          console.error(`Error loading model ${name}:`, error);
          reject(error);
        }
      );
    });
  }

  fitCameraToScene() {
    const box = new THREE.Box3().setFromObject(this.productGroup);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / Math.tan(fov / 2));
    cameraZ *= 1.2;
    this.camera.position.set(center.x, center.y, center.z + cameraZ);
    this.orbitControls.target.copy(center);
    this.camera.updateProjectionMatrix();
    this.orbitControls.update();
  }

  async loadDefaultProduct() {
    const parts = [
      { name: 'blade', file: 'kool-mandoline-blade.glb' },
      { name: 'frame', file: 'kool-mandoline-frame.glb' },
      { name: 'handguard', file: 'kool-mandoline-handguard.glb' },
      { name: 'handle', file: 'kool-mandoline-handletpe.glb' }
    ];
    this.clearExistingModels();
    for (const part of parts) {
      await new Promise((resolve, reject) => {
        this.gltfLoader.load(
          `assets/${part.file}`,
          (gltf) => {
            const model = gltf.scene;
            const container = new THREE.Group();
            container.name = part.name;
            container.userData.isDraggable = true;
            container.add(model);
            container.raycast = function (raycaster, intersects) {
              const box = new THREE.Box3().setFromObject(container);
              if (!box.isEmpty()) {
                const intersectionPoint = new THREE.Vector3();
                if (raycaster.ray.intersectBox(box, intersectionPoint)) {
                  const distance = raycaster.ray.origin.distanceTo(intersectionPoint);
                  intersects.push({
                    distance: distance,
                    point: intersectionPoint.clone(),
                    object: container
                  });
                }
              }
            };
            this.draggableObjects.push(container);
            this.productGroup.add(container);
            this.loadedModels.set(part.name, container);
            this.updateDragControls();
            this.interactionManager.setDraggableObjects(Array.from(this.loadedModels.values()));
            this.fitCameraToScene();
            if (this.isHost) {
              this.socket.emit('model-loaded', { url: `assets/${part.file}`, name: part.name });
            }
            resolve();
          },
          undefined,
          (error) => {
            console.error(`Error loading model ${part.file}:`, error);
            reject(error);
          }
        );
      });
    }
    setTimeout(() => {
      this.interactionManager.setDraggableObjects(Array.from(this.loadedModels.values()));
    }, 1000);
  }

  animate() {
    this.renderer.setAnimationLoop(() => {
      if (!this.isDragging) {
        this.orbitControls.update();
      }
      this.interactionManager.update();

      // --- Host Pointer Update Logic ---
      // If the pointer is active and the client is host, update its position.
      if (this.isHost && this.pointerActive && this.hostPointer) {
        const raycaster = new THREE.Raycaster();
        if (this.renderer.xr && this.renderer.xr.isPresenting && this.interactionManager && this.interactionManager.controller1) {
          // If in XR mode, use the first controller's direction.
          const controller = this.interactionManager.controller1;
          const matrix = new THREE.Matrix4();
          matrix.extractRotation(controller.matrixWorld);
          const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(matrix);
          raycaster.set(controller.position, direction);
        } else {
          // Otherwise, use the latest mouse/touch pointer position.
          raycaster.setFromCamera(this.pointerNDC, this.camera);
        }
        const intersects = raycaster.intersectObjects(this.productGroup.children, true);
        if (intersects.length > 0) {
          const pointerPosition = intersects[0].point;
          this.hostPointer.position.copy(pointerPosition);
          this.socket.emit('host-pointer-update', { position: pointerPosition.toArray() });
        }
      }
      this.renderer.render(this.scene, this.camera);
    });
  }
}

const app = new App();
app.loadDefaultProduct();

export default app;