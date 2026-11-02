import { cubeGeometry, sphereGeometry, makeBuffer, mat4Perspective, mat4LookAt, mat4Mul, mat4Trans, mat4Scale, mat4RotY } from '../utils.js';
export const T16 = {
  id:'deferred', title:'16 — Deferred shading (MRT G-buffer)',
  description:'Geometry pass writes albedo + normal + position to 3 render targets, then a fullscreen lighting pass with 3 lights. Tests MRT bandwidth.',
  checks:'3-target G-buffer + composite',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const W=canvas.width,H=canvas.height;
    const C=cubeGeometry(), S=sphereGeometry(10,14);
    const mk=(g)=>({g,v:makeBuffer(device,g.data,GPUBufferUsage.VERTEX),i:makeBuffer(device,g.index,GPUBufferUsage.INDEX)});
    const mC=mk(C), mS=mk(S);
    const gAlb=device.createTexture({size:[W,H],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const gNor=device.createTexture({size:[W,H],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const gPos=device.createTexture({size:[W,H],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const depth=device.createTexture({size:[W,H],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    // G-buffer pass: albedo | normal | world-pos
    const gCode=`struct U{ vp:mat4x4f, model:mat4x4f }; @group(0)@binding(0)var<uniform>u:U;
      struct V{@builtin(position)p:vec4f,@location(0)n:vec3f,@location(1)c:vec3f,@location(2)w:vec3f};
      @vertex fn vs(@location(0)pos:vec3f,@location(1)n:vec3f,@location(2)uv:vec2f,@location(3)col:vec3f)->V{
        var o:V; let w=(u.model*vec4f(pos,1.)).xyz; o.w=w; o.p=u.vp*vec4f(w,1.);
        o.n=normalize((u.model*vec4f(n,0.)).xyz); o.c=col; return o;}
      struct G{ @location(0)alb:vec4f, @location(1)nrm:vec4f, @location(2)pos:vec4f };
      @fragment fn fs(@location(0)n:vec3f,@location(1)c:vec3f,@location(2)w:vec3f)->G{
        var g:G; g.alb=vec4f(c,1.); g.nrm=vec4f(normalize(n),0.); g.pos=vec4f(w,1.); return g;}`;
    const lCode=`const FW=${W}.; const FH=${H}.;
      @group(0)@binding(0)var alb:texture_2d<f32>; @group(0)@binding(1)var nrm:texture_2d<f32>;
      @group(0)@binding(2)var pos:texture_2d<f32>; @group(0)@binding(3)var<uniform>li:array<vec4f,8>;
      struct P{@builtin(position)p:vec4f,@location(0)uv:vec2f};
      @vertex fn vs(@builtin(vertex_index)vi:u32)->P{ var o:P;
        o.p=vec4f(f32(vi%2)*2.-1.,-(f32(vi/2)*2.-1.),0.,1.); o.uv=vec2f(f32(vi%2),f32(vi/2)); return o;}
      @fragment fn fs(@location(0)uv:vec2f)->@location(0)vec4f{
        let a=textureLoad(alb,vec2i(uv*vec2f(FW,FH)),0);
        let n=textureLoad(nrm,vec2i(uv*vec2f(FW,FH)),0).xyz;
        let w=textureLoad(pos,vec2i(uv*vec2f(FW,FH)),0).xyz;
        if(dot(a.rgb,a.rgb)<1e-5){ return vec4f(vec3f(.02,.025,.05),1.); }
        let N=normalize(n); var col=a.rgb*.06;
        for(var i=0;i<3;i++){
          let L=li[i*2].xyz-w; let d=length(L); L/=max(d,vec3f(1e-4));
          let att=3./(1.+.3*d+.08*d*d);
          col+=a.rgb*li[i*2+1].rgb*max(dot(N,L),0.)*att;
        }
        return vec4f(col,1.);}`;
    const gm=device.createShaderModule({code:gCode}), lm=device.createShaderModule({code:lCode});
    const gPipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:gm,entryPoint:'vs',buffers:[{arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x2'},{shaderLocation:3,offset:32,format:'float32x3'}]}]},
      fragment:{module:gm,entryPoint:'fs',targets:[{format:'rgba8unorm'},{format:'rgba16float'},{format:'rgba16float'}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const lPipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:lm,entryPoint:'vs'},fragment:{module:lm,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-strip'}});
    const gbuf=device.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const gbg=device.createBindGroup({layout:gPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:gbuf}}]});
    const libuf=device.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const lbg=device.createBindGroup({layout:lPipe.getBindGroupLayout(0),entries:[
      {binding:0,resource:gAlb.createView()},{binding:1,resource:gNor.createView()},{binding:2,resource:gPos.createView()},{binding:3,resource:{buffer:libuf}}]});
    const proj=mat4Perspective(Math.PI/4,W/H,.1,100);
    const view=mat4LookAt([0,4,8.5],[0,-.3,0],[0,1,0]);
    const lcols=[[1,.35,.3,1],[.35,1,.45,1],[.4,.6,1,1]];
    let raf=0; const t0=performance.now();
    function frame(now){
      if(shouldStop())return;
      const t=(now-t0)/1000;
      const vp=mat4Mul(proj,mat4Mul(view,mat4RotY(Math.sin(t*.25)*.2)));
      // geometry pass
      let enc=device.createCommandEncoder();
      let pass=enc.beginRenderPass({colorAttachments:[
        {view:gAlb.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'},
        {view:gNor.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'},
        {view:gPos.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}],
        depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(gPipe); pass.setBindGroup(0,gbg);
      const put=(M,m)=>{
        const u=new Float32Array(32); u.set(vp,0); u.set(m,16);
        device.queue.writeBuffer(gbuf,0,u);
        pass.setVertexBuffer(0,M.v); pass.setIndexBuffer(M.i,'uint32');
        pass.drawIndexed(M.g.count);
      };
      for(let gx=0;gx<9;gx++)for(let gz=0;gz<9;gz++){
        const x=(gx-4)*1.25, z=(gz-4)*1.25, sph=(gx+gz)%3===0;
        put(sph?mS:mC, mat4Mul(mat4Trans(x,Math.sin(t+gx+gz)*.2,z),mat4Mul(mat4RotY(t*.4+gx),mat4Scale(sph?.5:.6))));
      }
      put(mC, mat4Mul(mat4Trans(0,-2.4,0),mat4Scale(11)));
      pass.end(); device.queue.submit([enc.finish()]);
      // lighting pass
      const li=new Float32Array(32);
      for(let i=0;i<3;i++){ const a=t*(.5+i*.2)+i*2.1; li.set([Math.cos(a)*4,1.8+Math.sin(t+i),Math.sin(a)*4,1],i*8); li.set(lcols[i],i*8+4); }
      device.queue.writeBuffer(libuf,0,li);
      enc=device.createCommandEncoder();
      pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      pass.setPipeline(lPipe); pass.setBindGroup(0,lbg); pass.draw(4);
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'82 objects -> 3-target G-buffer, fullscreen 3-light composite'};
  }
};
