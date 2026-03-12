/**
 * Seed default AI provider pricing.
 * Run: node prisma/seedPricing.js
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const defaults = [
  { provider: 'openai', model: 'gpt-4o-mini', inputPricePerMillion: 0.15, outputPricePerMillion: 0.60 },
  { provider: 'openai', model: 'gpt-4o', inputPricePerMillion: 2.50, outputPricePerMillion: 10.00 },
  { provider: 'gemini', model: 'gemini-2.5-flash', inputPricePerMillion: 0.15, outputPricePerMillion: 0.60 },
]

async function main() {
  for (const d of defaults) {
    await prisma.aiProviderPricing.upsert({
      where: { provider_model: { provider: d.provider, model: d.model } },
      update: {},
      create: d,
    })
    console.log(`  ✓ ${d.provider}/${d.model}`)
  }
  console.log('Done — default pricing seeded.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
