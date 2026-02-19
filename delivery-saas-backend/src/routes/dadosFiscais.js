import express from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'

const router = express.Router()
router.use(authMiddleware)

// ─── Static reference data ────────────────────────────────────────────────

const NCM_LIST = [
  { code: '2106.90.90', desc: 'Preparações alimentícias não especificadas nem compreendidas em outras posições' },
  { code: '2202.10.00', desc: 'Águas, incluídas as águas minerais e as águas gaseificadas, adicionadas de açúcar ou de outros edulcorantes ou aromatizadas' },
  { code: '2203.00.00', desc: 'Cervejas de malte' },
  { code: '2204.21.00', desc: 'Vinhos - Em recipientes de capacidade não superior a 2 l' },
  { code: '2205.10.00', desc: 'Vermutes e outros vinhos de uvas frescas' },
  { code: '2208.20.00', desc: 'Aguardentes de vinho ou de bagaço de uvas' },
  { code: '2208.40.00', desc: 'Rum e outros aguardentes provenientes da fermentação e destilação da cana-de-açúcar' },
  { code: '2208.70.00', desc: 'Licores' },
  { code: '2009.11.00', desc: 'Suco de laranja, congelado' },
  { code: '2009.12.00', desc: 'Suco de laranja, não congelado, sem adição de açúcar' },
  { code: '2009.90.00', desc: 'Outros sucos de fruta ou de produtos hortícolas' },
  { code: '1902.20.00', desc: 'Massas alimentícias recheadas (mesmo cozidas ou preparadas de outro modo)' },
  { code: '1902.11.00', desc: 'Massas alimentícias não cozidas, nem recheadas, nem preparadas de outro modo - Contendo ovos' },
  { code: '1902.19.00', desc: 'Massas alimentícias não cozidas - Outras' },
  { code: '1902.30.00', desc: 'Outras massas alimentícias' },
  { code: '1905.90.90', desc: 'Outros produtos de padaria, pastelaria ou da indústria de bolachas e biscoitos' },
  { code: '1905.31.00', desc: 'Bolachas e biscoitos, adicionados de edulcorantes' },
  { code: '1905.32.00', desc: 'Waffles e wafers' },
  { code: '1905.40.00', desc: 'Torradas, pão torrado e produtos semelhantes torrados' },
  { code: '1905.10.00', desc: 'Pão crocante denominado Knäckebrot' },
  { code: '1905.20.00', desc: 'Pão de especiarias' },
  { code: '2105.00.10', desc: 'Sorvetes em embalagens imediatas de conteúdo inferior ou igual a 2 kg' },
  { code: '2105.00.90', desc: 'Sorvetes - Outros' },
  { code: '2104.10.21', desc: 'Caldos e sopas preparados em embalagens imediatas de conteúdo inferior ou igual a 1 kg' },
  { code: '2104.20.00', desc: 'Preparações alimentícias compostas homogeneizadas (alimentos infantis)' },
  { code: '2101.11.10', desc: 'Extratos, essências ou concentrados de café' },
  { code: '2101.20.10', desc: 'Extratos, essências ou concentrados de chá ou de mate' },
  { code: '0901.21.00', desc: 'Café torrado, não descafeinado, em grão' },
  { code: '0901.22.00', desc: 'Café torrado, não descafeinado, moído' },
  { code: '1604.20.90', desc: 'Preparações de carne, de peixes ou de crustáceos, de moluscos ou de outros invertebrados aquáticos' },
  { code: '1602.32.00', desc: 'Preparações de frangos - Outras' },
  { code: '1602.50.00', desc: 'Preparações de carne bovina' },
  { code: '0210.11.00', desc: 'Pernas e partes de suíno, salgadas ou em salmoura' },
  { code: '1601.00.00', desc: 'Enchidos (salsichas, salames, mortadelas e semelhantes) e produtos semelhantes' },
  { code: '0407.21.00', desc: 'Ovos de galinha frescos' },
  { code: '0401.10.10', desc: 'Leite e creme de leite, não concentrados, sem adição de açúcar - Leite longa vida' },
  { code: '0402.21.10', desc: 'Leite em pó integral' },
  { code: '0403.10.00', desc: 'Iogurte' },
  { code: '0406.10.00', desc: 'Queijo fresco (não curado) ou de soro de leite' },
  { code: '0406.90.00', desc: 'Outros queijos' },
  { code: '1501.90.00', desc: 'Outras gorduras de porco, banha e toucinho' },
  { code: '1507.90.11', desc: 'Óleo de soja refinado, em recipientes com capacidade inferior ou igual a 5 l' },
  { code: '1701.99.00', desc: 'Outros açúcares de cana' },
  { code: '1702.90.00', desc: 'Outros açúcares, incluindo a lactose, maltose, glicose e frutose' },
  { code: '0710.10.00', desc: 'Batatas, cozidas em água ou vapor, congeladas' },
  { code: '0710.80.00', desc: 'Outros produtos hortícolas, cozidos em água ou vapor, congelados' },
  { code: '2001.90.00', desc: 'Outros vegetais, frutas, frutos e outras partes comestíveis de plantas, preparados ou conservados em vinagre' },
  { code: '2005.20.00', desc: 'Batatas preparadas ou conservadas, exceto em vinagre ou em ácido acético, não congeladas' },
  { code: '2103.20.10', desc: 'Ketchup e outros molhos de tomate' },
  { code: '2103.90.11', desc: 'Molhos de pimenta' },
  { code: '2103.90.21', desc: 'Maionese' },
  { code: '2002.10.00', desc: 'Tomates, inteiros ou em pedaços, preparados ou conservados' },
  { code: '2103.10.00', desc: 'Molho de soja' },
  { code: '1806.31.10', desc: 'Chocolate em tabletes, barras ou paus, recheados, com adição de cereal' },
  { code: '1806.90.00', desc: 'Outros chocolates' },
  { code: '1704.90.10', desc: 'Chicletes' },
  { code: '1704.90.90', desc: 'Outros produtos de confeitaria sem cacau' },
  { code: '2202.99.00', desc: 'Outras bebidas não alcoólicas' },
  { code: '2201.10.00', desc: 'Água mineral natural ou artificial' },
  { code: '1517.10.00', desc: 'Margarina, exceto margarina líquida' },
  { code: '0305.49.00', desc: 'Peixes defumados' },
  { code: '0306.17.00', desc: 'Camarões, congelados' },
  { code: '1806.10.00', desc: 'Cacau em pó, com adição de açúcar ou de outros edulcorantes' },
  { code: '9503.00.00', desc: 'Brinquedos, jogos, artigos para divertimento ou para esporte' },
  { code: '3304.99.90', desc: 'Outros produtos de beleza, de maquiagem e de cuidados com a pele' },
]

const CFOP_LIST = [
  { code: '5.102', desc: 'Venda de mercadoria adquirida ou recebida de terceiros.' },
  { code: '5.101', desc: 'Venda de produção do estabelecimento.' },
  { code: '5.405', desc: 'Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído.' },
  { code: '5.404', desc: 'Venda de mercadoria sujeita ao regime de substituição tributária, cujo imposto já tenha sido retido anteriormente.' },
  { code: '5.403', desc: 'Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituto.' },
  { code: '5.949', desc: 'Taxa de serviços (saída de outros créditos).' },
  { code: '5.910', desc: 'Remessa em bonificação, doação ou brinde.' },
  { code: '5.667', desc: 'Venda de combustível ou lubrificante adquiridos ou recebidos de terceiros destinados à industrialização subsequente.' },
  { code: '6.102', desc: 'Venda de mercadoria adquirida ou recebida de terceiros (saída para outro estado).' },
  { code: '6.101', desc: 'Venda de produção do estabelecimento (saída para outro estado).' },
  { code: '6.405', desc: 'Venda de mercadoria adquirida em operação com ST, contribuinte substituído (outro estado).' },
]

// CEST mapping (NCM prefix → CEST code list). Only items subject to ICMS-ST.
const CEST_BY_NCM = {
  '2202': [{ code: '03.003.00', desc: 'Refrigerante em embalagem com capacidade igual ou inferior a 600 ml' }, { code: '03.004.00', desc: 'Refrigerante em embalagem com capacidade superior a 600 ml' }],
  '2203': [{ code: '03.001.00', desc: 'Cervejas em garrafa de vidro retornável' }, { code: '03.002.00', desc: 'Cervejas em outras embalagens' }],
  '2204': [{ code: '03.006.00', desc: 'Vinho em embalagem com capacidade igual ou inferior a 1 l' }],
  '1704': [{ code: '17.001.00', desc: 'Chicletes, gomas de mascar' }],
  '1806': [{ code: '17.003.00', desc: 'Chocolates e preparações alimentícias contendo cacau' }],
  '0402': [{ code: '23.001.00', desc: 'Leite em pó' }],
  '2201': [{ code: '03.010.00', desc: 'Água mineral natural, gaseificada ou não' }],
}

// ─── Static NCM list ──────────────────────────────────────────────────────
router.get('/ncm', (req, res) => {
  const q = (req.query.q || '').toLowerCase()
  const list = q
    ? NCM_LIST.filter(n => n.code.includes(q) || n.desc.toLowerCase().includes(q))
    : NCM_LIST
  res.json(list)
})

// ─── Static CFOP list ─────────────────────────────────────────────────────
router.get('/cfop', (req, res) => {
  const q = (req.query.q || '').toLowerCase()
  const list = q
    ? CFOP_LIST.filter(c => c.code.includes(q) || c.desc.toLowerCase().includes(q))
    : CFOP_LIST
  res.json(list)
})

// ─── CEST by NCM ─────────────────────────────────────────────────────────
router.get('/cest', (req, res) => {
  const ncm = String(req.query.ncm || '').replace(/\./g, '').slice(0, 4)
  const list = CEST_BY_NCM[ncm] || []
  res.json(list)
})

// ─── CRUD for DadosFiscais ───────────────────────────────────────────────

// GET /settings/dados-fiscais
router.get('/dados-fiscais', async (req, res) => {
  try {
    const companyId = req.user.companyId
    const rows = await prisma.dadosFiscais.findMany({
      where: { companyId },
      orderBy: { descricao: 'asc' },
    })
    res.json(rows)
  } catch (e) {
    console.error('GET /dados-fiscais failed', e)
    res.status(500).json({ message: 'Erro ao listar dados fiscais', error: e?.message })
  }
})

// POST /settings/dados-fiscais
router.post('/dados-fiscais', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const data = sanitize(req.body, companyId)
    if (!data.descricao) return res.status(400).json({ message: 'Descrição é obrigatória' })
    const created = await prisma.dadosFiscais.create({ data })
    res.status(201).json(created)
  } catch (e) {
    console.error('POST /dados-fiscais failed', e)
    res.status(500).json({ message: 'Erro ao criar dados fiscais', error: e?.message })
  }
})

// PATCH /settings/dados-fiscais/:id
router.patch('/dados-fiscais/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const { id } = req.params
    const existing = await prisma.dadosFiscais.findFirst({ where: { id, companyId } })
    if (!existing) return res.status(404).json({ message: 'Não encontrado' })
    const data = sanitize(req.body, companyId)
    delete data.companyId
    const updated = await prisma.dadosFiscais.update({ where: { id }, data })
    res.json(updated)
  } catch (e) {
    console.error('PATCH /dados-fiscais/:id failed', e)
    res.status(500).json({ message: 'Erro ao atualizar dados fiscais', error: e?.message })
  }
})

// DELETE /settings/dados-fiscais/:id
router.delete('/dados-fiscais/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const { id } = req.params
    const existing = await prisma.dadosFiscais.findFirst({ where: { id, companyId } })
    if (!existing) return res.status(404).json({ message: 'Não encontrado' })
    // unlink from categories and products before deleting
    await prisma.menuCategory.updateMany({ where: { dadosFiscaisId: id }, data: { dadosFiscaisId: null } })
    await prisma.product.updateMany({ where: { dadosFiscaisId: id }, data: { dadosFiscaisId: null } })
    await prisma.dadosFiscais.delete({ where: { id } })
    res.json({ ok: true })
  } catch (e) {
    console.error('DELETE /dados-fiscais/:id failed', e)
    res.status(500).json({ message: 'Erro ao remover dados fiscais', error: e?.message })
  }
})

function sanitize(body, companyId) {
  const toDecimal = (v) => (v === '' || v === null || v === undefined) ? null : parseFloat(v)
  return {
    companyId,
    descricao: String(body.descricao || '').trim(),
    ean: body.ean || null,
    codBeneficio: body.codBeneficio || null,
    codCredPresumido: body.codCredPresumido || null,
    percCredPresumido: toDecimal(body.percCredPresumido),
    ncm: body.ncm || null,
    orig: body.orig != null ? String(body.orig) : null,
    icmsPercBase: toDecimal(body.icmsPercBase) ?? 100,
    icmsAliq: toDecimal(body.icmsAliq) ?? 0,
    icmsModBC: body.icmsModBC != null ? String(body.icmsModBC) : null,
    icmsFCP: toDecimal(body.icmsFCP) ?? 0,
    icmsStPercBase: toDecimal(body.icmsStPercBase) ?? 100,
    icmsStAliq: toDecimal(body.icmsStAliq) ?? 0,
    icmsStModBCST: body.icmsStModBCST != null ? String(body.icmsStModBCST) : null,
    icmsStMVA: toDecimal(body.icmsStMVA) ?? 0,
    icmsStFCP: toDecimal(body.icmsStFCP) ?? 0,
    icmsEfetPercBase: toDecimal(body.icmsEfetPercBase),
    icmsEfetAliq: toDecimal(body.icmsEfetAliq),
    pPIS: toDecimal(body.pPIS) ?? 0,
    pCOFINS: toDecimal(body.pCOFINS) ?? 0,
    pIPI: toDecimal(body.pIPI) ?? 0,
    cfops: Array.isArray(body.cfops) ? JSON.stringify(body.cfops) : (body.cfops || null),
    cest: body.cest || null,
  }
}

export default router
