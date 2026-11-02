import { cubeGeometry, makeBuffer, mat4Perspective, mat4LookAt, mat4Mul, mat4Trans, mat4Scale, mat4RotY } from '../utils.js';
export const T18 = {
  id:'streaming-upload', title:'18 — CPU streaming (15k matrices/frame)',
  description:'15,000 instance matrices recomputed on the CPU and re-uploaded every frame (~1 MB/frame). Stresses JS + queue bandwidth, not the GPU.',
  checks:'~1MB/frame upload, 1 draw',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const geo=cubeGeometry();
    const vbuf=makeBuffer(device,geo.data,GPUBufferUsage.VERTEX), ibuf=makeBuffer(device,geo.index,GPUBufferUsage.INDEX);
    const N=15000;
    const seeds=new Float32Array(N*4);
    for(let i=0;i<N;i++){ seeds.set([Math.random()*6.28,Math.random()*6.28,.3+Math.random(),.2+Math.random()*.8],i*4); }
    const imBuf=device.createBuffer({size:N*64,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    const staging=new Float32Array(N*16);
    const wgsl=`struct U{vp:mat4x4f};@group(0)@binding(0)var<uniform>u:U;
      struct V{@builtin(position)p:vec4f,@location(0)c:vec3f};
      @vertex fn vs(@location(0)pos:vec3f,@location(1)n:vec3f,@location(2)uv:vec2f,@location(3)col:vec3f,
        @location(4)m0:vec4f,@location(5)m1:vec4f,@location(6)m2:vec4f,@location(7)m3:vec4f)->V{
        var o:V; o.p=u.vp*mat4x4f(m0,m1,m2,m3)*vec4f(pos,1.); o.c=col; return o;}
      @fragment fn fs(@location(0)c:vec3f)->@location(0)vec4f{ return vec4f(c,1.); }`;
    const mod=device.createShaderModule({code:wgsl});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs',buffers:[
        {arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x2'},{shaderLocation:3,offset:32,format:'float32x3'}]},
        {arrayStride:64,stepMode:'instance',attributes:[{shaderLocation:4,offset:0,format:'float32x4'},{shaderLocation:5,offset:16,format:'float32x4'},{shaderLocation:6,offset:32,format:'float32x4'},{shaderLocation:7,offset:48,format:'float32x4'}]}]},
      fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const ubuf=device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bg=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}}]});
    const proj=mat4Perspective(Math.PI/3,canvas.width/canvas.height,.1,200);
    const view=mat4LookAt([0,16,30],[0,0,0],[0,1,0]);
    const vp=mat4Mul(proj,view);
    device.queue.writeBuffer(ubuf,0,vp);
    // precompute orbit params on CPU
    const px=new Float32Array(N),pz=new Float32Array(N),ph=new Float32Array(N),ps=new Float32Array(N);
    for(let i=0;i<N;i++){ const a=Math.random()*6.28, r=4+Math.random()*22; px[i]=Math.cos(a)*r; pz[i]=Math.sin(a)*r; ph[i]=Math.random()*6.28; ps[i]=.2+Math.random()*.55; }
    const M=new Float32Array(16);
    let raf=0; const t0=performance.now();
    function frame(now){
      if(shouldStop())return;
      const t=(now-t0)/1000;
      // CPU: rebuild all 15k matrices (rotation + bob) — this is the tax under test
      for(let i=0;i<N;i++){
        const s=ps[i], a=ph[i]+t*(.3+ (i%7)*.06);
        const c=Math.cos(a)*s, si=Math.sin(a)*s;
        const x=px[i]+Math.sin(t*.5+ph[i])*1.2, z=pz[i]+Math.cos(t*.4+ph[i])*.8;
        const y=Math.sin(t*1.3+ph[i]*2.)*1.5+1;
        const o=i*16;
        staging[o]=c; staging[o+1]=0; staging[o+2]=-si; staging[o+3]=0;
        staging[o+4]=0; staging[o+5]=s; staging[o+6]=0; staging[o+7]=0;
        staging[o+8]=si; staging[o+9]=0; staging[o+10]=c; staging[o+11]=0;
        staging[o+12]=x; staging[o+13]=y; staging[o+14]=z; staging[o+15]=1;
      }
      device.queue.writeBuffer(imBuf,0,staging);
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.03,g:.04,b:.08,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(pipe); pass.setBindGroup(0,bg);
      pass.setVertexBuffer(0,vbuf); pass.setVertexBuffer(1,imBuf);
      pass.setIndexBuffer(ibuf,'uint32'); pass.drawIndexed(geo.count,N);
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'15k CPU matrices + 960KB upload/frame, single draw'};
  }
};
