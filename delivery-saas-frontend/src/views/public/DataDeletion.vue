<template>
  <div class="bg-light min-vh-100 py-5">
    <div class="container" style="max-width: 760px">
      <div class="card shadow-sm">
        <div class="card-body p-4 p-md-5">
          <h1 class="h3 mb-1">Exclusão de Dados</h1>
          <p class="text-muted small mb-4">Última atualização: {{ updatedAt }}</p>

          <p>
            Esta página descreve como solicitar a exclusão dos dados pessoais que
            tratamos sobre você. Cumpre as exigências de transparência da Meta
            (Facebook, Instagram, WhatsApp) e da LGPD.
          </p>

          <h2 class="h5 mt-4 mb-2">Quais dados tratamos via integração Meta</h2>
          <ul>
            <li>Identificador da conta no canal (PSID do Facebook, IGSID do Instagram ou número do WhatsApp)</li>
            <li>Nome do perfil público quando disponível</li>
            <li>Conteúdo das mensagens trocadas com o estabelecimento (texto, mídia, localização)</li>
            <li>Metadados de entrega/leitura</li>
          </ul>

          <h2 class="h5 mt-4 mb-2">Como solicitar a exclusão</h2>
          <p class="mb-2">
            Envie um e-mail para <a :href="`mailto:${supportEmail}?subject=Solicitação de exclusão de dados`"><strong>{{ supportEmail }}</strong></a>
            com o assunto <em>"Solicitação de exclusão de dados"</em> e inclua:
          </p>
          <ul>
            <li>Seu nome completo</li>
            <li>Canal (WhatsApp, Facebook Messenger ou Instagram Direct)</li>
            <li>Identificador usado para falar com o estabelecimento (telefone, usuário do Facebook ou Instagram)</li>
            <li>Nome do estabelecimento com quem você interagiu (se souber)</li>
          </ul>

          <h2 class="h5 mt-4 mb-2">Prazo</h2>
          <p>
            Confirmaremos o recebimento em até <strong>2 dias úteis</strong> e
            concluiremos a exclusão em até <strong>30 dias corridos</strong>,
            conforme exige a LGPD (Art. 18, VI). Caso a lei nos obrigue a manter
            algum dado (ex.: registros fiscais e logs de transação), informaremos
            quais dados, por quanto tempo e a base legal aplicável.
          </p>

          <h2 class="h5 mt-4 mb-2">Revogar acesso direto no Facebook</h2>
          <p>
            Você também pode remover este aplicativo das suas integrações no
            Facebook a qualquer momento em
            <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noopener">
              Configurações &gt; Apps e Sites &gt; Business Integrations
            </a>.
            A remoção interrompe novos envios; para apagar dados anteriores,
            envie a solicitação por e-mail como descrito acima.
          </p>

          <hr class="my-4" />
          <p class="text-muted small mb-0">
            Em caso de dúvidas sobre privacidade, fale com nosso encarregado de dados (DPO)
            pelo mesmo e-mail acima.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const supportEmail = computed(() => import.meta.env.VITE_SUPPORT_EMAIL || 'privacidade@deliverywl.com.br')
const updatedAt = computed(() => {
  const d = new Date()
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
})
</script>
