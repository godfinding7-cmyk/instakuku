(() => {
  const canvas = document.getElementById('fiberCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  let w=0,h=0,dpr=1,t=0,mouseX=0,mouseY=0,targetX=0,targetY=0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fibers = Array.from({length: 92}, (_,i)=>({
    a:(i/92)*Math.PI*2,
    phase:Math.random()*Math.PI*2,
    radius:.56+Math.random()*.32,
    thick:.55+Math.random()*1.1,
    z:Math.random(),
    drift:(Math.random()-.5)*.9
  }));
  const sparks = Array.from({length: 44},()=>({a:Math.random()*Math.PI*2,r:.18+Math.random()*.42,s:.3+Math.random()*.8,o:.18+Math.random()*.6}));

  function resize(){
    dpr=Math.min(devicePixelRatio||1,2);
    w=canvas.clientWidth;h=canvas.clientHeight;
    canvas.width=Math.max(1,Math.floor(w*dpr));canvas.height=Math.max(1,Math.floor(h*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function center(){
    const mobile=w<900;
    return {x:mobile?w*.54:w*.62,y:mobile?h*.53:h*.47,scale:mobile?Math.min(w,h)*.38:Math.min(w,h)*.42};
  }
  function point(a,r,z,tt){
    const c=center();
    const wobble=Math.sin(a*3+tt*1.05+z*4)*.12 + Math.cos(a*2-tt*.7)*.06;
    const rr=c.scale*r*(1+wobble);
    const squash=.78 + z*.2;
    const rot=tt*.09 + z*.7 + mouseX*.00008;
    const aa=a+rot;
    return {
      x:c.x+Math.cos(aa)*rr + Math.sin(aa*2+tt)*c.scale*.09 + mouseX*.018*(.3+z),
      y:c.y+Math.sin(aa)*rr*squash + Math.cos(aa*1.7-tt*.6)*c.scale*.08 + mouseY*.018*(.3+z)
    };
  }
  function drawGlow(c){
    const g=ctx.createRadialGradient(c.x,c.y,2,c.x,c.y,c.scale*.34);
    g.addColorStop(0,'rgba(255,251,221,.98)');
    g.addColorStop(.12,'rgba(255,202,83,.95)');
    g.addColorStop(.34,'rgba(255,105,45,.88)');
    g.addColorStop(.64,'rgba(230,63,54,.45)');
    g.addColorStop(1,'rgba(255,79,67,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(c.x,c.y,c.scale*.36,0,Math.PI*2);ctx.fill();
  }
  function draw(){
    ctx.clearRect(0,0,w,h);
    targetX+=(mouseX-targetX)*.05;targetY+=(mouseY-targetY)*.05;
    const c=center();
    // soft halo
    const halo=ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,c.scale*1.45);
    halo.addColorStop(0,'rgba(255,255,255,.28)');halo.addColorStop(.48,'rgba(255,255,255,.08)');halo.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=halo;ctx.fillRect(c.x-c.scale*1.5,c.y-c.scale*1.5,c.scale*3,c.scale*3);

    ctx.save();
    ctx.globalCompositeOperation='source-over';
    fibers.forEach((f,idx)=>{
      const steps=32;ctx.beginPath();
      for(let i=0;i<=steps;i++){
        const u=i/steps;
        const a=f.a + (u-.5)*2.1 + Math.sin(t*.45+f.phase)*.12;
        const r=f.radius*(.72+.33*Math.sin(u*Math.PI)) + Math.sin(u*5+f.phase+t*.6)*.035;
        const p=point(a,r,f.z,t*.6+f.drift);
        const curl=Math.sin(u*Math.PI)*c.scale*.34;
        const x=p.x + Math.cos(a+Math.PI/2)*curl*(f.z-.34);
        const y=p.y + Math.sin(a+Math.PI/2)*curl*(f.z-.34)*.55;
        i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      const alpha=.22+f.z*.55;
      ctx.strokeStyle=`rgba(255,250,248,${alpha})`;
      ctx.lineWidth=f.thick*(.7+f.z*1.1);
      ctx.lineCap='round';ctx.stroke();
    });
    ctx.restore();

    drawGlow(c);
    ctx.save();ctx.globalCompositeOperation='screen';
    sparks.forEach(s=>{
      const a=s.a+t*.18*s.s; const r=c.scale*s.r*(1+.12*Math.sin(t+s.a*3));
      const x=c.x+Math.cos(a)*r*1.6,y=c.y+Math.sin(a)*r*.9;
      ctx.fillStyle=`rgba(255,207,118,${s.o*(.6+.4*Math.sin(t*2+s.a))})`;
      ctx.beginPath();ctx.arc(x,y,1+s.s*1.8,0,Math.PI*2);ctx.fill();
    });ctx.restore();

    // faint orbit rings like the reference's technical overlay
    ctx.save();ctx.translate(c.x,c.y);ctx.strokeStyle='rgba(255,255,255,.21)';ctx.lineWidth=.7;
    [1.04,1.22,1.43].forEach((r,i)=>{ctx.beginPath();ctx.ellipse(0,0,c.scale*r,c.scale*r*.77,-.18+i*.07,0,Math.PI*2);ctx.stroke()});ctx.restore();

    if(!reduced){t+=.012;requestAnimationFrame(draw)}
  }
  addEventListener('resize',resize,{passive:true});
  addEventListener('pointermove',e=>{mouseX=e.clientX-w/2;mouseY=e.clientY-h/2},{passive:true});
  resize();draw();
})();
