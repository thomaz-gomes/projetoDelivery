import axios from 'axios';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false });
const API = 'https://localhost:3000';

async function run() {
  try {
    console.log('1) Login as admin...');
    let resp = await axios.post(`${API}/auth/login`, { email: 'admin@example.com', password: 'admin123' }, { httpsAgent: agent });
    const token = resp.data.token;
    console.log('-> token obtained');

    const headers = { Authorization: `Bearer ${token}` };

    console.log('\n2) Create neighborhood Centro with riderFee 7.00...');
    resp = await axios.post(`${API}/neighborhoods`, { name: 'Centro', aliases: ['dinah borges', 'dina borges'], deliveryFee: '0.00', riderFee: '7.00' }, { headers, httpsAgent: agent });
    console.log('-> created neighborhood:', resp.data);

    console.log('\n3) Find an EM_PREPARO order to use...');
    resp = await axios.get(`${API}/orders`, { headers, httpsAgent: agent });
    const orders = resp.data;
    const order = orders.find(o => o.status === 'EM_PREPARO') || orders[0];
    if (!order) throw new Error('No orders found');
    console.log('-> selected order:', order.id, order.displayId || order.externalId, 'status:', order.status);

    const riderId = 'rider-demo-1';

    console.log('\n4) Assign rider and set status to SAIU_PARA_ENTREGA...');
    resp = await axios.post(`${API}/orders/${order.id}/assign`, { riderId, alsoSetStatus: true }, { headers, httpsAgent: agent });
    console.log('-> assign response:', resp.data.order.id, 'status now:', resp.data.order.status);

    console.log('\n5) Change status to CONCLUIDO (complete) to trigger rider transactions...');
    resp = await axios.patch(`${API}/orders/${order.id}/status`, { status: 'CONCLUIDO' }, { headers, httpsAgent: agent });
    console.log('-> status update response:', resp.data.id, 'status:', resp.data.status);

    console.log('\n6) Get rider account balance...');
    resp = await axios.get(`${API}/riders/${riderId}/account`, { headers, httpsAgent: agent });
    console.log('-> rider account:', resp.data);

    console.log('\n7) Get rider transactions...');
  resp = await axios.get(`${API}/riders/${riderId}/transactions`, { headers, httpsAgent: agent });
  const txs = resp.data.items || resp.data;
  console.log('-> transactions (latest 10):', (Array.isArray(txs) ? txs : []).slice(0, 10));

    console.log('\nE2E finished successfully');
  } catch (e) {
    console.error('E2E failed:', e.response ? e.response.data || e.response.statusText : e.message);
    if (e.response && e.response.data) console.error(JSON.stringify(e.response.data, null, 2));
    process.exit(1);
  }
}

run();
