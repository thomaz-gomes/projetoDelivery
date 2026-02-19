Coloque aqui o instalador gerado pelo electron-builder:

  delivery-print-agent-setup.exe

Como gerar:
  cd delivery-print-agent-electron
  npm install
  npm run build
  # Copia o arquivo de dist/ para cá:
  copy "dist\Delivery Print Agent Setup 2.0.0.exe" ..\delivery-saas-backend\downloads\delivery-print-agent-setup.exe

O arquivo será servido em:
  https://<seu-servidor>/downloads/delivery-print-agent-setup.exe
