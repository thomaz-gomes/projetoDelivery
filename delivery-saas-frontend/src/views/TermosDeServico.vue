<template>
  <div class="terms-page">
    <div class="container py-5">
      <div class="card border-0 shadow-sm">
        <div class="card-body p-4 p-md-5">
          <div class="text-center mb-4">
            <img src="/core.png" alt="Logo" class="logo mb-3" style="height:48px">
            <h2 class="fw-bold">Termos de Servico</h2>
            <p class="text-muted">Ultima atualizacao: 20 de marco de 2026</p>
          </div>

          <div class="terms-content">
            <h5>1. Aceitacao dos Termos</h5>
            <p>
              Ao acessar ou utilizar a plataforma Core Menu ("Plataforma"), voce concorda em cumprir
              e estar vinculado a estes Termos de Servico. Caso nao concorde com qualquer parte destes
              termos, voce nao devera utilizar a Plataforma.
            </p>

            <h5>2. Descricao do Servico</h5>
            <p>
              A Core Menu e uma plataforma SaaS (Software como Servico) que oferece solucoes para
              restaurantes e estabelecimentos alimenticios, incluindo:
            </p>
            <ul>
              <li>Criacao e gerenciamento de cardapios digitais</li>
              <li>Otimizacao de fotos de produtos com inteligencia artificial</li>
              <li>Gestao de pedidos e delivery</li>
              <li>Sistema de impressao de recibos</li>
              <li>Gestao de entregadores</li>
              <li>Integracao com plataformas de pagamento</li>
              <li>Modulos complementares (estoque, financeiro, fiscal, cashback, cupons, afiliados)</li>
            </ul>

            <h5>3. Cadastro e Conta</h5>
            <p>
              Para utilizar a Plataforma, voce devera criar uma conta fornecendo informacoes verdadeiras,
              completas e atualizadas. Voce e responsavel por manter a confidencialidade de suas
              credenciais de acesso (e-mail e senha) e por todas as atividades realizadas em sua conta.
            </p>
            <p>
              Voce se compromete a notificar imediatamente a Core Menu sobre qualquer uso nao autorizado
              de sua conta ou qualquer outra violacao de seguranca.
            </p>

            <h5>4. Planos e Pagamento</h5>
            <p>
              A Plataforma oferece planos de assinatura com diferentes funcionalidades e precos.
              Os valores e condicoes de pagamento estao descritos na pagina de planos e podem ser
              alterados mediante aviso previo de 30 (trinta) dias.
            </p>
            <p>
              O pagamento e realizado de forma antecipada, conforme o ciclo de cobranca escolhido
              (mensal ou anual). A falta de pagamento pode resultar na suspensao ou cancelamento
              do acesso aos servicos.
            </p>

            <h5>5. Uso Aceitavel</h5>
            <p>Voce concorda em nao:</p>
            <ul>
              <li>Utilizar a Plataforma para fins ilegais ou nao autorizados</li>
              <li>Transmitir virus, malware ou qualquer codigo de natureza destrutiva</li>
              <li>Tentar acessar areas restritas da Plataforma sem autorizacao</li>
              <li>Reproduzir, duplicar, copiar ou revender qualquer parte do servico</li>
              <li>Utilizar a Plataforma de forma que possa danifica-la, desabilita-la ou sobrecarrega-la</li>
            </ul>

            <h5>6. Propriedade Intelectual</h5>
            <p>
              Todo o conteudo da Plataforma, incluindo textos, graficos, logos, icones, imagens,
              software e codigo-fonte, e protegido por direitos autorais e pertence a Core Menu
              ou seus licenciadores.
            </p>
            <p>
              O conteudo enviado por voce (fotos de produtos, dados do cardapio, etc.) permanece
              de sua propriedade. Ao utilizar a Plataforma, voce concede a Core Menu uma licenca
              limitada para processar, armazenar e exibir esse conteudo conforme necessario para
              a prestacao do servico.
            </p>

            <h5>7. Disponibilidade do Servico</h5>
            <p>
              A Core Menu se empenha em manter a Plataforma disponivel 24 horas por dia, 7 dias
              por semana. No entanto, o servico pode ser temporariamente interrompido para manutencao,
              atualizacoes ou por circunstancias fora de nosso controle. Nao garantimos que o servico
              sera ininterrupto ou livre de erros.
            </p>

            <h5>8. Limitacao de Responsabilidade</h5>
            <p>
              A Core Menu nao sera responsavel por danos indiretos, incidentais, especiais ou
              consequenciais decorrentes do uso ou da impossibilidade de uso da Plataforma,
              incluindo perda de lucros, dados ou oportunidades de negocio.
            </p>
            <p>
              A responsabilidade total da Core Menu, em qualquer caso, sera limitada ao valor
              pago por voce nos ultimos 12 (doze) meses de assinatura.
            </p>

            <h5>9. Cancelamento</h5>
            <p>
              Voce pode cancelar sua assinatura a qualquer momento atraves da Plataforma.
              O cancelamento entrara em vigor ao final do periodo de cobranca vigente. Nao ha
              reembolso proporcional para periodos parciais de uso.
            </p>
            <p>
              A Core Menu reserva-se o direito de suspender ou encerrar sua conta em caso de
              violacao destes Termos, mediante notificacao previa quando possivel.
            </p>

            <h5>10. Alteracoes nos Termos</h5>
            <p>
              A Core Menu pode atualizar estes Termos de Servico periodicamente. Alteracoes
              significativas serao comunicadas por e-mail ou aviso na Plataforma com pelo menos
              15 (quinze) dias de antecedencia. O uso continuado da Plataforma apos as alteracoes
              constitui aceitacao dos novos termos.
            </p>

            <h5>11. Legislacao Aplicavel</h5>
            <p>
              Estes Termos sao regidos pelas leis da Republica Federativa do Brasil.
              Qualquer disputa sera resolvida no foro da comarca de Salvador, Estado da Bahia,
              com exclusao de qualquer outro, por mais privilegiado que seja.
            </p>

            <h5>12. Contato</h5>
            <p>
              Em caso de duvidas sobre estes Termos de Servico, entre em contato conosco
              atraves do e-mail disponivel na Plataforma.
            </p>
          </div>

          <div class="text-center mt-4">
            <router-link to="/register" class="btn btn-outline-secondary">
              Voltar ao Cadastro
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.terms-page {
  background: #f8f9fa;
  min-height: 100vh;
}
.terms-content h5 {
  font-weight: 700;
  color: #212529;
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
}
.terms-content p,
.terms-content ul {
  color: #495057;
  line-height: 1.7;
  font-size: 0.95rem;
}
.terms-content ul {
  padding-left: 1.5rem;
}
.terms-content ul li {
  margin-bottom: 0.35rem;
}
.logo {
  height: 48px;
}
</style>
