// Shared WebGPU helpers: math, geometry, textures.
export function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
}
export function mat4LookAt(eye, at, up) {
  const z = norm3([eye[0]-at[0], eye[1]-at[1], eye[2]-at[2]]);
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
    -(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]),
    -(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]),
    -(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]), 1]);
}
export function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c*4+r] = a[c*4+0]*b[0*4+r]+a[c*4+1]*b[1*4+r]+a[c*4+2]*b[2*4+r]+a[c*4+3]*b[3*4+r];
  }
  return o;
}
export function mat4RotY(t) { const c=Math.cos(t),s=Math.sin(t); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); }
export function mat4RotX(t) { const c=Math.cos(t),s=Math.sin(t); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); }
export function mat4Trans(x,y,z) { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]); }
export function mat4Scale(s) { return new Float32Array([s,0,0,0, 0,s,0,0, 0,0,s,0, 0,0,0,1]); }
function cross3(a,b){return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];}
function norm3(v){const l=Math.hypot(...v)||1;return [v[0]/l,v[1]/l,v[2]/l];}

export function cubeGeometry() {
  // pos(3), normal(3), uv(2), color(3)
  const P = [
    // +x -x +y -y +z -z with normals/uvs/colors
    {n:[1,0,0],v:[[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]]},
    {n:[-1,0,0],v:[[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]]},
    {n:[0,1,0],v:[[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]]},
    {n:[0,-1,0],v:[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]]},
    {n:[0,0,1],v:[[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]},
    {n:[0,0,-1],v:[[5*-.1,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5],[.5,-.5,-.5]]},
  ];
  const pos=[],nor=[],uv=[],col=[],idx=[];
  const faceCols=[[1,.35,.35],[.35,1,.4],[.4,.6,1],[1,1,.4],[1,.5,1],[.4,1,1]];
  P.forEach((f,fi)=>{ const base=pos.length/3;
    f.v.forEach((v,i)=>{ pos.push(v[0],v[1],v[2]); nor.push(...f.n); uv.push(i===0?[0,1]:i===1?[1,1]:i===2?[1,0]:[0,0]); col.push(...faceCols[fi]); });
    idx.push(base,base+1,base+2, base,base+2,base+3);
  });
  return pack(pos,nor,uv,col,idx);
}
export function quadGeometry() {
  return pack([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0],[0,0,1, 0,0,1, 0,0,1, 0,0,1],[0,1, 1,1, 1,0, 0,0],[1,1,1, 1,1,1, 1,1,1, 1,1,1],[0,1,2, 0,2,3]);
}
export function sphereGeometry(lat=18, lon=24) {
  const pos=[],nor=[],uv=[],col=[],idx=[];
  for(let i=0;i<=lat;i++){ const th=i/lat*Math.PI, y=Math.cos(th), r=Math.sin(th);
    for(let j=0;j<=lon;j++){ const ph=j/lon*Math.PI*2, x=r*Math.cos(ph), z=r*Math.sin(ph);
      pos.push(x*.5,y*.5,z*.5); nor.push(x,y,z); uv.push(j/lon,i/lat);
      col.push(.5+.5*x,.5+.5*y,.5+.5*z);
    }}
  for(let i=0;i<lat;i++) for(let j=0;j<lon;j++){ const a=i*(lon+1)+j,b=a+lon+1; idx.push(a,b,a+1,b,b+1,a+1); }
  return pack(pos,nor,uv,col,idx);
}
export function torusGeometry(R=.35,r=.15,n1=22,n2=16) {
  const pos=[],nor=[],uv=[],col=[],idx=[];
  for(let i=0;i<=n1;i++){ const u=i/n1*Math.PI*2, cu=Math.cos(u), su=Math.sin(u);
    for(let j=0;j<=n2;j++){ const v=j/n2*Math.PI*2, cv=Math.cos(v), sv=Math.sin(v);
      const x=(R+r*cv)*cu, y=r*sv, z=(R+r*cv)*su;
      pos.push(x,y,z); nor.push(cv*cu,sv,cv*su); uv.push(i/n1,j/n2);
      col.push(.5+.5*cu,.5+.5*sv,.7);
    }}
  for(let i=0;i<n1;i++) for(let j=0;j<n2;j++){ const a=i*(n2+1)+j,b=a+n2+1; idx.push(a,b,a+1,b,b+1,a+1); }
  return pack(pos,nor,uv,col,idx);
}
function pack(pos,nor,uv,col,idx){
  const n=pos.length/3, stride=11, data=new Float32Array(n*stride);
  for(let i=0;i<n;i++){ data.set([pos[i*3],pos[i*3+1],pos[i*3+2],nor[i*3],nor[i*3+1],nor[i*3+2],uv[i*2],uv[i*2+1],col[i*3],col[i*3+1],col[i*3+2]],i*stride); }
  return { data, index:new Uint32Array(idx), count:idx.length, stride };
}
export function makeBuffer(device, data, usage) {
  const b=device.createBuffer({size:((data.byteLength+3)>>2)*4, usage, mappedAtCreation:true});
  const m=b.getMappedRange();
  if(data instanceof Float32Array) new Float32Array(m).set(data);
  else new Uint32Array(m).set(data);
  b.unmap(); return b;
}
// Procedural RGBA textures drawn on 2D canvas — no external assets.
export function proceduralTexture(device, kind, size=128) {
  const c=document.createElement('canvas'); c.width=c.height=size;
  const g=c.getContext('2d');
  if(kind==='checker'){ const n=8,s=size/n; for(let y=0;y<n;y++)for(let x=0;x<n;x++){g.fillStyle=(x+y)%2?'#111':'#eee';g.fillRect(x*s,y*s,s,s);} g.fillStyle='red'; g.fillRect(0,0,s,s); }
  else if(kind==='stripes'){ for(let x=0;x<size;x+=8){g.fillStyle=(x/8)%2?'#224':'#fc3';g.fillRect(x,0,8,size);} }
  else if(kind==='gradient'){ const gr=g.createLinearGradient(0,0,size,size); gr.addColorStop(0,'#f0f');gr.addColorStop(.5,'#0ff');gr.addColorStop(1,'#ff0'); g.fillStyle=gr; g.fillRect(0,0,size,size); }
  else if(kind==='dots'){ g.fillStyle='#123';g.fillRect(0,0,size,size); g.fillStyle='#ff6'; for(let i=0;i<80;i++){g.beginPath();g.arc(Math.random()*size,Math.random()*size,2+Math.random()*5,0,7);g.fill();} }
  else if(kind==='noise'){ const d=g.createImageData(size,size); for(let i=0;i<d.data.length;i+=4){const v=Math.random()*255;d.data[i]=v;d.data[i+1]=v*.7;d.data[i+2]=255-v;d.data[i+3]=255;} g.putImageData(d,0,0); }
  else if(kind==='bricks'){ g.fillStyle='#722';g.fillRect(0,0,size,size); g.fillStyle='#b66'; for(let y=0;y<size;y+=16)for(let x=0;x<size;x+=32){g.fillRect(x+((y/16)%2)*16+1,y+1,30,14);} }
  else if(kind==='grid'){ g.fillStyle='#020';g.fillRect(0,0,size,size); g.strokeStyle='#0f6'; for(let i=0;i<=size;i+=16){g.beginPath();g.moveTo(i,0);g.lineTo(i,size);g.stroke();g.beginPath();g.moveTo(0,i);g.lineTo(size,i);g.stroke();} }
  else { g.fillStyle='#36c';g.fillRect(0,0,size,size); g.fillStyle='#fff'; g.font='bold 20px sans-serif'; g.fillText(kind,8,30); }
  return createTextureFromCanvas(device, c);
}
export function createTextureFromCanvas(device, canvas) {
  const tex=device.createTexture({size:[canvas.width,canvas.height,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
  device.queue.copyExternalImageToTexture({source:canvas},{texture:tex},[canvas.width,canvas.height]);
  return tex;
}
export function depthTexture(device,w,h){ return device.createTexture({size:[w,h],sampleCount:4,format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT}); }
export function depthTexture1(device,w,h){ return device.createTexture({size:[w,h],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT}); }
