const API = process.env.API_URL || 'http://localhost:3000';
(async ()=>{
  try{
    // login admin seeded in seed.js/demo: admin@demo.local / admin123
    const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ email: 'admin@demo.local', password: 'admin123' }) });
    const login = await loginRes.json();
    if(!login || !login.token){ console.error('Login failed', login); process.exit(2); }
    const token = login.token;
    const ordersRes = await fetch(`${API}/orders`, { headers: { Authorization: `Bearer ${token}` } });
    const orders = await ordersRes.json();
    console.log('orders count:', Array.isArray(orders) ? orders.length : JSON.stringify(orders).slice(0,2000));
    if(Array.isArray(orders) && orders.length>0) console.log('latest order:', JSON.stringify(orders[0], null, 2));
  }catch(e){ console.error(e); process.exit(1); }
})();
