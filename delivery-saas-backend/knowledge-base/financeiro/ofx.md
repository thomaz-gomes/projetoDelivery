# Conciliacao Bancaria (OFX)

## O que e
A conciliacao OFX permite importar o extrato do seu banco para dentro do sistema e comparar automaticamente com os lancamentos financeiros ja cadastrados. Isso ajuda a garantir que tudo que aparece no banco esta registrado no sistema, evitando erros e esquecimentos.

## Como acessar
Menu lateral → Financeiro → Conciliacao OFX

## Como usar

### Importar arquivo OFX
1. Selecione a **Conta Bancaria** que corresponde ao extrato.
2. Clique em **Arquivo OFX** e escolha o arquivo baixado do seu banco (extensao .ofx).
3. Clique em **Importar**.
4. O sistema vai processar o arquivo e tentar conciliar automaticamente as transacoes do extrato com os lancamentos cadastrados.

### Entender os resultados da importacao
Apos a importacao, o sistema mostra:
- **Conciliados (exato)**: transacoes que bateram perfeitamente com lancamentos do sistema.
- **Conciliados (IA)**: transacoes que a inteligencia artificial associou automaticamente com alta confianca.
- **Sugestoes para revisar**: associacoes sugeridas pela IA que precisam da sua confirmacao.
- **Sem correspondencia**: transacoes do extrato que nao tem lancamento correspondente no sistema.

### Revisar sugestoes da IA
1. Clique em **Ver itens** na importacao.
2. Na secao de sugestoes, cada item mostra a transacao do extrato, o lancamento sugerido e o nivel de confianca.
3. Clique em **Confirmar** para aceitar a sugestao ou **Rejeitar** para descartar.

### Re-conciliar com IA
Se voce cadastrou novos lancamentos apos a importacao, clique em **Re-conciliar com IA** para tentar novas associacoes.

### Ignorar transacoes
Para transacoes do extrato que nao precisam de lancamento (como transferencias entre contas proprias), clique em **Ignorar**.

## Duvidas frequentes

**Onde consigo o arquivo OFX?**
No internet banking do seu banco. Procure por "exportar extrato" ou "baixar OFX" na area de extratos.

**A IA pode errar na conciliacao?**
Sim, por isso as sugestoes com menor confianca sao separadas para voce revisar manualmente antes de confirmar.

**Posso importar o mesmo periodo mais de uma vez?**
Sim. O sistema identifica transacoes ja importadas pelo codigo FITID do banco e evita duplicacoes.
