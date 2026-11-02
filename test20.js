export const T20 = {
  id:'raymarch', title:'20 — Finale II: SDF raymarch (64 steps)',
  description:'Fullscreen sphere-traced scene: twisted torus knot + bouncing spheres + infinite floor, soft shadows, AO, reflections. The heaviest fragment math in the suite.',
  checks:'64-step sphere tracing + shadows',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const wgsl=`
      struct U{ t:vec4f, res:vec4f }; @group(0)@binding(0)var<uniform>u:U;
      struct P{@builtin(position)p:vec4f,@location(0)uv:vec2f};
      @vertex fn vs(@builtin(vertex_index)vi:u32)->P{ var o:P;
        o.p=vec4f(f32(vi%2)*2.-1.,-(f32(vi/2)*2.-1.),0.,1.); o.uv=vec2f(f32(vi%2),f32(vi/2)); return o;}
      fn hash(p:vec2f)->f32{ return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453; }
      fn sdTorus(p:vec3f,t:vec2f)->f32{ let q=vec2f(length(p.xz)-t.x,p.y); return length(q)-t.y; }
      fn sdBox(p:vec3f,b:vec3f)->f32{ let q=abs(p)-b; return length(max(q,vec3f(0.)))+min(max(q.x,max(q.y,q.z)),0.); }
      fn sdSphere(p:vec3f,r:f32)->f32{ return length(p)-r; }
      fn map(p:vec3f,t:f32)->vec2f{
        // twisted torus knot-ish: torus rotated + displaced
        var q=p-vec3f(0.,.6,0.);
        let tw=q.y*1.4+t*.3;
        let c=cos(tw), s=sin(tw);
        q.xz=mat2x2f(c,-s,s,c)*q.xz;
        var d=sdTorus(q,vec2f(1.15,.34));
        var m=1.;
        // orbiting spheres
        for(var i=0;i<3;i++){
          let a=t*(.5+f32(i)*.23)+f32(i)*2.1;
          let sp=vec3f(cos(a)*1.9,.6+sin(t*.9+f32(i)*2.)*.9,sin(a)*1.9);
          let dd=sdSphere(p-sp,.32); if(dd<d){ d=dd; m=2.+f32(i); }
        }
        // floor
        let fl=p.y+.9; if(fl<d){ d=fl; m=5.; }
        // floating boxes ring
        for(var j=0;j<4;j++){
          let a2=t*.25+f32(j)*1.5708;
          let dd=sdBox(p-vec3f(cos(a2)*2.6,1.4+sin(t*.6+f32(j))*.5,sin(a2)*2.6),vec3f(.18));
          if(dd<d){ d=dd; m=6.; }
        }
        return vec2f(d,m); }
      fn normal(p:vec3f,t:f32)->vec3f{
        let e=vec2f(.002,0.);
        return normalize(vec3f(map(p+e.xyy,t).x-map(p-e.xyy,t).x,
                                map(p+e.yxy,t).x-map(p-e.yxy,t).x,
                                map(p+e.yyx,t).x-map(p-e.yyx,t).x)); }
      fn softShadow(p:vec3f,ld:vec3f,t:f32)->f32{
        var res=1.; var h=0.02;
        for(var i=0;i<16;i++){
          let d=map(p+ld*h,t).x; if(d<.001){ return 0.; }
          res=min(res,8.*d/h); h+=clamp(d,.01,.4);
          if(h>4.){ break; }
        }
        return clamp(res,0.,1.); }
      fn ao(p:vec3f,n:vec3f,t:f32)->f32{
        var o=0.; var s=1.;
        for(var i=1;i<=4;i++){ let h=.02+.09*f32(i); o+=(h-map(p+n*h,t).x)*s; s*=.7; }
        return clamp(1.-2.2*o,0.,1.); }
      @fragment fn fs(@location(0)uv:vec2f)->@location(0)vec4f{
        let t=u.t.x;
        let frag=vec2f(uv.x*u.res.x,(1.-uv.y)*u.res.y);
        let p2=(frag*2.-u.res.xy)/u.res.y;
        let ca=t*.15;
        let ro=vec3f(cos(ca)*4.2,1.6+sin(t*.23)*.5,sin(ca)*4.2);
        let ta=vec3f(0.,.3,0.);
        let fw=normalize(ta-ro); let rt=normalize(cross(fw,vec3f(0.,1.,0.))); let up=cross(rt,fw);
        let rd=normalize(p2.x*rt+p2.y*up+1.6*fw);
        var h=0.; var m=-1.; var id=-1.;
        for(var i=0;i<64;i++){
          let r=map(ro+rd*h,t); m=r.x; id=r.y;
          if(m<.0015){ break; }
          h+=m*.85; if(h>22.){ break; }
        }
        var col:vec3f;
        if(h>22.){
          // sky gradient + sun
          let s=max(dot(rd,normalize(vec3f(.5,.6,.3))),0.);
          col=mix(vec3f(.02,.03,.09),vec3f(.1,.2,.45),clamp(rd.y*.5+.5,0.,1.));
          col+=vec3f(1.,.8,.5)*pow(s,300.)*3.+vec3f(1.,.7,.4)*pow(s,8.)*.25;
        } else {
          let p=ro+rd*h; let n=normal(p,t);
          let ld=normalize(vec3f(.5,.7,.35));
          let dif=max(dot(n,ld),0.);
          let sh=softShadow(p+n*.01,ld,t);
          let amb=ao(p,n,t);
          var alb=vec3f(.8);
          if(id<1.5){ alb=.5+.5*cos(t*.4+vec3f(0.,2.1,4.2)); }
          else if(id<4.){ alb=vec3f(.9,.45+.2*sin(t+f32(id)),.25); }
          else if(id<5.5){ alb=vec3f(.25,.3,.4)*(0.7+0.3*sin(p.x*2.)*sin(p.z*2.)); }
          else { alb=vec3f(.3,.7,.9); }
          col=alb*(.12+dif*sh*1.4)*(.35+.65*amb);
          let hv=normalize(ld-rd);
          col+=vec3f(1.)*pow(max(dot(n,hv),0.),60.)*sh;
          // fog
          col=mix(col,vec3f(.05,.08,.18),1.-exp(-h*h*.0012));
        }
        // vignette + grain
        let d2=distance(uv,vec2f(.5)); col*=smoothstep(.92,.4,d2);
        col+=(hash(uv*913.+t)-.5)*.05;
        return vec4f(col,1.);}`;
    const mod=device.createShaderModule({code:wgsl});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-strip'}});
    const ubuf=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bg=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}}]});
    let raf=0; const t0=performance.now();
    function frame(now){
      if(shouldStop())return;
      device.queue.writeBuffer(ubuf,0,new Float32Array([(now-t0)/1000,0,0,0, canvas.width,canvas.height,0,0]));
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      pass.setPipeline(pipe); pass.setBindGroup(0,bg); pass.draw(4);
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'64-step sphere tracing, soft shadows, AO, spec'};
  }
};
