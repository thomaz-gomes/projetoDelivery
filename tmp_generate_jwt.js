const crypto=require('crypto');
const b64u=(s)=>Buffer.from(JSON.stringify(s)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
const header={alg:'HS256',typ:'JWT'};
const payload={id:'admin-dev',role:'ADMIN',companyId:'bd6a5381-6b90-4cc9-bc8f-24890c491693',email:'dev-admin@example.com',name:'Dev Admin'};
const secret='dev-secret-change-me';
const signing=(h,p)=>crypto.createHmac('sha256',secret).update(h+"."+p).digest('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
const h=b64u(header);
const p=b64u(payload);
console.log(h+"."+p+"."+signing(h,p));
