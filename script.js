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
  const animation = {
    type: null,
    data: null,
    progress: 0,
    playing: false,
    lastTime: null
  };
  const buildButton = document.querySelector("#build-play");
  const sweepButton = document.querySelector("#sweep-play");
  const pauseButton = document.querySelector("#animation-pause");
  const exitButton = document.querySelector("#animation-exit");
  const progressPanel = document.querySelector("#animation-panel");
  const progressInput = document.querySelector("#animation-scrub");
  const progressStatus = document.querySelector("#animation-status");

  function animationDuration() {
    return animation.type === "build" ?
      Math.max(8500, Math.min(24000, (animation.data?.frames.length || 0) * 85)) :
      10500;
  }

  function syncAnimationUI() {
    if (buildButton) buildButton.classList.toggle("is-active", animation.type === "build");
    if (sweepButton) sweepButton.classList.toggle("is-active", animation.type === "sweep");
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
    animation.type = null;
    animation.data = null;
    animation.playing = false;
    animation.lastTime = null;
    animation.progress = 0;
    syncAnimationUI();
    requestDraw();
  }

  function startAnimation(type) {
    if (!window.VoronoiVisualization || !width || !height) return;
    // Each playback uses a snapshot of the current point positions.
    animation.type = type;
    animation.data = type === "build"
      ? window.VoronoiVisualization.makeBuildData(points, width, height)
      : window.VoronoiVisualization.makeSweepData(points, width, height);
    animation.progress = 0;
    animation.playing = true;
    animation.lastTime = null;
    dragging = -1;
    hovered = -1;
    syncAnimationUI();
    requestDraw();
    requestAnimationFrame(tickAnimation);
  }

  function tickAnimation(timestamp) {
    if (!animation.type || !animation.playing) return;
    if (animation.lastTime !== null) {
      animation.progress = Math.min(1, animation.progress +
        Math.min(100, timestamp - animation.lastTime) / animationDuration());
    }
    animation.lastTime = timestamp;
    if (animation.progress >= 1) animation.playing = false;
    syncAnimationUI();
    requestDraw();
    if (animation.playing) requestAnimationFrame(tickAnimation);
  }

  if (buildButton) buildButton.addEventListener("click", () => startAnimation("build"));
  if (sweepButton) sweepButton.addEventListener("click", () => startAnimation("sweep"));
  if (pauseButton) pauseButton.addEventListener("click", () => {
    if (!animation.type) return;
    if (animation.progress >= 1) animation.progress = 0;
    animation.playing = !animation.playing;
    animation.lastTime = null;
    syncAnimationUI();
    if (animation.playing) requestAnimationFrame(tickAnimation);
    requestDraw();
  });
  if (exitButton) exitButton.addEventListener("click", stopAnimation);
  if (progressInput) progressInput.addEventListener("input", () => {
    if (!animation.type) return;
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
    const addToggle = addButton("add-toggle", "ADD POINTS", "mode-toggle", viewToggle);
    const randomizeButton = addButton("randomize-button", "RANDOMIZE", "randomize-button", viewToggle);
    return {viewToggle, addToggle, randomizeButton, hintElement: actions.querySelector(".canvas-hint")};
  }

  const {viewToggle, addToggle, randomizeButton, hintElement} = ensureControls();

  function syncControls() {
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

  if (randomizeButton) randomizeButton.addEventListener("click", () => {
    stopAnimation();
    // Preserve the existing number of points, but spread them to new positions.
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
      const c=qx*qx+qy*qy-px*px-py*py;
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

  function drawDelaunay() {
    ctx.fillStyle = "#f0efe9";
    ctx.fillRect(0, 0, width, height);

    const {vertices, triangles} = delaunayTriangles();
    for (const [a, b, c] of triangles) {
      ctx.beginPath();
      ctx.moveTo(vertices[a].x, vertices[a].y);
      ctx.lineTo(vertices[b].x, vertices[b].y);
      ctx.lineTo(vertices[c].x, vertices[c].y);
      ctx.closePath();
      ctx.globalAlpha = 0.48;
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
    if (animation.type && animation.data && window.VoronoiVisualization) {
      const message = animation.type === "build"
        ? window.VoronoiVisualization.drawBuild(ctx, animation.data,
          animation.progress, width, height, colors)
        : window.VoronoiVisualization.drawSweep(ctx, animation.data,
          animation.progress, width, height, colors);
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
      ctx.fill();
      ctx.lineWidth=2.25;
      ctx.strokeStyle="#f6f4ed";
      ctx.stroke();
    }
    } else {
      drawDelaunay();
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
    if(dragging!==-1){dragging=-1;requestDraw();}
  }
  canvas.addEventListener("pointerup",release);
  canvas.addEventListener("pointercancel",release);
  canvas.addEventListener("lostpointercapture",release);
  canvas.addEventListener("pointerleave",()=>{
    if(dragging===-1){hovered=-1;requestDraw();}
  });
  if("ResizeObserver" in window)new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize",resize);
  resize();
})();
