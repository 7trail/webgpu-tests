import { sphereGeometry, cubeGeometry, makeBuffer, mat4Perspective, mat4LookAt, mat4Mul, mat4RotY, mat4Trans, mat4Scale } from '../utils.js';
export const T5 = {
  id:'lights', title:'5 — Dynamic lighting (4 moving lights)',
  description:'Blinn-Phong with 4 orbiting colored point lights over ~80 cubes+spheres. Tests normals, per-frame light uniforms.',
  checks:'4 lights animate, spec highlights',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const S=sphereGeometry(12,16), C=cubeGeometry();
    const mk=(g)=>({g,v:makeBuffer(device,g.data,GPUBufferUsage.VERTEX),i:makeBuffer(device,g.index,GPUBufferUsage.INDEX)});
    const a=mk(S), b=mk(C);
    const wgsl=`
      struct U{ vp:mat4x4f, model:mat4x4f, cam:vec4f, time:vec4f, lights:array<vec4f,4>, lcol:array<vec4f,4> };
      @group(0)@binding(0)var<uniform>u:U;
      struct V{@builtin(position)p:vec4f,@location(0)n:vec3f,@location(1)w:vec3f,@location(2)c:vec3f};
      @vertex fn vs(@location(0)pos:vec3f,@location(1)n:vec3f,@location(2)uv:vec2f,@location(3)col:vec3f)->V{
        var o:V; let w=(u.model*vec4f(pos,1.)).xyz; o.w=w; o.p=u.vp*vec4f(w,1.);
        o.n=normalize((u.model*vec4f(n,0.)).xyz); o.c=col; return o;}
      @fragment fn fs(@location(0)n:vec3f,@location(1)w:vec3f,@location(2)c:vec3f)->@location(0)vec4f{
        let N=normalize(n); let V=normalize(u.cam.xyz-w);
        var col=vec3f(.04,.045,.07)*c;
        for(var i=0;i<4;i++){
          let L=u.lights[i].xyz-w; let d=length(L); let l=L/max(d,1e-4);
          let att=3.5/(1.+.35*d+.12*d*d);
          let dif=max(dot(N,l),0.)*u.lcol[i].rgb*att;
          let H=normalize(l+V); let spec=pow(max(dot(N,H),0.),42.)*att*.9;
          col+=(c*dif*.9+spec*u.lcol[i].rgb);
        }
        col+=pow(1.-max(dot(N,V),0.),3.)*vec3f(.25,.4,.7)*.5;
        return vec4f(col,1.);}`;
    const mod=device.createShaderModule({code:wgsl});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs',buffers:[{arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x2'},{shaderLocation:3,offset:32,format:'float32x3'}]}]},
      fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    // vp(64)+model(64)+cam(16)+time(16)+lights(64)+lcol(64) = 288 bytes
    const ubuf=device.createBuffer({size:288,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bg=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}}]});
    const proj=mat4Perspective(Math.PI/4,canvas.width/canvas.height,.1,100);
    const view=mat4LookAt([0,4.4,9],[0,-.4,0],[0,1,0]);
    const lcols=[[1,.3,.3,1],[.3,1,.4,1],[.35,.6,1,1],[1,.85,.35,1]];
    let raf=0; const t0=performance.now();
    function frame(now){
      if(shouldStop())return;
      const t=(now-t0)/1000;
      const vp=mat4Mul(proj,mat4Mul(view,mat4RotY(Math.sin(t*.2)*.3)));
      const lp=[]; for(let i=0;i<4;i++){ const a2=t*(.5+i*.17)+i*1.7; lp.push([Math.cos(a2)*(2.5+i*.5),1.5+Math.sin(t*.9+i)*1.1,Math.sin(a2)*(2.5+i*.5),1]); }
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.02,g:.02,b:.04,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(pipe); pass.setBindGroup(0,bg);
      for(let gx=0;gx<8;gx++)for(let gz=0;gz<10;gz++){
        const x=(gx-3.5)*1.35, z=(gz-4.5)*1.25, y=Math.sin(t*1.2+gx+gz*.7)*.25;
        const sph=(gx+gz)%3===0;
        const m=mat4Mul(mat4Trans(x,y,z),mat4Mul(mat4RotY(t*.6+gx+gz),mat4Scale(sph?.5:.62)));
        const u=new Float32Array(72); u.set(vp,0); u.set(m,16); u.set([0,4.4,9,1],32); u.set([t,0,0,0],36);
        for(let i=0;i<4;i++){ u.set(lp[i],40+i*4); u.set(lcols[i],56+i*4); }
        device.queue.writeBuffer(ubuf,0,u);
        const M=sph?a:b;
        pass.setVertexBuffer(0,M.v); pass.setIndexBuffer(M.i,'uint32');
        pass.drawIndexed(M.g.count);
      }
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'80 lit objects, 4 orbiting point lights, Blinn-Phong+rim'};
  }
};
