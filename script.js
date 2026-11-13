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

  function draw() {
    frameRequested=false;
    ctx.clearRect(0,0,width,height);
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
  }

  function requestDraw(){
    if(frameRequested)return;
    frameRequested=true;
    requestAnimationFrame(draw);
  }

  function resize(){
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
    return best;
  }

  canvas.addEventListener("pointerdown",event=>{
    if(event.button!==0 && event.pointerType==="mouse")return;
    const pos=position(event);
    dragging=nearest(pos.x,pos.y);
    hovered=dragging;
    dragOffset={x:points[dragging].x*width-pos.x,y:points[dragging].y*height-pos.y};
    canvas.setPointerCapture(event.pointerId);
    requestDraw();
  });
  canvas.addEventListener("pointermove",event=>{
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
