/* 极简 ZIP 写入器（仅存储不压缩，UTF-8 文件名）。files:[{name, data:Blob|Uint8Array|string}] -> Blob */
(function(root){
const T=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;T[i]=c>>>0;}
function crc(u8){let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=T[(c^u8[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
async function toU8(d){if(d instanceof Uint8Array)return d;if(typeof d==='string')return new TextEncoder().encode(d);return new Uint8Array(await d.arrayBuffer());}
async function makeZip(files){
  const parts=[],central=[];let off=0;const enc=new TextEncoder();
  const now=new Date();const dt=((now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1))&0xffff;
  const dd=(((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate())&0xffff;
  const used=new Set();
  for(const f of files){
    let name=f.name.replace(/^\/+/,'');let base=name,n=1;while(used.has(name)){const i=base.lastIndexOf('.');name=i>0?base.slice(0,i)+'_'+(++n)+base.slice(i):base+'_'+(++n);}used.add(name);
    const nb=enc.encode(name),u8=await toU8(f.data),c=crc(u8);
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(8,0,true);lh.setUint16(10,dt,true);lh.setUint16(12,dd,true);
    lh.setUint32(14,c,true);lh.setUint32(18,u8.length,true);lh.setUint32(22,u8.length,true);lh.setUint16(26,nb.length,true);lh.setUint16(28,0,true);
    parts.push(lh.buffer,nb,u8);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(10,0,true);ch.setUint16(12,dt,true);ch.setUint16(14,dd,true);
    ch.setUint32(16,c,true);ch.setUint32(20,u8.length,true);ch.setUint32(24,u8.length,true);ch.setUint16(28,nb.length,true);ch.setUint32(42,off,true);
    central.push(ch.buffer,nb);
    off+=30+nb.length+u8.length;
  }
  let csize=0;for(const p of central)csize+=p.byteLength;
  const end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,csize,true);end.setUint32(16,off,true);
  return new Blob([...parts,...central,end.buffer],{type:'application/zip'});
}
/* 读取 ZIP（仅支持存储/deflate，用 DecompressionStream）。返回 [{name,data:Uint8Array}] */
async function readZip(blob){
  const u8=new Uint8Array(await blob.arrayBuffer());const dv=new DataView(u8.buffer);let e=u8.length-22;
  while(e>=0&&dv.getUint32(e,true)!==0x06054b50)e--;if(e<0)throw new Error('不是有效的 ZIP 文件');
  const n=dv.getUint16(e+10,true);let p=dv.getUint32(e+16,true);const out=[];const dec=new TextDecoder();
  for(let i=0;i<n;i++){
    const method=dv.getUint16(p+10,true),csz=dv.getUint32(p+20,true),nl=dv.getUint16(p+28,true),el=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true),lo=dv.getUint32(p+42,true);
    const name=dec.decode(u8.subarray(p+46,p+46+nl));p+=46+nl+el+cl;
    const lnl=dv.getUint16(lo+26,true),lel=dv.getUint16(lo+28,true);const ds=lo+30+lnl+lel;let data=u8.subarray(ds,ds+csz);
    if(method===8){const ds2=new DecompressionStream('deflate-raw');const r=new Response(new Blob([data]).stream().pipeThrough(ds2));data=new Uint8Array(await r.arrayBuffer());}
    else if(method!==0)throw new Error('不支持的压缩方式');
    if(!name.endsWith('/'))out.push({name,data});
  }
  return out;
}
root.MiniZip={makeZip,readZip,crc};
})(self);
