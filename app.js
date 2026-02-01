import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {NURBSSurface} from 'three/addons/curves/NURBSSurface.js';
import {ParametricGeometry} from 'three/addons/geometries/ParametricGeometry.js';

////////////////////////////////////////////////////////////////////////////
// SETUP
////////////////////////////////////////////////////////////////////////////
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const COLORS = {
    WHITE: 0xffffff,
    DEBUG_RED: 0xff0000,
    TREE_BROWN: 0x8b4513,
    LEAF_GREEN: 0x2e8b57,
    GRASS_LIGHT: 0x2ecc71,
    SKY_BLUE: 0x87ceeb,
}

const STATE = {
    wireframe: false,
    show_points: false,
}

////////////////////////////////////////////////////////////////////////////
// CAMERA
////////////////////////////////////////////////////////////////////////////
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.05;

const controls = {
    moveSpeed: 1,
    direction: {left: false, right: false, forward: false, backward: false, up: false, down: false},
}

window.addEventListener('keydown', (event) => {
    switch (event.key) {
        case 'a': controls.direction.left = true; break;
        case 'd': controls.direction.right = true; break;
        case 'w': controls.direction.forward = true; break;
        case 's': controls.direction.backward = true; break;
        case 'e': controls.direction.up = true; break;
        case 'q': controls.direction.down = true; break;
        case 'p': 
            STATE.wireframe = !STATE.wireframe;
            scene.traverse((object) => {
                if (object instanceof THREE.Mesh) {
                    if (object.material) {
                        object.material.wireframe = STATE.wireframe;
                    }
                }
            });
            break;
        case 'c':
            STATE.show_points = !STATE.show_points;
            controlPointsMesh.visible = STATE.show_points;
    }
})

window.addEventListener('keyup', (event) => {
    switch (event.key) {
        case 'a': controls.direction.left = false; break;
        case 'd': controls.direction.right = false; break;
        case 'w': controls.direction.forward = false; break;
        case 's': controls.direction.backward = false; break;
        case 'e': controls.direction.up = false; break;
        case 'q': controls.direction.down = false; break;
    }
})

function updateCamera() {
    if (controls.direction.left) camera.position.x -= controls.moveSpeed;
    if (controls.direction.right) camera.position.x += controls.moveSpeed;
    if (controls.direction.forward) camera.position.z -= controls.moveSpeed;
    if (controls.direction.backward) camera.position.z += controls.moveSpeed;
    if (controls.direction.up) camera.position.y += controls.moveSpeed;
    if (controls.direction.down) camera.position.y -= controls.moveSpeed;
    orbitControls.update();
}

camera.position.set(0, 20, 50);
camera.lookAt(scene.position);

////////////////////////////////////////////////////////////////////////////
// TERRAIN
////////////////////////////////////////////////////////////////////////////
function generateKnots(degree, numPoints) {
    /*
        Generates unclamped knots, taken from lecture example code
    */
    const n = numPoints - 1;
    const p = degree;
    const knots = [];

    const len = n + p + 2;
    for(let i=0; i<len; i++) knots.push(i / (len - 1));

    return knots;
}

function generateChunkControlPoints(dimension, heightData, mapDim, globalXOffset, globalZOffset, weightScale, minHeight=-4, maxHeight=4, pushPoints = true) {
    /*
        Uses heightmap data to create control points for a chunk with the given heights
    */
    const chunkControlPoints = []
    for (let i = 0; i < dimension; i++) {
        const row = [];
        const xOffset = globalXOffset + i

        for (let j = 0; j < dimension; j++) {
            const zOffset = j + globalZOffset

            // find the index of the corresponding heightmap pixel
            const ind = (xOffset + zOffset * mapDim) * 4;

            // find how high this pixel is
            const heightRatio = heightData[ind] / 255;

            const weight = 1 + heightRatio * weightScale;
        
            const x = i;
            const y = minHeight + (maxHeight - minHeight) * heightRatio;    // interpolate the height of this control point using the ratio
            const z = j;
            
            const point = new THREE.Vector4(x, y, z, weight);
            row.push(point);
            if (pushPoints) controlPoints.push(point);
        }
        chunkControlPoints.push(row);
    }
    return chunkControlPoints;
}

function generateTerrainMesh(data, degree, chunkDim, mapDim, knots, lods, pushPoints=true) {
    /*
        Generates the terrain mesh as a parametric b-spline surface from a heightmap
    */
    const material = new THREE.MeshStandardMaterial({ color: COLORS.GRASS_LIGHT, side: THREE.BackSide});
    const terrain = new THREE.Group();

    // create each chunk
    for (let z = 0; z < chunkCount; z++) {
        const zOffset = z * (chunkDim - 3);
        for (let x = 0; x < chunkCount; x++) {
            const xOffset = x * (chunkDim - 3);

            // generate the chunk's control points according to the heightmap
            const chunkControlPoints = generateChunkControlPoints(chunkDim, data, mapDim, xOffset, zOffset, 1, -2, 5, pushPoints);

            // create the parametric suface according to the control points
            const nurbsSurface = new NURBSSurface(degree, degree, knots, knots, chunkControlPoints);
            const lod = new THREE.LOD();

            // create all the levels of detail
            for (let i = 0; i < lods.length; i++) {
                const geometry = new ParametricGeometry((u, v, target) => mapInternalSurface(u, v, target, nurbsSurface, knots[degree], knots[chunkDim]), lods[i][0], lods[i][0])
                const chunk = new THREE.Mesh(geometry, material);
                lod.addLevel(chunk, lods[i][1]);
            }

            // position the chunk
            lod.position.set(xOffset, 0, zOffset);
            terrain.add(lod);
        }
    }
    return terrain;
}



function mapInternalSurface(u, v, target, surface, startT, endT) {
    /*
        Only render the surface for the internal control points
    */
    const range = endT - startT;
    const newU = startT + (u * range);
    const newV = startT + (v * range);

    surface.getPoint(newU, newV, target);
}

// chunk count must be a factor of heightmap dimension-3
const chunkCount = 25;
const degree = 3;
const terrainScale = 1;

const controlPoints = [];
let controlPointsMesh;

// load the heightmap and process it
const imgLoader = new THREE.ImageLoader();
imgLoader.load('heightmap2.png', (image) => generateTerrain(image, degree, terrainScale));

function generateTerrain(heightmap, degree, scale=1) {
    /*
        Generates the terrain
    */
    // extract the pixel data from the heightmap
    const ctx = document.createElement('canvas').getContext('2d');
    const {width, height} = heightmap;
    ctx.canvas.width = width;
    ctx.canvas.height = height;
    ctx.drawImage(heightmap, 0, 0);
    const {data} = ctx.getImageData(0, 0, width, height);

    // calculate the necessary chunk dimension so the specified number of chunks can be made
    const chunkDim = ((width-3)/chunkCount)+3;

    // generate the b-spline knots
    const knots = generateKnots(degree, chunkDim);

    const meshWidth = ((chunkCount-1) * (chunkDim - 3)) + chunkDim - 1

    // generate the terrain mesh
    const terrain = generateTerrainMesh(data, degree, chunkDim, width, knots, [[15, 15], [5, 20], [3, 50]]);
    terrain.position.set(-(meshWidth)/2, 0, -(meshWidth)/2);
    terrain.scale.setScalar(scale);
    scene.add(terrain);

    // the lods cause tearing so a low resolution version of the terrain is added underneath to visually hide tears
    const gapBlock = generateTerrainMesh(data, degree, chunkDim, width, knots, [[1, 50]], false);
    gapBlock.position.set(-(meshWidth)/2, -2, -(meshWidth)/2);
    gapBlock.scale.setScalar(scale);
    scene.add(gapBlock);

    // visualise the control points for debugging
    controlPointsMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 3, 2), new THREE.MeshStandardMaterial({color: COLORS.DEBUG_RED}), controlPoints.length);
    controlPointsMesh.position.set(-meshWidth/2, 0, -meshWidth/2);
    controlPointsMesh.visible = STATE.show_points;

    // set the positions for each control point
    const dummy = new THREE.Object3D();
    let ind = 0
    for (let z = 0; z < chunkCount; z++) {
        const zOffset = z * (chunkDim - 3);
        for (let x = 0; x < chunkCount; x++) {
            const xOffset = x * (chunkDim - 3);
            for (let i = 0; i < chunkDim; i++) {
                for (let j = 0; j < chunkDim; j++) {
                    const p = controlPoints[ind];

                    dummy.position.set((p.x + xOffset)*scale, p.y*scale, (p.z+zOffset)*scale);
                    dummy.updateMatrix();

                    controlPointsMesh.setMatrixAt(ind, dummy.matrix);
                    ind++;
                }
            }
        }
    }

    scene.add(controlPointsMesh);
}

////////////////////////////////////////////////////////////////////////////
// MISC EFFECTS
////////////////////////////////////////////////////////////////////////////
const sun = new THREE.DirectionalLight(COLORS.WHITE, 1.5);
sun.position.set(50, 100, 50);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x606060));

scene.background = new THREE.Color(COLORS.SKY_BLUE);
scene.fog = new THREE.FogExp2(0x87CEEB, 0.005); 

////////////////////////////////////////////////////////////////////////////
// ANIMATION LOOP
////////////////////////////////////////////////////////////////////////////
function animate() {
    requestAnimationFrame(animate);
    updateCamera();

    scene.traverse((object) => {
        if (object instanceof THREE.LOD) {
            object.update(camera);
        }
    });

    renderer.render(scene, camera);
}

animate();