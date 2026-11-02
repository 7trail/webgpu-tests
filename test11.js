export const T11 = {
  id:'fill-rate', title:'11 — Fill-rate / overdraw (48 fullscreen layers)',
  description:'48 additive fullscreen passes, each with 4-octave fbm. Punishes ROPs + fragment units; FPS scales with pixel count.',
  checks:'48 fullscreen draws, additive',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const wgsl=`
      struct U{ t:vec4f }; @group(0)@binding(0)var<uniform>u:U;
      struct P{@builtin(position)p:vec4f,@location(0)uv:vec2f,@location(1)li:f32};
      @vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->P{
        var o:P; o.p=vec4f(f32(vi%2)*2.-1.,-(f32(vi/2)*2.-1.),0.,1.);
        o.uv=vec2f(f32(vi%2),f32(vi/2)); o.li=f32(ii); return o;}
      fn hash(p:vec2f)->f32{ return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453); }
      fn noise(p:vec2f)->f32{ let i=floor(p),f=fract(p); let x=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2f(1,0)),x.x),mix(hash(i+vec2f(0,1)),hash(i+vec2f(1,1)),x.x),x.y); }
      fn fbm(p:vec2f)->f32{ var v=0.; var a=.5; for(var i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=.5; } return v; }
      @fragment fn fs(@location(0)uv:vec2f,@location(1)li:f32)->@location(0)vec4f{
        let t=u.t.x+li*.37;
        let p=uv*(3.+li*.35)+vec2f(t*.05,-t*.03);
        let f=fbm(p+fbm(p+t*.02)*1.4);
        var col=.5+.5*cos(6.28*(f+li*.043+vec3f(0.,.33,.67)));
        col*= .55+.45*fbm(p*2.-t*.01);
        return vec4f(col*(.028+.02*f),1.);}`;
    const mod=device.createShaderModule({code:wgsl});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs'},
      fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one'}}}]},
      primitive:{topology:'triangle-strip'}});
    const ubuf=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bg=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}}]});
    const LAYERS=48;
    let raf=0; const t0=performance.now();
    function frame(now){
      if(shouldStop())return;
      device.queue.writeBuffer(ubuf,0,new Float32Array([(now-t0)/1000,0,0,0]));
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      pass.setPipeline(pipe); pass.setBindGroup(0,bg); pass.draw(4,LAYERS);
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'48 fullscreen layers x 4-octave fbm, 1 instanced draw'};
  }
};
