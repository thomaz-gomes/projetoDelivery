#!/usr/bin/env node
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: node import_seed_from_json.mjs seed.json')
    process.exit(2)
  }

  const raw = JSON.parse(fs.readFileSync(file))
  // helper: accept multiple possible key names (PascalCase, camelCase, plural)
  function getArray(obj, ...keys) {
    for (const k of keys) {
      if (obj[k] && Array.isArray(obj[k])) return obj[k]
    }
    return null
  }
  const prisma = new PrismaClient()
  try {
    // Companies
    const companies = getArray(raw, 'companies', 'Companies', 'Company')
    if (companies && Array.isArray(companies)) {
      for (const c of companies) {
        const data = {
          id: c.id || undefined,
          name: c.name || c.nome || 'Imported Company',
          slug: c.slug || (c.name ? c.name.toLowerCase().replace(/[^a-z0-9]+/g,'-') : undefined)
        }
        const where = data.id ? { id: data.id } : { slug: data.slug }
        await prisma.company.upsert({ where, update: data, create: data }).catch(()=>{})
      }
    }

    // Stores
    const stores = getArray(raw, 'stores', 'Stores', 'Store')
    if (stores && Array.isArray(stores)) {
      for (const s of stores) {
        const data = { slug: s.slug || (s.name ? s.name.toLowerCase().replace(/[^a-z0-9]+/g,'-') : undefined), name: s.name || s.nome, companyId: s.companyId }
        const where = data.slug ? { slug: data.slug } : { id: s.id }
        await prisma.store.upsert({ where, update: data, create: { ...data, address: s.address || s.endereco || '' } }).catch(()=>{})
      }
    }

    // Users
    const users = getArray(raw, 'users', 'Users', 'User')
    if (users && Array.isArray(users)) {
      for (const u of users) {
        const email = u.email || u.username
        if (!email) continue
        const password = u.password || u.senha || 'change-me'
        const hash = await bcrypt.hash(password, 10)
        const userData = { email, name: u.name || u.nome || 'Imported', role: u.role || 'ADMIN', password: hash, companyId: u.companyId || undefined }
        await prisma.user.upsert({ where: { email }, update: userData, create: userData }).catch(()=>{})
      }
    }

    // Printer settings
    const printerSettings = getArray(raw, 'printerSettings', 'PrinterSetting', 'PrinterSettings', 'printer_setting')
    if (printerSettings && Array.isArray(printerSettings)) {
      for (const p of printerSettings) {
        const rec = { companyId: p.companyId, interface: p.interface || p.type || 'printer:EPSON', type: p.type || 'EPSON', width: p.width || p.paperWidth || 48 }
        await prisma.printerSetting.upsert({ where: { companyId: rec.companyId }, update: rec, create: rec }).catch(()=>{})
      }
    }

    // Payment methods
    const paymentMethods = getArray(raw, 'paymentMethods', 'PaymentMethod', 'PaymentMethods')
    if (paymentMethods && Array.isArray(paymentMethods)) {
      for (const pm of paymentMethods) {
        const code = pm.code || pm.codigo || pm.name
        const rec = { code, name: pm.name || pm.nome || code, isActive: typeof pm.isActive !== 'undefined' ? pm.isActive : true, companyId: pm.companyId || undefined }
        await prisma.paymentMethod.upsert({ where: { code: rec.code }, update: rec, create: rec }).catch(()=>{})
      }
    }

    // Menu categories
    const menuCategories = getArray(raw, 'menuCategories', 'MenuCategory', 'MenuCategories')
    if (menuCategories && Array.isArray(menuCategories)) {
      for (const mc of menuCategories) {
        const rec = { companyId: mc.companyId, menuId: mc.menuId, name: mc.name, position: mc.position || 0 }
        const where = mc.id ? { id: mc.id } : { name: rec.name }
        await prisma.menuCategory.upsert({ where, update: rec, create: { id: mc.id, ...rec } }).catch(()=>{})
      }
    }

    // Products
    const products = getArray(raw, 'products', 'Product', 'Products')
    if (products && Array.isArray(products)) {
      for (const p of products) {
        const pd = { id: p.id, companyId: p.companyId, menuId: p.menuId, categoryId: p.categoryId, name: p.name, price: String(p.price || p.preco || 0), position: p.position || 0 }
        const where = pd.id ? { id: pd.id } : { name: pd.name }
        await prisma.product.upsert({ where, update: pd, create: pd }).catch(()=>{})
      }
    }

    // Option groups + options
    const optionGroups = getArray(raw, 'optionGroups', 'OptionGroup', 'OptionGroups')
    if (optionGroups && Array.isArray(optionGroups)) {
      for (const g of optionGroups) {
        const grp = await prisma.optionGroup.upsert({ where: { id: g.id || g.name }, update: { name: g.name, min: g.min || 0, max: g.max || 0, companyId: g.companyId }, create: { id: g.id, name: g.name, min: g.min || 0, max: g.max || 0, companyId: g.companyId } }).catch(()=>null)
        if (g.options && Array.isArray(g.options)) {
          for (const o of g.options) {
            const where = o.id ? { id: o.id } : { name: o.name }
            await prisma.option.upsert({ where, update: { groupId: grp?.id, name: o.name, price: String(o.price || 0), position: o.position || 0 }, create: { id: o.id, groupId: grp?.id, name: o.name, price: String(o.price || 0), position: o.position || 0 } }).catch(()=>{})
          }
        }
      }
    }

    // Customers and addresses
    const customers = getArray(raw, 'customers', 'Customers', 'Customer')
    if (customers && Array.isArray(customers)) {
      for (const c of customers) {
        const rec = { id: c.id || undefined, companyId: c.companyId || undefined, fullName: c.fullName || c.nome || 'Cliente', whatsapp: c.whatsapp || c.phone || null }
        const where = rec.id ? { id: rec.id } : { fullName: rec.fullName }
        await prisma.customer.upsert({ where, update: rec, create: rec }).catch(()=>{})
        if (c.addresses && Array.isArray(c.addresses)) {
          for (const a of c.addresses) {
            const aw = a.id ? { id: a.id } : { formatted: a.formatted || `${a.street}-${a.number}` }
            await prisma.address.upsert({ where: aw, update: { companyId: rec.companyId, customerId: rec.id, street: a.street, number: a.number, neighborhood: a.neighborhood, city: a.city, state: a.state, postalCode: a.postalCode, formatted: a.formatted || '' }, create: { id: a.id, companyId: rec.companyId, customerId: rec.id, street: a.street, number: a.number, neighborhood: a.neighborhood, city: a.city, state: a.state, postalCode: a.postalCode, formatted: a.formatted || '' } }).catch(()=>{})
          }
        }
      }
    }

    console.log('Import completed')
  } catch (e) {
    console.error('Import failed', e && e.message)
  } finally {
    await prisma.$disconnect()
  }
}

main()
