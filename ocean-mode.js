/* Ocean Mode — a fictional coastal research mission.
 * Synthetic shoreline and depths; no real bathymetry or navigation data.
 * Four AUVs use Voronoi zones and parallel survey transects.
 */
(() => {
  "use strict";
  const TAU = Math.PI * 2;
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const palette = ["#3dc4d2","#93d48d","#e8c078","#d39be0"];
  const seedPositions = [[.38,.24],[.73,.26],[.40,.76],[.76,.74]];
  const speeds = [94,87,90,82];

  function shoreline(y,w,h) {
    const t = y / h;
    return w * (.135 + .026 * Math.sin(t * 7.8 + .1)
      + .022 * Math.sin(t * 16 - .7) + .038 * (t - .5));
  }
  function offshore(world,p,pad=17) {
    return p.x > shoreline(p.y,world.width,world.height)+pad &&
      p.x < world.width-16 && p.y>15 && p.y<world.height-15;
  }

  function clip(poly,a,b,c) {
    const output=[];
    for(let i=0;i<poly.length;i++){
      const p=poly[i],q=poly[(i+1)%poly.length];
      const da=a*p.x+b*p.y-c,db=a*q.x+b*q.y-c;
      const pin=da<=1e-7,qin=db<=1e-7;
      if(pin!==qin){
        const t=da/(da-db);
        output.push({x:p.x+t*(q.x-p.x),y:p.y+t*(q.y-p.y)});
      }
      if(qin)output.push(q);
    }
    return output;
  }
  function zones(world) {
    const sites=world.sites;
    return sites.map((p,i)=>{
      let polygon=[{x:0,y:0},{x:world.width,y:0},
        {x:world.width,y:world.height},{x:0,y:world.height}];
      for(let j=0;j<sites.length&&polygon.length;j++){
        if(i===j)continue;
        const q=sites[j];
        polygon=clip(polygon,2*(q.x-p.x),2*(q.y-p.y),
          q.x*q.x+q.y*q.y-p.x*p.x-p.y*p.y);
      }
      return polygon;
    });
  }

  function transect(world,poly,y) {
    const xs=[];
    for(let k=0;k<poly.length;k++){
      const a=poly[k],b=poly[(k+1)%poly.length];
      if(Math.abs(a.y-b.y)<1e-9)continue;
      if(y>=Math.min(a.y,b.y)&&y<Math.max(a.y,b.y)){
        xs.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));
      }
    }
    if(xs.length<2)return null;
    const start=Math.max(Math.min(...xs)+7,shoreline(y,world.width,world.height)+27);
    const end=Math.min(Math.max(...xs)-7,world.width-24);
    return end-start>=27?{y,left:start,right:end}:null;
  }
  function priority(world,track) {
    let weight=0;
    const center={x:(track.left+track.right)/2,y:track.y};
    for(const station of world.stations){
      const dx=center.x-station.x,dy=center.y-station.y;
      const range=Math.max(65,world.width*.2);
      weight+=station.strength*Math.exp(-(dx*dx+dy*dy)/(2*range*range));
    }
    return weight;
  }
  function tracksFor(world,polygon) {
    const tracks=[];
    const gap=clamp(world.height/24,18,26);
    for(let y=gap*1.4;y<world.height-gap;y+=gap){
      const line=transect(world,polygon,y);
      if(line)tracks.push(line);
    }
    if(world.stations.length){
      // Survey the most scientifically interesting transects first.
      tracks.sort((a,b)=>priority(world,b)-priority(world,a));
    }
    return tracks;
  }
  function makeWaypoints(world,bot) {
    const lines=tracksFor(world,world.polygons[bot.id]);
    const path=[];
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      const left={x:line.left,y:line.y},right={x:line.right,y:line.y};
      const a=i%2===0?left:right,b=i%2===0?right:left;
      if(path.length){
        // Transit between transects through the offshore side when necessary.
        const old=path[path.length-1];
        const coastSafety=Math.max(
          shoreline(old.y,world.width,world.height),
          shoreline(a.y,world.width,world.height)
        )+38;
        const crossingX=clamp(Math.max(old.x,a.x,coastSafety),coastSafety,world.width-22);
        if(!offshore(world,{x:(old.x+crossingX)*.5,y:old.y},12)){
          path.push({x:crossingX,y:old.y,survey:false});
        }
        if(Math.abs(old.y-a.y)>gapDistance(world)||dist(old,a)>world.width*.25){
          path.push({x:crossingX,y:old.y,survey:false});
          path.push({x:crossingX,y:a.y,survey:false});
        }
      }
      path.push({...a,survey:true});
      path.push({...b,survey:true});
    }
    return path;
  }
  function gapDistance(world) {return Math.max(24,world.height/20);}
  function makeSamples(world) {
    const step=clamp(Math.min(world.width,world.height)/28,13,20);
    const samples=[];
    for(let y=step;y<world.height-step/2;y+=step){
      for(let x=step;x<world.width-step/2;x+=step){
        const p={x,y};
        if(!offshore(world,p,24))continue;
        let owner=0,best=Infinity;
        for(let i=0;i<world.sites.length;i++){
          const d=dist(p,world.sites[i]);
          if(d<best){best=d;owner=i;}
        }
        let importance=1;
        for(const station of world.stations){
          const d=dist(p,station),r=clamp(world.width*.22,65,180);
          importance+=station.strength*2.3*Math.exp(-d*d/(2*r*r));
        }
        samples.push({x,y,owner,importance,scanned:false});
      }
    }
    return samples;
  }

  function rebuild(world,priorBots=null) {
    world.sites=seedPositions.map(([x,y])=>({x:x*world.width,y:y*world.height}));
    world.polygons=zones(world);
    world.samples=makeSamples(world);
    world.vehicles=world.sites.map((site,id)=>{
      const prev=priorBots?.[id];
      const start=prev?{x:prev.position.x/priorBots.width*world.width,
          y:prev.position.y/priorBots.height*world.height}:site;
      const position=offshore(world,start,28)?{...start}:{...site};
      const bot={id,name:"AUV "+(id+1),color:palette[id],position,
        angle:0,battery:prev?.battery??100,distance:prev?.distance??0,
        waypoint:0,route:[],speed:speeds[id]*clamp(world.width/950,.68,1.10),
        completed:false,hold:0};
      bot.route=makeWaypoints(world,bot);
      if(bot.route.length===0)bot.completed=true;
      return bot;
    });
  }
  function create(w,h,old=null) {
    const world={width:w,height:h,elapsed:old?.elapsed??0,paused:false,
      stations:old?old.stations.map(p=>({
        x:p.x/old.width*w,y:p.y/old.height*h,strength:p.strength
      })):[],
      vehicles:[],samples:[],sites:[],polygons:[],mission:"COASTAL SHELF / SIMULATION"};
    const prior=old?Object.assign(old.vehicles.map(b=>b),{width:old.width,height:old.height}):null;
    rebuild(world,prior);
    return world;
  }
  function addStation(world,x,y) {
    const p={x,y};
    if(!offshore(world,p,35) || world.stations.length>=10)return false;
    const strength=.8+Math.random()*1.7;
    world.stations.push({x,y,strength});
    resetRoutes(world);
    return true;
  }
  function moveStation(world,index,x,y) {
    if(index<0||index>=world.stations.length)return false;
    if(!offshore(world,{x,y},35))return false;
    world.stations[index].x=x;
    world.stations[index].y=y;
    return true;
  }
  function resetRoutes(world) {
    world.samples=makeSamples(world);
    for(const bot of world.vehicles){
      const oldRoute=bot.route;
      bot.route=makeWaypoints(world,bot);
      bot.waypoint=0;
      bot.completed=!bot.route.length;
      bot.hold=0;
      // Maintain the current vehicle position; only upcoming legs are rebuilt.
      if(!oldRoute.length)bot.battery=Math.max(0,bot.battery);
    }
  }
  function segmentClear(world,a,b,pad=20) {
    const steps=Math.max(2,Math.ceil(dist(a,b)/16));
    for(let k=0;k<=steps;k++){
      const t=k/steps;
      if(!offshore(world,{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},pad))return false;
    }
    return true;
  }
  function waypointMove(world,bot,dt) {
    if(bot.completed||bot.battery<=0)return {...bot.position};
    while(bot.waypoint<bot.route.length &&
      dist(bot.position,bot.route[bot.waypoint])<Math.max(4,bot.speed*dt*.85)){
      bot.waypoint++;
    }
    if(bot.waypoint>=bot.route.length){bot.completed=true;return {...bot.position};}
    const destination=bot.route[bot.waypoint];
    const d=dist(bot.position,destination),step=Math.min(d,bot.speed*dt);
    if(d<.001)return {...bot.position};
    const next={x:bot.position.x+(destination.x-bot.position.x)*step/d,
      y:bot.position.y+(destination.y-bot.position.y)*step/d};
    return segmentClear(world,bot.position,next,15)?next:{...bot.position};
  }
  function update(world,seconds) {
    if(world.paused)return;
    const total=clamp(seconds,0,.10);
    const iterations=Math.max(1,Math.ceil(total/.025));
    const dt=total/iterations;
    for(let n=0;n<iterations;n++){
      world.elapsed+=dt;
      const current=world.vehicles.map(b=>({...b.position}));
      const next=world.vehicles.map(b=>waypointMove(world,b,dt));
      // Yield before vehicles intersect; this is simplified local collision
      // avoidance for the visual simulator, not ocean vehicle control.
      for(let i=0;i<world.vehicles.length;i++){
        for(let j=i+1;j<world.vehicles.length;j++){
          const clearance=21;
          if(dist(next[i],next[j])>=clearance&&dist(next[i],current[j])>=clearance
            &&dist(next[j],current[i])>=clearance)continue;
          const yieldId=(Math.floor(world.elapsed/2)+i+j)%2?i:j;
          next[yieldId]=current[yieldId];
          if(dist(next[i],next[j])<clearance){
            next[i]=current[i];next[j]=current[j];
          }
        }
      }
      for(let i=0;i<world.vehicles.length;i++){
        const bot=world.vehicles[i],p=next[i],moved=dist(p,current[i]);
        if(moved>.0001)bot.angle=Math.atan2(p.y-current[i].y,p.x-current[i].x);
        bot.position=p;
        bot.distance+=moved;
        bot.battery=Math.max(0,bot.battery-moved*.018);
        if(!moved&&!bot.completed){bot.hold+=dt;}else{bot.hold=0;}
        if(bot.hold>2.4){
          // Skip a blocked transit leg to keep the demo moving.
          bot.waypoint=Math.min(bot.waypoint+1,bot.route.length);
          bot.hold=0;
        }
      }
      for(const sample of world.samples){
        if(sample.scanned)continue;
        const bot=world.vehicles[sample.owner];
        if(bot && dist(bot.position,sample)<Math.max(20,Math.min(world.width,world.height)*.042)){
          sample.scanned=true;
        }
      }
    }
  }
  function stats(world) {
    const total=world.samples.reduce((s,p)=>s+p.importance,0);
    const done=world.samples.reduce((s,p)=>s+(p.scanned?p.importance:0),0);
    return {
      coverage:total?Math.round(done/total*100):0,
      distance:Math.round(world.vehicles.reduce((s,v)=>s+v.distance,0)),
      battery:Math.round(world.vehicles.reduce((s,v)=>s+v.battery,0)/Math.max(1,world.vehicles.length)),
      elapsed:Math.floor(world.elapsed),
      stations:world.stations.length,
      complete:world.vehicles.every(v=>v.completed||v.battery<=0)
    };
  }
  function draw(ctx,world) {
    const w=world.width,h=world.height;
    ctx.save();
    ctx.clearRect(0,0,w,h);
    const ocean=ctx.createLinearGradient(0,0,w,h);
    ocean.addColorStop(0,"#7cb6c2");
    ocean.addColorStop(.38,"#3e829c");
    ocean.addColorStop(1,"#16475f");
    ctx.fillStyle=ocean;ctx.fillRect(0,0,w,h);
    for(let band=1;band<=7;band++){
      ctx.beginPath();
      for(let y=0;y<=h+6;y+=6){
        const x=shoreline(y,w,h)+band*w*.112+
          Math.sin(y/h*6+band)*w*.012;
        if(y===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.strokeStyle="rgba(225,247,247,"+(0.15-band*.012)+")";
      ctx.lineWidth=band%2?1.4:.9;ctx.stroke();
    }
    // Faint survey zone fills and shared boundaries.
    for(let i=0;i<world.polygons.length;i++){
      const poly=world.polygons[i];if(!poly.length)continue;
      ctx.beginPath();ctx.moveTo(poly[0].x,poly[0].y);
      for(let j=1;j<poly.length;j++)ctx.lineTo(poly[j].x,poly[j].y);
      ctx.closePath();ctx.fillStyle=palette[i];ctx.globalAlpha=.075;ctx.fill();
      ctx.globalAlpha=1;
      ctx.lineWidth=1.4;ctx.setLineDash([8,7]);
      ctx.strokeStyle="rgba(215,246,248,.56)";ctx.stroke();ctx.setLineDash([]);
    }
    // Coast masks the western side. Coastline is illustrative, not measured.
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(shoreline(0,w,h),0);
    for(let y=5;y<=h+5;y+=5)ctx.lineTo(shoreline(Math.min(y,h),w,h),Math.min(y,h));
    ctx.lineTo(0,h);ctx.closePath();
    ctx.fillStyle="#c6ceb6";ctx.fill();
    ctx.lineWidth=4;ctx.strokeStyle="#f5e5c6";ctx.stroke();
    ctx.save();ctx.font="bold 11px Arial,sans-serif";
    ctx.fillStyle="rgba(38,76,77,.85)";ctx.textAlign="left";
    ctx.fillText("COAST",Math.min(w*.028,24),Math.min(h*.45,240));
    ctx.restore();

    // Coverage sample dots: teal indicates observed locations.
    for(const p of world.samples){
      ctx.beginPath();ctx.arc(p.x,p.y,p.scanned?2.3:1.2,0,TAU);
      ctx.fillStyle=p.scanned?"rgba(174,247,208,.82)":"rgba(220,241,241,.18)";
      ctx.fill();
    }
    for(let i=0;i<world.sites.length;i++){
      const p=world.sites[i];ctx.beginPath();
      ctx.arc(p.x,p.y,7,0,TAU);ctx.strokeStyle=palette[i];ctx.lineWidth=2;ctx.stroke();
      ctx.save();ctx.font="bold 11px Arial,sans-serif";
      ctx.textAlign="center";ctx.fillStyle="#f0fcfb";
      ctx.fillText("ZONE "+(i+1),p.x,p.y-15);ctx.restore();
    }
    for(const s of world.stations){
      const radius=clamp(w*.13,55,110);
      ctx.beginPath();ctx.arc(s.x,s.y,radius,0,TAU);
      ctx.strokeStyle="rgba(255,208,137,.42)";ctx.lineWidth=1.3;
      ctx.setLineDash([5,7]);ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(s.x,s.y,9,0,TAU);
      ctx.fillStyle="#f5bc70";ctx.fill();ctx.lineWidth=2;ctx.strokeStyle="#fff8e6";ctx.stroke();
      ctx.save();ctx.font="bold 11px Arial,sans-serif";
      ctx.textAlign="center";ctx.fillStyle="#fff5dc";
      ctx.fillText("PRIORITY ×"+s.strength.toFixed(1),s.x,s.y-17);ctx.restore();
    }
    for(const v of world.vehicles){
      if(v.route.length&& !v.completed){
        ctx.beginPath();ctx.moveTo(v.position.x,v.position.y);
        for(let i=v.waypoint;i<Math.min(v.waypoint+9,v.route.length);i++){
          ctx.lineTo(v.route[i].x,v.route[i].y);
        }
        ctx.setLineDash([6,7]);ctx.lineWidth=1.9;
        ctx.strokeStyle=v.color;ctx.globalAlpha=.55;ctx.stroke();
        ctx.setLineDash([]);ctx.globalAlpha=1;
      }
      ctx.save();ctx.translate(v.position.x,v.position.y);ctx.rotate(v.angle);
      ctx.beginPath();ctx.arc(0,0,13,0,TAU);
      ctx.fillStyle="rgba(255,255,255,.17)";ctx.fill();
      ctx.beginPath();ctx.moveTo(13,0);ctx.lineTo(-8,-6);
      ctx.lineTo(-6,0);ctx.lineTo(-8,6);ctx.closePath();
      ctx.fillStyle=v.color;ctx.fill();ctx.strokeStyle="#f6ffff";ctx.lineWidth=1.6;ctx.stroke();
      ctx.restore();
      ctx.save();ctx.textAlign="center";ctx.font="bold 11px Arial,sans-serif";
      ctx.strokeStyle="#174359";ctx.lineWidth=3;ctx.fillStyle="#fff";
      ctx.strokeText(v.name,v.position.x,v.position.y-20);
      ctx.fillText(v.name,v.position.x,v.position.y-20);ctx.restore();
    }
    ctx.save();ctx.font="bold 10px Arial,sans-serif";
    ctx.fillStyle="rgba(241,250,250,.83)";ctx.textAlign="right";
    ctx.fillText("SYNTHETIC BATHYMETRY · NOT FOR NAVIGATION",w-16,h-14);ctx.restore();
    ctx.restore();
  }
  window.OceanSurvey={create,addStation,moveStation,resetRoutes,update,stats,draw,offshore};
})();
