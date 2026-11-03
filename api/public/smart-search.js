/* Shared, zero-dependency smart search for the QR guest and admin catalogue.
   Uses live menu data already fetched by each page; never invents ratings or popularity. */
(function (global) {
  'use strict';
  function normalize(value) {
    return String(value == null ? '' : value)
      .toLocaleLowerCase('vi-VN').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }
  function score(item, query) {
    const words = normalize(query).split(' ').filter(Boolean);
    if (!words.length) return 0;
    const name = normalize(item.name);
    const category = normalize(item.category);
    const secondary = normalize([item.sku, item.description,
      item.station === 'bar' ? 'do uong bar' : 'mon an bep'].join(' '));
    const corpus = [name, category, secondary].join(' ');
    if (!words.every(word => corpus.includes(word))) return -1;
    const joined = words.join(' ');
    return (name === joined ? 200 : 0) +
      (name.startsWith(joined) ? 100 : 0) +
      (name.includes(joined) ? 55 : 0) +
      (category.startsWith(joined) ? 25 : 0) +
      words.reduce((total, word) => total +
        (name.split(' ').some(part => part.startsWith(word)) ? 12 : 0), 0);
  }
  function searchItems(items, query) {
    const source = Array.isArray(items) ? items : [];
    if (!normalize(query)) return source.slice();
    return source.map((item, index) => ({item, index, rank: score(item, query)}))
      .filter(entry => entry.rank >= 0)
      .sort((a, b) => b.rank - a.rank || a.index - b.index)
      .map(entry => entry.item);
  }
  function matches(item, query) { return !normalize(query) || score(item, query) >= 0; }
  function create(options) {
    const root = typeof options.root === 'string' ? document.querySelector(options.root) : options.root;
    if (!root) return null;
    const mode = options.mode === 'admin' ? 'admin' : 'guest';
    const fieldLabel = mode === 'admin' ? 'Tìm món để quản lý' : 'Tìm món trong thực đơn';
    const icon = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><circle cx="10.7" cy="10.7" r="6.8"/><path d="m16 16 5 5"/></svg>';
    root.classList.add('tt6-smart-search');
    if (options.compact) root.classList.add('tt6-smart-search-compact');
    root.innerHTML = '<div class="tt6-search-field">' + icon +
      '<input class="tt6-search-input" type="search" autocomplete="off" maxlength="100" aria-label="' + fieldLabel + '" placeholder="' +
      (options.placeholder || (mode === 'admin' ? 'Tìm tên món, mã SKU, danh mục...' : 'Tìm phở, trà, nước uống...')) + '">' +
      '<button class="tt6-search-clear" type="button" data-search-action="clear" aria-label="Xóa tìm kiếm" hidden>×</button>' +
      '<button class="tt6-search-submit" type="button" data-search-action="submit" aria-label="Tìm kiếm">' + icon + '</button></div>' +
      '<div class="tt6-search-body"><div class="tt6-search-heading"><span>✦</span><strong>' +
      (mode === 'admin' ? 'Truy cập nhanh' : 'Món gợi ý') +
      '</strong><small class="tt6-search-count" aria-live="polite"></small></div>' +
      '<div class="tt6-search-results"></div>' +
      '<div class="tt6-search-heading"><span>⌕</span><strong>Gợi ý tìm kiếm</strong></div>' +
      '<div class="tt6-search-suggestions"></div>' +
      '<div class="tt6-search-heading"><span>▦</span><strong>Khám phá danh mục</strong></div>' +
      '<div class="tt6-search-categories"></div></div>';
    const input = root.querySelector('.tt6-search-input');
    const clear = root.querySelector('.tt6-search-clear');
    const resultHost = root.querySelector('.tt6-search-results');
    const suggestionHost = root.querySelector('.tt6-search-suggestions');
    const categoriesHost = root.querySelector('.tt6-search-categories');
    const count = root.querySelector('.tt6-search-count');
    let source = [], query = '', visible = [];
    function appendChip(target, value) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tt6-search-chip';
      button.dataset.searchTerm = value;
      button.textContent = value;
      target.append(button);
    }
    function render() {
      query = input.value.trim();
      clear.hidden = !query;
      visible = searchItems(source, query);
      count.textContent = visible.length + ' / ' + source.length + ' món';
      resultHost.replaceChildren();
      const chosen = visible.slice(0, 2);
      if (!chosen.length) {
        const empty = document.createElement('p');
        empty.className = 'tt6-search-empty';
        empty.textContent = source.length ? 'Không tìm thấy món phù hợp.' : 'Chưa có dữ liệu thực đơn.';
        resultHost.append(empty);
      }
      for (const item of chosen) {
        const soldOut = mode === 'guest' && item.available_quantity != null &&
          Number(item.available_quantity) <= 0;
        const row = document.createElement('button');
        row.className = 'tt6-search-product';
        row.type = 'button';
        row.dataset.searchId = String(item.id);
        row.disabled = soldOut;
        const symbol = document.createElement('span');
        symbol.className = 'tt6-search-symbol';
        symbol.textContent = item.station === 'bar' ? '🥤' : '🍽';
        const info = document.createElement('span');
        info.className = 'tt6-search-info';
        const name = document.createElement('strong');
        name.textContent = item.name || 'Chưa đặt tên';
        const detail = document.createElement('small');
        const status = mode === 'admin' ? (item.active ? 'Đang bán' : 'Tạm ẩn') :
          (soldOut ? 'Hết hàng' : 'Xem và chọn món');
        detail.textContent = [item.category, status].filter(Boolean).join(' · ');
        info.append(name, detail);
        const price = document.createElement('span');
        price.className = 'tt6-search-price';
        price.textContent = new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 0}).format(Number(item.price) || 0) + ' ₫';
        row.append(symbol, info, price);
        resultHost.append(row);
      }
      suggestionHost.replaceChildren();
      const suggestionItems = query ? visible.slice(0, 4).map(item => item.name) :
        source.slice(0, 4).map(item => item.name);
      const suggestions = [...new Set(suggestionItems.filter(Boolean))];
      if (!suggestions.length) {
        const empty = document.createElement('small');
        empty.className = 'tt6-search-muted';
        empty.textContent = 'Thử tên món hoặc danh mục khác.';
        suggestionHost.append(empty);
      }
      suggestions.forEach(value => appendChip(suggestionHost, value));
      categoriesHost.replaceChildren();
      [...new Set(source.map(item => String(item.category || '').trim()).filter(Boolean))]
        .slice(0, 5).forEach(value => appendChip(categoriesHost, value));
    }
    function setQuery(next) {
      input.value = String(next == null ? '' : next).slice(0, 100);
      render();
      if (typeof options.onChange === 'function') options.onChange(input.value);
    }
    input.addEventListener('input', () => setQuery(input.value));
    root.addEventListener('click', event => {
      const action = event.target.closest('[data-search-action]');
      if (action) {
        if (action.dataset.searchAction === 'clear') setQuery('');
        else setQuery(input.value);
        input.focus();
        return;
      }
      const chip = event.target.closest('[data-search-term]');
      if (chip) {setQuery(chip.dataset.searchTerm); input.focus(); return;}
      const selected = event.target.closest('[data-search-id]');
      if (selected) {
        const item = visible.find(entry => String(entry.id) === selected.dataset.searchId);
        if (!item) return;
        setQuery(item.name);
        if (typeof options.onPick === 'function') options.onPick(item);
      }
    });
    render();
    return {
      setItems(items) {source = Array.isArray(items) ? items.slice() : []; render();},
      setQuery, getQuery() {return input.value.trim();},
      getResults() {return searchItems(source, input.value);},
      focus() {input.focus();}
    };
  }
  const api = {normalize, score, matches, searchItems, create};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SalesHubSmartSearch = api;
})(typeof window === 'undefined' ? null : window);
