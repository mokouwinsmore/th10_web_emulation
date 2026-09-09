// Store D3D top rows at GL row zero. This preserves the D3D top-left
// rasterization rule; flip only the final presentation to the DOM canvas.
const IDENTITY=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const float=n=>new Float32Array(new Uint32Array([n]).buffer)[0];
const color=n=>[(n>>>16&255)/255,(n>>>8&255)/255,(n&255)/255,(n>>>24)/255];
const vertex=`#version 300 es
precision highp float;
layout(location=0) in vec4 position;
layout(location=1) in vec4 diffuse;
layout(location=2) in vec2 uv;
layout(location=3) in vec4 specular;
layout(location=4) in vec4 instanceWorld0;
layout(location=5) in vec4 instanceWorld1;
layout(location=6) in vec4 instanceWorld2;
layout(location=7) in vec4 instanceWorld3;
layout(location=8) in vec4 instanceFactor;
uniform mat4 world,view,projection,textureMatrix;
uniform vec4 factor;
uniform vec4 viewport;
uniform bool transformed,textureTransform,fogEnabled,rangeFog;
uniform bool instanced;
uniform int fogMode;
uniform vec3 fogParams;
out vec4 vColor,vSpecular;
out vec2 vUV;
out float vFog;
flat out vec4 vFactor;
void main(){
  mat4 model=instanced?mat4(instanceWorld0,instanceWorld1,instanceWorld2,instanceWorld3):world;
  vec4 eye=view*model*vec4(position.xyz,1.0);
  if(transformed){vec2 xy=(position.xy-viewport.xy+vec2(.5))/viewport.zw;gl_Position=vec4(xy.x*2.0-1.0,xy.y*2.0-1.0,position.z*2.0-1.0,1.0)/position.w;}
  else {gl_Position=projection*eye;gl_Position.y=-gl_Position.y;gl_Position.xy+=gl_Position.w/viewport.zw;gl_Position.z=gl_Position.z*2.0-gl_Position.w;}
  vColor=diffuse.bgra;vSpecular=specular.bgra;
  vFactor=instanced?instanceFactor.bgra:factor;
  vUV=textureTransform&&!transformed?(textureMatrix*vec4(uv,1.0,0.0)).xy:uv;
  float z=rangeFog?length(eye.xyz):abs(eye.z);
  float fog=fogMode==1?exp(-fogParams.z*z):fogMode==2?exp(-pow(fogParams.z*z,2.0)):(fogParams.y-z)/(fogParams.y-fogParams.x);
  vFog=fogEnabled?(transformed?specular.a:fog):1.0;
}`;
const fragment=`#version 300 es
precision highp float;
in vec4 vColor,vSpecular;in vec2 vUV;in float vFog;
flat in vec4 vFactor;
uniform sampler2D tex;
uniform bool hasTexture,alphaTest,fogEnabled;
uniform bool depth16;
uniform vec4 fogColor;
uniform int colorOp,alphaOp,colorArg1,colorArg2,alphaArg1,alphaArg2,alphaFunc;
uniform float alphaRef;
out vec4 outColor;
vec4 arg(int value,vec4 textureColor){int source=value&15;vec4 c=source==2?textureColor:source==3?vFactor:source==4?vSpecular:vColor;if((value&16)!=0)c=1.0-c;if((value&32)!=0)c=vec4(c.a);return c;}
vec4 op(int mode,vec4 a,vec4 b,vec4 textureColor){
 if(mode==2)return a;if(mode==3)return b;if(mode==4)return a*b;if(mode==5)return a*b*2.0;if(mode==6)return a*b*4.0;if(mode==7)return a+b;if(mode==8)return a+b-.5;if(mode==9)return (a+b-.5)*2.0;if(mode==10)return a-b;if(mode==11)return a+b*(1.0-a);
 if(mode==12)return mix(b,a,vColor.a);if(mode==13)return mix(b,a,textureColor.a);if(mode==14)return mix(b,a,vFactor.a);if(mode==15)return a+b*(1.0-textureColor.a);if(mode==16)return mix(b,a,vColor.a);return vColor;
}
void main(){vec4 t=hasTexture?texture(tex,vUV):vec4(1.0);
 vec4 c=hasTexture&&colorOp!=1?op(colorOp,arg(colorArg1,t),arg(colorArg2,t),t):vColor;
 c.a=hasTexture&&alphaOp!=1?op(alphaOp,arg(alphaArg1,t),arg(alphaArg2,t),t).a:vColor.a;c=clamp(c,0.0,1.0);
 if(alphaTest){float a=c.a*255.0,ref=floor(alphaRef*255.0+.5);bool pass=alphaFunc==8||(alphaFunc==2&&a<ref)||(alphaFunc==3&&a==ref)||(alphaFunc==4&&a<=ref)||(alphaFunc==5&&a>ref)||(alphaFunc==6&&a!=ref)||(alphaFunc==7&&a>=ref);if(!pass)discard;}
 if(fogEnabled)c.rgb=mix(fogColor.rgb,c.rgb,clamp(vFog,0.0,1.0));outColor=c;
 // D3D9 compares the incoming D16 value after quantization. Splitting the
 // product preserves values just below a half-unit (for example float 0.9).
 float scaled=gl_FragCoord.z*65536.0;
 gl_FragDepth=depth16?(floor(scaled)+floor(fract(scaled)-gl_FragCoord.z+0.5))/65535.0:gl_FragCoord.z;
}`;
export class WebGLD3D9 {
  constructor(canvas,d3d){
    this.canvas=canvas;this.d3d=d3d;this.m=d3d.m;this.gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true,premultipliedAlpha:false});if(!this.gl)throw new Error('WebGL 2 unavailable');const gl=this.gl;
    const clip=gl.getExtension('EXT_clip_control');if(clip)clip.clipControlEXT(clip.LOWER_LEFT_EXT,clip.ZERO_TO_ONE_EXT);const vertexSource=clip?vertex.replace('position.z*2.0-1.0','position.z').replace('gl_Position.z=gl_Position.z*2.0-gl_Position.w;',''):vertex;
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    this.shader=shader;this.vertexShader=shader(gl.VERTEX_SHADER,vertexSource);this.programs=new Map();this.program=gl.createProgram();gl.attachShader(this.program,this.vertexShader);gl.attachShader(this.program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));
    gl.useProgram(this.program);this.uniforms=new Map();for(let i=0;i<gl.getProgramParameter(this.program,gl.ACTIVE_UNIFORMS);i++){const u=gl.getActiveUniform(this.program,i);this.uniforms.set(u.name,gl.getUniformLocation(this.program,u.name));}
    this.vertices=gl.createBuffer();this.indices=gl.createBuffer();this.instanceMatrices=gl.createBuffer();this.surfaces=new Map();this.depths=new Map();d3d.onFlush=()=>this.flush();
    d3d.onDraw=draw=>this.queue(draw);d3d.onClear=clear=>{this.flush();this.clear(clear);};d3d.onCopy=(src,rect,dst,point)=>{this.flush();return this.copy(src,rect,dst,point);};d3d.onPresent=device=>{this.flush();this.present(device);};d3d.onReadSurface=s=>{this.flush();this.readSurface(s);};d3d.onRelease=s=>{this.flush();this.release(s);};this.batchEnabled=true;this.stats={calls:0,batches:0,uploadBytes:0,readBytes:0,ms:0};
    for(const name of ['onDraw','onClear','onCopy','onPresent','onReadSurface','onRelease']){const callback=d3d[name];d3d[name]=(...args)=>{const start=performance.now();try{return callback(...args);}finally{this.stats.ms+=performance.now()-start;}};}
  }
  sameState(a,b,instanceWorld=false){if(a.fvf!==b.fvf||a.stride!==b.stride||a.texture!==b.texture||a.target!==b.target||a.depthTarget!==b.depthTarget)return false;const mapEqual=(a,b,compare=(a,b)=>a===b)=>{if(a===b)return true;if(a.size!==b.size)return false;for(const [key,value] of a)if(!b.has(key)||!compare(value,b.get(key),key))return false;return true;},bytesEqual=(a,b)=>a===b||a.length===b.length&&a.every((v,i)=>v===b[i]);return bytesEqual(a.viewport,b.viewport)&&mapEqual(a.states,b.states,(a,b,key)=>instanceWorld&&key===60||a===b)&&mapEqual(a.stages,b.stages)&&((a.fvf&14)===4||mapEqual(a.transforms,b.transforms,(a,b,key)=>instanceWorld&&key===256||bytesEqual(a,b)));}
  queue(d){this.stats.calls++;if(!this.batchEnabled||d.indices||![4,5,6].includes(d.primitive)){this.flush();this.draw(d);return;}
    // Repeated untransformed stage quads differ only in their model matrix.
    // Instancing retains every original matrix and primitive order; positions
    // remain transformed by the same vertex shader rather than CPU rounding.
    if(d.fvf===0x102&&d.stride===20&&d.primitive===5&&d.count===2&&d.transforms.has(256)){
      const batch=this.batch;
      if(batch?.worlds&&this.sameState(batch.draw,d,true)&&batch.draw.vertices.every((v,i)=>v===d.vertices[i]))batch.worlds.push(d);
      else{this.flush();this.batch={draw:d,worlds:[d]};}
      if(this.batch.worlds.length>=1024)this.flush();return;
    }
    if(this.batch?.worlds)this.flush();
    const previous=this.batch;if(previous&&!this.sameState(previous.draw,d))this.flush();let data=d.vertices;
    if(d.primitive!==4){data=new Uint8Array(d.count*3*d.stride);for(let i=0;i<d.count;i++){const indices=d.primitive===6?[0,i+1,i+2]:i&1?[i+1,i,i+2]:[i,i+1,i+2];indices.forEach((index,j)=>data.set(d.vertices.subarray(index*d.stride,(index+1)*d.stride),(i*3+j)*d.stride));}}
    this.batch??={draw:{...d,primitive:4,count:0},parts:[],length:0};const batch=this.batch;batch.parts.push(data);batch.length+=data.length;batch.draw.count+=d.count;if(batch.length>=1024*1024)this.flush();
  }
  flush(){const batch=this.batch;if(!batch)return;this.batch=null;if(batch.worlds){if(batch.worlds.length===1){this.draw(batch.draw);return;}const matrices=new Uint8Array(batch.worlds.length*68),view=new DataView(matrices.buffer);batch.worlds.forEach((d,i)=>{matrices.set(d.transforms.get(256),i*68);view.setUint32(i*68+64,d.states.get(60)??0xffffffff,true);});this.draw({...batch.draw,instanceWorlds:matrices});return;}const data=new Uint8Array(batch.length);let offset=0;for(const part of batch.parts){data.set(part,offset);offset+=part.length;}batch.draw.vertices=data;this.draw(batch.draw);}
  set(name,type,...value){this.gl[type](this.uniforms.get(name),...value);}
  selectProgram(d){const state=(n,def=0)=>d.states.get(n)??def,stage=(n,def)=>d.stages.get(n)??def,values=[!!d.texture,!!state(15),!!state(28),stage(1,4),stage(4,2),stage(2,2),stage(3,1),stage(5,2),stage(6,1),state(25,8)],key=values.join(',');let variant=this.programs.get(key);const gl=this.gl;if(!variant){const names=['hasTexture','alphaTest','fogEnabled','colorOp','alphaOp','colorArg1','colorArg2','alphaArg1','alphaArg2','alphaFunc'];let source=fragment.replace('uniform bool hasTexture,alphaTest,fogEnabled;','').replace('uniform int colorOp,alphaOp,colorArg1,colorArg2,alphaArg1,alphaArg2,alphaFunc;','');source=source.replace('precision highp float;','precision highp float;\n'+names.map((name,i)=>`const ${i<3?'bool':'int'} ${name}=${values[i]};`).join('\n'));const program=gl.createProgram();gl.attachShader(program,this.vertexShader);gl.attachShader(program,this.shader(gl.FRAGMENT_SHADER,source));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));const uniforms=new Map();for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++){const u=gl.getActiveUniform(program,i);uniforms.set(u.name,gl.getUniformLocation(program,u.name));}variant={program,uniforms};this.programs.set(key,variant);}this.program=variant.program;this.uniforms=variant.uniforms;gl.useProgram(this.program);}
  pixels(s){
    const input=this.m.view(s.data,s.size),out=new Uint8Array(s.width*s.height*4),v=new DataView(input.buffer,input.byteOffset,input.byteLength);
    for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
      const p=y*s.width*4+x*4;let r=0,g=0,b=0,a=255;
      if(s.format===21||s.format===22){const i=y*s.pitch+x*4;b=input[i];g=input[i+1];r=input[i+2];a=s.format===21?input[i+3]:255;}
      else if([23,24,25,26].includes(s.format)){const n=v.getUint16(y*s.pitch+x*2,true);if(s.format===26){b=(n&15)*17;g=(n>>4&15)*17;r=(n>>8&15)*17;a=(n>>12)*17;}else if(s.format===23){b=Math.round((n&31)*255/31);g=Math.round((n>>5&63)*255/63);r=Math.round((n>>11)*255/31);}else{b=Math.round((n&31)*255/31);g=Math.round((n>>5&31)*255/31);r=Math.round((n>>10&31)*255/31);a=s.format===25?(n&0x8000?255:0):255;}}
      else if(s.format===28){r=g=b=255;a=input[y*s.pitch+x];}else if(s.format===50){r=g=b=input[y*s.pitch+x];}else throw new Error('Unimplemented texture format '+s.format);
      out[p]=r;out[p+1]=g;out[p+2]=b;out[p+3]=a;
    }return out;
  }
  surface(s){const gl=this.gl;let gpu=this.surfaces.get(s.address);
    if(!gpu){const texture=gl.createTexture(),framebuffer=gl.createFramebuffer();gpu={texture,framebuffer,version:-1,width:s.width,height:s.height};this.surfaces.set(s.address,gpu);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);}
    if(gpu.version!==s.version){
      this.stats.uploadBytes+=s.size;gl.bindTexture(gl.TEXTURE_2D,gpu.texture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      let pixels,format=gl.RGBA,type=gl.UNSIGNED_BYTE,internal=gl.RGBA8;
      if(s.format===26){
        // Text atlases already use four bits per channel. Rotate ARGB to RGBA
        // directly, avoiding expansion, a second quantization and large
        // temporary byte arrays every time the original adds another line.
        const bytes=this.m.view(s.data,s.size),input=new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2),size=s.width*s.height;
        if(!this.upload16||this.upload16.length<size)this.upload16=new Uint16Array(size);
        pixels=this.upload16.subarray(0,size);for(let i=0;i<size;i++){const n=input[i];pixels[i]=(n<<4)|(n>>>12);}type=gl.UNSIGNED_SHORT_4_4_4_4;internal=gl.RGBA4;
      }else{
        const rgba=this.pixels(s),rgb=[20,22,23].includes(s.format);pixels=rgba;
        if(rgb){pixels=new Uint8Array(s.width*s.height*3);for(let i=0,j=0;i<rgba.length;i+=4){pixels[j++]=rgba[i];pixels[j++]=rgba[i+1];pixels[j++]=rgba[i+2];}}
        format=rgb?gl.RGB:gl.RGBA;internal=s.format===23?gl.RGB565:s.format===24||s.format===25?gl.RGB5_A1:rgb?gl.RGB8:gl.RGBA8;
      }
      if(gpu.version<0)gl.texImage2D(gl.TEXTURE_2D,0,internal,s.width,s.height,0,format,type,pixels);
      else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,s.width,s.height,format,type,pixels);
      gpu.version=s.version;gpu.rendered=false;
    }
    return gpu;
  }
  target(address,depthAddress=0){const gl=this.gl,s=this.d3d.com.get(address),gpu=this.surface(s);let depth=this.depths.get(depthAddress);if(depthAddress&&!depth){const d=this.d3d.com.get(depthAddress);depth={buffer:gl.createRenderbuffer(),stencil:d.format===75};gl.bindRenderbuffer(gl.RENDERBUFFER,depth.buffer);gl.renderbufferStorage(gl.RENDERBUFFER,depth.stencil?gl.DEPTH24_STENCIL8:d.format===80?gl.DEPTH_COMPONENT16:gl.DEPTH_COMPONENT24,d.width,d.height);this.depths.set(depthAddress,depth);}gl.bindFramebuffer(gl.FRAMEBUFFER,gpu.framebuffer);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth?.buffer??null);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.STENCIL_ATTACHMENT,gl.RENDERBUFFER,depth?.stencil?depth.buffer:null);return {s,gpu};}
  readSurface(s){const gpu=this.surfaces.get(s.address);if(!gpu?.rendered)return;this.stats.readBytes+=s.size;const gl=this.gl,pixels=new Uint8Array(s.width*s.height*4),output=this.m.view(s.data,s.size),v=new DataView(output.buffer,output.byteOffset,output.byteLength);gl.bindFramebuffer(gl.FRAMEBUFFER,gpu.framebuffer);gl.readPixels(0,0,s.width,s.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){const p=(y*s.width+x)*4,r=pixels[p],g=pixels[p+1],b=pixels[p+2],a=pixels[p+3];
      if(s.format===21||s.format===22){const i=y*s.pitch+x*4;output[i]=b;output[i+1]=g;output[i+2]=r;output[i+3]=s.format===21?a:255;}
      else if([23,24,25,26].includes(s.format)){const n=s.format===26?(a>>4)<<12|(r>>4)<<8|(g>>4)<<4|(b>>4):s.format===23?(r>>3)<<11|(g>>2)<<5|(b>>3):(s.format===25&&a>=128?0x8000:0)|(r>>3)<<10|(g>>3)<<5|(b>>3);v.setUint16(y*s.pitch+x*2,n,true);}
      else if(s.format===28)output[y*s.pitch+x]=a;else if(s.format===50)output[y*s.pitch+x]=r;else throw new Error('Unsupported readback format '+s.format);
    }gpu.rendered=false;
  }
  release(s){const gl=this.gl,gpu=this.surfaces.get(s.address),depth=this.depths.get(s.address);if(depth){gl.deleteRenderbuffer(depth.buffer);this.depths.delete(s.address);}if(!gpu)return;gl.deleteTexture(gpu.texture);gl.deleteFramebuffer(gpu.framebuffer);this.surfaces.delete(s.address);}
  clear(c){const gl=this.gl,{s,gpu}=this.target(c.target,c.depthTarget),v=new DataView(c.viewport.buffer,c.viewport.byteOffset),rects=c.rects??[v.getUint32(0,true),v.getUint32(4,true),v.getUint32(0,true)+v.getUint32(8,true),v.getUint32(4,true)+v.getUint32(12,true)];gl.enable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);gl.depthMask(true);gl.clearColor(...color(c.color));gl.clearDepth(c.depth);gl.clearStencil(c.stencil??0);gl.stencilMask(255);let bits=0;if(c.flags&1)bits|=gl.COLOR_BUFFER_BIT;if(c.flags&2)bits|=gl.DEPTH_BUFFER_BIT;if(c.flags&4)bits|=gl.STENCIL_BUFFER_BIT;
    for(let i=0;i<rects.length;i+=4){gl.scissor(rects[i],rects[i+1],rects[i+2]-rects[i],rects[i+3]-rects[i+1]);gl.clear(bits);}gl.disable(gl.SCISSOR_TEST);gpu.rendered=true;
  }
  draw(d){this.stats.batches++;const gl=this.gl,state=(n,def=0)=>d.states.get(n)??def,stage=(n,def=0)=>d.stages.get(n)??def;
    state(26)?gl.enable(gl.DITHER):gl.disable(gl.DITHER);
    const tex=d.texture?this.d3d.com.get(d.texture).surface:null,texture=tex?this.surface(tex):null,{s,gpu}=this.target(d.target,d.depthTarget),vp=new DataView(d.viewport.buffer,d.viewport.byteOffset);
    const v=[0,4,8,12].map(o=>vp.getUint32(o,true));gl.viewport(v[0],v[1],v[2],v[3]);gl.depthRange(vp.getFloat32(16,true),vp.getFloat32(20,true));this.selectProgram(d);
    this.set('viewport','uniform4fv',v);const transformed=(d.fvf&14)===4;this.set('transformed','uniform1i',transformed?1:0);this.set('textureTransform','uniform1i',stage(24)?1:0);
    this.set('instanced','uniform1i',d.instanceWorlds?1:0);
    for(const [name,key] of [['world',256],['view',2],['projection',3],['textureMatrix',16]]){const b=d.transforms.get(key);this.set(name,'uniformMatrix4fv',false,b?new Float32Array(b.buffer,b.byteOffset,16):IDENTITY);}
    this.set('fogEnabled','uniform1i',state(28));this.set('rangeFog','uniform1i',state(48));this.set('fogMode','uniform1i',state(140));this.set('fogParams','uniform3f',float(state(36)),float(state(37,0x3f800000)),float(state(38,0x3f800000)));this.set('fogColor','uniform4fv',color(state(34)));
    this.set('hasTexture','uniform1i',texture?1:0);this.set('factor','uniform4fv',color(state(60,0xffffffff)));
    for(const [name,key,def] of [['colorOp',1,4],['colorArg1',2,2],['colorArg2',3,1],['alphaOp',4,2],['alphaArg1',5,2],['alphaArg2',6,1]]){const val=stage(key,def);if(name.endsWith('Op')&&(val<1||val>16))throw new Error('Unsupported texture op '+val);this.set(name,'uniform1i',val);}
    this.set('alphaTest','uniform1i',state(15));this.set('alphaRef','uniform1f',state(24)/255);this.set('alphaFunc','uniform1i',state(25,8));this.set('depth16','uniform1i',state(7)&&d.depthTarget&&this.d3d.com.get(d.depthTarget).format===80?1:0);
    if(texture){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture.texture);const address=n=>[0,gl.REPEAT,gl.MIRRORED_REPEAT,gl.CLAMP_TO_EDGE,gl.CLAMP_TO_EDGE,gl.CLAMP_TO_EDGE][n]??gl.REPEAT;gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,address(stage(13,1)));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,address(stage(14,1)));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,stage(17)===1?gl.NEAREST:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,stage(16)===1?gl.NEAREST:gl.LINEAR);}
    state(7)?gl.enable(gl.DEPTH_TEST):gl.disable(gl.DEPTH_TEST);gl.depthMask(!!state(14,1));const cmp=[0,gl.NEVER,gl.LESS,gl.EQUAL,gl.LEQUAL,gl.GREATER,gl.NOTEQUAL,gl.GEQUAL,gl.ALWAYS];gl.depthFunc(cmp[state(23,4)]);
    if(state(27)){gl.enable(gl.BLEND);const blend=[0,gl.ZERO,gl.ONE,gl.SRC_COLOR,gl.ONE_MINUS_SRC_COLOR,gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.DST_ALPHA,gl.ONE_MINUS_DST_ALPHA,gl.DST_COLOR,gl.ONE_MINUS_DST_COLOR,gl.SRC_ALPHA_SATURATE];gl.blendFunc(blend[state(19,2)],blend[state(20,1)]);gl.blendEquation([0,gl.FUNC_ADD,gl.FUNC_SUBTRACT,gl.FUNC_REVERSE_SUBTRACT,gl.MIN,gl.MAX][state(171,1)]);}else gl.disable(gl.BLEND);
    if(state(22,1)!==1){gl.enable(gl.CULL_FACE);gl.frontFace(gl.CW);gl.cullFace(state(22)===2?gl.BACK:gl.FRONT);}else gl.disable(gl.CULL_FACE);
    const mask=state(168,15);gl.colorMask(!!(mask&1),!!(mask&2),!!(mask&4),!!(mask&8));
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vertices);gl.bufferData(gl.ARRAY_BUFFER,d.vertices,gl.STREAM_DRAW);let offset=transformed?16:12;gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,transformed?4:3,gl.FLOAT,false,d.stride,0);
    if(d.fvf&16)offset+=12;if(d.fvf&32)offset+=4;
    for(const [loc,flag] of [[1,64],[3,128]]){if(d.fvf&flag){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,4,gl.UNSIGNED_BYTE,true,d.stride,offset);offset+=4;}else{gl.disableVertexAttribArray(loc);gl.vertexAttrib4f(loc,1,1,1,1);}}
    if(d.fvf&0xf00){gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,d.stride,offset);}else{gl.disableVertexAttribArray(2);gl.vertexAttrib2f(2,0,0);}
    const mode=[0,gl.POINTS,gl.LINES,gl.LINE_STRIP,gl.TRIANGLES,gl.TRIANGLE_STRIP,gl.TRIANGLE_FAN][d.primitive],count=d.primitive===1?d.count:d.primitive===2?d.count*2:d.primitive===3?d.count+1:d.primitive===4?d.count*3:d.count+2;
    if(d.instanceWorlds){gl.bindBuffer(gl.ARRAY_BUFFER,this.instanceMatrices);gl.bufferData(gl.ARRAY_BUFFER,d.instanceWorlds,gl.STREAM_DRAW);for(let column=0;column<4;column++){gl.enableVertexAttribArray(4+column);gl.vertexAttribPointer(4+column,4,gl.FLOAT,false,68,column*16);gl.vertexAttribDivisor(4+column,1);}gl.enableVertexAttribArray(8);gl.vertexAttribPointer(8,4,gl.UNSIGNED_BYTE,true,68,64);gl.vertexAttribDivisor(8,1);gl.drawArraysInstanced(mode,0,count,d.instanceWorlds.length/68);for(let location=4;location<=8;location++){gl.vertexAttribDivisor(location,0);gl.disableVertexAttribArray(location);}}
    else if(d.indices){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,d.indices,gl.STREAM_DRAW);gl.drawElements(mode,count,d.indexFormat===101?gl.UNSIGNED_SHORT:gl.UNSIGNED_INT,0);}else gl.drawArrays(mode,0,count);gpu.rendered=true;
  }
  copy(src,rect,dst,point){const gl=this.gl,from=this.surface(src),to=this.surface(dst),[x,y,r,b]=rect,w=r-x,h=b-y;gl.bindFramebuffer(gl.READ_FRAMEBUFFER,from.framebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,to.framebuffer);gl.disable(gl.SCISSOR_TEST);gl.blitFramebuffer(x,y,r,b,point[0],point[1],point[0]+w,point[1]+h,gl.COLOR_BUFFER_BIT,gl.NEAREST);to.rendered=true;to.version=dst.version+1;return true;}
  present(device){const gl=this.gl,s=device.back,gpu=this.surface(s);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,gpu.framebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);gl.disable(gl.SCISSOR_TEST);gl.blitFramebuffer(0,0,s.width,s.height,0,this.canvas.height,this.canvas.width,0,gl.COLOR_BUFFER_BIT,gl.NEAREST);gl.flush();const error=gl.getError();if(error)throw new Error('WebGL error '+error);}
}
