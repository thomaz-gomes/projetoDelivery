// Pre-definições para campos de BrandVisualTheme. Single-select por campo.
// `value` é a string enviada ao backend (vai parar no prompt da IA — em PT-BR
// resumido); `label` é o texto exibido ao operador.

export const PALETTE_PRESETS = [
  { value: 'tons quentes, dourado, âmbar', label: 'Tons quentes (dourado, âmbar)' },
  { value: 'tons frios, azul, cinza', label: 'Tons frios (azul, cinza)' },
  { value: 'tons terrosos, marrom, ocre', label: 'Terroso (marrom, ocre)' },
  { value: 'paleta pastel, cores suaves', label: 'Pastel (cores suaves)' },
  { value: 'cores vibrantes e saturadas', label: 'Vibrante (cores saturadas)' },
  { value: 'monocromático, profundidade em uma cor só', label: 'Monocromático' },
  { value: 'alto contraste preto e branco', label: 'Preto e branco / alto contraste' },
  { value: 'tons neutros, bege e creme', label: 'Neutros (bege, creme)' },
]

export const MOOD_PRESETS = [
  { value: 'rústico, caseiro, acolhedor', label: 'Rústico / caseiro' },
  { value: 'aconchegante, quente, convidativo', label: 'Aconchegante' },
  { value: 'urbano, industrial, cru', label: 'Urbano / industrial' },
  { value: 'minimalista, limpo, espaço em branco', label: 'Minimalista' },
  { value: 'elegante, sofisticado, refinado', label: 'Elegante / sofisticado' },
  { value: 'tropical, fresco, natural', label: 'Tropical / natural' },
  { value: 'festivo, animado, vibrante', label: 'Festivo / vibrante' },
  { value: 'sereno, calmo, zen', label: 'Sereno / zen' },
  { value: 'noturno, pub, ambiente baixo', label: 'Noturno / pub' },
]

export const SURFACE_PRESETS = [
  { value: 'tábua de madeira escura', label: 'Madeira escura' },
  { value: 'tábua de madeira clara', label: 'Madeira clara' },
  { value: 'mármore branco', label: 'Mármore branco' },
  { value: 'mármore escuro', label: 'Mármore escuro' },
  { value: 'ardósia preta', label: 'Ardósia preta' },
  { value: 'concreto / cimento queimado', label: 'Concreto / cimento queimado' },
  { value: 'pano de linho ou algodão', label: 'Pano (linho / algodão)' },
  { value: 'bandeja de metal escovado', label: 'Bandeja de metal' },
  { value: 'cesto de palha', label: 'Cesto de palha' },
  { value: 'papel kraft', label: 'Papel kraft' },
]

export const LIGHTING_PRESETS = [
  { value: 'luz amarela quente, pendente tungstênio', label: 'Amarela quente (tungstênio)' },
  { value: 'luz natural difusa de janela', label: 'Natural difusa (janela)' },
  { value: 'luz dramática lateral, sombras marcadas', label: 'Dramática lateral' },
  { value: 'luz suave difusa, sem sombras fortes', label: 'Suave difusa' },
  { value: 'luz neon, urbana, noturna', label: 'Neon / urbana' },
  { value: 'velas, luz baixa, atmosférica', label: 'Velas / luz baixa' },
  { value: 'backlight com efeito halo', label: 'Backlight (halo)' },
  { value: 'luz dourada de hora dourada', label: 'Hora dourada' },
]

export const PROPS_PRESETS = [
  { value: 'sem props, somente o produto', label: 'Sem props (só o produto)' },
  { value: 'talheres rústicos de madeira', label: 'Talheres rústicos' },
  { value: 'papel kraft e cesto de batata', label: 'Papel kraft + cesto' },
  { value: 'ervas frescas (manjericão, alecrim)', label: 'Ervas frescas' },
  { value: 'especiarias e grãos espalhados', label: 'Especiarias e grãos' },
  { value: 'garrafa de cerveja artesanal e copo', label: 'Cerveja artesanal' },
  { value: 'taça de vinho e tábua de queijos', label: 'Vinho e queijos' },
  { value: 'frutas cítricas (limão, laranja)', label: 'Frutas cítricas' },
  { value: 'flores frescas pequenas', label: 'Flores frescas' },
  { value: 'guardanapo de tecido bagunçado', label: 'Guardanapo de tecido' },
]
