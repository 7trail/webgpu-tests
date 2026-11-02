import { sphereGeometry, cubeGeometry, torusGeometry, makeBuffer, proceduralTexture, mat4Perspective, mat4LookAt, mat4Mul, mat4RotY, mat4Trans, mat4Scale } from '../utils.js';
export const T10 = {
  id:'finale', title:'10 — Finale (everything at once)',
  description:'Textured meshes + animated plasma shaders + 3 lights + 8k compute particles + MSAA offscreen + post FX. The full workout.',
  checks:'combined: lights+compute+post',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const W=canvas.width,H=canvas.height;
    const S=sphereGeometry(16,20), C=cubeGeometry(), R=torusGeometry(.4,.16,20,14);
    const mk=(g)=>({g,v:makeBuffer(device,g.data,GPUBufferUsage.VERTEX),i:makeBuffer(device,g.index,GPUBufferUsage.INDEX)});
    const mS=mk(S),mC=mk(C),mR=mk(R);
    const texA=proceduralTexture(device,'gradient',256),texB=proceduralTexture(device,'noise',256);
    const sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
    const sceneTex=device.createTexture({size:[W,H],sampleCount:4,format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const resolveTex=device.createTexture({size:[W,H],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const depth=device.createTexture({size:[W,H],sampleCount:4,format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const sceneWgsl=`
      struct U{ vp:mat4x4f, model:mat4x4f, cam:vec4f, time:vec4f, lp0:vec4f, lp1:vec4f, lp2:vec4f, lc0:vec4f, lc1:vec4f, lc2:vec4f };
      @group(0)@binding(0)var<uniform>u:U;
      @group(0)@binding(1)var smp:sampler; @group(0)@binding(2)var tex:texture_2d<f32>; @group(0)@binding(3)var tex2:texture_2d<f32>;
      struct V{@builtin(position)p:vec4f,@location(0)n:vec3f,@location(1)uv:vec2f,@location(2)w:vec3f};
      @vertex fn vs(@location(0)pos:vec3f,@location(1)n:vec3f,@location(2)uv:vec2f,@location(3)col:vec3f)->V{
        var o:V; var p=pos + n*sin(u.time.x*2.+pos.x*4.+pos.y*3.)*.05;
        let w=(u.model*vec4f(p,1.)).xyz; o.w=w; o.p=u.vp*vec4f(w,1.);
        o.n=normalize((u.model*vec4f(n,0.)).xyz); o.uv=uv; return o;}
      fn plasma(uv:vec2f,t:f32)->vec3f{
        let a=sin(uv.x*12.+t*1.7)+sin(uv.y*15.-t*1.3); return .5+.5*cos(t*.6+vec3f(a,a*.7,a*1.3)+vec3f(0.,2.1,4.2));}
      @fragment fn fs(@location(0)n:vec3f,@location(1)uv:vec2f,@location(2)w:vec3f)->@location(0)vec4f{
        let t=u.time.x; let N=normalize(n); let V=normalize(u.cam.xyz-w);
        var base=mix(textureSample(tex,smp,uv+vec2f(sin(t)*.03,0.)).rgb, textureSample(tex2,smp,uv*2.).rgb,.3);
        var col=base*.25;
        let lights=array<vec4f,3>(u.lp0,u.lp1,u.lp2); let cols=array<vec4f,3>(u.lc0,u.lc1,u.lc2);
        for(var i=0;i<3;i++){ let L=lights[i].xyz-w; let d=length(L); L/=max(d,vec3f(1e-4));
          let att=3./(1.+.3*d+.1*d*d); let dif=max(dot(N,L),0.);
          let H=normalize(L+V); let spec=pow(max(dot(N,H),0.),36.);
          col+=base*cols[i].rgb*dif*att*.8+spec*att*.6*cols[i].rgb; }
        col=mix(col,plasma(uv,t),.25);
        col+=pow(1.-max(dot(N,V),0.),3.)*vec3f(.3,.5,.9)*.4;
        return vec4f(col,1.);}`;
    const postWgsl=`@group(0)@binding(0)var smp:sampler;@group(0)@binding(1)var tex:texture_2d<f32>;
      @group(0)@binding(2)var<uniform>pt:vec4f;
      struct P{@builtin(position)p:vec4f,@location(0)uv:vec2f};
      @vertex fn vs(@builtin(vertex_index)i:u32)->P{var o:P;
        o.p=vec4f(f32(i%2)*2.-1.,-(f32(i/2)*2.-1.),0.,1.); o.uv=vec2f(f32(i%2),f32(i/2)); return o;}
      @fragment fn fs(@location(0)uv:vec2f)->@location(0)vec4f{
        let t=pt.x; vec2f off=vec2f(.005,0.);
        var c:vec3f;
        c.r=textureSample(tex,smp,uv+off).r; c.g=textureSample(tex,smp,uv).g; c.b=textureSample(tex,smp,uv-off).b;
        let d=distance(uv,vec2f(.5)); c*=smoothstep(.9,.35,d);
        c*=.92+.08*sin(uv.y*700.+t*6.);
        return vec4f(c*1.1,1.);}`;
    const partWgsl=`struct U{ mvp:mat4x4f }; @group(0)@binding(0)var<uniform>u:U;
      struct P{ pos:vec3f, seed:f32 }; @group(0)@binding(1)var<storage,read> pts:array<P>;
      struct V{@builtin(position)p:vec4f,@location(0)a:f32};
      @vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->V{
        var o:V; let pt=pts[ii];
        let c=array<vec2f,4>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(1.,1.));
        let q=c[vi%4u]; let s=.03+pt.seed*.04;
        o.p=u.mvp*vec4f(pt.pos+vec3f(q*s,0.),1.); o.a=pt.seed; return o;}
      @fragment fn fs(@location(0)a:f32)->@location(0)vec4f{ return vec4f(mix(vec3f(1.,.6,.2),vec3f(.3,.8,1.),a),.85);}`;
    const simWgsl=`struct P{pos:vec3f,seed:f32};@group(0)@binding(0)var<storage,read_write>pts:array<P>;
      @group(0)@binding(1)var<uniform>u:vec4f;
      @compute @workgroup_size(256) fn cs(@builtin(global_invocation_id)id:vec3u){
        let i=id.x; if(i>=arrayLength(&pts)){return;} var p=pts[i]; let t=u.y; let s=p.seed*6.28;
        p.pos.x+=sin(p.pos.y*2.+t+s)*u.x; p.pos.y+=(cos(p.pos.x*1.5-t+s)*.6-.25)*u.x;
        if(p.pos.y<-2.5){p.pos.y=2.5;} if(p.pos.y>2.5){p.pos.y=-2.5;} pts[i]=p;}`;
    const sm=device.createShaderModule({code:sceneWgsl}),pm=device.createShaderModule({code:postWgsl});
    const partM=device.createShaderModule({code:partWgsl}),simM=device.createShaderModule({code:simWgsl});
    const scenePipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:sm,entryPoint:'vs',buffers:[{arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x2'},{shaderLocation:3,offset:32,format:'float32x3'}]}]},
      fragment:{module:sm,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'},multisample:{count:4}});
    const partPipe=device.createRenderPipeline({layout:'auto',vertex:{module:partM,entryPoint:'vs'},
      fragment:{module:partM,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one'}}}]},
      primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false},multisample:{count:4}});
    const postPipe=device.createRenderPipeline({layout:'auto',vertex:{module:pm,entryPoint:'vs'},fragment:{module:pm,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-strip'}});
    const simPipe=device.createComputePipeline({layout:'auto',compute:{module:simM,entryPoint:'cs'}});
    const N=8000; const pd=new Float32Array(N*4);
    for(let i=0;i<N;i++){pd[i*4]=(Math.random()-.5)*9;pd[i*4+1]=(Math.random()-.5)*5;pd[i*4+2]=(Math.random()-.5)*3;pd[i*4+3]=Math.random();}
    const pbuf=device.createBuffer({size:pd.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(pbuf,0,pd);
    const simU=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const sceneU=device.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const partU=device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const postU=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const pidx=makeBuffer(device,new Uint32Array([0,1,2,2,1,3]),GPUBufferUsage.INDEX);
    const proj=mat4Perspective(Math.PI/4,W/H,.1,100);
    let raf=0,last=performance.now(); const t0=last;
    const lcols=[[1,.35,.35,1],[.35,1,.5,1],[.4,.6,1,1]];
    const objs=[{m:mC,x:-2,y:0,z:0,s:1},{m:mS,x:0,y:.4,z:-.5,s:.9},{m:mR,x:2,y:-.2,z:0,s:1},{m:mS,x:-1,y:-1.2,z:1,s:.6},{m:mC,x:1.2,y:1.2,z:-1,s:.55},{m:mR,x:0,y:-1.4,z:-1.5,s:.8}];
    for(let gx=0;gx<6;gx++)for(let gz=0;gz<6;gz++) objs.push({m:mC,x:(gx-2.5)*1.1,y:-2,z:(gz-2.5)*1.1,s:.28});
    function frame(now){
      if(shouldStop())return;
      const dt=Math.min(.05,(now-last)/1000); last=now; const t=(now-t0)/1000;
      const eye=[Math.sin(t*.2)*5,2.4,Math.cos(t*.2)*5+3];
      const view=mat4LookAt(eye,[0,0,0],[0,1,0]);
      const vp=mat4Mul(proj,view);
      device.queue.writeBuffer(partU,0,vp);
      device.queue.writeBuffer(simU,0,new Float32Array([dt,t,0,0]));
      device.queue.writeBuffer(postU,0,new Float32Array([t,0,0,0]));
      const lp=[]; for(let i=0;i<3;i++){const a=t*(.6+i*.2)+i*2.1;lp.push([Math.cos(a)*3,1.6+Math.sin(t+i)*1.2,Math.sin(a)*3,1]);}
      const enc=device.createCommandEncoder();
      const cp=enc.beginComputePass(); cp.setPipeline(simPipe);
      cp.setBindGroup(0,device.createBindGroup({layout:simPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:pbuf}},{binding:1,resource:{buffer:simU}}]}));
      cp.dispatchWorkgroups(Math.ceil(N/256)); cp.end();
      const pass=enc.beginRenderPass({colorAttachments:[{view:sceneTex.createView(),resolveTarget:resolveTex.createView(),loadOp:'clear',clearValue:{r:.03,g:.03,b:.06,a:1},storeOp:'discard'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(scenePipe);
      objs.forEach((o,i)=>{
        const model=mat4Mul(mat4Trans(o.x,o.y+Math.sin(t+i)*.15,o.z),mat4Mul(mat4RotY(t*.5+i),mat4Scale(o.s)));
        // vp(16)+model(16)+cam(4)+time(4)+lp(12)+lc(12) = 64 floats = 256B
        const u=new Float32Array(64); u.set(vp,0); u.set(model,16); u.set([eye[0],eye[1],eye[2],1],32); u.set([t,0,0,0],36);
        lp.forEach((p,j)=>u.set(p,40+j*4)); lcols.forEach((c,j)=>u.set(c,52+j*4));
        device.queue.writeBuffer(sceneU,0,u);
        pass.setVertexBuffer(0,o.m.v); pass.setIndexBuffer(o.m.i,'uint32');
        pass.setBindGroup(0,device.createBindGroup({layout:scenePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:sceneU}},{binding:1,resource:sampler},{binding:2,resource:texA.createView()},{binding:3,resource:texB.createView()}]}));
        pass.drawIndexed(o.m.g.count);
      });
      pass.setPipeline(partPipe);
      pass.setBindGroup(0,device.createBindGroup({layout:partPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:partU}},{binding:1,resource:{buffer:pbuf}}]}));
      pass.setIndexBuffer(pidx,'uint32'); pass.drawIndexed(6,N);
      pass.end();
      const enc2=device.createCommandEncoder();
      const p2=enc2.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      p2.setPipeline(postPipe);
      p2.setBindGroup(0,device.createBindGroup({layout:postPipe.getBindGroupLayout(0),entries:[{binding:0,resource:sampler},{binding:1,resource:resolveTex.createView()},{binding:2,resource:{buffer:postU}}]}));
      p2.draw(4); p2.end();
      device.queue.submit([enc.finish(),enc2.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'finale: 42 textured+lit+plasma meshes, 8k compute particles, MSAA+post'};
  }
};
