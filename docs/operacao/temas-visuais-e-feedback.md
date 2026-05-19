# Temas Visuais e Feedback de IA

## Por que isso importa?
Quando você cria fotos de produto com IA no Studio IA, é comum:
- Imagens fugirem do estilo da sua marca.
- Cenários se repetirem com o tempo.
- Algumas imagens saírem com defeitos (ingredientes errados, deformações).

Os recursos abaixo permitem que a IA aprenda com seu gosto e respeite a identidade visual da loja.

## 1. Configurar um tema visual

Acesse **Marketing → Temas Visuais** e clique em **Novo tema**.

Preencha:
- **Nome**: como você vai chamar este tema (ex.: "Almoço Rústico").
- **Aplicar a**: "Todas as lojas" ou uma loja específica.
- **Paleta de cores**: livre. Ex.: "tons quentes, dourado, madeira escura".
- **Mood / atmosfera**: "aconchegante, caseiro" / "urbano, noturno".
- **Superfície**: "balcão de madeira escura", "mármore claro".
- **Iluminação**: "luz amarela quente", "luz natural difusa".
- **Props / objetos**: "tábua de madeira, papel kraft, cerveja artesanal".
- **Marcar como padrão**: usado quando nenhum outro tema se aplica.

Preencha pelo menos 1 campo visual. Não precisa preencher todos — quanto mais detalhe, mais consistente.

Você pode ter vários temas (ex.: um para almoço, outro para noite/pub).

## 2. Gerar fotos usando um tema

No **Studio IA → Pack Social**:
1. Faça upload da foto do produto.
2. Escolha quantidade e formato.
3. No campo **Tema visual da marca**, escolha o tema desejado (ou "Sem tema" para gerar genérico).
4. Clique em **Gerar pack**.

A IA vai aplicar o tema ao fundo, superfície, iluminação e props — **a comida não muda**.

## 3. Dar feedback nas imagens

Em qualquer imagem gerada pela IA (badge "IA"), passe o mouse e use:

- **👍 (curtir)**: marca a imagem como referência positiva. Clique de novo para desmarcar.
- **👎 (rejeitar)**: abre um menu com motivos:
  - **Comida deformada / ingredientes errados** — IA mudou o produto.
  - **Cenário repetitivo / sem graça** — falta de variedade.
  - **Não combina com a marca da loja** — fora do estilo desejado.
  - **Cor / textura / iluminação ruim** — visual técnico errado.
  - **Outro motivo** — explique no campo de observação.

Quanto mais feedback, melhor a IA aprende seu gosto.

## 4. Atualizar as lições aprendidas

No **Studio IA → Pack Social**, role até o card **"Lições aprendidas pela IA"**.

Clique em **Atualizar agora** quando:
- Você acabou de dar muitos feedbacks novos.
- Faz mais de 1-2 semanas desde a última atualização.

A IA vai analisar os feedbacks (LIKED, deformações, repetições, etc.) dos últimos 90 dias e gerar um resumo de 5 lições. Essas lições passam a ser injetadas nos próximos `Gerar pack`.

Se aparecer "Sem feedback nos últimos 90 dias", dê feedback em algumas imagens primeiro.

## O que NÃO esperar

- **Imagens antigas não mudam.** Feedback só afeta as próximas gerações.
- **Tema não funciona retroativamente.** Imagens já geradas mantêm seu próprio estilo.
- **A IA não é determinística.** Mesmo com tema, cada chamada gera algo diferente.
- **Lições não são editáveis manualmente.** São o resumo bruto da IA — mantém o sinal puro do feedback.

## Onde encontrar mais informações

- Design técnico: `docs/plans/2026-05-18-ai-image-feedback-design.md`
- Plano de implementação: `docs/plans/2026-05-18-ai-image-feedback-plan.md`
