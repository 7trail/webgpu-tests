import { sphereGeometry, cubeGeometry, makeBuffer, mat4Perspective, mat4LookAt, mat4Mul, mat4RotY, mat4Trans, mat4Scale } from '../utils.js';
export const T6 = {
  id:'postfx', title:'6 — Render-to-texture + post FX',
  description:'Scene renders offscreen, then fullscreen pass with chromatic aberration, vignette, animated grain + scanlines.',
  checks:'2 passes, offscreen target',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const W=canvas.width,H=canvas.height;
    const S=sphereGeometry(12,16);
    const vbuf=makeBuffer(device,S.data,GPUBufferUsage.VERTEX), ibuf=makeBuffer(device,S.index,GPUBufferUsage.INDEX);
    const sceneTex=device.createTexture({size:[W,H],sampleCount:4,format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const resolveTex=device.createTexture({size:[W,H],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const depth=device.createTexture({size:[W,H],sampleCount:4,format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
    const sceneWgsl=`struct U{vp:mat4x4f,model:mat4x4f};@group(0)@binding(0)var<uniform>u:U;
      struct V{@builtin(position)p:vec4f,@location(0)n:vec3f,@location(1)c:vec3f};
      @vertex fn vs(@location(0)pos:vec3f,@location(1)n:vec3f,@location(2)uv:vec2f,@location(3)col:vec3f)->V{
        var o:V; o.p=u.vp*u.model*vec4f(pos,1.); o.n=normalize((u.model*vec4f(n,0.)).xyz); o.c=col; return o;}
      @fragment fn fs(@location(0)n:vec3f,@location(1)c:vec3f)->@location(0)vec4f{
        let L=normalize(vec3f(.5,.8,.6)); let d=max(dot(normalize(n),L),0.);
        return vec4f(c*(.25+.9*d)+vec3f(.1,.15,.3)*pow(1.-d,2.),1.);}`;
    const postWgsl=`@group(0)@binding(0)var smp:sampler;@group(0)@binding(1)var tex:texture_2d<f32>;
      struct P{@builtin(position)p:vec4f,@location(0)uv:vec2f};
      @vertex fn vs(@builtin(vertex_index)i:u32)->P{var o:P;
        let x=f32(i%2)*2.-1.; let y=f32(i/2)*2.-1.; o.p=vec4f(x,-y,0.,1.); o.uv=vec2f(f32(i%2),f32(i/2)); return o;}
      struct PT{ t:vec4f }; @group(0)@binding(2)var<uniform>pt:PT;
      fn hash(p:vec2f)->f32{return fract(sin(dot(p,vec2f(127.1,311.7))+pt.t.x*13.)*43758.5);}
      @fragment fn fs(@location(0)uv:vec2f)->@location(0)vec4f{
        let t=pt.t.x; vec2f off=vec2f(sin(t*2.)*.004,0.);
        var c:vec3f;
        c.r=textureSample(tex,smp,uv+off).r;
        c.g=textureSample(tex,smp,uv).g;
        c.b=textureSample(tex,smp,uv-off).b; // chromatic aberration
        // vignette + scanlines + grain
        let d=distance(uv,vec2f(.5)); c*=smoothstep(.85,.35,d);
        c*=.9+.1*sin(uv.y*800.+t*8.);
        c+=(hash(uv*913.)-.5)*.09;
        // animated pulse
        c*=1.+.06*sin(t*2.2);
        return vec4f(c,1.);}`;
    const sm=device.createShaderModule({code:sceneWgsl}), pm=device.createShaderModule({code:postWgsl});
    const scenePipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:sm,entryPoint:'vs',buffers:[{arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x2'},{shaderLocation:3,offset:32,format:'float32x3'}]}]},
      fragment:{module:sm,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'},multisample:{count:4}});
    const postPipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:pm,entryPoint:'vs'},fragment:{module:pm,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-strip'}});
    const ubuf=device.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const pubuf=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const pbg=device.createBindGroup({layout:postPipe.getBindGroupLayout(0),entries:[{binding:0,resource:sampler},{binding:1,resource:resolveTex.createView()},{binding:2,resource:{buffer:pubuf}}]});
    const proj=mat4Perspective(Math.PI/4,W/H,.1,100), view=mat4LookAt([0,2.6,6.4],[0,0,0],[0,1,0]);
    let raf=0; const t0=performance.now();
    function frame(now){
      if(shouldStop())return;
      const t=(now-t0)/1000;
      const vp=mat4Mul(proj,mat4Mul(view,mat4RotY(t*.25)));
      // pass 1: scene -> MSAA resolve
      let enc=device.createCommandEncoder();
      let pass=enc.beginRenderPass({colorAttachments:[{view:sceneTex.createView(),resolveTarget:resolveTex.createView(),loadOp:'clear',clearValue:{r:.06,g:.04,b:.1,a:1},storeOp:'discard'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(scenePipe);
      for(let i=0;i<30;i++){
        const x=(i%6-2.5)*1.3, z=(Math.floor(i/6)-2)*1.3, y=Math.sin(t*1.4+i)*.4;
        const m=mat4Mul(mat4Trans(x,y,z),mat4Scale(.55));
        const u=new Float32Array(32); u.set(vp,0); u.set(m,16);
        device.queue.writeBuffer(ubuf,0,u);
        pass.setVertexBuffer(0,vbuf); pass.setIndexBuffer(ibuf,'uint32');
        pass.setBindGroup(0,device.createBindGroup({layout:scenePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}}]}));
        pass.drawIndexed(S.count);
      }
      pass.end(); device.queue.submit([enc.finish()]);
      device.queue.writeBuffer(pubuf,0,new Float32Array([t,0,0,0]));
      // pass 2: post -> canvas
      enc=device.createCommandEncoder();
      pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      pass.setPipeline(postPipe); pass.setBindGroup(0,pbg); pass.draw(4); pass.end();
      device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'30 objs MSAA 4x offscreen + fullscreen CA/vignette/grain'};
  }
};
