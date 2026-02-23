import { prisma } from '../src/prisma.js';

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: node find-customer-references.mjs <customerId>');
    process.exit(2);
  }

  console.log('Searching for references to customer id:', id);

  // list tables
  const tables = await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  for (const row of tables) {
    const table = row.name;
    // check table_info for any columns that look like FK to customer
    const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info('${table}')`);
    const candidateCols = cols.filter(c => /customerid|clientid|customer_id|client_id/i.test(String(c.name)) ).map(c => c.name);

    // check foreign keys pragma to see if this table has FK targeting Customer
    const fks = await prisma.$queryRawUnsafe(`PRAGMA foreign_key_list('${table}')`);
    const fkToCustomer = fks.filter(f => String(f.table).toLowerCase() === 'customer');

    const checks = new Set([...candidateCols, ...fkToCustomer.map(f => f.from)]);
    if (checks.size === 0) continue;

    for (const col of checks) {
      try {
        const countRow = await prisma.$queryRawUnsafe(`SELECT count(*) as cnt FROM '${table}' WHERE "${col}" = ?`, id);
        // Depending on driver, countRow may be array-like
        const cnt = Number(countRow?.[0]?.cnt ?? countRow?.cnt ?? 0);
        if (cnt > 0) {
          console.log(`${table}.${col} -> ${cnt} row(s)`);
          // show sample rows (limit 5)
          const samples = await prisma.$queryRawUnsafe(`SELECT * FROM '${table}' WHERE "${col}" = ? LIMIT 5`, id);
          console.log('Sample rows:', samples);
        }
      } catch (e) {
        // ignore errors (some tables/columns may be problematic)
      }
    }
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
