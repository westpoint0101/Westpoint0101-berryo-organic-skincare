const config = window.BERRYO_SUPABASE_CONFIG;

const failStorefront = (message) => {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<main style="max-width:640px;margin:12vh auto;padding:32px;font:16px/1.6 system-ui;color:#30251f"><h1 style="font-family:Georgia,serif">Store temporarily unavailable</h1><p>${String(message).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])}</p><p>Please try again shortly or contact BERRYO customer care.</p></main>`;
  }
  console.error('BERRYO storefront data could not be loaded.', message);
};

const fetchPublicData = async (path) => {
  const response = await fetch(new URL(path, config.url), {
    headers: { apikey: config.anonKey },
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const message = data?.message || `Store data request failed (${response.status}).`;
    const error = new Error(message);
    error.code = data?.code;
    throw error;
  }
  return data;
};

const socialUrl = (network, value) => {
  const handle = String(value || '').trim();
  if (!handle) return '';
  if (/^https:\/\//i.test(handle)) return handle;
  return `https://${network}/${encodeURIComponent(handle.replace(/^@/, ''))}`;
};

const mountCatalogPreview = async (reason) => {
  let catalog = window.BERRYO_CATALOG;
  try {
    const cachedCatalog = JSON.parse(localStorage.getItem('berryo-products') || 'null');
    if (Array.isArray(cachedCatalog) && cachedCatalog.length) catalog = cachedCatalog;
  } catch (error) {
    console.error('Cached BERRYO catalog could not be read.', error);
  }
  if (!Array.isArray(catalog) || !catalog.length) throw reason;
  window.BERRYO_CATALOG = catalog;

  const content = {
    payment: {
      method: 'moniepoint_transfer',
      bank_name: 'Moniepoint',
      account_name: 'BERRY0-ORGANICSKINCARE ENTERPRISE',
      account_number: '8034226547',
    },
  };
  window.BERRYO_STORE_CONTENT = content;
  window.BERRYO_STORE_WARNING = 'Store preview: Supabase is missing the store tables, so cached catalog data is shown. Orders and payment receipts cannot be saved online right now; contact BERRYO on WhatsApp to order.';
  console.error('BERRYO is showing its bundled catalog because Supabase store tables are unavailable.', reason);

  await import('./assets/index-3b23d65d.js');

  const showWarning = () => {
    const app = document.querySelector('.berryo-app');
    if (!app || app.querySelector('.berryo-store-warning')) return;
    const banner = document.createElement('aside');
    banner.className = 'berryo-store-warning';
    banner.setAttribute('role', 'alert');
    banner.textContent = window.BERRYO_STORE_WARNING;
    const header = app.querySelector('.topbar');
    if (header) header.insertAdjacentElement('afterend', banner);
    else app.prepend(banner);
  };
  const observer = new MutationObserver(showWarning);
  observer.observe(document.body, { childList: true, subtree: true });
  showWarning();
};

const startStorefront = async () => {
  if (!config?.url || !config?.anonKey) throw new Error('Store configuration is missing.');
  const [products, settingsRows] = await Promise.all([
    fetchPublicData('/rest/v1/products?select=slug,name,category,description,ingredients,benefits,image_url,price_ngn,price_usd,size,sku,inventory_count,is_active,featured,bestseller,new_arrival&is_active=eq.true&order=name.asc&limit=1000'),
    fetchPublicData('/rest/v1/store_settings?select=content&id=eq.1'),
  ]);

  if (!Array.isArray(products) || !products.length || !Array.isArray(settingsRows) || !settingsRows.length) {
    const error = new Error('The live product catalog or website settings are not installed yet.');
    error.code = 'STORE_SCHEMA_NOT_READY';
    throw error;
  }

  const catalog = products.map((product) => ({
    id: product.slug,
    name: product.name,
    category: product.category,
    size: product.size || '',
    price: Number(product.price_ngn) || 0,
    usdPrice: Number(product.price_usd) || 0,
    image: product.image_url || '',
    rating: 0,
    reviews: 0,
    stock: Number(product.inventory_count) > 0 ? 'In Stock' : 'Out of Stock',
    sku: product.sku || product.slug,
    featured: Boolean(product.featured),
    bestseller: Boolean(product.bestseller),
    newArrival: Boolean(product.new_arrival),
    description: product.description || '',
    benefits: Array.isArray(product.benefits) ? product.benefits : [],
    ingredients: product.ingredients || '',
    inventoryCount: Number(product.inventory_count) || 0,
  }));

  const content = settingsRows[0].content || {};
  const previousSettings = JSON.parse(localStorage.getItem('berryo-site-settings') || '{}');
  const storefrontSettings = {
    ...previousSettings,
    businessName: content.contact?.business_name ?? previousSettings.businessName,
    heroHeadline: content.homepage?.banner_title ?? previousSettings.heroHeadline,
    heroText: content.homepage?.banner_text ?? previousSettings.heroText,
    email: content.contact?.email ?? previousSettings.email,
    phone: content.contact?.phone ?? previousSettings.phone,
    phoneAlt: content.contact?.phone_alt ?? previousSettings.phoneAlt,
    address: content.contact?.address ?? previousSettings.address,
    facebook: content.social?.facebook ?? previousSettings.facebook,
    instagram: content.social?.instagram ?? previousSettings.instagram,
    wholesaleInstagram: content.social?.wholesale_instagram ?? previousSettings.wholesaleInstagram,
  };

  localStorage.setItem('berryo-products', JSON.stringify(catalog));
  localStorage.setItem('berryo-site-settings', JSON.stringify(storefrontSettings));
  if (content.shipping) {
    localStorage.setItem('berryo-shipping-settings', JSON.stringify({
      deliveryFeeNGN: Number(content.shipping.fee_ngn) || 0,
      deliveryFeeUSD: 2,
      deliveryInformation: content.shipping.information || '',
    }));
  }
  window.BERRYO_CATALOG = catalog;
  window.BERRYO_STORE_CONTENT = content;

  await import('./assets/index-3b23d65d.js');

  const updatePublishedContent = () => {
    const announcement = String(content.homepage?.announcement || '').trim();
    const app = document.querySelector('.berryo-app');
    if (app && announcement) {
      let banner = app.querySelector('.berryo-live-announcement');
      if (!banner) {
        banner = document.createElement('aside');
        banner.className = 'berryo-live-announcement';
        banner.setAttribute('role', 'status');
        const header = app.querySelector('.topbar');
        header?.insertAdjacentElement('afterend', banner);
      }
      if (banner.textContent !== announcement) banner.textContent = announcement;
    } else {
      app?.querySelector('.berryo-live-announcement')?.remove();
    }

    const about = document.querySelector('#about-us .promise-copy');
    if (about) {
      const heading = about.querySelector('h3');
      const paragraphs = about.querySelectorAll('p:not(.eyebrow)');
      if (heading && content.about?.heading && heading.textContent !== content.about.heading) heading.textContent = content.about.heading;
      if (paragraphs.length && content.about?.text && paragraphs[0].textContent !== content.about.text) paragraphs[0].textContent = content.about.text;
      for (let index = 1; index < paragraphs.length; index += 1) paragraphs[index].hidden = true;
    }
    const heroImage = document.querySelector('.hero-visual img');
    if (heroImage && content.homepage?.banner_image_url
      && heroImage.getAttribute('src') !== content.homepage.banner_image_url) {
      heroImage.setAttribute('src', content.homepage.banner_image_url);
    }

    const socialLinks = document.querySelectorAll('#contact .contact-list a');
    const destinations = [
      socialUrl('facebook.com', content.social?.facebook),
      socialUrl('instagram.com', content.social?.instagram),
      socialUrl('instagram.com', content.social?.wholesale_instagram),
    ];
    socialLinks.forEach((link) => {
      if (link.textContent.startsWith('Facebook:') && destinations[0] && link.getAttribute('href') !== destinations[0]) link.href = destinations[0];
      if (link.textContent.startsWith('Instagram:') && destinations[1] && link.getAttribute('href') !== destinations[1]) link.href = destinations[1];
      if (link.textContent.startsWith('Wholesale Instagram:') && destinations[2] && link.getAttribute('href') !== destinations[2]) link.href = destinations[2];
    });
    const contactList = document.querySelector('#contact .contact-list');
    const tiktokUrl = socialUrl('tiktok.com', content.social?.tiktok);
    if (contactList && tiktokUrl && !contactList.querySelector('.berryo-tiktok-link')) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'berryo-tiktok-link';
      link.href = tiktokUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = 'TikTok: ' + content.social.tiktok;
      item.appendChild(link);
      contactList.appendChild(item);
    } else if (!tiktokUrl) {
      contactList?.querySelector('.berryo-tiktok-link')?.closest('li')?.remove();
    }
  };

  const observer = new MutationObserver(updatePublishedContent);
  observer.observe(document.body, { childList: true, subtree: true });
  updatePublishedContent();
};

startStorefront().catch(async (error) => {
  if (['PGRST204', 'PGRST205', 'STORE_SCHEMA_NOT_READY'].includes(error.code)) {
    try {
      await mountCatalogPreview(error);
      return;
    } catch (previewError) {
      error = previewError;
    }
  }
  failStorefront(error.message || 'Could not connect to the live store catalog.');
});
