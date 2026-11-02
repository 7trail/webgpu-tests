export const T17 = {
  id:'reaction-diffusion', title:'17 — Compute reaction-diffusion (Gray-Scott)',
  description:'Gray-Scott chemistry on a 384² float grid in a compute shader, ping-ponged every frame and displayed fullscreen. Pure compute + memory ALU.',
  checks:'147k cells, ping-pong compute',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const S=384;
    const mkTex=()=>device.createTexture({size:[S,S],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    const texA=mkTex(), texB=mkTex();
    // init: U=1 everywhere, V=1 in center disk + satellite blobs
    const init=new Float32Array(S*S*4);
    const blob=(cx,cy,r)=>{ for(let y=0;y<S;y++)for(let x=0;x<S;x++){ const dx=x-cx,dy=y-cy; if(dx*dx+dy*dy<r*r){ const i=(y*S+x)*4; init[i+1]=1; init[i]=.5; } } };
    for(let i=0;i<S*S;i++){ init[i*4]=1; }
    blob(S/2,S/2,22); blob(S/2+40,S/2-30,10); blob(S/2-55,S/2+25,8); blob(S/2+10,S/2+60,6);
    for(const t of [texA,texB]) device.queue.writeTexture({texture:t},{data:init,bytesPerRow:S*16,rowsPerImage:S},[S,S]);
    const ubuf=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const simWgsl=`@group(0)@binding(0)var src:texture_2d<f32>;
      @group(0)@binding(1)var dst:texture_storage_2d<rgba32float,write>;
      @group(0)@binding(2)var<uniform>u:vec4f; // dt, time, stir, 0
      fn lap(t:texture_2d<f32>, p:vec2i, ch:i32)->f32{
        let c=textureLoad(t,p,0)[ch];
        let l=textureLoad(t,clamp(p+vec2i(-1,0),vec2i(0),vec2i(383)),0)[ch];
        let r=textureLoad(t,clamp(p+vec2i(1,0),vec2i(0),vec2i(383)),0)[ch];
        let u2=textureLoad(t,clamp(p+vec2i(0,-1),vec2i(0),vec2i(383)),0)[ch];
        let d=textureLoad(t,clamp(p+vec2i(0,1),vec2i(0),vec2i(383)),0)[ch];
        let tl=textureLoad(t,clamp(p+vec2i(-1,-1),vec2i(0),vec2i(383)),0)[ch];
        let tr=textureLoad(t,clamp(p+vec2i(1,-1),vec2i(0),vec2i(383)),0)[ch];
        let bl=textureLoad(t,clamp(p+vec2i(-1,1),vec2i(0),vec2i(383)),0)[ch];
        let br=textureLoad(t,clamp(p+vec2i(1,1),vec2i(0),vec2i(383)),0)[ch];
        return (l+r+u2+d)*.2+(tl+tr+bl+br)*.05-c; }
      @compute @workgroup_size(16,16) fn cs(@builtin(global_invocation_id)id:vec3u){
        if(id.x>=384u || id.y>=384u){ return; }
        let p=vec2i(id.xy);
        var U=textureLoad(src,p,0).r; var V=textureLoad(src,p,0).g;
        // periodic stir: re-seed an orbiting blob
        if(u.z>.5){
          let c=vec2f(192.)+vec2f(cos(u.y*.7),sin(u.y*.7))*90.;
          if(length(vec2f(p)-c)<24.){ U=.25; V=.9; }
        }
        let F=.0545; let k=.062;
        let lu=lap(src,p,0); let lv=lap(src,p,1);
        let uvv=U*V*V;
        U+=(0.16*lu-uvv+F*(1.-U))*u.x;
        V+=(0.08*lv+uvv-(F+k)*V)*u.x;
        textureStore(dst,p,vec4f(clamp(U,0.,1.),clamp(V,0.,1.),0.,1.));}`;
    const dispCode=`@group(0)@binding(0)var st:texture_2d<f32>; @group(0)@binding(1)var ssmp:sampler;
      @group(0)@binding(2)var<uniform>u:vec4f;
      struct P{@builtin(position)p:vec4f,@location(0)uv:vec2f};
      @vertex fn vs(@builtin(vertex_index)vi:u32)->P{ var o:P;
        o.p=vec4f(f32(vi%2)*2.-1.,-(f32(vi/2)*2.-1.),0.,1.); o.uv=vec2f(f32(vi%2),f32(vi/2)); return o;}
      @fragment fn fs(@location(0)uv:vec2f)->@location(0)vec4f{
        let v=textureSample(st,ssmp,uv).g;
        var col=mix(vec3f(.01,.02,.08),vec3f(.05,.4,.9),smoothstep(0.,.35,v));
        col=mix(col,vec3f(.2,1.,.7),smoothstep(.3,.6,v));
        col=mix(col,vec3f(1.,.95,.6),smoothstep(.55,.9,v));
        col*=.9+.1*sin(u.x*2.+uv.y*30.);
        return vec4f(col,1.);}`;
    const simM=device.createShaderModule({code:simWgsl});
    const dispM=device.createShaderModule({code:dispCode});
    const simPipe=device.createComputePipeline({layout:'auto',compute:{module:simM,entryPoint:'cs'}});
    const dispPipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:dispM,entryPoint:'vs'},fragment:{module:dispM,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-strip'}});
    const sampler=device.createSampler({magFilter:'nearest',minFilter:'nearest'});
    const mkBG=(src,dst)=>device.createBindGroup({layout:simPipe.getBindGroupLayout(0),entries:[
      {binding:0,resource:src.createView()},{binding:1,resource:dst.createView()},{binding:2,resource:{buffer:ubuf}}]});
    const bgAB=mkBG(texA,texB), bgBA=mkBG(texB,texA);
    const mkDisp=(t)=>device.createBindGroup({layout:dispPipe.getBindGroupLayout(0),entries:[
      {binding:0,resource:t.createView()},{binding:1,resource:sampler},{binding:2,resource:{buffer:ubuf}}]});
    const dAB=mkDisp(texB), dBA=mkDisp(texA);
    let raf=0, flip=false; const t0=performance.now(); let last=performance.now();
    function frame(now){
      if(shouldStop())return;
      const dt=Math.min(.05,(now-last)/1000); last=now; const t=(now-t0)/1000;
      const stir=(t%7)<.12?1:0;
      device.queue.writeBuffer(ubuf,0,new Float32Array([1,t,stir,0]));
      const enc=device.createCommandEncoder();
      const cp=enc.beginComputePass(); cp.setPipeline(simPipe);
      cp.setBindGroup(0,flip?bgBA:bgAB); cp.dispatchWorkgroups(S/16,S/16); cp.end();
      const rp=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
      rp.setPipeline(dispPipe); rp.setBindGroup(0,flip?dBA:dAB); rp.draw(4); rp.end();
      device.queue.submit([enc.finish()]);
      flip=!flip;
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'Gray-Scott 384² f32 grid, 9-tap laplacian, ping-pong'};
  }
};
