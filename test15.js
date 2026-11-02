import { cubeGeometry, makeBuffer, mat4Perspective, mat4LookAt, mat4Mul, mat4Trans, mat4Scale, mat4RotY } from '../utils.js';
export const T15 = {
  id:'shadow-map', title:'15 — Shadow mapping (depth pre-pass + PCF)',
  description:'150 boxes rendered from the light into a depth target, then a 3x3 PCF shadow lookup in the main pass. Orbiting light, moving shadows.',
  checks:'2 passes, PCF shadows',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const geo=cubeGeometry();
    const vbuf=makeBuffer(device,geo.data,GPUBufferUsage.VERTEX), ibuf=makeBuffer(device,geo.index,GPUBufferUsage.INDEX);
    const SH=1024;
    const shadowTex=device.createTexture({size:[SH,SH],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const shadowDepth=device.createTexture({size:[SH,SH],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
    const depthWgsl=`struct U{ mvp:mat4x4f, info:vec4f }; @group(0)@binding(0)var<uniform>u:U;
      struct V{@builtin(position)p:vec4f,@location(0)d:f32};
      @vertex fn vs(@location(0)pos:vec3f)->V{ var o:V;
        let w=(u.mvp*vec4f(pos,1.)); o.p=w; o.d=w.z/w.w; return o;}
      @fragment fn fs(@location(0)d:f32)->@location(0)vec4f{ return vec4f(d,d,d,1.); }`;
    const sceneWgsl=`
      struct U{ vp:mat4x4f, model:mat4x4f, lvp:mat4x4f, lp:vec4f, time:vec4f };
      @group(0)@binding(0)var<uniform>u:U;
      @group(0)@binding(1)var smp:sampler; @group(0)@binding(2)var sh:texture_2d<f32>;
      struct V{@builtin(position)p:vec4f,@location(0)n:vec3f,@location(1)w:vec3f,@location(2)lp:vec4f};
      @vertex fn vs(@location(0)pos:vec3f,@location(1)n:vec3f,@location(2)uv:vec2f,@location(3)col:vec3f)->V{
        var o:V; let w=(u.model*vec4f(pos,1.)).xyz; o.w=w; o.p=u.vp*vec4f(w,1.);
        o.n=normalize((u.model*vec4f(n,0.)).xyz); o.lp=u.lvp*vec4f(w,1.); return o;}
      @fragment fn fs(@location(0)n:vec3f,@location(1)w:vec3f,@location(2)lpp:vec4f)->@location(0)vec4f{
        let N=normalize(n);
        let sc=lpp.xyz/lpp.w; let suv=sc.xy*.5+.5;
        var sh0=1.;
        if(suv.x>0.002 && suv.x<0.998 && suv.y>0.002 && suv.y<0.998){
          let cur=sc.z; var s=0.;
          for(var y=-1;y<=1;y++){ for(var x=-1;x<=1;x++){
            let dd=textureSample(sh,smp,suv+vec2f(f32(x),f32(y))/1024.).r;
            s+=select(0.,1.,cur-dd<0.0015);
          }}
          sh0=mix(.25,1.,s/9.);
        }
        let L=u.lp.xyz-w; let d=length(L); L/=max(d,vec3f(1e-4));
        let att=4./(1.+.25*d+.06*d*d);
        let dif=max(dot(N,L),0.)*att*sh0;
        let V=normalize(vec3f(0.,5.,8.)-w);
        let H=normalize(L+V); let spec=pow(max(dot(N,H),0.),32.)*att*sh0*.7;
        var col=vec3f(.35,.4,.5)*(.12+dif*.85)+spec;
        return vec4f(col,1.);}`;
    const dm=device.createShaderModule({code:depthWgsl}), sm=device.createShaderModule({code:sceneWgsl});
    const depthPipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:dm,entryPoint:'vs',buffers:[{arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}]},
      fragment:{module:dm,entryPoint:'fs',targets:[{format:'rgba16float'}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const scenePipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:sm,entryPoint:'vs',buffers:[{arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x2'},{shaderLocation:3,offset:32,format:'float32x3'}]}]},
      fragment:{module:sm,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const dubuf=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const dbg=device.createBindGroup({layout:depthPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:dubuf}}]});
    // vp(64)+model(64)+lvp(64)+lp(16)+time(16) = 224
    const subuf=device.createBuffer({size:224,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const sbg=device.createBindGroup({layout:scenePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:subuf}},{binding:1,resource:sampler},{binding:2,resource:shadowTex.createView()}]});
    const boxes=[]; for(let i=0;i<150;i++){ boxes.push({x:(Math.random()-.5)*16,y:Math.random()*2.2,z:(Math.random()-.5)*16,s:.3+Math.random()*.9,r:Math.random()*6.28}); }
    const ground=mat4Mul(mat4Trans(0,-.6,0),mat4Scale(12));
    const proj=mat4Perspective(Math.PI/4,canvas.width/canvas.height,.1,100);
    const view=mat4LookAt([0,5,9],[0,0,0],[0,1,0]);
    const vp=mat4Mul(proj,view);
    const lproj=mat4Perspective(Math.PI/2.4,1,.5,40);
    let raf=0; const t0=performance.now();
    function frame(now){
      if(shouldStop())return;
      const t=(now-t0)/1000;
      const la=t*.5, lp=[Math.cos(la)*8,6+Math.sin(t*.7)*1.5,Math.sin(la)*8];
      const lvp=mat4Mul(lproj,mat4LookAt(lp,[0,0,0],[0,1,0]));
      // pass 1: shadow depth
      let enc=device.createCommandEncoder();
      let pass=enc.beginRenderPass({colorAttachments:[{view:shadowTex.createView(),loadOp:'clear',clearValue:{r:1,g:1,b:1,a:1},storeOp:'store'}],depthStencilAttachment:{view:shadowDepth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(depthPipe); pass.setBindGroup(0,dbg);
      const cast=(m)=>{
        const u=new Float32Array(20); u.set(mat4Mul(lvp,m),0); u.set([0,0,0,0],16);
        device.queue.writeBuffer(dubuf,0,u);
        pass.setVertexBuffer(0,vbuf); pass.setIndexBuffer(ibuf,'uint32');
        pass.drawIndexed(geo.count);
      };
      boxes.forEach((b)=>cast(mat4Mul(mat4Trans(b.x,b.y,b.z),mat4Mul(mat4RotY(b.r),mat4Scale(b.s)))));
      cast(ground);
      pass.end(); device.queue.submit([enc.finish()]);
      // pass 2: main
      enc=device.createCommandEncoder();
      pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.05,g:.06,b:.1,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(scenePipe); pass.setBindGroup(0,sbg);
      const drawM=(m)=>{
        const u=new Float32Array(56); u.set(vp,0); u.set(m,16); u.set(lvp,32);
        u.set([lp[0],lp[1],lp[2],1],48); u.set([t,0,0,0],52);
        device.queue.writeBuffer(subuf,0,u);
        pass.setVertexBuffer(0,vbuf); pass.setIndexBuffer(ibuf,'uint32');
        pass.drawIndexed(geo.count);
      };
      boxes.forEach((b)=>drawM(mat4Mul(mat4Trans(b.x,b.y,b.z),mat4Mul(mat4RotY(b.r+t*.1),mat4Scale(b.s)))));
      drawM(ground);
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'151 casters, 1024px shadow map, 3x3 PCF'};
  }
};
