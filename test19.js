import { cubeGeometry, sphereGeometry, torusGeometry, makeBuffer, mat4Perspective, mat4LookAt, mat4Mul, mat4Trans, mat4Scale, mat4RotY } from '../utils.js';
export const T19 = {
  id:'draw-call-overhead', title:'19 — Draw-call overhead (1,200 draws)',
  description:'1,200 tiny meshes drawn with 1,200 separate bind groups in one pass. Shaders are trivial — this taxes command encoding + driver per-draw cost.',
  checks:'1200 draws, trivial shaders',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const geos=[cubeGeometry(),sphereGeometry(6,8),torusGeometry(.32,.12,10,8)];
    const meshes=geos.map(g=>({g,v:makeBuffer(device,g.data,GPUBufferUsage.VERTEX),i:makeBuffer(device,g.index,GPUBufferUsage.INDEX)}));
    const wgsl=`struct U{ mvp:mat4x4f, c:vec4f }; @group(0)@binding(0)var<uniform>u:U;
      @vertex fn vs(@location(0)pos:vec3f)->@builtin(position)vec4f{ return u.mvp*vec4f(pos,1.); }
      @fragment fn fs()->@location(0)vec4f{ return u.c; }`;
    const mod=device.createShaderModule({code:wgsl});
    // NOTE: fragment reads uniform u — needs same bind group; layout auto covers both stages.
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs',buffers:[{arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}]},
      fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const DRAWS=1200;
    const ubufs=[], bgs=[], place=[];
    for(let i=0;i<DRAWS;i++){
      ubufs.push(device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
      place.push({m:i%3,x:(Math.random()-.5)*24,y:(Math.random()-.5)*10,z:(Math.random()-.5)*16,s:.25+Math.random()*.6,sp:.5+Math.random()*2,ph:Math.random()*6.28});
    }
    // bind groups need pipeline layout: create after pipe
    const layout=pipe.getBindGroupLayout(0);
    for(let i=0;i<DRAWS;i++) bgs.push(device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:ubufs[i]}}]}));
    const proj=mat4Perspective(Math.PI/4,canvas.width/canvas.height,.1,100);
    const view=mat4LookAt([0,3,20],[0,0,0],[0,1,0]);
    const vp=mat4Mul(proj,view);
    const cols=[[1,.4,.4,1],[.4,1,.5,1],[.45,.6,1,1],[1,.85,.35,1]];
    let raf=0; const t0=performance.now();
    const u=new Float32Array(20);
    function frame(now){
      if(shouldStop())return;
      const t=(now-t0)/1000;
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.03,g:.03,b:.06,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(pipe);
      for(let i=0;i<DRAWS;i++){
        const p=place[i];
        const m=mat4Mul(vp,mat4Mul(mat4Trans(p.x,p.y+Math.sin(t*p.sp+p.ph)*.5,p.z),mat4Mul(mat4RotY(t*p.sp+p.ph),mat4Scale(p.s))));
        u.set(m,0); u.set(cols[i%4],16);
        device.queue.writeBuffer(ubufs[i],0,u);
        const M=meshes[p.m];
        pass.setVertexBuffer(0,M.v); pass.setIndexBuffer(M.i,'uint32');
        pass.setBindGroup(0,bgs[i]);
        pass.drawIndexed(M.g.count);
      }
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'1200 draws x own bind group, trivial VS/FS'};
  }
};
