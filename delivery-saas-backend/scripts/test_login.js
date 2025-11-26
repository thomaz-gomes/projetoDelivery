import axios from 'axios';
import https from 'https';

async function main(){
  const agent = new https.Agent({ rejectUnauthorized: false });
  try{
    const res = await axios.post('http://localhost:3000/auth/login', { login: '73991429676', password: 'rider123' }, { httpsAgent: agent, headers: { 'Content-Type': 'application/json' } });
    console.log('status', res.status);
    console.log(res.data);
  } catch (e) {
    if (e.response) console.error('response', e.response.status, e.response.data);
    else console.error('error', e.message);
    process.exit(1);
  }
}

main();
