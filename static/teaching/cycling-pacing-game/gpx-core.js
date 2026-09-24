/* Local GPX processing. No network requests or persistent GPS storage. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BreakawayGPX = factory();
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';
  const MAX_BYTES = 20 * 1024 * 1024;
  const children = (node, name) => Array.from(node.children).filter(el => el.localName === name);
  const nameOf = node => children(node, 'name')[0]?.textContent.trim().slice(0, 80);
  function distance(a, b) {
    const rad = Math.PI / 180, p = (b.lat - a.lat) * rad, q = (b.lon - a.lon) * rad;
    const v = Math.sin(p / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(q / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, v))));
  }
  function prepare(points, name) {
    const kept = [], s = [];
    for (const point of points) {
      const d = kept.length ? distance(kept[kept.length - 1], point) : 0;
      if (kept.length && d < 0.5) continue; // Ignore stationary GPS duplicates.
      s.push((s[s.length - 1] || 0) + d);
      kept.push({...point});
    }
    if (kept.length < 2 || s[s.length - 1] < 100) return null;
    const anchors = kept.map((p, i) => Number.isFinite(p.ele) ? i : -1).filter(i => i >= 0);
    if (anchors.length < 2) return null;
    let cursor = 0;
    kept.forEach((p, i) => {
      if (Number.isFinite(p.ele)) return;
      while (cursor + 1 < anchors.length && anchors[cursor + 1] < i) cursor++;
      const a = anchors[cursor], b = anchors[Math.min(cursor + 1, anchors.length - 1)];
      p.ele = i <= anchors[0] ? kept[anchors[0]].ele : i >= anchors[anchors.length - 1] ? kept[anchors[anchors.length - 1]].ele : kept[a].ele + (kept[b].ele - kept[a].ele) * (s[i] - s[a]) / (s[b] - s[a]);
    });
    return {name, points: kept, s, length: s[s.length - 1], filled: kept.length - anchors.length};
  }
  function parse(text, filename = 'My ride') {
    if (text.length > MAX_BYTES) throw new Error('Choose a GPX file smaller than 20 MB.');
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('GPX files with document types or entity declarations are not supported.');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagNameNS('*', 'parsererror').length || doc.documentElement.localName !== 'gpx') throw new Error('This is not a valid GPX file. Export your ride as GPX and try again.');
    const groups = [], base = filename.replace(/\.gpx$/i, '').slice(0, 80) || 'My ride';
    for (const track of children(doc.documentElement, 'trk')) {
      for (const seg of children(track, 'trkseg')) groups.push({nodes: children(seg, 'trkpt'), name: nameOf(track) || base});
    }
    if (!groups.some(g => g.nodes.length)) for (const route of children(doc.documentElement, 'rte')) groups.push({nodes: children(route, 'rtept'), name: nameOf(route) || base});
    if (groups.reduce((n, g) => n + g.nodes.length, 0) > 150000) throw new Error('This GPX has more than 150,000 points. Export a shorter ride first.');
    const sections = []; let skipped = 0, breaks = 0;
    for (const group of groups) {
      let points = [];
      const flush = () => { const section = prepare(points, group.name); if (section) sections.push(section); else if (points.length) skipped++; points = []; };
      for (const node of group.nodes) {
        const latText = node.getAttribute('lat'), lonText = node.getAttribute('lon');
        const lat = latText?.trim() ? Number(latText) : NaN, lon = lonText?.trim() ? Number(lonText) : NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { flush(); breaks++; continue; }
        const elevation = children(node, 'ele')[0]?.textContent.trim();
        const ele = elevation ? Number(elevation) : NaN;
        if (Number.isFinite(ele) && (ele < -12000 || ele > 10000)) throw new Error('The file contains an invalid elevation. Check the GPX elevation data.');
        const point = {lat, lon, ele};
        // Never draw a road across disconnected tracks or large GPS jumps.
        if (points.length && distance(points[points.length - 1], point) > 2000) { flush(); breaks++; }
        points.push(point);
      }
      flush();
    }
    if (!sections.length) throw new Error('No usable section found. GPX needs a continuous track of at least 100 m and at least two elevation readings. Export GPX with elevation included.');
    return {sections, skipped, breaks};
  }
  function at(section, x) {
    const {s, points} = section;
    x = Math.max(0, Math.min(section.length, x));
    let lo = 0, hi = s.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid] <= x) lo = mid; else hi = mid; }
    const t = (x - s[lo]) / (s[hi] - s[lo]), a = points[lo], b = points[hi];
    const deltaLon = ((b.lon - a.lon + 540) % 360) - 180;
    return {lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + deltaLon * t, ele: a.ele + (b.ele - a.ele) * t};
  }
  function crop(section, start, end, radius = 20) {
    if (![start, end, radius].every(Number.isFinite) || start < 0 || end > section.length + 0.001 || end <= start) throw new Error('Start must come before finish, within this section.');
    if (end - start < 100 - 1e-6 || end - start > 30000) throw new Error('Choose a segment between 0.10 and 30.00 km.');
    if (![0, 20, 50].includes(radius)) throw new Error('Choose one of the available smoothing levels.');
    const count = Math.ceil((end - start) / 10), x = [], h = [], s = [0];
    // Average on the full section, so cropping does not invent an edge slope.
    for (let i = 0; i <= count; i++) {
      const pos = start + (end - start) * i / count;
      let sum = 0, samples = 0;
      for (let offset = -radius; offset <= radius; offset += 10) {
        if (pos + offset < 0 || pos + offset > section.length) continue;
        sum += at(section, pos + offset).ele; samples++;
      }
      x.push(pos); h.push(sum / samples);
      if (i) s.push(s[i - 1] + Math.hypot(x[i] - x[i - 1], h[i] - h[i - 1]));
    }
    if (s[s.length - 1] > 30000) throw new Error('Including the hills, this segment exceeds 30 km. Move the finish a little closer.');
    for (let i = 1; i < h.length; i++) if (Math.abs(h[i] - h[i - 1]) / (s[i] - s[i - 1]) > 0.3) throw new Error('This segment has very steep or noisy elevation. Try stronger smoothing or choose a different segment.');
    return {s, h, meta: {name: `${section.name} · ${(start / 1000).toFixed(2)}–${(end / 1000).toFixed(2)} km`.slice(0, 100), kind: 'gpx', seed: ''}};
  }
  return {MAX_BYTES, distance, prepare, parse, at, crop};
});
