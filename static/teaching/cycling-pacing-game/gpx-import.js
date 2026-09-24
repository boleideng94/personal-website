(function() {
  'use strict';
  const $ = id => document.getElementById(id), GPX = window.BreakawayGPX, game = window.Breakaway;
  const ns = 'http://www.w3.org/2000/svg';
  let imported = null, section = null, start = 0, end = 0, candidate = null, reading = false, drag = null;
  function svgNode(tag, attrs, text) {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const line = (points, color, width = 2) => svgNode('polyline', {points: points.map(p => p.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'});
  function marker(svg, x, y, letter) {
    svg.append(svgNode('circle', {cx: x, cy: y, r: 9, fill: '#cffb78', stroke: '#0b171d', 'stroke-width': 2}));
    svg.append(svgNode('text', {x, y: y + 3, fill: '#152219', 'font-size': 9, 'text-anchor': 'middle', 'font-family': 'sans-serif'}, letter));
  }
  function draw() {
    if (!section) return;
    const map = $('gpxMap'), profile = $('gpxProfile');
    map.replaceChildren(); profile.replaceChildren();
    const samples = Array.from({length: 501}, (_, i) => GPX.at(section, section.length * i / 500));
    // Unwrap longitude locally so a route crossing the date line stays continuous.
    const ref = samples[0], cos = Math.cos(ref.lat * Math.PI / 180);
    const project = p => [(((p.lon - ref.lon + 540) % 360) - 180) * cos, -(p.lat - ref.lat)];
    const xy = samples.map(project), xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min(340 / Math.max(0.00001, maxX - minX), 180 / Math.max(0.00001, maxY - minY));
    const screen = p => {const [x, y] = project(p); return [200 + (x - (minX + maxX) / 2) * scale, 120 + (y - (minY + maxY) / 2) * scale];};
    map.append(line(samples.map(screen), '#455b67'));
    const chosen = Array.from({length: 251}, (_, i) => GPX.at(section, start + (end - start) * i / 250));
    map.append(line(chosen.map(screen), '#cffb78', 3));
    marker(map, ...screen(chosen[0]), 'S'); marker(map, ...screen(chosen[250]), 'F');
    const elevations = samples.map(p => p.ele), low = Math.min(...elevations) - 5, high = Math.max(...elevations) + 5;
    const X = d => 45 + d / section.length * 530, Y = h => 195 - (h - low) / (high - low) * 165;
    profile.append(svgNode('rect', {x: X(start), y: 20, width: Math.max(0, X(end) - X(start)), height: 175, fill: '#cffb7818'}));
    for (let i = 0; i <= 3; i++) {
      const h = low + (high - low) * i / 3, y = Y(h);
      profile.append(svgNode('line', {x1: 45, x2: 575, y1: y, y2: y, stroke: '#293d48'}));
      profile.append(svgNode('text', {x: 38, y: y + 4, fill: '#91a4ad', 'font-size': 11, 'text-anchor': 'end'}, Math.round(h) + ' m'));
    }
    profile.append(line(samples.map((p, i) => [X(section.length * i / 500), Y(p.ele)]), '#657c89'));
    const selectedProfile = candidate ? candidate.h.map((h, i) => [X(start + (end - start) * i / (candidate.h.length - 1)), Y(h)]) : chosen.map((p, i) => [X(start + (end - start) * i / 250), Y(p.ele)]);
    profile.append(line(selectedProfile, '#cffb78', 3));
    for (const [d, text] of [[start, 'S'], [end, 'F']]) {
      profile.append(svgNode('line', {x1: X(d), x2: X(d), y1: 20, y2: 195, stroke: '#cffb78', 'stroke-width': 2}));
      marker(profile, X(d), 22, text);
    }
    for (let i = 0; i <= 4; i++) profile.append(svgNode('text', {x: X(section.length * i / 4), y: 223, fill: '#91a4ad', 'font-size': 11, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}, (section.length * i / 4000).toFixed(1) + ' km'));
  }
  function update() {
    candidate = null; $('gpxApply').disabled = true;
    if (!section) return;
    for (const [id, value] of [['gpxStart', start], ['gpxEnd', end]]) {
      $(id).max = (section.length / 1000).toFixed(6);
      if (document.activeElement !== $(id)) $(id).value = (value / 1000).toFixed(3);
    }
    for (const [id, value] of [['gpxStartSlider', start], ['gpxEndSlider', end]]) {$(id).max = section.length; $(id).value = value; $(id).setAttribute('aria-valuetext', (value / 1000).toFixed(3) + ' km');}
    $('gpxNotes').textContent = `${(section.length / 1000).toFixed(2)} km in this section. ` + (imported.sections.length > 1 ? 'Disconnected sections are kept separate. ' : '') + (section.filled ? `${section.filled} missing elevation readings were filled by interpolation or the nearest endpoint. ` : '') + (imported.breaks ? 'Invalid coordinates or GPS jumps over 2 km were split. ' : '') + (imported.skipped ? 'Sections too short or without enough elevation were omitted.' : '');
    try {
      const raw = GPX.crop(section, start, end, Number($('gpxSmoothing').value));
      candidate = new game.core.Course(raw.s, raw.h, raw.meta);
      $('gpxSummary').textContent = `${(candidate.length / 1000).toFixed(2)} km to ride · ↑ ${Math.round(candidate.ascent)} m · ↓ ${Math.round(candidate.descent)} m · ${(start / 1000).toFixed(3)} to ${(end / 1000).toFixed(3)} km into this section`;
      $('gpxSummary').classList.remove('invalid'); $('gpxApply').disabled = reading;
    } catch (err) {
      $('gpxSummary').textContent = err.message; $('gpxSummary').classList.add('invalid');
    }
    draw();
  }
  function selectSection() {
    section = imported.sections[Number($('gpxTrack').value)]; start = 0; end = Math.min(10000, section.length); update();
  }
  $('importGpxBtn').onclick = () => {game.pause(); $('gpxDialog').showModal(); if (section) update();};
  $('gpxFile').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    reading = true; $('gpxApply').disabled = true; $('gpxFile').disabled = true; $('gpxError').textContent = 'Reading your GPX…';
    try {
      if (file.size > GPX.MAX_BYTES) throw new Error('Choose a GPX file smaller than 20 MB.');
      const result = GPX.parse(await file.text(), file.name);
      imported = result; $('gpxTrack').replaceChildren();
      result.sections.forEach((item, i) => {const option = document.createElement('option'); option.value = i; option.textContent = `${i + 1}. ${item.name} · ${(item.length / 1000).toFixed(2)} km`; $('gpxTrack').append(option);});
      $('gpxEditor').hidden = false; $('gpxError').textContent = ''; selectSection();
    } catch (err) { $('gpxError').textContent = err.message + (section ? ' Your previous selection is unchanged.' : ''); }
    finally {reading = false; $('gpxFile').disabled = false; $('gpxFile').value = ''; if (section) update();}
  };
  $('gpxTrack').onchange = selectSection; $('gpxSmoothing').onchange = update;
  function setBoundary(which, value) {
    if (!Number.isFinite(value)) return;
    value = Math.max(0, Math.min(section.length, value));
    if (which === 'start') start = Math.min(value, end); else end = Math.max(value, start);
    update();
  }
  for (const [id, which, multiplier] of [['gpxStart', 'start', 1000], ['gpxEnd', 'end', 1000], ['gpxStartSlider', 'start', 1], ['gpxEndSlider', 'end', 1]]) {
    $(id).oninput = event => {if (event.target.value !== '') setBoundary(which, Number(event.target.value) * multiplier);};
    $(id).onchange = () => {$(id).value = multiplier === 1000 ? ((which === 'start' ? start : end) / 1000).toFixed(3) : (which === 'start' ? start : end);};
  }
  // Respect SVG letterboxing when translating pointer coordinates.
  function profileDistance(event) {
    const svg = $('gpxProfile'), point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return Math.max(0, Math.min(section.length, (point.x - 45) / 530 * section.length));
  }
  $('gpxProfile').onpointerdown = event => {
    if (!section) return; event.preventDefault();
    const x = profileDistance(event); drag = Math.abs(x - start) < Math.abs(x - end) ? 'start' : 'end';
    $('gpxProfile').setPointerCapture(event.pointerId); setBoundary(drag, x);
  };
  $('gpxProfile').onpointermove = event => {if (drag) setBoundary(drag, profileDistance(event));};
  $('gpxProfile').onpointerup = $('gpxProfile').onpointercancel = event => {drag = null; if ($('gpxProfile').hasPointerCapture(event.pointerId)) $('gpxProfile').releasePointerCapture(event.pointerId);};
  $('gpxApply').onclick = () => {
    if (!candidate || reading) return;
    try {if (game.importCourse(candidate)) $('gpxDialog').close();}
    catch (err) {$('gpxError').textContent = 'Could not use this segment: ' + err.message;}
  };
})();
