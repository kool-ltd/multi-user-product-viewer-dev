// uiControls.js

import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { showViewerRequestModal, showConfirmationModal } from './modalManager.js';

// Create the UI controls and attach them to the app.
export function setupUIControls(app) {
  // Initialize state variables for host requests.
  app.hostRequestPending = false;
  app.hostRequestTimer = null;
  app.currentHostId = null; // Set by the server when a host is active.
  // New pointer state variable.
  app.pointerActive = false;

  // Create a container for the controls.
  const controlsContainer = document.createElement('div');
  controlsContainer.style.position = 'fixed';
  controlsContainer.style.top = '10px';
  controlsContainer.style.left = '10px';
  controlsContainer.style.zIndex = '1000';
  controlsContainer.style.display = 'flex';
  controlsContainer.style.alignItems = 'center';
  controlsContainer.style.gap = '10px';

  // ------------------------------
  // Create the toggle buttons.
  // ------------------------------
  const toggleContainer = document.createElement('div');
  toggleContainer.style.display = 'inline-flex';
  toggleContainer.style.padding = '4px';
  toggleContainer.style.borderRadius = '9999px';
  toggleContainer.style.backgroundColor = '#d00024';

  // Create the Viewer button.
  const viewerButton = document.createElement('button');
  viewerButton.textContent = 'Viewer';
  viewerButton.style.padding = '5px 15px';
  viewerButton.style.border = 'none';
  viewerButton.style.outline = 'none';
  viewerButton.style.borderRadius = '9999px';
  viewerButton.style.cursor = 'pointer';
  viewerButton.style.transition = 'background-color 0.3s ease, color 0.3s ease';

  // Create the Host button.
  const hostButton = document.createElement('button');
  hostButton.textContent = 'Host';
  hostButton.style.padding = '5px 15px';
  hostButton.style.border = 'none';
  hostButton.style.outline = 'none';
  hostButton.style.borderRadius = '9999px';
  hostButton.style.cursor = 'pointer';
  hostButton.style.transition = 'background-color 0.3s ease, color 0.3s ease';

  // Set initial styling.
  updateToggleUI(app, viewerButton, hostButton, app.isHost);

  // ------------------------------
  // Define actions for the toggle buttons.
  // ------------------------------

  // Viewer button: if you are host click to give up host role.
  viewerButton.addEventListener('click', () => {
    if (app.isHost) {
      app.socket.emit('give-up-host');
    } else {
      if (app.hostRequestPending) {
        app.socket.emit('cancel-host-request');
        app.hostRequestPending = false;
        if (app.hostRequestTimer) {
          clearTimeout(app.hostRequestTimer);
          app.hostRequestTimer = null;
        }
        console.log("Host request cancelled.");
      } else {
        console.log("Already in viewer mode.");
      }
    }
  });

  // Host button: toggle to become host.
  hostButton.addEventListener('click', () => {
    if (app.isHost) {
      app.socket.emit('give-up-host');
    } else {
      if (!app.currentHostId) {
        console.log("No active host; becoming host immediately.");
        app.currentHostId = app.socket.id;
        app.isHost = true;
        updateToggleUI(app, viewerButton, hostButton, app.isHost);
        showConfirmationModal("You're now the host.");
        app.socket.emit('register-host');
      } else {
        if (!app.hostRequestPending) {
          app.hostRequestPending = true;
          app.socket.emit('request-host');
          showViewerRequestModal(app, 30);
          console.log("Host request modal shown.");
        } else {
          console.log("Host request is already pending.");
        }
      }
    }
  });

  toggleContainer.appendChild(viewerButton);
  toggleContainer.appendChild(hostButton);
  controlsContainer.appendChild(toggleContainer);

  // ------------------------------
  // Create an Upload button.
  // ------------------------------
  const uploadButton = document.createElement('button');
  uploadButton.textContent = 'Upload';
  uploadButton.style.padding = '8px 24px';
  uploadButton.style.border = 'none';
  uploadButton.style.outline = 'none';
  uploadButton.style.borderRadius = '9999px';
  uploadButton.style.backgroundColor = '#d00024';
  uploadButton.style.color = 'white';
  uploadButton.style.cursor = 'pointer';
  uploadButton.style.transition = 'background-color 0.3s ease, color 0.3s ease';
  
  uploadButton.addEventListener('mouseover', () => {
    uploadButton.style.backgroundColor = '#b0001d';
  });
  uploadButton.addEventListener('mouseout', () => {
    uploadButton.style.backgroundColor = '#d00024';
  });
  
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.glb,.gltf';
  fileInput.style.display = 'none';
  fileInput.multiple = true;
  fileInput.onchange = async (event) => {
    // Clear out any existing models.
    app.clearExistingModels();
    const files = event.target.files;
    for (let file of files) {
      const formData = new FormData();
      formData.append('model', file);
      try {
        const response = await fetch('/upload', {
          method: 'POST',
          headers: {
            'x-socket-id': app.socket.id,
            'x-uploader-role': app.isHost ? 'host' : 'viewer'
          },
          body: formData
        });
        if (response.ok) {
          const data = await response.json();
          // For hosts, skip local load and wait for the aggregated broadcast.
          if (!app.isHost) {
            const name = data.name.replace('.glb', '').replace('.gltf', '');
            app.loadModel(data.url, name);
          }
        } else {
          console.error("Upload failed:", response.statusText);
        }
      } catch (error) {
        console.error("File upload error:", error);
      }
    }
    if (app.isHost) {
      if (app._productUploadCompleteTimeout) {
        clearTimeout(app._productUploadCompleteTimeout);
      }
      app._productUploadCompleteTimeout = setTimeout(() => {
        app.socket.emit('product-upload-complete');
        app._productUploadCompleteTimeout = null;
      }, 500);
    }
  };
  
  uploadButton.onclick = () => fileInput.click();
  
  controlsContainer.appendChild(uploadButton);
  controlsContainer.appendChild(fileInput);
  
  // ------------------------------
  // Create an extra pointer toggle button.
  // ------------------------------
  // This button allows the host to toggle a pointer that broadcasts where they are pointing.
  // It is always added but only visible when app.isHost is true.
  const pointerToggleButton = document.createElement('button');
  pointerToggleButton.textContent = 'Pointer';
  pointerToggleButton.style.padding = '8px 24px';
  pointerToggleButton.style.border = 'none';
  pointerToggleButton.style.outline = 'none';
  pointerToggleButton.style.borderRadius = '9999px';
  pointerToggleButton.style.backgroundColor = '#d00024';
  pointerToggleButton.style.color = 'white';
  pointerToggleButton.style.cursor = 'pointer';
  pointerToggleButton.style.transition = 'background-color 0.3s ease, color 0.3s ease';
  // Set initial display based on host state.
  pointerToggleButton.style.display = app.isHost ? 'inline-block' : 'none';

  pointerToggleButton.addEventListener('click', () => {
    // Toggle pointer state on the host.
    app.pointerActive = !app.pointerActive;
    
    if (app.pointerActive) {
      // Change button style: red background with white text.
      pointerToggleButton.style.backgroundColor = '#ffffff';
      pointerToggleButton.style.color = '#d00024';
      
      // Create the pointer as a group of two spheres: a red dot and a white outline.
      if (!app.hostPointer) {
        const pointerRadius = 0.005; // Reduced size: 1/10 of the original 0.05
        // Create the red inner sphere.
        const redMesh = new THREE.Mesh(
          new THREE.SphereGeometry(pointerRadius, 16, 16),
          new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        // Create the white outline by cloning the red sphere,
        // setting its material to white with a backside render, and scaling it up.
        const outlineMesh = redMesh.clone();
        outlineMesh.material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          side: THREE.BackSide
        });
        outlineMesh.scale.multiplyScalar(1.5); // Increase scale for a thicker white stroke.
        
        // Group both meshes.
        const pointerGroup = new THREE.Group();
        pointerGroup.add(outlineMesh);
        pointerGroup.add(redMesh);
        
        app.hostPointer = pointerGroup;
        app.scene.add(app.hostPointer);
      }
    } else {
      // Change button style: white background with red text.
      pointerToggleButton.style.backgroundColor = '#d00024';
      pointerToggleButton.style.color = '#ffffff';
      
      if (app.hostPointer) {
        app.scene.remove(app.hostPointer);
        app.hostPointer = null;
      }
    }
    
    // Broadcast the current pointer toggle state to viewers.
    app.socket.emit('host-pointer-toggle', { active: app.pointerActive });
  });
  
  controlsContainer.appendChild(pointerToggleButton);

  // ------------------------------
  // Optional: AR Button (if supported).
  // ------------------------------
  if ('xr' in navigator) {
    const arButton = ARButton.createButton(app.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.body }
    });
    arButton.style.position = 'fixed';
    controlsContainer.appendChild(arButton);
  
    app.renderer.xr.addEventListener('sessionstart', () => {
      console.log("AR session started");
      app.isARMode = true;
      app.scene.background = null;
      app.renderer.setClearColor(0x000000, 0);
      if (app.isHost) {
        app.socket.emit('ar-session-start');
      }
    });
    app.renderer.xr.addEventListener('sessionend', () => {
      console.log("AR session ended");
      app.isARMode = false;
      app.scene.background = new THREE.Color(0xcccccc);
      app.renderer.setClearColor(0xcccccc, 1);
      if (app.isHost) {
        app.socket.emit('ar-session-end');
      }
    });
  }
  
  document.body.appendChild(controlsContainer);
  
  // Save references to the buttons.
  app.toggleUI = { viewerButton, hostButton, pointerToggleButton };
}

export function updateToggleUI(app, viewerButton, hostButton, isHost) {
  if (isHost) {
    hostButton.style.backgroundColor = 'white';
    hostButton.style.color = '#d00024';
    viewerButton.style.backgroundColor = 'transparent';
    viewerButton.style.color = 'white';
    if (app.toggleUI && app.toggleUI.pointerToggleButton) {
      app.toggleUI.pointerToggleButton.style.display = 'inline-block';
    }
  } else {
    viewerButton.style.backgroundColor = 'white';
    viewerButton.style.color = '#d00024';
    hostButton.style.backgroundColor = 'transparent';
    hostButton.style.color = 'white';
    if (app.toggleUI && app.toggleUI.pointerToggleButton) {
      app.toggleUI.pointerToggleButton.style.display = 'none';
    }
  }
}