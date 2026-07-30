import { createClient } from '@supabase/supabase-js';
import { createDecipheriv, createHash } from 'node:crypto';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const key = createHash('sha256').update(process.env.INTEGRATION_CREDENTIAL_SECRET).digest();
function dec(stored){const b=Buffer.from(stored,'base64');const d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8');}
const { data: ints } = await sb.from('affiliate_integrations').select('id,provider_name,base_url,authentication_type,endpoint_configuration');
console.log('integrations', ints.map(i=>({id:i.id,p:i.provider_name,b:i.base_url,a:i.authentication_type})));
const imp = ints.find(i=>/impact/i.test(i.provider_name)) ?? ints[0];
const { data: cred } = await sb.from('affiliate_integration_credentials').select('ciphertext').eq('integration_id', imp.id).maybeSingle();
const c = JSON.parse(dec(cred.ciphertext));
console.log('cred keys', Object.keys(c), 'user len', (c.username||'').length, 'pass len', (c.password||'').length);
const { data: st } = await sb.from('stores').select('id,name,logo_url,logo_source_url,metadata').ilike('name','%valuemag%').limit(3);
console.log('store', JSON.stringify(st,null,1).slice(0,1200));
const auth = 'Basic '+Buffer.from(`${c.username}:${c.password}`).toString('base64');
// 1. Campaigns call
const camp = new URL('/Mediapartners/'+c.username+'/Campaigns?PageSize=1', imp.base_url).toString();
let r = await fetch(camp, {headers:{Authorization:auth,Accept:'application/json'}});
console.log('CAMPAIGNS', camp, r.status);
const body = await r.text(); 
const m = body.match(/CampaignLogoUri"?[:>]\s*"?([^",<]+)/);
console.log('logoUri from campaigns:', m && m[1]);
const src = st?.[0]?.logo_source_url || (m && new URL(m[1], imp.base_url).toString());
console.log('resolved logo url:', src);
for (const variant of [{n:'auth',h:{Authorization:auth,Accept:'image/*'}},{n:'noauth',h:{Accept:'image/*'}}]) {
  let u = src, chain=[], status=0, ct='';
  for (let i=0;i<6;i++){
    const rr = await fetch(u,{headers:variant.h,redirect:'manual'});
    status=rr.status; ct=rr.headers.get('content-type');
    chain.push(`${rr.status} ${u} -> ${rr.headers.get('location')||''}`);
    if ([301,302,303,307,308].includes(rr.status) && rr.headers.get('location')) { u=new URL(rr.headers.get('location'),u).toString(); continue; }
    if (rr.status>=400) console.log('body:', (await rr.text()).slice(0,300));
    break;
  }
  console.log(variant.n, 'final', status, ct, '\n ', chain.join('\n  '));
}
