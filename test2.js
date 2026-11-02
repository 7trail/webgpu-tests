import { cubeGeometry, sphereGeometry, torusGeometry, quadGeometry, makeBuffer, mat4Perspective, mat4LookAt, mat4Mul, mat4RotX, mat4RotY, mat4Trans } from '../utils.js';
export const T2 = {
  id:'multi-mesh', title:'2 — Several objects (simple + complex)',
  description:'8 meshes: cubes, spheres, torus, pyramid-quads. Per-object uniforms, shared pipeline, depth.',
  checks:'8 draws, depth correct',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const geos=[cubeGeometry(),sphereGeometry(14,18),torusGeometry(),quadGeometry(),cubeGeometry(),sphereGeometry(8,10),torusGeometry(.3,.08,14,10),quadGeometry()];
    const vbufs=geos.map(g=>makeBuffer(device,g.data,GPUBufferUsage.VERTEX));
    const ibufs=geos.map(g=>makeBuffer(device,g.index,GPUBufferUsage.INDEX));
    const wgsl=`struct U{mvp:mat4x4f, tint:vec4f}; @group(0)@binding(0)var<uniform>u:U;
      struct V{@builtin(position)p:vec4f,@location(0)c:vec3f};
      @vertex fn vs(@location(0)pos:vec3f,@location(3)col:vec3f)->V{var o:V;o.p=u.mvp*vec4f(pos,1.);o.c=col*u.tint.rgb;return o;}
      @fragment fn fs(@location(0)c:vec3f)->@location(0)vec4f{return vec4f(c,1.);}`;
    const mod=device.createShaderModule({code:wgsl});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs',buffers:[{arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:3,offset:32,format:'float32x3'}]}]},
      fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const ubufs=geos.map(()=>device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
    const proj=mat4Perspective(Math.PI/4,canvas.width/canvas.height,.1,100);
    const view=mat4LookAt([0,2.2,6],[0,0,0],[0,1,0]);
    const slots=[[-2.6,0,-.5],[-1.3,.3,0],[0,0,-.6],[1.3,.2,0],[2.6,0,-.5],[-1.4,-1.4,.6],[0,-1.4,.8],[1.4,-1.4,.6]];
    const tints=[[1,1,1,1],[1,.7,.7,1],[.7,1,.7,1],[.8,.8,1,1],[1,1,.6,1],[1,.6,1,1],[.6,1,1,1],[1,1,1,1]];
    let raf=0;
    function frame(t){
      if(shouldStop())return;
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.04,g:.05,b:.09,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(pipe);
      geos.forEach((g,i)=>{
        const s=slots[i]; const spin=t/1000*(i%2?1:-1)+i;
        const m=mat4Mul(proj,mat4Mul(view,mat4Mul(mat4Trans(s[0],s[1],s[2]),mat4Mul(mat4RotY(spin),mat4RotX(spin*.7)))));
        const u=new Float32Array(20); u.set(m,0); u.set(tints[i],16);
        device.queue.writeBuffer(ubufs[i],0,u);
        pass.setVertexBuffer(0,vbufs[i]); pass.setIndexBuffer(ibufs[i],'uint32');
        pass.setBindGroup(0,device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubufs[i]}}]}));
        pass.drawIndexed(g.count);
      });
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'8 draws, ~3k tris, per-object tint'};
  }
};
