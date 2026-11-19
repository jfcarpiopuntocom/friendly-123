// Incremental FIPS 180-4 SHA-256: synchronous, Worker-safe, bounded to 64 bytes.
// Used only to content-address bytes within the *synchronous* SQL transaction.
// Synthetic tests independently compare this implementation to native WebCrypto.
const K=Uint32Array.from([
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);
const INITIAL=Uint32Array.from([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
const ROTR=(v,n)=>(v>>>n)|(v<<(32-n));
const utf8=new TextEncoder();
export class Sha256Sync{
 constructor(){this.state=Uint32Array.from(INITIAL);this.block=new Uint8Array(64);this.used=0;this.size=0;this.finished=false;}
 update(value){
  if(this.finished)throw new Error('sha256 already finalized');
  const b=typeof value==='string'?utf8.encode(value):value;
  if(!(b instanceof Uint8Array))throw new TypeError('sha256 accepts string or Uint8Array');
  this.size+=b.length;
  if(!Number.isSafeInteger(this.size)||this.size>=2**53/8)throw new Error('sha256 input too large');
  let offset=0;
  while(offset<b.length){
   const n=Math.min(64-this.used,b.length-offset);
   this.block.set(b.subarray(offset,offset+n),this.used);
   this.used+=n;offset+=n;
   if(this.used===64){this.compress();this.used=0;}
  }
  return this;
 }
 compress(){
  const w=new Uint32Array(64),buf=this.block;
  for(let i=0;i<16;i++){
   const p=i*4;w[i]=((buf[p]<<24)|(buf[p+1]<<16)|(buf[p+2]<<8)|buf[p+3])>>>0;
  }
  for(let i=16;i<64;i++){
   const s0=ROTR(w[i-15],7)^ROTR(w[i-15],18)^(w[i-15]>>>3);
   const s1=ROTR(w[i-2],17)^ROTR(w[i-2],19)^(w[i-2]>>>10);
   w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;
  }
  let [a,b,c,d,e,f,g,h]=this.state;
  for(let i=0;i<64;i++){
   const S1=ROTR(e,6)^ROTR(e,11)^ROTR(e,25);
   const ch=(e&f)^(~e&g);
   const t1=(h+S1+ch+K[i]+w[i])>>>0;
   const S0=ROTR(a,2)^ROTR(a,13)^ROTR(a,22);
   const maj=(a&b)^(a&c)^(b&c);
   const t2=(S0+maj)>>>0;
   h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
  }
  for(const [i,v] of [a,b,c,d,e,f,g,h].entries())this.state[i]=(this.state[i]+v)>>>0;
 }
 hex(){
  if(this.finished)throw new Error('sha256 already finalized');
  this.finished=true;
  let i=this.used;this.block[i++]=128;
  if(i>56){this.block.fill(0,i);this.compress();i=0;}
  this.block.fill(0,i,56);
  const bitLen=this.size*8,high=Math.floor(bitLen/2**32),low=bitLen>>>0;
  const b=this.block;
  b[56]=high>>>24;b[57]=high>>>16;b[58]=high>>>8;b[59]=high;
  b[60]=low>>>24;b[61]=low>>>16;b[62]=low>>>8;b[63]=low;
  this.compress();
  return [...this.state].map(x=>x.toString(16).padStart(8,'0')).join('');
 }
}
export function sha256Sync(bytes){return new Sha256Sync().update(bytes).hex();}
