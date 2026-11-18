import YProvider,{WebsocketProvider} from 'y-partyserver/provider';

// The imported automatic reconnect deliberately reuses stale params on failure.
// Single-use capabilities require a fresh authorization before every socket instead.
export default class AuthorizedYProvider extends YProvider {
  #session;

  constructor(host,room,doc,options={}) {
    const {params,connect=false,...rest}=options;
    if(typeof params!=='function')throw new TypeError('WS authorization requires a fresh params callback');
    super(host,room,doc,{...rest,params:undefined,connect:false,disableBc:true});
    this.#session={request:params,baseUrl:this.url,generation:0,wanted:false,destroyed:false,unconfirmed:0};
    this.on('synced',synced=>{if(synced)this.#session.unconfirmed=0;});
    if(connect)this.connect().catch(()=>{});
  }

  connect() {
    return this.#connect(false);
  }

  async #connect(reconnecting) {
    const session=this.#session;
    if(session.destroyed)return false;
    if(reconnecting&&!session.wanted)return false;
    if(this.ws!==null&&this.ws.readyState<2&&this.shouldConnect)return true;
    const generation=++session.generation;
    session.wanted=true;
    this.shouldConnect=false;
    if(!reconnecting)session.unconfirmed=0;
    if(this.ws!==null){
      const closing=this.ws;
      if(closing.readyState!==3)await new Promise(resolve=>closing.addEventListener('close',resolve,{once:true}));
      if(generation!==session.generation||!session.wanted||session.destroyed)return false;
    }
    // One fresh admission retry tolerates expiry/restart; repeated failures to
    // synchronize stop here instead of spending the issuer's entire quota.
    if(reconnecting&&session.unconfirmed>=2){
      this.disconnect();
      this.emit('authorization-error',[{reason:'connection-not-confirmed'}]);
      return false;
    }
    let params;
    try {
      params=await session.request();
      if(!params||typeof params!=='object'||Array.isArray(params)||
         typeof params.cap!=='string'||!params.cap.length||params.cap.length>3500||
         Object.entries(params).some(([k,v])=>!['cap','licencia','instancia'].includes(k)||typeof v!=='string'||v.length>3500))throw new Error();
    } catch (_) {
      if(generation!==session.generation||!session.wanted||session.destroyed)return false;
      this.disconnect();
      // A rejection can contain credentials from an HTTP client. Never emit/log it.
      this.emit('authorization-error',[{reason:'authorization-unavailable'}]);
      throw new Error('WS authorization unavailable');
    }
    if(generation!==session.generation||!session.wanted||session.destroyed||this.doc.isDestroyed)return false;
    const url=new URL(session.baseUrl);
    url.search=new URLSearchParams([['_pk',this.id],...Object.entries(params)]).toString();
    this.url=url.toString();
    session.unconfirmed++;
    // This synchronous upstream entry has no second async turn that could reopen
    // a socket after disconnect() invalidated a pending credential request.
    WebsocketProvider.prototype.connect.call(this);
    return true;
  }

  _reconnectWS() {
    return this.#connect(true).catch(()=>false);
  }

  disconnect() {
    if(this.#session){this.#session.wanted=false;this.#session.generation++;}
    super.disconnect();
    if(this.#session)this.url=this.#session.baseUrl;
  }

  destroy() {
    this.#session.destroyed=true;
    super.destroy();
  }
}
