Arquivos esperados nesta pasta:

  icon.ico       - Ícone do aplicativo (ICO multi-size 16/32/48/64/128/256)
                   Usado pelas BrowserWindow (main.js) e pelo instalador NSIS
                   (package.json build.win.icon + nsis.installerIcon).
  icon.png       - Versão PNG 512x512 do mesmo ícone (referência/fallback).
  tray-green.png - Ícone da bandeja: conectado  (16x16 PNG) [opcional]
  tray-red.png   - Ícone da bandeja: desconectado (16x16 PNG) [opcional]
  tray-yellow.png - Ícone da bandeja: conectando (16x16 PNG) [opcional]

Para regenerar icon.ico a partir de um PNG (ImageMagick):
  magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico

Se os arquivos de bandeja não existirem, o agente funciona normalmente,
apenas sem ícone colorido na System Tray.
