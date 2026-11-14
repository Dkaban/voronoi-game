/* Simple robotics navigation demo.
 * Site points become circular obstacles. A* searches a discrete 2D grid
 * with a clearance penalty, then simplifies the path with collision checks.
 * This is not road routing or a complete robot dynamics simulator.
 */
(() => {
  "use strict";

  const TAU = Math.PI * 2;

  class MinHeap {
    constructor() { this.values = []; }
    push(entry) {
      const a = this.values;
      a.push(entry);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].f <= entry.f) break;
        a[i] = a[p];
        i = p;
      }
      a[i] = entry;
    }
    pop() {
      const a = this.values;
      if (!a.length) return null;
      const min = a[0], last = a.pop();
      if (a.length) {
        let i = 0;
        while (true) {
          let child = i * 2 + 1;
          if (child >= a.length) break;
          if (child + 1 < a.length && a[child + 1].f < a[child].f) child++;
          if (last.f <= a[child].f) break;
          a[i] = a[child];
          i = child;
        }
        a[i] = last;
      }
      return min;
    }
    get length() { return this.values.length; }
  }

  function makeDemo(points, width, height, options = {}) {
    const obstacles = points.map(p => ({x: p.x * width, y: p.y * height}));
    const minDim = Math.min(width, height);
    const obstacleRadius = Math.max(9, Math.min(23, minDim * .037));
    const robotRadius = Math.max(5, Math.min(11, minDim * .018));
    const blockedDistance = obstacleRadius + robotRadius + 2;
    const step = Math.max(9, Math.min(17, Math.round(minDim / 35)));
    const margin = robotRadius + 3;
    const cols = Math.max(3, Math.floor((width - 2 * margin) / step) + 1);
    const rows = Math.max(3, Math.floor((height - 2 * margin) / step) + 1);
    const dx = (width - 2 * margin) / (cols - 1);
    const dy = (height - 2 * margin) / (rows - 1);
    const size = cols * rows;

    function nearestDistance(x, y) {
      let distance = Infinity;
      for (const o of obstacles) {
        distance = Math.min(distance, Math.hypot(x - o.x, y - o.y));
      }
      return distance;
    }
    const clearance = new Float32Array(size);
    const passable = new Uint8Array(size);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const id = row * cols + col;
        const distance = nearestDistance(margin + col * dx, margin + row * dy);
        clearance[id] = distance;
        passable[id] = distance >= blockedDistance ? 1 : 0;
      }
    }

    function anchor(atRight) {
      const preferredX = atRight ? Math.max(1, cols - 3) : Math.min(cols - 2, 2);
      const preferredY = Math.max(0, Math.min(1,
        atRight ? (options.goalFraction ?? .5) : (options.startFraction ?? .5))) * (rows - 1);
      let best = -1, score = Infinity;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const id = row * cols + col;
          if (!passable[id]) continue;
          const deltaX = Math.abs(col - preferredX);
          const deltaY = Math.abs(row - preferredY);
          const penalty = Math.max(0, blockedDistance * 1.7 - clearance[id]) / blockedDistance;
          const value = deltaX * 5 + deltaY + penalty * 2;
          if (value < score) { score = value; best = id; }
        }
      }
      return best;
    }

    const startId = anchor(false), goalId = anchor(true);
    const nodePoint = id => ({x: margin + (id % cols) * dx,
      y: margin + Math.floor(id / cols) * dy});
    const start = startId >= 0 ? nodePoint(startId) : {x: margin, y: height / 2};
    const goal = goalId >= 0 ? nodePoint(goalId) : {x: width - margin, y: height / 2};

    if (startId < 0 || goalId < 0 || startId === goalId) {
      return {obstacles, obstacleRadius, robotRadius, blockedDistance,
        start, goal, path: [], pathLength: 0, found: false};
    }

    const g = new Float64Array(size).fill(Infinity);
    const previous = new Int32Array(size).fill(-1);
    const closed = new Uint8Array(size);
    const queue = new MinHeap();
    const heuristic = id => {
      const p = nodePoint(id);
      return Math.hypot(p.x - goal.x, p.y - goal.y);
    };
    g[startId] = 0;
    queue.push({id: startId, f: heuristic(startId)});

    const directions = [
      [-1,0],[1,0],[0,-1],[0,1],
      [-1,-1],[1,-1],[-1,1],[1,1]
    ];
    let found = false;
    while (queue.length) {
      const entry = queue.pop();
      const id = entry.id;
      if (closed[id]) continue;
      closed[id] = 1;
      if (id === goalId) { found = true; break; }

      const row = Math.floor(id / cols), col = id % cols;
      for (const [vx, vy] of directions) {
        const nextCol = col + vx, nextRow = row + vy;
        if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= rows) continue;
        const next = nextRow * cols + nextCol;
        if (!passable[next] || closed[next]) continue;
        // Do not cut through an obstacle corner with diagonal steps.
        if (vx && vy && (!passable[row * cols + nextCol] ||
          !passable[nextRow * cols + col])) continue;

        const distance = Math.hypot(vx * dx, vy * dy);
        const extraSpace = Math.max(0, clearance[next] - blockedDistance);
        // Prefer broad routes over scraping past obstacle boundaries.
        const proximityPenalty = 2.4 * Math.exp(-extraSpace / (obstacleRadius * 1.7));
        const nextCost = g[id] + distance * (1 + proximityPenalty);
        if (nextCost < g[next]) {
          g[next] = nextCost;
          previous[next] = id;
          queue.push({id: next, f: nextCost + heuristic(next)});
        }
      }
    }

    const raw = [];
    if (found) {
      let id = goalId;
      while (id !== -1) {
        raw.push(nodePoint(id));
        id = previous[id];
      }
      raw.reverse();
    }

    // Exact segment-to-circle separation prevents smoothed paths clipping an obstacle.
    function clearSegment(a, b, clearanceDistance) {
      const ux = b.x - a.x, uy = b.y - a.y;
      const len2 = ux * ux + uy * uy;
      for (const o of obstacles) {
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1,
          ((o.x - a.x) * ux + (o.y - a.y) * uy) / len2));
        if (Math.hypot(o.x - (a.x + t * ux), o.y - (a.y + t * uy)) < clearanceDistance) {
          return false;
        }
      }
      return true;
    }

    const path = [];
    if (raw.length) {
      path.push(raw[0]);
      let index = 0;
      while (index < raw.length - 1) {
        let next = index + 1;
        for (let j = raw.length - 1; j > index + 1; j--) {
          if (clearSegment(raw[index], raw[j], blockedDistance + robotRadius * .3)) {
            next = j;
            break;
          }
        }
        path.push(raw[next]);
        index = next;
      }
    }

    // Path total and cumulative lengths are used for constant-speed playback.
    const cumulative = [0];
    for (let i = 1; i < path.length; i++) {
      cumulative.push(cumulative[i-1] +
        Math.hypot(path[i].x - path[i-1].x, path[i].y - path[i-1].y));
    }
    const pathLength = cumulative[cumulative.length - 1];
    return {obstacles, obstacleRadius, robotRadius, blockedDistance,
      start, goal, path, cumulative, pathLength, found: found && path.length > 1};
  }

  function interpolate(data, progress) {
    const path = data.path;
    if (path.length < 2) return {x: data.start.x, y: data.start.y, angle: 0};
    const target = data.pathLength * progress;
    let i = 1;
    while (i < data.cumulative.length - 1 && data.cumulative[i] < target) i++;
    const a = path[i-1], b = path[i];
    const segmentLength = data.cumulative[i] - data.cumulative[i-1];
    const fraction = segmentLength ? (target - data.cumulative[i-1]) / segmentLength : 0;
    return {x: a.x + (b.x-a.x)*fraction,
      y: a.y + (b.y-a.y)*fraction,
      angle: Math.atan2(b.y-a.y, b.x-a.x)};
  }

  function drawPath(ctx, path) {
    if (!path.length) return;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  }

  function marker(ctx, point, label, color, below = false) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 13, 0, TAU);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 12px Arial, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText(label === "START" ? "S" : "G", point.x, point.y + .5);
    ctx.font = "bold 10px Arial, sans-serif";
    ctx.fillStyle = "#294a3b";
    ctx.fillText(label, point.x,
      below ? point.y + 27 : point.y - 26);
  }

  function draw(ctx, data, progress, width, height, mapEnabled = false) {
    ctx.clearRect(0, 0, width, height);
    if (!mapEnabled) {
      ctx.fillStyle = "#f0efe9";
      ctx.fillRect(0, 0, width, height);
    }

    // Points are obstacles, not robot waypoints.
    for (const o of data.obstacles) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, data.blockedDistance, 0, TAU);
      ctx.fillStyle = "rgba(186, 98, 77, .13)";
      ctx.fill();
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(174, 96, 73, .42)";
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(o.x, o.y, data.obstacleRadius, 0, TAU);
      ctx.fillStyle = "rgba(175, 93, 73, .88)";
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }

    if (data.found) {
      ctx.save();
      drawPath(ctx, data.path);
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = "rgba(32, 78, 65, .47)";
      ctx.stroke();
      ctx.setLineDash([]);

      // Solid segment represents the robot's completed travel.
      const robot = interpolate(data, progress);
      const travel = data.pathLength * progress;
      ctx.beginPath();
      ctx.moveTo(data.path[0].x, data.path[0].y);
      for (let i = 1; i < data.path.length; i++) {
        if (data.cumulative[i] <= travel) {
          ctx.lineTo(data.path[i].x, data.path[i].y);
        } else {
          ctx.lineTo(robot.x, robot.y);
          break;
        }
      }
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = "#286a52";
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(robot.x, robot.y);
      ctx.rotate(robot.angle);
      ctx.beginPath();
      ctx.arc(0, 0, data.robotRadius + 5, 0, TAU);
      ctx.fillStyle = "rgba(50, 112, 85, .13)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, data.robotRadius, 0, TAU);
      ctx.fillStyle = "#264f40";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      // Robot heading.
      ctx.beginPath();
      ctx.moveTo(2, -4);
      ctx.lineTo(data.robotRadius + 2, 0);
      ctx.lineTo(2, 4);
      ctx.closePath();
      ctx.fillStyle = "#cde6cb";
      ctx.fill();
      ctx.restore();
    }

    marker(ctx, data.start, "START", "#3e8062", data.start.y < 38);
    marker(ctx, data.goal, "GOAL", "#e09551", data.goal.y < 38);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    if (!data.found) return "NO SAFE ROUTE · MOVE POINTS AND RETRY";
    return progress >= 1 ? "GOAL REACHED · " + data.obstacles.length + " OBSTACLES AVOIDED"
      : "ROBOT NAVIGATION · CLEARANCE-AWARE A* · " +
        Math.round(progress * 100) + "%";
  }


  // Multiple independently planned robot routes drawn over the existing diagram.
  // Obstacles are the diagram's sites, and the map (when enabled) is only imagery.
  function makeFleet(points, width, height) {
    const settings = [
      {startFraction: .18, goalFraction: .22, color: "#1d6b52", name: "R1", delay: 0},
      {startFraction: .50, goalFraction: .55, color: "#275f94", name: "R2", delay: 1300},
      {startFraction: .82, goalFraction: .79, color: "#94513e", name: "R3", delay: 2700}
    ];
    return settings.map(setting => ({
      ...setting,
      route: makeDemo(points, width, height, setting)
    }));
  }

  function drawFleet(ctx, fleet, elapsedMs) {
    if (!fleet.length) return;
    const base = fleet[0].route;
    ctx.save();
    // Shared point obstacles, with dashed clearance boundaries.
    for (const o of base.obstacles) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, base.blockedDistance, 0, TAU);
      ctx.fillStyle = "rgba(145, 63, 50, .07)";
      ctx.fill();
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1.15;
      ctx.strokeStyle = "rgba(153, 65, 52, .44)";
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(o.x, o.y, base.obstacleRadius, 0, TAU);
      ctx.fillStyle = "rgba(165, 85, 66, .40)";
      ctx.fill();
    }

    for (const robot of fleet) {
      const data = robot.route;
      if (!data.found) continue;
      ctx.save();
      // Dotted planned path; robot moves independently along it.
      drawPath(ctx, data.path);
      ctx.lineWidth = 2.7;
      ctx.lineJoin = "round";
      ctx.setLineDash([7, 7]);
      ctx.strokeStyle = robot.color;
      ctx.globalAlpha = .70;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      const duration = Math.max(4500, data.pathLength * 10);
      const phase = ((elapsedMs - robot.delay) / duration);
      // Ping-pong at the ends rather than teleporting between endpoints.
      const folded = ((phase % 2) + 2) % 2;
      const progress = folded <= 1 ? folded : 2 - folded;
      const position = interpolate(data, progress);
      const returning = folded > 1;
      ctx.translate(position.x, position.y);
      ctx.rotate(position.angle + (returning ? Math.PI : 0));
      ctx.beginPath();
      ctx.arc(0, 0, data.robotRadius + 9, 0, TAU);
      ctx.fillStyle = "rgba(255,255,255,.48)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, data.robotRadius + 5, 0, TAU);
      ctx.strokeStyle = robot.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, data.robotRadius + 1, 0, TAU);
      ctx.fillStyle = robot.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(3, -4);
      ctx.lineTo(data.robotRadius + 7, 0);
      ctx.lineTo(3, 4);
      ctx.closePath();
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.font = "bold 10px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = robot.color;
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.strokeText(robot.name, position.x, position.y - data.robotRadius - 19);
      ctx.fillText(robot.name, position.x, position.y - data.robotRadius - 19);
      ctx.restore();
    }
    ctx.restore();
  }

  window.RobotNavigationDemo = {makeDemo, draw, makeFleet, drawFleet};
})();
