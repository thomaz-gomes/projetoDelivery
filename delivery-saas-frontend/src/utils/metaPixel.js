// src/utils/metaPixel.js
// Meta Pixel (Facebook) tracking utility for the public menu

let pixelConfig = null;
let pixelInitialized = false;

/**
 * Initialize the Meta Pixel with config from the public menu API.
 * @param {Object} config - { pixelId, trackPageView, trackViewContent, ... }
 */
export function initMetaPixel(config) {
  if (!config || !config.pixelId) return;
  pixelConfig = config;

  if (pixelInitialized) return;
  pixelInitialized = true;

  // Inject the Meta Pixel base code
  /* eslint-disable */
  !function(f,b,e,v,n,t,s){
    if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)
  }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */

  window.fbq('init', config.pixelId);

  // Fire PageView immediately if enabled
  if (config.trackPageView) {
    window.fbq('track', 'PageView');
  }
}

/**
 * Track a standard Meta Pixel event (only if the event type is enabled in config).
 * @param {string} eventName - Facebook standard event name (e.g. 'ViewContent', 'AddToCart')
 * @param {Object} [params] - Optional event parameters
 */
export function trackPixelEvent(eventName, params = {}) {
  if (!pixelConfig || !window.fbq) return;

  // Map event names to config flags
  const eventMap = {
    'PageView': 'trackPageView',
    'ViewContent': 'trackViewContent',
    'AddToCart': 'trackAddToCart',
    'InitiateCheckout': 'trackInitiateCheckout',
    'AddPaymentInfo': 'trackAddPaymentInfo',
    'Purchase': 'trackPurchase',
    'Search': 'trackSearch',
    'Lead': 'trackLead',
    'Contact': 'trackContact',
  };

  const configKey = eventMap[eventName];
  if (configKey && !pixelConfig[configKey]) return; // Event tracking disabled

  if (params && Object.keys(params).length > 0) {
    window.fbq('track', eventName, params);
  } else {
    window.fbq('track', eventName);
  }
}

/**
 * Track ViewContent event when a product is viewed.
 */
export function trackViewContent(product) {
  if (!product) return;
  trackPixelEvent('ViewContent', {
    content_name: product.name || '',
    content_ids: [product.id || ''],
    content_type: 'product',
    value: Number(product.price || 0),
    currency: 'BRL',
  });
}

/**
 * Track AddToCart event when item is added to cart.
 */
export function trackAddToCart(product, quantity = 1) {
  if (!product) return;
  const price = Number(product.price || 0);
  const optionsTotal = (product.options || []).reduce((sum, o) => sum + Number(o.price || 0), 0);
  trackPixelEvent('AddToCart', {
    content_name: product.name || '',
    content_ids: [product.productId || product.id || ''],
    content_type: 'product',
    value: (price + optionsTotal) * quantity,
    currency: 'BRL',
    num_items: quantity,
  });
}

/**
 * Track Search event when customer searches products.
 */
export function trackSearch(searchString) {
  if (!searchString) return;
  trackPixelEvent('Search', {
    search_string: searchString,
  });
}

/**
 * Track InitiateCheckout when customer starts the checkout flow.
 */
export function trackInitiateCheckout(cartItems, totalValue) {
  trackPixelEvent('InitiateCheckout', {
    content_ids: (cartItems || []).map(i => i.productId || i.id || ''),
    content_type: 'product',
    num_items: (cartItems || []).reduce((sum, i) => sum + (i.quantity || 1), 0),
    value: Number(totalValue || 0),
    currency: 'BRL',
  });
}

/**
 * Track AddPaymentInfo when customer selects payment method.
 */
export function trackAddPaymentInfo(methodName) {
  trackPixelEvent('AddPaymentInfo', {
    content_category: methodName || '',
  });
}

/**
 * Track Purchase when order is successfully placed.
 */
export function trackPurchase(orderId, totalValue, cartItems) {
  trackPixelEvent('Purchase', {
    content_ids: (cartItems || []).map(i => i.productId || i.id || ''),
    content_type: 'product',
    num_items: (cartItems || []).reduce((sum, i) => sum + (i.quantity || 1), 0),
    value: Number(totalValue || 0),
    currency: 'BRL',
    order_id: orderId || '',
  });
}

/**
 * Track Lead when customer registers or logs in.
 */
export function trackLead() {
  trackPixelEvent('Lead');
}

/**
 * Track Contact when customer clicks WhatsApp or phone.
 */
export function trackContact() {
  trackPixelEvent('Contact');
}
