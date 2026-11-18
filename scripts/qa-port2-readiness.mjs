// Port 2.0 QA readiness: read-only, public GET probes. No PIN, license, ticket, or business payload.
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const ENDPOINTS = Object.freeze({
  issuer: 'https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket',
  worker: 'https://friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev/',
  version: 'https://jfcarpiopuntocom.github.io/friendly-123/version.json',
  rollout: 'https://jfcarpiopuntocom.github.io/friendly-123/sync-rollout.json'
});

export function classifyIssuer(status) {
  if (status === 404) return 'ROUTE_ABSENT';
  if (status === 503) return 'DEPLOYED_AUTHORITY_OFF';
  if (status === 405) return 'ROUTE_CONFIGURED';
  return 'UNVERIFIED_STATUS';
}

async function publicGet(fetcher,url) {
  try {
    const response=await fetcher(url,{
      method:'GET',cache:'no-store',credentials:'omit',redirect:'error',
      signal:AbortSignal.timeout(8000),headers:{accept:'application/json'}
    });
    return {response,status:response.status};
  } catch (_) {return {response:null,status:null};}
}

// No values or keys from the live rollout are ever logged.
export async function assessQaReadiness({fetcher=globalThis.fetch,endpoints=ENDPOINTS}={}) {
  if(typeof fetcher!=='function')throw Error('fetcher required');
  const [issuer,worker,version,rollout]=await Promise.all([
    publicGet(fetcher,endpoints.issuer),publicGet(fetcher,endpoints.worker),
    publicGet(fetcher,endpoints.version),publicGet(fetcher,endpoints.rollout)
  ]);
  let servedVersion=null,shell=null,enabledStores=null,jsonError=false;
  try {
    if(version.status===200){
      const p=await version.response.json();
      if(typeof p?.version==='string')servedVersion=p.version.slice(0,32);
      if(typeof p?.shell==='string')shell=p.shell.slice(0,48);
    }
    if(rollout.status===200){
      const p=await rollout.response.json();
      if(p?.schema!==1||!p?.licenses||typeof p.licenses!=='object'||Array.isArray(p.licenses))throw Error('unexpected rollout schema');
      enabledStores=Object.values(p.licenses).filter(row=>row?.yparty===true).length;
    }
  }catch(_){jsonError=true;}
  const issuerState=issuer.status===null?'NETWORK_UNAVAILABLE':classifyIssuer(issuer.status);
  const workerState=worker.status===503?'FAIL_CLOSED':worker.status===null?'NETWORK_UNAVAILABLE':'NOT_YET_AUTHENTICATED';
  const allStoresOff=enabledStores===0;
  const signedQaTestPossible=issuerState==='ROUTE_CONFIGURED'&&
    workerState==='NOT_YET_AUTHENTICATED'&&allStoresOff&&!jsonError;
  return {
    issuer:{http:issuer.status,state:issuerState},
    worker:{http:worker.status,state:workerState},
    published:{version:servedVersion,shell,versionHttp:version.status,rolloutHttp:rollout.status,enabledStores},
    rolloutSafe:allStoresOff,signedQaTestPossible,certified:false,
    status:!allStoresOff||jsonError?'INVESTIGATE_SAFETY':
      signedQaTestPossible?'READY_FOR_SIGNED_QA_TEST':'BLOCKED_BEFORE_QA'
  };
}
function safeSummary(r){
  return [
    '## friendly-123 · 2.0 QA public readiness (READ ONLY)',
    '- Ticket route: HTTP '+(r.issuer.http??'unavailable')+' · **'+r.issuer.state+'**',
    '- QA Worker: HTTP '+(r.worker.http??'unavailable')+' · **'+r.worker.state+'**',
    '- Pages: '+(r.published.version??'unverified')+' ('+(r.published.shell??'shell unknown')+')',
    '- Stores with 2.0 ON: '+(r.published.enabledStores??'unverified'),
    '- Operational status: **'+r.status+'**; full GO certified: **NO**',
    '- No license/PIN read and no business writes.'
  ].join('\n')+'\n';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await assessQaReadiness();
  const summary=safeSummary(result);
  process.stdout.write(summary);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
  if(result.status==='INVESTIGATE_SAFETY')process.exitCode=1;
  else if(process.argv.includes('--require-ticket')&&!result.signedQaTestPossible)process.exitCode=2;
}
