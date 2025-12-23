// Minimal QZ Tray stub for local development.
// This file emulates the small subset of the QZ API the frontend uses.
// It is intentionally simple and only meant for dev when the real QZ Tray
// app/webserver is not available on localhost:8181.
(function(){
  if (typeof window === 'undefined') return;
  if (window.qz) return; // don't overwrite real QZ

  const qz = {
    websocket: {
      connect: function(){
        console.log('[qz-stub] websocket.connect called (stubbed)');
        return Promise.resolve(true);
      }
    },
    printers: {
      // returns a Promise resolving to an array of printer names
      find: function(){
        return Promise.resolve(['Mock Printer', 'Network POS Printer']);
      }
    },
    configs: {
      create: function(printerName){ return { printer: printerName || '' }; }
    },
    api: {
      print: function(config, data){
        try {
          console.log('[qz-stub] print called with config=', config, 'data=', data);
          if (Array.isArray(data) && data.length && data[0].type === 'html'){
            const html = data[0].data || '';
            const w = window.open('', '_blank');
            if (w){ w.document.open(); w.document.write(html); w.document.close(); return Promise.resolve(true); }
          }
        } catch (e) { console.warn('[qz-stub] print error', e); }
        return Promise.resolve(true);
      }
    }
  };

  window.qz = qz;
  console.log('[qz-stub] qz-tray.js stub loaded');
})();
