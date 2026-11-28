/* C200: genera docs/X.min.js para los scripts de arranque grandes de docs/index.html.
   La fuente comentada (docs/X.js) sigue siendo la verdad; index.html y sw.js sirven el .min.js.
   Mismas opciones de esbuild que scripts/build-app-entry.cjs (sin renombrar identificadores).
   Uso: node scripts/build-min-scripts.cjs [--check] [--list] */
const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const docs=path.join(__dirname,'..','docs');
const UMBRAL=10*1024; // solo vale la pena minificar los grandes
const NO=['aislamiento.js','salud-app.js','cargador.js','core/commission-history.js','commissions-by-person.js'] /* tests y dashboard.html fijan estos nombres */; // arranque/verificacion: se sirven tal cual
const html=fs.readFileSync(path.join(docs,'index.html'),'utf8');
const names=[...html.matchAll(/<script\b[^>]*\b(?:data-post-pin-src|src)=["']\.\/([^"']+)["']/g)].map(m=>m[1])
  .map(n=>n.replace(/\.min\.js$/,'.js')).filter((n,i,a)=>a.indexOf(n)===i)
  .filter(n=>!NO.includes(n)&&!n.startsWith('vendor/')&&!/^app-inline-|^dashboard-main/.test(n))
  .filter(n=>fs.existsSync(path.join(docs,n))&&fs.statSync(path.join(docs,n)).size>=UMBRAL);
// CRLF -> LF: el checkout de Windows (autocrlf) no debe cambiar el resultado respecto a CI.
const min=s=>esbuild.transformSync(s.replace(/\r\n/g,'\n'),{loader:'js',target:'es2020',minifySyntax:true,minifyWhitespace:true,minifyIdentifiers:false,legalComments:'none'}).code;
if(process.argv.includes('--list')){console.log(names.join('\n'));process.exit(0);}
const check=process.argv.includes('--check');let bad=0;
for(const n of names){const out=path.join(docs,n.replace(/\.js$/,'.min.js'));const code=min(fs.readFileSync(path.join(docs,n),'utf8'));
  if(check){if(!fs.existsSync(out)||fs.readFileSync(out,'utf8').replace(/\r\n/g,'\n')!==code){console.error('min desactualizado: '+n);bad++;}}
  else fs.writeFileSync(out,code,'utf8');}
if(check){if(bad)process.exit(1);console.log('min.js al dia: '+names.length+' archivos');}else console.log('generados '+names.length+' .min.js');
