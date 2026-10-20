/* Lightweight canvas rendering of the project's own display mesh. */
(() => {
  'use strict';
  const canvas = document.getElementById('roadster-preview');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const stage = canvas.closest('.roadster-stage');
  const button = stage.querySelector('.roadster-motion');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let mesh, frame = 0, elapsed = 0, last = 0, visible = false, paused = motion.matches;
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  function draw() {
    if (!mesh) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) {
      canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Turn from a three-quarter profile toward the viewer, then gently bank away.
    const phase = elapsed / 6500;
    const yaw = .78 + .55*Math.sin(phase), bank = .07*Math.sin(phase*1.4);
    const bob = Math.sin(phase*2)*.09, elevation = .28;
    const scale = Math.min(w / 6.4, h / 2.9);
    function project(v) {
      const z = v[2]*Math.cos(bank) + v[1]*Math.sin(bank) + bob;
      const y = v[1]*Math.cos(bank) - v[2]*Math.sin(bank);
      const right = v[0]*Math.sin(yaw) + y*Math.cos(yaw);
      const depth = v[0]*Math.cos(yaw) - y*Math.sin(yaw);
      const perspective = 8/(8-depth*.35);
      return [w/2 + right*scale*perspective, h*.46-(z*Math.cos(elevation)-depth*Math.sin(elevation))*scale*perspective, depth];
    }
    function poly(vertices, fill, stroke) {
      ctx.beginPath();
      vertices.forEach((v,i) => { const p=project(v); if(i) ctx.lineTo(p[0],p[1]); else ctx.moveTo(p[0],p[1]); });
      ctx.closePath(); ctx.fillStyle=fill; ctx.fill();
      if(stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=.5; ctx.stroke(); }
    }
    const shadow=ctx.createRadialGradient(w/2,h*.82,0,w/2,h*.82,scale*2.3);
    shadow.addColorStop(0,'rgba(0,0,0,.65)'); shadow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.save(); ctx.translate(w/2,h*.82);ctx.scale(1,.14);ctx.translate(-w/2,-h*.82);
    ctx.fillStyle=shadow;ctx.fillRect(0,h*.82-scale*3,w,scale*6);ctx.restore();
    // Fine horizon lines and four lift plumes make the hovering motion legible.
    ctx.strokeStyle='rgba(215,222,240,.1)';ctx.lineWidth=1;
    ctx.beginPath();ctx.ellipse(w/2,h*.81,scale*2.7,scale*.19,0,0,Math.PI*2);ctx.stroke();
    for(const x of [-1.4,1.4]) for(const y of [-.73,.73]) {
      const a=project([x,y,-.45]),b=project([x,y,-1.02]);
      const glow=ctx.createLinearGradient(a[0],a[1],b[0],b[1]);
      glow.addColorStop(0,'rgba(191,227,255,.65)');glow.addColorStop(1,'rgba(140,190,255,0)');
      ctx.fillStyle=glow;ctx.beginPath();ctx.moveTo(a[0]-scale*.045,a[1]);ctx.lineTo(a[0]+scale*.045,a[1]);ctx.lineTo(b[0]+scale*.11,b[1]);ctx.lineTo(b[0]-scale*.11,b[1]);ctx.closePath();ctx.fill();
    }
    const faces=mesh.map(f=>({v:f.v,kind:f.kind}));
    for(const x of [-1.4,1.4]) for(const y of [-.985,.985]) {
      faces.push({kind:'rim',v:Array.from({length:16},(_,i)=>[x+.17*Math.cos(i*Math.PI/8),y,-.3+.17*Math.sin(i*Math.PI/8)])});
    }
    for(const y of [-.62,.62]) faces.push({kind:'lamp',v:[[2.205,y-.20,-.18],[2.205,y+.20,-.18],[2.14,y+.19,-.10],[2.14,y-.19,-.10]]});
    faces.forEach(f=>f.depth=f.v.reduce((sum,v)=>sum+project(v)[2],0)/f.v.length);
    faces.sort((a,b)=>a.depth-b.depth);
    const palette={body:[227,30,53],glass:[43,62,79],wheel:[34,36,43],rim:[164,174,187],lamp:[235,246,255]};
    for(const face of faces) {
      const normal=cross(sub(face.v[1],face.v[0]),sub(face.v[2],face.v[0]));
      const shade=.48+.52*Math.abs(dot(normal,[-.3,-.4,.866])/(Math.hypot(...normal)||1));
      const color=palette[face.kind].map(v=>Math.round(v*(face.kind==='lamp'?1:shade)));
      poly(face.v,`rgb(${color.join(',')})`,face.kind==='body'?'rgba(255,130,145,.14)':null);
    }
  }
  function tick(time) {
    frame=0;
    if (last) elapsed+=Math.min(time-last,50);
    last=time;draw();
    if (!paused && visible && !document.hidden) frame=requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame);frame=0;last=0;
    button.textContent=paused?'Play motion':'Pause motion';
    button.setAttribute('aria-label',paused?'Play roadster animation':'Pause roadster animation');
    draw();
    if(mesh && !paused && visible && !document.hidden) frame=requestAnimationFrame(tick);
  }
  button.addEventListener('click',()=>{paused=!paused;sync();});
  motion.addEventListener('change',()=>{paused=motion.matches;sync();});
  document.addEventListener('visibilitychange',sync);
  new ResizeObserver(draw).observe(stage);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();},{threshold:.05}).observe(stage);
  fetch(canvas.dataset.mesh).then(r=>{if(!r.ok)throw Error('Mesh unavailable');return r.json();}).then(data=>{
    mesh=data;draw();stage.classList.add('roadster-ready');button.hidden=false;sync();
  }).catch(()=>{/* Keep the illustrated fallback and project link available. */});
})();
