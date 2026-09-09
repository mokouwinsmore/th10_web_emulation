// Offscreen Direct3D 9 reference. The window is never shown or presented.
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
public class D3D9Oracle {
  [DllImport("d3d9.dll")] static extern IntPtr Direct3DCreate9(uint version);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowExW(uint ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
  [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
  [StructLayout(LayoutKind.Sequential)] struct Present {public uint width,height,format,count,multisample,quality,swap;public IntPtr window;public int windowed,autoDepth;public uint depthFormat,flags,refresh,interval;}
  [StructLayout(LayoutKind.Sequential)] struct Locked {public int pitch;public IntPtr pixels;}
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateDevice(IntPtr p,uint adapter,uint type,IntPtr window,uint behavior,ref Present parameters,out IntPtr device);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Simple(IntPtr p);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetSurface(IntPtr p,out IntPtr surface);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int RenderTarget(IntPtr p,uint w,uint h,uint format,uint multi,uint quality,int locked,out IntPtr target,IntPtr shared);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int DepthSurface(IntPtr p,uint w,uint h,uint format,uint multi,uint quality,int discard,out IntPtr target,IntPtr shared);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SetColorTarget(IntPtr p,uint index,IntPtr target);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SetDepthTarget(IntPtr p,IntPtr target);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetColorTarget(IntPtr p,uint index,out IntPtr target);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int State(IntPtr p,uint state,uint value);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int StageState(IntPtr p,uint stage,uint state,uint value);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Shader(IntPtr p,uint fvf);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Clear(IntPtr p,uint count,IntPtr rect,uint flags,uint color,float depth,uint stencil);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Transform(IntPtr p,uint state,IntPtr matrix);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Viewport(IntPtr p,IntPtr viewport);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Texture(IntPtr p,uint w,uint h,uint levels,uint usage,uint format,uint pool,out IntPtr texture,IntPtr shared);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SetTexture(IntPtr p,uint stage,IntPtr texture);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int LockTexture(IntPtr p,uint level,out Locked locked,IntPtr rect,uint flags);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int UnlockTexture(IntPtr p,uint level);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int LockSurface(IntPtr p,out Locked locked,IntPtr rect,uint flags);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Draw(IntPtr p,uint primitive,uint count,IntPtr vertices,uint stride);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int ImageSurface(IntPtr p,uint w,uint h,uint format,uint pool,out IntPtr surface,IntPtr shared);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CopyRects(IntPtr p,IntPtr source,IntPtr rect,uint count,IntPtr destination,IntPtr point);
  static T Fn<T>(IntPtr p,int index) where T:class {return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(p),index*IntPtr.Size),typeof(T));}
  static void Check(int result){if(result<0)throw new Exception("Direct3D HRESULT 0x"+unchecked((uint)result).ToString("x8"));}
  static uint U(object value){return Convert.ToUInt32(value);}
  static Dictionary<string,object> Obj(object value){return (Dictionary<string,object>)value;}
  static object[] Arr(object value){return (object[])value;}
  static IntPtr Bytes(byte[] bytes){IntPtr p=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,p,bytes.Length);return p;}
  static void Release(IntPtr p){if(p!=IntPtr.Zero)Fn<Simple>(p,2)(p);}
  static int SetTargets(IntPtr device,IntPtr target,IntPtr depth){Check(Fn<SetColorTarget>(device,37)(device,0,target));return Fn<SetDepthTarget>(device,39)(device,depth);}
  static void CopyImage(IntPtr device,IntPtr target,Dictionary<string,object> copy){Locked locked;Check(Fn<LockSurface>(target,13)(target,out locked,IntPtr.Zero,0));try{byte[] bytes=Convert.FromBase64String((string)copy["pixels"]);int stride=bytes.Length/Convert.ToInt32(copy["height"]),bpp=stride/Convert.ToInt32(copy["width"]);var r=Arr(copy["rect"]);var p=Arr(copy["point"]);int x=Convert.ToInt32(r[0]),y=Convert.ToInt32(r[1]),width=Convert.ToInt32(r[2])-x,height=Convert.ToInt32(r[3])-y,dx=Convert.ToInt32(p[0]),dy=Convert.ToInt32(p[1]);for(int row=0;row<height;row++)Marshal.Copy(bytes,(y+row)*stride+x*bpp,IntPtr.Add(locked.pixels,(dy+row)*locked.pitch+dx*bpp),width*bpp);}finally{Check(Fn<Simple>(target,14)(target));}}
  static void ClearRegion(IntPtr device,Dictionary<string,object> op){IntPtr viewport=Bytes(Convert.FromBase64String((string)op["viewport"])),rects=IntPtr.Zero;try{Check(Fn<Viewport>(device,47)(device,viewport));uint count=0;if(op["rects"]!=null){var r=Arr(op["rects"]);count=(uint)r.Length/4;rects=Marshal.AllocHGlobal(r.Length*4);for(int i=0;i<r.Length;i++)Marshal.WriteInt32(rects,i*4,Convert.ToInt32(r[i]));}Check(Fn<Clear>(device,43)(device,count,rects,U(op["flags"]),U(op["color"]),Convert.ToSingle(op["depth"]),U(op["stencil"])));}finally{Marshal.FreeHGlobal(viewport);if(rects!=IntPtr.Zero)Marshal.FreeHGlobal(rects);}}
  public static void Main(string[] args){try{Run(args);}catch(Exception error){Console.WriteLine("FAILED "+error.GetType().FullName+": "+error.Message);Environment.ExitCode=1;}}
  static void Run(string[] args){
    Console.WriteLine("D3D9 oracle starting");
    
    var json=new JavaScriptSerializer();json.MaxJsonLength=256*1024*1024;
    object[] cases=Arr(json.DeserializeObject(File.ReadAllText(args[0])));Directory.CreateDirectory(args[1]);
    IntPtr window=CreateWindowExW(0,"STATIC","TH10 offscreen D3D9 oracle",0x80000000,0,0,64,64,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero),d3d=Direct3DCreate9(32),device=IntPtr.Zero,back=IntPtr.Zero,originalDepth=IntPtr.Zero;
    try {
      if(window==IntPtr.Zero||d3d==IntPtr.Zero)throw new Exception("D3D9 initialization unavailable");
      Present pp=new Present{width=64,height=64,format=22,count=1,swap=1,window=window,windowed=1,autoDepth=0,depthFormat=0};
      Console.WriteLine("Creating device");Check(Fn<CreateDevice>(d3d,16)(d3d,0,1,window,0x40,ref pp,out device));Console.WriteLine("Device created");
      Check(Fn<GetColorTarget>(device,38)(device,0,out back));Fn<GetSurface>(device,40)(device,out originalDepth);
      foreach(object entry in cases){var c=Obj(entry);uint width=U(c["width"]),height=U(c["height"]),format=U(c["format"]);IntPtr target=IntPtr.Zero,depth=IntPtr.Zero;var textures=new List<IntPtr>();
        try {Console.WriteLine("Case "+c["name"]);
          Check(Fn<RenderTarget>(device,28)(device,width,height,format,0,0,1,out target,IntPtr.Zero));Check(Fn<DepthSurface>(device,29)(device,width,height,80,0,0,1,out depth,IntPtr.Zero));Check(SetTargets(device,target,depth));
          foreach(object textureEntry in Arr(c["textures"])){var t=Obj(textureEntry);IntPtr texture;uint tw=U(t["width"]),th=U(t["height"]),tf=U(t["format"]);Check(Fn<Texture>(device,23)(device,tw,th,1,0,tf,1,out texture,IntPtr.Zero));textures.Add(texture);Locked locked;Check(Fn<LockTexture>(texture,19)(texture,0,out locked,IntPtr.Zero,0));byte[] pixels=Convert.FromBase64String((string)t["pixels"]);int stride=pixels.Length/(int)th;for(int y=0;y<th;y++)Marshal.Copy(pixels,y*stride,IntPtr.Add(locked.pixels,y*locked.pitch),stride);Check(Fn<UnlockTexture>(texture,20)(texture,0));}
          Check(Fn<Clear>(device,43)(device,0,IntPtr.Zero,3,U(c["clear"]),1,0));if(c.ContainsKey("initialPixels"))CopyImage(device,target,new Dictionary<string,object>{{"width",width},{"height",height},{"format",format},{"pixels",c["initialPixels"]},{"rect",new object[]{0,0,width,height}},{"point",new object[]{0,0}}});Check(Fn<Simple>(device,41)(device));
          object[] draws=Arr(c["draws"]);for(int drawIndex=0;drawIndex<=draws.Length;drawIndex++){if(c.ContainsKey("ops"))foreach(object opEntry in Arr(c["ops"])){var op=Obj(opEntry);if(Convert.ToInt32(op["before"])==drawIndex){if((string)op["type"]=="copy")CopyImage(device,target,op);else ClearRegion(device,op);}}if(drawIndex==draws.Length)break;var d=Obj(draws[drawIndex]);if(d.ContainsKey("viewport")){IntPtr viewport=Bytes(Convert.FromBase64String((string)d["viewport"]));try{Check(Fn<Viewport>(device,47)(device,viewport));}finally{Marshal.FreeHGlobal(viewport);}}foreach(object pair in Arr(d["states"])){var a=Arr(pair);Check(Fn<State>(device,57)(device,U(a[0]),U(a[1])));}foreach(object pair in Arr(d["stages"])){var a=Arr(pair);uint key=U(a[0]);uint sampler=(uint)(key==13?1:key==14?2:key==25?3:key==15?4:key==16?5:key==17?6:key==18?7:key==19?8:key==20?9:key==21?10:0);Check(Fn<StageState>(device,sampler!=0?69:67)(device,0,sampler!=0?sampler:key,U(a[1])));}foreach(object pair in Arr(d["transforms"])){var a=Arr(pair);IntPtr matrix=Bytes(Convert.FromBase64String((string)a[1]));try{Check(Fn<Transform>(device,44)(device,U(a[0]),matrix));}finally{Marshal.FreeHGlobal(matrix);}}
            int textureIndex=Convert.ToInt32(d["texture"]);Check(Fn<SetTexture>(device,65)(device,0,textureIndex<0?IntPtr.Zero:textures[textureIndex]));Check(Fn<Shader>(device,89)(device,U(d["fvf"])));IntPtr vertices=Bytes(Convert.FromBase64String((string)d["vertices"]));try{Check(Fn<Draw>(device,83)(device,U(d["primitive"]),U(d["count"]),vertices,U(d["stride"])));}finally{Marshal.FreeHGlobal(vertices);}
          }
          Check(Fn<Simple>(device,42)(device));Locked result;Check(Fn<LockSurface>(target,13)(target,out result,IntPtr.Zero,0x10));int rowBytes=(int)width*(format==21||format==22?4:2);byte[] output=new byte[rowBytes*(int)height];for(int y=0;y<height;y++)Marshal.Copy(IntPtr.Add(result.pixels,y*result.pitch),output,y*rowBytes,rowBytes);Check(Fn<Simple>(target,14)(target));File.WriteAllBytes(Path.Combine(args[1],(string)c["name"]+".bin"),output);Console.WriteLine("D3D9 "+c["name"]+" "+output.Length);
        } finally {Fn<SetTexture>(device,65)(device,0,IntPtr.Zero);SetTargets(device,back,originalDepth);foreach(IntPtr texture in textures)Release(texture);Release(depth);Release(target);}
      }
    } finally {Release(originalDepth);Release(back);Release(device);Release(d3d);if(window!=IntPtr.Zero)DestroyWindow(window);}
  }
}
