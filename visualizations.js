/* Interactive construction and sweep-line visualizations.
 * The existing playground still calculates its finished cells using
 * half-plane clipping. This module visualizes that construction and
 * Fortune's geometric sweep (site events, beachline and circle events).
 */
(() => {
  "use strict";

  const TAU = Math.PI * 2;

  function pixelSites(points, width, height) {
    return points.map(p => ({x: p.x * width, y: p.y * height, w: (p.weight || 0) * Math.min(width, height) ** 2}));
  }

  function rectangle(width, height) {
    return [{x: 0, y: 0}, {x: width, y: 0},
      {x: width, y: height}, {x: 0, y: height}];
  }

  function clipPolygon(polygon, a, b, c) {
    const result = [];
    for (let i = 0; i < polygon.length; i++) {
      const start = polygon[i];
      const end = polygon[(i + 1) % polygon.length];
      const ds = a * start.x + b * start.y - c;
      const de = a * end.x + b * end.y - c;
      const insideStart = ds <= 1e-8;
      const insideEnd = de <= 1e-8;
      if (insideStart !== insideEnd) {
        const t = ds / (ds - de);
        result.push({x: start.x + t * (end.x - start.x),
          y: start.y + t * (end.y - start.y)});
      }
      if (insideEnd) result.push(end);
    }
    return result;
  }

  function clipAgainst(polygon, focus, other) {
    const a = 2 * (other.x - focus.x);
    const b = 2 * (other.y - focus.y);
    const c = other.x * other.x + other.y * other.y -
      focus.x * focus.x - focus.y * focus.y + (focus.w || 0) - (other.w || 0);
    return clipPolygon(polygon, a, b, c);
  }

  function computeCell(sites, index, width, height, active = null) {
    let polygon = rectangle(width, height);
    for (let j = 0; j < sites.length && polygon.length; j++) {
      if (j === index || (active && !active.has(j))) continue;
      polygon = clipAgainst(polygon, sites[index], sites[j]);
    }
    return polygon;
  }

  function fillPolygon(ctx, polygon, color, opacity = 1) {
    if (polygon.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) {
      ctx.lineTo(polygon[i].x, polygon[i].y);
    }
    ctx.closePath();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#f7f5ee";
    ctx.stroke();
  }

  function drawPoint(ctx, point, color, size = 4.5, faded = false) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, size, 0, TAU);
    ctx.fillStyle = faded ? "#ebeae2" : "#ffffff";
    ctx.fill();
    ctx.lineWidth = faded ? 1 : 2;
    ctx.strokeStyle = faded ? "#c1c7bd" : color;
    ctx.stroke();
  }

  function makeBuildData(points, width, height) {
    const sites = pixelSites(points, width, height);
    const frames = [];
    const cells = [];
    for (let i = 0; i < sites.length; i++) {
      let polygon = rectangle(width, height);
      frames.push({site: i, other: -1, polygon});
      for (let j = 0; j < sites.length; j++) {
        if (i === j) continue;
        polygon = clipAgainst(polygon, sites[i], sites[j]);
        frames.push({site: i, other: j, polygon});
      }
      cells.push(polygon);
    }
    return {sites, frames, cells};
  }

  function drawBisector(ctx, a, b, width, height) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-5) return;
    const centerOffset = ((a.w || 0) - (b.w || 0)) / (2 * length * length);
    const mx = (a.x + b.x) / 2 + dx * centerOffset;
    const my = (a.y + b.y) / 2 + dy * centerOffset;
    const extent = Math.hypot(width, height) * 2;
    const ux = -dy / length, uy = dx / length;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(mx - ux * extent, my - uy * extent);
    ctx.lineTo(mx + ux * extent, my + uy * extent);
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.75;
    ctx.strokeStyle = "rgba(37, 63, 54, .65)";
    ctx.stroke();
    ctx.restore();
  }

  function drawBuild(ctx, data, progress, width, height, colors, mapEnabled = false) {
    const frameIndex = Math.min(data.frames.length - 1,
      Math.floor(progress * data.frames.length));
    const frame = data.frames[frameIndex];
    if (!frame) return "No points to construct";

    ctx.clearRect(0, 0, width, height);
    if (!mapEnabled) {
      ctx.fillStyle = "#f0efe9";
      ctx.fillRect(0, 0, width, height);
    }
    for (let i = 0; i < frame.site; i++) {
      fillPolygon(ctx, data.cells[i], colors[i % colors.length], mapEnabled ? .42 : 1);
    }

    fillPolygon(ctx, frame.polygon, colors[frame.site % colors.length], mapEnabled ? .42 : .82);
    if (frame.other !== -1) {
      drawBisector(ctx, data.sites[frame.site],
        data.sites[frame.other], width, height);
    }

    data.sites.forEach((site, i) => {
      drawPoint(ctx, site, "#354c41", i === frame.site ? 7 : 4.5);
      if (i === frame.other) {
        ctx.beginPath();
        ctx.arc(site.x, site.y, 11, 0, TAU);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#d7764c";
        ctx.stroke();
      }
    });

    return "POWER CELL " + (frame.site + 1) + " / " + data.sites.length +
      (frame.other < 0 ? " · STARTING REGION" : " · CLIPPING AGAINST POINT " + (frame.other + 1));
  }

  function circleThrough(a, b, c) {
    const determinant = 2 * (a.x * (b.y - c.y) +
      b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(determinant) < 1e-7) return null;
    const a2 = a.x * a.x + a.y * a.y;
    const b2 = b.x * b.x + b.y * b.y;
    const c2 = c.x * c.x + c.y * c.y;
    const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / determinant;
    const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / determinant;
    const radius = Math.hypot(x - a.x, y - a.y);
    return {x, y, radius, bottom: y + radius};
  }

  // Empty circumcircles mark the Voronoi vertices (Fortune circle events).
  function circleEvents(sites) {
    if (sites.length > 45) return []; // Keep the interactive demo responsive.
    const events = [];
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        for (let k = j + 1; k < sites.length; k++) {
          const circle = circleThrough(sites[i], sites[j], sites[k]);
          if (!circle) continue;
          const radius2 = circle.radius * circle.radius;
          let empty = true;
          for (let m = 0; m < sites.length; m++) {
            if (m === i || m === j || m === k) continue;
            const dx = sites[m].x - circle.x, dy = sites[m].y - circle.y;
            if (dx * dx + dy * dy < radius2 - 1e-5) {
              empty = false;
              break;
            }
          }
          if (empty) events.push(circle);
        }
      }
    }
    return events.sort((a, b) => a.bottom - b.bottom);
  }

  function makeSweepData(points, width, height) {
    const sites = pixelSites(points, width, height);
    return {sites, events: circleEvents(sites)};
  }

  function drawBeachline(ctx, sites, active, directrix, width) {
    if (!active.size) return;
    ctx.save();
    ctx.beginPath();
    let started = false;
    for (let x = 0; x <= width + 3; x += 3) {
      let y = -Infinity;
      for (const i of active) {
        const site = sites[i];
        const gap = directrix - site.y;
        if (gap < .15) continue;
        const curve = (directrix + site.y) / 2 -
          (x - site.x) * (x - site.x) / (2 * gap);
        if (curve > y) y = curve;
      }
      if (!Number.isFinite(y) || y < -40) {
        started = false;
        continue;
      }
      if (!started) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      started = true;
    }
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(37, 71, 59, .16)";
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#25473b";
    ctx.stroke();
    ctx.restore();
  }

  function drawSweep(ctx, data, progress, width, height, colors, mapEnabled = false) {
    const directrix = -20 + (height + 65) * progress;
    const active = new Set();
    data.sites.forEach((site, i) => {
      if (site.y <= directrix) active.add(i);
    });

    ctx.clearRect(0, 0, width, height);
    if (!mapEnabled) {
      ctx.fillStyle = "#f0efe9";
      ctx.fillRect(0, 0, width, height);
    }

    // Show how the partition changes as each site reaches the directrix.
    // This is a sweep visualization; the finished cell engine stays unchanged.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, Math.max(0, Math.min(height, directrix)));
    ctx.clip();
    for (const i of active) {
      fillPolygon(ctx, computeCell(data.sites, i, width, height, active),
        colors[i % colors.length], mapEnabled ? .42 : .86);
    }
    ctx.restore();

    drawBeachline(ctx, data.sites, active, directrix, width);

    // Briefly reveal the circles as their lowest points meet the sweep line.
    let seenCircles = 0;
    for (const event of data.events) {
      if (event.bottom <= directrix) seenCircles++;
      if (Math.abs(event.bottom - directrix) > 12 ||
          event.radius > Math.max(width, height) * 1.3) continue;
      ctx.beginPath();
      ctx.arc(event.x, event.y, event.radius, 0, TAU);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "rgba(207, 110, 67, .42)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(event.x, event.y, 5, 0, TAU);
      ctx.fillStyle = "#d7764c";
      ctx.fill();
    }

    for (let i = 0; i < data.sites.length; i++) {
      const site = data.sites[i];
      drawPoint(ctx, site, "#354c41", active.has(i) ? 5.3 : 4, !active.has(i));
      if (Math.abs(site.y - directrix) < 9) {
        ctx.beginPath();
        ctx.arc(site.x, site.y, 12, 0, TAU);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#d7764c";
        ctx.stroke();
      }
    }

    if (directrix >= 0 && directrix <= height) {
      ctx.beginPath();
      ctx.moveTo(0, directrix);
      ctx.lineTo(width, directrix);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#d7764c";
      ctx.setLineDash([9, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    return "SITE EVENTS " + active.size + " / " + data.sites.length +
      " · CIRCLE EVENTS " + seenCircles + " · SWEEPING ↓";
  }

  window.VoronoiVisualization = {makeBuildData, drawBuild, makeSweepData, drawSweep};
})();
