// Private-to-public Yjs COPY, intentionally detached from the original Y.Doc.
// JFC 16 Nov 2026. Used ONLY after authenticating a real human/role and when
// the recipient room rejects all incoming modifications. Not an ACL engine.
// No endpoint or client sync channel is activated by importing this module.
const ID=/^(?!__proto__$)(?!constructor$)(?!prototype$)[A-Za-z0-9_-]{1,120}$/;
const FIELDS_PRODUCT=['id','nombre','sku','barcode','categoria','ubicacionId','precio','stockActual'];
const FIELDS_SHELF=['id','nombre','tipo','activa'];
const MAX_ITEMS=10000;
function invalid(type){throw new TypeError('invalid '+type);}
function id(value){
 if(typeof value!=='string'||!ID.test(value))invalid('id');
 return value;
}
function text(value,label,max=180){
 if(typeof value!=='string'||value.trim()!==value||value.length<1||value.length>max||
    /[\x00-\x1F\x7F]/.test(value))invalid(label);
 return value;
}
function maybeText(row,key,max){
 return row[key]===undefined?undefined:text(row[key],key,max);
}
function product(row,key){
 if(!row||typeof row!=='object'||Array.isArray(row))invalid('product');
 const idValue=id(row.id);
 if(idValue!==key)invalid('product id mismatch');
 const nombre=text(row.nombre,'product name');
 if(typeof row.precio!=='number'||!Number.isFinite(row.precio)||row.precio<0||row.precio>1e9)
   invalid('product price');
 if(!Number.isSafeInteger(row.stockActual)||row.stockActual< -1e6||row.stockActual>1e9)
   invalid('product stock');
 const out={id:idValue,nombre};
 for(const [field,max] of [['sku',80],['barcode',80],['categoria',120],['ubicacionId',120]]){
  const val=maybeText(row,field,max);
  if(val!==undefined)out[field]=val;
 }
 // Display only: price and stock in this detached view NEVER authorize a
 // financial commit. The typed operations path has its own cent-based contract.
 out.precio=row.precio;out.stockActual=row.stockActual;
 return out;
}
function shelf(row,key){
 if(!row||typeof row!=='object'||Array.isArray(row))invalid('shelf');
 const idValue=id(row.id);
 if(idValue!==key)invalid('shelf id mismatch');
 const out={id:idValue,nombre:text(row.nombre,'shelf name')};
 const tipo=maybeText(row,'tipo',80);
 if(tipo!==undefined)out.tipo=tipo;
 if(row.activa!==undefined){
  if(typeof row.activa!=='boolean')invalid('shelf active');
  out.activa=row.activa;
 }
 return out;
}
function entries(doc,mapName) {
 // doc.share.get avoids creating empty private Y.Map roots during inspection.
 const root=doc.share.get(mapName);
 if(!root)return[];
 if(typeof root.forEach!=='function')invalid('source map');
 const rows=[];root.forEach((row,key)=>rows.push([key,row]));
 if(rows.length>MAX_ITEMS)throw new RangeError('too many '+mapName+'; limit '+MAX_ITEMS);
 rows.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
 return rows;
}
export function projectPublicCatalog({sourceDoc,Y}={}){
 if(!Y||typeof Y.Doc!=='function'||!(sourceDoc instanceof Y.Doc))
   invalid('source Y.Doc');
 // Never use Y.encodeStateAsUpdate(sourceDoc): it includes PINs/customers/cost.
 const products=entries(sourceDoc,'productos').map(([key,row])=>[key,product(row,key)]);
 const shelves=entries(sourceDoc,'ubicaciones').map(([key,row])=>[key,shelf(row,key)]);
 const publicDoc=new Y.Doc({gc:true});
 try{
  publicDoc.transact(()=>{
   const p=publicDoc.getMap('productos'),s=publicDoc.getMap('ubicaciones');
   for(const [k,v] of products)p.set(k,v);
   for(const [k,v] of shelves)s.set(k,v);
  },'independent-sanitized-public-view');
  return {doc:publicDoc,bytes:Y.encodeStateAsUpdate(publicDoc)};
 }catch(error){publicDoc.destroy();throw error;}
}
