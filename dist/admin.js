(() => {
  'use strict';

  const config = window.BERRYO_SUPABASE_CONFIG;
  const sessionKey = 'berryo-customer-session';
  const bucket = 'product-images';
  const statusOptions = [
    ['awaiting_payment', 'Pending payment'],
    ['paid', 'Paid'],
    ['processing', 'Processing'],
    ['shipped', 'Shipped'],
    ['delivered', 'Delivered'],
    ['cancelled', 'Cancelled'],
  ];
  const state = {
    token: '',
    user: null,
    view: 'overview',
    products: [],
    orders: [],
    customers: [],
    settings: null,
    search: '',
    statusFilter: 'all',
    customerOrdersFor: '',
    orderItems: new Map(),
  };

  const byId = (id) => document.getElementById(id);
  const root = byId('view');
  const dialog = byId('product-dialog');
  let noticeTimer;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);

  const safeImageUrl = (value) => {
    const url = String(value || '');
    if (/^https:\/\//i.test(url) || /^\.{0,2}\//.test(url)) return url;
    return '';
  };

  const money = (value) => `₦${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(Number(value) || 0)}`;
  const shortDate = (value) => value ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(new Date(value)) : '—';
  const longDate = (value) => value ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

  const showNotice = (message, type = 'success') => {
    const notice = byId('notice');
    notice.textContent = message;
    notice.className = `notice ${type}`;
    notice.hidden = false;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 6000);
  };

  const readSession = () => {
    try {
      return JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
    } catch (error) {
      console.error('Customer session could not be read.', error);
      return null;
    }
  };

  const api = async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    headers.set('apikey', config.anonKey);
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (typeof options.body === 'string') headers.set('Content-Type', 'application/json');
    const response = await fetch(new URL(path, config.url), { ...options, headers });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) {
      const message = data?.message || data?.msg || data?.hint || `Supabase request failed (${response.status}).`;
      throw new Error(message);
    }
    return { data, response };
  };

  const requireSession = async () => {
    if (!config?.url || !config?.anonKey) throw new Error('Supabase is not configured for this storefront.');
    const session = readSession();
    if (!session?.accessToken || Number(session.expiresAt) <= Date.now()) {
      location.replace('./index.html');
      throw new Error('Sign in to your verified store-admin account, then open the admin dashboard again.');
    }
    state.token = session.accessToken;
    const { data: user } = await api('/auth/v1/user');
    if (!user?.id) throw new Error('Supabase did not return a signed-in account.');
    state.user = user;
    const query = new URLSearchParams({ select: 'is_admin', id: `eq.${user.id}` });
    const { data: profiles } = await api(`/rest/v1/profiles?${query}`);
    if (!Array.isArray(profiles) || profiles.length !== 1 || profiles[0].is_admin !== true) {
      throw new Error('This verified account does not have store-admin access. Apply supabase-admin-console-setup.sql in the connected Supabase project.');
    }
    const fullName = user.user_metadata?.full_name || user.email || 'Store admin';
    byId('admin-name').textContent = fullName;
    byId('admin-email').textContent = user.email || '';
    byId('avatar').textContent = String(fullName).trim().charAt(0).toUpperCase() || 'B';
  };

  const loadData = async () => {
    const { data: products } = await api('/rest/v1/products?select=*&order=name.asc&limit=1000');
    const { data: orders } = await api('/rest/v1/orders?select=*&order=created_at.desc&limit=1000');
    const { data: customers } = await api('/rest/v1/rpc/admin_list_customers', {
      method: 'POST',
      body: '{}',
    });
    const { data: settingsRows } = await api('/rest/v1/store_settings?select=content,updated_at&id=eq.1');
    if (!Array.isArray(products) || !Array.isArray(orders) || !Array.isArray(customers)) {
      throw new Error('Supabase returned unexpected data. Check that the admin-console SQL setup completed successfully.');
    }
    state.products = products;
    state.orders = orders;
    state.customers = customers;
    state.settings = settingsRows?.[0]?.content || {};
    const lowStock = products.filter((product) =>
      product.is_active && Number(product.inventory_count) <= Number(product.low_stock_threshold ?? 5));
    const counter = byId('low-stock-count');
    counter.textContent = String(lowStock.length);
    counter.hidden = lowStock.length === 0;
  };

  const closeSidebar = () => {
    byId('sidebar').classList.remove('open');
    byId('scrim').classList.remove('visible');
  };

  const setView = (view) => {
    state.view = view;
    state.search = '';
    byId('global-search').value = '';
    document.querySelectorAll('.nav-item').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    const labels = { overview: 'Overview', products: 'Products', orders: 'Orders', customers: 'Customers', content: 'Website content', settings: 'Settings' };
    byId('current-section').textContent = labels[view] || 'Overview';
    closeSidebar();
    render();
  };

  const pageHeading = (eyebrow, title, subtitle, action = '') => `
    <div class="page-heading">
      <div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1>
      <p class="subheading">${escapeHtml(subtitle)}</p></div>${action}
    </div>`;

  const sectionPanel = (title, subtitle, content, action = '') => `
    <section class="panel">
      <div class="panel-heading"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>${action}</div>
      ${content}
    </section>`;

  const statusLabel = (status) => ({
    awaiting_payment: 'Pending payment',
    pending: 'Pending payment',
    submitted: 'Proof submitted',
    paid: 'Paid',
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  })[status] || status || '—';

  const statusBadge = (status) => {
    const color = ['paid', 'delivered'].includes(status) ? 'good'
      : ['awaiting_payment', 'pending', 'submitted', 'processing', 'shipped'].includes(status) ? 'warn'
        : status === 'cancelled' ? 'bad' : '';
    return `<span class="badge ${color}">${escapeHtml(statusLabel(status))}</span>`;
  };

  const productImage = (product) => {
    const image = safeImageUrl(product.image_url);
    return image ? `<img class="product-thumb" src="${escapeHtml(image)}" alt="" loading="lazy">` : '<span class="product-thumb"></span>';
  };

  const orderRow = (order, detail = false) => `
    <tr>
      <td><span class="table-primary">${escapeHtml(order.order_code)}</span><span class="table-secondary">${escapeHtml(shortDate(order.created_at))}</span></td>
      <td><span class="table-primary">${escapeHtml(order.customer_name)}</span><span class="table-secondary">${escapeHtml(order.customer_email || order.customer_phone)}</span></td>
      <td>${money(order.total_ngn)}</td>
      <td>${statusBadge(order.status)}</td>
      <td>${statusBadge(order.payment_status || (order.status === 'paid' ? 'paid' : 'pending'))}</td>
      <td><button class="button small" data-order-detail="${escapeHtml(order.id)}">${detail ? 'Hide details' : 'View order'}</button></td>
    </tr>`;

  const orderTable = (orders, detail = false) => {
    if (!orders.length) return '<div class="empty-state">No orders found.</div>';
    return `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Order status</th><th>Payment</th><th></th></tr></thead><tbody>${orders.map((order) => orderRow(order, detail)).join('')}</tbody></table></div>`;
  };

  const renderOverview = () => {
    const paidOrders = state.orders.filter((order) => order.payment_status === 'paid' || order.status === 'paid');
    const revenue = paidOrders.reduce((total, order) => total + Number(order.total_ngn || 0), 0);
    const lowStock = state.products.filter((product) =>
      product.is_active && Number(product.inventory_count) <= Number(product.low_stock_threshold ?? 5));
    const metrics = [
      ['Products', state.products.length, 'Across your full catalog', '◇'],
      ['Orders', state.orders.length, `${paidOrders.length} payments confirmed`, '▤'],
      ['Customers', state.customers.length, 'Customers with an account order', '♙'],
      ['Sales revenue', money(revenue), 'Confirmed payments only', '₦'],
    ];
    const quick = [
      ['＋', 'Add a product', 'products'],
      ['▤', 'Review orders', 'orders'],
      ['▧', 'Edit website content', 'content'],
      ['⚙', 'Payment & delivery settings', 'settings'],
    ];
    root.innerHTML = `${pageHeading('Store overview', 'Good day, BERRYO.', 'A clear view of what is happening across your store.')}
      <div class="metric-grid">${metrics.map(([label, value, caption, icon]) => `
        <article class="metric-card"><div class="metric-top"><span>${escapeHtml(label)}</span><span class="metric-icon">${escapeHtml(icon)}</span></div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(caption)}</small></article>`).join('')}</div>
      <div class="dashboard-grid">
        ${sectionPanel('Recent orders', 'Latest activity from your customers', `<div class="panel-body" style="padding:0">${orderTable(state.orders.slice(0, 6))}</div>`, '<button class="button small" data-view-link="orders">All orders</button>')}
        <div class="settings-stack">
          ${sectionPanel('Quick actions', '', `<div class="panel-body"><div class="quick-actions">${quick.map(([icon, label, view]) => `<button class="quick-action" data-view-link="${view}"><span>${icon}</span>${label}</button>`).join('')}</div></div>`)}
          ${sectionPanel(`Low stock · ${lowStock.length}`, 'Products at or below their stock threshold', `<div class="panel-body">${lowStock.length ? lowStock.slice(0, 5).map((product) => `<p class="low-stock-row"><strong>${escapeHtml(product.name)}</strong><span>${Number(product.inventory_count)} left</span></p>`).join('') : '<p class="subheading">Everything is comfortably stocked.</p>'}<button class="button small" data-view-link="products">Manage products</button></div>`)}
        </div>
      </div>`;
  };

  const filteredProducts = () => {
    const term = state.search.toLowerCase();
    return state.products.filter((product) =>
      [product.name, product.slug, product.category, product.sku, product.size].some((value) => String(value || '').toLowerCase().includes(term)));
  };

  const renderProducts = () => {
    const products = filteredProducts();
    const rows = products.map((product) => `
      <tr>
        <td><div class="product-name-cell">${productImage(product)}<span><span class="table-primary">${escapeHtml(product.name)}</span><span class="table-secondary">${escapeHtml(product.slug)}${product.size ? ` · ${escapeHtml(product.size)}` : ''}</span></span></div></td>
        <td>${escapeHtml(product.category)}</td>
        <td><strong>${money(product.price_ngn)}</strong><span class="table-secondary">${product.wholesale_price_ngn == null ? 'Wholesale not set' : `Wholesale ${money(product.wholesale_price_ngn)}`}</span></td>
        <td>${Number(product.inventory_count)}${Number(product.inventory_count) <= Number(product.low_stock_threshold ?? 5) ? ' <span class="badge warn">Low</span>' : ''}</td>
        <td>${product.is_active ? '<span class="badge good">Active</span>' : '<span class="badge">Inactive</span>'}</td>
        <td><div class="row-actions"><button class="button small" data-edit-product="${escapeHtml(product.id)}">Edit</button><button class="button small danger" data-delete-product="${escapeHtml(product.id)}">Delete</button></div></td>
      </tr>`).join('');
    root.innerHTML = `${pageHeading('Catalog', 'Products', 'Manage retail and wholesale pricing, sizes, images, and stock.', '<button class="button primary" data-add-product>＋ Add product</button>')}
      <div class="toolbar"><select id="product-category-filter" aria-label="Filter products by category"><option value="all">All categories</option>${[...new Set(state.products.map((product) => product.category).filter(Boolean))].sort().map((category) => `<option>${escapeHtml(category)}</option>`).join('')}</select><select id="product-state-filter" aria-label="Filter products by status"><option value="all">All status</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="low-stock">Low stock</option></select><span class="badge">${products.length} products</span></div>
      ${sectionPanel('Catalog inventory', 'Edits save directly to the Supabase product catalog.', `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Retail / wholesale</th><th>Stock</th><th>Store status</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="6"><div class="empty-state">No products match this search.</div></td></tr>'}</tbody></table></div>`)}`;
    byId('product-category-filter').addEventListener('change', applyProductFilters);
    byId('product-state-filter').addEventListener('change', applyProductFilters);
  };

  const applyProductFilters = () => {
    const category = byId('product-category-filter')?.value || 'all';
    const active = byId('product-state-filter')?.value || 'all';
    const term = state.search.toLowerCase();
    const filtered = state.products.filter((product) => {
      const matchesSearch = [product.name, product.slug, product.category, product.sku, product.size].some((value) => String(value || '').toLowerCase().includes(term));
      const matchesCategory = category === 'all' || product.category === category;
      const low = Number(product.inventory_count) <= Number(product.low_stock_threshold ?? 5);
      const matchesState = active === 'all' || (active === 'active' && product.is_active) || (active === 'inactive' && !product.is_active) || (active === 'low-stock' && low);
      return matchesSearch && matchesCategory && matchesState;
    });
    const tbody = root.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = filtered.map((product) => `
      <tr><td><div class="product-name-cell">${productImage(product)}<span><span class="table-primary">${escapeHtml(product.name)}</span><span class="table-secondary">${escapeHtml(product.slug)}${product.size ? ` · ${escapeHtml(product.size)}` : ''}</span></span></div></td>
      <td>${escapeHtml(product.category)}</td><td><strong>${money(product.price_ngn)}</strong><span class="table-secondary">${product.wholesale_price_ngn == null ? 'Wholesale not set' : `Wholesale ${money(product.wholesale_price_ngn)}`}</span></td>
      <td>${Number(product.inventory_count)}${Number(product.inventory_count) <= Number(product.low_stock_threshold ?? 5) ? ' <span class="badge warn">Low</span>' : ''}</td>
      <td>${product.is_active ? '<span class="badge good">Active</span>' : '<span class="badge">Inactive</span>'}</td>
      <td><div class="row-actions"><button class="button small" data-edit-product="${escapeHtml(product.id)}">Edit</button><button class="button small danger" data-delete-product="${escapeHtml(product.id)}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty-state">No products match these filters.</div></td></tr>';
  };

  const renderOrders = () => {
    const term = state.search.toLowerCase();
    const orders = state.orders.filter((order) => {
      const matchesTerm = [order.order_code, order.customer_name, order.customer_email, order.customer_phone].some((value) => String(value || '').toLowerCase().includes(term));
      const matchesStatus = state.statusFilter === 'all' || order.status === state.statusFilter;
      return matchesTerm && matchesStatus;
    });
    const editableRows = orders.map((order) => `
      <tr>
        <td><span class="table-primary">${escapeHtml(order.order_code)}</span><span class="table-secondary">${escapeHtml(longDate(order.created_at))}</span></td>
        <td><span class="table-primary">${escapeHtml(order.customer_name)}</span><span class="table-secondary">${escapeHtml(order.customer_email || '')} · ${escapeHtml(order.customer_phone)}</span></td>
        <td>${money(order.total_ngn)}<span class="table-secondary">${escapeHtml(order.payment_method || '')}</span></td>
        <td><select class="inline-select" data-order-status="${escapeHtml(order.id)}">${statusOptions.map(([value, label]) => `<option value="${value}" ${order.status === value || (order.status === 'awaiting_payment' && value === 'awaiting_payment') ? 'selected' : ''}>${label}</option>`).join('')}</select></td>
        <td><select class="inline-select" data-payment-status="${escapeHtml(order.id)}"><option value="pending" ${(order.payment_status || (order.status === 'paid' ? 'paid' : 'pending')) === 'pending' ? 'selected' : ''}>Payment pending</option><option value="submitted" ${order.payment_status === 'submitted' ? 'selected' : ''}>Proof submitted</option><option value="paid" ${order.payment_status === 'paid' || order.status === 'paid' ? 'selected' : ''}>Payment received</option><option value="failed" ${order.payment_status === 'failed' ? 'selected' : ''}>Failed</option><option value="refunded" ${order.payment_status === 'refunded' ? 'selected' : ''}>Refunded</option></select></td>
        <td><button class="button small primary" data-save-order="${escapeHtml(order.id)}">Save</button> <button class="button small" data-order-detail="${escapeHtml(order.id)}">Details</button></td>
      </tr>`).join('');
    root.innerHTML = `${pageHeading('Fulfilment', 'Orders', 'Review payment, delivery details, and order progress.')}
      <div class="toolbar"><select id="order-status-filter" aria-label="Filter orders by status"><option value="all">All order statuses</option>${statusOptions.map(([value, label]) => `<option value="${value}" ${state.statusFilter === value ? 'selected' : ''}>${label}</option>`).join('')}</select><span class="badge">${orders.length} orders</span></div>
      ${sectionPanel('All orders', 'Payment status is managed separately from fulfilment status.', `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Total / method</th><th>Order status</th><th>Payment status</th><th>Actions</th></tr></thead><tbody>${editableRows || '<tr><td colspan="6"><div class="empty-state">No orders match these filters.</div></td></tr>'}</tbody></table></div>`)}
      <div id="order-detail-container"></div>`;
    byId('order-status-filter').addEventListener('change', (event) => { state.statusFilter = event.target.value; renderOrders(); });
  };

  const renderCustomers = () => {
    const term = state.search.toLowerCase();
    const customers = state.customers.map((customer, index) => ({ ...customer, rowIndex: index })).filter((customer) =>
      [customer.customer_name, customer.customer_email, customer.customer_phone].some((value) => String(value || '').toLowerCase().includes(term)));
    const rows = customers.map((customer) => `
      <tr><td><span class="table-primary">${escapeHtml(customer.customer_name || 'Customer')}</span><span class="table-secondary">${escapeHtml(customer.customer_email || '')}</span></td>
      <td>${escapeHtml(customer.customer_phone || '—')}</td><td>${Number(customer.order_count) || 0}</td><td>${money(customer.total_spent)}</td><td>${escapeHtml(shortDate(customer.last_order_at))}</td>
      <td><button class="button small" data-customer-index="${customer.rowIndex}">Order history</button></td></tr>`).join('');
    root.innerHTML = `${pageHeading('Relationships', 'Customers', 'Registered accounts and customer details saved with orders.')}
      ${sectionPanel('Customer directory', 'Contact and order information is only visible to store admins.', `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th>Orders</th><th>Paid total</th><th>Last order</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6"><div class="empty-state">No customers found.</div></td></tr>'}</tbody></table></div>`)}
      <div id="customer-history"></div>`;
  };

  const valueAt = (path, fallback = '') => {
    let value = state.settings || {};
    for (const key of path.split('.')) value = value?.[key];
    return value ?? fallback;
  };

  const field = (label, name, value, type = 'text', full = false) => `
    <div class="field ${full ? 'full' : ''}"><label for="${escapeHtml(name)}">${escapeHtml(label)}</label>
      ${type === 'textarea'
        ? `<textarea id="${escapeHtml(name)}" name="${escapeHtml(name)}">${escapeHtml(value)}</textarea>`
        : `<input id="${escapeHtml(name)}" name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(value)}">`}</div>`;

  const renderContent = () => {
    const categories = valueAt('categories', []);
    const featured = state.products.filter((product) => product.featured).map((product) => product.slug).join('\n');
    root.innerHTML = `${pageHeading('Brand & storefront', 'Website content', 'Edit the public-facing words and links without changing site code.')}
      <form id="content-form" class="settings-stack">
        <div class="settings-layout">
          <div class="settings-stack">
            <section class="settings-section"><h2>Homepage</h2><div class="field-grid">
              ${field('Hero heading', 'homepage.banner_title', valueAt('homepage.banner_title', 'Purely Organic. Naturally Beautiful.'), 'text', true)}
              ${field('Hero description', 'homepage.banner_text', valueAt('homepage.banner_text'), 'textarea', true)}
              ${field('Announcement banner', 'homepage.announcement', valueAt('homepage.announcement'), 'text', true)}
              ${field('Hero image URL', 'homepage.banner_image_url', valueAt('homepage.banner_image_url'), 'text', true)}
              <div class="field full"><label for="homepage.banner_image_file">Upload homepage banner image (max 5 MB)</label><input id="homepage.banner_image_file" name="homepage.banner_image_file" type="file" accept="image/*"></div>
              ${field('Featured product slugs', 'featured_slugs', featured, 'textarea', true)}
              <p class="help-text full">List one product slug per line to feature it on the storefront. Product slugs are shown in the Products section.</p>
            </div></section>
            <section class="settings-section"><h2>About section</h2><div class="field-grid">
              ${field('Heading', 'about.heading', valueAt('about.heading'), 'text', true)}
              ${field('About text', 'about.text', valueAt('about.text'), 'textarea', true)}
            </div></section>
            <section class="settings-section"><h2>Contact & social links</h2><div class="field-grid">
              ${field('Contact email', 'contact.email', valueAt('contact.email'), 'email')}
              ${field('Business name', 'contact.business_name', valueAt('contact.business_name'))}
              ${field('Main phone', 'contact.phone', valueAt('contact.phone'), 'tel')}
              ${field('Alternate phone', 'contact.phone_alt', valueAt('contact.phone_alt'), 'tel')}
              ${field('Business address', 'contact.address', valueAt('contact.address'))}
              ${field('Instagram', 'social.instagram', valueAt('social.instagram'))}
              ${field('Facebook', 'social.facebook', valueAt('social.facebook'))}
              ${field('Wholesale Instagram', 'social.wholesale_instagram', valueAt('social.wholesale_instagram'))}
              ${field('TikTok', 'social.tiktok', valueAt('social.tiktok'))}
            </div></section>
          </div>
          <div class="settings-stack">
            <section class="settings-section"><h2>Store categories</h2><div class="field-grid">
              ${field('One category per line', 'categories', Array.isArray(categories) ? categories.join('\n') : '', 'textarea', true)}
              <p class="help-text full">Products keep their category value. Add categories here, then select them when editing a product.</p>
            </div></section>
            <section class="settings-section"><h2>Publish changes</h2><p class="subheading">Content is saved to Supabase and read by the storefront. Product flags control featured collections.</p><div class="form-actions"><button class="button primary" type="submit">Save website content</button></div></section>
          </div>
        </div>
      </form>`;
  };

  const renderSettings = async () => {
    const users = await api('/rest/v1/rpc/admin_list_users', { method: 'POST', body: '{}' });
    const rows = Array.isArray(users.data) ? users.data : [];
    root.innerHTML = `${pageHeading('Configuration', 'Settings', 'Manage payment, delivery, your admin profile, and trusted users.')}
      <div class="settings-layout">
        <div class="settings-stack">
          <form id="payment-form" class="settings-section"><h2>Payment settings</h2><div class="field-grid">
            ${field('Payment method', 'payment.method', valueAt('payment.method', 'moniepoint_transfer'))}
            ${field('Bank', 'payment.bank_name', valueAt('payment.bank_name', 'Moniepoint'))}
            ${field('Account name', 'payment.account_name', valueAt('payment.account_name', 'BERRY0-ORGANICSKINCARE ENTERPRISE'))}
            ${field('Account number', 'payment.account_number', valueAt('payment.account_number', '8034226547'))}
          </div><div class="form-actions"><button class="button primary" type="submit">Save payment settings</button></div></form>
          <form id="shipping-form" class="settings-section"><h2>Delivery & shipping</h2><div class="field-grid">
            ${field('Delivery fee (NGN)', 'shipping.fee_ngn', valueAt('shipping.fee_ngn', 1800), 'number')}
            ${field('Delivery information', 'shipping.information', valueAt('shipping.information'), 'textarea', true)}
          </div><div class="form-actions"><button class="button primary" type="submit">Save delivery settings</button></div></form>
          <form id="profile-form" class="settings-section"><h2>Admin profile</h2><div class="field-grid">
            ${field('Signed-in account', 'admin.email', state.user?.email || '', 'email', true)}
            ${field('New password', 'admin.password', '', 'password')}
            ${field('Confirm new password', 'admin.password_confirm', '', 'password')}
          </div><p class="help-text">Password updates are sent to Supabase Auth. Use at least 8 characters.</p><div class="form-actions"><button class="button primary" type="submit">Update password</button></div></form>
        </div>
        <section class="settings-section"><h2>Admin users</h2><p class="subheading">Only add people who already have a verified account in this Supabase project.</p>
          <form id="add-admin-form" class="toolbar" style="margin-top:14px"><input name="email" type="email" required placeholder="Verified account email" aria-label="Verified account email"><button class="button primary" type="submit">Grant admin access</button></form>
          <div class="table-wrap"><table><thead><tr><th>Admin</th><th>Role</th><th></th></tr></thead><tbody>${rows.map((user) => `<tr><td><span class="table-primary">${escapeHtml(user.full_name || user.email || 'User')}</span><span class="table-secondary">${escapeHtml(user.email || '')}</span></td><td>${user.is_admin ? '<span class="badge good">Admin</span>' : '<span class="badge">Customer</span>'}</td><td>${user.is_admin ? `<button class="button small danger" data-revoke-admin="${escapeHtml(user.email)}" ${user.user_id === state.user?.id ? 'disabled title="You cannot revoke your own admin access"' : ''}>Remove admin</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="3">No user profiles found.</td></tr>'}</tbody></table></div>
        </section>
      </div>`;
  };

  const render = () => {
    if (state.view === 'overview') return renderOverview();
    if (state.view === 'products') return renderProducts();
    if (state.view === 'orders') return renderOrders();
    if (state.view === 'customers') return renderCustomers();
    if (state.view === 'content') return renderContent();
    if (state.view === 'settings') return renderSettings().catch((error) => showNotice(error.message, 'error'));
    renderOverview();
  };

  const uploadImage = async (file) => {
    if (!file) return '';
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
      throw new Error('Choose an image file smaller than 5 MB.');
    }
    const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
    const filename = `${crypto.randomUUID()}.${extension}`;
    const { response } = await api(`/storage/v1/object/${bucket}/${filename}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type, 'x-upsert': 'false' },
      body: file,
    });
    if (!response.ok) throw new Error('The image upload could not be confirmed.');
    return `${config.url}/storage/v1/object/public/${bucket}/${filename}`;
  };

  const openProductDialog = (product = null) => {
    const categories = valueAt('categories', ['Body Care', 'Face Care', 'Soaps', 'Lip Care']);
    const categoryValues = Array.isArray(categories) ? categories : ['Body Care', 'Face Care', 'Soaps', 'Lip Care'];
    const current = product || {};
    const options = [...new Set([...categoryValues, current.category].filter(Boolean))];
    dialog.innerHTML = `<div class="dialog-header"><h2>${product ? 'Edit product' : 'Add product'}</h2><button class="icon-button" type="button" data-close-dialog aria-label="Close">×</button></div>
      <form id="product-form" class="dialog-content">
        <div class="field-grid">
          ${field('Product name', 'name', current.name || '')}
          ${field('Variant size', 'size', current.size || '')}
          <div class="field"><label for="category">Category</label><input id="category" name="category" list="category-options" value="${escapeHtml(current.category || '')}" required><datalist id="category-options">${options.map((value) => `<option value="${escapeHtml(value)}">`).join('')}</datalist></div>
          ${field('Product slug (unique)', 'slug', current.slug || '')}
          ${field('SKU', 'sku', current.sku || '')}
          ${field('Retail price (NGN)', 'price_ngn', current.price_ngn ?? '', 'number')}
          ${field('Retail price (USD)', 'price_usd', current.price_usd ?? '', 'number')}
          ${field('Wholesale price (NGN)', 'wholesale_price_ngn', current.wholesale_price_ngn ?? '', 'number')}
          ${field('Wholesale price (USD)', 'wholesale_price_usd', current.wholesale_price_usd ?? '', 'number')}
          ${field('Stock quantity', 'inventory_count', current.inventory_count ?? 0, 'number')}
          ${field('Low-stock alert at', 'low_stock_threshold', current.low_stock_threshold ?? 5, 'number')}
          ${field('Image URL', 'image_url', current.image_url || '', 'text', true)}
          <div class="field full"><label for="image_file">Upload or replace product image (max 5 MB)</label><input id="image_file" name="image_file" type="file" accept="image/*"></div>
          ${field('Description', 'description', current.description || '', 'textarea', true)}
          ${field('Ingredients', 'ingredients', current.ingredients || '', 'textarea', true)}
        </div>
        <div class="check-row"><label><input type="checkbox" name="is_active" ${current.is_active !== false ? 'checked' : ''}> Active in storefront</label><label><input type="checkbox" name="featured" ${current.featured ? 'checked' : ''}> Featured</label><label><input type="checkbox" name="bestseller" ${current.bestseller ? 'checked' : ''}> Bestseller</label><label><input type="checkbox" name="new_arrival" ${current.new_arrival ? 'checked' : ''}> New arrival</label></div>
        <p class="help-text">Products and images save to Supabase. Deleting a product keeps historical order item names.</p>
        <div class="form-actions"><button class="button" type="button" data-close-dialog>Cancel</button><button class="button primary" type="submit">${product ? 'Save product' : 'Create product'}</button></div>
      </form>`;
    dialog.showModal();
    const name = dialog.querySelector('[name="name"]');
    const slug = dialog.querySelector('[name="slug"]');
    if (!product) {
      name.addEventListener('input', () => {
        if (slug.dataset.touched === 'true') return;
        slug.value = `${name.value} ${dialog.querySelector('[name="size"]').value}`.toLowerCase().trim()
          .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      });
      dialog.querySelector('[name="size"]').addEventListener('input', () => name.dispatchEvent(new Event('input')));
      slug.addEventListener('input', () => { slug.dataset.touched = 'true'; });
    }
    dialog.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => dialog.close()));
    dialog.querySelector('#product-form').addEventListener('submit', saveProduct);
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const values = new FormData(form);
      let imageUrl = String(values.get('image_url') || '').trim() || null;
      const imageFile = values.get('image_file');
      if (imageFile instanceof File && imageFile.size) imageUrl = await uploadImage(imageFile);
      const product = {
        name: String(values.get('name') || '').trim(),
        slug: String(values.get('slug') || '').trim().toLowerCase(),
        category: String(values.get('category') || '').trim(),
        size: String(values.get('size') || '').trim() || null,
        sku: String(values.get('sku') || '').trim() || null,
        price_ngn: Number(values.get('price_ngn')),
        price_usd: values.get('price_usd') === '' ? null : Number(values.get('price_usd')),
        wholesale_price_ngn: values.get('wholesale_price_ngn') === '' ? null : Number(values.get('wholesale_price_ngn')),
        wholesale_price_usd: values.get('wholesale_price_usd') === '' ? null : Number(values.get('wholesale_price_usd')),
        inventory_count: Number(values.get('inventory_count')),
        low_stock_threshold: Number(values.get('low_stock_threshold')),
        description: String(values.get('description') || '').trim(),
        ingredients: String(values.get('ingredients') || '').trim(),
        image_url: imageUrl,
        is_active: form.elements.is_active.checked,
        featured: form.elements.featured.checked,
        bestseller: form.elements.bestseller.checked,
        new_arrival: form.elements.new_arrival.checked,
      };
      if (!product.name || !product.slug || !product.category) throw new Error('Enter a product name, unique slug, and category.');
      if (!Number.isFinite(product.price_ngn) || product.price_ngn < 0) throw new Error('Enter a valid retail price.');
      if (!Number.isInteger(product.inventory_count) || product.inventory_count < 0) throw new Error('Stock must be a non-negative whole number.');
      const productId = form.dataset.productId;
      const path = productId ? `/rest/v1/products?id=eq.${encodeURIComponent(productId)}` : '/rest/v1/products';
      await api(path, {
        method: productId ? 'PATCH' : 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(product),
      });
      dialog.close();
      await loadData();
      render();
      showNotice(productId ? 'Product saved to the live catalog.' : 'Product added to the live catalog.');
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  };

  const saveOrder = async (orderId) => {
    const status = root.querySelector(`[data-order-status="${CSS.escape(orderId)}"]`)?.value;
    const paymentStatus = root.querySelector(`[data-payment-status="${CSS.escape(orderId)}"]`)?.value;
    if (!status || !paymentStatus) return;
    const patch = { status, payment_status: paymentStatus };
    if (paymentStatus === 'paid' && status === 'awaiting_payment') patch.status = 'paid';
    if (paymentStatus !== 'paid' && status === 'paid') patch.status = 'awaiting_payment';
    await api(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    await loadData();
    renderOrders();
    showNotice('Order and payment status updated.');
  };

  const showOrderDetails = async (orderId) => {
    const order = state.orders.find((item) => item.id === orderId);
    if (!order) return;
    if (!state.orderItems.has(orderId)) {
      const query = new URLSearchParams({ select: '*', order_id: `eq.${orderId}`, order: 'created_at.asc' });
      const { data } = await api(`/rest/v1/order_items?${query}`);
      state.orderItems.set(orderId, data);
    }
    const items = state.orderItems.get(orderId) || [];
    let proofLink = 'No transfer receipt submitted.';
    if (order.payment_proof_path) {
      const proofPath = order.payment_proof_path.split('/').map(encodeURIComponent).join('/');
      const { data } = await api(`/storage/v1/object/sign/customer-payment-proofs/${proofPath}`, {
        method: 'POST',
        body: JSON.stringify({ expiresIn: 300 }),
      });
      if (typeof data?.signedURL !== 'string') throw new Error('Supabase did not return a signed payment receipt link.');
      const signedUrl = new URL(data.signedURL, config.url).href;
      proofLink = `<a href="${escapeHtml(signedUrl)}" target="_blank" rel="noopener noreferrer">View transfer receipt</a>`;
    }
    let container = byId('order-detail-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'order-detail-container';
      root.appendChild(container);
    }
    if (container.dataset.orderId === orderId) {
      container.innerHTML = '';
      container.dataset.orderId = '';
      return;
    }
    container.dataset.orderId = orderId;
    container.innerHTML = sectionPanel(`Order ${escapeHtml(order.order_code)}`, `Placed ${escapeHtml(longDate(order.created_at))}`, `
      <div class="panel-body"><div class="detail-grid">
        <div class="detail-box"><small>Customer</small><strong>${escapeHtml(order.customer_name)}</strong><span class="table-secondary">${escapeHtml(order.customer_email || '')} · ${escapeHtml(order.customer_phone)}</span></div>
        <div class="detail-box"><small>Payment</small><strong>${escapeHtml(order.payment_method || '—')} · ${escapeHtml(order.payment_status || 'pending')}</strong><span class="table-secondary">${escapeHtml(order.payment_reference || 'No reference recorded')}</span></div>
        <div class="detail-box"><small>Delivery address</small><strong>${escapeHtml(order.delivery_address)}</strong><span class="table-secondary">${escapeHtml([order.delivery_city, order.delivery_country].filter(Boolean).join(', '))}</span></div>
        <div class="detail-box"><small>Transfer receipt</small><strong>${proofLink}</strong><span class="table-secondary">${escapeHtml(order.payment_submitted_at ? longDate(order.payment_submitted_at) : 'Not submitted')}</span></div>
      </div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Unit price</th><th>Quantity</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.product_name)}</td><td>${money(item.unit_price_ngn)}</td><td>${Number(item.quantity)}</td></tr>`).join('') || '<tr><td colspan="3">No items were found for this order.</td></tr>'}</tbody></table></div>
      <p><strong>Subtotal:</strong> ${money(order.subtotal_ngn)} &nbsp; <strong>Shipping:</strong> ${money(order.shipping_fee_ngn)} &nbsp; <strong>Total:</strong> ${money(order.total_ngn)}</p></div>`);
  };

  const showCustomerHistory = async (customerIndex) => {
    const customer = state.customers[customerIndex];
    if (!customer) return;
    const customerKey = customer.customer_id || `${customer.customer_email || ''}|${customer.customer_phone || ''}`;
    if (state.customerOrdersFor === customerKey) {
      state.customerOrdersFor = '';
      byId('customer-history').innerHTML = '';
      return;
    }
    state.customerOrdersFor = customerKey;
    const query = new URLSearchParams({ select: '*', order: 'created_at.desc' });
    if (customer.customer_id) query.set('customer_id', `eq.${customer.customer_id}`);
    else if (customer.customer_email) query.set('customer_email', `eq.${customer.customer_email}`);
    else query.set('customer_phone', `eq.${customer.customer_phone}`);
    const { data: orders } = await api(`/rest/v1/orders?${query}`);
    byId('customer-history').innerHTML = `<section class="panel customer-detail"><div class="panel-heading"><div><h2>${escapeHtml(customer.customer_name || 'Customer')}</h2><p>${escapeHtml(customer.customer_email || '')} · ${escapeHtml(customer.customer_phone || '')}</p></div><span class="badge">${orders.length} orders</span></div><div class="panel-body">${orderTable(orders)}</div></section>`;
  };

  const saveSettingsSection = async (form, key) => {
    const values = Object.fromEntries(new FormData(form).entries());
    const data = structuredClone(state.settings || {});
    for (const [path, value] of Object.entries(values)) {
      let target = data;
      const parts = path.split('.');
      for (const part of parts.slice(0, -1)) target = target[part] ||= {};
      const last = parts.at(-1);
      if (path.startsWith('payment.')) target[last] = value;
      else if (last === 'fee_ngn') {
        const fee = Number(value);
        if (!Number.isFinite(fee) || fee < 0 || fee > 100000) throw new Error('Enter a delivery fee between 0 and 100,000 NGN.');
        target[last] = fee;
      } else target[last] = value;
    }
    await api('/rest/v1/store_settings?id=eq.1', {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ content: data }),
    });
    state.settings = data;
  };

  const saveContent = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const entries = Object.fromEntries(new FormData(form).entries());
    const content = structuredClone(state.settings || {});
    const bannerImage = entries['homepage.banner_image_file'];
    let uploadedBannerImage = '';
    if (bannerImage instanceof File && bannerImage.size) {
      uploadedBannerImage = await uploadImage(bannerImage);
    }
    for (const [path, value] of Object.entries(entries)) {
      if (path === 'featured_slugs' || path === 'homepage.banner_image_file') continue;
      const parts = path.split('.');
      let target = content;
      for (const part of parts.slice(0, -1)) target = target[part] ||= {};
      target[parts.at(-1)] = path === 'categories'
        ? String(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
        : value;
    }
    if (uploadedBannerImage) content.homepage.banner_image_url = uploadedBannerImage;
    await api('/rest/v1/store_settings?id=eq.1', {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ content }),
    });
    const featuredSlugs = new Set(String(entries.featured_slugs || '').split(/\r?\n/).map((slug) => slug.trim()).filter(Boolean));
    await Promise.all(state.products.map((product) =>
      api(`/rest/v1/products?id=eq.${encodeURIComponent(product.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ featured: featuredSlugs.has(product.slug) }),
      })));
    state.settings = content;
    await loadData();
    renderContent();
    showNotice('Website content and featured products are saved.');
  };

  const setAdminRole = async (email, enabled) => {
    await api('/rest/v1/rpc/admin_set_user_role', {
      method: 'POST',
      body: JSON.stringify({ p_email: email, p_is_admin: enabled }),
    });
    await renderSettings();
    showNotice(enabled ? 'Admin access granted to the verified account.' : 'Admin access removed.');
  };

  const changePassword = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = form.elements['admin.password'].value;
    const confirm = form.elements['admin.password_confirm'].value;
    if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
    if (password !== confirm) throw new Error('The password confirmation does not match.');
    await api('/auth/v1/user', {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
    form.reset();
    showNotice('Your Supabase account password has been updated.');
  };

  const addAdmin = async (event) => {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email');
    await setAdminRole(String(email), true);
  };

  const delegateClick = async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    try {
      if (target.dataset.viewLink) return setView(target.dataset.viewLink);
      if (target.dataset.addProduct !== undefined) return openProductDialog();
      if (target.dataset.editProduct) {
        const product = state.products.find((item) => item.id === target.dataset.editProduct);
        if (product) {
          openProductDialog(product);
          dialog.querySelector('#product-form').dataset.productId = product.id;
        }
        return;
      }
      if (target.dataset.deleteProduct) {
        const product = state.products.find((item) => item.id === target.dataset.deleteProduct);
        if (!product || !confirm(`Delete “${product.name}” from the catalog? Historical orders will retain their saved item names.`)) return;
        await api(`/rest/v1/products?id=eq.${encodeURIComponent(product.id)}`, { method: 'DELETE' });
        await loadData();
        renderProducts();
        showNotice('Product deleted.');
        return;
      }
      if (target.dataset.saveOrder) {
        target.disabled = true;
        await saveOrder(target.dataset.saveOrder);
        return;
      }
      if (target.dataset.orderDetail) {
        target.disabled = true;
        await showOrderDetails(target.dataset.orderDetail);
        target.disabled = false;
        return;
      }
      if (target.dataset.customerIndex !== undefined) {
        target.disabled = true;
        await showCustomerHistory(Number(target.dataset.customerIndex));
        target.disabled = false;
        return;
      }
      if (target.dataset.revokeAdmin) {
        const email = target.dataset.revokeAdmin;
        if (confirm(`Remove store-admin access from ${email}?`)) await setAdminRole(email, false);
        return;
      }
      if (target.id === 'notifications') return setView('products');
      if (target.id === 'logout') {
        target.disabled = true;
        await api('/auth/v1/logout', { method: 'POST' });
        sessionStorage.removeItem(sessionKey);
        location.replace('./index.html');
      }
    } catch (error) {
      target.disabled = false;
      showNotice(error.message, 'error');
    }
  };

  const wireForms = () => {
    root.addEventListener('submit', async (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        if (form.id === 'content-form') await saveContent(event);
        else if (form.id === 'payment-form') {
          await saveSettingsSection(form, 'payment');
          showNotice('Payment settings saved.');
        } else if (form.id === 'shipping-form') {
          await saveSettingsSection(form, 'shipping');
          showNotice('Delivery settings saved.');
        } else if (form.id === 'profile-form') await changePassword(event);
        else if (form.id === 'add-admin-form') await addAdmin(event);
      } catch (error) {
        showNotice(error.message, 'error');
      } finally {
        if (submit && submit.isConnected) submit.disabled = false;
      }
    });
  };

  const start = async () => {
    byId('loading').hidden = false;
    root.hidden = true;
    try {
      await requireSession();
      await loadData();
      byId('loading').hidden = true;
      root.hidden = false;
      render();
    } catch (error) {
      byId('loading').textContent = error.message;
      byId('loading').classList.add('error-text');
      if (!readSession()?.accessToken) {
        byId('loading').innerHTML = `${escapeHtml(error.message)}<p><a class="button primary" href="./index.html">Go to sign in</a></p>`;
      }
    }
  };

  root.addEventListener('click', (event) => { delegateClick(event).catch((error) => showNotice(error.message, 'error')); });
  wireForms();
  byId('global-search').addEventListener('input', (event) => {
    state.search = event.target.value;
    if (state.view === 'products') applyProductFilters();
    else if (state.view === 'orders') renderOrders();
    else if (state.view === 'customers') renderCustomers();
  });
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  byId('menu-toggle').addEventListener('click', () => {
    byId('sidebar').classList.toggle('open');
    byId('scrim').classList.toggle('visible');
  });
  byId('scrim').addEventListener('click', closeSidebar);
  start();
})();
