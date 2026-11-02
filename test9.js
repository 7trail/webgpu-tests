import { sphereGeometry, makeBuffer, mat4Perspective, mat4LookAt, mat4Mul, mat4RotY, mat4Trans, mat4Scale } from '../utils.js';
export const T9 = {
  id:'stress', title:'9 — Stress (25k heavy-shader instances)',
  description:'25,000 spheres with 5-octave fbm fragment shader + per-instance rotation. Expect GPU to work hard; FPS is the metric.',
  checks:'25k × 5-octave fbm frag',
  async run(canvas, device, { onFrame, shouldStop }){
    const format=navigator.gpu.getPreferredCanvasFormat();
    const ctx=canvas.getContext('webgpu'); ctx.configure({device,format});
    const geo=sphereGeometry(6,8); // low-poly to keep vertex load sane, fragment does the work
    const vbuf=makeBuffer(device,geo.data,GPUBufferUsage.VERTEX), ibuf=makeBuffer(device,geo.index,GPUBufferUsage.INDEX);
    const N=25000;
    const imat=new Float32Array(N*16);
    for(let i=0;i<N;i++){
      const x=(Math.random()-.5)*46, y=(Math.random()-.5)*22, z=(Math.random()-.5)*46;
      const s=.18+Math.random()*.5;
      imat.set([s,0,0,0, 0,s,0,0, 0,0,s,0, x,y,z],i*16);
    }
    const imBuf=device.createBuffer({size:imat.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(imBuf,0,imat);
    const wgsl=`struct U{vp:mat4x4f, time:vec4f};@group(0)@binding(0)var<uniform>u:U;
      struct V{@builtin(position)p:vec4f,@location(0)uv:vec2f,@location(1)sd:f32};
      @vertex fn vs(@location(0)pos:vec3f,@location(1)n:vec3f,@location(2)uv:vec2f,@location(3)col:vec3f,
        @location(4)m0:vec4f,@location(5)m1:vec4f,@location(6)m2:vec4f,@location(7)m3:vec4f)->V{
        var o:V; let m=mat4x4f(m0,m1,m2,m3);
        // cheap per-instance spin via time + translation hash
        let a=u.time.x*.5+m3.x+m3.y;
        let c=cos(a*.3),s=sin(a*.3);
        let rp=vec3f(c*pos.x-s*pos.z,pos.y,s*pos.x+c*pos.z);
        o.p=u.vp*m*vec4f(rp,1.); o.uv=uv; o.sd=fract(m3.x*.7+m3.y*.3); return o;}
      fn hash(p:vec2f)->f32{return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);}
      fn noise(p:vec2f)->f32{let i=floor(p),f=fract(p);let x=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2f(1,0)),x.x),mix(hash(i+vec2f(0,1)),hash(i+vec2f(1,1)),x.x),x.y);}
      fn fbm(p:vec2f)->f32{var v=0.;var a=.5;for(var i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=.5;}return v;}
      @fragment fn fs(@location(0)uv:vec2f,@location(1)sd:f32)->@location(0)vec4f{
        let t=u.time.x;
        let p=uv*7.+vec2f(t*.25+sd*9.,-t*.2);
        let f=fbm(p+fbm(p+t*.1)*1.6);
        let g=fbm(p*1.7-f*2.+t*.05);
        var col=.5+.5*cos(6.28*(f*.9+g*.6+sd+vec3f(0.,.33,.67))+t*.4);
        col*= .55+.75*g;
        // marble veins
        col+= smoothstep(.48,.5,abs(fract((uv.x+uv.y)*6.+f*4.)-.5))*.15;
        // specular-ish pop
        col+=pow(g,6.)*1.2;
        return vec4f(col,1.);}`;
    const mod=device.createShaderModule({code:wgsl});
    const pipe=device.createRenderPipeline({layout:'auto',
      vertex:{module:mod,entryPoint:'vs',buffers:[
        {arrayStride:44,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x2'},{shaderLocation:3,offset:32,format:'float32x3'}]},
        {arrayStride:64,stepMode:'instance',attributes:[{shaderLocation:4,offset:0,format:'float32x4'},{shaderLocation:5,offset:16,format:'float32x4'},{shaderLocation:6,offset:32,format:'float32x4'},{shaderLocation:7,offset:48,format:'float32x4'}]}]},
      fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
      primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const ubuf=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bg=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}}]});
    const proj=mat4Perspective(Math.PI/3,canvas.width/canvas.height,.1,200);
    let raf=0; const t0=performance.now();
    function frame(now){
      if(shouldStop())return;
      const t=(now-t0)/1000;
      const view=mat4LookAt([Math.cos(t*.1)*30,12,Math.sin(t*.1)*30],[0,0,0],[0,1,0]);
      const u=new Float32Array(20); u.set(mat4Mul(proj,view),0); u.set([t,0,0,0],16);
      device.queue.writeBuffer(ubuf,0,u);
      const enc=device.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:.02,g:.02,b:.03,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(pipe); pass.setBindGroup(0,bg);
      pass.setVertexBuffer(0,vbuf); pass.setVertexBuffer(1,imBuf); pass.setIndexBuffer(ibuf,'uint32');
      pass.drawIndexed(geo.count,N);
      pass.end(); device.queue.submit([enc.finish()]);
      onFrame(); raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {cleanup:()=>cancelAnimationFrame(raf),pass:true,notes:'25k instances, 5-octave fbm + veins + spec per pixel'};
  }
};
