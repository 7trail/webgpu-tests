import { makeBuffer, mat4Perspective, mat4LookAt, mat4Mul } from '../utils.js';
export const T14 = {
  id:'transparency', title:'14 — Transparency overdraw (8k billboards)',
  description:'8,000 camera-facing transparent billboards with radial falloff. Depth-write off, heavy painter overdraw in the city center.',
  checks:'8k transparent quads, blend on',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const N=8000;
    const inst=new Float32Array(N*8);
    for(let i=0;i<N;i++){
      const clustered=Math.random()<.6;
      const x=clustered?(Math.random()-.5)*6:(Math.random()-.5)*16;
      const y=(Math.random()-.5)*8, z=clustered?(Math.random()-.5)*6:(Math.random()-.5)*10;
      const s=.15+Math.random()*.5;
      inst.set([x,y,z,s, Math.random(),.5+.5*Math.random(),.8,Math.random()],i*8);
    }
    const ibuf2=makeBuffer(device,new Uint32Array([0,1,2,2,1,3]),GPUBufferUsage.INDEX);
    const instBuf=device.createBuffer({size:inst.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(instBuf,0,inst);
    const code=`struct U{ mvp:mat4x4f, right:vec4f, up:vec4f, t:vec4f };
      @group(0)@binding(0)var<uniform>u:U;
      struct V{@builtin(position)p:vec4f,@location(0)uv:vec2f,@location(1)c:vec3f,@location(2)a:f32};
      @vertex fn vs(@builtin(vertex_index)vi:u32,
        @location(0)ip:vec4f,@location(1)ic:vec4f)->V{
        var o:V;
        let corners=array<vec2f,4>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(1.,1.));
        let q=corners[vi%4u];
        let sway=sin(u.t.x*1.5+ip.x*2.+ip.y)*.15;
        let w=ip.xyz+(u.right.xyz*(q.x+sway)+u.up.xyz*q.y)*ip.w;
        o.p=u.mvp*vec4f(w,1.); o.uv=q*.5+.5;
        o.c=mix(ic.rgb,.5+.5*cos(6.28*(ic.r+vec3f(0.,.33,.67))+u.t.x*.2),.35);
        o.a=ic.a; return o;}
      fn hash(p:vec2f)->f32{ return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453); }
      @fragment fn fs(@location(0)uv:vec2f,@location(1)c:vec3f,@location(2)a:f32)->@location(0)vec4f{
        let d=length(uv-.5)*2.;
        let m=smoothstep(1.,.25,d);
        let g=hash(uv*311.+a*17.)*.25;
        return vec4f(c*(.7+.5*m)+vec3f(.15),m*(.35+.4*a)+g*m);}`;
    const mod=device.createShaderModule({code});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs',buffers:[{arrayStride:32,stepMode:'instance',attributes:[{shaderLocation:0,offset:0,format:'float32x4'},{shaderLocation:1,offset:16,format:'float32x4'}]}]},
      fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},
      primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const ubuf=device.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bg=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}}]});
    const proj=mat4Perspective(Math.PI/4,canvas.width/canvas.height,.1,100);
    let raf=0; const t0=performance.now();
    function frame(now){
      if(shouldStop())return;
      const t=(now-t0)/1000;
      const eye=[Math.cos(t*.12)*9,1.5+Math.sin(t*.3)*.8,Math.sin(t*.12)*9];
      const mvp=mat4Mul(proj,mat4LookAt(eye,[0,0,0],[0,1,0]));
      const fl=Math.hypot(eye[0],eye[2])||1;
      const u=new Float32Array(28);
      u.set(mvp,0);
      u.set([-eye[2]/fl,0,eye[0]/fl,0],16);
      u.set([0,1,0,0],20);
      u.set([t,0,0,0],24);
      device.queue.writeBuffer(ubuf,0,u);
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.03,g:.03,b:.07,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(pipe); pass.setBindGroup(0,bg);
      pass.setVertexBuffer(0,instBuf); pass.setIndexBuffer(ibuf2,'uint32');
      pass.drawIndexed(6,N);
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'8k alpha billboards, depth-write off, orbit camera'};
  }
};
