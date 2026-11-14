/* Roaming robots: A* on a clearance grid, local collision prediction,
 * dynamic yielding and independently selected destinations.
 * Demonstration only; not a certified robotics controller.
 */
(() => {
  "use strict";
  const TAU=Math.PI*2, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const copy=p=>({x:p.x,y:p.y});
  class Heap {
    constructor(){this.a=[];}
    push(v){const a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].f<=v.f)break;a[i]=a[p];i=p;}a[i]=v;}
    pop(){const a=this.a;const first=a[0],last=a.pop();if(!a.length)return first;let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].f<a[c].f)c++;if(last.f<=a[c].f)break;a[i]=a[c];i=c;}a[i]=last;return first;}
    get length(){return this.a.length;}
  }
  function segmentDistance(a,b,p){
    const x=b.x-a.x,y=b.y-a.y,l=x*x+y*y;
    const t=l?clamp(((p.x-a.x)*x+(p.y-a.y)*y)/l,0,1):0;
    return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);
  }
  function clear(world,a,b,extra=0){
    const margin=world.radius+3;
    if([a,b].some(p=>p.x<margin||p.x>world.width-margin||p.y<margin||p.y>world.height-margin))return false;
    return world.obstacles.every(o=>segmentDistance(a,b,o)>=world.clearance+extra);
  }
  function worldGrid(world){
    const step=clamp(Math.min(world.width,world.height)/36,11,18);
    const margin=world.radius+6;
    const cols=Math.max(3,Math.ceil((world.width-2*margin)/step)+1);
    const rows=Math.max(3,Math.ceil((world.height-2*margin)/step)+1);
    const dx=(world.width-2*margin)/(cols-1),dy=(world.height-2*margin)/(rows-1);
    const nodes=[],free=[],blocked=new Uint8Array(rows*cols),spacing=new Float32Array(rows*cols);
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const i=y*cols+x,p={x:margin+x*dx,y:margin+y*dy};nodes.push(p);
      let d=Infinity;for(const o of world.obstacles)d=Math.min(d,dist(o,p));
      spacing[i]=d;blocked[i]=d<world.clearance+4?1:0;
      if(!blocked[i])free.push(i);
    }
    return {cols,rows,nodes,free,blocked,spacing,dx,dy};
  }
  function nearestNode(world,point){
    const g=world.grid;let result=-1,best=Infinity;
    for(const i of g.free){const p=g.nodes[i],d=dist(point,p);
      if(d<best&&clear(world,point,p)){best=d;result=i;}
    }
    return result;
  }
  function plan(world,start,goalId,others=[]){
    const grid=world.grid,startId=nearestNode(world,start);
    if(startId<0||goalId<0||grid.blocked[goalId])return null;
    const {cols,rows,nodes,blocked,spacing}=grid;
    const costs=new Float64Array(nodes.length).fill(Infinity);
    const parent=new Int32Array(nodes.length).fill(-1);
    const closed=new Uint8Array(nodes.length),heap=new Heap();
    costs[startId]=0;heap.push({id:startId,f:dist(nodes[startId],nodes[goalId])});
    const directions=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    let found=false;
    while(heap.length){
      const {id}=heap.pop();if(closed[id])continue;closed[id]=1;
      if(id===goalId){found=true;break;}
      const x=id%cols,y=Math.floor(id/cols);
      for(const [vx,vy] of directions){
        const nx=x+vx,ny=y+vy;if(nx<0||ny<0||nx>=cols||ny>=rows)continue;
        const ni=ny*cols+nx;
        if(blocked[ni]||closed[ni])continue;
        if(vx&&vy&&(blocked[y*cols+nx]||blocked[ny*cols+x]))continue;
        const wall=Math.exp(-Math.max(0,spacing[ni]-world.clearance)/(world.obstacleRadius*1.5));
        let traffic=0;
        for(const other of others)traffic+=Math.exp(-dist(other,nodes[ni])/34);
        const cost=costs[id]+Math.hypot(vx*grid.dx,vy*grid.dy)*(1+.8*wall+.55*traffic);
        if(cost<costs[ni]){
          costs[ni]=cost;parent[ni]=id;
          heap.push({id:ni,f:cost+dist(nodes[ni],nodes[goalId])});
        }
      }
    }
    if(!found)return null;
    const raw=[];for(let i=goalId;i!==-1;i=parent[i])raw.push(nodes[i]);raw.reverse();
    const path=[copy(start)];
    let i=0;
    while(i<raw.length-1){
      let next=i+1;
      for(let j=raw.length-1;j>i+1;j--){
        if(clear(world,path[path.length-1],raw[j],world.radius*.15)){next=j;break;}
      }
      path.push(copy(raw[next]));i=next;
    }
    if(path.length<2)path.push(copy(nodes[goalId]));
    return path;
  }
  function sector(world,p){
    return clamp(Math.floor(p.y/world.height*3),0,2)*4+
      clamp(Math.floor(p.x/world.width*4),0,3);
  }
  function chooseGoal(world,bot){
    const available=world.grid.free;
    if(!available.length){bot.path=[];bot.goal=null;return;}
    const diag=Math.hypot(world.width,world.height),candidates=[];
    const otherGoals=world.bots.filter(b=>b!==bot&&b.goal).map(b=>b.goal);
    for(let i=0;i<100;i++){
      const id=available[Math.floor(Math.random()*available.length)],p=world.grid.nodes[id];
      const range=dist(bot.position,p);if(range<diag*.20)continue;
      const crowd=otherGoals.reduce((n,g)=>n+Math.max(0,120-dist(g,p))/120,0);
      const score=range/diag*3-bot.visits[sector(world,p)]*1.5-crowd*1.6+Math.random();
      candidates.push({id,score});
    }
    candidates.sort((a,b)=>b.score-a.score);
    const others=world.bots.filter(b=>b!==bot).map(b=>b.position);
    for(const {id} of candidates.slice(0,12)){
      const path=plan(world,bot.position,id,others);
      if(path&&path.length>1){
        bot.path=path;bot.waypoint=1;bot.goal=copy(world.grid.nodes[id]);bot.stuck=0;
        return;
      }
    }
    bot.path=[];bot.goal=null;
  }
  function create(points,width,height,old=null){
    const radius=clamp(Math.min(width,height)*.018,5.5,11);
    const obstacleRadius=clamp(Math.min(width,height)*.037,9,23);
    const world={width,height,radius,obstacleRadius,clearance:radius+obstacleRadius+3,
      obstacles:points.map(p=>({x:p.x*width,y:p.y*height})),bots:[],elapsed:0};
    world.grid=worldGrid(world);
    const presets=[
      {name:"R1",color:"#1d6b52",x:.12,y:.18,speed:64},
      {name:"R2",color:"#286a9d",x:.84,y:.22,speed:57},
      {name:"R3",color:"#a6523f",x:.82,y:.83,speed:67},
      {name:"R4",color:"#7758a0",x:.20,y:.78,speed:53}
    ];
    for(let i=0;i<presets.length;i++){
      const p=presets[i],prior=old?.bots?.[i];
      const preferred=prior?{x:prior.position.x/old.width*width,y:prior.position.y/old.height*height}:
        {x:p.x*width,y:p.y*height};
      let chosen=null,best=Infinity;
      for(const id of world.grid.free){
        const node=world.grid.nodes[id];
        if(world.bots.some(b=>dist(b.position,node)<radius*3+15))continue;
        const d=dist(preferred,node);if(d<best){best=d;chosen=node;}
      }
      if(!chosen)continue;
      world.bots.push({name:p.name,color:p.color,position:copy(chosen),vx:0,vy:0,
        angle:0,speed:p.speed*clamp(Math.min(width,height)/500,.72,1.16),radius,
        goal:null,path:[],waypoint:1,stuck:0,visits:prior?.visits?.slice()||Array(12).fill(0),
        arrivals:prior?.arrivals||0,travel:prior?.travel||0,trail:[copy(chosen)],index:i});
    }
    for(const bot of world.bots)chooseGoal(world,bot);
    return world;
  }
  function approach(bot){
    if(!bot.goal||!bot.path.length)return {vx:0,vy:0};
    while(bot.waypoint<bot.path.length-1&&
      dist(bot.position,bot.path[bot.waypoint])<Math.max(7,bot.radius))bot.waypoint++;
    const target=bot.path[bot.waypoint],d=dist(bot.position,target);
    if(d<.001)return {vx:0,vy:0};
    return {vx:(target.x-bot.position.x)/d*bot.speed,
      vy:(target.y-bot.position.y)/d*bot.speed};
  }
  function closestApproach(a,va,b,vb,horizon){
    const dx=b.x-a.x,dy=b.y-a.y,vx=va.vx-vb.vx,vy=va.vy-vb.vy;
    const speed2=vx*vx+vy*vy;
    const t=speed2?clamp((dx*vx+dy*vy)/speed2,0,horizon):0;
    return Math.hypot(dx-vx*t,dy-vy*t);
  }
  function steering(world,bot,dt){
    const preferred=approach(bot),speed=Math.hypot(preferred.vx,preferred.vy);
    if(speed<.001)return {vx:0,vy:0};
    const base=Math.atan2(preferred.vy,preferred.vx);
    const deviations=[0,.23,-.23,.5,-.5,.85,-.85,1.25,-1.25,1.75,-1.75];
    let best={vx:0,vy:0},bestCost=Infinity;
    for(const factor of [1,.8,.55,.3,0])for(const offset of (factor?deviations:[0])){
      const a=base+offset,v={vx:Math.cos(a)*speed*factor,vy:Math.sin(a)*speed*factor};
      const target={x:bot.position.x+v.vx*dt,y:bot.position.y+v.vy*dt};
      if(!clear(world,bot.position,target,.5))continue;
      let cost=(1-factor)*20+(1-Math.cos(offset))*30;
      for(const other of world.bots){
        if(other===bot)continue;
        const min=bot.radius+other.radius+3;
        const sep=closestApproach(bot.position,v,other.position,{vx:other.vx,vy:other.vy},1.1);
        const near=Math.max(0,min+17-sep);
        cost+=near*near*2;
        if(sep<min)cost+=2500;
        const immediate=closestApproach(bot.position,v,other.position,
          {vx:other.vx,vy:other.vy},dt);
        if(immediate<min)cost+=50000;
      }
      cost+=Math.abs(offset)*.2+(offset<0?.10:0);
      if(cost<bestCost){bestCost=cost;best=v;}
    }
    return best;
  }
  function swept(a0,a1,b0,b1,r){
    return closestApproach(a0,{vx:a1.x-a0.x,vy:a1.y-a0.y},
      b0,{vx:b1.x-b0.x,vy:b1.y-b0.y},1)<r;
  }
  function update(world,seconds){
    if(!world)return;
    const steps=Math.max(1,Math.ceil(clamp(seconds,0,.12)/.03)),dt=clamp(seconds,0,.12)/steps;
    for(let n=0;n<steps;n++){
      world.elapsed+=dt;
      for(const bot of world.bots){
        if(bot.goal&&dist(bot.position,bot.goal)<Math.max(10,bot.radius*1.7)){
          bot.visits[sector(world,bot.goal)]++;bot.arrivals++;chooseGoal(world,bot);
        }else if(!bot.path.length)chooseGoal(world,bot);
      }
      const bots=world.bots,old=bots.map(b=>copy(b.position));
      const velocities=bots.map(bot=>steering(world,bot,dt));
      const next=bots.map((bot,i)=>({x:bot.position.x+velocities[i].vx*dt,
        y:bot.position.y+velocities[i].vy*dt}));
      for(let iteration=0;iteration<bots.length;iteration++){
        let changed=false;
        for(let i=0;i<bots.length;i++)for(let j=i+1;j<bots.length;j++){
          const safe=bots[i].radius+bots[j].radius+3;
          if(!swept(old[i],next[i],old[j],next[j],safe))continue;
          const yielding=(Math.floor(world.elapsed/2)+i+j)%2?i:j,other=yielding===i?j:i;
          if(dist(old[i],old[j])<safe){
            next[i]=old[i];next[j]=old[j];velocities[i]={vx:0,vy:0};velocities[j]={vx:0,vy:0};
          }else{
            next[yielding]=old[yielding];velocities[yielding]={vx:0,vy:0};
            if(swept(old[i],next[i],old[j],next[j],safe)){
              next[other]=old[other];velocities[other]={vx:0,vy:0};
            }
          }
          changed=true;
        }
        if(!changed)break;
      }
      for(let i=0;i<bots.length;i++){
        const bot=bots[i],nextPoint=next[i];
        if(!clear(world,old[i],nextPoint,.1))continue;
        const movement=dist(old[i],nextPoint);
        bot.position=copy(nextPoint);bot.vx=velocities[i].vx;bot.vy=velocities[i].vy;
        if(movement>.001){bot.angle=Math.atan2(bot.vy,bot.vx);bot.travel+=movement;}
        bot.stuck=movement<bot.speed*dt*.12?bot.stuck+dt:Math.max(0,bot.stuck-dt*1.5);
        if(bot.stuck>2.5){chooseGoal(world,bot);bot.stuck=0;}
        const last=bot.trail[bot.trail.length-1];
        if(movement>.1&&dist(last,bot.position)>7){
          bot.trail.push(copy(bot.position));if(bot.trail.length>28)bot.trail.shift();
        }
      }
    }
  }
  function draw(ctx,world){
    if(!world)return;
    ctx.save();
    for(const o of world.obstacles){
      ctx.beginPath();ctx.arc(o.x,o.y,world.clearance,0,TAU);
      ctx.fillStyle="rgba(169,75,52,.08)";ctx.fill();
      ctx.setLineDash([3,5]);ctx.lineWidth=1;ctx.strokeStyle="rgba(164,76,54,.4)";ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(o.x,o.y,world.obstacleRadius,0,TAU);
      ctx.fillStyle="rgba(166,83,59,.28)";ctx.fill();
    }
    for(const bot of world.bots){
      if(bot.path.length>1){
        ctx.beginPath();ctx.moveTo(bot.position.x,bot.position.y);
        for(let i=bot.waypoint;i<bot.path.length;i++)ctx.lineTo(bot.path[i].x,bot.path[i].y);
        ctx.setLineDash([5,8]);ctx.lineWidth=2;ctx.strokeStyle=bot.color;ctx.globalAlpha=.64;ctx.stroke();
        ctx.globalAlpha=1;ctx.setLineDash([]);
      }
      if(bot.goal){ctx.beginPath();ctx.arc(bot.goal.x,bot.goal.y,6,0,TAU);
        ctx.lineWidth=2;ctx.strokeStyle=bot.color;ctx.stroke();}
      for(let i=1;i<bot.trail.length;i++){
        ctx.beginPath();ctx.moveTo(bot.trail[i-1].x,bot.trail[i-1].y);
        ctx.lineTo(bot.trail[i].x,bot.trail[i].y);ctx.globalAlpha=i/bot.trail.length*.55;
        ctx.lineWidth=3;ctx.strokeStyle=bot.color;ctx.stroke();
      }
      ctx.globalAlpha=1;
      ctx.save();ctx.translate(bot.position.x,bot.position.y);ctx.rotate(bot.angle);
      ctx.beginPath();ctx.arc(0,0,bot.radius+7,0,TAU);ctx.fillStyle="rgba(255,255,255,.52)";ctx.fill();
      ctx.beginPath();ctx.arc(0,0,bot.radius+2,0,TAU);
      ctx.fillStyle=bot.color;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle="#fff";ctx.stroke();
      ctx.beginPath();ctx.moveTo(3,-4);ctx.lineTo(bot.radius+8,0);ctx.lineTo(3,4);
      ctx.closePath();ctx.fillStyle="#fff";ctx.fill();ctx.restore();
      ctx.save();ctx.font="bold 11px Arial, sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.strokeStyle="#f8f7f2";ctx.lineWidth=4;ctx.lineJoin="round";ctx.fillStyle=bot.color;
      const labelY=bot.position.y-bot.radius-19;
      ctx.strokeText(bot.name,bot.position.x,labelY);ctx.fillText(bot.name,bot.position.x,labelY);
      ctx.restore();
    }
    ctx.restore();
  }
  window.RobotSwarm={create,update,draw,clear};
})();
