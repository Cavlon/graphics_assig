import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {NURBSSurface} from 'three/addons/curves/NURBSSurface.js';
import {ParametricGeometry} from 'three/addons/geometries/ParametricGeometry.js';
import {SimplexNoise} from 'three/addons/math/SimplexNoise.js';
import Stats from 'three/addons/libs/stats.module.js';

////////////////////////////////////////////////////////////////////////////
// SETUP
////////////////////////////////////////////////////////////////////////////
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

let stats = new Stats();
stats.showPanel(0); // Panels: 0: FPS, 1: MS (Latency), 2: MB (Memory)
document.body.appendChild(stats.dom);

const COLOURS = {
    WHITE: 0xffffff,
    DEBUG_RED: 0xff0000,
    DEBUG_ORANGE: 0xf2ad0d,
    DEBUG_YELLOW: 0xe4eb70,
    TREE_BROWN: 0x8b4513,
    LEAF_GREEN: 0x2e8b57,
    GRASS_LIGHT: 0x2ecc71,
    DIRT_BROWN: 0x795548,
    SKY_BLUE: 0x87ceeb,
}

const STATE = {
    wireframe: false,
    show_points: false,
    show_chunks: false,
}

////////////////////////////////////////////////////////////////////////////
// INPUT
////////////////////////////////////////////////////////////////////////////
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.05;

window.addEventListener('keydown', (event) => {
    switch (event.key) {
        case 'x': 
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
            break;
        case 'z':
            STATE.show_chunks = !STATE.show_chunks;

            for (let i = 0; i < TERRAIN_CONFIG.chunks.length; i++) {
                let orangeMat = new THREE.MeshStandardMaterial({color: COLOURS.DEBUG_ORANGE, side: THREE.BackSide, wireframe: STATE.wireframe});
                let yellowMat = new THREE.MeshStandardMaterial({color: COLOURS.DEBUG_YELLOW, side: THREE.BackSide, wireframe: STATE.wireframe});

                orangeMat.color.set(COLOURS.DEBUG_ORANGE);
                yellowMat.color.set(COLOURS.DEBUG_YELLOW);

                TERRAIN_CONFIG.chunks[i].levels.forEach(level => {
                    const obj = level.object;

                    if (STATE.show_chunks) {
                        if (i % 2 == 0) {
                            obj.material = orangeMat;
                        } else {
                            obj.material = yellowMat;
                        }
                    } else {
                        obj.material = grassMat;
                    }
                })
            }
            break;
        case 'r':
            while(scene.children.length > 0){ 
                scene.remove(scene.children[0]); 
            }
            init();
    }
})

camera.position.set(0, 20, 50);
camera.lookAt(scene.position);

////////////////////////////////////////////////////////////////////////////
// UTILITY
////////////////////////////////////////////////////////////////////////////
const camWorldPos = new THREE.Vector3();
const objWorldPos = new THREE.Vector3();

function updateLOD(obj) {
    const levels = obj.levels;
    const numLevels = levels.length;

    camera.getWorldPosition(camWorldPos);
    obj.getWorldPosition(objWorldPos);

    const sqrDis = objWorldPos.distanceToSquared(camWorldPos);

    levels[0].object.visible = true;

    let i = 1;

    for (; i < numLevels; i++) {

        let levelDistance = levels[i].distance;

        if (sqrDis >= levelDistance) {
            levels[i-1].object.visible = false;
            levels[i].object.visible = true;
        } else {
            break;
        }
    }

    obj._currentlevel = i-1;
    for (; i < numLevels; i++) {
        levels[i].object.visible = false;
    }
}

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

function generateChunkControlPoints(heightData, globalXOffset, globalZOffset, weightScale, noise, minHeight=-4, maxHeight=4, pushPoints = true) {
    /*
        Uses heightmap data to create control points for a chunk with the given heights
    */
    const chunkControlPoints = []
    for (let i = 0; i < TERRAIN_CONFIG.chunkDim; i++) {
        const row = [];
        const xOffset = globalXOffset + i

        for (let j = 0; j < TERRAIN_CONFIG.chunkDim; j++) {
            const zOffset = j + globalZOffset

            // find the index of the corresponding heightmap pixel
            const ind = (xOffset + zOffset * TERRAIN_CONFIG.mapDim) * 4;

            // find how high this pixel is
            const heightRatio = heightData[ind] / 255;

            const weight = 1 + heightRatio * weightScale;
        
            const x = i;
            const z = j;

            // interpolate the height of this control point using the ratio
            const y = (minHeight + (maxHeight - minHeight) * heightRatio) + noise.noise(xOffset * 0.07, zOffset * 0.07) * 1;
            
            const point = new THREE.Vector4(x, y, z, weight);
            row.push(point);
            if (pushPoints) TERRAIN_CONFIG.controlPoints.push(point);
        }
        chunkControlPoints.push(row);
    }
    return chunkControlPoints;
}

function generateTerrainMesh(data, knots, noise, pushPoints=true, tearBlock=false) {
    /*
        Generates the terrain mesh as a parametric b-spline surface from a heightmap
    */
    const terrain = new THREE.Group();

    // create each chunk
    for (let z = 0; z < TERRAIN_CONFIG.chunkCount; z++) {
        const zOffset = z * (TERRAIN_CONFIG.chunkDim - 3);
        for (let x = 0; x < TERRAIN_CONFIG.chunkCount; x++) {
            const xOffset = x * (TERRAIN_CONFIG.chunkDim - 3);

            // generate the chunk's control points according to the heightmap
            const chunkControlPoints = generateChunkControlPoints(data, xOffset, zOffset, 1, noise, -10, 8, pushPoints);

            // create the parametric suface according to the control points
            const nurbsSurface = new NURBSSurface(TERRAIN_CONFIG.degree, TERRAIN_CONFIG.degree, knots, knots, chunkControlPoints);
            const lod = new THREE.LOD();

            if (tearBlock) {
                // add the low res terrain under the main terrain to catch tears
                const culledChunk = new THREE.Object3D();
                lod.addLevel(culledChunk, 0);

                const geometry = new ParametricGeometry((u, v, target) => mapInternalSurface(u, v, target, nurbsSurface, knots[TERRAIN_CONFIG.degree], knots[TERRAIN_CONFIG.chunkDim]), 4, 4)

                // create rings of visible chunks around boundaries and cull the others since they won't be visible
                for (let i = 1; i < TERRAIN_CONFIG.lod_levels.length; i++) {
                    const chunk = new THREE.Mesh(geometry, grassMat);
                    lod.addLevel(chunk, TERRAIN_CONFIG.lod_levels[i][1]);
                    lod.addLevel(culledChunk, TERRAIN_CONFIG.lod_levels[i][1]+3000);
                }
            } else {
                // create all the levels of detail
                for (let i = 0; i < TERRAIN_CONFIG.lod_levels.length; i++) {
                    const geometry = new ParametricGeometry((u, v, target) => mapInternalSurface(u, v, target, nurbsSurface, knots[TERRAIN_CONFIG.degree], knots[TERRAIN_CONFIG.chunkDim]), TERRAIN_CONFIG.lod_levels[i][0], TERRAIN_CONFIG.lod_levels[i][0])
                    const chunk = new THREE.Mesh(geometry, grassMat);
                    lod.addLevel(chunk, TERRAIN_CONFIG.lod_levels[i][1]);
                }
                TERRAIN_CONFIG.chunks.push(lod);
            }

            lod.autoUpdate = false;

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

const TERRAIN_CONFIG = {
    heightmap: 'heightmap4.png',
    mapDim: 259,
    chunkCount: 16,
    chunkDim: 8,
    degree: 3,
    terrainScale: 1,
    lod_levels: [[25, 0], [15, 1500], [10, 4500]],
    controlPoints: [],
    chunks: [],
}

const grassMat = new THREE.MeshStandardMaterial({color: COLOURS.GRASS_LIGHT, side: THREE.BackSide});
let controlPointsMesh;

// load the heightmap and process it
function processHeightmap() {
    const imgLoader = new THREE.ImageLoader();
    imgLoader.load(TERRAIN_CONFIG.heightmap, (image) => generateTerrain(image));
}

function generateTerrain(heightmap) {
    /*
        Generates the terrain
    */
    // extract the pixel data from the heightmap
    const ctx = document.createElement('canvas').getContext('2d');
    const {width: width, height} = heightmap;
    ctx.canvas.width = width;
    ctx.canvas.height = height;
    ctx.drawImage(heightmap, 0, 0);
    const {data} = ctx.getImageData(0, 0, width, height);

    TERRAIN_CONFIG.mapDim = width;

    TERRAIN_CONFIG.controlPoints = [];
    TERRAIN_CONFIG.chunks = [];

    // round the number of chunks per axis to the nearest factor of the map size-3
    while ((TERRAIN_CONFIG.mapDim-3) % TERRAIN_CONFIG.chunkCount > 0) {
        if (TERRAIN_CONFIG.chunkCount == 1) break;
        TERRAIN_CONFIG.chunkCount--;
    }

    // calculate the necessary chunk dimension so the number of points matches the map size
    TERRAIN_CONFIG.chunkDim = ((TERRAIN_CONFIG.mapDim-3)/TERRAIN_CONFIG.chunkCount)+3;

    // generate the b-spline knots
    const knots = generateKnots(TERRAIN_CONFIG.degree, TERRAIN_CONFIG.chunkDim);

    const noise = new SimplexNoise();

    // generate the terrain mesh
    const terrain = generateTerrainMesh(data, knots, noise);
    terrain.position.set(-(TERRAIN_CONFIG.mapDim)/2, 0, -(TERRAIN_CONFIG.mapDim)/2);
    terrain.scale.setScalar(TERRAIN_CONFIG.terrainScale);
    scene.add(terrain);

    terrain.traverse((object) => {
        if (object.isMesh || object.isLOD) {
            object.matrixAutoUpdate = false;
            object.updateMatrix();
        }
    });

    // the lods cause tearing so a low resolution version of the terrain is added underneath to visually hide tears
    const tearBlock = generateTerrainMesh(data, knots, noise, false, true);
    tearBlock.position.set(-(TERRAIN_CONFIG.mapDim)/2, -1.5, -(TERRAIN_CONFIG.mapDim)/2);
    tearBlock.scale.setScalar(TERRAIN_CONFIG.terrainScale);
    scene.add(tearBlock);

    tearBlock.traverse((object) => {
        if (object.isMesh || object.isLOD) {
            object.matrixAutoUpdate = false;
            object.updateMatrix();
        }
    });

    // visualise the control points for debugging
    controlPointsMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 3, 2), new THREE.MeshStandardMaterial({color: COLOURS.DEBUG_RED}), TERRAIN_CONFIG.controlPoints.length);
    controlPointsMesh.position.set(-TERRAIN_CONFIG.mapDim/2, 0, -TERRAIN_CONFIG.mapDim/2);
    controlPointsMesh.visible = STATE.show_points;

    // set the positions for each control point
    const dummy = new THREE.Object3D();
    let ind = 0
    for (let z = 0; z < TERRAIN_CONFIG.chunkCount; z++) {
        const zOffset = z * (TERRAIN_CONFIG.chunkDim - 3);
        for (let x = 0; x < TERRAIN_CONFIG.chunkCount; x++) {
            const xOffset = x * (TERRAIN_CONFIG.chunkDim - 3);
            for (let i = 0; i < TERRAIN_CONFIG.chunkDim; i++) {
                for (let j = 0; j < TERRAIN_CONFIG.chunkDim; j++) {
                    const p = TERRAIN_CONFIG.controlPoints[ind];

                    dummy.position.set((p.x + xOffset)*TERRAIN_CONFIG.terrainScale, p.y*TERRAIN_CONFIG.terrainScale, (p.z+zOffset)*TERRAIN_CONFIG.terrainScale);
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
// EFFECTS & LIGHTING
////////////////////////////////////////////////////////////////////////////
function addBaseLight() {
    const sun = new THREE.DirectionalLight(COLOURS.WHITE, 1.5);
    sun.position.set(50, 100, 50);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x606060));
}

scene.background = new THREE.Color(COLOURS.SKY_BLUE);
scene.fog = new THREE.FogExp2(0x87CEEB, 0.007); 

////////////////////////////////////////////////////////////////////////////
// MAIN
////////////////////////////////////////////////////////////////////////////

function init() {
    processHeightmap();
    addBaseLight();
}

let frame = 0;
function animate() {
    requestAnimationFrame(animate);
    stats.begin();

    orbitControls.update();

    if (frame % 20 == 0) {
        scene.traverse((object) => {
            if (object.isLOD) {
                updateLOD(object);
            }
        });
        frame = 0;
    }
    frame++;

    renderer.render(scene, camera);
    stats.end();
}

init();
animate();