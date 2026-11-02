import { makeBuffer, mat4Perspective, mat4LookAt, mat4Mul } from '../utils.js';
export const T12 = {
  id:'vertex-bound', title:'12 — Vertex-bound (100k-tri displaced grid)',
  description:'~101k-triangle grid with 6-term sine displacement + analytic-ish shading in the vertex shader. Isolates vertex throughput.',
  checks:'~101k tris, 1 draw, heavy VS',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const SEG=224, SZ=14;
    const nv=(SEG+1)*(SEG+1);
    const pos=new Float32Array(nv*3), col=new Float32Array(nv*3);
    let k=0;
    for(let j=0;j<=SEG;j++)for(let i=0;i<=SEG;i++){
      const x=(i/SEG-.5)*SZ, z=(j/SEG-.5)*SZ;
      pos[k*3]=x; pos[k*3+1]=0; pos[k*3+2]=z;
      col[k*3]=i/SEG; col[k*3+1]=j/SEG; col[k*3+2]=.5+.5*Math.sin(i*.3)*Math.cos(j*.3);
      k++;
    }
    const idx=new Uint32Array(SEG*SEG*6); let q=0;
    for(let j=0;j<SEG;j++)for(let i=0;i<SEG;i++){
      const a=j*(SEG+1)+i, b=a+SEG+1;
      idx[q++]=a; idx[q++]=b; idx[q++]=a+1; idx[q++]=b; idx[q++]=b+1; idx[q++]=a+1;
    }
    const data=new Float32Array(nv*6);
    for(let i=0;i<nv;i++){ data.set([pos[i*3],pos[i*3+1],pos[i*3+2]],i*6); data.set([col[i*3],col[i*3+1],col[i*3+2]],i*6+3); }
    const vbuf=makeBuffer(device,data,GPUBufferUsage.VERTEX);
    const ibuf=makeBuffer(device,idx,GPUBufferUsage.INDEX);
    const wgsl=`
      struct U{ mvp:mat4x4f, t:vec4f }; @group(0)@binding(0)var<uniform>u:U;
      struct V{@builtin(position)p:vec4f,@location(0)c:vec3f,@location(1)h:f32};
      @vertex fn vs(@location(0)pos:vec3f,@location(1)col:vec3f)->V{
        var o:V; let t=u.t.x; var p=pos;
        // 6-term layered displacement — pure vertex ALU
        var h = sin(p.x*1.1+t*1.3)*.35 + cos(p.z*1.4-t*.9)*.3
              + sin((p.x+p.z)*2.2+t*1.7)*.18 + cos((p.x-p.z)*3.1-t*1.1)*.14
              + sin(p.x*5.3+t*2.2)*sin(p.z*4.7-t*1.9)*.12
              + sin(length(p.xz)*6.0-t*2.6)*.08;
        p.y=h;
        o.p=u.mvp*vec4f(p,1.);
        // cheap slope shade from analytic derivative terms
        let s=clamp(1.-abs(h)*.55,0.,1.);
        o.c=mix(vec3f(.1,.25,.6),mix(vec3f(.2,.7,.4),vec3f(.9,.85,.5),s),col.x*.4+col.y*.3+s*.3);
        o.h=h; return o;}
      @fragment fn fs(@location(0)c:vec3f)->@location(0)vec4f{ return vec4f(c,1.); }`;
    const mod=device.createShaderModule({code:wgsl});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]}]},
      fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const ubuf=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bg=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}}]});
    const proj=mat4Perspective(Math.PI/3,canvas.width/canvas.height,.1,100);
    const view=mat4LookAt([0,7,11],[0,0,0],[0,1,0]);
    const vp=mat4Mul(proj,view);
    let raf=0; const t0=performance.now();
    function frame(now){
      if(shouldStop())return;
      const u=new Float32Array(20); u.set(vp,0); u.set([(now-t0)/1000,0,0,0],16);
      device.queue.writeBuffer(ubuf,0,u);
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.02,g:.03,b:.06,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(pipe); pass.setBindGroup(0,bg);
      pass.setVertexBuffer(0,vbuf); pass.setIndexBuffer(ibuf,'uint32');
      pass.drawIndexed(idx.length);
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'224x224 grid (~100k tris), 6-sine vertex displacement'};
  }
};
