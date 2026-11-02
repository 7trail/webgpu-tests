import { cubeGeometry, sphereGeometry, makeBuffer, proceduralTexture, mat4Perspective, mat4LookAt, mat4Mul, mat4RotY, mat4Trans, mat4Scale } from '../utils.js';
export const T4 = {
  id:'animated-shaders', title:'4 — Textures + animated / intensive shaders',
  description:'Textured scene with time-driven vertex wobble, plasma + fresnel + fbm fragment shaders. Tests dynamic uniforms, heavy ALU.',
  checks:'animated UV/plasma, wobble',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const cube=cubeGeometry(), sph=sphereGeometry(20,26);
    const mk=(g)=>({g,v:makeBuffer(device,g.data,GPUBufferUsage.VERTEX),i:makeBuffer(device,g.index,GPUBufferUsage.INDEX)});
    const A=mk(cube), B=mk(sph);
    const texA=proceduralTexture(device,'gradient',256), texB=proceduralTexture(device,'noise',256), texC=proceduralTexture(device,'grid',256);
    const sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
    const wgsl=`
      struct U{ mvp:mat4x4f, time:vec4f }; @group(0)@binding(0)var<uniform>u:U;
      @group(0)@binding(1)var smp:sampler; @group(0)@binding(2)var tex:texture_2d<f32>; @group(0)@binding(3)var tex2:texture_2d<f32>;
      struct V{@builtin(position)p:vec4f,@location(0)uv:vec2f,@location(1)n:vec3f,@location(2)w:vec3f};
      @vertex fn vs(@location(0)pos:vec3f,@location(1)n:vec3f,@location(2)uv:vec2f,@location(3)col:vec3f)->V{
        var o:V; var p=pos;
        let t=u.time.x;
        p += n * (sin(t*2.2 + pos.x*4.0 + pos.y*3.0)*0.06); // wobble along normal
        p.x += sin(t*1.5+p.y*5.0)*0.03;
        o.p=u.mvp*vec4f(p,1.); o.uv=uv; o.n=n; o.w=p; return o;}
      fn plasma(uv:vec2f,t:f32)->vec3f{
        let a=sin(uv.x*12.0+t*1.7)+sin(uv.y*15.0-t*1.3)+sin((uv.x+uv.y)*9.0+t*.8);
        let b=sin(length(uv-.5)*22.0-t*2.0);
        return .5+.5*cos(t*.6+vec3f(a,b,a+b)*1.2+vec3f(0.,2.1,4.2));}
      fn hash(p:vec2f)->f32{ return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453); }
      fn noise(p:vec2f)->f32{ let i=floor(p),f=fract(p); let u=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2f(1,0)),u.x),mix(hash(i+vec2f(0,1)),hash(i+vec2f(1,1)),u.x),u.y);}
      @fragment fn fs(@location(0)uv:vec2f,@location(1)n:vec3f,@location(2)w:vec3f)->@location(0)vec4f{
        let t=u.time.x;
        let auv=uv+vec2f(sin(t+uv.y*8.)*.05,cos(t*.8+uv.x*8.)*.05);
        var base=textureSample(tex,smp,auv).rgb;
        var det=textureSample(tex2,smp,uv*3.+vec2f(t*.03,-t*.02)).rgb;
        base=mix(base,det,.35);
        let pl=plasma(auv+vec2f(t*.05,0.),t);
        let fres=pow(1.-abs(n.z),2.5);
        let n2=noise(uv*24.+t*.7)*.5+noise(uv*48.-t*.4)*.5; // fbm-ish detail
        var col=mix(base,pl,.38+fres*.3)+n2*.18;
        col+=fres*vec3f(.4,.7,1.)*.8;
        // fake scanline shimmer
        col*= .92+.08*sin(w.y*60.+t*3.);
        return vec4f(col,1.);}`;
    const mod=device.createShaderModule({code:wgsl});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs',buffers:[{arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x2'},{shaderLocation:3,offset:32,format:'float32x3'}]}]},
      fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const ubuf=device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const proj=mat4Perspective(Math.PI/4,canvas.width/canvas.height,.1,100);
    const view=mat4LookAt([0,1.6,5.4],[0,0,0],[0,1,0]);
    const bg0=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}},{binding:1,resource:sampler},{binding:2,resource:texA.createView()},{binding:3,resource:texB.createView()} ]});
    const bg1=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}},{binding:1,resource:sampler},{binding:2,resource:texC.createView()},{binding:3,resource:texB.createView()} ]});
    const items=[]; for(let i=0;i<24;i++){ const sph_=i%3===1; items.push({sph:sph_,x:(i%6-2.5)*1.35,y:(Math.floor(i/6)%2? .8:-.9)+Math.sin(i)*.15,z:-Math.floor(i/12)*1.6,s:.55+(i%4)*.14,sp:.6+(i%5)*.25}); }
    let raf=0; const t0=performance.now();
    function frame(now){
      if(shouldStop())return;
      const t=(now-t0)/1000;
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.03,g:.03,b:.07,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(pipe);
      items.forEach((it,idx)=>{
        const m=mat4Mul(proj,mat4Mul(view,mat4Mul(mat4Trans(it.x,it.y,it.z),mat4Mul(mat4RotY(t*it.sp+idx),mat4Scale(it.s)))));
        const u=new Float32Array(24); u.set(m,0); u.set([t,t*.7,0,0],16);
        device.queue.writeBuffer(ubuf,0,u);
        const M=it.sph?B:A;
        pass.setVertexBuffer(0,M.v); pass.setIndexBuffer(M.i,'uint32');
        pass.setBindGroup(0,idx%2?bg1:bg0);
        pass.drawIndexed(M.g.count);
      });
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'24 draws, plasma+fresnel+fbm frag, wobble vert'};
  }
};
