(() => {
  "use strict";

  const canvas = document.querySelector("#diagram");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Stored as proportions so the composition survives canvas resizing.
  const points = [
    [.13,.19],[.36,.10],[.61,.16],[.84,.13],
    [.12,.47],[.33,.40],[.54,.42],[.78,.40],[.94,.49],
    [.17,.76],[.40,.74],[.66,.72],[.87,.82],
    [.49,.96]
  ].map(([x,y]) => ({x,y}));
  const colors = [
    "#ceded0","#eed3ba","#c6d4d4","#d4d7ba",
    "#e7d8bf","#a7bdac","#ebbc98","#c4cfc5","#e7cfba",
    "#bfd2c6","#f0d3b3","#ccd4b2","#b7cfcc","#e2e3cb"
  ];
  const TAU = Math.PI * 2;
  let width = 0, height = 0, dpr = 1;
  let dragging = -1;
  let dragOffset = {x:0,y:0};
  let hovered = -1;
  let frameRequested = false;
  let mode = "voronoi";
  let interactionMode = "drag";
  let mapEnabled = false;
  const mapTiles = document.querySelector("#map-tiles");
  const mapStage = document.querySelector("#diagram-stage");
  const mapAttribution = document.querySelector("#map-attribution");
  const mapLocation = {latitude: 52.3731, longitude: 4.8922, zoom: 15}; // central Amsterdam

  let oceanEnabled = false;
  let oceanWorld = null;
  let oceanLastTimestamp = null;
  let oceanFramePending = false;
  let oceanStationPlacement = false;
  let oceanDraggingStation = -1;
  const oceanToggle = document.querySelector("#ocean-toggle");
  const oceanPauseButton = document.querySelector("#ocean-pause");
  const oceanRestartButton = document.querySelector("#ocean-restart");
  const oceanStationButton = document.querySelector("#ocean-station");
  const oceanDashboard = document.querySelector("#ocean-dashboard");
  const oceanHelp = document.querySelector("#ocean-help");
  const oceanStats = {
    coverage: document.querySelector("#ocean-coverage"),
    distance: document.querySelector("#ocean-distance"),
    battery: document.querySelector("#ocean-battery"),
    time: document.querySelector("#ocean-time")
  };

  function refreshOceanDashboard() {
    if (!oceanWorld || !window.OceanSurvey) return;
    const stats = window.OceanSurvey.stats(oceanWorld);
    if (oceanStats.coverage) oceanStats.coverage.textContent = stats.coverage + "%";
    if (oceanStats.distance) oceanStats.distance.textContent = stats.distance.toLocaleString() + " units";
    if (oceanStats.battery) oceanStats.battery.textContent = stats.battery + "%";
    if (oceanStats.time) {
      const m = Math.floor(stats.elapsed / 60), sec = stats.elapsed % 60;
      oceanStats.time.textContent = String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0");
    }
    if (oceanHelp && stats.complete) {
      oceanHelp.textContent = "Mission complete. Restart to run another survey.";
    }
  }

  function scheduleOceanFrame() {
    if (oceanEnabled && !oceanFramePending) {
      oceanFramePending = true;
      requestAnimationFrame(oceanTick);
    }
  }

  function oceanTick(timestamp) {
    oceanFramePending = false;
    if (!oceanEnabled || !oceanWorld) return;
    if (oceanLastTimestamp !== null && !oceanWorld.paused) {
      window.OceanSurvey.update(oceanWorld, Math.min(100, Math.max(0, timestamp-oceanLastTimestamp))/1000);
    }
    oceanLastTimestamp = timestamp;
    refreshOceanDashboard();
    requestDraw();
    scheduleOceanFrame();
  }

  function syncOceanControls() {
    if (oceanToggle) {
      oceanToggle.textContent = oceanEnabled ? "EXIT OCEAN MODE" : "OCEAN MODE";
      oceanToggle.classList.toggle("is-active", oceanEnabled);
      oceanToggle.setAttribute("aria-pressed", String(oceanEnabled));
    }
    if (oceanDashboard) oceanDashboard.hidden = !oceanEnabled;
    if (oceanPauseButton) {
      oceanPauseButton.hidden = !oceanEnabled;
      oceanPauseButton.textContent = oceanWorld?.paused ? "RESUME MISSION" : "PAUSE MISSION";
    }
    if (oceanRestartButton) oceanRestartButton.hidden = !oceanEnabled;
    if (oceanStationButton) {
      oceanStationButton.hidden = !oceanEnabled;
      oceanStationButton.textContent = oceanStationPlacement ? "CANCEL PLACEMENT" : "+ PRIORITY STATION";
      oceanStationButton.classList.toggle("is-active", oceanStationPlacement);
    }
    const bar = document.querySelector(".canvas-bar");
    if (bar) bar.classList.toggle("ocean-active", oceanEnabled);
    const playback = document.querySelector(".playback-toolbar");
    if (playback) playback.classList.toggle("ocean-active", oceanEnabled);
    const note = document.querySelector("#animation-note");
    if (note) {
      note.textContent = oceanEnabled
        ? "Synthetic coastal survey: four AUVs map Voronoi zones. Click + Priority Station, then click the ocean to prioritize an area. Drag stations to reposition."
        : "Build Cells demonstrates polygon clipping, Sweep Line illustrates Fortune-style geometry, and Show Robots enables roaming pathfinding.";
    }
    canvas.style.cursor = oceanEnabled && oceanStationPlacement ? "crosshair" : "grab";
  }

  if (oceanToggle) oceanToggle.addEventListener("click", () => {
    if (!window.OceanSurvey || !width || !height) return;
    oceanEnabled = !oceanEnabled;
    oceanLastTimestamp = null;
    oceanStationPlacement = false;
    oceanDraggingStation = -1;
    dragging = -1;
    hovered = -1;
    if (oceanEnabled) {
      stopAnimation();
      oceanWorld = window.OceanSurvey.create(width,height);
      if (oceanHelp) oceanHelp.textContent = "Four autonomous vehicles scan separate Voronoi zones. Add a priority station to focus the survey on an area of interest.";
      refreshOceanDashboard();
      scheduleOceanFrame();
    } else {
      oceanWorld = null;
      if (robotsVisible) {
        robotLastTimestamp = null;
        scheduleRobotFrame();
      }
    }
    syncOceanControls();
    requestDraw();
  });
  if (oceanPauseButton) oceanPauseButton.addEventListener("click", () => {
    if (!oceanWorld) return;
    oceanWorld.paused = !oceanWorld.paused;
    oceanLastTimestamp = null;
    syncOceanControls();
  });
  if (oceanRestartButton) oceanRestartButton.addEventListener("click", () => {
    if (!oceanEnabled || !window.OceanSurvey) return;
    const stations = oceanWorld?.stations || [];
    oceanWorld = window.OceanSurvey.create(width,height);
    for (const station of stations) {
      window.OceanSurvey.addStation(oceanWorld,station.x,station.y);
    }
    oceanStationPlacement = false;
    oceanLastTimestamp = null;
    if (oceanHelp) oceanHelp.textContent = "New survey started. Vehicles are surveying their zones.";
    syncOceanControls();
    refreshOceanDashboard();
    requestDraw();
  });
  if (oceanStationButton) oceanStationButton.addEventListener("click", () => {
    if (!oceanWorld) return;
    oceanStationPlacement = !oceanStationPlacement;
    syncOceanControls();
  });

  let robotsVisible = false;
  let robotFleet = null;
  let robotLastTimestamp = null;
  let robotFramePending = false;
  const robotToggle = document.querySelector("#robots-toggle");

  function planRobotFleet() {
    if (!window.RobotSwarm || !width || !height) return;
    robotFleet = window.RobotSwarm.create(points, width, height, robotFleet);
  }

  function robotTick(timestamp) {
    robotFramePending = false;
    if (!robotsVisible) return;
    if (oceanEnabled) {
      robotLastTimestamp = timestamp;
      scheduleRobotFrame();
      return;
    }
    if (robotLastTimestamp !== null) {
      if (!animation.type && dragging === -1 && robotFleet) {
        window.RobotSwarm.update(robotFleet, Math.min(100, Math.max(0, timestamp - robotLastTimestamp)) / 1000);
      }
    }
    robotLastTimestamp = timestamp;
    requestDraw();
    scheduleRobotFrame();
  }

  function scheduleRobotFrame() {
    if (robotsVisible && !robotFramePending && !oceanEnabled) {
      robotFramePending = true;
      requestAnimationFrame(robotTick);
    }
  }

  if (robotToggle) robotToggle.addEventListener("click", () => {
    robotsVisible = !robotsVisible;
    if (robotsVisible) {
      robotLastTimestamp = null;
      planRobotFleet();
    } else {
      robotFleet = null;
      robotLastTimestamp = null;
    }
    robotToggle.textContent = robotsVisible ? "HIDE ROBOTS" : "SHOW ROBOTS";
    robotToggle.classList.toggle("is-active", robotsVisible);
    robotToggle.setAttribute("aria-pressed", String(robotsVisible));
    scheduleRobotFrame();
    requestDraw();
  });

  let animationSession = 0;
  const animation = {
    type: null,
    data: null,
    progress: 0,
    playing: false,
    lastTime: null
  };
  const buildButton = document.querySelector("#build-play");
  const sweepButton = document.querySelector("#sweep-play");
  const robotButton = document.querySelector("#robot-play");
  const pauseButton = document.querySelector("#animation-pause");
  const exitButton = document.querySelector("#animation-exit");
  const progressPanel = document.querySelector("#animation-panel");
  const progressInput = document.querySelector("#animation-scrub");
  const progressStatus = document.querySelector("#animation-status");

  function animationDuration() {
    return animation.type === "build" ?
      Math.max(8500, Math.min(24000, (animation.data?.frames.length || 0) * 85)) :
      animation.type === "robot" ? Math.max(4200, Math.min(16000, (animation.data?.pathLength || 700) * 10)) :
      10500;
  }

  function syncAnimationUI() {
    if (buildButton) buildButton.classList.toggle("is-active", animation.type === "build");
    if (sweepButton) sweepButton.classList.toggle("is-active", animation.type === "sweep");
    if (robotButton) robotButton.classList.toggle("is-active", animation.type === "robot");
    if (pauseButton) {
      pauseButton.hidden = !animation.type;
      pauseButton.textContent = animation.playing ? "PAUSE" : "RESUME";
    }
    if (exitButton) exitButton.hidden = !animation.type;
    if (progressPanel) progressPanel.hidden = !animation.type;
    if (progressInput) progressInput.value = String(Math.round(animation.progress * 1000));
  }

  function stopAnimation() {
    if (!animation.type) return;
    animationSession++;
    animation.type = null;
    animation.data = null;
    animation.playing = false;
    animation.lastTime = null;
    animation.progress = 0;
    syncAnimationUI();
    requestDraw();
  }

  function startAnimation(type) {
    if (!width || !height || (type === "robot" ? !window.RobotNavigationDemo : !window.VoronoiVisualization)) return;
    animationSession++;
    // Each playback uses a snapshot of the current point positions.
    animation.type = type;
    animation.data = type === "robot"
      ? window.RobotNavigationDemo.makeDemo(points, width, height)
      : type === "build"
        ? window.VoronoiVisualization.makeBuildData(points, width, height)
        : window.VoronoiVisualization.makeSweepData(points, width, height);
    animation.progress = 0;
    animation.playing = true;
    animation.lastTime = null;
    dragging = -1;
    hovered = -1;
    syncAnimationUI();
    requestDraw();
    const session = animationSession;
    requestAnimationFrame(timestamp => tickAnimation(timestamp, session));
  }

  function tickAnimation(timestamp, session) {
    if (session !== animationSession || !animation.type || !animation.playing) return;
    if (animation.lastTime !== null) {
      animation.progress = Math.min(1, animation.progress +
        Math.min(100, timestamp - animation.lastTime) / animationDuration());
    }
    animation.lastTime = timestamp;
    if (animation.progress >= 1) animation.playing = false;
    syncAnimationUI();
    requestDraw();
    if (animation.playing) requestAnimationFrame(time => tickAnimation(time, session));
  }

  if (buildButton) buildButton.addEventListener("click", () => startAnimation("build"));
  if (sweepButton) sweepButton.addEventListener("click", () => startAnimation("sweep"));
  if (robotButton) robotButton.addEventListener("click", () => startAnimation("robot"));
  if (pauseButton) pauseButton.addEventListener("click", () => {
    if (!animation.type) return;
    animationSession++;
    if (animation.progress >= 1) animation.progress = 0;
    animation.playing = !animation.playing;
    animation.lastTime = null;
    syncAnimationUI();
    if (animation.playing) requestAnimationFrame(time => tickAnimation(time, animationSession));
    requestDraw();
  });
  if (exitButton) exitButton.addEventListener("click", stopAnimation);
  if (progressInput) progressInput.addEventListener("input", () => {
    if (!animation.type) return;
    animationSession++;
    animation.progress = Number(progressInput.value) / 1000;
    animation.playing = false;
    animation.lastTime = null;
    syncAnimationUI();
    requestDraw();
  });


  // Create missing controls if cached HTML is older than this script.
  function ensureControls() {
    const bar = document.querySelector(".canvas-bar");
    let actions = document.querySelector(".canvas-actions");
    if (!actions && bar) {
      actions = document.createElement("div");
      actions.className = "canvas-actions";
      const oldHint = bar.querySelector(".canvas-hint");
      if (oldHint) actions.appendChild(oldHint);
      bar.appendChild(actions);
    }
    if (!actions) return {};

    function addButton(id, text, className, before = null) {
      let button = actions.querySelector("#" + id);
      if (!button) {
        button = document.createElement("button");
        button.id = id;
        button.type = "button";
        button.className = "view-toggle " + className;
        button.textContent = text;
        if (before) actions.insertBefore(button, before);
        else actions.appendChild(button);
      }
      return button;
    }

    const viewToggle = addButton("view-toggle", "SHOW DELAUNAY ↗", "diagram-toggle");
    const mapToggle = addButton("map-toggle", "MAP", "map-toggle", viewToggle);
    const addToggle = addButton("add-toggle", "ADD POINTS", "mode-toggle", viewToggle);
    const weightedButton = addButton("weighted-point-button", "ADD WEIGHTED", "weighted-button", viewToggle);
    const randomizeButton = addButton("randomize-button", "RANDOMIZE", "randomize-button", viewToggle);
    return {viewToggle, addToggle, weightedButton, randomizeButton, mapToggle, hintElement: actions.querySelector(".canvas-hint")};
  }

  const {viewToggle, addToggle, weightedButton, randomizeButton, mapToggle, hintElement} = ensureControls();

  // Fixed street-map view; tiles are loaded only while map mode is active.
  // This is a visual background, not a road-distance Voronoi computation.
  function updateMapTiles() {
    if (!mapEnabled || !mapTiles || !width || !height) return;
    const tileSize = 256, zoom = mapLocation.zoom, count = 2 ** zoom;
    const lat = mapLocation.latitude * Math.PI / 180;
    const centerX = ((mapLocation.longitude + 180) / 360) * count * tileSize;
    const centerY = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * count * tileSize;
    const left = centerX - width / 2, top = centerY - height / 2;
    const minX = Math.floor(left / tileSize), maxX = Math.floor((left + width) / tileSize);
    const minY = Math.floor(top / tileSize), maxY = Math.floor((top + height) / tileSize);
    const fragment = document.createDocumentFragment();
    for (let y = minY; y <= maxY; y++) {
      if (y < 0 || y >= count) continue;
      for (let x = minX; x <= maxX; x++) {
        const image = document.createElement("img");
        image.alt = "";
        image.decoding = "async";
        image.loading = "lazy";
        image.draggable = false;
        image.src = "https://tile.openstreetmap.org/" + zoom + "/" + ((x % count + count) % count) + "/" + y + ".png";
        image.style.left = (x * tileSize - left) + "px";
        image.style.top = (y * tileSize - top) + "px";
        fragment.appendChild(image);
      }
    }
    mapTiles.replaceChildren(fragment);
  }

  if (mapToggle) mapToggle.addEventListener("click", () => {
    mapEnabled = !mapEnabled;
    if (mapStage) mapStage.classList.toggle("map-on", mapEnabled);
    if (mapAttribution) mapAttribution.hidden = !mapEnabled;
    if (mapEnabled) updateMapTiles();
    else if (mapTiles) mapTiles.replaceChildren();
    syncControls();
    requestDraw();
  });


  function syncControls() {
    if (mapToggle) {
      mapToggle.classList.toggle("is-active", mapEnabled);
      mapToggle.setAttribute("aria-pressed", String(mapEnabled));
      mapToggle.setAttribute("aria-label", mapEnabled ? "Hide Amsterdam street map" : "Show Amsterdam street map");
    }
    if (viewToggle) {
      viewToggle.textContent = mode === "voronoi" ? "SHOW DELAUNAY ↗" : "SHOW VORONOI ↗";
      viewToggle.setAttribute("aria-label", mode === "voronoi" ? "Switch to Delaunay diagram" : "Switch to Voronoi diagram");
    }
    if (addToggle) {
      const adding = interactionMode === "add";
      addToggle.textContent = adding ? "DRAG MODE" : "ADD POINTS";
      addToggle.classList.toggle("is-active", adding);
      addToggle.setAttribute("aria-pressed", String(adding));
      addToggle.setAttribute("aria-label", adding ? "Switch to drag mode" : "Switch to add points mode");
    }
    if (hintElement) {
      const hintText = hintElement.querySelector(".hint-text");
      const message = interactionMode === "add" ? "CLICK OR TAP TO ADD A POINT" :
        mode === "voronoi" ? "DRAG ANY CELL TO EXPLORE" : "DRAG ANY POINT TO EXPLORE";
      if (hintText) hintText.textContent = message;
      else hintElement.textContent = message + " ↗";
    }
    canvas.setAttribute("aria-label", interactionMode === "add"
      ? "Tap or click the canvas to add a point to the " + mode + " diagram."
      : mode === "voronoi"
        ? "Voronoi diagram. Drag a region to reshape nearby cells."
        : "Delaunay diagram. Drag a point to reshape connected triangles.");
  }

  if (viewToggle) viewToggle.addEventListener("click", () => {
    stopAnimation();
    mode = mode === "voronoi" ? "delaunay" : "voronoi";
    dragging = -1;
    hovered = -1;
    syncControls();
    requestDraw();
  });

  if (addToggle) addToggle.addEventListener("click", () => {
    stopAnimation();
    interactionMode = interactionMode === "drag" ? "add" : "drag";
    dragging = -1;
    hovered = -1;
    syncControls();
    requestDraw();
  });

  // Site weights are in units of (min canvas dimension)^2. Positive weights
  // increase a site's power-diagram territory relative to weight-zero sites.
  if (weightedButton) weightedButton.addEventListener("click", () => {
    if (!width || !height) return;
    stopAnimation();
    const padding = .07;
    let candidate = null;
    for (let attempt = 0; attempt < 70; attempt++) {
      const test = {
        x: padding + Math.random() * (1 - padding * 2),
        y: padding + Math.random() * (1 - padding * 2)
      };
      // Keep sites distinct so the new region is clearly visible.
      if (points.every(p => Math.hypot((p.x - test.x) * width, (p.y - test.y) * height) >= 36)) {
        candidate = test;
        break;
      }
    }
    if (!candidate) return;
    candidate.weight = .025 + Math.random() * .055;
    points.push(candidate);
    dragging = -1;
    hovered = -1;
    if (robotsVisible) planRobotFleet();
    requestDraw();
  });

  if (randomizeButton) randomizeButton.addEventListener("click", () => {
    stopAnimation();
    // Weighted sites exist only when explicitly added. Clear them on randomize,
    // preserving all ordinary sites before redistributing their positions.
    for (let i = points.length - 1; i >= 0; i--) {
      if ((points[i].weight || 0) !== 0) points.splice(i, 1);
    }
    const randomized = [];
    const padding = 0.055;
    const minDistance = Math.min(26, Math.min(width, height) * 0.045);
    for (let i = 0; i < points.length; i++) {
      let candidate;
      for (let attempt = 0; attempt < 40; attempt++) {
        candidate = {
          x: padding + Math.random() * (1 - padding * 2),
          y: padding + Math.random() * (1 - padding * 2)
        };
        if (randomized.every(p => Math.hypot((p.x - candidate.x) * width,
          (p.y - candidate.y) * height) >= minDistance)) break;
      }
      randomized.push(candidate);
    }
    randomized.forEach((p, i) => {
      points[i].x = p.x;
      points[i].y = p.y;
    });
    dragging = -1;
    hovered = -1;
    if (robotsVisible) planRobotFleet();
    requestDraw();
  });

  syncControls();

  function clip(poly, a, b, c) {
    const result = [];
    for (let i = 0; i < poly.length; i++) {
      const start = poly[i];
      const end = poly[(i + 1) % poly.length];
      const ds = a * start.x + b * start.y - c;
      const de = a * end.x + b * end.y - c;
      const insideS = ds <= 1e-8;
      const insideE = de <= 1e-8;
      if (insideS !== insideE) {
        const t = ds / (ds - de);
        result.push({x:start.x + t * (end.x-start.x),y:start.y + t * (end.y-start.y)});
      }
      if (insideE) result.push(end);
    }
    return result;
  }

  function cell(index) {
    const p = points[index];
    let poly = [{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
    const px = p.x*width, py=p.y*height;
    for (let j=0;j<points.length && poly.length;j++) {
      if (j===index) continue;
      const qx=points[j].x*width, qy=points[j].y*height;
      const a=2*(qx-px), b=2*(qy-py);
      const scale = Math.min(width, height) ** 2;
      const c=qx*qx+qy*qy-px*px-py*py+
        ((p.weight || 0) - (points[j].weight || 0)) * scale;
      poly=clip(poly,a,b,c);
    }
    return poly;
  }

  // Delaunay triangulation is the geometric dual of the Voronoi diagram.
  // Bowyer-Watson reconstructs triangles from the same draggable sites.
  function circumcircle(a, b, c) {
    const determinant = 2 * (a.x * (b.y - c.y) +
      b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(determinant) < 1e-7) return null;

    const a2 = a.x * a.x + a.y * a.y;
    const b2 = b.x * b.x + b.y * b.y;
    const c2 = c.x * c.x + c.y * c.y;
    const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / determinant;
    const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / determinant;
    return {x, y, r2: (x - a.x) ** 2 + (y - a.y) ** 2};
  }

  function delaunayTriangles() {
    const vertices = points.map(p => ({x: p.x * width, y: p.y * height}));
    const count = vertices.length;
    const span = Math.max(width, height) * 12;
    const midX = width / 2, midY = height / 2;
    vertices.push(
      {x: midX - 2 * span, y: midY - span},
      {x: midX, y: midY + 2 * span},
      {x: midX + 2 * span, y: midY - span}
    );

    let triangles = [[count, count + 1, count + 2]];
    for (let i = 0; i < count; i++) {
      const point = vertices[i];

      // Duplicate sites are not separate triangulation vertices.
      if (vertices.slice(0, i).some(other =>
        (other.x - point.x) ** 2 + (other.y - point.y) ** 2 < 0.0625)) continue;

      const boundary = new Map();
      const remaining = [];
      for (const triangle of triangles) {
        const circle = circumcircle(...triangle.map(index => vertices[index]));
        if (circle &&
          (point.x - circle.x) ** 2 + (point.y - circle.y) ** 2 <= circle.r2 + 1e-4) {
          const sides = [
            [triangle[0], triangle[1]],
            [triangle[1], triangle[2]],
            [triangle[2], triangle[0]]
          ];
          for (const [a, b] of sides) {
            const key = a < b ? `${a}:${b}` : `${b}:${a}`;
            if (boundary.has(key)) boundary.get(key).count++;
            else boundary.set(key, {a, b, count: 1});
          }
        } else {
          remaining.push(triangle);
        }
      }

      triangles = remaining;
      for (const {a, b, count: shared} of boundary.values()) {
        const cross = (vertices[b].x - vertices[a].x) * (point.y - vertices[a].y) -
          (vertices[b].y - vertices[a].y) * (point.x - vertices[a].x);
        if (shared === 1 && Math.abs(cross) > 1e-7) triangles.push([a, b, i]);
      }
    }

    return {vertices, triangles: triangles.filter(triangle =>
      triangle.every(index => index < count))};
  }


  // The dual of a weighted power diagram is a regular triangulation.
  // For weighted configurations, derive the edges from shared power-cell
  // boundaries instead of using the ordinary unweighted Bowyer-Watson mesh.
  function regularEdges() {
    const scale = Math.min(width, height) ** 2;
    const sites = points.map(p => ({x:p.x*width, y:p.y*height, w:(p.weight||0)*scale}));
    const seen = new Set(), edges = [];
    for (let i = 0; i < sites.length; i++) {
      const poly = cell(i);
      if (poly.length < 2) continue;
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        if (Math.hypot(a.x-b.x,a.y-b.y) < 1) continue;
        const mx=(a.x+b.x)*.5,my=(a.y+b.y)*.5;
        const reference=(mx-sites[i].x)**2+(my-sites[i].y)**2-sites[i].w;
        for (let j=0; j<sites.length; j++) {
          if (i===j) continue;
          const other=(mx-sites[j].x)**2+(my-sites[j].y)**2-sites[j].w;
          if (Math.abs(reference-other) > .02) continue;
          const key=Math.min(i,j)+":"+Math.max(i,j);
          if (!seen.has(key)) {
            seen.add(key);
            edges.push([i,j]);
          }
          break;
        }
      }
    }
    return {sites,edges};
  }

  function drawDelaunay() {
    if (!mapEnabled) {
      ctx.fillStyle = "#f0efe9";
      ctx.fillRect(0, 0, width, height);
    }

    if (points.some(p => (p.weight || 0) > 0)) {
      const {sites, edges} = regularEdges();
      ctx.lineWidth = 1.7;
      ctx.strokeStyle = "#526d62";
      for (const [a,b] of edges) {
        ctx.beginPath();
        ctx.moveTo(sites[a].x, sites[a].y);
        ctx.lineTo(sites[b].x, sites[b].y);
        ctx.stroke();
      }
      return;
    }
    const {vertices, triangles} = delaunayTriangles();
    for (const [a, b, c] of triangles) {
      ctx.beginPath();
      ctx.moveTo(vertices[a].x, vertices[a].y);
      ctx.lineTo(vertices[b].x, vertices[b].y);
      ctx.lineTo(vertices[c].x, vertices[c].y);
      ctx.closePath();
      ctx.globalAlpha = mapEnabled ? 0.33 : 0.48;
      ctx.fillStyle = colors[(a * 3 + b * 5 + c * 7) % colors.length];
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "#71877c";
      ctx.stroke();
    }
  }

  function draw() {
    frameRequested=false;
    if (oceanEnabled && oceanWorld && window.OceanSurvey) {
      window.OceanSurvey.draw(ctx, oceanWorld);
      return;
    }
    if (animation.type && animation.data && window.VoronoiVisualization) {
      const message = animation.type === "robot"
        ? window.RobotNavigationDemo.draw(ctx, animation.data,
          animation.progress, width, height, mapEnabled)
        : animation.type === "build"
          ? window.VoronoiVisualization.drawBuild(ctx, animation.data,
            animation.progress, width, height, colors, mapEnabled)
          : window.VoronoiVisualization.drawSweep(ctx, animation.data,
            animation.progress, width, height, colors, mapEnabled);
      if (progressStatus) progressStatus.textContent = message;
      return;
    }
    ctx.clearRect(0,0,width,height);
    if (mode === "voronoi") {
    for (let i=0;i<points.length;i++) {
      const poly=cell(i);
      if (!poly.length) continue;
      ctx.beginPath();
      ctx.moveTo(poly[0].x,poly[0].y);
      for (let j=1;j<poly.length;j++) ctx.lineTo(poly[j].x,poly[j].y);
      ctx.closePath();
      ctx.fillStyle=colors[i%colors.length];
      ctx.globalAlpha = mapEnabled ? 0.42 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth=2.25;
      ctx.strokeStyle="#f6f4ed";
      ctx.stroke();
    }
    } else {
      drawDelaunay();
    }
    if (robotsVisible && robotFleet && !animation.type && window.RobotSwarm) {
      window.RobotSwarm.draw(ctx, robotFleet);
    }
    for(let i=0;i<points.length;i++){
      const x=points[i].x*width, y=points[i].y*height;
      const active=i===dragging || i===hovered;
      if(active){
        ctx.beginPath();ctx.arc(x,y,15,0,TAU);
        ctx.fillStyle="rgba(255,255,255,.22)";ctx.fill();
        ctx.lineWidth=1.25;ctx.strokeStyle="rgba(41,58,49,.4)";ctx.stroke();
      }
      ctx.beginPath();ctx.arc(x,y,4.5,0,TAU);
      ctx.fillStyle="#f9f8f2";ctx.fill();
      ctx.lineWidth=1.8;ctx.strokeStyle="#354c41";ctx.stroke();

      if (points[i].weight) {
        // Distinct halo and numeric strength distinguish weighted sites.
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, TAU);
        ctx.lineWidth=1.8;
        ctx.strokeStyle="#b45434";
        ctx.stroke();
        ctx.font="bold 11px Arial, sans-serif";
        ctx.textBaseline="middle";
        ctx.textAlign="left";
        const label="W "+(points[i].weight*100).toFixed(1);
        const labelX=x+14, labelY=y-15;
        ctx.lineWidth=3;
        ctx.strokeStyle="rgba(249,248,242,.95)";
        ctx.strokeText(label,labelX,labelY);
        ctx.fillStyle="#844125";
        ctx.fillText(label,labelX,labelY);
      }
    }
    canvas.style.cursor = interactionMode === "add" ? "crosshair" : dragging !== -1 ? "grabbing" :
      (mode === "voronoi" || hovered !== -1 ? "grab" : "default");
  }

  function requestDraw(){
    if(frameRequested)return;
    frameRequested=true;
    requestAnimationFrame(draw);
  }

  function resize(){
    if (animation.type) stopAnimation();
    const rect=canvas.getBoundingClientRect();
    width=rect.width;height=rect.height;
    if(!width || !height)return;
    dpr=Math.min(window.devicePixelRatio || 1,2);
    canvas.width=Math.round(width*dpr);
    canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    updateMapTiles();
    if (oceanEnabled && window.OceanSurvey) {
      oceanWorld = window.OceanSurvey.create(width, height, oceanWorld);
      oceanLastTimestamp = null;
      refreshOceanDashboard();
    }
    if (robotsVisible) {
      robotLastTimestamp = null;
      planRobotFleet();
    }
    requestDraw();
  }

  function position(event) {
    const r=canvas.getBoundingClientRect();
    return {x:event.clientX-r.left,y:event.clientY-r.top};
  }

  // A Voronoi region belongs to the closest site, so the whole cell is draggable.
  function nearest(x,y){
    let best=-1, dist=Infinity;
    points.forEach((p,i)=>{
      const dx=x-p.x*width,dy=y-p.y*height;
      const d=dx*dx+dy*dy;
      if(d<dist){dist=d;best=i;}
    });
    return mode === "delaunay" && dist > 30 * 30 ? -1 : best;
  }

  canvas.addEventListener("pointerdown",event=>{
    if (oceanEnabled && oceanWorld && window.OceanSurvey) {
      const pos = position(event);
      const selected = oceanWorld.stations.findIndex(p => Math.hypot(p.x-pos.x,p.y-pos.y)<19);
      if (selected !== -1) {
        oceanDraggingStation = selected;
        canvas.setPointerCapture(event.pointerId);
      } else if (oceanStationPlacement && window.OceanSurvey.addStation(oceanWorld,pos.x,pos.y)) {
        oceanStationPlacement = false;
        syncOceanControls();
        if (oceanHelp) oceanHelp.textContent = "Priority station deployed. Survey transects have been reprioritized.";
      }
      refreshOceanDashboard();
      requestDraw();
      return;
    }
    if (animation.type) return;
    if(event.button!==0 && event.pointerType==="mouse")return;
    const pos=position(event);
    if (interactionMode === "add") {
      if (!width || !height) return;
      // Avoid coincident sites, which cannot form independent Voronoi cells.
      const tooClose = points.some(p => Math.hypot(p.x * width - pos.x,
        p.y * height - pos.y) < 9);
      if (tooClose) return;
      points.push({
        x: Math.max(0.005, Math.min(0.995, pos.x / width)),
        y: Math.max(0.005, Math.min(0.995, pos.y / height))
      });
      hovered = -1;
      if (robotsVisible) planRobotFleet();
      requestDraw();
      return;
    }
    dragging=nearest(pos.x,pos.y);
    if (dragging === -1) return;
    hovered=dragging;
    dragOffset={x:points[dragging].x*width-pos.x,y:points[dragging].y*height-pos.y};
    canvas.setPointerCapture(event.pointerId);
    requestDraw();
  });
  canvas.addEventListener("pointermove",event=>{
    if (oceanEnabled && oceanWorld) {
      if (oceanDraggingStation !== -1) {
        const pos=position(event);
        if (window.OceanSurvey.moveStation(oceanWorld,oceanDraggingStation,pos.x,pos.y)) {
          requestDraw();
        }
      }
      return;
    }
    if (animation.type || interactionMode === "add") return;
    const pos=position(event);
    if(dragging!==-1){
      const margin=3;
      points[dragging].x=Math.max(margin/width,Math.min(1-margin/width,(pos.x+dragOffset.x)/width));
      points[dragging].y=Math.max(margin/height,Math.min(1-margin/height,(pos.y+dragOffset.y)/height));
      requestDraw();
    }else{
      const next=nearest(pos.x,pos.y);
      if(next!==hovered){hovered=next;requestDraw();}
    }
  });
  function release(){
    if (oceanDraggingStation !== -1 && oceanWorld) {
      oceanDraggingStation = -1;
      window.OceanSurvey.resetRoutes(oceanWorld);
      refreshOceanDashboard();
      requestDraw();
      return;
    }
    if(dragging!==-1){
      dragging=-1;
      if (robotsVisible) planRobotFleet();
      requestDraw();
    }
  }
  canvas.addEventListener("pointerup",release);
  canvas.addEventListener("pointercancel",release);
  canvas.addEventListener("lostpointercapture",release);
  canvas.addEventListener("pointerleave",()=>{
    if (oceanEnabled) return;
    if(dragging===-1){hovered=-1;requestDraw();}
  });
  if("ResizeObserver" in window)new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize",resize);
  resize();
})();
