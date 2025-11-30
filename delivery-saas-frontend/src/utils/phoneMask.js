/**
 * Aplica máscara de telefone brasileiro (10 ou 11 dígitos)
 * Formato: (00) 0000-0000 ou (00) 0 0000-0000
 * @param {string} value - valor a ser formatado
 * @returns {string} - valor formatado
 */
export function applyPhoneMask(value) {
  if (!value) return ''
  
  // Remove tudo que não é número
  const numbers = String(value).replace(/\D/g, '')
  
  // Limita a 11 dígitos
  const limited = numbers.slice(0, 11)
  
  if (limited.length === 0) return ''
  
  // Aplica máscara conforme o tamanho
  if (limited.length <= 2) {
    return `(${limited}`
  } else if (limited.length <= 6) {
    return `(${limited.slice(0, 2)}) ${limited.slice(2)}`
  } else if (limited.length <= 10) {
    // (00) 0000-0000
    return `(${limited.slice(0, 2)}) ${limited.slice(2, 6)}-${limited.slice(6)}`
  } else {
    // (00) 0 0000-0000
    return `(${limited.slice(0, 2)}) ${limited.slice(2, 3)} ${limited.slice(3, 7)}-${limited.slice(7, 11)}`
  }
}

/**
 * Remove máscara do telefone, retornando apenas números
 * @param {string} value - valor com máscara
 * @returns {string} - apenas números
 */
export function removePhoneMask(value) {
  if (!value) return ''
  return String(value).replace(/\D/g, '')
}
