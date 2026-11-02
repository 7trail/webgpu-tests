import { proceduralTexture } from '../utils.js';
export const T13 = {
  id:'texture-fetch', title:'13 — Texture-fetch stress (32 taps/pixel)',
  description:'Fullscreen quad sampling 4 procedural textures 8x each with warped UVs. Punishes sampler + texture cache bandwidth.',
  checks:'32 texture taps per pixel',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const t0=proceduralTexture(device,'noise',256), t1=proceduralTexture(device,'gradient',256);
    const t2=proceduralTexture(device,'bricks',256), t3=proceduralTexture(device,'dots',256);
    const sampler=device.createSampler({magFilter:'linear',minFilter:'linear',mipmapFilter:'linear'});
    const wgsl=`
      struct U{ t:vec4f }; @group(0)@binding(0)var<uniform>u:U;
      @group(0)@binding(1)var smp:sampler;
      @group(0)@binding(2)var a:texture_2d<f32>; @group(0)@binding(3)var b:texture_2d<f32>;
      @group(0)@binding(4)var c:texture_2d<f32>; @group(0)@binding(5)var d:texture_2d<f32>;
      struct P{@builtin(position)p:vec4f,@location(0)uv:vec2f};
      @vertex fn vs(@builtin(vertex_index)vi:u32)->P{ var o:P;
        o.p=vec4f(f32(vi%2)*2.-1.,-(f32(vi/2)*2.-1.),0.,1.); o.uv=vec2f(f32(vi%2),f32(vi/2)); return o;}
      @fragment fn fs(@location(0)uv:vec2f)->@location(0)vec4f{
        let t=u.t.x; var acc=vec3f(0.);
        for(var i=0;i<8;i++){
          let f=f32(i);
          let w1=uv*(1.+f*.35)+vec2f(sin(t*.4+f)*.12,cos(t*.33+f*1.7)*.12);
          let w2=uv*(2.+f*.5)+vec2f(t*.02,-t*.015)+f*.13;
          acc+=textureSample(a,smp,fract(w1)).rgb*.14;
          acc+=textureSample(b,smp,fract(w2)).rgb*.12;
          acc+=textureSample(c,smp,fract(w1*1.7-w2*.4)).rgb*.11;
          acc+=textureSample(d,smp,fract(w2*1.3+w1*.6)).rgb*.10;
        }
        // normalize-ish + animated grade
        acc*=.9+.25*sin(t*1.4+uv.x*4.);
        return vec4f(acc*.5,1.);}`;
    const mod=device.createShaderModule({code:wgsl});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-strip'}});
    const ubuf=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bg=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:ubuf}},{binding:1,resource:sampler},
      {binding:2,resource:t0.createView()},{binding:3,resource:t1.createView()},
      {binding:4,resource:t2.createView()},{binding:5,resource:t3.createView()}]});
    let raf=0; const t0p=performance.now();
    function frame(now){
      if(shouldStop())return;
      device.queue.writeBuffer(ubuf,0,new Float32Array([(now-t0p)/1000,0,0,0]));
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      pass.setPipeline(pipe); pass.setBindGroup(0,bg); pass.draw(4);
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'4 textures x 8 warped taps = 32 fetches/pixel'};
  }
};
