(async () => {
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const base = 'https://localhost:3000';
    const fetch = global.fetch || (await import('node-fetch')).default;

    const loginRes = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' })
    });
    const login = await loginRes.json();
    console.log('LOGIN', login);
    const token = login.token;

    const ordersRes = await fetch(base + '/orders', { headers: { Authorization: `Bearer ${token}` } });
    const orders = await ordersRes.json();
    console.log('ORDERS_COUNT', orders.length);
    const order = orders.find(o => o.externalId === 'ORD-TEST-123456') || orders[0];
    console.log('ORDER_SELECTED', order?.id, order?.externalId, order?.status);

    // create neighborhood
    const nhRes = await fetch(base + '/neighborhoods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Centro', aliases: ['Centro'], deliveryFee: '5.00', riderFee: '10.00' })
    });
    const nh = await nhRes.json();
    console.log('NEIGHBORHOOD_CREATED', nh);

    // get riders
    const ridersRes = await fetch(base + '/riders', { headers: { Authorization: `Bearer ${token}` } });
    const riders = await ridersRes.json();
    console.log('RIDERS', riders);
    const rider = riders.find(r => r.id === 'rider-demo-1') || riders[0];
    console.log('RIDER_SELECTED', rider);

    // assign rider to order
    const assignRes = await fetch(base + `/orders/${order.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ riderId: rider.id, alsoSetStatus: true })
    });
    const assign = await assignRes.json();
    console.log('ASSIGN', assign);

    // set status to CONCLUIDO
    const statusRes = await fetch(base + `/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'CONCLUIDO' })
    });
    const status = await statusRes.json();
    console.log('STATUS_UPDATED', status);

    // fetch rider account
    const acctRes = await fetch(base + `/riders/${rider.id}/account`, { headers: { Authorization: `Bearer ${token}` } });
    const acct = await acctRes.json();
    console.log('RIDER_ACCOUNT', acct);

    // fetch transactions
  const txRes = await fetch(base + `/riders/${rider.id}/transactions`, { headers: { Authorization: `Bearer ${token}` } });
  const txBody = await txRes.json();
  const txs = txBody.items || txBody;
  console.log('RIDER_TRANSACTIONS', txs);

  } catch (e) {
    console.error('E2E ERROR', e);
    process.exit(1);
  }
})();
