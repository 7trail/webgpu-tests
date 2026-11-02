import { cubeGeometry, makeBuffer, mat4Perspective, mat4LookAt, mat4Mul, mat4RotX, mat4RotY } from '../utils.js';
export const T1 = {
  id:'hello-cube', title:'1 — Does it run? (single cube)',
  description:'One rotating cube, vertex colors, depth test. Validates adapter, pipeline, uniforms.',
  checks:'cube visible, >5fps',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu');
    ctx.configure({device,format,alphaMode:'opaque'});
    const geo=cubeGeometry();
    const vbuf=makeBuffer(device,geo.data,GPUBufferUsage.VERTEX);
    const ibuf=makeBuffer(device,geo.index,GPUBufferUsage.INDEX);
    const ubuf=device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const wgsl=`
      struct U { mvp: mat4x4f }; @group(0) @binding(0) var<uniform> u: U;
      struct V { @builtin(position) p: vec4f, @location(0) c: vec3f };
      @vertex fn vs(@location(0) pos: vec3f, @location(3) col: vec3f) -> V {
        var o: V; o.p = u.mvp * vec4f(pos,1.0); o.c = col; return o; }
      @fragment fn fs(@location(0) c: vec3f) -> @location(0) vec4f { return vec4f(c,1.0); }`;
    const mod=device.createShaderModule({code:wgsl});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs',buffers:[{arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:3,offset:32,format:'float32x3'}]}]},
      fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    let raf=0; const proj=mat4Perspective(Math.PI/4,canvas.width/canvas.height,0.1,100);
    const view=mat4LookAt([1.6,1.2,2.4],[0,0,0],[0,1,0]);
    function frame(t){
      if(shouldStop())return;
      const m=mat4Mul(proj,mat4Mul(view,mat4Mul(mat4RotY(t/900),mat4RotX(t/1400))));
      device.queue.writeBuffer(ubuf,0,m);
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.05,g:.07,b:.12,a:1},storeOp:'store'}],
        depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(pipe); pass.setVertexBuffer(0,vbuf); pass.setIndexBuffer(ibuf,'uint32');
      pass.setBindGroup(0,device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}}]}));
      pass.drawIndexed(geo.count); pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'single cube, 12 tris, 1 draw'};
  }
};
