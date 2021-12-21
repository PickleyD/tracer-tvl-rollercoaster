import "./style.css";
import * as THREE from "three";
import {
  RollerCoasterGeometry,
  RollerCoasterShadowGeometry,
  RollerCoasterLiftersGeometry,
  TreesGeometry,
  SkyGeometry,
} from "./RollerCoaster";
import { format, fromUnixTime } from "date-fns";

const fetchData = () => {
  const loadingEl = document.getElementById("loading");
  const loadedEl = document.getElementById("loaded");
  return fetch(
    "https://api.reputation.link/protocol/tracer/TVS?dataPoints=500&source=Arbitrum"
  ).then((response) => {
    // Hide loading indicator and display content
    loadingEl.style.display = "none";
    loadedEl.style.display = "flex";
    return response.json();
  });
};

const renderCoaster = (data) => {
  let mesh, material, geometry;

  // Grab elements
  const dateTextEl = document.getElementById("date");
  const tvlTextEl = document.getElementById("tvl");
  const up = document.getElementById("up");
  const down = document.getElementById("down");
  const longShortTextEl = document.getElementById("long-positions");
  const left = document.getElementById("left");
  const right = document.getElementById("right");
  const canvas = document.querySelector("canvas.webgl");

  const minTvl = Math.min(...data.map((datum) => datum.total_value_secured));
  const maxTvl = Math.max(...data.map((datum) => datum.total_value_secured));

  const minTimestamp = Math.min(...data.map((datum) => datum.timestamp));
  const maxTimestamp = Math.max(...data.map((datum) => datum.timestamp));

  // Normalise the data so we get a position and height for the track between 0 and 1
  const normaliseData = (tvlData) => {
    const normalise = (val, max, min) => (val - min) / (max - min);

    return tvlData.map((datum) => ({
      timestamp: normalise(datum.timestamp, maxTimestamp, minTimestamp),
      tvl: normalise(datum.total_value_secured, maxTvl, minTvl),
      longShortRatio:
        datum.total_value_secured_long / datum.total_value_secured_short,
    }));
  };

  const normalisedData = normaliseData(data);

  // Reduce the number of data points so the coaster isn't so choppy
  const chunkData = (tvlData, numPoints = 25) => {
    const length = tvlData.length;
    const interval = Math.ceil(length / numPoints);

    let result = [];

    for (let i = 0; i < numPoints; i++) {
      let subtotalTvl = 0;
      let subtotalTimestamp = 0;
      let subtotalLongShortRatio = 0;
      let counted = 0;
      for (let j = 0; j < interval; j++) {
        const index = interval * i + j;
        if (index < length) {
          subtotalTvl += tvlData[index].tvl;
          subtotalTimestamp += tvlData[index].timestamp;
          subtotalLongShortRatio += tvlData[index].longShortRatio;
          counted++;
        }
      }

      if (counted > 0) {
        result.push({
          timestamp: subtotalTimestamp / counted,
          tvl: subtotalTvl / counted,
          longShortRatio: subtotalLongShortRatio / counted,
        });
      }
    }

    return result;
  };

  const reducedData = [
    normalisedData[0],
    ...chunkData(normalisedData),
    normalisedData[normalisedData.length - 1],
  ];

  // Create spline curves from normalised data
  const splineCurveVertical = new THREE.SplineCurve(
    reducedData.map((datum) => new THREE.Vector2(datum.timestamp, datum.tvl))
  );
  const splineCurveHorizontal = new THREE.SplineCurve(
    reducedData.map(
      (datum) => new THREE.Vector2(datum.timestamp, datum.longShortRatio)
    )
  );

  const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0ff);

  const light = new THREE.HemisphereLight(0xfff0f0, 0x606066);
  light.position.set(1, 1, 1);
  scene.add(light);

  const train = new THREE.Object3D();
  scene.add(train);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  train.add(camera);

  // Terrain
  geometry = new THREE.PlaneGeometry(500, 1000, 15, 15);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position.array;
  const vertex = new THREE.Vector3();

  // Hills in terrain
  for (let i = 0; i < positions.length; i += 3) {
    vertex.fromArray(positions, i);

    vertex.x += Math.random() * 10 - 5;
    vertex.z += Math.random() * 10 - 5;

    const distance = vertex.distanceTo(scene.position) / 5 - 25;
    vertex.y = Math.random() * Math.max(0, distance);

    vertex.toArray(positions, i);
  }

  geometry.computeVertexNormals();

  material = new THREE.MeshLambertMaterial({
    color: 0x407000,
  });

  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  geometry = new TreesGeometry(mesh);
  material = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  geometry = new SkyGeometry();
  material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const curve = (function () {
    const vector = new THREE.Vector3();
    const vector2 = new THREE.Vector3();

    return {
      getPointAt: function (t) {
        const x = -(splineCurveHorizontal.getPoint(t).y - 1) * 20;
        const y = splineCurveVertical.getPoint(t).y * 10 + 10;
        const z = t * 80;

        return vector.set(x, y, z).multiplyScalar(2);
      },

      getTvlAt: function (t) {
        const result =
          splineCurveVertical.getPoint(t).y * (maxTvl - minTvl) + minTvl;

        return result;
      },

      getTimestampAt: function (t) {
        const result =
          splineCurveVertical.getPoint(t).x * (maxTimestamp - minTimestamp) +
          minTimestamp;

        return result;
      },

      getLongShortAt: function (t) {
        const result = splineCurveHorizontal.getPoint(t).y;

        return result;
      },

      getTangentAt: function (t) {
        const delta = 0.0001;
        const t1 = Math.max(0, t - delta);
        const t2 = Math.min(1, t + delta);

        return vector2
          .copy(this.getPointAt(t2))
          .sub(this.getPointAt(t1))
          .normalize();
      },
    };
  })();

  geometry = new RollerCoasterGeometry(curve, 600);
  material = new THREE.MeshPhongMaterial({
    vertexColors: true,
  });
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  geometry = new RollerCoasterLiftersGeometry(curve, 50);
  material = new THREE.MeshPhongMaterial();
  mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.1;
  scene.add(mesh);

  geometry = new RollerCoasterShadowGeometry(curve, 500);
  material = new THREE.MeshBasicMaterial({
    color: 0x305000,
    depthWrite: false,
    transparent: true,
  });
  mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.1;
  scene.add(mesh);

  window.addEventListener("resize", onWindowResize);

  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  const position = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  const lookAt = new THREE.Vector3();

  let velocity = 0;
  let progress = 0;

  let prevTime = performance.now();

  let currentTvlValue = 0;
  let prevTvlValue = 0;
  let timestampValue = 0;
  let currLongPercentage = 0;
  let prevLongPercentage = 0;

  function render() {
    const time = performance.now();
    const delta = time - prevTime;

    progress += velocity;

    if (progress > 1) {
      progress = 0;
      velocity = 0;
    }

    position.copy(curve.getPointAt(progress));
    position.y += 0.3;

    currentTvlValue = curve.getTvlAt(progress);
    tvlTextEl.innerHTML = `$${abbreviateNumber(currentTvlValue)}`;

    if (prevTvlValue !== 0) {
      if (currentTvlValue > prevTvlValue) {
        down.style.opacity = 0;
        up.style.opacity = 1;
      } else if (prevTvlValue > currentTvlValue) {
        down.style.opacity = 1;
        up.style.opacity = 0;
      }
    }

    prevTvlValue = currentTvlValue;

    timestampValue = curve.getTimestampAt(progress);
    dateTextEl.innerHTML = `${format(
      fromUnixTime(timestampValue),
      "dd MMM yy"
    )}`;

    currLongPercentage = ((curve.getLongShortAt(progress) / 2) * 100).toFixed(
      2
    );
    longShortTextEl.innerHTML = `${currLongPercentage}%`;
    if (prevLongPercentage !== 0) {
      if (currLongPercentage > prevLongPercentage) {
        left.style.opacity = 0;
        right.style.opacity = 1;
      } else if (prevLongPercentage > currLongPercentage) {
        left.style.opacity = 1;
        right.style.opacity = 0;
      }
    }
    prevLongPercentage = currLongPercentage;

    if (currLongPercentage > 50) {
      longShortTextEl.classList.remove("short");
      longShortTextEl.classList.add("long");
    } else if (currLongPercentage < 50) {
      longShortTextEl.classList.remove("long");
      longShortTextEl.classList.add("short");
    }

    train.position.copy(position);

    tangent.copy(curve.getTangentAt(progress));

    velocity -= tangent.y * 0.0000001 * delta;
    velocity = Math.max(0.0002, Math.min(0.0004, velocity));

    train.lookAt(lookAt.copy(position).sub(tangent));

    //

    renderer.render(scene, camera);

    prevTime = time;
  }

  // Formats number as "123k", "1.2b" etc
  const abbreviateNumber = (num, fixed = 0) => {
    if (num === null) {
      return null;
    }
    if (num === 0) {
      return "0";
    }
    fixed = !fixed || fixed < 0 ? 0 : fixed; // number of decimal places to show
    const b = num.toPrecision(2).split("e"), // get [coefficient, power]
      k =
        b.length === 1
          ? 0
          : Math.floor(Math.min(parseFloat(b[1].slice(1)), 14) / 3), // floor at decimals, ceiling at trillions
      c =
        k < 1
          ? parseFloat(num.toFixed(0 + fixed))
          : parseFloat((num / Math.pow(10, k * 3)).toFixed(1 + fixed)), // divide by power
      d = c < 0 ? c : Math.abs(c), // enforce -0 is 0
      e = d + ["", "K", "M", "B", "T"][k]; // append power
    return e;
  };

  renderer.setAnimationLoop(render);
};

fetchData().then(renderCoaster);
