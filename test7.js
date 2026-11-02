import { makeBuffer } from '../utils.js';
export const T7 = {
  id:'compute-particles', title:'7 — Compute particles (20k)',
  description:'Compute shader integrates 20,480 particles with curl-ish flow; instanced quads rendered each frame. Tests storage buffers + compute.',
  checks:'20k particles update+draw',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const N=20480;
    const pdata=new Float32Array(N*4);
    for(let i=0;i<N;i++){ pdata[i*4]=(Math.random()-.5)*8; pdata[i*4+1]=(Math.random()-.5)*5; pdata[i*4+2]=(Math.random()-.5)*4; pdata[i*4+3]=Math.random(); }
    const pbuf=device.createBuffer({size:pdata.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(pbuf,0,pdata);
    const simUbuf=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const renUbuf=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const simWgsl=`struct P{ pos:vec3f, seed:f32 }; @group(0)@binding(0)var<storage,read_write> pts:array<P>;
      @group(0)@binding(1)var<uniform> u:vec4f;
      @compute @workgroup_size(256) fn cs(@builtin(global_invocation_id) id:vec3u){
        let i=id.x; if(i>=arrayLength(&pts)) { return; }
        var p=pts[i];
        let t=u.y; let s=p.seed*6.28;
        p.pos.x += sin(p.pos.y*1.4+t+s)*u.x*.9 + cos(t*.5+s)*u.x*.3;
        p.pos.y += (cos(p.pos.x*1.2-t*.8+s)*.7-.35)*u.x;
        p.pos.z += sin(t*.6+s+p.pos.x*.8)*u.x*.6;
        if(p.pos.y<-2.6){ p.pos.y=2.6; } if(p.pos.y>2.6){ p.pos.y=-2.6; }
        if(p.pos.x<-4.2){ p.pos.x=4.2; } if(p.pos.x>4.2){ p.pos.x=-4.2; }
        pts[i]=p;
      }`;
    const renWgsl=`struct U{ mvp:mat4x4f, ps:vec4f }; @group(0)@binding(0)var<uniform>u:U;
      struct P{ pos:vec3f, seed:f32 };
      @group(0)@binding(1)var<storage,read> pts:array<P>;
      struct V{@builtin(position)p:vec4f,@location(0)c:vec3f,@location(1)uv:vec2f};
      @vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->V{
        var o:V; let pt=pts[ii];
        let corners=array<vec2f,4>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(1.,1.));
        let q=corners[vi%4u];
        let size=.02+pt.seed*.035;
        let w=pt.pos+vec3f(q*size,0.);
        o.p=u.mvp*vec4f(w,1.); o.uv=q*.5+.5;
        o.c=.5+.5*cos(6.28*(pt.seed+vec3f(0.,.33,.67))+u.ps.x*.3);
        return o;}
      @fragment fn fs(@location(0)c:vec3f,@location(1)uv:vec2f)->@location(0)vec4f{
        let d=length(uv-.5)*2.; if(d>1.){discard;}
        return vec4f(c*(1.-d*.6)+vec3f(.2),1.-d*.35);}`;
    const simMod=device.createShaderModule({code:simWgsl}), renMod=device.createShaderModule({code:renWgsl});
    const simPipe=device.createComputePipeline({layout:'auto',compute:{module:simMod,entryPoint:'cs'}});
    const renPipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:renMod,entryPoint:'vs'},fragment:{module:renMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one'}}}]},
      primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const aspect=canvas.width/canvas.height;
    const mvp=new Float32Array([1/aspect,0,0,0, 0,1,0,0, 0,0,-.25,0, 0,0,.6,1]);
    const simBG=device.createBindGroup({layout:simPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:pbuf}},{binding:1,resource:{buffer:simUbuf}}]});
    const renBG=device.createBindGroup({layout:renPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renUbuf}},{binding:1,resource:{buffer:pbuf}}]});
    const quadIdx=new Uint32Array([0,1,2,2,1,3]);
    const qib=makeBuffer(device,quadIdx,GPUBufferUsage.INDEX);
    let raf=0,last=performance.now(); const t0=last;
    function frame(now){
      if(shouldStop())return;
      const dt=Math.min(.05,(now-last)/1000); last=now; const t=(now-t0)/1000;
      device.queue.writeBuffer(simUbuf,0,new Float32Array([dt,t,0,0]));
      const ru=new Float32Array(20); ru.set(mvp,0); ru.set([t,0,0,0],16);
      device.queue.writeBuffer(renUbuf,0,ru);
      const enc=device.createCommandEncoder();
      const cp=enc.beginComputePass(); cp.setPipeline(simPipe); cp.setBindGroup(0,simBG); cp.dispatchWorkgroups(Math.ceil(N/256)); cp.end();
      const rp=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.02,g:.02,b:.05,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      rp.setPipeline(renPipe); rp.setBindGroup(0,renBG); rp.setIndexBuffer(qib,'uint32');
      rp.drawIndexed(6,N); rp.end();
      device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'20,480 compute particles, additive quads, 1 compute + 1 draw'};
  }
};
