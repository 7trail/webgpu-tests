import { cubeGeometry, makeBuffer, mat4Perspective, mat4LookAt, mat4Mul, mat4RotY, mat4Trans, mat4Scale } from '../utils.js';
export const T8 = {
  id:'instanced-world', title:'8 — Large instanced world + fog (5k)',
  description:'5,000 instanced boxes/trees with per-instance color, orbiting camera, distance fog. Tests big instance buffers + depth.',
  checks:'5k instances, 1 draw call',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const geo=cubeGeometry();
    const vbuf=makeBuffer(device,geo.data,GPUBufferUsage.VERTEX), ibuf=makeBuffer(device,geo.index,GPUBufferUsage.INDEX);
    const N=5000;
    const imat=new Float32Array(N*16), icol=new Float32Array(N*4);
    for(let i=0;i<N;i++){
      const x=(Math.random()-.5)*60, z=(Math.random()-.5)*60;
      const h=.3+Math.random()*Math.random()*3.2, w=.25+Math.random()*.7;
      // compose scale(xz=w,y=h) + translate in one matrix
      imat.set([w,0,0,0, 0,h,0,0, 0,0,w,0, x,h/2-.5,z],i*16);
      const t=Math.random();
      const c=t<.6?[.15+Math.random()*.2,.5+Math.random()*.3,.2]:t<.85?[.5,.4+Math.random()*.2,.25]:[.6,.62,.65];
      icol.set(c,i*4);
    }
    const imBuf=device.createBuffer({size:imat.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    const icBuf=device.createBuffer({size:icol.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(imBuf,0,imat); device.queue.writeBuffer(icBuf,0,icol);
    const wgsl=`struct U{vp:mat4x4f, fog:vec4f};@group(0)@binding(0)var<uniform>u:U;
      struct V{@builtin(position)p:vec4f,@location(0)c:vec3f,@location(1)f:f32};
      @vertex fn vs(@location(0)pos:vec3f,@location(1)n:vec3f,@location(2)uv:vec2f,@location(3)col:vec3f,
        @location(4)m0:vec4f,@location(5)m1:vec4f,@location(6)m2:vec4f,@location(7)m3:vec4f,@location(8)ic:vec4f)->V{
        var o:V; let im=mat4x4f(m0,m1,m2,m3); let w=(im*vec4f(pos,1.)).xyz;
        o.p=u.vp*vec4f(w,1.); o.c=ic.rgb*(.6+.4*max(n.y,0.));
        o.f=distance(w,u.fog.xyz); return o;}
      @fragment fn fs(@location(0)c:vec3f,@location(1)f:f32)->@location(0)vec4f{
        let fogC=vec3f(.55,.7,.95);
        let k=1.-exp(-f*f*.0011);
        return vec4f(mix(c,fogC,clamp(k,0.,1.)),1.);}`;
    const mod=device.createShaderModule({code:wgsl});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs',buffers:[
        {arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x2'},{shaderLocation:3,offset:32,format:'float32x3'}]},
        {arrayStride:64,stepMode:'instance',attributes:[{shaderLocation:4,offset:0,format:'float32x4'},{shaderLocation:5,offset:16,format:'float32x4'},{shaderLocation:6,offset:32,format:'float32x4'},{shaderLocation:7,offset:48,format:'float32x4'}]},
        {arrayStride:16,stepMode:'instance',attributes:[{shaderLocation:8,offset:0,format:'float32x4'}]}]},
      fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const ubuf=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bg=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}}]});
    const proj=mat4Perspective(Math.PI/3,canvas.width/canvas.height,.1,200);
    let raf=0; const t0=performance.now();
    function frame(now){
      if(shouldStop())return;
      const t=(now-t0)/1000;
      const cx=Math.cos(t*.15)*26, cz=Math.sin(t*.15)*26;
      const view=mat4LookAt([cx,10+Math.sin(t*.3)*2,cz],[0,0,0],[0,1,0]);
      const vp=mat4Mul(proj,view);
      const u=new Float32Array(20); u.set(vp,0); u.set([cx,10,cz,0],16);
      device.queue.writeBuffer(ubuf,0,u);
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.55,g:.7,b:.95,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(pipe); pass.setBindGroup(0,bg);
      pass.setVertexBuffer(0,vbuf); pass.setVertexBuffer(1,imBuf); pass.setVertexBuffer(2,icBuf);
      pass.setIndexBuffer(ibuf,'uint32'); pass.drawIndexed(geo.count,N);
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'5,000 instances in ONE drawIndexed, fog + orbit cam'};
  }
};
