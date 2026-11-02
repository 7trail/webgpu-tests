import { cubeGeometry, makeBuffer, proceduralTexture, mat4Perspective, mat4LookAt, mat4Mul, mat4RotY, mat4Trans, mat4Scale } from '../utils.js';
export const T3 = {
  id:'textured-many', title:'3 — Many objects + many textures',
  description:'~60 instanced cubes/planes across 8 procedural textures (checker, bricks, dots, stripes…). Tests bind groups + sampling.',
  checks:'60 instances, 8 textures',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const geo=cubeGeometry();
    const vbuf=makeBuffer(device,geo.data,GPUBufferUsage.VERTEX);
    const ibuf=makeBuffer(device,geo.index,GPUBufferUsage.INDEX);
    const kinds=['checker','stripes','gradient','dots','noise','bricks','grid','plasma'];
    const texs=kinds.map(k=>proceduralTexture(device,k));
    const sampler=device.createSampler({magFilter:'linear',minFilter:'linear',mipmapFilter:'linear'});
    const wgsl=`struct U{mvp:mat4x4f}; @group(0)@binding(0)var<uniform>u:U;
      @group(0)@binding(1)var smp:sampler; @group(0)@binding(2)var tex:texture_2d<f32>;
      struct V{@builtin(position)p:vec4f,@location(0)uv:vec2f,@location(1)c:vec3f,@location(2)tx:u32};
      @vertex fn vs(@location(0)pos:vec3f,@location(1)n:vec3f,@location(2)uv:vec2f,@location(3)col:vec3f,@location(4)imvp:mat4x4f,@location(8)itx:u32)->V{
        var o:V; o.p=u.mvp*imvp*vec4f(pos,1.); o.uv=uv; o.c=col; o.tx=itx; return o;}
      @fragment fn fs(@location(0)uv:vec2f,@location(1)c:vec3f)->@location(0)vec4f{
        // per-draw texture is bound via bind group; tint by vertex color
        return textureSample(tex,smp,uv)*vec4f(mix(vec3f(1.),c,.35),1.);}`;
    // NOTE: per-instance texture would need array; instead we do one draw per texture group (8 draws x N instances)
    const wgsl2=`struct U{mvp:mat4x4f}; @group(0)@binding(0)var<uniform>u:U;
      @group(0)@binding(1)var smp:sampler; @group(0)@binding(2)var tex:texture_2d<f32>;
      struct V{@builtin(position)p:vec4f,@location(0)uv:vec2f,@location(1)c:vec3f};
      @vertex fn vs(@location(0)pos:vec3f,@location(1)n:vec3f,@location(2)uv:vec2f,@location(3)col:vec3f,@location(4)m0:vec4f,@location(5)m1:vec4f,@location(6)m2:vec4f,@location(7)m3:vec4f)->V{
        var o:V; let im=mat4x4f(m0,m1,m2,m3); o.p=u.mvp*im*vec4f(pos,1.); o.uv=uv; o.c=col; return o;}
      @fragment fn fs(@location(0)uv:vec2f,@location(1)c:vec3f)->@location(0)vec4f{
        return textureSample(tex,smp,uv)*vec4f(mix(vec3f(1.),c,.3),1.);}`;
    const mod=device.createShaderModule({code:wgsl2});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs',buffers:[
        {arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x2'},{shaderLocation:3,offset:32,format:'float32x3'}]},
        {arrayStride:64,stepMode:'instance',attributes:[{shaderLocation:4,offset:0,format:'float32x4'},{shaderLocation:5,offset:16,format:'float32x4'},{shaderLocation:6,offset:32,format:'float32x4'},{shaderLocation:7,offset:48,format:'float32x4'}]}]},
      fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const ubuf2=device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const proj=mat4Perspective(Math.PI/4,canvas.width/canvas.height,.1,100);
    const view=mat4LookAt([0,4,9],[0,-.5,0],[0,1,0]);
    const PER=8, COUNT=kinds.length*PER;
    const ibuf2=device.createBuffer({size:COUNT*64,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    const groups=[]; for(let k=0;k<kinds.length;k++){ const arr=new Float32Array(PER*16);
      for(let j=0;j<PER;j++){ const x=(j%4-1.5)*1.9+(k%2)*.3, z=Math.floor(j/4)*2.2-(k>>1)*1.1, y=Math.sin(k+j)*.4;
        let m=mat4Mul(mat4Trans(x-3.2+(k%4)*1.7,y,z-1),mat4Scale(.75)); arr.set(m,j*16); }
      groups.push(arr); }
    let raf=0;
    function frame(t){
      if(shouldStop())return;
      const vp=mat4Mul(proj,mat4Mul(view,mat4RotY(Math.sin(t/4000)*.25)));
      device.queue.writeBuffer(ubuf2,0,vp);
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.05,g:.06,b:.1,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(pipe); pass.setVertexBuffer(0,vbuf); pass.setIndexBuffer(ibuf,'uint32');
      groups.forEach((arr,k)=>{
        device.queue.writeBuffer(ibuf2,0,arr);
        pass.setVertexBuffer(1,ibuf2,0,PER*64);
        pass.setBindGroup(0,device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf2}},{binding:1,resource:sampler},{binding:2,resource:texs[k].createView()}]}));
        pass.drawIndexed(geo.count,PER);
      });
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'8 textures × 8 instances = 64 textured cubes'};
  }
};
