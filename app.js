import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {NURBSSurface} from 'three/addons/curves/NURBSSurface.js';
import {ParametricGeometry} from 'three/addons/geometries/ParametricGeometry.js';
import {SimplexNoise} from 'three/addons/math/SimplexNoise.js';
import Stats from 'three/addons/libs/stats.module.js';
import {computeBoundsTree, disposeBoundsTree, acceleratedRaycast, BVHHelper} from 'three-mesh-bvh';

////////////////////////////////////////////////////////////////////////////
// SETUP
////////////////////////////////////////////////////////////////////////////
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

let stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const upVec = new THREE.Vector3(0, 1, 0);
let mapLoaded = false;

const COLOURS = {
    WHITE: 0xffffff,
    DEBUG_RED: 0xff0000,
    DEBUG_ORANGE: 0xf2ad0d,
    DEBUG_YELLOW: 0xe4eb70,
    TREE_BROWN: 0x8D6E63,
    LEAF_GREEN: 0x7CB342,
    GRASS_GREEN: 0x6ba659,
    DIRT_BROWN: 0x795548,
    BUILDING_BEIGE: 0xD3BC8D,
    BUILDING_GREY: 0xd6e1e9,
    ROOF_GREY: 0xA7ACA2,
    ROOF_BEIGE: 0xA7ACA2,
    WATER_BLUE: 0x5998a6,
    SKY_BLUE: 0x87ceeb,
}

const STATE = {
    show_wireframe: false,
    show_points: false,
    show_chunks: false,
    show_bvh: false,
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
            STATE.show_wireframe = !STATE.show_wireframe;
            scene.traverse((object) => {
                if (object instanceof THREE.Mesh) {
                    if (object.material) {
                        object.material.wireframe = STATE.show_wireframe;
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

            for (let i = 0; i < MAP_CONFIG.chunks.length; i++) {
                let orangeMat = new THREE.MeshLambertMaterial({color: COLOURS.DEBUG_ORANGE, side: THREE.BackSide, wireframe: STATE.show_wireframe});
                let yellowMat = new THREE.MeshLambertMaterial({color: COLOURS.DEBUG_YELLOW, side: THREE.BackSide, wireframe: STATE.show_wireframe});

                orangeMat.color.set(COLOURS.DEBUG_ORANGE);
                yellowMat.color.set(COLOURS.DEBUG_YELLOW);

                MAP_CONFIG.chunks[i].levels.forEach(level => {
                    const obj = level.object;

                    if (STATE.show_chunks) {
                        let colInd = 0;
                        if (i % 2 == 0) colInd = 1;
                        if (Math.floor(i/MAP_CONFIG.chunkCount) % 2 == 0) colInd = (colInd + 1) % 2
                        if (colInd == 0) {
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
            mapLoaded = false;
            init();
            break;
        case 'b':
            STATE.show_bvh = !STATE.show_bvh;
            octree.visible = STATE.show_bvh;
            break;
    }
})

camera.position.set(0, 20, 50);
camera.lookAt(scene.position);

let octree;

////////////////////////////////////////////////////////////////////////////
// UTILITY
////////////////////////////////////////////////////////////////////////////
const tempVec = new THREE.Vector3();
const tempVec2 = new THREE.Vector3();
const dummy = new THREE.Object3D();

const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;

function updateChunks() {
    /*
        Updates the lods of each chunk and sets tear block visibility
    */
    for (let i = 0; i < MAP_CONFIG.chunks.length; i++) {
        const chunk = MAP_CONFIG.chunks[i];
        MAP_CONFIG.tearBlocks[i].visible = false;

        const levels = chunk.levels;
        const numLevels = levels.length;

        chunk.getWorldPosition(tempVec);
        const sqrDis = tempVec.distanceToSquared(camera.position);

        MAP_CONFIG.chunkDists[i] = sqrDis;

        levels[0].object.visible = true;

        let j = 1;
        for (; j < numLevels; j++) {

            let levelDistance = levels[j].distance;

            if (sqrDis > levelDistance) {
                levels[j-1].object.visible = false;
                levels[j].object.visible = true;
                if (sqrDis < levelDistance + 5000) {
                    MAP_CONFIG.tearBlocks[i].visible = true;
                }
            } else {
                break;
            }
        }

        for (; j < numLevels; j++) {
            levels[j].object.visible = false;
        }
    }
}

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

function posToChunk(position) {
    /*
        Returns the chunk index for a given position on the map
    */
    const xInd = Math.floor((Math.min(Math.max(position.x, 1), MAP_CONFIG.mapDim-2.1)-1) / (MAP_CONFIG.chunkDim-3));
    const zInd = Math.floor((Math.min(Math.max(position.z, 1), MAP_CONFIG.mapDim-2.1)-1) / (MAP_CONFIG.chunkDim-3));
    return zInd*MAP_CONFIG.chunkCount + xInd;
}

////////////////////////////////////////////////////////////////////////////
// MAP
////////////////////////////////////////////////////////////////////////////

function generateChunkControlPoints(heightData, globalXOffset, globalZOffset, weightScale, noise, minHeight=-4, maxHeight=4, pushPoints = true) {
    /*
        Uses heightmap data to create control points for a chunk with the given heights
    */
    const chunkControlPoints = []
    for (let i = 0; i < MAP_CONFIG.chunkDim; i++) {
        const row = [];
        const xOffset = globalXOffset + i

        for (let j = 0; j < MAP_CONFIG.chunkDim; j++) {
            const zOffset = j + globalZOffset

            // find the index of the corresponding heightmap pixel
            const ind = (xOffset + zOffset * MAP_CONFIG.mapDim) * 4;

            // find how high this pixel is
            const heightRatio = heightData[ind] / 255;

            const weight = 1 + heightRatio * weightScale;
        
            const x = i;
            const z = j;

            // interpolate the height of this control point using the ratio and add noise
            const y = (minHeight + (maxHeight - minHeight) * heightRatio) + noise.noise(xOffset * MAP_CONFIG.terrainNoiseFreq, zOffset * MAP_CONFIG.terrainNoiseFreq) * MAP_CONFIG.terrainNoiseScale;
            
            const point = new THREE.Vector4(x, y, z, weight);
            row.push(point);
            if (pushPoints) MAP_CONFIG.controlPoints.push(point);
        }
        chunkControlPoints.push(row);
    }
    return chunkControlPoints;
}

function generateTerrain(data, knots, noise, pushPoints=true, tearBlock=false) {
    /*
        Generates the terrain mesh as a series of parametric b-spline surfaces from a heightmap
    */
    const terrain = new THREE.Group();

    // create each chunk
    for (let z = 0; z < MAP_CONFIG.chunkCount; z++) {
        const zOffset = z * (MAP_CONFIG.chunkDim - 3);
        for (let x = 0; x < MAP_CONFIG.chunkCount; x++) {
            const xOffset = x * (MAP_CONFIG.chunkDim - 3);

            // generate the chunk's control points according to the heightmap
            const chunkControlPoints = generateChunkControlPoints(data, xOffset, zOffset, 1, noise, -10, 8, pushPoints);

            // create the parametric suface according to the control points
            const nurbsSurface = new NURBSSurface(MAP_CONFIG.degree, MAP_CONFIG.degree, knots, knots, chunkControlPoints);

            if (tearBlock) {
                // add the low res terrain under the main terrain to catch tears
                const geometry = new ParametricGeometry((u, v, target) => mapInternalSurface(u, v, target, nurbsSurface, knots[MAP_CONFIG.degree], knots[MAP_CONFIG.chunkDim]), 3, 3)
                const chunk = new THREE.Mesh(geometry, grassMat);
                MAP_CONFIG.tearBlocks.push(chunk);

                // position the chunk
                chunk.position.set(xOffset, -1.5, zOffset);
                chunk.updateMatrixWorld(true);
                terrain.add(chunk);
            } else {
                const lod = new THREE.LOD();

                // create all the levels of detail
                for (let i = 0; i < MAP_CONFIG.lod_levels.length; i++) {
                    const geometry = new ParametricGeometry((u, v, target) => mapInternalSurface(u, v, target, nurbsSurface, knots[MAP_CONFIG.degree], knots[MAP_CONFIG.chunkDim]), MAP_CONFIG.lod_levels[i][0], MAP_CONFIG.lod_levels[i][0])
                    const chunk = new THREE.Mesh(geometry, grassMat);
                    lod.addLevel(chunk, MAP_CONFIG.lod_levels[i][1]);

                    // compute the bound volume tree for efficient raycasting
                    geometry.computeBoundsTree();
                    octree.add(new BVHHelper(chunk));
                }
                MAP_CONFIG.chunks.push(lod);

                lod.autoUpdate = false;

                // position the chunk
                lod.position.set(xOffset, 0, zOffset);
                lod.updateMatrixWorld(true);
                terrain.add(lod);
            }
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

const MAP_CONFIG = {
    heightmap: 'heightmap5.png',
    mapDim: 259,
    chunkCount: 16,
    chunkDim: 8,
    degree: 3,
    terrainScale: 2,
    terrainNoiseFreq: 0.03,
    terrainNoiseScale: 1.5,
    lod_levels: [[25, 0], [15, 2500], [8, 15000]],
    controlPoints: [],
    chunks: [],
    chunkDists: [],
    tearBlocks: [],
    treesInstances: [],
    treeData: [],
}

const grassMat = new THREE.MeshLambertMaterial({color: COLOURS.GRASS_GREEN, side: THREE.BackSide});
let controlPointsMesh;

let map;

// load the heightmap and process it
function processHeightmap() {
    const imgLoader = new THREE.ImageLoader();
    imgLoader.load(MAP_CONFIG.heightmap, (image) => generateMap(image));
}

function generateMap(heightmap) {
    /*
        Generates the map
    */
    map = new THREE.Group();

    // extract the pixel data from the heightmap (taken from https://codepen.io/Deniz3457/pen/NWrKZJq)
    const ctx = document.createElement('canvas').getContext('2d');
    const {width: width, height} = heightmap;
    ctx.canvas.width = width;
    ctx.canvas.height = height;
    ctx.drawImage(heightmap, 0, 0);
    const {data} = ctx.getImageData(0, 0, width, height);

    MAP_CONFIG.mapDim = width;

    MAP_CONFIG.controlPoints = [];
    MAP_CONFIG.treeData = [];
    MAP_CONFIG.chunks = [];
    MAP_CONFIG.tearBlocks = [];

    // round the number of chunks per axis to the nearest factor of the map size-3
    while ((MAP_CONFIG.mapDim-3) % MAP_CONFIG.chunkCount > 0) {
        if (MAP_CONFIG.chunkCount == 1) break;
        MAP_CONFIG.chunkCount--;
    }

    // calculate the necessary chunk dimension so the number of points matches the map size
    MAP_CONFIG.chunkDim = ((MAP_CONFIG.mapDim-3)/MAP_CONFIG.chunkCount)+3;

    MAP_CONFIG.chunkDists = new Array(MAP_CONFIG.chunkCount*MAP_CONFIG.chunkCount);

    // generate the b-spline knots
    const knots = generateKnots(MAP_CONFIG.degree, MAP_CONFIG.chunkDim);

    // add consistent noise to the terrain
    const noise = new SimplexNoise();

    // generate the terrain mesh
    const terrain = generateTerrain(data, knots, noise);
    map.add(terrain);

    // the lods cause tearing so a low resolution version of the terrain is added underneath to visually hide tears
    const tearBlock = generateTerrain(data, knots, noise, false, true);
    tearBlock.position.y = -1.5;
    map.add(tearBlock);

    // add the river
    const waterGeometry = new THREE.PlaneGeometry(MAP_CONFIG.mapDim-4, MAP_CONFIG.mapDim-4);
    const waterMaterial = new THREE.MeshBasicMaterial({color: COLOURS.WATER_BLUE, side: THREE.FrontSide});
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(MAP_CONFIG.mapDim/2, -4 + Math.random(), MAP_CONFIG.mapDim/2);
    map.add(water);

    // use raycasts to determine the positions of scenery objects
    raycaster.ray.direction.set(0, -1, 0);

    // create and place the cathedral
    const cathedralChunk = MAP_CONFIG.chunks[119];
    raycaster.ray.origin.set(cathedralChunk.position.x+9, 50, cathedralChunk.position.z+2);
    const hit = raycaster.intersectObject(cathedralChunk.levels[0].object);

    cathedral = createCathedral(hit[0].point, 1);
    map.add(cathedral);

    // create and place bridges
    const bridge1Chunk = MAP_CONFIG.chunks[85];
    const bridge1 = createBridge(new THREE.Vector3(bridge1Chunk.position.x+5, 4.5, bridge1Chunk.position.z+8), 0, Math.PI/32);

    const bridge2Chunk = MAP_CONFIG.chunks[138];
    const bridge2 = createBridge(new THREE.Vector3(bridge2Chunk.position.x+3, 3.5, bridge2Chunk.position.z+6), -Math.PI/4, -Math.PI/20);

    map.add(bridge1);
    map.add(bridge2);

    // the positions of objects within each chunk
    const chunkObjs = new Array(MAP_CONFIG.chunkCount*MAP_CONFIG.chunkCount).fill().map(() => []);

    // create instanced meshes for buildings
    const buildingMesh = new THREE.InstancedMesh(buildingGeometry, buildingMaterial, buildingCount);
    const roofMesh = new THREE.InstancedMesh(roofGeometry, roofMaterial, buildingCount);
    const buildingInstances = [buildingMesh, roofMesh];    

    map.add(buildingMesh);
    map.add(roofMesh);
    placeInstanceObjects(buildingInstances, chunkObjs, buildingCount, 0.8, 0.3, 1.5);

    // create instanced meshes for the trees and its imposters
    const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
    const leavesMesh = new THREE.InstancedMesh(leavesGeometry, leavesMaterial, treeCount);
    const trunkMeshImposter = new THREE.InstancedMesh(trunkGeometryImposter, trunkMaterial, treeCount);
    const leavesMeshImposter = new THREE.InstancedMesh(leavesGeometryImposter, leavesMaterial, treeCount);

    MAP_CONFIG.treesInstances = [trunkMesh, leavesMesh, trunkMeshImposter, leavesMeshImposter];

    map.add(trunkMesh);
    map.add(leavesMesh);
    map.add(trunkMeshImposter);
    map.add(leavesMeshImposter);
    placeInstanceObjects(MAP_CONFIG.treesInstances, chunkObjs, treeCount, 0.2, 0.25, 2.5, true);

    // create the agents for the boids
    createAgents();
    map.add(AGENTS_CONFIG.agentInstance);

    // visualise the control points for debugging
    controlPointsMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 3, 2), new THREE.MeshLambertMaterial({color: COLOURS.DEBUG_RED}), MAP_CONFIG.controlPoints.length);
    controlPointsMesh.visible = STATE.show_points;

    // set the positions for each control point
    let ind = 0
    for (let z = 0; z < MAP_CONFIG.chunkCount; z++) {
        const zOffset = z * (MAP_CONFIG.chunkDim - 3);
        for (let x = 0; x < MAP_CONFIG.chunkCount; x++) {
            const xOffset = x * (MAP_CONFIG.chunkDim - 3);
            for (let i = 0; i < MAP_CONFIG.chunkDim; i++) {
                for (let j = 0; j < MAP_CONFIG.chunkDim; j++) {
                    const p = MAP_CONFIG.controlPoints[ind];

                    dummy.position.set(p.x + xOffset, p.y, p.z+zOffset);
                    dummy.updateMatrix();

                    controlPointsMesh.setMatrixAt(ind, dummy.matrix);
                    ind++;
                }
            }
        }
    }

    map.add(controlPointsMesh);

    map.position.set(-(MAP_CONFIG.mapDim*MAP_CONFIG.terrainScale)/2, -1.5, -(MAP_CONFIG.mapDim*MAP_CONFIG.terrainScale)/2);
    map.scale.setScalar(MAP_CONFIG.terrainScale);

    // the map is static so don't update it automatically
    map.traverse((object) => {
        if (object.isMesh || object.isLOD) {
            object.matrixAutoUpdate = false;
            object.updateMatrix();
            object.updateMatrixWorld();
        }
    });

    scene.add(map);
    mapLoaded = true;
}

////////////////////////////////////////////////////////////////////////////
// SCENARY
////////////////////////////////////////////////////////////////////////////

const cathedralChunks = [87, 88, 103, 104, 119, 120]

// create the tree components
const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 2, 3);
const trunkGeometryImposter = new THREE.PlaneGeometry(0.7, 2);
const trunkMaterial = new THREE.MeshLambertMaterial({color: COLOURS.TREE_BROWN});
trunkGeometry.translate(0, 1.0, 0); 
trunkGeometryImposter.translate(0, 1.0, 0); 

const leavesGeometry = new THREE.ConeGeometry(2, 4, 5);
const leavesGeometryImposter = new THREE.ConeGeometry(2, 4, 2); // this creates a single triangle
const leavesMaterial = new THREE.MeshLambertMaterial({color: COLOURS.LEAF_GREEN});
leavesGeometry.translate(0, 4.0, 0);
leavesGeometryImposter.translate(0, 4.0, 0);

const treeCount = 4000;

// create the building components
const buildingGeometry = new THREE.BoxGeometry(1, 2, 1);
const buildingMaterial = new THREE.MeshLambertMaterial({color: COLOURS.BUILDING_GREY});
buildingGeometry.translate(0, 1.0, 0); 

const roofGeometry = new THREE.ConeGeometry(0.8, 0.6, 4);
const roofMaterial = new THREE.MeshLambertMaterial({color: COLOURS.ROOF_BEIGE});
roofGeometry.translate(0, 2.25, 0);
roofGeometry.rotateY(Math.PI/4);

const buildingCount = 1000;

// create the cathedral components
const towerGeometry = new THREE.BoxGeometry(4, 9, 4);
const towerMaterial = new THREE.MeshLambertMaterial({color: COLOURS.BUILDING_BEIGE});

towerGeometry.computeBoundsTree();

const towerRoofGeometry = new THREE.ConeGeometry(3.5, 1, 4);
const towerRoofMaterial = new THREE.MeshLambertMaterial({color: COLOURS.ROOF_GREY});

let cathedral;

const bridgeGeometry = new THREE.BoxGeometry(25, 2, 3);

bridgeGeometry.computeBoundsTree();

function placeInstanceObjects(instances, chunkObjs, count, scale, scaleVariation, minDist, trees=false) {
    /*
        Places objects from mesh instances onto the map
        A raycaster is used to determine position
    */
    let hits = 0;
    for (let i = 0; i < count; i++) {
        // randomly choose a chunk to spawn the object into
        const chunkInd = Math.floor(Math.random() * MAP_CONFIG.chunks.length);

        if (cathedralChunks.includes(chunkInd)) continue;

        const chunk = MAP_CONFIG.chunks[chunkInd];

        // choose a random position from within that chunk
        const x = Math.random() * (MAP_CONFIG.chunkDim-3) * 0.8 + 1.5 + chunk.position.x;
        const z = Math.random() * (MAP_CONFIG.chunkDim-3) * 0.8 + 1.5 + chunk.position.z;

        // raycast from above to find the height of the terrain
        raycaster.ray.origin.set(x, 50, z);
        const hit = raycaster.intersectObject(chunk.levels[0].object);

        if (hit.length > 0) {            
            const normal = hit[0].face.normal;

            // only place an object if the area is flat and above the river
            if (normal.dot(upVec) > -0.95 || hit[0].point.y < 2) continue;

            const position = hit[0].point

            // check if adding this object would intersect with another object in this chunk
            let intersects = false;
            for (const objPos of chunkObjs[chunkInd]) {
                const dx = position.x - objPos[0];
                const dz = position.z - objPos[1];
                if (dx*dx + dz*dz < minDist) {
                    intersects = true;
                    break;
                }
            }

            if (intersects) continue;

            // set the transform of the object
            dummy.position.copy(position);

            const objScale = scale + Math.random()*scaleVariation;
            dummy.scale.setScalar(objScale);

            chunkObjs[chunkInd].push([position.x, position.z]);

            // save tree data for imposter checks
            if (trees) {
                MAP_CONFIG.treeData.push([chunkInd, position, objScale])
            }
            
            dummy.updateMatrix();
            instances.forEach(instance => instance.setMatrixAt(hits, dummy.matrix));

            hits++;
        }
    }

    instances.forEach(instance => instance.count = hits);
}

const camDir = new THREE.Vector3();
function checkImposter() {
    /*
        Checks each tree if it needs to be swapped with an imposter
    */
    tempVec.copy(camera.position);
    map.worldToLocal(tempVec);

    camera.getWorldDirection(camDir);

    let treeInd = 0;
    let imposterInd = 0;
    for (let i = 0; i < MAP_CONFIG.treeData.length; i++) {

        const data = MAP_CONFIG.treeData[i];
        dummy.position.copy(data[1]);
        dummy.scale.setScalar(data[2]);

        tempVec2.subVectors(data[1], tempVec).normalize();

        if (MAP_CONFIG.chunkDists[data[0]] > 32000 && camDir.dot(tempVec2) > 0.7) {
            // convert the camera's position into the trees' local space position
            tempVec.y = dummy.position.y;

            // make the imposter face the camera
            dummy.lookAt(tempVec);
            dummy.updateMatrix();

            MAP_CONFIG.treesInstances[2].setMatrixAt(imposterInd, dummy.matrix)

            // the leaves are a single triangle that needs to be rotated by 90 degrees
            dummy.rotateY(Math.PI/2);
            dummy.updateMatrix();

            MAP_CONFIG.treesInstances[3].setMatrixAt(imposterInd, dummy.matrix)

            imposterInd++;

        } else {
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();

            MAP_CONFIG.treesInstances[0].setMatrixAt(treeInd, dummy.matrix)
            MAP_CONFIG.treesInstances[1].setMatrixAt(treeInd, dummy.matrix)
            treeInd++;
        }
    }

    MAP_CONFIG.treesInstances[0].count = treeInd;
    MAP_CONFIG.treesInstances[1].count = treeInd;
    MAP_CONFIG.treesInstances[2].count = imposterInd;
    MAP_CONFIG.treesInstances[3].count = imposterInd;

    MAP_CONFIG.treesInstances.forEach(instance => instance.instanceMatrix.needsUpdate = true);
}

function createBridge(position, rotY, rotZ) {
    const bridgeMesh = new THREE.Mesh(bridgeGeometry, towerMaterial);
    bridgeMesh.position.set(position.x, position.y, position.z);
    bridgeMesh.quaternion.setFromEuler(new THREE.Euler(0, rotY, rotZ));

    octree.add(new BVHHelper(bridgeMesh));

    return bridgeMesh
}

function createCathedral(position, scale) {
    const cathedral = new THREE.Group();
    const tower1Mesh = new THREE.Mesh(towerGeometry, towerMaterial);
    const tower2Mesh = new THREE.Mesh(towerGeometry, towerMaterial);
    const tower3Mesh = new THREE.Mesh(towerGeometry, towerMaterial);
    tower1Mesh.position.x -= 3;
    tower2Mesh.position.x += 3;

    tower1Mesh.position.y += 4.5;
    tower2Mesh.position.y += 4.5;
    tower3Mesh.position.y += 4.5;

    tower3Mesh.position.z -= 9;
    tower3Mesh.scale.setScalar(1.2);

    const tower1RoofMesh = new THREE.Mesh(towerRoofGeometry, towerRoofMaterial);
    const tower2RoofMesh = new THREE.Mesh(towerRoofGeometry, towerRoofMaterial);
    const tower3RoofMesh = new THREE.Mesh(towerRoofGeometry, towerRoofMaterial);
    tower1RoofMesh.position.x -= 3;
    tower1RoofMesh.position.y += 9.5;

    tower2RoofMesh.position.x += 3;
    tower2RoofMesh.position.y += 9.5;

    tower3RoofMesh.position.z -= 9;
    tower3RoofMesh.position.y += 10.3;
    tower3RoofMesh.scale.setScalar(1.2);

    tower1RoofMesh.rotation.y = Math.PI/4;
    tower2RoofMesh.rotation.y = Math.PI/4;
    tower3RoofMesh.rotation.y = Math.PI/4;

    const hallMesh = new THREE.Mesh(towerGeometry, towerMaterial);
    hallMesh.scale.y = 0.6;
    hallMesh.scale.z = 2.8;
    hallMesh.position.z -= 5;
    hallMesh.position.y += 2;

    cathedral.add(tower1Mesh);
    cathedral.add(tower2Mesh);
    cathedral.add(tower3Mesh);
    cathedral.add(tower1RoofMesh);
    cathedral.add(tower2RoofMesh);
    cathedral.add(tower3RoofMesh);
    cathedral.add(hallMesh);

    cathedral.position.set(position.x, position.y-0.5, position.z);
    cathedral.scale.setScalar(scale);
    
    cathedral.children.forEach(mesh => octree.add(new BVHHelper(mesh)))
    
    return cathedral
}

////////////////////////////////////////////////////////////////////////////
// AGENTS
////////////////////////////////////////////////////////////////////////////

const AGENTS_CONFIG = {
    count: 1200,
    flocks: 6,
    speed: 0.1,
    neighbourDist: 5,
    weights: [0.015, 0.02, 0.07, 0.3, 1],
    maxForce: 0.5,
    lookahead: 20,
    agentInstance: NaN,
    velocities: [],
    positions: [],
    agentsInChunk: new Array(MAP_CONFIG.chunkCount*MAP_CONFIG.chunkCount).fill().map(() => []),
    agentToChunk: [],
    agentQuadrants: [],
    targetChunks: [],
    targetPos: [],
}

const agentGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
const agentMaterial = new THREE.MeshLambertMaterial({color: COLOURS.DEBUG_RED});

function createAgents() {
    /*
        creates the agents for the boids
    */
    AGENTS_CONFIG.agentInstance = new THREE.InstancedMesh(agentGeometry, agentMaterial, AGENTS_CONFIG.count);
    AGENTS_CONFIG.velocities = [];
    AGENTS_CONFIG.positions = [];

    AGENTS_CONFIG.agentsInChunk = new Array(MAP_CONFIG.chunkCount*MAP_CONFIG.chunkCount).fill().map(() => []);
    AGENTS_CONFIG.agentToChunk = [];
    AGENTS_CONFIG.agentQuadrants = [];

    AGENTS_CONFIG.targetChunks = [];
    AGENTS_CONFIG.targetPos = [];

    // have the bounding sphere cover the whole map so they are never unloaded
    AGENTS_CONFIG.agentInstance.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(MAP_CONFIG.mapDim/2, 0, MAP_CONFIG.mapDim/2), MAP_CONFIG.mapDim*2);

    for (let i = 0; i < AGENTS_CONFIG.count; i++) {
        const chunkInd = 136;
        const chunk = MAP_CONFIG.chunks[chunkInd];

        // choose a random position from within the chunk
        const x = Math.random() * (MAP_CONFIG.chunkDim-3) * 0.8 + 1.5 + chunk.position.x;
        const z = Math.random() * (MAP_CONFIG.chunkDim-3) * 0.8 + 1.5 + chunk.position.z;

        // set the transform of the object
        dummy.position.set(x, 12+Math.random()*4, z);
        dummy.rotation.y = Math.random() * Math.PI;
        dummy.scale.setScalar(1);
        
        dummy.updateMatrix();

        AGENTS_CONFIG.agentInstance.setMatrixAt(i, dummy.matrix);
        AGENTS_CONFIG.agentsInChunk[chunkInd].push(i);
        AGENTS_CONFIG.agentToChunk.push(chunkInd);
        AGENTS_CONFIG.agentQuadrants.push(0);

        AGENTS_CONFIG.velocities.push(new THREE.Vector3(Math.random(), Math.random(), Math.random()));
        AGENTS_CONFIG.positions.push(new THREE.Vector3().copy(dummy.position));
    }

    // create random targets for the agents based on flock
    const offset = (MAP_CONFIG.chunkDim-3) / 2;
    for (let i = 0; i < AGENTS_CONFIG.flocks; i++) {
        AGENTS_CONFIG.targetChunks.push(Math.floor(Math.random() * MAP_CONFIG.chunks.length));
        AGENTS_CONFIG.targetPos.push(new THREE.Vector3().set(MAP_CONFIG.chunks[AGENTS_CONFIG.targetChunks[i]].position.x + offset, 12, MAP_CONFIG.chunks[AGENTS_CONFIG.targetChunks[i]].position.z + offset));
    }
}

const force = new THREE.Vector3();
const diff = new THREE.Vector3();
const separation = new THREE.Vector3();
const alignment = new THREE.Vector3();
const cohesion = new THREE.Vector3();
const target = new THREE.Vector3();
const avoid = new THREE.Vector3();

function updateAgents() {
    /*
        updates the velocities and positions of each agent according to the boids laws
    */
    for (let i = 0; i < AGENTS_CONFIG.count; i++) {
        tempVec.copy(AGENTS_CONFIG.positions[i]);

        const currentVelocity = AGENTS_CONFIG.velocities[i];
        const agentChunk = AGENTS_CONFIG.agentToChunk[i];

        // consider each other agent in the same chunk
        let neighbours = 0;
        for (const other of AGENTS_CONFIG.agentsInChunk[agentChunk]) {
            // only consider agents that are also in the same quadrant
            if (AGENTS_CONFIG.agentQuadrants[other] != AGENTS_CONFIG.agentQuadrants[i]) continue;
            if (i == other) continue;
            tempVec2.copy(AGENTS_CONFIG.positions[other]);

            const sqrDis = tempVec.distanceToSquared(tempVec2);

            // apply the rules considering the nearby agents
            if (sqrDis < AGENTS_CONFIG.neighbourDist) {
                separation.add(diff.subVectors(tempVec, tempVec2).divideScalar(sqrDis));
                alignment.add(AGENTS_CONFIG.velocities[other]);
                cohesion.add(tempVec2);

                neighbours++;
            }
        }

        // apply the individual forces on the main steering force
        if (neighbours > 0) {
            alignment.normalize().multiplyScalar(AGENTS_CONFIG.speed).sub(currentVelocity);
            cohesion.divideScalar(neighbours).sub(tempVec).normalize().multiplyScalar(AGENTS_CONFIG.speed).sub(currentVelocity);

            force.addScaledVector(separation, AGENTS_CONFIG.weights[0]);
            force.addScaledVector(alignment, AGENTS_CONFIG.weights[1]);
            force.addScaledVector(cohesion, AGENTS_CONFIG.weights[2]);
        }

        // find what target this agent has and apply its force
        const flock = Math.floor(i / (AGENTS_CONFIG.count/AGENTS_CONFIG.flocks));
        target.subVectors(AGENTS_CONFIG.targetPos[flock], tempVec).sub(currentVelocity).normalize();
        force.addScaledVector(target, AGENTS_CONFIG.weights[3]);

        // set up the raycast
        const velocityNormalised = currentVelocity.normalize();
        raycaster.ray.direction.copy(velocityNormalised);
        raycaster.ray.origin.copy(tempVec.clone().applyMatrix4(map.matrixWorld));

        let hit;

        // only check for ground intersection if the agent is close to the ground
        if (tempVec.y < 12) {
            hit = raycaster.intersectObject(MAP_CONFIG.chunks[agentChunk].levels[2].object);
            if (hit.length > 0) {
                avoid.copy(hit[0].face.normal);
            } else {
                const rayChunk = posToChunk(tempVec.clone().addScaledVector(velocityNormalised, AGENTS_CONFIG.lookahead));
                if (rayChunk != agentChunk) {
                    hit = raycaster.intersectObject(MAP_CONFIG.chunks[rayChunk].levels[2].object);
                    if (hit.length > 0) {
                        avoid.copy(hit[0].face.normal);
                    }
                }
            }
        }

        // check for relevant cathedral intersections if the agent is in the cathedral chunks
        if (agentChunk == 87 || agentChunk == 88) {
            hit = raycaster.intersectObject(cathedral.children[2]);
            if (hit.length > 0) {
                avoid.sub(hit[0].face.normal);
            }
        } else if (agentChunk == 103 || agentChunk == 104) {
            const obstacles = [cathedral.children[0], cathedral.children[1], cathedral.children[2], cathedral.children[6]]
            hit = raycaster.intersectObjects(obstacles);
            if (hit.length > 0) {
                avoid.sub(hit[0].face.normal);
            }
        } else if (agentChunk == 119 || agentChunk == 120) {
            const obstacles = [cathedral.children[0], cathedral.children[1], cathedral.children[6]]
            hit = raycaster.intersectObjects(obstacles);
            if (hit.length > 0) {
                avoid.sub(hit[0].face.normal);
            }
        }

        force.addScaledVector(avoid, -AGENTS_CONFIG.weights[4]);

        // clamp the force and update the velocity
        force.clampLength(0, AGENTS_CONFIG.maxForce);
        currentVelocity.add(force).clampLength(0, AGENTS_CONFIG.speed);

        // reset the forces
        force.set(0, 0, 0);
        separation.set(0, 0, 0);
        alignment.set(0, 0, 0);
        cohesion.set(0, 0, 0);
        target.set(0, 0, 0);
        avoid.set(0, 0, 0);

        // update the position and find which new chunk the agent is in
        AGENTS_CONFIG.positions[i].add(currentVelocity);
        const newChunkInd = posToChunk(AGENTS_CONFIG.positions[i]);
        if (newChunkInd != agentChunk) {
            AGENTS_CONFIG.agentToChunk[i] = newChunkInd;
            AGENTS_CONFIG.agentsInChunk[agentChunk].splice(AGENTS_CONFIG.agentsInChunk[agentChunk].indexOf(i), 1);
            AGENTS_CONFIG.agentsInChunk[newChunkInd].push(i);
        }

        // find which quadrant the agent is in
        const xQuad = Math.floor(((AGENTS_CONFIG.positions[i].x - MAP_CONFIG.chunks[newChunkInd].position.x))/((MAP_CONFIG.chunkDim-3)/2));
        const zQuad = Math.floor(((AGENTS_CONFIG.positions[i].z - MAP_CONFIG.chunks[newChunkInd].position.z))/((MAP_CONFIG.chunkDim-3)/2));
        AGENTS_CONFIG.agentQuadrants[i] = zQuad * 2 + xQuad;

        dummy.position.copy(AGENTS_CONFIG.positions[i]);        
        dummy.updateMatrix();

        AGENTS_CONFIG.agentInstance.setMatrixAt(i, dummy.matrix);
    }

    AGENTS_CONFIG.agentInstance.instanceMatrix.needsUpdate = true;
}

function targetCheck() {
    /*
        check if enough agents have reached the target and find a new target if they have
    */
    const offset = (MAP_CONFIG.chunkDim-3) / 2;
    for (let i = 0; i < AGENTS_CONFIG.flocks; i++) {
        if (AGENTS_CONFIG.agentsInChunk[AGENTS_CONFIG.targetChunks[i]].length > 150) {
            AGENTS_CONFIG.targetChunks[i] = Math.floor(Math.random() * MAP_CONFIG.chunks.length);
            while (cathedralChunks.includes(AGENTS_CONFIG.targetChunks[i])) {
                AGENTS_CONFIG.targetChunks[i] = Math.floor(Math.random() * MAP_CONFIG.chunks.length);
            }
            AGENTS_CONFIG.targetPos[i].set(MAP_CONFIG.chunks[AGENTS_CONFIG.targetChunks[i]].position.x + offset, 12, MAP_CONFIG.chunks[AGENTS_CONFIG.targetChunks[i]].position.z + offset);
        }
    }
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
    octree = new THREE.Group();
    octree.visible = STATE.show_bvh;
    processHeightmap();
    addBaseLight();
    scene.add(octree);
}

let frame = 0;
function animate() {
    requestAnimationFrame(animate);
    stats.begin();

    orbitControls.update();

    if (mapLoaded) {
        // only update lods every 20 frames
        if (frame % 20 == 0 && mapLoaded) {
            updateChunks();    
            checkImposter();
            targetCheck();         
            frame = 0;
        }

        updateAgents();
    } 
    frame++;

    renderer.render(scene, camera);
    stats.end();
}

init();
animate();